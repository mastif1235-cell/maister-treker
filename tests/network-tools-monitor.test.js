'use strict';
/* v91.68: режим «Нагляд» — безперервний моніторинг прямими HTTPS-пробами.
   Контракти: ~1 проба/с без перекриття запитів; мережеві збої/таймаути/офлайн
   — це «Немає відповіді», а НЕ фатальна помилка сесії; Stop миттєвий, не
   зараховується як спроба і не ламає статистику; лічильники рахують усі
   спроби сесії навіть коли старі рядки прибрані з DOM-журналу (~100). */
const assert=require('node:assert/strict');
const MTPing=require('../js/tools-ping.js');

/* Фейковий fetch зі сценарієм: масив відповідей споживається по одній пробі.
   {ms:42} → успіх; {fail:true} → мережева помилка; {hang:true} → завислий
   запит (спрацьовує таймаут проби). */
function makeFetch(script,tracking){
  let index=0;
  let inFlight=0,maxInFlight=0;
  const fn=async(url,init)=>{
    inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    if(tracking&&tracking.urls)tracking.urls.push(String(url));
    const step=script[Math.min(index,script.length-1)];
    index++;
    try{
      if(step&&step.hang)return await new Promise((_resolve,reject)=>{if(init&&init.signal)init.signal.addEventListener('abort',()=>reject(new Error('AbortError')));});
      if(step&&step.fail)throw new Error('network down');
      if(step&&step.ms)await new Promise(resolve=>setTimeout(resolve,step.ms)); // реальна тривалість = замір
      return{ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(0)};
    }finally{inFlight--;}
  };
  fn.maxInFlight=()=>maxInFlight;
  fn.calls=()=>index;
  return fn;
}

async function runScripted(host,script,{attempts,extraOptions={},onEntries}={}){
  const fetchFn=makeFetch(script);
  const controller=new AbortController();
  const entries=[];
  const done=MTPing.runMonitor(host,Object.assign({
    fetch:fetchFn,signal:controller.signal,
    intervalMs:1,timeoutMs:extraOptions.timeoutMs||60,
    onAttempt:entry=>{entries.push(entry);if(onEntries)onEntries(entry,controller);if(entries.length>=attempts)controller.abort();}
  },extraOptions.loop||{}));
  const finalStats=await done;
  return{entries,finalStats,fetchFn};
}

(async()=>{
  /* 1-3. Стартує і виконує більше 3 спроб; кілька успішних поспіль */
  { // BLOCK0
    const {entries,finalStats}=await runScripted('8.8.8.8',[{ms:42},{ms:47},{ms:51},{ms:45}],{attempts:6});
    assert.ok(entries.length>=6,'виконано більше 3 спроб: '+entries.length);
    assert.ok(entries.slice(0,4).every(entry=>entry.ok&&entry.ms>0),'успішні відповіді поспіль');
    assert.equal(entries[0].seq,1);assert.equal(entries[5].seq,6);
    assert.equal(finalStats.total,6);assert.equal(finalStats.success,6,'усі 6 спроб успішні (сценарій повторює останній крок)');
  }
  /* 4-5. Таймаут між успішними — не зупиняє моніторинг */
  { // BLOCK0
    const {entries}=await runScripted('8.8.8.8',[{ms:30},{hang:true},{hang:true},{ms:60},{ms:35}],{attempts:5,extraOptions:{timeoutMs:40}});
    assert.equal(entries[1].ok,false,'timeout → «Немає відповіді»');
    assert.equal(entries[2].ok,false);
    assert.equal(entries[3].ok,true,'після таймаутів відповіді йдуть далі автоматично');
    assert.equal(entries[4].ok,true);
    assert.equal(entries[4].seq,5,'сесія не перезапускалась');
  }
  /* 6-7. Інтернет зник → серія «Немає відповіді»; з'явився → відповіді самі поновились */
  { // BLOCK0
    const {entries}=await runScripted('1.1.1.1',[{ms:20},{ms:21},{fail:true},{fail:true},{fail:true},{ms:25},{ms:22}],{attempts:7});
    assert.equal(entries[2].ok,false);assert.equal(entries[3].ok,false);assert.equal(entries[4].ok,false,'пропажа інтернету = серія «Немає відповіді»');
    assert.equal(entries[5].ok,true,'поновлення інтернету — відповіді автоматично');
    assert.equal(entries[6].ok,true);
    assert.ok(entries.every(entry=>entry.seq>=1),'жодного розриву нумерації: моніторинг не перезапускався');
  }
  /* 8-14. Лічильники: всього/успішних/без відповіді/втрати/мін/сер/макс */
  { // BLOCK0
    const {entries}=await runScripted('1.1.1.1',[{ms:30},{ms:40},{fail:true},{ms:50}],{attempts:4});
    const stats=entries[3].stats;
    assert.equal(stats.total,4);
    assert.equal(stats.success,3);
    assert.equal(stats.failed,1);
    assert.equal(stats.lossPct,25,'loss = failed/total*100');
    assert.ok(stats.minMs>=30&&stats.minMs<36,'мін ≈30 (реальний замір тривалості): '+stats.minMs);
    assert.ok(stats.avgMs>=38&&stats.avgMs<=46,'сер тільки по успішних ≈40: '+stats.avgMs);
    assert.ok(stats.maxMs>=48&&stats.maxMs<62,'макс ≈50: '+stats.maxMs);
    /* напівпрозорі частки відсотка */
    const stats2=MTPing.createMonitorStats();
    for(let i=0;i<1000;i++)MTPing.recordMonitorAttempt(stats2,i%3!==0,i%3===0?null:10);
    assert.equal(stats2.total,1000);assert.equal(stats2.failed,334);assert.equal(stats2.lossPct,33.4,'loss до 0.1%');
    const stats3=MTPing.createMonitorStats();
    for(let i=0;i<5;i++)MTPing.recordMonitorAttempt(stats3,false,null);
    assert.equal(stats3.minMs,null,'мін/сер/макс порожні без успішних');
    assert.equal(stats3.avgMs,null);
    assert.equal(stats3.maxMs,null);
    assert.equal(stats3.lossPct,100);
  }
  /* 15-18. Stop: миттєво, аборт поточного fetch, без фальшивого «Немає відповіді», без нових спроб */
  { // BLOCK0
    const tracking={urls:[]};
    const fetchFn=makeFetch([{ms:20},{hang:true}],tracking);
    const controller=new AbortController();
    const entries=[];
    const done=MTPing.runMonitor('8.8.8.8',{fetch:fetchFn,signal:controller.signal,intervalMs:20,timeoutMs:5000,onAttempt:entry=>entries.push(entry)});
    /* чекаємо детерміновано: проба 1 (20 мс) записана, проба 2 (hang) у польоті */
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal(entries.length,1,'перша спроба записана');
    const callsAtStop=fetchFn.calls();
    controller.abort(); // «■ Зупинити»
    const finalStats=await done;
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(fetchFn.calls(),callsAtStop,'після Stop нові спроби не запускаються');
    assert.equal(finalStats.total,1,'ручний Stop НЕ додав «Немає відповіді» (зависла проба не зарахована)');
    assert.equal(finalStats.failed,0);
    assert.equal(finalStats.lossPct,0,'loss не росте через Stop');
  }
  /* Без перекриття запитів: максимум 1 in-flight */
  { // BLOCK0
    const fetchFn=makeFetch([{ms:10}]);
    const controller=new AbortController();
    let count=0;
    const promise=MTPing.runMonitor('8.8.8.8',{fetch:fetchFn,signal:controller.signal,intervalMs:1,timeoutMs:50,onAttempt:()=>{count++;if(count>=8)controller.abort();}});
    await promise;
    assert.equal(fetchFn.maxInFlight(),1,'жодних перекритих fetch: один in-flight максимум');
  }
  /* 19-20 (unit-частина): нова сесія = нова чиста статистика; DOM-очищення — в E2E */
  { // BLOCK0
    const stats=MTPing.createMonitorStats();
    MTPing.recordMonitorAttempt(stats,true,10);
    const fresh=MTPing.createMonitorStats();
    assert.equal(fresh.total,0);assert.equal(fresh.success,0);assert.equal(fresh.lossPct,0);
    assert.notEqual(stats,fresh);
  }
  /* 21-22. DOM-журнал: максимум ~100 рядків; лічильники сесії ростуть після чистки */
  {
    /* vm: завантажуємо UI-модуль зі стабами */
    const vm=require('node:vm');
    const fs=require('node:fs');
    const path=require('node:path');
    const root=path.join(__dirname,'..');
    const makeLogEl=()=>{
      const children=[];
      return{
        children,
        appendChild(node){children.push(node);},
        removeChild(node){const i=children.indexOf(node);if(i>=0)children.splice(i,1);},
        get firstChild(){return children[0];},
        scrollTop:0,clientHeight:100,get scrollHeight(){return 100+children.length*10;},
        lines:()=>children.map(node=>node.textContent)
      };
    };
    const logEl=makeLogEl();
    const context={
      console:{log(){},warn(){},error(){}},
      toolsBackButton:()=>'',
      escapeHtml:value=>String(value==null?'':value),
      renderToolsScreen(){},
      showToast(){},
      toolsView:'ping',
      MTPing,
      AbortController,
      setTimeout,clearTimeout,
      document:{
        createElement(){return{className:'',textContent:''};},
        getElementById(id){return id==='toolsPingLog'?logEl:null;}
      }
    };
    context.globalThis=context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root,'js/tools-ping-ui.js'),'utf8'),context,{filename:'tools-ping-ui.js'});
    /* швидка сесія: 130 спроб */
    MTPing.MONITOR_INTERVAL_MS=1;
    let scriptIndex=0;
    context.fetch=async()=>{
      scriptIndex++;
      if(scriptIndex%3===0)throw new Error('down');
      return{ok:true,status:200};
    };
    context.MTPing.MONITOR_INTERVAL_MS=1;
    context.toolsPingMonitorStart('8.8.8.8');
    await new Promise(resolve=>{
      const check=setInterval(()=>{
        const st=context.toolsPingMonitorState();
        if(st&&st.stats&&st.stats.total>=130){st.controller.abort();clearInterval(check);resolve();}
      },5);
    });
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(logEl.children.length<=100,'DOM-журнал обмежений ~100 рядками: '+logEl.children.length);
    assert.equal(logEl.lines()[0].startsWith('#'),true,'рядки нумеровані');
    const totalNow=context.toolsPingMonitorState().stats.total;
    assert.ok(totalNow>=130,'загальні лічильники рахують всі спроби: '+totalNow);
    const failLines=logEl.lines().filter(text=>text.includes('Немає відповіді')).length;
    assert.ok(failLines>0,'невдалі спроби у журналі');
    assert.ok(logEl.lines().some(text=>/Відповідь від 8\.8\.8\.8: \d+ мс/.test(text)),'успішні рядки у форматі ping-подібного журналу');

    /* 19-20 (UI): повторний старт = чиста сесія: нова статистика з нуля */
    context.toolsPingMonitorStart('8.8.8.8');
    const st2=context.toolsPingMonitorState();
    assert.equal(st2.stats.total,0,'нова сесія — статистика скинута');
    assert.notEqual(st2.controller,null,'новий AbortController');
    /* стара сесія зупинена: перша ж спроба нової сесії має seq=1 */
    await new Promise(resolve=>setTimeout(resolve,30));
    st2.controller.abort();
    assert.ok(st2.stats.total<=3,'нова сесія почала рахунок з нуля, а не продовжила 130+');
  }
  /* 23. Пряма ціль не йде в Globalping: тільки HTTPS до цілі */
  {
    const tracking={urls:[]};
    const fetchFn=makeFetch([{ms:15},{ms:16}],tracking);
    const controller=new AbortController();
    let seen=0;
    await MTPing.runMonitor('8.8.8.8',{fetch:fetchFn,signal:controller.signal,intervalMs:1,timeoutMs:50,onAttempt:entry=>{seen++;if(seen>=2)controller.abort();}});
    assert.ok(tracking.urls.length>=2);
    assert.ok(tracking.urls.every(url=>url.startsWith('https://8.8.8.8/')),'лише прямі запити до цілі');
    assert.ok(tracking.urls.every(url=>!url.includes('globalping')),'нуль викликів Globalping у режимі нагляду');
  }

  console.log('PASS monitor: безперервний цикл (>3 спроб, серії успіхів/таймаутів/збоїв/відновлення), точні лічильники (total/success/failed/loss/min/avg/max), Stop миттєвий без фальшивих спроб, без перекриття fetch, DOM ≤100 рядків при повній статистиці, нова сесія з нуля, тільки прямі HTTPS-запити без Globalping');
})().catch(error=>{console.error('FAIL:',error);process.exit(1);});
