'use strict';
/* v91.48 — регресії клієнтського рендерера ШІ-відповідей (js/ai/ai-render.js).

   Реальний production-баг «1. 1. 1.»: модель повертає багаторядкові пункти
   (пункт + рядок-продовження «— ремонт, 300 грн»), між пунктами — порожні
   рядки. Старий рендерер закривав <ol> і на порожньому рядку, і на рядку-
   продовженні, тож кожен пункт створював НОВИЙ <ol>, а браузер нумерує
   кожен <ol> з 1. Перевіряємо, що тепер це один список 1,2,3 і що:

   - рядки-продовження лишаються всередині свого пункту;
   - порожні рядки не рвуть список;
   - два справді різні списки не склеюються;
   - дати/ціни/звичайні числа не стають пунктами списку;
   - XSS-безпека збережена (жодного innerHTML, <script> лишається текстом);
   - **жирний** рендериться як <strong>, а не зірочками. */

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');

function fakeDoc(){
  function El(tag){
    this.tagName=tag; this.children=[]; this.dataset={}; this._text=''; this.className='';
    this.appendChild=function(c){ this.children.push(c); return c; };
    this.removeChild=function(c){ this.children=this.children.filter(function(x){return x!==c;}); };
    this.addEventListener=function(){};
  }
  Object.defineProperty(El.prototype,'textContent',{set:function(v){this._text=String(v);this.children=[];},get:function(){return this._text;}});
  return {createElement:function(tag){return new El(tag);},createTextNode:function(t){const e=new El('#text');e.textContent=t;return e;}};
}
function loadRenderer(){
  const sandbox={console,Promise,JSON,Array,Object,String,Number,RegExp,Error};
  sandbox.globalThis=sandbox; sandbox.window=undefined;
  const ctx=vm.createContext(sandbox);
  for(const f of ['js/ai/ai-config.js','js/ai/ai-render.js']){
    vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});
  }
  return sandbox.MTAI;
}
function collect(el,acc,pred){
  (el.children||[]).forEach(function(c){ if(!pred||pred(c))acc.push(c); collect(c,acc,pred); });
  return acc;
}
function textOf(el){ return (el._text||'')+(el.children||[]).map(textOf).join(''); }
function render(text){
  const doc=fakeDoc(); const renderer=loadRenderer().createRenderer(doc);
  const box=doc.createElement('div');
  renderer.renderAnswer(box,text);
  return {doc,box};
}

/* ── 1. реальний production-вигляд: повторювані «1.» + продовження + порожні рядки ── */
{
  const SAMPLE=[
    'Ось знайдені заявки:',
    '',
    '1. **15.09.2026, 12:30** — Вул Садова 19',
    '   — ремонт, безкоштовно',
    '',
    '1. **19.08.2026, 14:41** — Вул Генерала Пушкіна 55',
    '   — ремонт, 300 грн',
    '',
    '1. **06.08.2026, 16:42** — Вул Садова 21',
    '   — ремонт, 599 грн'
  ].join('\n');
  const {box}=render(SAMPLE);
  const lists=collect(box,[],c=>/^[uo]l$/i.test(String(c.tagName)));
  assert.equal(lists.length,1,'рівно ОДИН список, а не три окремі <ol>');
  assert.equal(String(lists[0].tagName).toLowerCase(),'ol','нумерований список');
  const items=lists[0].children.filter(c=>String(c.tagName).toLowerCase()==='li');
  assert.equal(items.length,3,'три пункти в одному <ol> — браузер пронумерує їх 1,2,3');
  assert.ok(items[0].children.some(c=>c.className==='ai-li-cont'),'продовження першого пункту всередині нього');
  assert.ok(textOf(items[0]).includes('ремонт, безкоштовно'),'текст продовження збережено');
  assert.ok(!textOf(items[0]).includes('19.08.2026'),'наступний пункт не потрапив у перший');
  assert.ok(textOf(items[2]).includes('Садова 21'),'третій пункт на місці');
  const strongs=collect(items[0],[],c=>String(c.tagName).toLowerCase()==='strong');
  assert.ok(strongs.length===1,'**жирний** став <strong>');
  assert.ok(!textOf(box).includes('**'),'літеральних ** у виводі немає');
}

/* ── 2. декоративне продовження з колонки 0 усередині нумерованого списку ── */
{
  const {box}=render([
    '1. Перша робота',
    '— деталь без відступу',
    '1. Друга робота'
  ].join('\n'));
  const lists=collect(box,[],c=>/^[uo]l$/i.test(String(c.tagName)));
  assert.equal(lists.length,1,'один список');
  const items=lists[0].children.filter(c=>String(c.tagName).toLowerCase()==='li');
  assert.equal(items.length,2,'два пункти');
  assert.ok(textOf(items[0]).includes('деталь без відступу'),'рядок «— …» лишився в першому пункті');
  assert.ok(!textOf(items[1]).includes('деталь без відступу'),'і не перейшов у другий');
}

/* ── 3. два справді різні списки не склеюються ── */
{
  const {box}=render([
    '1. Перший список — один',
    '2. Перший список — два',
    'Інший блок:',
    '1. Другий список — один',
    '2. Другий список — два'
  ].join('\n'));
  const lists=collect(box,[],c=>/^[uo]l$/i.test(String(c.tagName)));
  assert.equal(lists.length,2,'текстовий рядок закриває список: два окремі <ol>');
  assert.equal(textOf(lists[0]).includes('Другий список'),false,'перший список без пунктів другого');
}

/* ── 4. маркований і нумерований списки лишаються різними ── */
{
  const {box}=render([
    '- пункт маркований',
    '- ще один',
    '1. пункт нумерований',
    '2. ще один'
  ].join('\n'));
  const uls=collect(box,[],c=>String(c.tagName).toLowerCase()==='ul');
  const ols=collect(box,[],c=>String(c.tagName).toLowerCase()==='ol');
  assert.equal(uls.length,1,'один <ul>');
  assert.equal(ols.length,1,'один <ol>');
}

/* ── 5. дати, ціни та звичайні числа не стають пунктами списку ── */
{
  const {box}=render([
    '15.09.2026, 12:30 — Вул Садова 19',
    'Сума: 300 грн, без знижок',
    'Разом 5 заявок.'
  ].join('\n'));
  const lists=collect(box,[],c=>/^[uo]l$/i.test(String(c.tagName)));
  assert.equal(lists.length,0,'жодного списку там, де його не писала модель');
  assert.ok(textOf(box).includes('15.09.2026, 12:30'),'дата лишилась як текст');
}

/* ── 6. XSS-регресія: усе лишається текстом, включно з жирним і продовженнями ── */
{
  const {box}=render([
    '1. **<script>alert(1)</script>**',
    '   — <img src=x onerror=alert(2)>',
    '<svg onload=alert(3)>'
  ].join('\n'));
  const tags=collect(box,[],()=>true).map(c=>c.tagName);
  assert.ok(!tags.includes('script'),'script не стає елементом');
  assert.ok(!tags.includes('img'),'img не стає елементом');
  assert.ok(!tags.includes('svg'),'svg не стає елементом');
  assert.ok(textOf(box).includes('<script>alert(1)</script>'),'розмітка лишається видимим текстом');
  const strongs=collect(box,[],c=>String(c.tagName).toLowerCase()==='strong');
  assert.equal(strongs.length,1,'жирний — це <strong> з текстовим вузлом');
}

/* ── 7. рядок-продовження без жодного списку не ламає рендер ── */
{
  const {box}=render('   просто відступ без списку\nі далі текст');
  const lists=collect(box,[],c=>/^[uo]l$/i.test(String(c.tagName)));
  assert.equal(lists.length,0,'жодного списку');
  assert.ok(textOf(box).includes('просто відступ без списку'),'текст збережено');
}

console.log('PASS ai-render v91.48: один <ol> 1,2,3 з багаторядковими пунктами, два списки не зливаються, XSS-safe, **жирний**');
