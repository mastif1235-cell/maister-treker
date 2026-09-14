'use strict';
/* Регресія аудиту (P1 продуктивність синхронізації): журнал раніше обирав і
   надсилав по одній операції послідовно — черга на сотні змін означала сотні
   послідовних round-trip. Тепер Engine підтримує невеликий пул паралельних
   відправок НЕЗАЛЕЖНИХ записів (різні entity:id), а:
     - ланцюжок правок одного запису лишається строго послідовним (CAS за
       revision — його ламати не можна);
     - за замовчуванням concurrency=1 — попередня поведінка збережена;
     - помилка й offline не множать запити та не гублять підтверджене. */
const assert=require('node:assert/strict');
const core=require('../js/sync-engine-core.js');
const {Engine}=require('../js/sync-engine-runtime.js');

function storage(seed={records:{}}){let value=JSON.parse(JSON.stringify(seed));return{load:async()=>JSON.parse(JSON.stringify(value)),save:async v=>{value=JSON.parse(JSON.stringify(v));},value:()=>value};}
const payload=id=>({id,date:'14.09.2026',time:'10:00',content:'x',sum:1,tags:[]});

function createTransport({hold=false,fail=false}={}){
  const state={open:[],maxActive:0,active:0,revisions:[]};
  state.send=item=>{
    state.revisions.push(item.revision);
    state.active++;state.maxActive=Math.max(state.maxActive,state.active);
    const entry={item,resolve:null};
    const promise=new Promise(resolve=>{
      entry.resolve=result=>{resolve(result);const i=state.open.indexOf(entry);if(i>=0)state.open.splice(i,1);state.active--;};
      if(!fail&&!hold)setTimeout(()=>entry.resolve({ok:true,state:{revision:item.revision,tombstone:false}}),0);
    });
    state.open.push(entry);
    return promise;
  };
  return state;
}
async function tick(){for(let i=0;i<40;i++)await Promise.resolve();await new Promise(r=>setTimeout(r,0));}

(async()=>{
  // A) три незалежні заявки при concurrency:3 — три одночасні запити, усі підтверджені.
  {
    let online=true;
    const db=storage();const t=createTransport({hold:true});
    const engine=new Engine({core,storage:db,payload:(_e,item)=>item,online:()=>online,concurrency:3,transport:t});
    await engine.init();
    await engine.recordDiff('ticket',[],[payload('A'),payload('B'),payload('C')]);
    await tick();
    assert.equal(t.open.length,3,'незалежні entity:id стартують паралельно');
    for(const entry of [...t.open])entry.resolve({ok:true,state:{revision:1,tombstone:false}});
    await engine.loop;
    assert.equal(engine.pendingCount(),0,'усі три підтверджені');
  }
  // B) default concurrency=1 — пік активності не перевищує одного запиту.
  {
    const db=storage();const t=createTransport();
    const engine=new Engine({core,storage:db,payload:(_e,item)=>item,online:()=>true,transport:t});
    await engine.init();
    await engine.recordDiff('ticket',[],[payload('A'),payload('B'),payload('C')]);
    await engine.loop;await tick();
    assert.equal(engine.pendingCount(),0);
    assert.equal(t.maxActive,1,'без налаштування — послідовний режим як раніше');
  }
  // C) head+tail одного запису не перетинаються навіть при concurrency:3.
  {
    let state=core.enqueue({records:{}},{entity:'ticket',id:'S',payload:payload('S')},()=>'req-head');
    state=core.markAttempted(state,'ticket','S');
    state=core.enqueue(state,{entity:'ticket',id:'S',payload:{...payload('S'),content:'edit'}},()=>'req-tail');
    const db=storage(state);const t=createTransport();
    const engine=new Engine({core,storage:db,payload:(_e,item)=>item,online:()=>true,concurrency:3,transport:t});
    await engine.init();await engine.loop;await tick();
    assert.deepEqual(t.revisions,[1,2],'ревізії одного запису — строго одна за одною');
    assert.equal(t.maxActive,1,'і жодного перекриття в польоті');
    assert.equal(engine.pendingCount(),0);
  }
  // D) помилки: обидва ключі лишаються в черзі, повторів-шторму немає.
  {
    const db=storage();const t=createTransport({hold:true,fail:true});let timerCount=0;
    const engine=new Engine({core,storage:db,payload:(_e,item)=>item,online:()=>true,concurrency:3,
      setTimeout:()=>{timerCount++;return 7;},clearTimeout:()=>{},transport:t});
    await engine.init();
    await engine.recordDiff('ticket',[],[payload('A'),payload('B')]);
    await tick();
    assert.equal(t.open.length,2,'обидві стартували');
    for(const entry of [...t.open])entry.resolve({ok:false,result:{code:'NETWORK'}});
    await engine.loop;await tick();
    assert.equal(engine.pendingCount(),2,'обидві лишились у черзі');
    assert.equal(timerCount,1,'один спільний backoff-таймер замість шторму повторів');
  }
  // E) offline mid-flight: підтверджене застосовується, нові запити не стартують.
  {
    let online=true;
    const db=storage();const t=createTransport({hold:true});
    const engine=new Engine({core,storage:db,payload:(_e,item)=>item,online:()=>online,concurrency:3,transport:t});
    await engine.init();
    await engine.recordDiff('ticket',[],[payload('A'),payload('B'),payload('C')]);
    await tick();
    assert.equal(t.open.length,3);
    online=false; // з'єднання зникло в польоті
    t.open[0].resolve({ok:true,state:{revision:1,tombstone:false}});
    for(const entry of [...t.open])entry.resolve({ok:false,result:{code:'NETWORK'}});
    await engine.loop;await tick();
    assert.equal(engine.pendingCount(),2,'лише підтверджене пішло з черги');
    assert.equal(t.open.length,0,'після offline нових запитів не піднімається');
    assert.equal(t.revisions.length,3,'жодного повторного запиту всередині цього flush');
  }
  // F) app.js справді вмикає пул (конфіг, а не hardcoded поведінка).
  {
    const fs=require('node:fs'),path=require('node:path');
    const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
    assert.match(app,/concurrency:3,/,'застосунок конфігурує три паралельні слоти відправки');
  }
  console.log('PASS sync journal pipelines independent records, keeps per-record CAS order, and honors offline without request storms');
})().catch(error=>{process.exitCode=1;console.error(error);});
