import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runSmartQuery} from '../../src/ask/smart-query.js';

test('legacy non-semantic query_tickets envelopes exactly equal main v91.79 across nine modes/filters',async()=>{
 // Full serialized result digests captured from main a5b52da49aba7cae16164a14cba9c9970ae864a0.
 // No dependency on installed Git/RTK or full Git history in a shallow CI checkout.
 const golden=['631eb84de4ba662c181b5acda2baffee20b0723f2e25662a9e56514586dadbff','52cecf3878521e111c194d41965c360fc288daffbc2a33e59c1aad4354374c28','dc6d9aa0b034e901826eb448453a65ef0ac486284be2f540d98457119cf94405','c2f2bbc85e10d3147925ed6ff86c17b591c30298b1e2361e4a268bcf1df050fa','1d2fb809816c7f64dbc0c41f88a76b810195faae405438c686eac15048a7389f','08118b1ec70c599340cbef4034a39ac61d4bd7d48e05313a9d4abe1cc15cc14d','67370a60af15370029d4117b6413c02aa560de926277eb6e43a0abd13fae29d2','1d0bb56e2dfe933d40c478d4d8bdd2408e5ed7bb30b34c44a97c8b9e5a1e0d04','15cd4eb1fecc4636f37bdb33c401e27df92e3045f9f2fc1860bc5b1cea68ca7e','64dab06dbb3780c8608fa10911550757ea130e841b5ffe74eeb400c1acbbefbd'];
 const tickets=[{id:'ONE',date:'15.09.2026',time:'10:00',city:'Дніпро',street:'Вул Тестова',house:'1',type:'Підключення',sum:100,payment:'cash',signal:'-26',connectMasters:['Петя'],tags:['Петя'],equipment:[{label:'ONU',price:100,total:100,qty:1}],cables:[],presetWorks:[],additionalWork:[]},{id:'TWO',date:'16.09.2026',time:'11:00',city:'Дніпро',street:'Вул Тестова',house:'2',type:'Ремонт',sum:200,payment:'card',signal:'-24',connectMasters:[],tags:['Женя'],equipment:[],cables:[],presetWorks:[],additionalWork:[]}];
 const ctx={tickets,shifts:[{date:'16.09.2026',coworker:'Петя',hours:8}],searchIndex:[{id:'ONE',text:'поставил ONU'},{id:'TWO',text:'заменил ONU'}]};
 const cases=[{mode:'count'},{mode:'list',limit:1,offset:1},{mode:'group',group_by:'city'},{mode:'stats'},{mode:'exists',date_from:'01.09.2026',date_to:'30.09.2026'},{mode:'list',coworker:'Петя'},{mode:'count',items:[{kind:'equipment',text:'ONU'}]},{mode:'list',signal_worse_than:-25},{mode:'list',city:'Дніпро',street:'Вул Тестова',house:'1'}];
 cases.push({mode:'list',semantic:{entity:'onu',action:'install'}});
 cases.forEach((params,i)=>assert.equal(createHash('sha256').update(JSON.stringify(runSmartQuery(ctx,params))).digest('hex'),golden[i],JSON.stringify(params)));
});
