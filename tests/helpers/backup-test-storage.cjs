'use strict';
// Durable test doubles shared across VM reopening; no real user storage.
module.exports=function installBackupTestStorage(context){
  const local=new Map(),backups=new Map();
  context.localStorage={getItem:k=>local.has(k)?local.get(k):null,setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k)};
  context.backupDb={};
  context.backupDbPut=async(k,v)=>{backups.set(k,JSON.parse(JSON.stringify(v)));return true;};
  context.backupDbGet=async k=>backups.has(k)?JSON.parse(JSON.stringify(backups.get(k))):null;
  context.backupDbDelete=async k=>{backups.delete(k);return true;};
  return {local,backups};
};
