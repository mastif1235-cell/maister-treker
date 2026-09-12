'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','js','restore-from-sheets.js'),'utf8');

function ticketToSyncPayload(t){
  return {
    id:String(t.id||''), date:String(t.date||''), time:String(t.time||''),
    content:String(t.content||''), sum:Number(t.sum)||0, tags:Array.isArray(t.tags)?t.tags:[],
    backupNote:'', fullDataJson:JSON.stringify({city:t.city||'',clientName:t.clientName||'',masterNote:t.masterNote||''})
  };
}

function buildContext(overrides){
  const ctx={
    console, TextEncoder, TextDecoder,
    window:{},
    blankTicketObject:()=>({}),
    parseBackupNote:()=>({geoLink:'',masterNote:'',login:'',password:'',fullData:null}),
    ticketToSyncPayload,
    tickets:[{id:'t1',date:'01.09.2026',time:'10:00',content:'local',sum:100,tags:['підключення'],city:'Київ',clientName:'Іван'}],
    shifts:[{id:'s1',date:'01.09.2026',hours:8,coworker:'Сам'}],
    syncTicketsSnapshot:[{id:'t1',date:'01.09.2026',time:'10:00',content:'local',sum:100,tags:['підключення'],city:'Київ',clientName:'Іван'}],
    syncShiftsSnapshot:[{id:'s1',date:'01.09.2026',hours:8,coworker:'Сам'}],
    ticketWrites:0, shiftWrites:0, syncTickets:0, syncShifts:0, backupWrites:0, savedIndex:null, seeded:[], replaced:0,
    savedTickets:[], savedShifts:[], failShiftWrite:false,
    saveTicketsLocalOnly:async()=>{ctx.ticketWrites++;ctx.savedTickets.push(JSON.parse(JSON.stringify(ctx.tickets)));return true;},
    saveShiftsLocalOnly:async()=>{ctx.shiftWrites++;ctx.savedShifts.push(JSON.parse(JSON.stringify(ctx.shifts)));if(ctx.failShiftWrite)return false;return true;},
    saveTickets:async()=>{ctx.syncTickets++;},
    saveShifts:async()=>{ctx.syncShifts++;},
    backupDb:{}, backupDbPut:async(key,value)=>{ctx.backupWrites++;ctx.lastBackupKey=key;ctx.lastBackupValue=value;return true;},
    backupDbGet:async()=>null, backupDbDelete:async()=>true,
    loadDailyBackupIndex:()=>[], saveDailyBackupIndex:index=>{ctx.savedIndex=index;},
    DAILY_BACKUP_MAX:10,
    toolsExportData:()=>({diagnostics:[],networkPoints:[]}),
    mtBackupSafeExport:value=>value,
    securitySanitizeSettingsForBackup:value=>value,
    settings:{theme:'dark'},
    renderTicketsScreen(){}, renderShiftsScreen(){}, renderSettingsScreen(){}, renderDailyBackupList(){},
    openModal(){}, openConfirmModal:async()=>true, showToast(){}, escapeHtml:s=>String(s),
    navigator:{onLine:true},
    MTSafeError:{reportError(){}},
    MTSyncEngineRuntime:{uuid:()=> 'uuid'},
    getScriptUrl:()=> 'https://example/exec',
    syncEngine:{
      state:{records:{}},
      pendingCount:()=>0,
      seedBaseline:async(entity,id,server)=>{ctx.seeded.push({entity,id,revision:Number(server.revision)||0,tombstone:!!server.tombstone});ctx.syncEngine.state.records[`${entity}:${id}`]={entity,id,committedRevision:Number(server.revision)||0,tombstone:!!server.tombstone,head:null,tail:null,conflict:null};},
      replaceState:async(state)=>{ctx.replaced++;ctx.syncEngine.state=JSON.parse(JSON.stringify(state));}
    }
  };
  Object.assign(ctx, overrides || {});
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, {filename:'restore-from-sheets.js'});
  return ctx;
}

(async()=>{
  const cloudTickets=[{id:'t2',date:'02.09.2026',time:'11:00',content:'new',sum:200,tags:[],fullDataJson:JSON.stringify({city:'Львів',clientName:'Оля'})}];
  const cloudShifts=[{id:'s2',date:'02.09.2026',hours:6,coworker:'Оля'}];

  // apply is local-only and snapshot-aligned (no Google mutation).
  let ctx=buildContext();
  const deps=ctx.MTSheetsRestoreRuntime.mtRestoreDeps();
  const ticketPlan=ctx.MTRestoreFromSheets.buildTicketPlan(ctx.tickets,cloudTickets,deps);
  const shiftPlan=ctx.MTRestoreFromSheets.buildShiftPlan(ctx.shifts,cloudShifts);
  const result=await ctx.MTSheetsRestoreRuntime.mtApplyRestore({ticketPlan,shiftPlan,cloudTickets,cloudShifts,decisions:{tickets:{},shifts:{}},deps});
  assert.equal(result.ok,true);
  assert.equal(ctx.ticketWrites,1); assert.equal(ctx.shiftWrites,1);
  assert.equal(ctx.syncTickets,0,'ticket apply never enqueues a Google mutation');
  assert.equal(ctx.syncShifts,0,'shift apply never enqueues a Google mutation');
  assert.equal(JSON.stringify(ctx.syncTicketsSnapshot),JSON.stringify(ctx.tickets),'ticket snapshot aligns');
  assert.equal(JSON.stringify(ctx.syncShiftsSnapshot),JSON.stringify(ctx.shifts),'shift snapshot aligns');
  assert.equal(ctx.tickets.length,2); assert.equal(ctx.shifts.length,2);
  assert.equal(ctx.seeded.length,0,'no baselines were requested for this no-conflict case');

  // apply seeds requested cloud baselines into the sync journal, still without
  // creating sync queue mutations.
  ctx=buildContext();
  const seedResult=await ctx.MTSheetsRestoreRuntime.mtApplyRestore({
    ticketPlan:ctx.MTRestoreFromSheets.buildTicketPlan([],cloudTickets,ctx.MTSheetsRestoreRuntime.mtRestoreDeps()),
    shiftPlan:null,
    cloudTickets, cloudShifts:[],
    decisions:{tickets:{},shifts:{}},
    deps:ctx.MTSheetsRestoreRuntime.mtRestoreDeps(),
    baselines:[{entity:'ticket',id:'t2',revision:5,tombstone:false}]
  });
  assert.equal(seedResult.ok,true);
  assert.equal(ctx.seeded.length,1);
  assert.equal(ctx.seeded[0].id,'t2');
  assert.equal(ctx.seeded[0].revision,5);
  assert.equal(ctx.syncTickets,0,'seeding baseline never enqueues a Google mutation');
  assert.equal(ctx.syncEngine.state.records['ticket:t2'].committedRevision,5);

  // partial apply failure rolls data, snapshot and journal back.
  ctx=buildContext({saveTicketsLocalOnly:async()=>{ctx.ticketWrites++;return false;}});
  const beforeTickets=JSON.parse(JSON.stringify(ctx.tickets));
  const beforeSnapshot=JSON.parse(JSON.stringify(ctx.syncTicketsSnapshot));
  const beforeJournal=JSON.parse(JSON.stringify(ctx.syncEngine.state));
  const failed=await ctx.MTSheetsRestoreRuntime.mtApplyRestore({ticketPlan:ctx.MTRestoreFromSheets.buildTicketPlan(ctx.tickets,cloudTickets,ctx.MTSheetsRestoreRuntime.mtRestoreDeps()),shiftPlan:null,cloudTickets,cloudShifts:[],decisions:{tickets:{},shifts:{}},deps:ctx.MTSheetsRestoreRuntime.mtRestoreDeps(),baselines:[{entity:'ticket',id:'t2',revision:5,tombstone:false}]});
  assert.equal(failed.ok,false);
  assert.equal(JSON.stringify(ctx.tickets),JSON.stringify(beforeTickets),'tickets rolled back');
  assert.equal(JSON.stringify(ctx.syncTicketsSnapshot),JSON.stringify(beforeSnapshot),'ticket snapshot rolled back');
  assert.equal(JSON.stringify(ctx.syncEngine.state),JSON.stringify(beforeJournal),'journal rolled back');

  // tickets already written to disk, then shifts fail: the rollback must also
  // overwrite the disk copy, otherwise a restart would show a partial restore.
  ctx=buildContext({failShiftWrite:true});
  const diskBeforeTickets=JSON.parse(JSON.stringify(ctx.tickets));
  const diskBeforeShifts=JSON.parse(JSON.stringify(ctx.shifts));
  const diskRollback=await ctx.MTSheetsRestoreRuntime.mtApplyRestore({
    ticketPlan:ctx.MTRestoreFromSheets.buildTicketPlan(ctx.tickets,cloudTickets,ctx.MTSheetsRestoreRuntime.mtRestoreDeps()),
    shiftPlan:ctx.MTRestoreFromSheets.buildShiftPlan(ctx.shifts,cloudShifts),
    cloudTickets, cloudShifts,
    decisions:{tickets:{},shifts:{}},
    deps:ctx.MTSheetsRestoreRuntime.mtRestoreDeps(),
    baselines:[]
  });
  assert.equal(diskRollback.ok,false,'shift write failure fails the whole restore');
  assert.equal(ctx.shiftWrites,2,'shift write attempted twice: apply and rollback');
  assert.equal(JSON.stringify(ctx.tickets),JSON.stringify(diskBeforeTickets),'tickets rolled back in memory');
  assert.equal(JSON.stringify(ctx.savedTickets[ctx.savedTickets.length-1]),JSON.stringify(diskBeforeTickets),'tickets rolled back on disk');
  assert.equal(JSON.stringify(diskRollback.rollbackFailed),JSON.stringify(['зміни']),'failed disk rollback is reported to the user');

  // revision fetch: partial transient failure throws and leaves local state untouched.
  ctx=buildContext();
  const flakyTransport={getEntityState:async(entity,id)=>{if(id==='bad')return{ok:false,result:{status:'error',code:'NETWORK'}};return{ok:true,result:{status:'ok',state:{revision:4,tombstone:false}}};}};
  const beforeFetchTickets=JSON.stringify(ctx.tickets);
  let fetchError=null;
  try{
    await ctx.MTSheetsRestoreRuntime.mtFetchBaselines([{entity:'ticket',id:'good'},{entity:'ticket',id:'bad'}],{transport:flakyTransport,concurrency:2,maxRetries:0});
  }catch(error){fetchError=error;}
  assert.ok(fetchError,'partial revision fetch fails');
  assert.equal(fetchError.code,'REVISION_FETCH_FAILED');
  assert.equal(JSON.stringify(ctx.tickets),beforeFetchTickets,'revision fetch is read-only and changes no local data');

  // tombstone during baseline fetch marks the cloud entity as skip, not baseline.
  ctx=buildContext();
  const tombstoneTransport={getEntityState:async()=>({ok:true,result:{status:'ok',state:{revision:9,tombstone:true}}})};
  const fetched=await ctx.MTSheetsRestoreRuntime.mtFetchBaselines([{entity:'ticket',id:'gone'}],{transport:tombstoneTransport,concurrency:1,maxRetries:0});
  assert.equal(fetched.baselines.length,0);
  assert.equal(fetched.skipCloud.ticket.has('gone'),true);

  // pre-restore backup captures the sync journal for a true rollback.
  ctx=buildContext();
  ctx.syncEngine.state={records:{'ticket:t1':{entity:'ticket',id:'t1',committedRevision:7,tombstone:false,head:null,tail:null,conflict:null}}};
  const key=await ctx.MTSheetsRestoreRuntime.mtCreatePreRestoreBackup();
  assert.ok(key.indexOf('pre-restore-')===0);
  assert.equal(ctx.backupWrites,1);
  assert.equal(ctx.lastBackupValue.tickets.length,1);
  assert.equal(ctx.lastBackupValue.shifts.length,1);
  assert.equal(ctx.lastBackupValue.syncJournal.records['ticket:t1'].committedRevision,7,'journal baseline captured');
  assert.equal(ctx.savedIndex.length,1);
  assert.equal(ctx.savedIndex[0].date,key);

  console.log('PASS sheets restore runtime seeds baselines, fetches revisions read-only, and backs up journal state');
})().catch(error=>{console.error(error);process.exitCode=1;});
