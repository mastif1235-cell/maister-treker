'use strict';
const {test,expect,gotoApp}=require('./app-test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('Phase 2A: browser reload preserves coworker/all-ONU count; one query per period',async({page,appEnv})=>{
 const load=p=>import(pathToFileURL(path.join(__dirname,'../mcp/src/ask',p)).href);
 const {createAskOrchestrator}=await load('orchestrator.js'),{runSmartQuery}=await load('smart-query.js');
 const {resolvePeriodFollowUp}=await load('period-query-state.js');
 const {TOOL_DEFINITIONS}=await import(pathToFileURL(path.join(__dirname,'../mcp/src/tools/definitions.js')).href);
 const tickets=[];
 for(const [month,connections,repairs] of [[9,13,7],[8,15,12]])for(const [type,n] of [['Підключення',connections],['Ремонт',repairs]]){
  for(let i=0;i<n;i++)tickets.push({id:`SYNTHETIC_${month}_${type}_${i}`,date:`15.0${month}.2026`,type,
   macAddress:type==='Підключення'?'001122334455':'',equipment:type==='Ремонт'?[{label:'ONU',qty:1}]:[],
   cables:[],connectMasters:['Женя'],tags:[],note:''});
 }
 const queries=[],requests=[],paths=[],now=new Date('2026-10-04T12:00:00Z');
 const orch=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw new Error('No LLM for deterministic period-only');}},
  tools:{query_tickets:async p=>{queries.push(p);return runSmartQuery({tickets,shifts:[],searchIndex:[]},p);}}});
 await page.route('https://maister-tracker-mcp.mastif1235.workers.dev/ask',async route=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=route.request().postDataJSON();requests.push(body);
  paths.push(resolvePeriodFollowUp(body.question,now,body.context?.queryContext).path);
  const result=await orch.handle(body.question,{now,coworkerRoster:['Женя'],...body.context});
  await route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({...result,ai_contract_version:1})});
 });
 await page.setViewportSize({width:320,height:740});await gotoApp(page,appEnv.url);
 await page.evaluate(async()=>{MTAI.storage.update({enabled:true,showInTools:true,backendMode:'custom',backendUrl:MTAI.config.SHARED_BACKEND});MTAI.storage.setToken('synthetic-ai-test');await mtSettingsSecretsFlushPending();MTAI.ui.open();});
 const send=async q=>{await page.locator('#aiInput').fill(q);await page.locator('#aiSendBtn').click();await expect(page.locator('#aiSendBtn')).toBeEnabled();};
 await send('Сколько ONU я поставил с Женей за сентябрь?');
 await expect(page.locator('.ai-msg-assistant').last()).toContainText('20 ONU');
 expect(queries).toHaveLength(1);
 await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);await page.evaluate(()=>MTAI.ui.open());
 await send('А в августе?');
 await expect(page.locator('.ai-msg-assistant').last()).toContainText('27 ONU');
 expect(queries).toHaveLength(2);expect(requests).toHaveLength(2);expect(paths[1]).toBe('query_state_period');
 expect(queries[1].coworker).toBe('Женя');expect(queries[1].date_from).toBe('01.08.2026');
 expect(queries[1].date_to).toBe('31.08.2026');expect(queries[1].mode).toBe('count');
 expect(queries[1].type).toBeUndefined();expect(queries[1].semantic).toEqual(queries[0].semantic);
 expect(requests[1].context.queryContext.resolved_filters.coworker).toBe('Женя');
 await expect(page.locator('.ai-msg-assistant').last()).not.toContainText('001122334455');
});
