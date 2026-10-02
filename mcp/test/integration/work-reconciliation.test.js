import test from 'node:test';
import assert from 'node:assert/strict';
import {makeApp,mockGasFetch,rpc,toolCall,toolData} from '../helpers/mcpapp.js';
import {assertNoForbidden} from '../../src/gas/mappers.js';

test('raw MCP schema/call accepts opt-in physical profile after GAS JSON projection; READ-only transport',async()=>{
 const row={id:'SYNTHETIC',date:'15.09.2026',time:'10:00',sum:100,tags:['Петя'],fullDataJson:JSON.stringify({type:'Підключення',macAddress:'001122334455',connectMasters:[{name:'Петя',letter:'П'}]})};
 const fetch=mockGasFetch('ok',{status:'ok',tickets:[row],shifts:[],states:{ticket:[],shift:[]}});
 const app=await makeApp(null,fetch);
 const defs=await (await rpc(app,'tools/list',{})).json();
 const schema=defs.result.tools.find(t=>t.name==='query_tickets').inputSchema.properties.semantic.properties;
 assert.deepEqual(schema.profile.enum,['work_v2','onu_physical']);
 const result=await toolCall(app,'query_tickets',{mode:'list',coworker:'Петей',semantic:{entity:'onu',action:'install',profile:'onu_physical'}});
 assert.equal(result.response.status,200);assert.ok(result.result&&!result.result.isError);
 const data=toolData(result.result);
 assert.equal(data.matched,1);assert.equal(data.evidence[0].coworker_reason,'direct_ticket');
 assert.equal(data.evidence[0].events[0].reason,'derived_from_connection');
 assert.equal(data.work_totals.onu_breakdown.new_connections,1);
 assert.ok(!JSON.stringify(data.evidence).includes('001122334455'));assertNoForbidden(data);
 assert.ok(fetch.calls.every(c=>c.method==='GET'&&['list','getTicketById'].includes(c.action)));
 const invalid=await toolCall(app,'query_tickets',{semantic:{entity:'router',action:'install',profile:'onu_physical'}});
 assert.ok(invalid.result?.isError||invalid.body.error,'invalid physical profile rejected, not widened');
});
