'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const renderer=fs.readFileSync(path.join(root,'js','settings-render.js'),'utf8');
const version=app.match(/const APP_VERSION\s*=\s*'([^']+)'/)[1];
assert.match(renderer,/appVersionLabel'\)\.textContent\s*=\s*`Версія застосунку: \$\{APP_VERSION\}`/,'settings renderer owns the canonical version label');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1]);
const rendererIndex=scripts.indexOf('js/settings-render.js');
assert.ok(rendererIndex>=0,'settings renderer is wired');
let versionOwners=0;
for(const src of scripts){
  const file=path.join(root,src);
  if(!fs.existsSync(file)) continue;
  const source=fs.readFileSync(file,'utf8');
  if(/appVersionLabel/.test(source)){
    versionOwners++;
    assert.equal(src,'js/settings-render.js','only the settings renderer writes the version label');
  }
  if(src!== 'js/settings-render.js') assert.doesNotMatch(source,/\brenderSettingsScreen\s*=(?!=)/,'no runtime wrapper replaces the settings renderer');
}
assert.equal(versionOwners,1,'one canonical version-label owner');
assert.ok(scripts.indexOf('js/security-audit-fixes-v65-18-9.js')>rendererIndex,'security runtime still loads after settings renderer');
const label={textContent:''},elements=new Map([['appVersionLabel',label]]);
const context={APP_VERSION:version,settings:{tgDispatchers:[]},window:{},document:{getElementById(id){if(!elements.has(id))elements.set(id,{classList:{toggle(){}},value:'',checked:false,textContent:''});return elements.get(id);}},ensureSettingsHub(){},renderDeletedTicketsList(){},renderTagMgmtList(){},renderQuickDialMgmtList(){},renderCityMgmtList(){},renderCwMgmtList(){},renderMatMgmtList(){},renderWorkMgmtList(){},renderCableMgmtList(){},renderMasterMgmtList(){},renderDailyBackupList(){},renderMapMarkerPreferences(){},renderBackupPasswordStatus(){}};
vm.createContext(context);
vm.runInContext(renderer.slice(0,renderer.indexOf('function renderMapMarkerPreferences()')),context);
context.renderSettingsScreen();
assert.equal(label.textContent,`Версія застосунку: ${version}`,'rendered UI shows the canonical app version');
console.log('PASS settings version label has one canonical owner and renders APP_VERSION');
