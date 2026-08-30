(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTSingleWriterLock=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const LOCK_NAME='maister-tracker-production-writer-v1';
  let state='idle',release=null,decision=null;
  function canWrite(){return state!=='reader';}
  function showConflict(){
    if(typeof document==='undefined'||document.getElementById('mtWriterConflict'))return;
    const overlay=document.createElement('div');overlay.id='mtWriterConflict';overlay.setAttribute('role','alertdialog');overlay.innerHTML='<div><strong>⚠️ Майстер-Трекер уже відкритий</strong><p>Ця копія працює лише для перегляду, щоб не перезаписати новіші заявки. Закрийте інше вікно та відкрийте застосунок знову.</p><button type="button">Оновити</button></div>';
    Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'10000',display:'grid',placeItems:'center',padding:'24px',background:'rgba(0,0,0,.86)',textAlign:'center'});
    Object.assign(overlay.firstElementChild.style,{maxWidth:'420px',padding:'22px',border:'1px solid #f39a32',borderRadius:'14px',background:'#1b1b1b',color:'#fff'});
    overlay.querySelector('button').onclick=()=>root.location.reload();document.body.appendChild(overlay);
  }
  function warn(){if(state==='reader'){showConflict();if(typeof root.showToast==='function')root.showToast('Інша копія застосунку вже змінює дані');}return canWrite();}
  async function acquire(){
    if(state!=='idle')return decision||Promise.resolve(canWrite());
    if(!root.navigator?.locks?.request){state='writer';return true;}
    decision=new Promise(resolve=>{
      root.navigator.locks.request(LOCK_NAME,{mode:'exclusive',ifAvailable:true},lock=>{
        if(!lock){state='reader';showConflict();resolve(false);return;}
        state='writer';resolve(true);return new Promise(done=>{release=done;});
      }).catch(()=>{state='reader';showConflict();resolve(false);});
    });
    return decision;
  }
  function releaseForTest(){if(release){release();release=null;}state='idle';decision=null;}
  function status(){return state;}
  return{LOCK_NAME,acquire,canWrite,warn,status,releaseForTest};
});
