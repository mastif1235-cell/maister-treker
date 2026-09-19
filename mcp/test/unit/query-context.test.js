/* v91.46 regression: structured follow-up context (COUNT → «покажи их»).
   The previous turn's authoritative resolved_filters are carried forward —
   whitelist-only, never text the model wrote, never cached rows. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectQueryContext, projectQueryFilters, sanitizeIncomingQueryContext,
  mergeInheritedFilters, hasStructuralParams
} from '../../src/ask/query-context.js';

test('projectQueryContext keeps only the whitelisted structured filters', () => {
  const ctx = projectQueryContext({
    mode:'count', total_matched:8,
    resolved_filters:{city:'Миколаївка 1', masterNote:'приватне', phone:'0671234567', clientName:'Імʼя', backupNote:'х', searchableText:'у'}
  });
  assert.deepEqual(ctx.resolved_filters, {city:'Миколаївка 1'});
  assert.equal(ctx.mode, 'count');
  assert.equal(ctx.total_matched, 8);
});

test('projectQueryFilters drops private/PII keys even when smuggled into resolved_filters', () => {
  const out = projectQueryFilters({
    city:'Дніпро', signal_worse_than:-25,
    masterNote:'m', abonentNote:'a', otherNote:'o', note:'n',
    phone:'1', extraPhones:['2'], macAddress:'aa:bb', contractNumber:'c',
    coordinates:'x', geoLat:1, geoLng:2, password:'p', secretKey:'s', __proto__:{evil:1}
  });
  assert.deepEqual(out, {city:'Дніпро', signal_worse_than:-25});
});

test('phone digits / contract / mac are presence flags only and never inherited', () => {
  const out = projectQueryFilters({phone_digits:{provided:true, length:7}, contract:true, mac:true, city:'Дніпро'});
  assert.deepEqual(out, {city:'Дніпро'}, 'value-less flags are not inheritable filters');
});

test('sanitizeIncomingQueryContext rejects garbage and re-projects', () => {
  assert.equal(sanitizeIncomingQueryContext(null), null);
  assert.equal(sanitizeIncomingQueryContext('x'), null);
  assert.equal(sanitizeIncomingQueryContext({resolved_filters:{}}), null);
  assert.equal(sanitizeIncomingQueryContext({resolved_filters:{masterNote:'x'}}), null);
  const ok = sanitizeIncomingQueryContext({resolved_filters:{city:'Таромське', masterNote:'злови мене'}, mode:'count', total_matched:'6'});
  assert.deepEqual(ok.resolved_filters, {city:'Таромське'});
  assert.equal(ok.total_matched, 6);
});

test('mergeInheritedFilters: follow-up call gets exactly the previous resolved_filters', () => {
  const inherited = {city:'Миколаївка 1', signal_worse_than:-25, date_from:'01.08.2026', date_to:'31.08.2026', type:'Ремонт'};
  const merged = mergeInheritedFilters({mode:'list', inherit_previous_filters:true, limit:50}, inherited);
  assert.equal(merged.city, 'Миколаївка 1');
  assert.equal(merged.signal_worse_than, -25, 'strict signal semantics carried verbatim');
  assert.equal(merged.date_from, '01.08.2026');
  assert.equal(merged.date_to, '31.08.2026');
  assert.equal(merged.type, 'Ремонт');
  assert.equal(merged.mode, 'list', 'new mode wins');
  assert.equal(merged.limit, 50);
  assert.equal(merged.inherit_previous_filters, undefined, 'flag never reaches the query engine');
});

test('mergeInheritedFilters: a call with its own structural filters is a NEW question — no stale inheritance', () => {
  const inherited = {city:'Миколаївка 1', signal_worse_than:-25};
  const merged = mergeInheritedFilters({mode:'group', group_by:'street', city:'Миколаївка 1', inherit_previous_filters:true}, inherited);
  assert.equal(merged.city, 'Миколаївка 1');
  assert.equal(merged.signal_worse_than, undefined, 'old signal filter must NOT leak into the street question');
});

test('hasStructuralParams sees every param that marks a new question', () => {
  assert.equal(hasStructuralParams({}), false);
  assert.equal(hasStructuralParams({mode:'list'}), false);
  assert.equal(hasStructuralParams({signal_worse_than:-25}), true);
  assert.equal(hasStructuralParams({phone_digits:'123'}), true);
  assert.equal(hasStructuralParams({contract:'7'}), true);
  assert.equal(hasStructuralParams({mac:'aa'}), true);
  assert.equal(hasStructuralParams({items:[{text:'роутер'}]}), true);
});

/* ---------- v91.46 r2: anaphoric follow-up detector ---------- */

import {isAnaphoricListFollowUp} from '../../src/ask/query-context.js';

test('isAnaphoricListFollowUp: explicit «show/list THEM» formulations (UA/RU)', () => {
  for(const q of ['Покажи их', 'покажи эти заявки', 'Покажи список', 'перечисли их', 'дай их списком', 'а какие именно?', 'Покажіть їх', 'перерахуй їх', 'Покажи ці заявки', 'покажи усі', 'які саме заявки?']){
    assert.equal(isAnaphoricListFollowUp(q), true, q);
  }
});

test('isAnaphoricListFollowUp: independent questions never match', () => {
  for(const q of ['Скільки заявок у Миколаївці 1?', 'Покажи картку заявки', 'покажи карту', 'Скільки заробив за серпень?', 'Покажи заявки за вчора', 'відкрий цю заявку', 'Які вулиці є в Миколаївці 1?', '']){
    assert.equal(isAnaphoricListFollowUp(q), false, q);
  }
});

/* ---------- v91.46 r2: tags and item kind are carried verbatim ---------- */

test('projectQueryFilters keeps tags and item kind from the allowed enum only', () => {
  const out = projectQueryFilters({
    tags:['Терміново', 'Гарантія'],
    items:[
      {text:'роутер', kind:'equipment', unit_price:1500, resolved_labels:['x'], concept:'router', in_catalog:true},
      {text:'кабель', kind:'evil_pool', quantity:10},
      {text:'муфта'}
    ]
  });
  assert.deepEqual(out.tags, ['Терміново', 'Гарантія']);
  assert.deepEqual(out.items, [
    {text:'роутер', kind:'equipment', unit_price:1500},
    {text:'кабель', quantity:10},
    {text:'муфта'}
  ], 'kind survives only from the enum; labels/concept are not carried');
});
