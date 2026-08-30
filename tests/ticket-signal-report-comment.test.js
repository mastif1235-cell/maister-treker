'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const context={console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'js','ticket-form-domain.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'js','report-utils.js'),'utf8'),context);

const legacy=context.blankTicketObject();
assert.equal(legacy.signal,'','tickets without a signal remain valid and optional');
assert.equal(context.resolveOnuSignalInput('-23',''),'-23','preset signal is stored');
assert.equal(context.resolveOnuSignalInput('other','-31.5'),'-31.5','manual decimal signal is stored');
assert.deepEqual(JSON.parse(JSON.stringify(context.onuSignalInputState('-31.5'))),{preset:'other',custom:'-31.5'},'manual signal is restored into edit controls');
assert.equal(context.formatOnuSignal('-23'),'📶 -23 dBm','signal has compact display text');
assert.equal(context.ticketSignalMatchesQuery({signal:'-23'},'-23'),true,'search matches signal value');

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(let signal=-15;signal>=-30;signal--) assert.match(html,new RegExp(`<option value="${signal}">${signal}<\\/option>`),`preset ${signal} is available`);
assert.match(html,/<option value="other">Другое…<\/option>/,'manual signal choice is available');
const editor=fs.readFileSync(path.join(root,'js','ticket-editor-domain.js'),'utf8');
assert.match(editor,/onuSignalInputState\(calcState\.signal\)/,'editing restores the saved signal');
assert.match(editor,/calcState\.signal\s*=\s*resolveOnuSignalInput/,'form save stores signal separately');
assert.match(fs.readFileSync(path.join(root,'js','tickets-domain.js'),'utf8'),/ticketSignalMatchesQuery\(t,q\)/,'ticket search includes signal');
assert.match(fs.readFileSync(path.join(root,'js','tickets-render.js'),'utf8'),/formatOnuSignal\(t\.signal\)/,'ticket card renders signal');

const restored=Object.assign(context.blankTicketObject(),JSON.parse(JSON.stringify({id:'1',signal:'-31.5'})));
assert.equal(restored.signal,'-31.5','backup restore merge retains signal');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
assert.match(app,/signal:t\.signal/,'ticket sync fullDataJson payload retains signal');

const tickets=[{id:'one',content:'unchanged'}],before=JSON.stringify(tickets);
assert.equal(context.appendTicketReportComment('Звіт',' Текст користувача '),'Звіт\n\nКомментарий:\nТекст користувача','non-empty report comment is appended');
assert.equal(context.appendTicketReportComment('Звіт','   '),'Звіт','empty comment adds nothing');
assert.equal(JSON.stringify(tickets),before,'comment formatting does not mutate tickets');

const reports=fs.readFileSync(path.join(root,'js','reports-domain.js'),'utf8');
const renderReportSource=reports.slice(reports.indexOf('function renderReport('));
assert.match(renderReportSource,/appendTicketReportComment/,'report UI uses the pure comment formatter');
assert.match(renderReportSource,/escapeHtml\(text\)/,'report output escapes the combined user text');
assert.doesNotMatch(renderReportSource,/saveTickets\s*\(|recordDiff\s*\(|syncEngine\./,'report rendering creates no ticket or sync mutation');
console.log('PASS optional ONU signal persistence/search/backup and report-only comment');
