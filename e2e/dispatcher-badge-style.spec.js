'use strict';
const {test,expect,gotoApp}=require('./app-test');

test('dispatcher badge reuses existing colors and typography through live state changes',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  const styles=await page.evaluate(()=>{
    // DOM-only presentation fixture: no ticket save, queue or network mutation.
    const host=document.createElement('div');host.className='ticket-card';
    host.innerHTML='<div class="tc-status-row"><span class="tc-sync-badge tc-sync-ok">Таблиця ✅</span><span class="tc-sync-badge tc-sync-pending">Таблиця ⏳</span><span class="tc-sync-badge btn-danger">Таблиця ❌</span><span class="tc-sync-badge" data-delivery-state="sent">Таблиця Д ✅</span></div>';
    document.body.appendChild(host);
    const nodes=host.querySelectorAll('.tc-sync-badge'),dispatcher=nodes[3];
    const snapshot=node=>{const s=getComputedStyle(node);return Object.fromEntries(['color','backgroundColor','borderRadius','paddingTop','paddingRight','paddingBottom','paddingLeft','fontFamily','fontSize','fontWeight','lineHeight','verticalAlign'].map(k=>[k,s[k]]));};
    const result=['sent','pending','error'].map((state,i)=>{dispatcher.dataset.deliveryState=state;return {state,existing:snapshot(nodes[i]),dispatcher:snapshot(dispatcher)};});
    host.remove();return result;
  });
  for(const item of styles)expect(item.dispatcher,item.state).toEqual(item.existing);
  expect(errors).toEqual([]);
});
