'use strict';

// Екран «Інструменти → Діагностика» для монтажника: короткий результат без
// технічної стіни тексту, рівна сітка адрес роутера, чесні цифри швидкості
// (реальні байти / реальний час) і жодних вигаданих показників.

const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadRuntime, verifyExtraction, read} = require('./helpers/tools-source');
const core = require('../js/tools-core.js');

verifyExtraction();

/* ---------- UI-харнес ---------- */

const nodes = {}, opened = [], values = new Map();
let savedCalls = 0;
function element(id){
  return nodes[id] || (nodes[id] = {
    value:'', innerHTML:'', textContent:'', disabled:false, listeners:{},
    classList:{toggle(){}, add(){}, remove(){}},
    addEventListener(type, listener){ this.listeners[type] = listener; }
  });
}
const ctx = {
  MTToolsCore:core,
  loadJSON:(key, fallback)=>fallback,
  localStorage:{setItem:(key, value)=>values.set(key, value), getItem:key=>values.get(key) || null, removeItem:key=>values.delete(key)},
  tickets:[{id:'a', city:'City', street:'Street', diagnosticHistory:[]}],
  settings:{}, calcState:{}, editingTicketId:null, calcOriginalPhotoKeys:[],
  document:{getElementById:element},
  window:{addEventListener(){}, open:url=>opened.push(url)},
  navigator:{clipboard:{writeText:async text=>{ctx.clipboardText = text;}}},
  MTToolsMap:{captureView(){}, destroyMap(){}},
  escapeHtml:value=>String(value ?? ''),
  showToast(){}, switchTab(){}, fillFormForState(){}, fillFormFromState(){},
  appNavigationPush(key, callback){ ctx.back = callback; }, appNavigationCanGoBack:()=>false,
  saveTickets:async()=>{ savedCalls++; return true; },
  AbortController, clearTimeout, appBackButtonHtml:()=>'', closeModal(){}
};
loadRuntime(ctx);
vm.runInContext(read('js/tools-diagnostics-network.js'), ctx, {filename:'js/tools-diagnostics-network.js'});

const screen = ()=>element('toolsScreenRoot').innerHTML;
const setResult = code=>vm.runInContext(`toolsDiagnosticResult=MTToolsCore.sanitizeDiagnosticResult(${code});toolsDiagnosticRunAt=new Date('2026-09-12T10:00:00Z');`, ctx);

/* 1. старого блоку безперервної перевірки більше немає */

ctx.bindToolsScreen();
ctx.toolsOpenDiagnostics();
const idle = screen();
assert.doesNotMatch(idle, /Безперервна перевірка доступності/);
assert.doesNotMatch(idle, /toolsConnectionCheck|start-connection-check|stop-connection-check/);
for(const jargon of ['ICMP','CORS','Private Network Access','DNS','HTTPS URL'])assert.doesNotMatch(idle, new RegExp(jargon), `на екрані немає технічного тексту «${jargon}»`);
assert.match(idle, /Запустити діагностику/,'головна кнопка діагностики лишається');

/* 2. три адреси роутера в рівній сітці */

for(const ip of ['192.168.0.1','192.168.1.1','192.168.100.1'])assert.ok(idle.includes(`data-router-ip="${ip}"`), `адреса ${ip} доступна`);
assert.equal((idle.match(/data-router-ip=/g) || []).length, 3, 'рівно три кнопки роутера');
assert.match(idle, /tools-router-grid/, 'кнопки стоять у сітці, а не в рядку з переносом');

/* 3. кнопка роутера справді відкриває свою адресу */

element('toolsScreenRoot').listeners.click({target:{closest:selector=>selector === '[data-router-ip]' ? {dataset:{routerIp:'192.168.100.1'}} : null}});
assert.deepEqual(opened, ['http://192.168.100.1'], 'клік по кнопці відкриває http-адресу роутера');

/* 4-7. інтернет і швидкість показуються лише за реальними даними */

setResult("{online:true,internetStatus:'ok',summaryStatus:'ok',downloadMbps:94.4,uploadMbps:47.2,latencyMs:25}");
ctx.renderToolsScreen('diagnostics');
const measured = screen();
assert.match(measured, /Інтернет<\/span><strong>✅ Є/,'інтернет показано як «є»');
assert.match(measured, /Завантаження<\/span><strong>94\.4 Мбіт\/с/,'download показано з реального виміру');
assert.match(measured, /Відвантаження<\/span><strong>47\.2 Мбіт\/с/,'upload показано з реального виміру');
assert.doesNotMatch(measured, /Публічна IP|Контрольні ресурси|Cloudflare|HTTP \d|DNS/,'жодного технічного сміття в результаті');

setResult("{online:true,internetStatus:'ok',summaryStatus:'warning',downloadMbps:null,uploadMbps:null,speedStatus:'error',latencyMs:20}");
ctx.renderToolsScreen('diagnostics');
const failedSpeed = screen();
assert.match(failedSpeed, /Інтернет<\/span><strong>✅ Є/,'інтернет лишається правдивим навіть без швидкості');
assert.doesNotMatch(failedSpeed, /Мбіт\/с/,'немає вигаданої швидкості при помилці');
assert.match(failedSpeed, /Не вдалося виміряти швидкість/,'показано коротке зрозуміле повідомлення');

setResult("{online:false,internetStatus:'offline',summaryStatus:'offline',downloadMbps:null,uploadMbps:null}");
ctx.renderToolsScreen('diagnostics');
assert.match(screen(), /Інтернет<\/span><strong>❌ Немає/,'відсутній інтернет показано прямо');

/* 8. без дії користувача заявки не змінюються */

const beforeTickets = JSON.stringify(ctx.tickets);
ctx.toolsOpenDiagnostics();
assert.equal(savedCalls, 0,'відкриття екрана нічого не зберігає');
assert.equal(JSON.stringify(ctx.tickets), beforeTickets,'екран діагностики не чіпає заявки');
setResult("{online:true,internetStatus:'ok',summaryStatus:'ok',downloadMbps:10,uploadMbps:5,latencyMs:20}");
ctx.toolsOpenDiagnostics({address:'City Street'});
assert.equal(JSON.stringify(ctx.tickets), beforeTickets,'швидка діагностика без заявки не пише в історію');

/* 9. у заявку йде лише короткий результат */

const shortRecord = ctx.toolsDiagnosticTicketResult({
  online:true, internetStatus:'ok', summaryStatus:'ok', latencyMs:25, downloadMbps:94.4, uploadMbps:47.2,
  publicIp:'203.0.113.7', speedProvider:'Cloudflare', speedMethod:'Cloudflare parallel browser estimate v3',
  resources:[{label:'Cloudflare Speed', ok:true, state:'ok', detail:'HTTP 200, отримано 1234 B'}]
});
assert.equal(shortRecord.online, true);
assert.equal(shortRecord.downloadMbps, 94.4);
assert.equal(shortRecord.uploadMbps, 47.2);
const shortJson = JSON.stringify(shortRecord);
for(const junk of ['Cloudflare','203.0.113.7','HTTPS','resources','HTTP 200'])assert.ok(!shortJson.includes(junk), `у заявку не потрапляє «${junk}»`);
/* 10. решта інструментів не зламана */

const toolsSource = require('./helpers/tools-source').readToolsSource();
for(const owner of ['toolsDiagnosticsHtml','toolsSaveCurrentDiagnostic','toolsCopyDiagnostic','toolsAttachDiagnostics'])assert.ok(toolsSource.includes(`function ${owner}`), `${owner} лишається на місці`);
assert.match(toolsSource, /data-tools-action="copy-diagnostics"/,'копіювання звіту збережено');
assert.match(toolsSource, /data-tools-action="save-diagnostics"/,'збереження в заявку збережено');
assert.match(toolsSource, /toolsDiagnosticsProfileSearch/,'прив’язка до адреси збережена');
assert.match(read('js/tools-domain.js'), /data-router-ip\][\s\S]*window\.open\(`http:\/\/\$\{router\.dataset\.routerIp\}`/,'відкриття роутера лишається в існуючому обробнику');

/* 11. швидкість міряється реальними байтами й часом, а не домальовується */

(async()=>{
  /* 9b. явне збереження в заявку кладе короткий результат без технічного мусору */

  ctx.tickets[0].diagnosticHistory = [];
  ctx.toolsOpenDiagnostics({address:'City Street', ticketId:'a'});
  setResult("{online:true,internetStatus:'ok',summaryStatus:'ok',downloadMbps:11,uploadMbps:6,latencyMs:21,resources:[{label:'Cloudflare Speed',ok:true,state:'ok',detail:'HTTP 200'}]}");
  await ctx.toolsSaveCurrentDiagnostic();
  assert.equal(savedCalls, 1,'збереження в заявку відбувається лише за явною дією');
  const historyRecord = ctx.tickets[0].diagnosticHistory[0];
  assert.ok(historyRecord,'запис діагностики додано в історію заявки');
  assert.equal(historyRecord.result.downloadMbps, 11);
  assert.deepEqual(Array.from(historyRecord.result.resources), [],'технічні ресурси не потрапляють в історію заявки');
  assert.equal(historyRecord.result.speedProvider, '','назва провайдера швидкості не пишеться в заявку');

  let clock = 0;
  const samples = [];
  const bytesOf = url=>Number(new URL(url).searchParams.get('bytes') || 0);
  const payload = url=>new ArrayBuffer(bytesOf(url));
  const okFetch = async(url, init)=>{ clock += 40; return {ok:true, status:200, arrayBuffer:async()=>payload(url), json:async()=>({ip:'203.0.113.7'})}; };
  const measuredSpeed = await core.runBrowserSpeedTest({fetch:okFetch, now:()=>clock, onSample:(direction, sample)=>samples.push({direction, ...sample})});
  assert.equal(measuredSpeed.speedStatus, 'success','вимірювання завершується успішно на справжніх відповідях');
  assert.ok(measuredSpeed.downloadMbps > 0 && measuredSpeed.uploadMbps > 0);
  const downSamples = samples.filter(sample=>sample.direction === 'download');
  const upSamples = samples.filter(sample=>sample.direction === 'upload');
  assert.ok(downSamples.length && upSamples.length,'є зразки для обох напрямків');
  for(const sample of samples){
    const expected = Number((sample.bytes * 8 / sample.elapsed / 1000).toFixed(6));
    assert.equal(Number(sample.mbps.toFixed(6)), expected, `швидкість ${sample.direction} = реальні байти / реальний час`);
    assert.ok(sample.bytes > 0 && sample.elapsed > 0,'байти та час не вигадані');
  }
  const failed = await core.runBrowserSpeedTest({fetch:async()=>{throw new Error('offline');}, now:()=>clock});
  assert.equal(failed.speedStatus, 'error','помилка мережі не маскується під успіх');
  assert.equal(failed.downloadMbps, null);
  assert.equal(failed.uploadMbps, null);
  assert.equal(failed.online, false);
  console.log('PASS simplified diagnostics screen: no ping UI, even router grid, honest internet/speed output, short ticket record');
})().catch(error=>{console.error(error); process.exitCode = 1;});
