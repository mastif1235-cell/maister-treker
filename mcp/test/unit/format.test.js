/* v91.45 regression: deterministic sequential list renumbering.
   Real defect: the phone showed «1. 1. 1. 1.» for a 25-ticket list. The fix
   is a pure post-processor in the Worker (never LLM self-numbering): any
   consecutive run of list items whose markers do not form 1..N is renumbered.
   Numbering is plain 1..N — no UUIDs or technical ids. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {renumberSequentialLists} from '../../src/ask/format.js';

test('repeated «1.» markers become 1, 2, 3, 4 (the reported defect)', () => {
  const input = 'Найгірші по сигналу:\n1. 10.09 Садова 19 (-26)\n1. 10.09 Пушкіна 1 (-27)\n1. 11.09 Мостова 25 (-28)\n1. 12.09 Польова 2 (-31)';
  const out = renumberSequentialLists(input);
  assert.equal(out, 'Найгірші по сигналу:\n1. 10.09 Садова 19 (-26)\n2. 10.09 Пушкіна 1 (-27)\n3. 11.09 Мостова 25 (-28)\n4. 12.09 Польова 2 (-31)');
});

test('a correct 1..N sequence passes through untouched', () => {
  const input = '1. перша заявка\n2. друга заявка\n3. третя заявка';
  assert.equal(renumberSequentialLists(input), input);
});

test('closing-paren style markers are renumbered too', () => {
  assert.equal(renumberSequentialLists('1) а\n1) б'), '1) а\n2) б');
});

test('a single list item is never touched', () => {
  assert.equal(renumberSequentialLists('Одна заявка:\n1. Садова 19'), 'Одна заявка:\n1. Садова 19');
});

test('plain text and lists separated by non-list lines are independent runs', () => {
  const input = 'Список А:\n1. аааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааа';
  assert.equal(renumberSequentialLists('1. x\n\nПросто текст.\n1. y\n1. z'), '1. x\n\nПросто текст.\n1. y\n2. z');
});

test('numbers are never replaced with technical ids; only the marker changes', () => {
  const out = renumberSequentialLists('1. заявка t-101 з Садової 19, сума 1500 грн 11.09.2026 о 10:30 — статус: виконано, майстр Іван');
  assert.equal(out, '1. заявка t-101 з Садової 19, сума 1500 грн 11.09.2026 о 10:30 — статус: виконано, майстр Іван');
});

test('indentation is preserved when renumbering', () => {
  assert.equal(renumberSequentialLists('  1. aaa\n  1. bbb'), '  1. aaa\n  2. bbb');
});
