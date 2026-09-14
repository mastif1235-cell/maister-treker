'use strict';
/* Регресія аудиту (P1 імпорт): runBulkImport() раніше генерував id як
   Date.now()+лічильник (колазії з одночасно створеними заявками, змішані
   типи id), не відфільтровував повтори (другий імпорт того ж тексту
   подвоював базу) і не мав жодних меж. Тепер: uuid-id, дедуплікація
   «у пачці + проти бази», перевірка реальної дати (31.02 відхиляється),
   ліміт блоків і довжини вмісту, чесна зведена статистика для тоста. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js','reports-domain.js'),'utf8');

function createHarness({initialTickets=[],engine=true}={}){
  const events=[];
  let uuidCounter=0;
  const context={
    console:{log(){},warn(){},error(){}},
    tickets:initialTickets.map(t=>({...t})),
    blankTicketObject:()=>({photos:[],tags:[]}),
    MTSyncEngineRuntime:{uuid:()=>`uuid-${++uuidCounter}`},
    saveTickets(){events.push('save');return Promise.resolve(true);},
    getScriptUrl:()=>engine?'https://script.example':'',
    syncEngine:engine?{pendingCount:()=>1,flush(){events.push('flush');return Promise.resolve(true);}}:null,
    showToast:m=>events.push('toast:'+m),
    renderTicketsScreen(){events.push('render');},
    backupLocalData(){events.push('backup');}
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  const stats=()=>vm.runInContext('mtLastBulkImportStats',context);
  return {context,events,stats};
}
const plain=v=>JSON.parse(JSON.stringify(v));
const block=(date,time,name,sum)=>`${date} ${time} — підключення\nКлієнт: ${name}\nАдреса: вул. Тестова, 5\nСума: ${sum}`;

(async()=>{
  const text=[block('10.09.2026','12:00','Іван',600),block('11.09.2026','13:30','Петро',700)].join('\n\n')
    +'\n\n'+block('10.09.2026','12:00','Іван',600); // повтор у пачці
  {
    const h=createHarness();
    const count=await h.context.runBulkImport(text);
    assert.equal(count,2,'валідні блоки імпортовані, повтор у межах пачки — ні');
    const ids=h.context.tickets.map(t=>t.id);
    assert.deepEqual(ids,['uuid-1','uuid-2'],'стабільні uuid замість Date.now()+лічильника');
    assert.equal(h.context.tickets.every(t=>typeof t.id==='string'&&t.id),true);
    assert.deepEqual(plain(h.stats()),{imported:2,duplicates:1,rejected:0});
    assert.ok(h.events.includes('save')&&h.events.includes('flush'),'локальне збереження перед flush');
    // Повторний імпорт того ж тексту — ідемпотентний no-op.
    const before=h.context.tickets.length;
    const again=await h.context.runBulkImport(text);
    assert.equal(again,0,'другий імпорт того ж тексту не плодить дублікати');
    assert.equal(h.context.tickets.length,before);
    assert.deepEqual(plain(h.stats()),{imported:0,duplicates:3,rejected:0});
  }
  {
    // Фантастичні дати та наддовгий блок — відхиляються, решта живе.
    const h=createHarness();
    const tricky=[block('31.02.2026','12:00','Ghost',100),'29.02.2026 12:00 — підключення невалідний рік',block('10.09.2026','12:00','Іван',600)].join('\n\n');
    const count=await h.context.runBulkImport(tricky);
    assert.equal(count,1,'реальний календар перевіряється, а не лише формат');
    assert.equal(h.stats().rejected,2,'биті блоки пораховані й показані користувачеві');
  }
  {
    // Ліміт обсягу: 1005 валідних блоків → 1000 імпортовано, 5 відхилено.
    const h=createHarness();
    const many=Array.from({length:1005},(_,i)=>block('10.09.2026',`${String(Math.floor(i/60)%24).padStart(2,'0')}:${String(i%60).padStart(2,'0')}`,`Клієнт ${i}`,i)).join('\n\n');
    const count=await h.context.runBulkImport(many);
    assert.equal(count,1000,'потік обмежений стелею');
    assert.equal(h.stats().rejected,5,'відсіяне — пораховане');
  }
  {
    // Деградований режим (немає рушія/URL): імпорт лишається локально без падіння.
    const h=createHarness({engine:false});
    const count=await h.context.runBulkImport(block('12.09.2026','09:00','Без хмари',500));
    assert.equal(count,1);
    assert.ok(!h.events.includes('flush'),'мертвий рушій не викликається');
    assert.ok(h.events.includes('save'),'локальне збереження сталось');
  }
  // Інтеграція збереження: id-у-сесії не конфліктують із «свіжими» картками,
  // які народжуються тим самим Date.now() шляхом (колишній ризик колазій).
  {
    const h=createHarness();
    const legacyLike={id:String(Date.now()),date:'09.09.2026',time:'',content:'before',sum:0,tags:[],photos:[]};
    h.context.tickets.push(legacyLike);
    const count=await h.context.runBulkImport(block('09.09.2026','12:00','Today',300)+'\n'+block('09.09.2026','12:05','Today2',310));
    assert.equal(count,2);
    assert.equal(new Set(h.context.tickets.map(t=>t.id)).size,h.context.tickets.length,'усі id унікальні');
  }
  console.log('PASS bulk import is bounded, deduplicated, uuid-keyed and calendar-checked');
})().catch(error=>{process.exitCode=1;console.error(error);});
