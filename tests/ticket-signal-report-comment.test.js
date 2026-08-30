'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const context={console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'js','ticket-form-domain.js'),'utf8'),context);
context.fmtMoney=value=>`${value} грн`;
vm.runInContext(fs.readFileSync(path.join(root,'js','finance-utils.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'js','report-utils.js'),'utf8'),context);

const legacy=context.blankTicketObject();
assert.equal(legacy.signal,'','tickets without a signal remain valid and optional');
assert.equal(context.resolveOnuSignalInput('-23',''),'-23','preset signal is stored');
assert.equal(context.resolveOnuSignalInput('other','-31.5'),'-31.5','manual decimal signal is stored');
assert.deepEqual(JSON.parse(JSON.stringify(context.onuSignalInputState('-31.5'))),{preset:'other',custom:'-31.5'},'manual signal is restored into edit controls');
assert.equal(context.formatOnuSignal('-23'),'📶 -23 dBm','signal has compact display text');
assert.equal(context.ticketSignalMatchesQuery({signal:'-23'},'-23'),true,'search matches signal value');

const contentBase={type:'Ремонт',date:'30.08.2026',time:'10:00',contractNumber:'',city:'Київ',address:'Тестова 1',clientName:'Тест',phone:'0500000000',macAddress:'AA:BB:CC',signal:'-20',payment:'Готівка',callFee:0,tariff:0,equipment:[],cables:[],presetWorks:[],additionalWork:[],note:''};
const contentWithSignal=context.buildTicketContent(contentBase,0);
assert.match(contentWithSignal,/🔧 MAC ONU: AA:BB:CC\n📶 Сигнал ONU: -20 dBm\n------------------/,'content places ONU signal immediately after MAC');
assert.equal((contentWithSignal.match(/Сигнал ONU:/g)||[]).length,1,'content contains one ONU signal row');
assert.doesNotMatch(context.buildTicketContent({...contentBase,signal:''},0),/Сигнал ONU|dBm/,'empty signal adds no row');
assert.match(context.buildTicketContent({...contentBase,macAddress:'',signal:'-20.5'},0),/📞 Тел: 0500000000\n📶 Сигнал ONU: -20.5 dBm\n------------------/,'signal without MAC remains in the client technical block');

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(let signal=-15;signal>=-30;signal--) assert.match(html,new RegExp(`<option value="${signal}">${signal}<\\/option>`),`preset ${signal} is available`);
assert.match(html,/<option value="other">Другое…<\/option>/,'manual signal choice is available');
const editor=fs.readFileSync(path.join(root,'js','ticket-editor-domain.js'),'utf8');
assert.match(editor,/onuSignalInputState\(calcState\.signal\)/,'editing restores the saved signal');
assert.match(editor,/calcState\.signal\s*=\s*resolveOnuSignalInput/,'form save stores signal separately');
assert.match(fs.readFileSync(path.join(root,'js','tickets-domain.js'),'utf8'),/ticketSignalMatchesQuery\(t,q\)/,'ticket search includes signal');
const ticketRenderer=fs.readFileSync(path.join(root,'js','tickets-render.js'),'utf8');
assert.match(ticketRenderer,/formatOnuSignal\(t\.signal\)/,'ticket details format the saved signal');
const rendererContext={console};
vm.createContext(rendererContext);
vm.runInContext(ticketRenderer,rendererContext);
const splitDetails=rendererContext.splitTicketContentForTechnicalDetails([
  '📋 ЗАЯВКА: РЕМОНТ','📅 30.08.2026 10:00','🏙️ Місто: Київ','📍 Адреса: Тестова 1',
  '👤 Клієнт: Тест','📞 Тел: 0500000000','🔧 MAC ONU: AA:BB:CC','📶 Сигнал ONU: -20 dBm',
  '------------------','💎 Виклик: 100 грн'
].join('\n'));
assert.equal(splitDetails.before.split('\n').at(-1),'📞 Тел: 0500000000','subscriber block ends with the client phone');
assert.equal(splitDetails.after.split('\n')[0],'------------------','remaining ticket data starts with the separator');
assert.doesNotMatch(splitDetails.before+splitDetails.after,/MAC ONU|Сигнал ONU|dBm/,'technical rows are removed from general text to prevent duplication');
const cardHead=ticketRenderer.slice(ticketRenderer.indexOf('<div class="tc-head">'),ticketRenderer.indexOf('<div class="tc-details'));
assert.doesNotMatch(cardHead,/signalText|Сигнал ONU|MAC:/,'collapsed ticket card header does not show MAC or ONU signal');
const cardDetails=ticketRenderer.slice(ticketRenderer.indexOf('<div class="tc-details'));
const beforePosition=cardDetails.indexOf('detailContent.before');
const macPosition=cardDetails.indexOf('MAC:');
const signalPosition=cardDetails.indexOf('📶 Сигнал ONU:');
const afterPosition=cardDetails.indexOf('detailContent.after');
assert.ok(beforePosition>=0 && macPosition>beforePosition && signalPosition>macPosition && afterPosition>signalPosition,'expanded technical details place MAC and ONU signal between subscriber phone and remaining data');
assert.match(cardDetails,/signalText \? `<div>📶 Сигнал ONU:/,'missing signal produces no empty technical row');

const restored=Object.assign(context.blankTicketObject(),JSON.parse(JSON.stringify({id:'1',signal:'-31.5'})));
assert.equal(restored.signal,'-31.5','backup restore merge retains signal');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
assert.match(app,/signal:t\.signal/,'ticket sync fullDataJson payload retains signal');

const telegramContext={console};
vm.createContext(telegramContext);
const telegramSource=fs.readFileSync(path.join(root,'js','photo-telegram-domain.js'),'utf8');
vm.runInContext(telegramSource,telegramContext);
const dispatcherText=telegramContext.dispatcherTicketText('Заявка\nMAC: AA:BB\n📶 Сигнал ONU: -23 dBm\nsignal: -23\nonuSignal: -23\nРоботи виконано');
assert.equal(dispatcherText,'Заявка\nMAC: AA:BB\nРоботи виконано','dispatcher text excludes all ONU signal representations');
assert.match(telegramContext.buildTelegramBackupText({content:contentWithSignal}),/📶 Сигнал ONU: -20 dBm/,'personal Telegram backup text includes ONU signal through content');
assert.match(telegramSource,/sendToTelegramChat\(id2, dispatcherTicketText\(t\.content\)/,'saved-ticket dispatcher path sanitizes text');
assert.match(telegramSource,/const text = dispatcherTicketText\(getCurrentTicketText\(\)\)/,'current-form dispatcher path sanitizes text');

const tickets=[{id:'one',content:'unchanged'}],before=JSON.stringify(tickets);
assert.equal(context.appendTicketReportComment('Звіт',' Текст користувача '),'Звіт\n\nКомментарий:\nТекст користувача','non-empty report comment is appended');
assert.equal(context.appendTicketReportComment('Звіт','   '),'Звіт','empty comment adds nothing');
assert.equal(JSON.stringify(tickets),before,'comment formatting does not mutate tickets');

const reports=fs.readFileSync(path.join(root,'js','reports-domain.js'),'utf8');
const renderReportSource=reports.slice(reports.indexOf('function renderReport('));
const commentPosition=reports.indexOf('id="reportCommentInput"');
const copyPosition=reports.indexOf('id="copyReportBtn"');
const sharePosition=reports.indexOf('id="shareReportBtn"');
assert.ok(commentPosition>=0 && copyPosition>commentPosition && sharePosition>copyPosition,'report comment is directly before copy/share actions');
assert.match(renderReportSource,/appendTicketReportComment/,'report UI uses the pure comment formatter');
assert.match(renderReportSource,/escapeHtml\(text\)/,'report output escapes the combined user text');
assert.doesNotMatch(renderReportSource,/saveTickets\s*\(|recordDiff\s*\(|syncEngine\./,'report rendering creates no ticket or sync mutation');
console.log('PASS optional ONU signal persistence/search/backup and report-only comment');
