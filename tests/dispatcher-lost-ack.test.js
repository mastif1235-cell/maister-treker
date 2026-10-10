'use strict';
/* v91.94 / runtime-139. Lost-ACK / reconciliation регресії (фізичний Android-гейт):
   8) мутація ДІЙШЛА сервера, ACK загублено → reconnect/отримання квитанції
      підтверджує операцію (sent) БЕЗ повторної мутації (жодного дубля);
   9) мутація дійшла сервера, ACK загублено, reconnect НЕ підтверджує квитанцію →
      операція лишається pending і НІКОЛИ не втрачається;
   плюс: late/replay відповідь звільняє рівно ті версії, що були в польоті;
   старий ACK ніколи не підтверджує новішу правку; INVALID_REQUEST_ID на
   повторі request_id відкочується на свіжий request_id, а не в permanent error;
   security-піни (source/origin/nonce) у createBridge не ослаблені. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

// Модель поведінки dispatcher GAS v9+ (DispatcherReport.gs): upsert за
// ticket_id + кеш квитанцій REPORT_ACK_<request_id> з перевіркою хешу запиту.
function mockGAS(){
  const rows=new Map(),receipts=new Map(),requests=[];
  let mutations=0;
  function dispatch(request){
    requests.push(request);
    const cached=receipts.get(request.request_id);
    if(cached){
      if(cached.hash!==JSON.stringify(request))return {ok:false,code:'INVALID_REQUEST_ID'};
      return cached.result; // повтор тієї самої заявки — без другої мутації
    }
    let inserted=0,updated=0,deleted=0;
    for(const t of request.tickets||[]){if(rows.has(t.ticket_id))updated++;else inserted++;rows.set(t.ticket_id,t);}
    for(const d of request.deletes||[]){if(rows.delete(d.ticket_id))deleted++;else inserted++;}
    mutations++;
    const result={ok:true,inserted,updated,unchanged:0,deleted,rejected:0,errors:0};
    receipts.set(request.request_id,{hash:JSON.stringify(request),result});
    return result;
  }
  return {dispatch,rows,receipts,requests,mutations:()=>mutations};
}
function harness(server,opts={}){
  const ctx={globalThis:{localStorage:{getItem:()=>null,setItem(){}}},URL,setTimeout,clearTimeout};
  vm.runInNewContext(read('js/dispatcher-telemetry.js'),ctx,{filename:'js/dispatcher-telemetry.js'});
  vm.runInNewContext(read('js/dispatcher-report-client.js'),ctx,{filename:'js/dispatcher-report-client.js'});
  let raw=null,clock=1000,rid=0,sendCount=0;
  const config={dispatcherReportEndpoint:'https://script.google.com/macros/s/test/exec',dispatcherReportEnabled:true};
  const tickets=opts.tickets||[{id:'t-1'}];
  const deps={
    storage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},settings:()=>config,
    tickets:()=>tickets,ticket:id=>tickets.find(t=>t.id===id)||null,
    dto:async(t,v)=>({ticket_id:t.id,source_version:v}),
    now:()=>++clock,requestId:()=>'request-'+(++rid),online:()=>true,
    setTimeout:()=>1,clearTimeout:()=>{},
    send:async(_url,request)=>{
      sendCount++;
      const result=server.dispatch(request); // мутація виконується НА СЕРВЕРІ
      if(opts.failNext&&opts.failNext()){throw new Error('GOOGLE_CONNECTION_REQUIRED');} // ACK втрачено
      return result;
    }
  };
  const q=ctx.globalThis.MTDispatcherReportClient.createOutbox(deps);
  return {q,deps,raw:()=>raw?JSON.parse(raw):null,sends:()=>sendCount,ctx};
}

(async()=>{
  // 8) ACK втрачено ПІСЛЯ успішної мутації → reconnect-повтор з ТИМ САМИМ
  // request_id дістає квитанцію з кешу: sent, черга 0, мутація рівно ОДНА.
  {
    const server=mockGAS();let fail=true;
    const h=harness(server,{failNext:()=>{const f=fail;fail=false;return f;}});
    h.q.enqueueUpsert({id:'t-1'});
    await h.q.flush();
    assert.equal(server.mutations(),1,'mutation reached the server exactly once');
    assert.equal(h.q.status().pending,1,'ACK lost → operation stays pending');
    assert.equal(h.q.delivery('t-1').state,'pending');
    assert.equal(h.raw().inflight.request_id,'request-1','in-flight batch metadata survives the timeout');
    assert.deepEqual(h.raw().inflight.ops,[{id:'t-1',action:'upsert',version:h.raw().operations[0].version}]);
    // reconnect: report_status ACK відновлює канал, flush повторює той самий запит
    h.q.connectionReady();
    await h.q.flush();
    assert.equal(server.mutations(),1,'idempotent replay: NO duplicate mutation on retry');
    assert.equal(server.requests.length,2);
    assert.equal(server.requests[0].request_id,server.requests[1].request_id,'retry REUSES the original request_id');
    assert.equal(server.requests[0].rebuild,server.requests[1].rebuild,'replayed request is byte-identical (rebuild preserved)');
    assert.equal(h.q.delivery('t-1').state,'sent','confirmed receipt marks the operation sent');
    assert.equal(h.q.status().pending,0);
    assert.equal(h.q.status().unresolved,0);
    assert.equal(h.raw().inflight,null,'in-flight record clears on completion');
    assert.equal(server.rows.size,1);
  }
  // 8b) late/replay відповідь (Bridge.html HELLO replay) знімає pending БЕЗ
  // жодної повторної відправки.
  {
    const server=mockGAS();let fail=true;
    const h=harness(server,{failNext:()=>{const f=fail;fail=false;return f;}});
    h.q.enqueueUpsert({id:'t-1'});
    await h.q.flush();
    assert.equal(server.mutations(),1);
    const request=server.requests[0],replay=server.receipts.get(request.request_id).result;
    assert.equal(h.sends(),1);
    assert.equal(h.q.reconcile(request,replay),true,'late ACK reconciles the in-flight batch');
    assert.equal(h.q.delivery('t-1').state,'sent');
    assert.equal(h.q.status().unresolved,0);
    assert.equal(h.sends(),1,'reconciliation needs NO resend');
    assert.equal(server.mutations(),1,'no mutation was repeated');
  }
  // 9) підтвердження НЕМАЄ (чужий/невідомий request_id, повторний розрив) →
  // операція лишається pending, не падає в failed і не втрачається.
  {
    const server=mockGAS();let fail=true,fail2=true;
    const h=harness(server,{failNext:()=>fail?!(fail=false):(fail2?!(fail2=false):false)});
    h.q.enqueueUpsert({id:'t-1'});
    await h.q.flush(); // мутація на сервері, ACK втрачено
    assert.equal(server.mutations(),1);
    assert.equal(h.q.reconcile({request_id:'foreign-request'},{ok:true,inserted:1,updated:0,unchanged:0,deleted:0,rejected:0,errors:0}),false,'foreign request_id never confirms anything');
    assert.equal(h.q.status().pending,1,'unconfirmed operation stays pending');
    assert.equal(h.q.status().failed,0,'and is never marked failed');
    h.q.connectionReady();
    await h.q.flush(); // знову розрив: ACK знову втрачено
    assert.equal(h.q.status().pending,1,'second lost ACK still keeps the operation');
    assert.equal(h.q.status().failed,0);
    assert.equal(h.raw().operations[0].id,'t-1','operation is still in the outbox (never lost)');
    assert.equal(h.raw().operations[0].attempts,0,'connection losses burn no attempts');
    // фінальне підтвердження приходить — і ТІЛЬКИ тоді черга зменшується
    h.q.connectionReady();
    await h.q.flush();
    assert.equal(server.mutations(),1,'confirmed by the receipt cache — no third mutation');
    assert.equal(h.q.delivery('t-1').state,'sent');
    assert.equal(h.q.status().unresolved,0);
  }
  // Старий ACK ніколи не підтверджує новішу правку (reconcile-варіант).
  {
    const server=mockGAS();let fail=true;
    const h=harness(server,{tickets:[{id:'t-1'}],failNext:()=>{const f=fail;fail=false;return f;}});
    h.q.enqueueUpsert({id:'t-1'});
    await h.q.flush(); // v1 у польоті
    const oldVersion=h.raw().operations[0].version;
    h.q.enqueueUpsert({id:'t-1'}); // v2: користувач відредагував заявку
    assert.equal(h.q.reconcile(server.requests[0],server.receipts.get('request-1').result),false,'old ACK must not confirm a newer edit');
    assert.equal(h.q.delivery('t-1').state,'pending','newer edit stays pending');
    assert.equal(h.raw().operations[0].version>oldVersion,true);
  }
  // INVALID_REQUEST_ID на повторі → свіжий request_id, не permanent error.
  {
    const server=mockGAS();let fail=true;
    const h=harness(server,{failNext:()=>{const f=fail;fail=false;return f;}});
    h.q.enqueueUpsert({id:'t-1'});
    await h.q.flush();
    server.receipts.get('request-1').hash='tampered'; // сервер «не впізнає» повтор
    h.q.connectionReady();
    await h.q.flush();
    assert.equal(server.requests.length,3,'mismatched replay falls back to one fresh request');
    assert.equal(server.requests[2].request_id,'request-2');
    assert.equal(h.q.delivery('t-1').state,'sent','fallback succeeds without a permanent error');
    assert.equal(h.q.status().failed,0);
    assert.equal(h.q.status().unresolved,0);
  }
  // Безпека: піни source/origin/nonce у createBridge не ослаблені.
  {
    const source=read('js/dispatcher-report-client.js');
    assert.ok(source.includes('if(e.source!==peer||e.origin!==peerOrigin)return;'),'source+origin pinning intact');
    assert.ok(source.includes('d.channel!==channel'),'channel nonce pinning intact');
    // v91.94: BOOT and READY share one validated binding path (safe auto-resume);
    // the invariants are stronger than the old BOOT-only pin.
    assert.ok(source.includes("if(!peer){peer=e.source;peerOrigin=e.origin;rememberPeerOrigin();}"),'peer binds exactly once on the first valid hello');
    assert.ok(source.includes('else if(e.source!==peer)return;'),'peer never re-binds to another source');
    assert.ok(source.includes('e.source?.top!==popup'),'peer must be this bridge popup window');
    assert.ok(source.includes("o.hostname==='script.google.com'||o.hostname.endsWith('.googleusercontent.com')"),'google host whitelist intact');
    assert.ok(!/addEventListener\('pagehide',/.test(source),'no Android app-switch connection reset');
    assert.ok(source.includes('function createBridge(){'),'bridge boundary marker stable for the slice test');
    assert.ok(source.includes('root.MTDispatcherReportClient='),'bridge boundary marker stable for the slice test');
  }
  console.log('PASS lost-ACK: idempotent replay (no duplicate mutation), late/replayed receipt reconciliation, unconfirmed ops stay pending and are never lost, stale ACK cannot confirm newer edits, INVALID_REQUEST_ID falls back safely, security pins intact');
})().catch(e=>{console.error(e);process.exitCode=1;});
