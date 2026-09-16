'use strict';
/* v91.32: навігація періодами розділу «Звіти» (← поточний період →).
   1) Чисті функції js/report-utils.js: shiftReportAnchor / reportPeriodWindow /
      reportPeriodLabel — межі місяця/року, лютий (високосний/ні), тиждень через
      тиждень, «all» без навігації, бита дата.
   2) РЕАЛЬНИЙ renderReport/openReportModal (vm): ←/→ перераховує звіт ОДРАЗУ
      (без повторного натискання кнопки періоду), підпис періоду видно, вмикання
      режимів після стрілок тримає той самий якір, «За весь час» ховає навігацію. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const REPO=path.join(__dirname,'..');
const utilsSource=fs.readFileSync(path.join(REPO,'js','report-utils.js'),'utf8');
const domainSource=fs.readFileSync(path.join(REPO,'js','reports-domain.js'),'utf8');

/* ---- 1. Чисті функції ---- */
{
  const context={console};
  vm.createContext(context);vm.runInContext(utilsSource,context);
  const {shiftReportAnchor,reportPeriodWindow,reportPeriodLabel}=context;
  const shift=shiftReportAnchor;
  // День: межі місяця/року, лютий високосний і ні
  assert.equal(shift('day','31.08.2026',-1),'30.08.2026','day -1');
  assert.equal(shift('day','31.08.2026',1),'01.09.2026','day +1 crossing month');
  assert.equal(shift('day','31.12.2026',1),'01.01.2027','day +1 crossing year');
  assert.equal(shift('day','01.01.2026',-1),'31.12.2025','day -1 crossing year back');
  assert.equal(shift('day','28.02.2028',1),'29.02.2028','leap February');
  assert.equal(shift('day','29.02.2028',1),'01.03.2028','leap February end');
  assert.equal(shift('day','28.02.2026',1),'01.03.2026','non-leap February');
  assert.equal(shift('day','01.03.2026',-1),'28.02.2026','non-leap February back');
  // Тиждень: ровно ±7 днів
  assert.equal(shift('week','07.09.2026',-1),'31.08.2026','week -7 crossing month');
  assert.equal(shift('week','07.09.2026',1),'14.09.2026','week +7');
  assert.equal(shift('week','29.12.2026',1),'05.01.2027','week +7 crossing year');
  assert.equal(shift('week','25.08.2026',1),'01.09.2026','week +7 into next month');
  // Місяць: без переповнень (31.01 → лютий, а не 03.03)
  assert.equal(shift('month','31.01.2026',-1),'01.12.2025','month -1 from day 31 crosses year safely');
  assert.equal(shift('month','31.01.2026',1),'01.02.2026','month +1 from day 31');
  assert.equal(shift('month','15.12.2026',1),'01.01.2027','month +1 crossing year');
  assert.equal(shift('month','15.02.2028',-1),'01.01.2028','month -1 from leap February');
  // «all» і бита дата — без змін
  assert.equal(shift('all','15.09.2026',1),'15.09.2026','all has no navigation');
  assert.equal(shift('day','не дата',1),'не дата','invalid anchor returns as-is');
  // Вікна
  const w=reportPeriodWindow('week','07.09.2026');
  assert.equal(w.start.getDate(),1,'week window starts anchor-6');
  assert.equal(w.end.getDate(),7,'week window ends at anchor');
  const mw=reportPeriodWindow('month','15.09.2026');
  assert.equal(mw.start.getDate(),1,'month window starts on day 1');
  assert.equal(mw.start.getMonth(),8,'month window starts in September');
  assert.equal(mw.end.getDate(),30,'month window ends on the last day (September has 30)');
  assert.equal(reportPeriodWindow('day','07.09.2026'),null,'day has no range window');
  // Підписи
  assert.equal(reportPeriodLabel('day','16.09.2026'),'16 вересня 2026','day label');
  assert.equal(reportPeriodLabel('week','07.09.2026'),'01–07 вересня 2026','week label same month');
  assert.equal(reportPeriodLabel('week','04.09.2026'),'29 серпня – 04 вересня 2026','week label crossing month');
  assert.equal(reportPeriodLabel('week','04.01.2027'),'29 грудня 2026 – 04 січня 2027','week label crossing year');
  assert.equal(reportPeriodLabel('month','07.09.2026'),'Вересень 2026','month label');
  assert.equal(reportPeriodLabel('all','07.09.2026'),'за весь час','all label');
  assert.equal(reportPeriodLabel('day','бита'),'','invalid date → empty label');
  console.log('PASS report period pure helpers: shift/window/label across month, year, leap-February boundaries');
}

/* ---- 2. Реальний renderReport + openReportModal (vm) ---- */
(async()=>{
  const tickets=[
    {id:'t28',date:'28.08.2026',time:'09:00',sum:100},
    {id:'t03',date:'03.09.2026',time:'10:00',sum:200},
    {id:'t10',date:'10.09.2026',time:'11:00',sum:300},
    {id:'t16',date:'16.09.2026',time:'12:00',sum:400},
  ];
  const CURRENT='07.09.2026';
  const parseDate=str=>{const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(str||''));return m?new Date(Number(m[3]),Number(m[2])-1,Number(m[1])):null;};
  const isSameMonth=(dateStr,ref)=>{const d=parseDate(dateStr);return !!d&&d.getMonth()===ref.getMonth()&&d.getFullYear()===ref.getFullYear();};
  const elements={};
  function el(id){
    if(!elements[id])elements[id]={id,style:{},textContent:'',innerHTML:'',checked:false,value:'',
      handlers:{},addEventListener(ev,fn){this.handlers[ev]=fn;},click(){},
      _output:null};
    return elements[id];
  }
  const reportCalls=[];
  const context={
    console,
    tickets,currentTicketDate:CURRENT,
    parseDate,isSameMonth,
    ticketsForDate:dateStr=>tickets.filter(t=>t.date===dateStr),
    fmtMoney:v=>String(Number(v)||0)+' грн',
    escapeHtml:s=>String(s),
    buildTicketReportText:args=>{reportCalls.push({title:args.title,list:args.list.map(t=>t.id),total:args.totals.total});return `REPORT ${args.title} :: ${args.list.map(t=>t.id).join(',')}`;},
    showToast:()=>{},
    navigator:{},
    document:{getElementById:id=>el(id),createElement:()=>({})},
  };
  vm.createContext(context);
  vm.runInContext(utilsSource,context);
  vm.runInContext(domainSource,context);
  context.openModal=(title,html,opts)=>{context.__modalHtml=html;opts.onOpen({querySelectorAll:(sel)=>sel==='[data-rep]'?context.__repButtons:[]});};
  // Фейкові кнопки періодів
  context.__repButtons=['day','week','month','all'].map(rep=>({dataset:{rep},onclick:null}));

  context.openReportModal();
  const label=()=>el('reportPeriodLabel').textContent;
  const last=()=>reportCalls[reportCalls.length-1];
  const prev=()=>el('reportPrevBtn').handlers.click();
  const next=()=>el('reportNextBtn').handlers.click();
  const rep=i=>context.__repButtons[i].onclick();
  assert.ok(context.__modalHtml.includes('reportPrevBtn')&&context.__modalHtml.includes('reportNextBtn'),'modal renders ←/→ navigation');
  assert.ok(context.__modalHtml.includes('grid-template-columns:1fr 1fr'),'period buttons use an even 2×2 grid (no lonely wrapped button)');

  // Старт: день від currentTicketDate (07.09 — заявок немає)
  assert.equal(last().list.join(','),'','initial day render anchors at the selected ticket date');
  assert.equal(label(),'07 вересня 2026','initial label shows the day');
  assert.equal(el('reportNavRow').style.display,'flex','navigation visible for day');

  // Тиждень: 01–07.09 → тільки t03
  rep(1);
  assert.equal(last().list.join(','),'t03','week report computed from the anchor');
  assert.equal(label(),'01–07 вересня 2026','week label');

  // ←: перерахунок ОДРАЗУ, без повторного натискання кнопки періоду
  prev();
  assert.equal(last().list.join(','),'t28','← recomputes immediately (previous week)');
  assert.equal(label(),'25–31 серпня 2026','← label follows instantly');
  prev();
  assert.equal(last().list.join(','),'','empty period works (18–24.08 has no tickets)');
  assert.equal(label(),'18–24 серпня 2026','label for an empty period');
  next();
  assert.equal(last().list.join(','),'t28','→ returns to the week with t28');

  // Перемикання режиму ПІСЛЯ стрілок тримає той самий якір
  rep(0); // День
  assert.equal(last().list.join(','),'','range switch keeps the navigated anchor (day 31.08 — no tickets that exact day)');
  assert.equal(label(),'31 серпня 2026','day label at the anchored date');
  rep(2); // Місяць
  assert.equal(last().list.join(','),'t28','month mode keeps the anchor (August)');
  assert.equal(label(),'Серпень 2026','month label of the anchored month');

  // «За весь час»: навігація схована, стрілки нічого не зсувають
  rep(3);
  assert.equal(last().list.join(','),'t28,t03,t10,t16','all-time report sorted by date');
  assert.equal(label(),'за весь час','all label');
  assert.equal(el('reportNavRow').style.display,'none','navigation hidden for all-time');
  prev();
  assert.equal(last().list.join(','),'t28,t03,t10,t16','arrows do nothing in all-time mode');

  // Повернення до тижня — навігація знову видима, якір на місці
  rep(1);
  assert.equal(el('reportNavRow').style.display,'flex','navigation visible again');
  assert.equal(last().list.join(','),'t28','week still anchored at 31.08');
  next();
  assert.equal(last().list.join(','),'t03','→ from 31.08 lands on 01–07.09 (week with t03)');

  console.log('PASS reports UX: ←/→ recompute immediately, label shows the period, range switch keeps the anchor');
})().catch(error=>{console.error(error);process.exitCode=1;});
