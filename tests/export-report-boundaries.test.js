'use strict';

// Експорт реєстру для NotebookLM: вміст заявок, приховування телефонів,
// порожні поля, порядок і статистика. Експорт не має містити службових
// значень на кшталт «undefined» і не має віддавати телефони, коли це вимкнено.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO = path.join(__dirname, '..');

function createExporter(tickets, shifts){
  const state = {files:[], toasts:[]};
  const context = {
    console,
    tickets, shifts,
    parseDate:value=>{
      const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getTime() : 0;
    },
    fmtMoney:value=>String(Number(value) || 0) + ' грн',
    Blob:class { constructor(parts){ this.parts = parts; } },
    URL:{createObjectURL:()=>'blob:export', revokeObjectURL:()=>{}},
    document:{createElement:()=>({click(){}, set href(value){this._href=value;}, get href(){return this._href;}}), getElementById:()=>null},
    showToast:message=>state.toasts.push(message)
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'js/reports-domain.js'), 'utf8'), context, {filename:'js/reports-domain.js'});
  return {
    run(format, includeStats, hidePhones){
      const downloads = [];
      context.URL.createObjectURL = ()=>{ downloads.push('blob:export'); return 'blob:export'; };
      context.downloadExport = vm.runInContext('downloadExport', context);
      const realBlob = context.Blob;
      let captured = null;
      context.Blob = class { constructor(parts){ captured = parts.join(''); this.parts = parts; } };
      context.downloadExport(format, includeStats, hidePhones);
      context.Blob = realBlob;
      return captured;
    },
    toasts:state.toasts
  };
}

const tickets = [
  {id:'t2', date:'02.09.2026', time:'12:00', type:'Ремонт', content:'📋 ЗАЯВКА: РЕМОНТ\n📞 Тел: +380 50 111 22 33\n💵 ІТОГО: 250 грн', sum:250},
  {id:'t1', date:'01.09.2026', time:'09:30', type:'Підключення', content:'📋 ЗАЯВКА: ПІДКЛЮЧЕННЯ\n🏙️ Місто: Київ', sum:100},
  {id:'t3', date:'', time:'', type:undefined, content:'', sum:0},
  {id:'t4', date:'03.09.2026', time:'10:00', type:'Ремонт', content:'Короткий опис', sum:0,
    login:'client-login', password:'client-password', masterNote:'приватна нотатка майстра', syncHmacSecret:'hmac-secret'}
];
const shifts = [{id:'s1', date:'01.09.2026', hours:8}];

/* ---------- TXT без статистики: порядок за датою ---------- */

const txt = createExporter(tickets, shifts).run('txt', false, false);
assert.ok(txt.indexOf('=== 01.09.2026 09:30') < txt.indexOf('=== 02.09.2026 12:00'), 'заявки відсортовані за датою');
assert.ok(txt.includes('+380 50 111 22 33'), 'без приховування телефон лишається в експорті');
assert.equal(txt.includes('undefined'), false, 'порожні дата, час і тип не перетворюються на «undefined»');
assert.equal(txt.includes('СТАТИСТИКА'), false, 'статистика не додається, коли її вимкнено');
for(const secret of ['client-login', 'client-password', 'приватна нотатка майстра', 'hmac-secret']){
  assert.equal(txt.includes(secret), false, `експорт не містить службове значення «${secret}»`);
}

/* ---------- Markdown зі статистикою ---------- */

const md = createExporter(tickets, shifts).run('md', true, false);
assert.ok(md.startsWith('# Реєстр заявок — Майстер-Трекер'), 'markdown починається із заголовка');
assert.ok(md.includes('## Статистика'), 'статистика додається у markdown');
assert.ok(md.includes('Усього заявок: 4'), 'статистика рахує всі заявки');
assert.ok(md.includes('Загальна сума: 350 грн'), 'статистика рахує суму заявок');
assert.ok(md.includes('Усього змін: 1'), 'статистика рахує зміни');

/* ---------- приховування телефонів ---------- */

const hidden = createExporter(tickets, shifts).run('txt', false, true);
assert.equal(hidden.includes('+380 50 111 22 33'), false, 'телефон приховано в експорті');
assert.ok(hidden.includes('[прихований номер]'), 'на місці телефону лишається позначка');
assert.ok(hidden.includes('250 грн'), 'суми не плутаються з телефонами');
assert.ok(hidden.includes('01.09.2026'), 'дати не плутаються з телефонами');

/* ---------- порожній реєстр ---------- */

const empty = createExporter([], []).run('md', true, false);
assert.ok(empty.includes('Усього заявок: 0'), 'порожній реєстр експортується без помилок');
assert.equal(empty.includes('undefined'), false, 'порожній експорт не містить «undefined»');

console.log('PASS export keeps order, stats, phone masking and never prints undefined fields');
