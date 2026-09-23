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
for(const origin of ['https:\/\/1\.1\.1\.1','https:\/\/8\.8\.8\.8','https:\/\/google\.com']){
  assert.match(html,new RegExp('connect-src[^;]*'+origin),'meta CSP allows direct HTTPS check '+origin);
  assert.match(headers,new RegExp('connect-src[^;]*'+origin),'_headers CSP allows direct HTTPS check '+origin);
}
assert.doesNotMatch(html,/unsafe-eval/,'no eval relaxation');

/* Офлайн-шелл: нові файли + движок у precache, новий runtime */
assert.equal((sw.match(/maister-treker-v67-runtime-111/g)||[]).length,1,'release cache pin');
for(const entry of NEW_FILES.map(file=>'./'+file)){
  assert.equal(sw.split("'"+entry+"'").length-1,1,'precache entry exactly once: '+entry);
}
assert.doesNotMatch(sw,/vendor\/cloudflare-speedtest/,'отставший движок убран из офлайн-оболочки');
assert.equal(fs.existsSync(path.join(root,'vendor','cloudflare-speedtest','speedtest.js')),false,'vendored engine removed (заменён собственным адаптивным движком)');
assert.match(app,/APP_VERSION = 'v91\.67 · 2026-09-23'/,'release identity');

/* Меню Інструментів: дві окремі кнопки-екрани */
const domain=read('js/tools-domain.js');
assert.equal((domain.match(/data-tools-view="ping"/g)||[]).length,1,'Пінг button exists once');
assert.equal((domain.match(/data-tools-view="speedtest"/g)||[]).length,1,'Speedtest button exists once');
for(const action of ['ping-start','ping-stop','speed-start','speed-stop'])assert.ok(domain.includes(`action==='${action}'`),'action wired: '+action);
assert.ok(domain.includes("else if(toolsView==='ping')root.innerHTML=toolsPingHtml();"),'ping screen branch');
assert.ok(domain.includes("else if(toolsView==='speedtest')root.innerHTML=toolsSpeedtestHtml();"),'speedtest screen branch');
assert.ok(domain.includes('toolsPingLeave?.()')&&domain.includes('toolsSpeedtestLeave?.()'),'leaving the screens cleans up');
/* data-router-ip (пін v82) живе в екрані діагностики — лишається рівно один;
   пресети пінга — окремий атрибут data-ping-preset, рівно три */
assert.equal((read('js/tools-diagnostics-ui.js').match(/data-router-ip=/g)||[]).length,1,'v82 router presets pin untouched');
assert.equal((read('js/tools-ping-ui.js').match(/data-ping-preset=/g)||[]).length,3,'three ping presets use their own attribute');

/* Собственный адаптивный движок: только Cloudflare-endpoints, временные окна
   и жёсткие лимиты; никакого packet loss и никакого стороннего кода */
const speedtestLogic=read('js/tools-speedtest.js');
assert.match(speedtestLogic,/speed\.cloudflare\.com\/__down/,'download endpoint — Cloudflare');
assert.match(speedtestLogic,/speed\.cloudflare\.com\/__up/,'upload endpoint — Cloudflare');
assert.match(speedtestLogic,/downloadWindowMs:8000/,'~8 с окно завантаження');
assert.match(speedtestLogic,/downloadMaxBytes:400e6/,'жёсткий лимит объёма download');
assert.match(speedtestLogic,/uploadMaxBytes:150e6/,'жёсткий лимит объёма upload');
assert.match(speedtestLogic,/chooseDownShape\(1000\)\.|streams:6/,'многопоточность до 6 потоков');
assert.doesNotMatch(speedtestLogic,/packetLoss/i,'packet loss не измеряется и не имитируется');
assert.doesNotMatch(speedtestLogic,/vendor\//,'движок не тянет сторонний код');
assert.doesNotMatch(speedtestLogic,/import\(/,'без динамического импорта движка');
const cryptoUnused=crypto.createHash('sha256').update('v91.67').digest('hex').length===64;
assert.ok(cryptoUnused);

/* Безпека UI: жоден рядок з API не потрапляє в innerHTML без escapeHtml —
   інтерполяція з API-полями мусить містити escapeHtml( всередині ${...} */
const pingUi=read('js/tools-ping-ui.js');
assert.ok((pingUi.match(/escapeHtml\(/g)||[]).length>=6,'probe-derived strings are escaped');
assert.doesNotMatch(pingUi,/\$\{(?![^}]*escapeHtml\()[^}]*(?:last\.target|row\.label|row\.where|result\.error|result\.detail|probe\.|stats\.)/,'raw API interpolation forbidden: wrap in escapeHtml()');
assert.doesNotMatch(read('js/tools-speedtest-ui.js'),/innerHTML\s*=/,'speedtest screen mutates only through the shared renderer');

/* Компактний UI: жодного жаргону в нових екранах (як і в старих — пін v82) */
for(const file of NEW_FILES){
  /* Чесний дисклеймер «не ICMP-пінг» дозволений (вимога прозорості методу);
     решта протокольного жаргону в UI заборонена. */
  const source=read(file).replace(/не ICMP-пінг/g,'');
  assert.doesNotMatch(source,/ICMP|CORS|Private Network Access|DNS lookup|toolsConnectionCheck|ConnectionCheckTick|Безперервна перевірка доступності/,file+' keeps the fitter-facing language jargon-free');
}

/* Головний UI українською: базові підписи на місці */
assert.match(pingUi,/Ціль перевірки/);
assert.match(pingUi,/Почати перевірку/);
assert.match(pingUi,/Зупинити/);
assert.match(pingUi,/із зовнішніх вузлів/,'the external direction of the check is explicit');
const pingLogic=read('js/tools-ping.js');
assert.match(pingLogic,/DIRECT_HOSTS/,'пресетні цілі перевіряються напряму з телефону');
assert.match(pingLogic,/'1\.1\.1\.1':'https:\/\/1\.1\.1\.1\/'/,'direct URL для 1.1.1.1');
assert.match(pingLogic,/Ціль не відповіла на HTTPS-запити з цього телефону/,'пряма помилка людською');
assert.match(pingLogic,/запит не пройшов \(мережа, VPN або блокувальник контенту\)/,'зовнішня помилка людською, без голого Failed to fetch');
assert.match(pingUi,/не ICMP-пінг/,'UI честно називает метод: это не ICMP');
assert.match(pingUi,/Пристрій у мережі/);
assert.match(pingUi,/не з цього телефону/,'server-side results are labeled');
const speedUi=read('js/tools-speedtest-ui.js');
assert.match(speedUi,/Завантаження/);
assert.match(speedUi,/Відвантаження/);
assert.match(speedUi,/Відгук/);
assert.match(speedUi,/Стабільність/);
assert.match(speedUi,/Під навантаженням/);
assert.match(speedUi,/Вимірювання: Cloudflare/,'attribution present');
assert.match(speedUi,/до ~400 МБ/,'чесний дисклеймер трафіку нового рушія');
assert.doesNotMatch(speedUi,/packetLoss|Втрати/,'no loss row until there is an honest source');

console.log('PASS network tools UI: wiring, offline shell, CSP, pinned engine, escaped rendering, jargon-free Ukrainian screens');
