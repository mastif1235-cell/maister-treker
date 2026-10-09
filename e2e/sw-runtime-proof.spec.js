'use strict';
const {test,expect,gotoApp,waitServiceWorkerCacheReady}=require('./app-test');

test('runtime-136 reports real cached asset hashes and executed UI revisions',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  await waitServiceWorkerCacheReady(page);
  const proof=await page.evaluate(async()=>{
    const runtime=await new Promise((resolve,reject)=>{
      const channel=new MessageChannel(),timer=setTimeout(()=>reject(Error('RUNTIME_STATUS_TIMEOUT')),5000);
      channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};
      navigator.serviceWorker.controller.postMessage({type:'MT_RUNTIME_STATUS'},[channel.port2]);
    });
    const published=await (await fetch('./runtime-proof.json',{cache:'no-store'})).json();
    return {runtime,published,revisions:[MTTicketCompactView.runtimeRevision,MTTicketRendererRevision,MTDispatcherReportClient.runtimeRevision]};
  });
  expect(proof.runtime).toEqual(proof.published);
  expect(Object.keys(proof.runtime.assets)).toHaveLength(8);
  expect(proof.revisions).toEqual(['runtime-136','runtime-136','runtime-136']);
  expect(errors).toEqual([]);
});
