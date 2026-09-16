/* Unit tests for the mapper + redaction layer. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ticketFromGasRow, redactTicket, redactShift,
  parseDateKey, normalizeOnuSignal, ticketMatchesQuery,
  isForbiddenKey, assertNoForbidden, REDACTED_TICKET_FIELDS, REDACTED_SHIFT_FIELDS
} from '../../src/gas/mappers.js';
import {FIXTURES} from '../fixtures/data.js';

test('parseDateKey converts DD.MM.YYYY and rejects everything else', () => {
  assert.equal(parseDateKey('16.09.2026'), '2026-09-16');
  assert.equal(parseDateKey('01.01.2000'), '2000-01-01');
  assert.equal(parseDateKey('32.13.2026'), null);
  assert.equal(parseDateKey('2026-09-16'), null);
  assert.equal(parseDateKey(''), null);
  assert.equal(parseDateKey(null), null);
  assert.equal(parseDateKey('16.09.26'), null);
});

test('normalizeOnuSignal mirrors the app (comma decimal, junk -> empty)', () => {
  assert.equal(normalizeOnuSignal('-67,5'), '-67.5');
  assert.equal(normalizeOnuSignal(' -67 '), '-67');
  assert.equal(normalizeOnuSignal('abc'), '');
  assert.equal(normalizeOnuSignal(null), '');
});

test('redactTicket output keys are exactly the whitelisted set', () => {
  const ticket = ticketFromGasRow(FIXTURES.BASE_ROWS[0]);
  const redacted = redactTicket(ticket);
  assert.deepEqual(Object.keys(redacted).sort(), REDACTED_TICKET_FIELDS.slice().sort());
  assert.deepEqual(Object.keys(redacted.equipment[0]).sort(), ['label', 'price']);
  assert.deepEqual(Object.keys(redacted.cables[0]).sort(), ['label', 'meters', 'pricePerMeter']);
  assert.deepEqual(Object.keys(redacted.presetWorks[0]).sort(), ['label', 'price', 'qty']);
  assert.deepEqual(Object.keys(redacted.additionalWork[0]).sort(), ['desc', 'sum']);
});

test('redactTicket maps whitelisted structured fields correctly', () => {
  const redacted = redactTicket(ticketFromGasRow(FIXTURES.BASE_ROWS[0]));
  assert.equal(redacted.id, 't-001');
  assert.equal(redacted.date, '15.09.2026');
  assert.equal(redacted.time, '09:15');
  assert.equal(redacted.type, 'Ремонт');
  assert.equal(redacted.city, 'Дніпро');
  assert.equal(redacted.phone, '0671234567');
  assert.deepEqual(redacted.extraPhones, ['0509998877']);
  assert.equal(redacted.signal, '-67');
  assert.equal(redacted.sum, 850);
  assert.equal(redacted.payment, 'Готівка');
  assert.equal(redacted.geoLink, 'https://maps.google.com/?q=48.464,35.046');
  assert.equal(redacted.equipment.length, 1);
  assert.equal(redacted.cables[0].meters, 10);
});

test('whitelist drops unknown keys inside fullDataJson (attacker-supplied)', () => {
  const rows = [{
    id:'t-x', date:'16.09.2026', time:'10:00', content:'c', sum:1, tags:[],
    backupNote:'', photo:null,
    fullDataJson: JSON.stringify({type:'Ремонт', syncHmacSecret:'x', customUnknown:'y', password:'z', extraPhones2:'w'})
  }];
  const redacted = redactTicket(ticketFromGasRow(rows[0]));
  assert.equal(redacted.type, 'Ремонт');
  const serialized = JSON.stringify(redacted);
  assert.ok(!serialized.includes('syncHmacSecret'));
  assert.ok(!serialized.includes('customUnknown'));
  assert.ok(!serialized.includes('password'));
});

test('malformed fullDataJson does not crash and still redacts row fields', () => {
  const rows = [{
    id:'t-bad', date:'16.09.2026', time:'10:00', content:'text here', sum:42, tags:['ремонт'],
    backupNote:'whatever', photo:null,
    fullDataJson:'{not json at all'
  }];
  const ticket = ticketFromGasRow(rows[0]);
  assert.equal(ticket.fullDataError, true);
  const redacted = redactTicket(ticket);
  assert.equal(redacted.id, 't-bad');
  assert.equal(redacted.sum, 42);
  assert.deepEqual(redacted.tags, ['ремонт']);
  assert.equal(redacted.type, '');
});

test('isForbiddenKey catches secrets, tg service fields and raw payload columns', () => {
  for(const key of ['password','login','masterNote','backupNote','fullDataJson','photo','photos',
    'tgBackedUp','tgPhotoFileIds','tgJsonMsgId','tgBotToken','syncHmacSecret','apiToken','accessToken','mapTilerKey']){
    assert.ok(isForbiddenKey(key), key);
  }
  for(const key of REDACTED_TICKET_FIELDS){
    assert.ok(!isForbiddenKey(key), key + ' must be allowed');
  }
  for(const key of REDACTED_SHIFT_FIELDS){
    assert.ok(!isForbiddenKey(key), key + ' must be allowed');
  }
});

test('assertNoForbidden throws on forbidden keys at any depth, passes on clean output', () => {
  assert.throws(function(){ assertNoForbidden({a:{b:[{password:'x'}]}}); }, /FORBIDDEN_KEY:password/);
  assert.throws(function(){ assertNoForbidden({list:[{tgPhotoFileIds:[]}]}); }, /FORBIDDEN_KEY:tgPhotoFileIds/);
  assert.throws(function(){ assertNoForbidden({deep:{syncHmacSecret:'x'}}); }, /FORBIDDEN_KEY:syncHmacSecret/);
  const redacted = redactTicket(ticketFromGasRow(FIXTURES.BASE_ROWS[3]));
  assert.doesNotThrow(function(){ assertNoForbidden({tickets:[redacted]}); });
});

test('redactShift projects only id/date/hours/coworker', () => {
  const shift = redactShift({id:'s-1', date:'16.09.2026', hours:'7.5', coworker:'Олег', tgPhotoFileIds:['x']});
  assert.deepEqual(Object.keys(shift).sort(), REDACTED_SHIFT_FIELDS.slice().sort());
  assert.equal(shift.hours, 7.5);
});

test('search predicate mirrors app field coverage (text/date/tags/city/address/name/signal/phones)', () => {
  const t = redactTicket(ticketFromGasRow(FIXTURES.BASE_ROWS[0]));
  const t4 = redactTicket(ticketFromGasRow(FIXTURES.BASE_ROWS[3]));
  assert.equal(ticketMatchesQuery(t, 'ремонт'), true);
  assert.equal(ticketMatchesQuery(t, 'Шевченка'), true);
  assert.equal(ticketMatchesQuery(t, 'шевченка'), true); // case-insensitive
  assert.equal(ticketMatchesQuery(t, 'петренко'), true);
  assert.equal(ticketMatchesQuery(t, '15.09.2026'), true);
  assert.equal(ticketMatchesQuery(t, '1234567'), true); // phone digits
  assert.equal(ticketMatchesQuery(t, '9998877'), true); // extra phone digits
  assert.equal(ticketMatchesQuery(t, '-67'), true); // signal
  assert.equal(ticketMatchesQuery(t, 'неттакого'), false);
  assert.equal(ticketMatchesQuery(t4, '-67.5'), true);
  assert.equal(ticketMatchesQuery(t, ''), true);
});
