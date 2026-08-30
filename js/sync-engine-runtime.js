(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTSyncEngineRuntime=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  function clone(v){return JSON.parse(JSON.stringify(v||[]));}
  function mapById(items){return new Map((items||[]).map(x=>[String(x.id),x]));}
  function uuid(){return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;}
  function entityPayload(entity,item){return entity==='ticket' ? root.ticketToSyncPayload(item) : root.shiftToSyncPayload(item);}
  class Engine{
    constructor(options){this.core=options.core||root.MTSyncEngineCore;this.storage=options.storage||root.MTSyncJournalStorage;this.transport=options.transport;this.payload=options.payload||entityPayload;this.state={records:{}};this.write=Promise.resolve();this.loop=null;this.online=options.online;this.onChange=options.onChange||function(){};this.retryDelays=options.retryDelays||[2000,5000,15000,30000];this.retryStep=0;this.retryTimer=null;this.setTimer=options.setTimeout||((fn,delay)=>root.setTimeout(fn,delay));this.clearTimer=options.clearTimeout||(id=>root.clearTimeout(id));}
    async init(){this.state=await this.storage.load();this.core.assertInvariants(this.state);if(this.online())this.flush();return this;}
    persistTransition(change){
      this.write=this.write.catch(()=>{}).then(async()=>{const next=change(this.state);this.core.assertInvariants(next);await this.storage.save(next);this.state=next;this.onChange(this.pendingCount());return this.state;});
      return this.write;
    }
    recordDiff(entity,before,after){const old=mapById(before),next=mapById(after),jobs=[];
      for(const [id,item] of next){const prior=old.get(id);if(!prior||JSON.stringify(this.payload(entity,prior))!==JSON.stringify(this.payload(entity,item))) jobs.push({entity,id,payload:this.payload(entity,item)});}
      for(const id of old.keys()) if(!next.has(id)) jobs.push({entity,id,payload:{},delete:true});
      if(!jobs.length)return this.write;
      return this.persistTransition(state=>jobs.reduce((s,job)=>this.core.enqueue(s,job,uuid),state)).then(()=>{if(this.online())this.flush();});
    }
    pendingCount(){return this.core.pending(this.state).length;}
    conflictFor(entity,id){return this.core.conflictFor(this.state,entity,id);}
    acceptServerConflict(entity,id,server){return this.persistTransition(s=>this.core.acceptServerConflict(s,entity,id,server));}
    keepLocalConflict(entity,id,server,payload){return this.persistTransition(s=>this.core.keepLocalConflict(s,entity,id,server,payload,uuid)).then(()=>this.flush());}
    cancelRetryTimer(){if(this.retryTimer!==null){this.clearTimer(this.retryTimer);this.retryTimer=null;}}
    resetBackoff(){this.cancelRetryTimer();this.retryStep=0;}
    scheduleRetry(){if(this.retryTimer!==null||!this.online()||!this.pendingCount())return;const delay=this.retryDelays[Math.min(this.retryStep,this.retryDelays.length-1)];this.retryStep=Math.min(this.retryStep+1,this.retryDelays.length-1);this.retryTimer=this.setTimer(()=>{this.retryTimer=null;this.flush();},delay);}
    flush(){if(this.loop)return this.loop;this.cancelRetryTimer();if(!this.online())return Promise.resolve(false);let failed=false;
      this.loop=(async()=>{await this.write;const failedEntities=new Set();while(this.online()){
        const item=this.core.pending(this.state).find(candidate=>!candidate.conflict&&!failedEntities.has(`${candidate.entity}:${candidate.id}`));if(!item)break;
        await this.persistTransition(s=>this.core.markAttempted(s,item.entity,item.id));
        const result=await this.transport.send(item);
        if(!result.ok){
          const error=result.result;
          if(error && error.code==='CONFLICT'){
            await this.persistTransition(s=>this.core.markConflict(s,item.entity,item.id,error.state));
            failedEntities.add(`${item.entity}:${item.id}`);continue;
          }
          if(error && error.code==='REVISION_GAP' && this.core.recoverUncommittedAddTicketGap){
            let recovered=false;
            await this.persistTransition(s=>{const repair=this.core.recoverUncommittedAddTicketGap(s,item,error.state,uuid);recovered=repair.recovered;return repair.state;});
            if(recovered)continue;
          }
          failed=true;failedEntities.add(`${item.entity}:${item.id}`);continue;
        }
        await this.persistTransition(s=>result.state?this.core.reconcile(s,item.entity,item.id,result.state):this.core.acknowledge(s,item.entity,item.id,item.revision));
        this.resetBackoff();
      }return this.pendingCount()===0;})().finally(()=>{this.loop=null;if(failed)this.scheduleRetry();});return this.loop;
    }
  }
  return {Engine,clone,uuid};
});
