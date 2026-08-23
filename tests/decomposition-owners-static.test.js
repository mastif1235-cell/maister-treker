'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const files=['app.js',...fs.readdirSync(path.join(root,'js')).filter(f=>f.endsWith('.js')).map(f=>`js/${f}`)],source=files.map(read).join('\n'),html=read('index.html');
for(const name of ['formatUaDate','parseBackupNote','showVizitka','showDogovor','printDogovorAsPdf','buildDogovorText','shareTicket','copyTicketText','sharePhoto','shareCurrentTicket','openExportModal','downloadExport','openImportModal','dedupTickets','repairCorruptedTickets','runBulkImport','openReportModal','renderReport'])assert.equal((source.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`,'g'))||[]).length,1,`${name} must have one owner`);
assert.ok(html.indexOf('js/app-format-utils.js')<html.indexOf('app.js'));assert.ok(html.indexOf('app.js')<html.indexOf('js/qr-share-domain.js'));assert.ok(html.indexOf('js/reports-domain.js')<html.indexOf('js/security-hardening.js'));
console.log('PASS decomposition owners and bootstrap order');
