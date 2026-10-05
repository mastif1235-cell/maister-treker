'use strict';
const {test,expect,gotoApp}=require('./app-test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('D2/D4: actual browser reload keeps two periods and repairs; no provider',async({page,appEnv})=>{
 const load=p=>import(pathToFileURL(path.join(__dirname,'../mcp/src',p)).href);
 const {createAskOrchestrator}=await load('ask/orchestrator.js'),{runSmartQuery}=await load('ask/smart-query.js'),{TOOL_DEFINITIONS}=await load('tools/definitions.js');
 const tickets=[];
 for(const [month,c,r]of [[9,13,7],[8,15,12]])for(const [type,n]of [['Підключення',c],['Ремонт',r]])for(let i=0;i<n;i++)tickets.push({id:`SYN_${month}_${type}_${i}`,date:`15.0${month}.2026`,type,connectMasters:['Женя'],tags:[],equipment:type==='Ремонт'?[{label:'ONU',qty:1}]:[],macAddress:type==='Підключення'?'001122334455':'',cables:[]});
 const queries=[],requests=[],now=new Date('2026-10-04T12:00:00Z');
 const orch=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw Error('No provider for eligible D2/D4')}},tools:{query_tickets:async p=>{queries.push(p);return runSmartQuery({tickets,shifts:[],searchIndex:[]},p)}}});
 await page.route('https://maister-tracker-mcp.mastif1235.workers.dev/ask',async route=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=route.request().postDataJSON();requests.push(body);const result=await orch.handle(body.question,{now,coworkerRoster:['Женя'],...body.context});
  await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({...result,ai_contract_version:1})});
 });
 await gotoApp(page,appEnv.url);
 await page.evaluate(async()=>{MTAI.storage.update({enabled:true,showInTools:true,backendMode:'custom',backendUrl:MTAI.config.SHARED_BACKEND});MTAI.storage.setToken('synthetic-only');await mtSettingsSecretsFlushPending();MTAI.ui.open()});
 const send=async q=>{await page.locator('#aiInput').fill(q);await page.locator('#aiSendBtn').click();await expect(page.locator('#aiSendBtn')).toBeEnabled()};
 await send('Сколько ONU я поставил с Женей за сентябрь?');await expect(page.locator('.ai-msg-assistant').last()).toContainText('20 ONU');
 await send('Сравни сентябрь и август');await expect(page.locator('.ai-msg-assistant').last()).toContainText('20 ONU');await expect(page.locator('.ai-msg-assistant').last()).toContainText('27 ONU');expect(queries).toHaveLength(3);
 await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);await page.evaluate(()=>MTAI.ui.open());
 await send('А только ремонты?');await expect(page.locator('.ai-msg-assistant').last()).toContainText('7 ONU');await expect(page.locator('.ai-msg-assistant').last()).toContainText('12 ONU');
 expect(queries).toHaveLength(5);expect(requests[2].context.queryContext.comparison.periods).toHaveLength(2);expect(queries.slice(3).every(p=>p.mode==='count'&&p.type==='Ремонт'&&p.coworker==='Женя')).toBe(true);
 await expect(page.locator('.ai-msg-assistant').last()).not.toContainText('001122334455');
});
