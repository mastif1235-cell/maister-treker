'use strict';
const {test,expect,gotoApp}=require('./app-test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('coworker-only transitions preserve September/count before and after browser reload',async({page,appEnv})=>{
 const load=p=>import(pathToFileURL(path.join(__dirname,'../mcp/src/ask',p)).href);
 const {createAskOrchestrator}=await load('orchestrator.js'),{runSmartQuery}=await load('smart-query.js');
 const {TOOL_DEFINITIONS}=await import(pathToFileURL(path.join(__dirname,'../mcp/src/tools/definitions.js')).href);
 const tickets=[];
 for(const [name,month,n] of [['Женя',9,20],['Петя',9,8],['Женя',8,27]])for(let i=0;i<n;i++)tickets.push({
  id:`SYNTHETIC_${name}_${month}_${i}`,date:`15.0${month}.2026`,type:'Ремонт',equipment:[{label:'ONU',qty:1}],
  cables:[],connectMasters:i%2?[name]:[],tags:i%2?[]:[name],note:''});
 const queries=[],requests=[],now=new Date('2026-10-04T12:00:00Z');
 const orch=createAskOrchestrator({toolDefs:TOOL_DEFINITIONS,groq:{chat(){throw Error('No LLM for coworker transition');}},
  tools:{query_tickets:async p=>{queries.push(p);return runSmartQuery({tickets,shifts:[],searchIndex:[]},p);}}});
 await page.route('https://maister-tracker-mcp.mastif1235.workers.dev/ask',async route=>{
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=route.request().postDataJSON();requests.push(body);
  const result=await orch.handle(body.question,{now,coworkerRoster:['Артем','Петя','Женя','Паша'],...body.context});
  await route.fulfill({status:200,contentType:'application/json',headers,body:JSON.stringify({...result,ai_contract_version:1})});
 });
 await gotoApp(page,appEnv.url);
 await page.evaluate(async()=>{settings.masters=['Артем','Петя','Женя','Паша'];await saveSettings();
  MTAI.storage.update({enabled:true,showInTools:true,backendMode:'custom',backendUrl:MTAI.config.SHARED_BACKEND});
  MTAI.storage.setToken('synthetic-ai-test');await mtSettingsSecretsFlushPending();MTAI.ui.open();});
 const send=async q=>{await page.locator('#aiInput').fill(q);await page.locator('#aiSendBtn').click();await expect(page.locator('#aiSendBtn')).toBeEnabled();};
 const reload=async()=>{await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);await page.evaluate(()=>MTAI.ui.open());};
 await send('Сколько ONU я поставил с Женей за сентябрь?');await expect(page.locator('.ai-msg-assistant').last()).toContainText('20 ONU');
 await reload();await send('А без Жени?');await expect(page.locator('.ai-msg-assistant').last()).toContainText('8 ONU');
 expect(queries[1].coworker_exclude).toBe('Женя');expect(queries[1].coworker).toBeUndefined();
 await reload();await send('А в августе?');await expect(page.locator('.ai-msg-assistant').last()).toContainText('0 ONU');
 expect(requests[2].context.queryContext.resolved_filters.coworker_exclude).toBe('Женя');expect(queries[2].coworker_exclude).toBe('Женя');
 await send('А в сентябре?');await send('А со всеми?');await expect(page.locator('.ai-msg-assistant').last()).toContainText('28 ONU');
 expect(queries).toHaveLength(5);expect(requests).toHaveLength(5);
 for(const q of queries){expect(q.mode).toBe('count');expect(q.semantic.profile).toBe('onu_physical');expect(q.date_from).toBeDefined();expect(q.date_to).toBeDefined();}
 expect(queries[4].coworker_exclude).toBeUndefined();expect(queries[4].coworker).toBeUndefined();expect(queries[4].date_from).toBe('01.09.2026');
});
