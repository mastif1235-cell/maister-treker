/* Unit tests for address normalization, extraction and resolution. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeStem,
  damerauLevenshtein,
  matchScore,
  normalizeHouse,
  parseAddressQuery,
  extractPlaces,
  resolveAddress
} from '../../src/ask/address.js';

test('damerauLevenshtein computes correct distances', () => {
  assert.equal(damerauLevenshtein('abc', 'abc'), 0);
  assert.equal(damerauLevenshtein('abc', 'acb'), 1); // transposition
  assert.equal(damerauLevenshtein('abc', 'abcd'), 1); // insertion
  assert.equal(damerauLevenshtein('abc', 'ab'), 1); // deletion
  assert.equal(damerauLevenshtein('abc', 'axc'), 1); // substitution
});

test('normalizeStem maps Ukrainian / Russian variations and prefixes to common stems', () => {
  // UA vs RU street names
  assert.equal(normalizeStem('вул. Лісова'), normalizeStem('Лесная'));
  assert.equal(normalizeStem('Лісова'), normalizeStem('Лісна'));
  assert.equal(normalizeStem('Мостова'), normalizeStem('Мостовая'));
  assert.equal(normalizeStem('вул. Шевченка'), normalizeStem('ул. Шевченко'));
  assert.equal(normalizeStem('Молодіжна'), normalizeStem('Молодежная'));
  assert.equal(normalizeStem('Залізнична'), normalizeStem('Железнодорожная'));
  assert.equal(normalizeStem('Сонячна'), normalizeStem('Солнечная'));
  assert.equal(normalizeStem('Шкільна'), normalizeStem('Школьная'));
  assert.equal(normalizeStem('Квіткова'), normalizeStem('Цветочная'));

  // City names
  assert.equal(normalizeStem('Таромське'), normalizeStem('Таромское'));
  assert.equal(normalizeStem('Дніпро'), normalizeStem('Днепр'));
});

test('normalizeHouse isolates house number with letters or sub-buildings', () => {
  assert.equal(normalizeHouse('74'), '74');
  assert.equal(normalizeHouse('74а'), '74а');
  assert.equal(normalizeHouse('74 А'), '74а');
  assert.equal(normalizeHouse('74-А'), '74а');
  assert.equal(normalizeHouse('74 / 2'), '74/2');
  assert.equal(normalizeHouse('74 корп. 1'), '74к1');
  assert.notEqual(normalizeHouse('74'), normalizeHouse('174')); // never equal!
  assert.notEqual(normalizeHouse('74'), normalizeHouse('740'));
});

test('parseAddressQuery extracts conversational intent, street text, and house', () => {
  const q1 = parseAddressQuery('Таромское Лісова 74');
  assert.equal(q1.house, '74');
  assert.equal(q1.text, 'Таромское Лісова');

  const q2 = parseAddressQuery('можешь открыть профиль Лесная 74');
  assert.equal(q2.house, '74');
  assert.equal(q2.text, 'Лесная');

  const q3 = parseAddressQuery('а по адресу Таромское Лісова 74');
  assert.equal(q3.house, '74');
  assert.equal(q3.text, 'Таромское Лісова');

  const q4 = parseAddressQuery('вул. Лісова 74а');
  assert.equal(q4.house, '74а');
  assert.equal(q4.text, 'вул. Лісова');

  const q5 = parseAddressQuery('Які адреси є на вул. Лісова?');
  assert.equal(q5.house, null);
  assert.ok(q5.text.includes('Лісова'));
});

test('resolveAddress resolves Russian and Ukrainian queries to real data', () => {
  const mockTickets = [
    { id: '1', city: 'Таромське', street: 'вул. Лісова', house: '74', date: '15.09.2026' },
    { id: '2', city: 'Таромське', street: 'вул. Лісова', house: '74а', date: '16.09.2026' },
    { id: '3', city: 'Таромське', street: 'вул. Мостова', house: '25', date: '14.09.2026' },
    { id: '4', city: 'Дніпро', street: 'вул. Шевченка', house: '12', date: '10.09.2026' },
    { id: '5', city: 'Підгородне', street: 'вул. Шевченка', house: '5', date: '12.09.2026' }
  ];
  const places = extractPlaces(mockTickets);

  // Exact UA match
  const r1 = resolveAddress('Таромське Лісова 74', places);
  assert.ok(r1.resolved);
  assert.equal(r1.resolved.city, 'Таромське');
  assert.equal(r1.resolved.street, 'вул. Лісова');
  assert.equal(r1.resolved.house, '74');

  // Russian transliteration
  const r2 = resolveAddress('Таромское Лесная 74', places);
  assert.ok(r2.resolved);
  assert.equal(r2.resolved.city, 'Таромське');
  assert.equal(r2.resolved.street, 'вул. Лісова');
  assert.equal(r2.resolved.house, '74');

  // Typo: "тарамский Лісна 74"
  const r3 = resolveAddress('тарамский Лісна 74', places);
  assert.ok(r3.resolved);
  assert.equal(r3.resolved.city, 'Таромське');
  assert.equal(r3.resolved.street, 'вул. Лісова');
  assert.equal(r3.resolved.house, '74');

  // Single street without city (unique street across database)
  const r4 = resolveAddress('Мостовая 25', places);
  assert.ok(r4.resolved);
  assert.equal(r4.resolved.city, 'Таромське');
  assert.equal(r4.resolved.street, 'вул. Мостова');
  assert.equal(r4.resolved.house, '25');

  // Ambiguous street present in two cities
  const r5 = resolveAddress('вул. Шевченка', places);
  assert.equal(r5.resolved, null);
  assert.equal(r5.ambiguous, true);
  assert.equal(r5.candidates.length, 2);

  // Non-existent street returns null with low confidence (no false positive!)
  const r6 = resolveAddress('несуществующая улица 100', places);
  assert.equal(r6.resolved, null);
  assert.equal(r6.candidates.length, 0);

  // False positive guard: "Лісова" must not match "Мостова"
  assert.equal(matchScore('вул. Лісова', 'вул. Мостова'), 0);
  assert.equal(matchScore('вул. Лісова', 'вул. Центральна'), 0);
});
