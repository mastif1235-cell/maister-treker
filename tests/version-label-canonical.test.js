'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const patch=fs.readFileSync(path.join(root,'js','security-audit-fixes-v65-18-9.js'),'utf8');
const version=app.match(/const APP_VERSION\s*=\s*'([^']+)'/)[1];
assert.doesNotMatch(patch,/SECURITY_AUDIT_RELEASE_LABEL/,'security patch has no independent display release label');
assert.match(patch,/label\.textContent\s*=\s*`Версія застосунку: \$\{APP_VERSION\}`/,'late security wrapper uses canonical APP_VERSION');
const label={textContent:''};
const context={APP_VERSION:version,document:{getElementById:id=>id==='appVersionLabel'?label:null},renderSettingsScreen(){label.textContent='stale';return 'rendered';}};
vm.createContext(context);vm.runInContext(patch,context);
assert.equal(context.renderSettingsScreen(),'rendered');
assert.equal(label.textContent,`Версія застосунку: ${version}`,'settings ends with the canonical app version');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match=>match[1]);
const auditIndex=scripts.indexOf('js/security-audit-fixes-v65-18-9.js');
assert.ok(auditIndex>=0,'security audit patch is wired');
for(const src of scripts.slice(auditIndex+1)){
  const file=path.join(root,src);
  if(fs.existsSync(file)) assert.doesNotMatch(fs.readFileSync(file,'utf8'),/appVersionLabel/,'no later runtime wrapper replaces the canonical label');
}
console.log('PASS settings version label is sourced from APP_VERSION after all runtime wrappers');
