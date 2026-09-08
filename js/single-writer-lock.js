(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTSingleWriterLock=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const LOCK_NAME='maister-tracker-production-writer-v1';
  const FALLBACK_KEY='mt-single-writer-lease-v1',LEASE_MS=8000,HEARTBEAT_MS=2500;
  const ownerId=root.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let state='idle',release=null,decision=null,fallbackTimer=null;
  function canWrite(){return state!=='reader';}
  function showConflict(){
    if(typeof document==='undefined'||document.getElementById('mtWriterConflict'))return;
    const overlay=document.createElement('div');overlay.id='mtWriterConflict';overlay.setAttribute('role','alertdialog');overlay.innerHTML='<div><strong>⚠️ Майстер-Трекер уже відкритий</strong><p>Ця копія працює лише для перегляду, щоб не перезаписати новіші заявки. Закрийте інше вікно та відкрийте застосунок знову.</p><button type="button">Оновити</button></div>';
    Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'10000',display:'grid',placeItems:'center',padding:'24px',background:'rgba(0,0,0,.86)',textAlign:'center'});
    Object.assign(overlay.firstElementChild.style,{maxWidth:'420px',padding:'22px',border:'1px solid #f39a32',borderRadius:'14px',background:'#1b1b1b',color:'#fff'});
    overlay.querySelector('button').onclick=()=>root.location.reload();document.body.appendChild(overlay);
  }
  function warn(){if(state==='reader'){showConflict();if(typeof root.showToast==='function')root.showToast('Інша копія застосунку вже змінює дані');}return canWrite();}
  function readFallback(){try{const value=JSON.parse(root.localStorage?.getItem(FALLBACK_KEY)||'null');return value&&typeof value.owner==='string'&&Number.isFinite(Number(value.expiresAt))?value:null;}catch(_e){return null;}}
  function writeFallback(){try{root.localStorage.setItem(FALLBACK_KEY,JSON.stringify({owner:ownerId,expiresAt:Date.now()+LEASE_MS}));return readFallback()?.owner===ownerId;}catch(_e){return false;}}
  function removeConflict(){if(typeof document!=='undefined')document.getElementById('mtWriterConflict')?.remove();}
  function tryFallbackAcquire(){const held=readFallback();if(held&&held.owner!==ownerId&&Number(held.expiresAt)>Date.now())return false;if(!writeFallback())return false;state='writer';removeConflict();startFallbackTimer();return true;}
  function startFallbackTimer(){if(fallbackTimer||typeof root.setInterval!=='function')return;fallbackTimer=root.setInterval(()=>{if(state==='writer'){const held=readFallback();if(held?.owner===ownerId)writeFallback();else{state='reader';showConflict();}}else if(state==='reader')tryFallbackAcquire();},HEARTBEAT_MS);}
  function releaseFallback(){const held=readFallback();if(held?.owner!==ownerId)return false;try{root.localStorage.removeItem(FALLBACK_KEY);return true;}catch(_e){return false;}}
  async function acquire(){
    if(state!=='idle')return decision||Promise.resolve(canWrite());
    if(!root.navigator?.locks?.request){const acquired=tryFallbackAcquire();if(!acquired){state='reader';startFallbackTimer();showConflict();}return acquired;}
    decision=new Promise(resolve=>{
      root.navigator.locks.request(LOCK_NAME,{mode:'exclusive',ifAvailable:true},lock=>{
        if(!lock){state='reader';showConflict();resolve(false);return;}
        state='writer';resolve(true);return new Promise(done=>{release=done;});
      }).catch(()=>{state='reader';showConflict();resolve(false);});
    });
    return decision;
  }
  function releaseForTest(){if(release){release();release=null;}releaseFallback();if(fallbackTimer&&typeof root.clearInterval==='function')root.clearInterval(fallbackTimer);fallbackTimer=null;state='idle';decision=null;}
  function status(){return state;}
  if(typeof root.addEventListener==='function')root.addEventListener('pagehide',releaseFallback);
  return{LOCK_NAME,FALLBACK_KEY,LEASE_MS,ownerId,acquire,canWrite,warn,status,releaseForTest,tryFallbackAcquireForTest:tryFallbackAcquire};
});
