'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const ui=read('js/ui-orchestration.js'),tools=require('./helpers/tools-source').readToolsSource(),tickets=read('js/tickets-domain.js'),bindings=read('js/tickets-bindings.js'),editor=read('js/ticket-editor-domain.js'),address=read('js/ticket-address-domain.js'),map=read('js/tools-map.js'),html=read('index.html');

const navSource=ui.slice(ui.indexOf('const appNavigationStack=[];'),ui.indexOf('const SCREEN_TITLES'));
const backNode={classList:{hidden:true,toggle(_name,value){this.hidden=value;}}};
const context={escapeHtml:value=>String(value),document:{getElementById:id=>id==='appBackBtn'?backNode:null}};
vm.createContext(context);vm.runInContext(navSource,context);
assert.equal(context.appNavigationCanGoBack(),false,'NAV-7 empty stack stays empty');
assert.equal(context.appNavigationBack(),false,'NAV-7 empty stack does not invent a fallback');
let restored=null;context.appNavigationPush('one',state=>{restored=state;},{query:'FOB'});
assert.equal(context.appNavigationCanGoBack(),true);assert.equal(backNode.classList.hidden,false);
assert.equal(context.appNavigationBack(),true);assert.deepEqual(JSON.parse(JSON.stringify(restored)),{query:'FOB'});assert.equal(context.appNavigationCanGoBack(),false);
let guarded=false;context.appNavigationPush('guarded',()=>{guarded=true;},{},()=>false);assert.equal(context.appNavigationBack(),false);assert.equal(guarded,false,'NAV-8 rejected guard preserves editor and stack');

assert.match(html,/id="appBackBtn"[^>]*data-app-back/,'one consistent top-left Back control is wired');
assert.match(ui,/document\.addEventListener\('click',[\s\S]*\[data-app-back\][\s\S]*appNavigationBack/);
assert.match(tools,/toolsOpenProfileById[\s\S]*appNavigationPush\('map-profile'[\s\S]*renderToolsScreen\('map'\)/,'NAV-1 address Back restores map');
assert.match(map,/savedView=\{lat:center\.lat,lng:center\.lng,zoom:map\.getZoom\(\)\}/,'NAV-2 map viewport persists across render');
assert.match(tools,/appNavigationPush\('ticket-network-preview',[\s\S]*toolsOpenTicketNetworkPointPicker\(context\)/,'NAV-3 preview Back restores picker');
assert.match(tools,/const closePreview=\(\)=>\{appNavigationDrop\('ticket-network-preview'\)[\s\S]*ticketNetworkPointPreviewCloseBtn'\)\.onclick=closePreview/,'NAV-4 X closes instead of navigating Back');
assert.match(tickets,/openTicketEditorFromList[\s\S]*query:searchQuery[\s\S]*tags:\[\.\.\.activeFilterTags\][\s\S]*scrollTop/,'NAV-5 ticket list state is captured');
assert.match(tickets,/currentTicketDate=state\.date;searchQuery=state\.query[\s\S]*activeFilterTags=new Set[\s\S]*scrollTop=/,'NAV-5 ticket list state is restored');
assert.match(bindings,/appNavigationPeek\(\)\?\.key==='ticket-editor'[\s\S]*appNavigationBack\(\)/,'NAV-8 editor Back uses the guarded stack path');
assert.match(tickets,/leaveTicketEditorGuard[\s\S]*hasUnsavedChanges\(\)[\s\S]*confirm/,'NAV-8 unsaved editor is confirmed');
assert.match(tools,/function toolsNavigate[\s\S]*appNavigationPush\(`tools-\$\{view\}`[\s\S]*toolsView=from/,'NAV-6 nested tool Back restores Tools');
assert.match(address,/pushAddressNavigation[\s\S]*addrNavState:[\s\S]*scrollTop/,'address hierarchy keeps its prior level state');

assert.match(tools,/id="ticketNetworkPointCreateBtn"[^>]*>➕ Створити об’єкт/,'OBJ-1 create action is present in linking flow');
assert.match(tools,/toolsStartTicketNetworkPointCreation[\s\S]*toolsStartMapAddMode\(\)/,'OBJ-1 reuses map creation flow');
assert.match(tools,/returnToLinking:!!toolsLinkCreationContext/,'OBJ-1 reuses the ordinary network point editor');
assert.match(tools,/toolsReturnToTicketLinking\(normalized\.id\)/,'OBJ-2 save returns the real new ID');
assert.match(tools,/context\.newPointId=String\(newPointId\|\|''\)[\s\S]*toolsOpenTicketNetworkPointPicker\(context\)/,'OBJ-3 saved object returns highlighted to the same list');
assert.match(tools,/closePointEditor[\s\S]*if\(options\.returnToLinking\)toolsReturnToTicketLinking\(\)/,'OBJ-4 cancel returns without saving');
assert.match(tools,/MTToolsCore\.normalizeNetworkPoint[\s\S]*toolsSaveNetworkPoints\(\)/,'OBJ-5/6 creation retains canonical ID and storage path');
assert.match(tools,/ticketId:String\(editingTicketId\|\|'draft'\)/,'OBJ-7 linking origin context is retained without DOM snapshots');
assert.doesNotMatch(ui,/popstate|pushState/,'Android/browser Back is deliberately deferred; normal browser history is untouched');
assert.match(editor,/appNavigationDrop\('ticket-editor'\)/,'saving editor consumes stale Back entry');

console.log('PASS post-v91 internal Back stack and ticket network-object creation navigation');
