/* Parity tests: MCP tool outputs must match the REAL app logic on the same
   fixture data. The app's own modules (js/report-utils.js,
   js/ticket-form-domain.js) are loaded unmodified into a vm sandbox. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {loadAppModule} from '../helpers/appvm.js';
import {makeApp, mockGasFetch, toolCall, toolData} from '../helpers/mcpapp.js';
import {FIXTURES} from '../fixtures/data.js';

const reportUtilsRaw = loadAppModule('js/report-utils.js');
const formDomain = loadAppModule('js/ticket-form-domain.js');
/* Objects created inside the vm realm have the realm's Object.prototype, so
   host assert.deepStrictEqual would reject them on prototype identity.
   Round-trip through JSON to compare values, not realms. */
function hostValue(value){ return JSON.parse(JSON.stringify(value)); }
const reportUtils = {
  calculateTicketReportTotals: function(list){ return hostValue(reportUtilsRaw.calculateTicketReportTotals(list)); },
  reportParseDate: function(value){ return reportUtilsRaw.reportParseDate(value); },
  reportPeriodWindow: function(range, date){ return reportUtilsRaw.reportPeriodWindow(range, date); }
};

/* Verbatim replica of the app list predicate from renderMainTicketList
   (js/tickets-domain.js) — the filter runs on full local tickets. */
function appSearchPredicate(t, searchQuery){
  const q = searchQuery.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  return (t.content || '').toLowerCase().includes(q) ||
    (t.date || '').includes(q) ||
    (t.tags || []).some(function(tag){ return tag.toLowerCase().includes(q); }) ||
    (t.city || '').toLowerCase().includes(q) ||
    (t.address || '').toLowerCase().includes(q) ||
    (t.clientName || '').toLowerCase().includes(q) ||
    formDomain.ticketSignalMatchesQuery(t, q) ||
    (qDigits.length >= 3 && String(t.phone || '').replace(/\D/g, '').includes(qDigits)) ||
    (qDigits.length >= 3 && (t.extraPhones || []).some(function(p){ return String(p || '').replace(/\D/g, '').includes(qDigits); }));
}

/* Verbatim replica of ticketsForDate (js/tickets-domain.js). */
function appTicketsForDate(allTickets, dateStr){
  return allTickets.filter(function(t){ return t.date === dateStr; })
    .sort(function(a, b){ return (a.time || '').localeCompare(b.time || ''); });
}

const APP_TICKETS = FIXTURES.BASE_APP_TICKETS;

test('search parity: MCP search equals the app predicate on every probe query', async () => {
  const app = await makeApp(null, mockGasFetch('ok'));
  const queries = ['ремонт', 'Шевченка', 'шевченка', 'Ковальчук', 'Дніпро', 'монтаж',
    '0671234567', '1234567', '2223344', '-67', '-52', '-67.5', '15.09.2026', '2026',
    'домофон', 'ТОВ', 'неттакогослова'];
  for(const query of queries){
    const mcp = toolData((await toolCall(app, 'search_tickets', {query})).result);
    const mcpIds = mcp.tickets.map(function(t){ return t.id; }).sort();
    const appIds = APP_TICKETS.filter(function(t){ return appSearchPredicate(t, query); })
      .map(function(t){ return t.id; }).sort();
    assert.deepEqual(mcpIds, appIds, 'query: ' + query);
  }
});

test('by-date parity: same ids and the same time-ascending order as the app', async () => {
  const app = await makeApp(null, mockGasFetch('ok'));
  for(const date of ['15.09.2026', '16.09.2026', '01.08.2026', '05.05.2001']){
    const mcp = toolData((await toolCall(app, 'get_tickets_by_date', {date})).result);
    const appIds = appTicketsForDate(APP_TICKETS, date).map(function(t){ return t.id; });
    assert.deepEqual(mcp.tickets.map(function(t){ return t.id; }), appIds, date);
  }
});

test('reports parity: per-day and range totals equal calculateTicketReportTotals on the app side', async () => {
  const app = await makeApp(null, mockGasFetch('ok'));
  const mcp = toolData((await toolCall(app, 'get_reports', {date_from:'01.08.2026', date_to:'16.09.2026'})).result);

  const byDay = new Map();
  for(const t of APP_TICKETS){
    if(!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  for(const day of mcp.days){
    const appDayList = byDay.get(day.date) || [];
    assert.deepEqual(
      {count:day.count, total:day.total, cashTotal:day.cashTotal, cardTotal:day.cardTotal},
      reportUtils.calculateTicketReportTotals(appDayList),
      'day ' + day.date
    );
  }
  assert.deepEqual(mcp.totals, reportUtils.calculateTicketReportTotals(APP_TICKETS));
});

test('statistics parity: day/week/month/all totals match app period windows', async () => {
  const app = await makeApp(null, mockGasFetch('ok'));
  const anchor = '16.09.2026';
  const ref = reportUtils.reportParseDate(anchor);

  const cases = [
    ['day', APP_TICKETS.filter(function(t){ return t.date === anchor; })],
    ['all', APP_TICKETS]
  ];
  const week = reportUtils.reportPeriodWindow('week', anchor);
  cases.push(['week', APP_TICKETS.filter(function(t){
    const d = reportUtils.reportParseDate(t.date);
    return d && d >= week.start && d <= week.end;
  })]);
  const month = reportUtils.reportPeriodWindow('month', anchor);
  cases.push(['month', APP_TICKETS.filter(function(t){
    const d = reportUtils.reportParseDate(t.date);
    return d && d >= month.start && d <= month.end;
  })]);

  for(const [period, expectedList] of cases){
    const mcp = toolData((await toolCall(app, 'get_statistics', {period, anchor_date:anchor})).result);
    assert.deepEqual(mcp.totals, reportUtils.calculateTicketReportTotals(expectedList), period);
  }

  // Week window boundaries mirror the app (anchor - 6 days .. anchor).
  const statsWeek = toolData((await toolCall(app, 'get_statistics', {period:'week', anchor_date:anchor})).result);
  assert.equal(statsWeek.window.date_from, '10.09.2026');
  assert.equal(statsWeek.window.date_to, '16.09.2026');
  assert.equal(ref.getDate(), 16);
});

test('date handling parity: DD.MM.YYYY strings are the canonical keys in both worlds', () => {
  // The app formats dates via core-utils formatDate; fixtures reuse those
  // exact strings, so MCP grouping keys must equal app date strings.
  for(const t of APP_TICKETS){
    assert.match(t.date, /^\d{2}\.\d{2}\.\d{4}$/);
  }
  const report = reportUtils.calculateTicketReportTotals(APP_TICKETS.filter(function(t){ return t.date === '16.09.2026'; }));
  assert.equal(report.count, 2);
});
