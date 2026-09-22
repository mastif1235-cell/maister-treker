'use strict';
/* v91.66: логіка Пінгу на фейковому fetch (повністю офлайн-тест).
   Ключові контракти:
   - приватна ціль НІКОЛИ не досягає зовнішнього сервісу;
   - публічна ціль не перевіряється локально;
   - відповідь зонду нормалізується лише з реальних полів API;
   - частковий відмов зондів, таймаут, rate limit, недоступність і abort
     повертають людські помилки без вигаданих значень. */
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

function newContext(extra={}){
  const context=Object.assign({console:{log(){},warn(){},error(){}},URL,AbortController,setTimeout,clearTimeout,Date},extra);
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(read('js/tools-network-utils.js'),context,{filename:'tools-network-utils.js'});
  vm.runInContext(read('js/tools-ping.js'),context,{filename:'tools-ping.js'});
  return context;
}

/* Фейковий fetch: маршрутизація за префіксом URL + журнал викликів. */
function fakeFetch(handlers){
  const calls=[];
  const fn=async(url,init)=>{
    calls.push({url:String(url),init:init||{}});
    for(const [match,handler] of handlers){
      if(String(url).includes(match))return handler(url,init,signals=>signals);
    }
    throw new Error('unexpected fetch '+url);
  };
  fn.calls=calls;
  return fn;
}
const GP='api.globalping.org';
const jsonBody=obj=>({ok:true,status:200,json:async()=>obj});

const DONE_MEASUREMENT={status:'done',results:[
  {probe:{country:'UA',city:'Kyiv',network:'Kyivstar'},result:{status:'done',stats:{min:17,avg:18,max:20,loss:0}}},
  {probe:{country:'PL',city:'Warsaw',network:'Orange'},result:{status:'done',stats:{min:29,avg:31,max:35,loss:0}}},
  {probe:{country:'DE',city:'Berlin',network:'Telekom'},result:{status:'done',stats:{min:40,avg:42,max:44,loss:0}}}
]};

(async()=>{
  /* 1. Успіх: три зонди, нормалізовані рядки + зведення */
  {
    const context=newContext({fetch:fakeFetch([
      [GP,async(url,init)=>{
        if(String(url).endsWith('/measurements')&&init&&init.method==='POST')return jsonBody({id:'m1'});
        return jsonBody(DONE_MEASUREMENT);
      }]
    ])});
    const result=await context.MTPing.run('1.1.1.1',{});
    assert.equal(result.ok,true);
    assert.equal(result.rows.length,3);
    assert.deepEqual([...result.rows.map(row=>row.label)],['Україна','Польща','Німеччина'],'labels are real probe countries (vm-realm values are spread into the test realm)');
    assert.equal(result.rows[0].avgMs,18);
    assert.equal(result.rows[0].lossPct,0);
    assert.equal(result.summary.minMs,17);
    assert.equal(result.summary.avgMs,30,'(18+31+42)/3 = 30.33 → 30');
    assert.equal(result.summary.maxMs,44);
    assert.equal(result.summary.lossPct,0);
    const post=context.fetch.calls.find(call=>call.init.method==='POST');
    const payload=JSON.parse(post.init.body);
    assert.deepEqual([...payload.locations.map(loc=>loc.country)],['UA','PL','DE'],'UA first, then nearby Europe');
    assert.equal(payload.measurementOptions.packets,3);
    assert.ok(!JSON.stringify(payload).includes('limit":50'),'few probes only');
  }

  /* 2. Частковий відмова: failed-зонд не вигадує значень, зведення з двох */
  {
    const partial=JSON.parse(JSON.stringify(DONE_MEASUREMENT));
    partial.results[2].result={status:'failed',error:'probe timeout'};
    const context=newContext({fetch:fakeFetch([[GP,async(url,init)=>String(url).endsWith('/measurements')&&init.method==='POST'?jsonBody({id:'m2'}):jsonBody(partial)]])});
    const result=await context.MTPing.run('1.1.1.1',{});
    assert.equal(result.ok,true);
    assert.equal(result.rows[2].failed,true);
    assert.equal(result.summary.avgMs,25,'only two real probes: (18+31)/2');
    assert.equal(result.summary.maxMs,35);
  }

  /* 3. Немає зондів у UA/PL/DE → fallback на світові */
  {
    const context=newContext({fetch:fakeFetch([
      [GP,async(url,init)=>{
        if(init&&init.method==='POST'){
          const payload=JSON.parse(init.body);
          if(payload.locations)return {ok:false,status:400,json:async()=>({error:{message:'no probes match'}})};
          return jsonBody({id:'m3'});
        }
        return jsonBody(DONE_MEASUREMENT);
      }]
    ])});
    const result=await context.MTPing.run('1.1.1.1',{});
    assert.equal(result.ok,true);
    const posts=context.fetch.calls.filter(call=>call.init.method==='POST');
    assert.equal(posts.length,2,'exactly one fallback retry');
    assert.equal(JSON.parse(posts[1].init.body).locations,undefined,'fallback is worldwide');
  }

  /* 4. Rate limit / недоступність / мережева помилка */
  {
    const limited=newContext({fetch:fakeFetch([[GP,async()=>({ok:false,status:429,json:async()=>({})})]])});
    const limitedResult=await limited.MTPing.run('1.1.1.1',{});
    assert.equal(limitedResult.ok,false);
    assert.match(limitedResult.error,/Занадто багато перевірок/);
    const down=newContext({fetch:fakeFetch([[GP,async()=>({ok:false,status:503,json:async()=>null})]])});
    const downResult=await down.MTPing.run('1.1.1.1',{});
    assert.equal(downResult.ok,false);
    assert.match(downResult.error,/не вдалося розпочати/i);
    const offline=newContext({fetch:fakeFetch([[GP,async()=>{throw new Error('getaddrinfo ENOTFOUND');}]])});
    const offlineResult=await offline.MTPing.run('1.1.1.1',{});
    assert.equal(offlineResult.ok,false);
    assert.match(offlineResult.error,/Сервіс зовнішньої перевірки недоступний/);
    assert.match(offlineResult.detail,/ENOTFOUND/,'technical detail kept for «Деталі»');
  }

  /* 5. Приватна ціль: НІКОЛИ не до зовнішнього сервісу; локальна перевірка з телефону */
  {
    const context=newContext({fetch:fakeFetch([
      [GP,async()=>{throw new Error('GLOBALPING MUST NOT BE CALLED FOR A PRIVATE TARGET');}],
      ['http://192.168.1.1/',async()=>({ok:true,status:200,json:async()=>''})]
    ])});
    const result=await context.MTPing.run('192.168.1.1',{});
    assert.equal(result.ok,true);
    assert.equal(result.kind,'local');
    assert.ok(Number.isFinite(result.ms)&&result.ms>=0,'honest measured ms');
    assert.equal(context.fetch.calls.filter(call=>call.url.includes(GP)).length,0,'zero external calls');
    assert.equal(context.fetch.calls[0].url,'http://192.168.1.1/','direct device probe only');
  }

  /* 5b. Порт із вводу доходить до локального запиту (роутер з адмінкою на :8080) */
  {
    const context=newContext({fetch:fakeFetch([
      [GP,async()=>{throw new Error('GLOBALPING MUST NOT SEE A PRIVATE TARGET');}],
      ['http://192.168.1.1:8080/',async()=>({ok:true,status:200,json:async()=>''})]
    ])});
    const result=await context.MTPing.run('192.168.1.1:8080',{});
    assert.equal(result.ok,true);
    assert.equal(context.fetch.calls[0].url,'http://192.168.1.1:8080/','port is kept for the local device probe');
  }

  /* 6. Публічна ціль не перевіряється локально */
  {
    const context=newContext({fetch:fakeFetch([
      [GP,async(url,init)=>String(url).endsWith('/measurements')&&init.method==='POST'?jsonBody({id:'m4'}):jsonBody(DONE_MEASUREMENT)],
      ['http://',async()=>{throw new Error('LOCAL CHECK MUST NOT RUN FOR A PUBLIC TARGET');}]
    ])});
    const result=await context.MTPing.run('8.8.8.8',{});
    assert.equal(result.ok,true);
    assert.equal(result.kind,undefined);
  }

  /* 7. Небезпечне значення відхиляється до будь-якого fetch */
  {
    const context=newContext({fetch:fakeFetch([['',async()=>{throw new Error('NO FETCH MAY HAPPEN');}]])});
    const result=await context.MTPing.run('javascript:alert(1)',{});
    assert.equal(result.ok,false);
    assert.equal(result.invalid,true);
    assert.match(result.error,/не можна/);
    assert.equal(context.fetch.calls.length,0,'zero network calls for a banned scheme');
  }

  /* 8. Локальний таймаут → людське повідомлення (внутрішній таймер, без зовнішнього abort) */
  {
    const context=newContext({});
    context.fetch=async(url,init)=>new Promise((_resolve,reject)=>{if(init&&init.signal)init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));});
    const result=await context.MTPing.runLocal('192.168.1.1',{fetch:context.fetch,timeoutMs:300});
    assert.equal(result.ok,false);
    assert.match(result.error,/Пристрій не відповів/);
  }

  /* 9. Abort зовнішньої перевірки */
  {
    const context=newContext({});
    context.fetch=async(url,init)=>new Promise((_resolve,reject)=>{if(init&&init.signal)init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));});
    const controller=new AbortController();
    const pending=context.MTPing.runExternal('1.1.1.1',{fetch:context.fetch,signal:controller.signal});
    setTimeout(()=>controller.abort(),30);
    const result=await pending;
    assert.equal(result.ok,false);
    assert.equal(result.cancelled,true);
  }

  /* 10. Валідація всередині run: некоректна ціль → invalid, без fetch */
  {
    const context=newContext({fetch:fakeFetch([['',async()=>{throw new Error('NO FETCH');}]])});
    const result=await context.MTPing.run('not a host!',{});
    assert.equal(result.invalid,true);
    assert.equal(context.fetch.calls.length,0);
  }

  console.log('PASS network tools ping: external normalization/summary real-only, partial probes, fallback locations, rate limit, unavailability, private targets never leave the phone, local timeout and abort are human-readable');
})().catch(error=>{console.error('FAIL:',error);process.exit(1);});
