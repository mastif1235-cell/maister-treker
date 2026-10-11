'use strict';
const {test,expect,gotoApp}=require('./app-test');

test('explicit orphan recovery reads exact hash proof and leaves stale/history untouched',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  const result=await page.evaluate(async()=>{
    let raw=null;const requests=[],hash='a'.repeat(64),url='https://script.google.com/macros/s/synthetic/exec';
    const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v},settings:()=>({dispatcherReportEndpoint:url,dispatcherReportEnabled:false}),ticket:id=>({id}),tickets:()=>[],dto:async(t,v)=>({ticket_id:t.id,source_version:v,source_hash:hash}),requestId:()=>'browser-proof-request',setTimeout:()=>1,clearTimeout:()=>{},send:async(_u,r)=>{requests.push(r);return {ok:true,code:'OK',...r.proof,sync_status:'SYNCED'};}};
    raw=JSON.stringify({endpoint:url,operations:[{id:'synthetic-orphan',action:'upsert',version:1000,attempts:3,error:'REPORT_INTERNAL_ERROR'},{id:'synthetic-stale',action:'upsert',version:1000,attempts:1,error:'STALE_VERSION'},{id:'synthetic-history',action:'upsert',version:1,attempts:0,error:'INVALID_DTO'}]});
    const q=MTDispatcherReportClient.createOutbox(deps),ok=await q.reconcileStored('synthetic-orphan');
    return {ok,requests,stored:JSON.parse(raw),sent:q.delivery('synthetic-orphan').state,stale:q.delivery('synthetic-stale').code,history:q.delivery('synthetic-history').code};
  });
  expect(result.ok).toBe(true);expect(result.sent).toBe('sent');expect(result.stale).toBe('STALE_VERSION');expect(result.history).toBe('INVALID_DTO');
  expect(result.requests).toHaveLength(1);expect(result.requests[0].action).toBe('report_receipt');expect(result.requests[0].proof.source_hash).toBe('a'.repeat(64));
  expect(result.stored.operations.map(o=>o.id)).toEqual(['synthetic-stale','synthetic-history']);expect(errors).toEqual([]);
});
