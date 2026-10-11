'use strict';
const {test,expect,gotoApp}=require('./app-test');

test('explicit orphan recovery reads exact hash proof and leaves stale/history untouched',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  const result=await page.evaluate(async()=>{
    let raw=null;const requests=[],hash='a'.repeat(64),url='https://script.google.com/macros/s/synthetic/exec';
    const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v},settings:()=>({dispatcherReportEndpoint:url,dispatcherReportEnabled:false}),ticket:id=>({id}),tickets:()=>[],dto:async(t,v)=>({ticket_id:t.id,source_version:v,source_hash:hash}),requestId:()=>'browser-proof-request',setTimeout:()=>1,clearTimeout:()=>{},send:async(_u,r)=>{requests.push(r);return {ok:true,code:'OK',...r.proof,sync_status:'SYNCED'};}};
    raw=JSON.stringify({endpoint:url,lastError:'REPORT_INTERNAL_ERROR',operations:[{id:'synthetic-orphan',action:'upsert',version:1000,attempts:3,error:''},{id:'synthetic-stale',action:'upsert',version:1000,attempts:1,error:'STALE_VERSION'},{id:'synthetic-history',action:'upsert',version:1,attempts:0,error:'INVALID_DTO'}]});
    const q=MTDispatcherReportClient.createOutbox(deps),ok=await q.reconcileStored('synthetic-orphan');
    return {ok,requests,stored:JSON.parse(raw),sent:q.delivery('synthetic-orphan').state,stale:q.delivery('synthetic-stale').code,history:q.delivery('synthetic-history').code};
  });
  expect(result.ok).toBe(true);expect(result.sent).toBe('sent');expect(result.stale).toBe('STALE_VERSION');expect(result.history).toBe('INVALID_DTO');
  expect(result.requests).toHaveLength(1);expect(result.requests[0].action).toBe('report_receipt');expect(result.requests[0].proof.source_hash).toBe('a'.repeat(64));
  expect(result.stored.operations.map(o=>o.id)).toEqual(['synthetic-stale','synthetic-history']);expect(errors).toEqual([]);
});

test('orphan strict proof rejects malformed success and preserves neighboring inflight identity',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  const results=await page.evaluate(async()=>{
    const results=[],url='https://script.google.com/macros/s/synthetic/exec';
    for(const ok of ['true','false',1,0,null,true]){
      const orphan={id:'orphan',action:'upsert',version:1000,attempts:3,next:0,error:''},neighbor={id:'neighbor',action:'upsert',version:1001,attempts:1,next:5000,error:'STALE_VERSION'};
      let raw=JSON.stringify({endpoint:url,lastError:'REPORT_INTERNAL_ERROR',operations:[orphan,neighbor],inflight:{action:'report_sync_all',request_id:'browser-lost-ack',rebuild:false,ts:12345,ops:[orphan,neighbor].map(({id,action,version})=>({id,action,version}))}});
      const before=JSON.parse(raw),requests=[];
      const q=MTDispatcherReportClient.createOutbox({storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v},settings:()=>({dispatcherReportEndpoint:url,dispatcherReportEnabled:false}),ticket:id=>({id}),dto:async(t,v)=>({ticket_id:t.id,source_version:v,source_hash:'a'.repeat(64)}),requestId:()=>'browser-proof-id',setTimeout:()=>1,clearTimeout:()=>{},send:async(_u,r)=>{requests.push(r.action);return {ok,code:'OK',...r.proof,sync_status:'SYNCED'};}});
      results.push({value:ok,accepted:await q.reconcileStored('orphan'),before,after:JSON.parse(raw),requests});
    }
    return results;
  });
  for(const result of results){
    expect(result.requests).toEqual(['report_receipt']);expect(result.accepted).toBe(result.value===true);
    if(result.value!==true)expect(result.after).toEqual(result.before);
    else{expect(result.after.operations).toEqual(result.before.operations.slice(1));expect(result.after.inflight).toEqual({...result.before.inflight,ops:result.before.inflight.ops.slice(1)});expect(result.after.receipts).toEqual([{id:'orphan',version:1000}]);}
  }
  expect(errors).toEqual([]);
});
