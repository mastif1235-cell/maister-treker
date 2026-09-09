'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(file,'utf8');

const app=read('app.js'),tickets=read('js/tickets-domain.js'),domain=require('./helpers/tools-source').readToolsSource(),styles=read('styles.css'),phone=read('js/phone-utils.js');
const payloadSource=app.slice(app.indexOf('function ticketToSyncPayload'),app.indexOf('function shiftToSyncPayload'));
const payloadContext={MTToolsCore:{googleMapsUrl:()=>'',networkPointIds:value=>value||[]},formatDate:()=>'',formatTime:()=>'',Date};vm.createContext(payloadContext);vm.runInContext(payloadSource,payloadContext);
const masterNote='рядок 1\nрядок 2\nрядок 3';
const payload=payloadContext.ticketToSyncPayload({id:'note-1',date:'06.09.2026',time:'12:00',content:'x',sum:0,tags:[],masterNote});
assert.equal(JSON.parse(payload.fullDataJson).masterNote,masterNote,'NOTE structured payload carries canonical masterNote');
assert.match(tickets,/structuredMasterNote[\s\S]*hasOwnProperty\.call\(fullData,'masterNote'\)/,'structured masterNote is detected explicitly');
assert.match(tickets,/masterNote:structuredMasterNote \? String\(fullData\.masterNote\|\|''\)/,'structured masterNote wins over fallback backup text');

assert.match(domain,/tools-map-service-controls[\s\S]*map-my-location[\s\S]*map-add-object/,'MAP-UI-4 service controls share the left mobile column');
assert.match(domain,/tools-map-fullscreen-control[\s\S]*map-toggle-fullscreen/,'MAP-UI-2 fullscreen owns a separate control position');
assert.match(styles,/@media \(max-width:430px\)\{[\s\S]*\.tools-map-service-controls\{left:calc\(10px \+ env\(safe-area-inset-left,0px\)\);right:auto;top:58px;\}[\s\S]*\.tools-map-fullscreen-control\{right:10px;bottom:/,'MAP-UI-1 mobile controls use non-overlapping safe-area-aware corners');
assert.match(styles,/\.tools-map-layer-switcher\{display:flex/,'MAP-UI-3 Map/Satellite remains the Leaflet top-right switcher');
assert.equal((styles.match(/@media \(max-width:430px\)\{/g)||[]).length,2,'MAP-UI-5 only the existing nav rule and one map rule target 430px');

assert.doesNotMatch(phone,/\(\?<!/,'phone parser has no negative lookbehind syntax');
const phoneContext={};vm.createContext(phoneContext);vm.runInContext(phone,phoneContext);
assert.equal(phoneContext.normalizePhoneKey(phoneContext.extractPhoneFromText('Телефон 067 123 45 67')),'671234567','PHONE-1/3 extracts a Ukrainian number from text');
assert.equal(phoneContext.normalizePhoneKey(phoneContext.extractPhoneFromText('+380671234567')),'671234567','PHONE-2 extracts +380');
assert.equal(phoneContext.extractPhoneFromText('1067123456789'),null,'PHONE-4 rejects a number embedded in extra digits');
assert.deepEqual(JSON.parse(JSON.stringify(phoneContext.extractPhoneCandidatesFromText('0671234567 або +380501112233'))),['671234567','501112233'],'PHONE-5 extracts multiple numbers');
console.log('PASS post-v91.1 multiline note, mobile map controls and phone compatibility regressions');
