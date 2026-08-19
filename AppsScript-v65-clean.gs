/* Maister Tracker — clean Apps Script server candidate
 * architecture-cleanup only. One doGet, one doPost, HMAC-only ticket endpoint.
 * Put real HMAC secret only in deployed Apps Script, never in GitHub.
 */
var SECURE_AUTH_HMAC_SECRET='PUT_REAL_32_PLUS_CHAR_SECRET_IN_DEPLOYMENT';
var SECURE_AUTH_V2=2;
var SECURE_AUTH_MIN_SECRET_LENGTH=32;
var SECURE_AUTH_MAX_SKEW_MS=5*60*1000;
var SECURE_AUTH_NONCE_TTL_MS=10*60*1000;
var SECURE_AUTH_NONCE_KEY='MT_HMAC_NONCES_V2';
var SECURE_AUTH_MAX_BODY_CHARS=8*1024*1024;
var TICKET_HEADERS=['id','date','time','content','sum','tags','нотатки_майстра','повніДаніJSON'];

function jsonResponse(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function safeString(v){return v==null?'':String(v).trim();}
function safeNumber(v){var n=Number(v);return v instanceof Date||isNaN(n)?0:n;}
function cellToDateString(v,tz){return v instanceof Date?Utilities.formatDate(v,tz,'dd.MM.yyyy'):safeString(v);}
function cellToTimeString(v,tz){return v instanceof Date?Utilities.formatDate(v,tz,'HH:mm'):safeString(v);}

function authB64_(bytes){return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g,'');}
function authEq_(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;var d=0;for(var i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function authSig_(s){return authB64_(Utilities.computeHmacSha256Signature(String(s),String(SECURE_AUTH_HMAC_SECRET),Utilities.Charset.UTF_8));}
function authFresh_(ts){var n=Number(ts);return isFinite(n)&&Math.abs(Date.now()-n)<=SECURE_AUTH_MAX_SKEW_MS;}
function authNonceHash_(n){return authB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(n),Utilities.Charset.UTF_8));}
function authConsumeNonce_(nonce){
  nonce=String(nonce||'');if(!/^[A-Za-z0-9_-]{16,128}$/.test(nonce))return false;
  /* UserLock is deliberately separate from business ScriptLock. */
  var lock=LockService.getUserLock();
  try{lock.waitLock(3000);var props=PropertiesService.getScriptProperties(),now=Date.now(),hash=authNonceHash_(nonce),ledger=[];
    try{ledger=JSON.parse(props.getProperty(SECURE_AUTH_NONCE_KEY)||'[]');}catch(_){return false;}
    if(!Array.isArray(ledger))return false;
    ledger=ledger.filter(function(x){return x&&typeof x.h==='string'&&now-Number(x.ts)<=SECURE_AUTH_NONCE_TTL_MS;});
    if(ledger.some(function(x){return x.h===hash;}))return false;
    ledger.push({h:hash,ts:now});if(ledger.length>128)ledger=ledger.slice(-128);
    props.setProperty(SECURE_AUTH_NONCE_KEY,JSON.stringify(ledger));return true;
  }catch(_){return false;}finally{try{lock.releaseLock();}catch(_){}}
}
function authGet_(p){p=p||{};var ts=String(p.ts||''),n=String(p.nonce||''),a=String(p.action||'list'),id=String(p.id||''),sig=String(p.sig||'');
  if(String(SECURE_AUTH_HMAC_SECRET).length<SECURE_AUTH_MIN_SECRET_LENGTH||Number(p.v)!==2||!authFresh_(ts)||!{list:1,checkTicketExists:1,getTicketById:1}[a]||!/^[A-Za-z0-9_-]{43}$/.test(sig))return false;
  if(!authEq_(authSig_(ts+'\n'+n+'\nGET\n'+a+'\n'+id),sig))return false;return authConsumeNonce_(n);
}
function authPost_(outer){if(!outer||Number(outer.v)!==2)return null;var ts=String(outer.ts||''),n=String(outer.nonce||''),body=String(outer.body||''),sig=String(outer.sig||'');
  if(!authFresh_(ts)||!body||body.length>SECURE_AUTH_MAX_BODY_CHARS||!/^[A-Za-z0-9_-]{43}$/.test(sig))return null;
  if(!authEq_(authSig_(ts+'\n'+n+'\nPOST\n'+body),sig)||!authConsumeNonce_(n))return null;return body;
}

function ticketSheet_(){return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Заявки');}
function ensureTicketSheet_(){var ss=SpreadsheetApp.getActiveSpreadsheet(),s=ss.getSheetByName('Заявки');if(!s){s=ss.insertSheet('Заявки');s.appendRow(TICKET_HEADERS);}return s;}
function findTicketRow_(sheet,id){if(!sheet||sheet.getLastRow()<=1)return -1;var ids=sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues(),target=String(id);for(var i=0;i<ids.length;i++)if(String(ids[i][0])===target)return i+2;return -1;}
function ticketObjectAt_(sheet,row){var ss=SpreadsheetApp.getActiveSpreadsheet(),tz=ss.getSpreadsheetTimeZone(),r=sheet.getRange(row,1,1,8).getValues()[0];return {id:safeString(r[0]),date:cellToDateString(r[1],tz),time:cellToTimeString(r[2],tz),content:r[3]==null?'':String(r[3]),sum:safeNumber(r[4]),tags:r[5]?String(r[5]).split(',').map(function(s){return s.trim();}).filter(Boolean):[],backupNote:safeString(r[6]),fullDataJson:safeString(r[7])};}
function writeTicket_(sheet,row,t){sheet.getRange(row,1,1,8).setValues([[t.id,t.date,t.time,t.content,t.sum,(t.tags||[]).join(', '),t.backupNote||'',t.fullDataJson||'']]);sheet.getRange(row,1,1,3).setNumberFormat('@');sheet.getRange(row,5).setNumberFormat('0.##');sheet.getRange(row,6,1,3).setNumberFormat('@');sheet.getRange(row,4).setWrap(true);}
function mutateTicket_(action,t){var sheet=ensureTicketSheet_(),row=findTicketRow_(sheet,t.id);if(action==='deleteTicket'){if(row>0)sheet.deleteRow(row);return;}
  if(action==='addTicket'&&row>0)return;if(row<0)row=sheet.getLastRow()+1;writeTicket_(sheet,row,t);
}

function doGet(e){try{var p=e&&e.parameter||{};if(!authGet_(p))return jsonResponse({status:'error',message:'forbidden'});var action=String(p.action||'list'),sheet=ticketSheet_();
  if(action==='checkTicketExists')return jsonResponse({status:'ok',exists:findTicketRow_(sheet,p.id)>0});
  if(action==='getTicketById'){var row=findTicketRow_(sheet,p.id);return jsonResponse({status:'ok',ticket:row>0?ticketObjectAt_(sheet,row):null});}
  var out=[];if(sheet&&sheet.getLastRow()>1){for(var r=2;r<=sheet.getLastRow();r++)out.push(ticketObjectAt_(sheet,r));}return jsonResponse({status:'ok',tickets:out});
}catch(_){return jsonResponse({status:'error',message:'forbidden'});}}

function doPost(e){var businessLock=LockService.getScriptLock();try{var raw=e&&e.postData?String(e.postData.contents||''):'';if(raw.length>SECURE_AUTH_MAX_BODY_CHARS*2)return jsonResponse({status:'error',message:'request too large'});var body=authPost_(JSON.parse(raw||'{}'));if(body===null)return jsonResponse({status:'error',message:'forbidden'});var data=JSON.parse(body),action=String(data.action||'');if(!['addTicket','updateTicket','deleteTicket'].includes(action))return jsonResponse({status:'error',message:'unsupported action'});
  businessLock.waitLock(30000);mutateTicket_(action,data);SpreadsheetApp.flush();return jsonResponse({status:'ok'});
}catch(err){return jsonResponse({status:'error',message:String(err)});}finally{try{businessLock.releaseLock();}catch(_){}}}
