'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js/ticket-address-domain.js'),'utf8');
const context={naryadQueue:[],formatDate:()=>'',naryadItemDate:item=>item.date,console};
vm.createContext(context);vm.runInContext(source,context);
const now=Date.UTC(2026,8,14),day='14.09.2026';
context.naryadQueue=[
  {id:'old-done',text:'old',date:day,done:true,completedAt:now-31*24*60*60*1000},
  {id:'legacy-done',text:'legacy',date:day,done:true},
  {id:'active',text:'  вул.  Миру  1 ',date:day,done:false}
];
assert.equal(context.pruneCompletedNaryads(now),1,'only explicitly timestamped completed naryads pass the 30-day retention cutoff');
assert.deepEqual(context.naryadQueue.map(x=>x.id),['legacy-done','active'],'legacy/active naryads are never guessed stale');
assert.equal(context.findPendingNaryadDuplicate('вул. Миру 1',day).id,'active','same active text/date is deduplicated despite whitespace');
assert.equal(context.findPendingNaryadDuplicate('вул. Миру 1',day,'active'),null,'editing an entry does not self-match');
context.naryadQueue=Array.from({length:200},(_,i)=>({id:i,text:'active '+i,date:day,done:false}));
assert.equal(context.pruneCompletedNaryads(now),0,'a full queue never silently drops active naryads');
assert.equal(context.naryadQueue.length,200,'active queue stays at its explicit cap');
assert.match(source,/naryadQueue\.length>=NARYAD_QUEUE_MAX/,'new active naryads are refused at the explicit cap');
assert.doesNotMatch(source,/\.splice\([^\n]*NARYAD_QUEUE_MAX|\.pop\(\)[^\n]*NARYAD_QUEUE_MAX/,'no count-based eviction silently loses a naryad');
console.log('PASS naryad queue is deduplicated, bounded and never evicts active work');
