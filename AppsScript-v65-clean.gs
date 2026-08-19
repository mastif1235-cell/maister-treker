/* Maister Tracker — clean Apps Script server candidate
 * architecture-cleanup only. ONE doGet + ONE doPost.
 * Real HMAC secret belongs only in deployed Apps Script, never GitHub.
 */
var SECURE_AUTH_HMAC_SECRET='PUT_REAL_32_PLUS_CHAR_SECRET_IN_DEPLOYMENT';
var SECURE_AUTH_V2=2;
var SECURE_AUTH_MIN_SECRET_LENGTH=32;
var SECURE_AUTH_MAX_SKEW_MS=5*60*1000;
var SECURE_AUTH_NONCE_TTL_MS=10*60*1000;
var SECURE_AUTH_NONCE_KEY='MT_HMAC_NONCES_V2';
var SECURE_AUTH_MAX_BODY_CHARS=8*1024*1024;
var TICKET_HEADERS=['id','date','time','content','sum','tags','нотатки_майстра','повніДаніJSON'];
var SHIFT_HEADERS=['id','date','hours','coworker'];

function jsonResponse(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function safeString(v){return v==null?'':String(v).trim();}
function safeNumber(v){var n=Number(v);return v instanceof Date||isNaN(n)?0:n;}
function cellToDateString(v,tz){return v instanceof Date?Utilities.formatDate(v,tz,'dd.MM.yyyy'):safeString(v);}
function cellToTimeString(v,tz){return v instanceof Date?Utilities.formatDate(v,tz,'HH:mm'):safeString(v);}
function parseDdMmYyyy(s){if(s instanceof Date)return isNaN(s.getTime())?null:s;var p=String(s||'').split('.');if(p.length!==3)return null;var d=new Date(Number(p[2]),Number(p[1])-1,Number(p[0]));return isNaN(d.getTime())?null:d;}
function timeToMs(t){if(t instanceof Date)return(t.getHours()*60+t.getMinutes())*60000;var m=String(t||'').match(/^(\d{1,2}):(\d{2})/);return m?(Number(m[1])*60+Number(m[2]))*60000:0;}
function ticketDateKey_(t){var d=parseDdMmYyyy(t.date);return d?d.getTime()+timeToMs(t.time):0;}

/* ---------- HMAC authentication ---------- */
function authB64_(bytes){return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g,'');}
function authEq_(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;var d=0;for(var i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function authReady_(){return String(SECURE_AUTH_HMAC_SECRET||'').length>=SECURE_AUTH_MIN_SECRET_LENGTH;}
function authSig_(s){return authB64_(Utilities.computeHmacSha256Signature(String(s),String(SECURE_AUTH_HMAC_SECRET),Utilities.Charset.UTF_8));}
function authFresh_(ts){var n=Number(ts);return isFinite(n)&&Math.abs(Date.now()-n)<=SECURE_AUTH_MAX_SKEW_MS;}
function authNonceHash_(n){return authB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(n),Utilities.Charset.UTF_8));}
function authConsumeNonce_(nonce){
  nonce=String(nonce||'');if(!/^[A-Za-z0-9_-]{16,128}$/.test(nonce))return false;
  /* Authentication lock is deliberately separate from spreadsheet mutation lock. */
  var lock=LockService.getUserLock();
  try{lock.waitLock(3000);var props=PropertiesService.getScriptProperties(),now=Date.now(),hash=authNonceHash_(nonce),ledger=[];
    try{ledger=JSON.parse(props.getProperty(SECURE_AUTH_NONCE_KEY)||'[]');}catch(_){return false;}
    if(!Array.isArray(ledger))return false;
    ledger=ledger.filter(function(x){return x&&typeof x.h==='string'&&isFinite(Number(x.ts))&&now-Number(x.ts)<=SECURE_AUTH_NONCE_TTL_MS;});
    if(ledger.some(function(x){return x.h===hash;}))return false;
    ledger.push({h:hash,ts:now});if(ledger.length>128)ledger=ledger.slice(-128);
    props.setProperty(SECURE_AUTH_NONCE_KEY,JSON.stringify(ledger));return true;
  }catch(_){return false;}finally{try{lock.releaseLock();}catch(_){}}
}
function authGet_(p){p=p||{};var ts=String(p.ts||''),n=String(p.nonce||''),a=String(p.action||'list'),id=String(p.id||''),sig=String(p.sig||'');
  if(!authReady_()||Number(p.v)!==SECURE_AUTH_V2||!authFresh_(ts)||!{list:1,checkTicketExists:1,getTicketById:1}[a]||id.length>500||!/^[A-Za-z0-9_-]{43}$/.test(sig))return false;
  return authEq_(authSig_(ts+'\n'+n+'\nGET\n'+a+'\n'+id),sig)&&authConsumeNonce_(n);
}
function authPost_(outer){if(!authReady_()||!outer||Number(outer.v)!==SECURE_AUTH_V2)return null;var ts=String(outer.ts||''),n=String(outer.nonce||''),body=String(outer.body||''),sig=String(outer.sig||'');
  if(!authFresh_(ts)||!body||body.length>SECURE_AUTH_MAX_BODY_CHARS||!/^[A-Za-z0-9_-]{43}$/.test(sig))return null;
  return authEq_(authSig_(ts+'\n'+n+'\nPOST\n'+body),sig)&&authConsumeNonce_(n)?body:null;
}

/* ---------- Sheets: reads never mutate ---------- */
function sheet_(name){return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);}
function ensureSheet_(name,headers){var ss=SpreadsheetApp.getActiveSpreadsheet(),s=ss.getSheetByName(name);if(!s){s=ss.insertSheet(name);s.appendRow(headers);}return s;}
function findRowById_(sheet,id){if(!sheet||sheet.getLastRow()<=1)return-1;var ids=sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues(),target=String(id==null?'':id);for(var i=0;i<ids.length;i++)if(String(ids[i][0])===target)return i+2;return-1;}
function deleteById_(sheet,id){var row=findRowById_(sheet,id);if(row>0)sheet.deleteRow(row);}

/* ---------- Ticket helpers ---------- */
function ticketObjectAt_(sheet,row){var ss=SpreadsheetApp.getActiveSpreadsheet(),tz=ss.getSpreadsheetTimeZone(),r=sheet.getRange(row,1,1,8).getValues()[0];return{id:safeString(r[0]),date:cellToDateString(r[1],tz),time:cellToTimeString(r[2],tz),content:r[3]==null?'':String(r[3]),sum:safeNumber(r[4]),tags:r[5]?String(r[5]).split(',').map(function(s){return s.trim();}).filter(Boolean):[],backupNote:safeString(r[6]),fullDataJson:safeString(r[7]),photo:null};}
function writeTicket_(sheet,row,t){sheet.getRange(row,1,1,8).setValues([[t.id,t.date,t.time,t.content,t.sum,(t.tags||[]).join(', '),t.backupNote||'',t.fullDataJson||'']]);sheet.getRange(row,1,1,3).setNumberFormat('@');sheet.getRange(row,5).setNumberFormat('0.##');sheet.getRange(row,6,1,3).setNumberFormat('@');sheet.getRange(row,4).setWrap(true);}
function sortTickets_(sheet){var last=sheet.getLastRow();if(last<=2)return;var range=sheet.getRange(2,1,last-1,8),rows=range.getValues();rows.sort(function(a,b){return ticketDateKey_({date:b[1],time:b[2]})-ticketDateKey_({date:a[1],time:a[2]});});range.setValues(rows);}
function mutateTicket_(action,t){var sheet=ensureSheet_('Заявки',TICKET_HEADERS),row=findRowById_(sheet,t.id);
  if(action==='deleteTicket'){if(row>0)sheet.deleteRow(row);return;}
  if(action==='addTicket'&&row>0)return;
  if(row<0)row=sheet.getLastRow()+1;writeTicket_(sheet,row,t);sortTickets_(sheet);
}
function writeAllTickets_(tickets){var sheet=ensureSheet_('Заявки',TICKET_HEADERS),last=sheet.getLastRow();if(last>1)sheet.getRange(2,1,last-1,8).clearContent();var list=(tickets||[]).slice().sort(function(a,b){return ticketDateKey_(b)-ticketDateKey_(a);});if(!list.length)return;var rows=list.map(function(t){return[t.id,t.date,t.time,t.content,t.sum,(t.tags||[]).join(', '),t.backupNote||'',t.fullDataJson||''];});sheet.getRange(2,1,rows.length,8).setValues(rows);sheet.getRange(2,1,rows.length,3).setNumberFormat('@');sheet.getRange(2,5,rows.length,1).setNumberFormat('0.##');sheet.getRange(2,6,rows.length,3).setNumberFormat('@');sheet.getRange(2,4,rows.length,1).setWrap(true);}

/* ---------- Shift helpers ---------- */
function shiftObjectAt_(sheet,row){var ss=SpreadsheetApp.getActiveSpreadsheet(),tz=ss.getSpreadsheetTimeZone(),r=sheet.getRange(row,1,1,4).getValues()[0];return{id:safeString(r[0]),date:cellToDateString(r[1],tz),hours:safeNumber(r[2]),coworker:safeString(r[3])};}
function writeShift_(sheet,row,s){sheet.getRange(row,1,1,4).setValues([[s.id,s.date,s.hours,s.coworker]]);sheet.getRange(row,1,1,2).setNumberFormat('@');sheet.getRange(row,3).setNumberFormat('0.##');sheet.getRange(row,4).setNumberFormat('@');}
function addShift_(s){var sheet=ensureSheet_('Зміни',SHIFT_HEADERS),row=findRowById_(sheet,s.id);if(row>0){writeShift_(sheet,row,s);return;}var d=parseDdMmYyyy(s.date),last=sheet.getLastRow(),insert=last+1;if(d&&last>1){var dates=sheet.getRange(2,2,last-1,1).getValues();for(var i=0;i<dates.length;i++){var existing=parseDdMmYyyy(dates[i][0]);if(existing&&existing>d){insert=i+2;break;}}}if(insert<=last)sheet.insertRowBefore(insert);writeShift_(sheet,insert,s);}
function writeAllShifts_(shifts){var sheet=ensureSheet_('Зміни',SHIFT_HEADERS),last=sheet.getLastRow();if(last>1)sheet.getRange(2,1,last-1,4).clearContent();var list=shifts||[];if(!list.length)return;var rows=list.map(function(s){return[s.id,s.date,s.hours,s.coworker];});sheet.getRange(2,1,rows.length,4).setValues(rows);sheet.getRange(2,1,rows.length,2).setNumberFormat('@');sheet.getRange(2,3,rows.length,1).setNumberFormat('0.##');sheet.getRange(2,4,rows.length,1).setNumberFormat('@');}

function listState_(){var ss=SpreadsheetApp.getActiveSpreadsheet(),tz=ss.getSpreadsheetTimeZone(),ts=ss.getSheetByName('Заявки'),ssheet=ss.getSheetByName('Зміни'),tickets=[],shifts=[];if(ts&&ts.getLastRow()>1)for(var r=2;r<=ts.getLastRow();r++){var t=ticketObjectAt_(ts,r);if(t.id||t.date)tickets.push(t);}if(ssheet&&ssheet.getLastRow()>1)for(var s=2;s<=ssheet.getLastRow();s++){var sh=shiftObjectAt_(ssheet,s);if(sh.id||sh.date)shifts.push(sh);}return{status:'ok',tickets:tickets,shifts:shifts};}

/* ---------- Single entry points ---------- */
function doGet(e){try{var p=e&&e.parameter||{};if(!authGet_(p))return jsonResponse({status:'error',message:'forbidden'});var action=String(p.action||'list'),tickets=sheet_('Заявки');
  if(action==='checkTicketExists')return jsonResponse({status:'ok',exists:findRowById_(tickets,p.id)>0});
  if(action==='getTicketById'){var row=findRowById_(tickets,p.id);return jsonResponse({status:'ok',ticket:row>0?ticketObjectAt_(tickets,row):null});}
  return jsonResponse(listState_());
}catch(_){return jsonResponse({status:'error',message:'forbidden'});}}

function doPost(e){var lock=null;try{var raw=e&&e.postData?String(e.postData.contents||''):'';if(raw.length>SECURE_AUTH_MAX_BODY_CHARS*2)return jsonResponse({status:'error',message:'request too large'});var body=authPost_(JSON.parse(raw||'{}'));if(body===null)return jsonResponse({status:'error',message:'forbidden'});var data=JSON.parse(body),action=String(data.action||'');
  var allowed={addTicket:1,updateTicket:1,deleteTicket:1,addShift:1,deleteShift:1,syncAll:1,syncAllTickets:1,syncAllShifts:1,clearAll:1};if(!allowed[action])return jsonResponse({status:'error',message:'unsupported action'});
  lock=LockService.getScriptLock();lock.waitLock(30000);
  if(action==='addTicket'||action==='updateTicket'||action==='deleteTicket')mutateTicket_(action,data);
  else if(action==='addShift')addShift_(data);
  else if(action==='deleteShift')deleteById_(ensureSheet_('Зміни',SHIFT_HEADERS),data.id);
  else if(action==='syncAll'){writeAllTickets_(data.tickets||[]);writeAllShifts_(data.shifts||[]);}
  else if(action==='syncAllTickets')writeAllTickets_(data.tickets||[]);
  else if(action==='syncAllShifts')writeAllShifts_(data.shifts||[]);
  else if(action==='clearAll'){writeAllTickets_([]);writeAllShifts_([]);}
  SpreadsheetApp.flush();return jsonResponse({status:'ok'});
}catch(err){return jsonResponse({status:'error',message:String(err)});}finally{if(lock)try{lock.releaseLock();}catch(_){}}}
