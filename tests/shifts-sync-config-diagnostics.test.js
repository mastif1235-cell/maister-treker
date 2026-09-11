'use strict';
// Если сервер не принимает смены (нет отдельной таблицы смен), раньше это
// выглядело как вечное «не синхронизировано». Проверяем read-only пробу
// конфигурации, точные сообщения, приостановку автоматического retry для одних
// только смен и неизменность поведения для заявок.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const shiftsSource=fs.readFileSync(path.join(root,'js','shifts-domain.js'),'utf8');
const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
const engineSource=fs.readFileSync(path.join(root,'js','sync-engine-runtime.js'),'utf8');
const ticketsSource=fs.readFileSync(path.join(root,'js','tickets-domain.js'),'utf8');

const blockStart=shiftsSource.indexOf('/* ==== Діагностика синхронізації змін');
const blockEnd=shiftsSource.indexOf('/* ==== кінець блоку діагностики змін ==== */');
assert.ok(blockStart>=0&&blockEnd>blockStart,'shift sync diagnostics block exists in shifts-domain.js');
const block=shiftsSource.slice(blockStart,blockEnd);

function harness(options={}){
  const calls=[];
  const context={console,Date,JSON,Array,Object,Promise,Error,String,Number,Math,Boolean,setTimeout,clearTimeout,
    settings:{syncHmacSecret:options.secret===undefined?'h'.repeat(32):options.secret},
    getScriptUrl:()=>options.scriptUrl===undefined?'https://example.test/exec':options.scriptUrl,
    navigator:{onLine:options.onLine===undefined?true:options.onLine},
    syncEngine:{transport:{getEntityState:async(entity,id)=>{calls.push([entity,id]);return options.response||{ok:true,result:{status:'ok',state:{revision:0}}};}}}};
  vm.createContext(context);vm.runInContext(block,context);
  return {context,calls};
}
const serverError={ok:false,result:{status:'error',code:'SERVER_ERROR'}};
const busy={ok:false,result:{status:'error',code:'BUSY'}};
const network={ok:false,result:{status:'error',code:'NETWORK'}};
const authFailed={ok:false,result:{status:'error',code:'AUTH_FAILED'}};

(async()=>{
  const healthy=harness();
  assert.equal((await healthy.context.probeShiftsSyncConfig()).status,'ok','healthy shift configuration is detected');
  assert.deepEqual(healthy.calls,[['shift','mt-shifts-config-probe']],'probe uses the read-only getEntityState for a synthetic shift id');
  await healthy.context.probeShiftsSyncConfig();
  assert.equal(healthy.calls.length,1,'a fresh probe result is reused (no request storm)');
  await healthy.context.probeShiftsSyncConfig({force:true});
  assert.equal(healthy.calls.length,2,'forced probe re-checks the server');

  // SERVER_ERROR — обычный серверный сбой, а не доказательство отсутствия
  // таблицы смен: по текущему контракту Code.gs так выглядит любой сбой
  // (квота, таймаут, ошибка отчёта «Зміни», недоступная таблица).
  const serverErrorProbe=harness({response:serverError});
  assert.equal((await serverErrorProbe.context.probeShiftsSyncConfig()).status,'server','SERVER_ERROR stays a generic server error and is never labelled as a config problem');
  assert.match(serverErrorProbe.context.shiftsSyncConfigUserMessage('server'),/Сервер не зміг обробити зміни/,'neutral server message is shown to the master');
  assert.doesNotMatch(serverErrorProbe.context.shiftsSyncConfigUserMessage('server'),/MT_SHIFTS_SPREADSHEET_ID/,'neutral message does not name the server property');
  assert.doesNotMatch(serverErrorProbe.context.shiftsSyncConfigUserMessage('server'),/не налаштован/i,'neutral message does not blame configuration');

  const serverDown=harness({response:busy});
  assert.equal((await serverDown.context.probeShiftsSyncConfig()).status,'server','server-side failure stays a server status');
  const offlineServer=harness({response:network});
  assert.equal((await offlineServer.context.probeShiftsSyncConfig()).status,'network','temporary network failure is classified separately');
  const badAuth=harness({response:authFailed});
  assert.equal((await badAuth.context.probeShiftsSyncConfig()).status,'auth','rejected HMAC signature is classified separately');

  const offline=harness({onLine:false});
  assert.equal((await offline.context.probeShiftsSyncConfig()).status,'offline','offline probe makes no request');
  assert.equal(offline.calls.length,0,'no network call while offline');
  const notConfigured=harness({secret:''});
  assert.equal((await notConfigured.context.probeShiftsSyncConfig()).status,'unavailable','missing HMAC secret disables the probe');
  assert.equal(notConfigured.calls.length,0,'no network call without credentials');
  const noTransport=harness();
  noTransport.context.syncEngine=null;
  assert.equal((await noTransport.context.probeShiftsSyncConfig()).status,'unavailable','probe needs the sync transport');

  // Автоматический retry не выключается: явного серверного кода «нет таблицы
  // смен» не существует, поэтому ни один ответ сервера не может его отключить.
  const afterServerError=harness({response:serverError});
  await afterServerError.context.probeShiftsSyncConfig({force:true});
  assert.equal(afterServerError.context.shiftsSyncAutoRetryBlocked([{entity:'shift'}]),false,'SERVER_ERROR never suspends automatic shift retry');
  assert.equal(afterServerError.context.shiftsSyncAutoRetryBlocked([{entity:'shift'},{entity:'ticket'}]),false,'mixed queue keeps the retry loop alive');
  assert.equal(afterServerError.context.shiftsSyncAutoRetryBlocked([]),false,'empty queue never blocks retries');
  const temporary=harness({response:network});
  await temporary.context.probeShiftsSyncConfig({force:true});
  assert.equal(temporary.context.shiftsSyncAutoRetryBlocked([{entity:'shift'}]),false,'temporary network failure keeps automatic retries');
  for(const status of ['auth','server','network','offline']) assert.ok(afterServerError.context.shiftsSyncConfigUserMessage(status).length>0,`user message exists for ${status}`);
  assert.equal(afterServerError.context.shiftsSyncConfigUserMessage('config'),'','no config verdict is produced without an explicit server code');
  assert.doesNotMatch(block,/mtShiftsSyncProbeResult\('config'/,'probe never produces a config verdict');

  // Статическая проводка: движок уважает retryPolicy, app.js его передаёт, баннер объясняет причину.
  assert.match(engineSource,/retryPolicy=typeof options\.retryPolicy==='function'\?options\.retryPolicy:null/,'engine stores the optional retry policy');
  assert.match(engineSource,/if\(this\.retryPolicy&&!this\.retryPolicy\(pending\)\)\{this\.onChange\(this\.pendingCount\(\)\);return;\}/,'engine consults the policy before scheduling a retry');
  assert.match(appSource,/retryPolicy:\(pending\)=>!\(typeof shiftsSyncAutoRetryBlocked/,'app.js wires the shift retry policy');
  assert.doesNotMatch(ticketsSource,/mtShiftsSyncProbe\.status==='config'/,'sync banner no longer claims a shift configuration problem');
  assert.match(ticketsSource,/shifts-config-probe-ui/,'probe failure inside retrySyncQueue is caught');
  assert.match(ticketsSource,/probeShiftsSyncConfig\(\{force:true\}\)/,'manual retry runs the read-only probe');

  // Движок: политика false — таймер не ставится, очередь сохраняется; политика true — прежний backoff.
  const core=require(path.join(root,'js','sync-engine-core.js'));
  const {Engine}=require(path.join(root,'js','sync-engine-runtime.js'));
  const payload=id=>({id,date:'01.09.2026',hours:8,coworker:'Сам'});
  const storage=()=>{let value={records:{}};return{load:async()=>JSON.parse(JSON.stringify(value)),save:async next=>{value=JSON.parse(JSON.stringify(next));}};};
  const runEngine=async retryPolicy=>{
    const timers=[];
    const engine=new Engine({core,storage:storage(),payload:(_entity,item)=>item,online:()=>true,retryDelays:[2000],
      setTimeout:(fn,delay)=>{const timer={id:timers.length+1,fn,delay,cancelled:false};timers.push(timer);return timer.id;},
      clearTimeout:id=>{const timer=timers.find(item=>item.id===id);if(timer)timer.cancelled=true;},
      retryPolicy,transport:{send:async()=>({ok:false,result:{status:'error',code:'SERVER_ERROR'}})}});
    await engine.init();
    await engine.recordDiff('shift',[],[payload('s1')]);
    await engine.flush();
    await new Promise(resolve=>setImmediate(resolve));
    return{timers:timers.filter(timer=>!timer.cancelled),pending:engine.pendingCount()};
  };
  const hookOff=await runEngine(()=>false);
  assert.equal(hookOff.timers.length,0,'engine hook can suspend retries if a future explicit server signal ever asks for it');
  assert.ok(hookOff.pending>0,'pending work is preserved while the hook is off');
  const hookOn=await runEngine(()=>true);
  assert.equal(hookOn.timers.length,1,'engine schedules the 2s backoff when the hook allows retry');
  assert.equal(hookOn.timers[0].delay,2000,'backoff schedule is unchanged for tickets and shifts');

  // Интеграция: политика ровно такая, как в app.js, с настоящей функцией
  // диагностики. После SERVER_ERROR автоматический retry смен ОБЯЗАН остаться.
  const productionPolicy=pending=>!(typeof afterServerError.context.shiftsSyncAutoRetryBlocked==='function' && afterServerError.context.shiftsSyncAutoRetryBlocked(pending));
  const withProductionPolicy=await runEngine(productionPolicy);
  assert.equal(withProductionPolicy.timers.length,1,'production policy keeps the automatic shift retry after SERVER_ERROR');
  assert.equal(withProductionPolicy.timers[0].delay,2000,'production retry delay is unchanged');

  console.log('PASS shift sync probe stays read-only, reports a generic server error and never disables automatic retry');
})().catch(error=>{console.error(error);process.exitCode=1;});
