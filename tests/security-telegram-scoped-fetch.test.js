'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','js','security-telegram.js'),'utf8');
const calls=[],nativeFetch=async()=>({ok:true});
const context={
  Blob,FormData,console,fetch:nativeFetch,
  buildTelegramBackupText:ticket=>ticket.content,
  telegramBackupFetchJson:async function(url,options,ticket,rateRetries){calls.push({url,options,ticket,rateRetries,thisValue:this});return {ok:true};}
};
vm.createContext(context);vm.runInContext(source,context);
(async()=>{
  assert.equal(context.fetch,nativeFetch,'SEC-TG-1 loading archive hardening never replaces native/general fetch');
  assert.doesNotMatch(source,/(?:window|globalThis)\.fetch\s*=/,'SEC-TG-1 security module has no application-owned global fetch monkey patch');

  const original={id:'secret-ticket',password:'p@ss',content:'Робота\n🔑 Пароль: p@ss\nЗаявка',_origContent:'draft',_origSum:800};
  const body=new FormData();body.append('chat_id','private-chat');body.append('caption','backup');body.append('document',new Blob([JSON.stringify(original)],{type:'application/json'}),'ticket-secret-ticket.json');
  const result=await context.telegramBackupFetchJson('https://api.telegram.org/bottoken/sendDocument',{method:'POST',body},original,1);
  assert.equal(result.ok,true);assert.equal(calls.length,1,'SEC-TG-2 the real Telegram archive transport is wrapped once');
  assert.equal(calls[0].options.body.get('chat_id'),'private-chat','non-document Telegram fields survive the scoped wrapper');
  const sent=JSON.parse(await calls[0].options.body.get('document').text());
  assert.equal(sent.password,undefined,'SEC-TG-2 archive JSON removes subscriber password');
  assert.equal(sent._origContent,undefined);assert.equal(sent._origSum,undefined);
  assert.doesNotMatch(sent.content,/Пароль:/,'SEC-TG-2 archive content redacts labeled password lines');
  assert.deepEqual([...sent.telegramSecretsExcluded],['password']);assert.equal(sent.telegramArchiveFormat,2,'archive validation marker remains required');
  assert.match(context.buildTelegramBackupText(original),/Робота/);assert.doesNotMatch(context.buildTelegramBackupText(original),/Пароль:/,'Telegram text hardening remains active');

  const ordinary={method:'GET'};
  const passthrough=await context.securityTelegramArchiveRequestOptions('https://sheets.example.invalid/sync',ordinary);
  assert.equal(passthrough,ordinary,'SEC-TG-3 Sheets/ordinary requests are untouched by archive-only handling');
  const bad=new FormData();bad.append('document',new Blob(['not JSON'],{type:'application/json'}),'ticket-bad.json');
  await assert.rejects(()=>context.telegramBackupFetchJson('https://api.telegram.org/bottoken/sendDocument',{body:bad}),/TELEGRAM_ARCHIVE_SANITIZE_FAILED/,'SEC-TG-4 invalid archive JSON is blocked rather than sent without password validation');
  console.log('PASS scoped Telegram archive sanitizer preserves native fetch and archive-password protection');
})().catch(error=>{console.error(error);process.exitCode=1;});
