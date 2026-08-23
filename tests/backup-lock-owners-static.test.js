'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const allJs=fs.readdirSync(path.join(root,'js')).filter(x=>x.endsWith('.js')).map(x=>read(`js/${x}`)).join('\n');
for(const name of ['exportJsonBackup','handleJsonImportFile','maybeRunDailyBackup','downloadDailyBackup','restoreDailyBackup'])assert.equal((allJs.match(new RegExp(`\\b${name}\\s*=\\s*async`, 'g'))||[]).length,1,`${name} must have one runtime owner`);
for(const name of ['openSetPasswordModal','ensureAppUnlocked','showLockScreen'])assert.equal((allJs.match(new RegExp(`\\b${name}\\s*=\\s*function`, 'g'))||[]).length,1,`${name} must have one runtime owner`);
const html=read('index.html'),sw=read('sw.js');
for(const old of ['security-backup-encryption.js','security-backup-vault.js','security-backup-vault-hub.js','security-backup-envelope-guard-v65-17.js','daily-physical-backup-v65-17-3.js']){assert.equal(html.includes(old),false);assert.equal(sw.includes(old),false);assert.equal(fs.existsSync(path.join(root,'js',old)),false);}
assert.ok(html.indexOf('js/app-lock-core.js')<html.indexOf('js/security-lock.js'));assert.ok(html.indexOf('js/backup-system.js')>html.indexOf('js/security-runtime-v65-9.js'));
console.log('PASS canonical backup/app-lock runtime owners and retired scripts');
