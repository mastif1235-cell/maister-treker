'use strict';
/* v91.58 follow-up polish, PWA side of FIX 4 (real ai-client + ai-chat in vm):
   TURN 1 a list → TURN 2 «открой вторую карточку» (Worker returns
   selectedTicketId=B) → TURN 3 «покажи её» is sent WITH selectedTicketId=B, so
   the Worker opens B deterministically. Then the master asks another address:
   the Worker flags resultSetStatus.selectionChanged → the PWA drops B, and the
   next «покажи її» goes out with the NEW referent instead of the stale
   selection. A field question about B (no flag) keeps the selection. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');

function load(...files){
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Array, Object, String, Number, RegExp, Error, AbortController, Response, Headers, fetch };
  sandbox.globalThis=sandbox; sandbox.window=undefined;
  for(const f of files) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),vm.createContext(sandbox),{filename:f});
  return sandbox;
}
function memStorage(){
  const m=new Map();
  return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>{m.set(k,String(v));}, removeItem:k=>{m.delete(k);} };
}
const CHAT_MODULES=['js/ai/ai-config.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-chat.js'];
const SETTINGS={ai:{enabled:true,provider:'deepseek',model:'deepseek-flash',backendUrl:'https://w.example.dev'},aiBearerToken:'n:tok1234567890abcdef:read'};
const A={id:'t-ukr-12',date:'15.06.2026',time:'10:00',address:'Шевченко, Вул Українська 12',type:'Підключення',sum:'900',signal:'-19'};
const B={id:'t-ukr-31',date:'01.06.2026',time:'15:56',address:'Шевченко, Вул Українська 31',type:'Ремонт',sum:'600',signal:'-21'};
const K={id:'t-k15',date:'03.06.2026',time:'17:54',address:'Таромське, Вул Кобзаря 15',type:'Підключення',sum:'1200',signal:'-18'};
const ok=(payload)=>new Response(JSON.stringify(Object.assign({ok:true,meta:{}},payload)),{status:200});

(async function(){
  const sb=load(...CHAT_MODULES); const M=sb.MTAI;
  sb.settings=JSON.parse(JSON.stringify(SETTINGS));
  const requests=[];
  const replies=[
    /* 1: legacy-tool list — referents only */
    ok({answer:'На Українській 2 заявки: 1. … 12; 2. … 31.',tickets:[],referentTickets:[A,B],resultSetStatus:{created:false,reason:'legacy_tool',subjectChanged:true,filtersKey:null}}),
    /* 2: «открой вторую карточку» — the Worker selected B deterministically */
    ok({answer:'Вторая заявка: Українська 31.',tickets:[],referentTickets:[],selectedTicketId:'t-ukr-31',presentation:{kind:'single_ticket',ticket_id:'t-ukr-31'},resultSetStatus:{created:false,reason:'selected_ticket',subjectChanged:false,filtersKey:null}}),
    /* 3: «покажи её» — deterministic open of the selection */
    ok({answer:'Открываю выбранную заявку.',meta:{intent:'open'},tickets:[],referentTickets:[],selectedTicketId:'t-ukr-31',presentation:{kind:'single_ticket',ticket_id:'t-ukr-31'},resultSetStatus:{created:false,reason:'selected_ticket'}}),
    /* 4: a field question about B — rows include B, no flag */
    ok({answer:'Сигнал там -21 dBm.',tickets:[],referentTickets:[B],resultSetStatus:{created:false,reason:'legacy_tool',subjectChanged:true,filtersKey:null}}),
    /* 5: another address — the Worker flags the stale selection */
    ok({answer:'Кобзаря 15: подключение 03.06.2026.',tickets:[],referentTickets:[K],resultSetStatus:{created:false,reason:'legacy_tool',subjectChanged:true,filtersKey:null,selectionChanged:true}}),
    /* 6: «покажи її» — resolved from the new referent by the Worker */
    ok({answer:'Открываю выбранную заявку.',meta:{intent:'open'},tickets:[],referentTickets:[],selectedTicketId:'t-k15',presentation:{kind:'single_ticket',ticket_id:'t-k15'},resultSetStatus:{created:false,reason:'selected_ticket'}})
  ];
  const fetchImpl=async function(url,init){ requests.push(JSON.parse(init.body)); return replies[requests.length-1]; };
  const client=M.createClient({fetchImpl,getConfig:()=>({backendUrl:sb.settings.ai.backendUrl,bearer:M.storage.bearer(),provider:'deepseek',model:'deepseek-flash'})});
  const chat=M.createChatController({client,hooks:{assistant(){}},storage:memStorage()});

  await chat.send('Заявки на Українській');
  await chat.send('Открой вторую карточку');
  assert.deepEqual(requests[1].context.tickets.map(t=>t.id),['t-ukr-12','t-ukr-31'],'the ordinal turn carries the referents in order');
  await chat.send('Покажи мне её');
  assert.equal(requests[2].context.selectedTicketId,'t-ukr-31','«покажи её» goes out with the stored selection');
  assert.equal(requests[2].context.tickets,undefined,'no referents while a selection exists');
  await chat.send('а який там сигнал?');
  assert.equal(requests[3].context.selectedTicketId,'t-ukr-31');
  await chat.send('Кобзаря 15');
  assert.equal(requests[4].context.selectedTicketId,'t-ukr-31','the selection is still sent with the new address question (the Worker decides)');
  await chat.send('покажи її');
  assert.equal(requests[5].context.selectedTicketId,undefined,'selectionChanged → the stale selection was dropped');
  assert.deepEqual(requests[5].context.tickets.map(t=>t.id),['t-k15'],'the new referent is the context instead');
  console.log('PASS ai-chat selection: «открой вторую» → «покажи её» keeps B; another address drops the stale selection; field question keeps it');
})().catch(error=>{console.error(error);process.exit(1);});
