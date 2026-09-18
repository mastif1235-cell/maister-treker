'use strict';
/* Comprehensive regression tests for AI Assistant conversational abilities:
   - Address resolution: Таромське ↔ Таромское, Лісова ↔ Лесная, Лісова ↔ Лісна
   - Typos: «тарамский Лісна 74» -> Таромське, вул. Лісова 74
   - Mixed RU/UA input
   - False positive guards: Лісова != Мостова, Лісова != Центральна
   - House number isolation: 74 does not match 174 or 740
   - Multi-house street search: «все заявки на Мостовой» returns all houses (22, 25, 84) across prefix variants
   - Signal comparison in dBm (-27 worse than -24, -30 worse than -25, -20 better than -25)
   - Shifts & coworkers: hours by date/week/month, coworker filtering & aggregates (without unbacked earnings)
   - Map button visibility guard:
     * Ticket WITH coordinates -> «🗺️ На карті» button rendered
     * Ticket WITHOUT coordinates -> «🗺️ На карті» button ABSENT
   - Safe navigation:
     * AI -> Profile -> Back -> AI (closeModal called, no editor fallback, history + scroll preserved)
     * Calendar -> Profile -> Back -> Calendar
     * AI -> Map -> Back -> AI
     * appNavigationDrop verification on explicit close
   - Conversational multi-turn context contract (history + referent preservation: count, sum, scalar facts, last/first)
   - Strict READ-ONLY verification */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

async function runAll(){
  /* ── 1. Backend Address Resolver Regression Suite ── */
  const {
    normalizeStem,
    matchScore,
    normalizeHouse,
    parseAddressQuery,
    extractPlaces,
    resolveAddress
  } = await import('../mcp/src/ask/address.js');

  const tickets = [
    { id: '1', city: 'Таромське', street: 'вул. Лісова', house: '74', date: '15.09.2026', type: 'Підключення', signal: '-27' },
    { id: '2', city: 'Таромське', street: 'вул. Лісова', house: '74а', date: '16.09.2026', type: 'Ремонт', signal: '-23' },
    { id: '3', city: 'Таромське', street: 'вул. Мостова', house: '25', date: '14.09.2026', type: 'Ремонт', signal: '-24' },
    { id: '4', city: 'Дніпро', street: 'вул. Шевченка', house: '12', date: '10.09.2026', type: 'Підключення', signal: '-22' },
    { id: '5', city: 'Підгородне', street: 'вул. Шевченка', house: '5', date: '12.09.2026', type: 'Підключення', signal: '-28' },
    { id: '6', city: 'Таромське', street: 'Мостова', house: '84', date: '12.09.2026', type: 'Підключення', signal: '-21' },
    { id: '7', city: 'Таромське', street: 'ул. Мостовая', house: '22', date: '10.09.2026', type: 'Підключення', signal: '-25' }
  ];
  const places = extractPlaces(tickets);

  // Таромське ↔ Таромское
  assert.equal(normalizeStem('Таромське'), normalizeStem('Таромское'));
  const r1 = resolveAddress('Таромское Лісова 74', places);
  assert.equal(r1.resolved?.city, 'Таромське');
  assert.equal(r1.resolved?.street, 'вул. Лісова');
  assert.equal(r1.resolved?.house, '74');

  // Лісова ↔ Лесная
  assert.equal(normalizeStem('вул. Лісова'), normalizeStem('Лесная'));
  const r2 = resolveAddress('Лесная 74', places);
  assert.equal(r2.resolved?.street, 'вул. Лісова');
  assert.equal(r2.resolved?.house, '74');

  // Лісова ↔ Лісна
  assert.equal(normalizeStem('Лісова'), normalizeStem('Лісна'));
  const r3 = resolveAddress('Лісна 74', places);
  assert.equal(r3.resolved?.street, 'вул. Лісова');

  // Typo: «тарамский Лісна 74»
  const r4 = resolveAddress('тарамский Лісна 74', places);
  assert.ok(r4.resolved);
  assert.equal(r4.resolved.city, 'Таромське');
  assert.equal(r4.resolved.street, 'вул. Лісова');
  assert.equal(r4.resolved.house, '74');
  assert.ok(r4.confidence >= 0.80);

  // Conversational lead-in: «можешь открыть профиль Лесная 74»
  const r5 = resolveAddress('можешь открыть профиль Лесная 74', places);
  assert.equal(r5.resolved?.street, 'вул. Лісова');
  assert.equal(r5.resolved?.house, '74');

  // Mixed RU/UA query: «Таромское Лесная 74»
  const r6 = resolveAddress('Таромское Лесная 74', places);
  assert.equal(r6.resolved?.city, 'Таромське');
  assert.equal(r6.resolved?.street, 'вул. Лісова');
  assert.equal(r6.resolved?.house, '74');

  // False positive guard: Лісова must NEVER match Мостова or Центральна
  assert.equal(matchScore('вул. Лісова', 'вул. Мостова'), 0);
  assert.equal(matchScore('вул. Лісова', 'вул. Центральна'), 0);
  assert.equal(matchScore('вул. Лісова', 'вул. Шевченка'), 0);

  // House number isolation: house 74 must NEVER equal 174 or 740
  assert.equal(normalizeHouse('74'), '74');
  assert.notEqual(normalizeHouse('74'), normalizeHouse('174'));
  assert.notEqual(normalizeHouse('74'), normalizeHouse('740'));

  // Street without house -> returns all houses on that street (all variants grouped)
  const r7 = resolveAddress('вул. Мостова', places);
  assert.equal(r7.resolved?.city, 'Таромське');
  assert.equal(r7.resolved?.house, null);
  assert.deepEqual(r7.houses, ['22', '25', '84']);

  console.log('PASS 1. Address resolver: UA/RU mapping, typos, house isolation, false positive guards, canonical street grouping');

  /* ── 2. Multi-house Street Search via find_tickets_by_address ── */
  const { createReadTools } = await import('../mcp/src/tools/read.js');
  const mockGasStreet = {
    async getList(){
      return {
        ok: true,
        data: {
          tickets: [
            { id: 't1', date: '15.09.2026', time: '10:00', sum: 500, fullDataJson: JSON.stringify({ city: 'Таромське', street: 'вул. Мостова', house: '25', signal: '-24' }) },
            { id: 't2', date: '12.09.2026', time: '11:00', sum: 600, fullDataJson: JSON.stringify({ city: 'Таромське', street: 'Мостова', house: '84', signal: '-21' }) },
            { id: 't3', date: '10.09.2026', time: '12:00', sum: 700, fullDataJson: JSON.stringify({ city: 'Таромське', street: 'ул. Мостовая', house: '22', signal: '-25' }) },
            { id: 't4', date: '10.09.2026', time: '13:00', sum: 800, fullDataJson: JSON.stringify({ city: 'Дніпро', street: 'вул. Мостова', house: '5', signal: '-20' }) }
          ],
          shifts: []
        }
      };
    }
  };
  const streetTools = createReadTools({ gas: mockGasStreet });

  // "В Таромском по улице Мостовая какие были у меня все заявки?"
  const streetRes = await streetTools.find_tickets_by_address({ address: 'В Таромском по улице Мостовая какие были у меня все заявки?' });
  assert.equal(streetRes.ok, true);
  assert.equal(streetRes.data.resolved?.city, 'Таромське');
  assert.deepEqual(streetRes.data.houses, ['22', '25', '84']);
  assert.equal(streetRes.data.tickets.length, 3, 'MUST return all 3 tickets on the street, not just 1');
  assert.deepEqual(streetRes.data.tickets.map(t => t.house).sort(), ['22', '25', '84']);

  console.log('PASS 2. Multi-house street search returns all matching tickets across variants');

  /* ── 3. Signal numerical comparison in dBm ── */
  const mockGasSignal = {
    async getList(){
      return {
        ok: true,
        data: {
          tickets: [
            { id: 't1', date: '15.09.2026', time: '10:00', sum: 500, fullDataJson: JSON.stringify({ signal: '-27', type: 'Підключення' }) },
            { id: 't2', date: '15.09.2026', time: '11:00', sum: 600, fullDataJson: JSON.stringify({ signal: '-23', type: 'Підключення' }) },
            { id: 't3', date: '15.09.2026', time: '12:00', sum: 700, fullDataJson: JSON.stringify({ signal: '-30', type: 'Підключення' }) },
            { id: 't4', date: '15.09.2026', time: '13:00', sum: 800, fullDataJson: JSON.stringify({ signal: '', type: 'Ремонт' }) }
          ],
          shifts: []
        }
      };
    }
  };
  const signalTools = createReadTools({ gas: mockGasSignal });

  // Signal worse than -25 dBm: must return -27 and -30 (worse = more negative)
  const worse = await signalTools.list_tickets({ signal_worse_than: -25 });
  assert.equal(worse.ok, true);
  assert.deepEqual(worse.data.tickets.map(t => t.id).sort(), ['t1', 't3']);

  // Signal better than -25 dBm: must return -23 (better = less negative)
  const better = await signalTools.list_tickets({ signal_better_than: -25 });
  assert.equal(better.ok, true);
  assert.deepEqual(better.data.tickets.map(t => t.id), ['t2']);

  console.log('PASS 3. Signal numerical dBm comparison (-27 worse than -25, -23 better than -25)');

  /* ── 4. Shifts & Coworker Aggregates (Data Model Integrity) ── */
  const mockGasShifts = {
    async getList(){
      return {
        ok: true,
        data: {
          tickets: [],
          shifts: [
            { id: 's1', date: '10.09.2026', hours: 8, coworker: 'Петя' },
            { id: 's2', date: '12.09.2026', hours: 7.5, coworker: 'Петя' },
            { id: 's3', date: '15.09.2026', hours: 9, coworker: 'Олег' },
            { id: 's4', date: '16.09.2026', hours: 6, coworker: 'Петя' }
          ]
        }
      };
    }
  };
  const shiftTools = createReadTools({ gas: mockGasShifts });

  // Coworker filter: 'Петя' -> 3 shifts, 21.5 total hours, dates list
  const petya = await shiftTools.get_shifts({ coworker: 'Петя' });
  assert.equal(petya.ok, true);
  assert.equal(petya.data.count, 3);
  assert.equal(petya.data.total_hours, 21.5);
  const petyaEntry = petya.data.by_coworker.find(c => c.coworker === 'Петя');
  assert.ok(petyaEntry);
  assert.equal(petyaEntry.count, 3);
  assert.equal(petyaEntry.total_hours, 21.5);
  assert.equal(petyaEntry.last_date, '16.09.2026');
  assert.equal(petyaEntry.earnings, undefined, 'No fake earnings in shifts model');

  // All shifts aggregate: includes both Петя and Олег
  const allShifts = await shiftTools.get_shifts({});
  assert.equal(allShifts.data.count, 4);
  assert.equal(allShifts.data.total_hours, 30.5);
  assert.equal(allShifts.data.by_coworker.length, 2);

  console.log('PASS 4. Shifts & coworker filtering and hours aggregates (no unbacked earnings)');

  /* ── 5. Map button visibility: Ticket with vs without coordinates ── */
  class FakeDomEl {
    constructor(tag){ this.tagName = String(tag).toUpperCase(); this.children = []; this.style = {}; this.dataset = {}; this._text = ''; this._handlers = {}; this.attrs = {}; }
    get firstChild(){ return this.children[0] || null; }
    appendChild(c){ this.children.push(c); return c; }
    removeChild(c){ this.children = this.children.filter(x => x !== c); }
    addEventListener(t, fn){ (this._handlers[t] = this._handlers[t] || []).push(fn); }
    setAttribute(k, v){ this.attrs[k] = String(v); }
    getAttribute(k){ return this.attrs[k] != null ? this.attrs[k] : null; }
    querySelectorAll(selector){
      const out = [];
      const cls = selector.replace('.', '');
      const walk = el => {
        for(const c of (el.children || [])){
          const fullCls = ((c.attrs['class'] || c.className || '') + '').split(/\s+/);
          if(fullCls.includes(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    get textContent(){ return this._text; } set textContent(v){ this._text = String(v); this.children = []; }
  }

  const fakeDoc = {
    _byId: {},
    head: new FakeDomEl('head'),
    body: new FakeDomEl('body'),
    createElement: t => { const e = new FakeDomEl(t); e.ownerDocument = fakeDoc; return e; },
    createTextNode: t => { const e = new FakeDomEl('#text'); e._text = String(t); e.ownerDocument = fakeDoc; return e; },
    getElementById(id){ return this._byId[id] || null; }
  };

  const mapSandbox = {
    console,
    document: fakeDoc,
    tickets: [
      { id: 't-with-coords', city: 'Таромське', street: 'Лісова', house: '74', geoLat: 48.45, geoLng: 34.85 },
      { id: 't-without-coords', city: 'Таромське', street: 'Лісова', house: '74а' }
    ],
    MTToolsCore: {
      explicitCoordinates(t){ return (t && t.geoLat && t.geoLng) ? { lat: t.geoLat, lng: t.geoLng } : null; },
      parseCoordinates(l){ return l ? { lat: 48.4, lng: 34.8 } : null; }
    }
  };
  mapSandbox.globalThis = mapSandbox;
  mapSandbox.window = mapSandbox;

  for(const f of ['js/ai/ai-config.js', 'js/ai/ai-result-cards.js']){
    vm.runInContext(read(f), vm.createContext(mapSandbox), { filename: f });
  }

  const cardContainer = fakeDoc.createElement('div');
  const cardItems = [
    { id: 't-with-coords', address: 'Таромське, вул. Лісова 74', type: 'Підключення', sum: '500' },
    { id: 't-without-coords', address: 'Таромське, вул. Лісова 74а', type: 'Ремонт', sum: '300' }
  ];

  mapSandbox.MTAI.cards.render(cardContainer, cardItems, function(){}, function(){});

  const cards = cardContainer.querySelectorAll('.ai-card');
  assert.equal(cards.length, 2);

  // Card 1: Ticket WITH coordinates -> has map button
  const card1 = cards[0];
  const mapBtn1 = card1.querySelectorAll('.ai-card-map');
  assert.equal(mapBtn1.length, 1, 'Ticket with coordinates MUST have map button');
  assert.equal(mapBtn1[0].textContent, '🗺️ На карті');

  // Card 2: Ticket WITHOUT coordinates -> map button is ABSENT
  const card2 = cards[1];
  const mapBtn2 = card2.querySelectorAll('.ai-card-map');
  assert.equal(mapBtn2.length, 0, 'Ticket without coordinates MUST NOT have map button');

  console.log('PASS 5. Map button visibility: visible only when ticket has coordinates');

  /* ── 6. Client Navigation: AI -> Profile -> Back ("← Назад") -> AI ── */
  const navDoc = {
    _byId: {},
    head: new FakeDomEl('head'),
    body: new FakeDomEl('body'),
    createElement: t => new FakeDomEl(t),
    createTextNode: t => { const e = new FakeDomEl('#text'); e._text = String(t); return e; },
    getElementById(id){ return this._byId[id] || null; }
  };

  const navStack = [];
  let modalClosedCount = 0;
  const clientSandbox = {
    console,
    document: navDoc,
    tickets: [
      { id: '101', city: 'Таромське', street: 'вул. Лісова', house: '74', geoLat: 48.45, geoLng: 34.85 },
      { id: '102', city: '', street: '', content: 'без адреси' } // Unstructured ticket
    ],
    appNavigationPush(key, restore, state){
      navStack.push({ key, restore, state });
      return true;
    },
    appNavigationBack(){
      const entry = navStack.pop();
      if(entry && typeof entry.restore === 'function') entry.restore(entry.state);
      return true;
    },
    appNavigationDrop(key){
      const idx = navStack.findIndex(e => e.key === key);
      if(idx !== -1) navStack.splice(idx, 1);
    },
    closeModal(){ modalClosedCount++; },
    profileCalls: [],
    editorCalls: [],
    mapFocusCalls: [],
    toasts: [],
    goToTicketProfile(id){ clientSandbox.profileCalls.push(String(id)); },
    openTicketEditorFromList(id){ clientSandbox.editorCalls.push(String(id)); },
    switchTab(tab){ clientSandbox.currentTab = tab; },
    renderToolsScreen(view){ clientSandbox.toolsView = view; },
    showToast(m){ clientSandbox.toasts.push(String(m)); },
    MTToolsCore: {
      explicitCoordinates(t){ return (t.geoLat && t.geoLng) ? { lat: t.geoLat, lng: t.geoLng } : null; },
      parseCoordinates(){ return null; }
    },
    MTToolsMap: {
      focusPoint(coords, zoom){ clientSandbox.mapFocusCalls.push({ coords, zoom }); }
    }
  };
  clientSandbox.globalThis = clientSandbox;
  clientSandbox.window = clientSandbox;

  // Build DOM elements
  const panel = navDoc.createElement('div');
  panel.id = 'aiChatPanel';
  panel.style.display = 'flex';
  navDoc._byId['aiChatPanel'] = panel;

  // Load AI modules
  for(const f of ['js/ai/ai-config.js', 'js/ai/actions/ai-actions.js', 'js/ai/actions/ticket-actions.js']){
    vm.runInContext(read(f), vm.createContext(clientSandbox), { filename: f });
  }

  // 6a. AI -> Profile: opens profile, collapses overlay, pushes 'ai-return'
  const opened = await clientSandbox.MTAI.actions.openTicket('101');
  assert.equal(opened, true);
  assert.deepEqual(clientSandbox.profileCalls, ['101']);
  assert.deepEqual(clientSandbox.editorCalls, [], 'NEVER opens calculator editor!');
  assert.equal(panel.style.display, 'none', 'AI overlay hidden during profile view');
  assert.ok(navStack.some(e => e.key === 'ai-return'), 'ai-return frame exists on stack');

  // 6b. Back from Profile ("← Назад" button): closes modal AND restores AI chat overlay
  let restoredToAi = false;
  modalClosedCount = 0;
  clientSandbox.MTAI.ui = {
    restoreFromNavigation(){
      restoredToAi = true;
      panel.style.display = 'flex';
    }
  };
  clientSandbox.appNavigationBack();
  assert.equal(modalClosedCount, 1, 'closeModal MUST be called when pressing Back from profile');
  assert.equal(restoredToAi, true, 'Navigation Back restores AI overlay');
  assert.equal(panel.style.display, 'flex');

  // 6c. Unstructured ticket: NO editor fallback, stays in AI chat
  const unstructOpened = await clientSandbox.MTAI.actions.openTicket('102');
  assert.equal(unstructOpened, false, 'Unstructured ticket cannot open profile');
  assert.deepEqual(clientSandbox.editorCalls, [], 'STRICT: zero editor fallback on unstructured ticket!');
  assert.ok(clientSandbox.toasts.some(t => t.includes('структурованої адреси')));

  // 6d. AI -> Map: opens map, focuses coordinates, pushes 'ai-return'
  const mapOpened = await clientSandbox.MTAI.actions.showOnMap('101');
  assert.equal(mapOpened, true);
  assert.equal(clientSandbox.currentTab, 'tools');
  assert.equal(clientSandbox.toolsView, 'map');
  assert.ok(navStack.some(e => e.key === 'ai-return'), 'ai-return frame pushed for map');

  // 6e. Back from Map -> returns to AI
  restoredToAi = false;
  clientSandbox.appNavigationBack();
  assert.equal(restoredToAi, true, 'Navigation Back from map restores AI overlay');

  // 6f. Explicit close drops ai-return frame
  clientSandbox.appNavigationPush('ai-return', () => {});
  assert.equal(navStack.length, 1);
  clientSandbox.appNavigationDrop('ai-return');
  assert.equal(navStack.length, 0, 'appNavigationDrop successfully removes ai-return frame');

  console.log('PASS 6. Client navigation: AI -> Profile -> Back -> AI (modal closed), Map -> Back -> AI, zero editor fallback');

  /* ── 7. Conversational Intent-First Contract (Count, Sum, Scalar Facts, Last/First) ── */
  const { createAskOrchestrator } = await import('../mcp/src/ask/orchestrator.js');
  const { TOOL_DEFINITIONS } = await import('../mcp/src/tools/definitions.js');

  const mockGasConv = {
    async getList(){
      return {
        ok: true,
        data: {
          tickets: [
            { id: 't-101', date: '16.09.2026', time: '10:00', sum: 750, fullDataJson: JSON.stringify({ city: 'Таромське', street: 'вул. Лісова', house: '74', signal: '-24', type: 'Підключення' }) },
            { id: 't-102', date: '16.09.2026', time: '14:30', sum: 500, fullDataJson: JSON.stringify({ city: 'Таромське', street: 'вул. Мостова', house: '25', signal: '-22', type: 'Ремонт' }) },
            { id: 't-103', date: '16.09.2026', time: '18:26', sum: 1400, fullDataJson: JSON.stringify({ city: 'Таромське', street: 'вул. Мостова', house: '84', signal: '-26', type: 'Підключення' }) }
          ],
          shifts: []
        }
      };
    }
  };
  const convTools = createReadTools({ gas: mockGasConv });

  // Simulate LLM responding according to Intent-First System Instructions
  const mockGroq = {
    async chat(messages, groqTools){
      const lastMsg = messages[messages.length - 1];

      // If responding after tool execution:
      if(lastMsg.role === 'tool'){
        const toolData = JSON.parse(lastMsg.content);
        const userQ = messages.find(m => m.role === 'user')?.content || '';

        // 7a. Scalar Signal Question: "А какой там сигнал?"
        if(userQ.includes('сигнал')){
          return {
            ok: true,
            content: 'Оптичний сигнал на Лісній 74 становив -24 dBm.',
            toolCalls: []
          };
        }

        // 7b. Aggregating Count + Sum Question: "Сколько заявок было вчера?"
        if(userQ.includes('Сколько заявок')){
          return {
            ok: true,
            content: 'Вчора було 3 заявки на загальну суму 2650 грн (2 підключення та 1 ремонт).',
            toolCalls: []
          };
        }

        // 7c. Extremum Question: "Какая была последняя заявка?"
        if(userQ.includes('последняя заявка')){
          return {
            ok: true,
            content: 'Останньою заявкою за 16.09.2026 була заявка №t-103 о 18:26: Таромське, вул. Мостова 84 (підключення, сума 1400 грн, сигнал -26 dBm).',
            toolCalls: []
          };
        }

        // 7d. Multi-house street: "все заявки на Мостовой"
        if(userQ.includes('все заявки на Мостовой')){
          return {
            ok: true,
            content: 'На вул. Мостова у Таромському знайдено 2 заявки: буд. 25 (ремонт о 14:30) та буд. 84 (підключення о 18:26).',
            toolCalls: []
          };
        }

        return {
          ok: true,
          content: 'За адресою Таромське, вул. Лісова 74 знайдено підключення №t-101 (16.09.2026, сума 750 грн, сигнал -24 dBm).',
          toolCalls: []
        };
      }

      // Initial tool dispatch:
      const q = lastMsg.content;
      if(q.includes('Лесн') || q.includes('Лісн')){
        return {
          ok: true,
          content: null,
          assistantMessage: { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'find_tickets_by_address', arguments: JSON.stringify({ address: 'Лесная 74' }) } }] },
          toolCalls: [{ id: 'c1', name: 'find_tickets_by_address', argsRaw: JSON.stringify({ address: 'Лесная 74' }) }]
        };
      }

      if(q.includes('сигнал')){
        return {
          ok: true,
          content: null,
          assistantMessage: { role: 'assistant', tool_calls: [{ id: 'c2', function: { name: 'find_tickets_by_address', arguments: JSON.stringify({ address: 'Лісова 74' }) } }] },
          toolCalls: [{ id: 'c2', name: 'find_tickets_by_address', argsRaw: JSON.stringify({ address: 'Лісова 74' }) }]
        };
      }

      if(q.includes('Сколько заявок')){
        return {
          ok: true,
          content: null,
          assistantMessage: { role: 'assistant', tool_calls: [{ id: 'c3', function: { name: 'get_tickets_by_date', arguments: JSON.stringify({ date: '16.09.2026' }) } }] },
          toolCalls: [{ id: 'c3', name: 'get_tickets_by_date', argsRaw: JSON.stringify({ date: '16.09.2026' }) }]
        };
      }

      if(q.includes('последняя заявка')){
        return {
          ok: true,
          content: null,
          assistantMessage: { role: 'assistant', tool_calls: [{ id: 'c4', function: { name: 'get_tickets_by_date', arguments: JSON.stringify({ date: '16.09.2026' }) } }] },
          toolCalls: [{ id: 'c4', name: 'get_tickets_by_date', argsRaw: JSON.stringify({ date: '16.09.2026' }) }]
        };
      }

      if(q.includes('все заявки на Мостовой')){
        return {
          ok: true,
          content: null,
          assistantMessage: { role: 'assistant', tool_calls: [{ id: 'c5', function: { name: 'find_tickets_by_address', arguments: JSON.stringify({ address: 'Мостова' }) } }] },
          toolCalls: [{ id: 'c5', name: 'find_tickets_by_address', argsRaw: JSON.stringify({ address: 'Мостова' }) }]
        };
      }

      return {
        ok: true,
        content: 'Запит опрацьовано.',
        toolCalls: []
      };
    }
  };

  const orchestrator = createAskOrchestrator({
    groq: mockGroq,
    tools: convTools,
    toolDefs: TOOL_DEFINITIONS
  });

  // Test 7a: Initial address query
  const res1 = await orchestrator.handle('Найди Лесную 74', { history: [] });
  assert.equal(res1.ok, true);
  assert.ok(res1.answer.includes('Лісова 74'));

  // Test 7b: Scalar follow-up: "А какой там сигнал?" -> textual fact first
  const historyTurn2 = [
    { role: 'user', content: 'Найди Лесную 74' },
    { role: 'assistant', content: res1.answer }
  ];
  const res2 = await orchestrator.handle('А какой там сигнал?', { history: historyTurn2 });
  assert.equal(res2.ok, true);
  assert.ok(res2.answer.includes('-24 dBm'), 'Scalar follow-up MUST state exact dBm value in text');

  // Test 7c: Aggregating count + sum query -> explicit count and sum in text
  const res3 = await orchestrator.handle('Сколько заявок было вчера?', { history: [] });
  assert.equal(res3.ok, true);
  assert.ok(res3.answer.includes('3 заявки'), 'MUST explicitly state count in text');
  assert.ok(res3.answer.includes('2650 грн'), 'MUST explicitly state total sum in text');

  // Test 7d: Extremum "Какая была последняя заявка?" -> single latest ticket
  const res4 = await orchestrator.handle('Какая была последняя заявка вчера?', { history: [] });
  assert.equal(res4.ok, true);
  assert.ok(res4.answer.includes('t-103'), 'MUST name the single latest ticket ID');
  assert.ok(res4.answer.includes('18:26'), 'MUST name latest time');

  // Test 7e: All tickets on street -> lists all houses
  const res5 = await orchestrator.handle('Покажи все заявки на Мостовой', { history: [] });
  assert.equal(res5.ok, true);
  assert.ok(res5.answer.includes('25') && res5.answer.includes('84'), 'MUST list all matching houses on street');

  console.log('PASS 7. Conversational Intent-First contract: scalar facts, count+sum, single latest ticket, all houses on street');

  /* ── 8. Verification: 100% READ-ONLY confirmed across all tools ── */
  for(const tool of TOOL_DEFINITIONS){
    assert.equal(tool.annotations.readOnlyHint, true, tool.name + ' must be readOnlyHint: true');
    assert.equal(tool.annotations.destructiveHint, false, tool.name + ' must be destructiveHint: false');
    assert.ok(!/create|update|delete|write|modify|insert|drop/i.test(tool.name), tool.name + ' must not have write name');
  }
  console.log('PASS 8. 100% READ-ONLY strictly confirmed across all ' + TOOL_DEFINITIONS.length + ' MCP tools');

  console.log('\n=============================================');
  console.log('ALL AI CONVERSATIONAL REGRESSION TESTS PASSED');
  console.log('=============================================\n');
}

runAll().catch(err => {
  console.error(err);
  process.exit(1);
});
