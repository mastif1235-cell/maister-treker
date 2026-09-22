'use strict';
/* v91.66: статичні контракти нових інструментів — підключення, офлайн-шелл,
   CSP (зовнішня перевірка Globalping), пін движка, безпека innerHTML і
   відсутність технічного жаргону в UI (compact-tools контракт v82). */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n');

const html=read('index.html'),sw=read('sw.js'),app=read('app.js'),headers=read('_headers');
const NEW_FILES=['js/tools-network-utils.js','js/tools-ping.js','js/tools-ping-ui.js','js/tools-speedtest.js','js/tools-speedtest-ui.js'];

/* Підключення: кожен модуль рівно один раз, у правильному порядку (спільні
   утиліти → логіка → UI), після існуючих tools-файлів */
for(const file of NEW_FILES){
  const tag=`<script src="${file}"></script>`;
  assert.equal(html.split(tag).length-1,1,'one script tag '+file);
  assert.ok(html.indexOf(tag)>html.indexOf('<script src="js/tools-diagnostics-network.js"></script>'),'after existing tools modules: '+file);
}
assert.ok(html.indexOf('<script src="js/tools-network-utils.js"></script>')<html.indexOf('<script src="js/tools-ping.js"></script>'),'utils before ping logic');
assert.ok(html.indexOf('<script src="js/tools-ping.js"></script>')<html.indexOf('<script src="js/tools-ping-ui.js"></script>'),'logic before ui');
assert.ok(html.indexOf('<script src="js/tools-speedtest.js"></script>')<html.indexOf('<script src="js/tools-speedtest-ui.js"></script>'),'logic before ui');

/* CSP: зовнішня перевірка дозволена і в meta, і в _headers (паритет тримає
   окремий тест, тут — пряма наявність) */
assert.match(html,/connect-src[^;]*https:\/\/api\.globalping\.org/,'meta CSP allows Globalping');
assert.match(headers,/connect-src[^;]*https:\/\/api\.globalping\.org/,'_headers CSP allows Globalping');
assert.doesNotMatch(html,/unsafe-eval/,'no eval relaxation');

/* Офлайн-шелл: нові файли + движок у precache, новий runtime */
assert.equal((sw.match(/maister-treker-v67-runtime-110/g)||[]).length,1,'release cache pin');
for(const entry of NEW_FILES.map(file=>'./'+file).concat(['./vendor/cloudflare-speedtest/speedtest.js','./vendor/cloudflare-speedtest/LICENSE'])){
  assert.equal(sw.split("'"+entry+"'").length-1,1,'precache entry exactly once: '+entry);
}
assert.match(app,/APP_VERSION = 'v91\.66 · 2026-09-22'/,'release identity');

/* Меню Інструментів: дві окремі кнопки-екрани */
const domain=read('js/tools-domain.js');
assert.equal((domain.match(/data-tools-view="ping"/g)||[]).length,1,'Пінг button exists once');
assert.equal((domain.match(/data-tools-view="speedtest"/g)||[]).length,1,'Speedtest button exists once');
for(const action of ['ping-start','ping-stop','speed-start','speed-stop'])assert.ok(domain.includes(`action==='${action}'`),'action wired: '+action);
assert.ok(domain.includes("else if(toolsView==='ping')root.innerHTML=toolsPingHtml();"),'ping screen branch');
assert.ok(domain.includes("else if(toolsView==='speedtest')root.innerHTML=toolsSpeedtestHtml();"),'speedtest screen branch');
assert.ok(domain.includes('toolsPingLeave?.()')&&domain.includes('toolsSpeedtestLeave?.()'),'leaving the screens cleans up');
/* data-router-ip лишається рівно один (пін v82), пресети пінга — інший атрибут */
assert.equal((domain.match(/data-router-ip=/g)||[]).length,1);

/* Відкритий движок: точна версія, ліцензія, sha256-пін (supply chain) */
const enginePath=path.join(root,'vendor/cloudflare-speedtest/speedtest.js');
const engine=fs.readFileSync(enginePath,'utf8');
const sha=crypto.createHash('sha256').update(engine).digest('hex');
assert.equal(sha,'cd71cac96b110649bf6b5a3cb77e26687dcfd75e79f7b718e025fa849ac6e205','vendored @cloudflare/speedtest is the pinned build');
assert.ok(engine.includes('SpeedTestEngine'),'vendored engine keeps its default export');
const license=read('vendor/cloudflare-speedtest/LICENSE');
assert.match(license,/MIT/,'MIT license ships with the engine');

/* Прод-конфігурація движка: без автостарту, без хмарного логування результатів */
const speedtestLogic=read('js/tools-speedtest.js');
assert.match(speedtestLogic,/autoStart:false/);
assert.match(speedtestLogic,/logAimApiUrl:null/);
assert.match(speedtestLogic,/ENGINE_MODULE_URL='\.\.\/vendor\/cloudflare-speedtest\/speedtest\.js'/,'engine loads from the pinned local file, not a CDN');

/* Безпека UI: жоден рядок з API не потрапляє в innerHTML без escapeHtml */
const pingUi=read('js/tools-ping-ui.js');
assert.ok((pingUi.match(/escapeHtml\(/g)||[]).length>=6,'probe-derived strings are escaped');
for(const raw of [/\$\{[^}]*\bprobe\./,/\$\{[^}]*\bstats\./,/\$\{[^}]*entry\./,/\$\{[^}]*result\.error/,/\$\{[^}]*result\.detail/,/\$\{[^}]*\.where\}/]){
  assert.doesNotMatch(pingUi,raw,'raw API interpolation forbidden: '+raw);
}
assert.doesNotMatch(read('js/tools-speedtest-ui.js'),/innerHTML\s*=/,'speedtest screen mutates only through the shared renderer');

/* Компактний UI: жодного жаргону в нових екранах (як і в старих — пін v82) */
for(const file of NEW_FILES){
  const source=read(file);
  assert.doesNotMatch(source,/ICMP|CORS|Private Network Access|DNS lookup|toolsConnectionCheck|ConnectionCheckTick|Безперервна перевірка доступності/,file+' keeps the fitter-facing language jargon-free');
}

/* Головний UI українською: базові підписи на місці */
assert.match(pingUi,/Ціль перевірки/);
assert.match(pingUi,/Почати перевірку/);
assert.match(pingUi,/Зупинити/);
assert.match(pingUi,/із зовнішніх вузлів/,'the external direction of the check is explicit');
assert.match(pingUi,/Пристрій у мережі/);
assert.match(pingUi,/не з цього телефону/,'server-side results are labeled');
const speedUi=read('js/tools-speedtest-ui.js');
assert.match(speedUi,/Завантаження/);
assert.match(speedUi,/Відвантаження/);
assert.match(speedUi,/Відгук/);
assert.match(speedUi,/Стабільність/);
assert.match(speedUi,/Під навантаженням/);
assert.match(speedUi,/Вимірювання: Cloudflare/,'attribution present');
assert.doesNotMatch(speedUi,/packetLoss|Втрати/,'no loss row until there is an honest source');

console.log('PASS network tools UI: wiring, offline shell, CSP, pinned engine, escaped rendering, jargon-free Ukrainian screens');
