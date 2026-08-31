'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),core=require('../js/tools-core.js'),backup=require('../js/backup-system.js');

const tickets=[
  {id:'1',city:'Гірник',street:'Миру',house:'12',apartment:'1',geoLink:'https://maps.google.com/?q=48.1001,37.2001'},
  {id:'2',city:'Гірник',street:'Миру',house:'12',apartment:'2',geoLink:'48.1001,37.2001'},
  {id:'3',city:'Гірник',street:'Шахтарська',house:'8',apartment:'',geoLink:'https://maps.google.com/@48.2,37.3,17z'}
];
tickets.push({id:'4',city:'Гірник',street:'Нова',house:'3',apartment:'',geoLink:'https://maps.app.goo.gl/opaque-short-link',geoLat:48.3,geoLng:37.4});
const profiles=core.listProfiles(tickets);
assert.equal(profiles.length,4,'existing ticket address system remains the source of profiles');
assert.equal(core.addressLabel(profiles[0]).includes('Гірник'),true);
assert.deepEqual(core.parseCoordinates('50.4501, 30.5234'),{lat:50.4501,lng:30.5234});
assert.deepEqual(core.parseCoordinates('https://maps.google.com/@48.2,37.3,17z'),{lat:48.2,lng:37.3});
assert.equal(core.parseCoordinates('https://maps.app.goo.gl/opaque-short-link'),null,'opaque links are not fabricated into coordinates');

const network=core.normalizeNetworkPoint({name:'FOB 7',type:'FOB',lat:'48.25',lng:'37.35',note:'ремонт'},new Date('2026-08-30T10:00:00Z'));
assert.equal(network.lat,48.25);assert.equal(network.type,'FOB');
const objects=core.mapObjects(tickets,[network]);
assert.equal(objects.filter(item=>item.kind==='home').length,3,'structured coordinates map opaque links without a second house database');
assert.equal(objects.find(item=>item.kind==='home'&&item.profiles.length===2).profiles.length,2,'multi-apartment marker retains both existing profiles');
assert.equal(objects.filter(item=>item.kind==='network').length,1);
assert.equal(objects.find(item=>item.kind==='home'&&item.profiles.length===2).category,'apartment');
assert.equal(objects.find(item=>item.kind==='home'&&item.profiles.length===1).category,'private');
assert.equal(objects.find(item=>item.kind==='network').category,'FOB');
assert.equal(core.filterMapObjects(objects,['FOB']).length,1,'map filters affect presentation only');
assert.equal(objects.length,4,'filtering does not mutate source map objects');

const result={online:true,publicIp:'203.0.113.4',ipFamily:'IPv4',ipv4:true,resources:[{label:'HTTPS',ok:true,httpMs:24,status:200}],latencyMs:25,jitterMs:3};
const profile=core.profileFromTickets([tickets[0]]),record=core.makeDiagnosticRecord(result,profile,new Date('2026-08-30T10:00:00Z'));
assert.equal(record.profileId,profile.id);assert.equal(record.result.latencyMs,25);
const previous=core.makeDiagnosticRecord({...result,latencyMs:20},profile,new Date('2026-08-29T10:00:00Z'));
assert.deepEqual(core.diagnosticComparison(record,previous).find(item=>item.key==='latencyMs'),{key:'latencyMs',label:'HTTP latency',unit:'мс',from:20,to:25});
assert.match(core.diagnosticReport(result,null,new Date('2026-08-30T10:00:00Z')),/HTTP latency: 25 мс/);
assert.doesNotMatch(core.diagnosticReport(result,null,new Date('2026-08-30T10:00:00Z')),/Адреса:/,'quick report carries no address');

const oldPayload={app:'master-tracker',backupVersion:6,tickets:[],shifts:[],settings:{theme:'dark'}};
const newPayload={...oldPayload,diagnostics:[record],networkPoints:[network]};
assert.equal(backup.validatePayload(oldPayload),true,'legacy backup remains valid');
assert.equal(backup.validatePayload(newPayload),true,'backup accepts diagnostics and network points');
assert.equal(backup.validatePayload({...oldPayload,networkPoints:{}}),false,'new collections have bounded array schema');

const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),domain=fs.readFileSync(path.join(root,'js','tools-domain.js'),'utf8'),backupSource=fs.readFileSync(path.join(root,'js','backup-system.js'),'utf8');
assert.match(html,/data-tab="tools"/);assert.match(html,/id="calcDiagnosticsBtn"/);assert.match(html,/https:\/\/api64\.ipify\.org/);
assert.match(domain,/toolsDiagnosticResult=null/,'opening diagnostics starts without a saved result');
assert.match(domain,/toolsDiagnostics\.push\(record\)/,'only explicit save path adds history');
assert.match(domain,/navigator\.clipboard\.writeText\(report\)/,'copy path is present');
assert.doesNotMatch(domain,/syncEngine\.|syncAll/,'tools never trigger bulk or direct sync-engine operations');
assert.match(domain,/await saveTickets\(\)/,'address coordinates persist only after explicit confirmation');
assert.match(domain,/sendToTelegramChat\(chatId,text,photos\[0\]/,'network point Telegram sharing reuses the existing explicit transport');
assert.match(domain,/storePhoto\(canvas\.toDataURL/,'network point photos reuse the existing photo store');
assert.match(backupSource,/diagnostics:tools\.diagnostics/);assert.match(backupSource,/networkPoints:tools\.networkPoints/);
assert.match(backupSource,/toolsRestoreData/,'restore includes optional local tools data');
assert.match(backupSource,/toolsPhotoOwnerRecords/,'full backup collects network-point photos from the shared photo store');
assert.match(backupSource,/photoDbPut\(key,value\)/,'full restore writes shared photos before restoring points');
assert.match(domain,/https:\/\/speed\.cloudflare\.com\//,'unsupported speed values open a real external test instead of fabricating metrics');
assert.doesNotMatch(domain,/\['IPv6',r\.ipv6/,'IPv6 is not shown in the primary diagnostics UI');
console.log('PASS tools diagnostics/profile/map/network-point/backup compatibility');
