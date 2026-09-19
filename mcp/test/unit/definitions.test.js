/* Unit tests for tool definitions and the argument validator. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {TOOL_DEFINITIONS, TOOL_NAMES} from '../../src/tools/definitions.js';
import {validateAgainstSchema} from '../../src/tools/validate.js';

const EXPECTED_TOOLS = [
  'find_tickets_by_address',
  'get_reports',
  'get_shifts',
  'get_statistics',
  'get_ticket',
  'get_tickets_by_date',
  'list_catalog',
  'list_places',
  'list_tickets',
  'query_tickets',
  'search_tickets'
];

test('exactly the approved READ toolset is exposed', () => {
  assert.deepEqual(TOOL_NAMES.slice().sort(), EXPECTED_TOOLS.slice().sort());
  assert.equal(TOOL_DEFINITIONS.length, 11);
});

test('every tool is annotated read-only and has a schema + description', () => {
  for(const def of TOOL_DEFINITIONS){
    assert.equal(def.annotations.readOnlyHint, true, def.name);
    assert.equal(def.annotations.destructiveHint, false, def.name);
    assert.equal(typeof def.description, 'string');
    assert.ok(def.description.length > 10, def.name);
    assert.equal(def.inputSchema.type, 'object', def.name);
    assert.equal(def.inputSchema.additionalProperties, false, def.name);
    assert.equal(typeof def.inputSchema.properties, 'object', def.name);
  }
});

test('required arguments are declared where needed', () => {
  const byName = Object.fromEntries(TOOL_DEFINITIONS.map(function(d){ return [d.name, d]; }));
  assert.deepEqual(byName.get_ticket.inputSchema.required, ['ticket_id']);
  assert.deepEqual(byName.search_tickets.inputSchema.required, ['query']);
  assert.deepEqual(byName.get_tickets_by_date.inputSchema.required, ['date']);
  assert.deepEqual(byName.get_reports.inputSchema.required, ['date_from', 'date_to']);
  assert.deepEqual(byName.get_statistics.inputSchema.required, ['period']);
  assert.ok(!byName.list_tickets.inputSchema.required);
  assert.ok(!byName.get_shifts.inputSchema.required);
});

test('validator enforces the schemas', () => {
  const byName = Object.fromEntries(TOOL_DEFINITIONS.map(function(d){ return [d.name, d]; }));

  assert.equal(validateAgainstSchema(byName.list_tickets.inputSchema, {}).ok, true);
  assert.equal(validateAgainstSchema(byName.list_tickets.inputSchema, {limit:200, tags:['ремонт']}).ok, true);
  assert.equal(validateAgainstSchema(byName.list_tickets.inputSchema, {limit:500}).ok, false);
  assert.equal(validateAgainstSchema(byName.list_tickets.inputSchema, {limit:'50'}).ok, false);
  assert.equal(validateAgainstSchema(byName.list_tickets.inputSchema, {evil:'x'}).ok, false);
  assert.equal(validateAgainstSchema(byName.list_tickets.inputSchema, {date_from:'16.09.2026'}).ok, true);
  assert.equal(validateAgainstSchema(byName.list_tickets.inputSchema, {date_from:'2026-09-16'}).ok, false);

  assert.equal(validateAgainstSchema(byName.get_ticket.inputSchema, {}).ok, false);
  assert.equal(validateAgainstSchema(byName.get_ticket.inputSchema, {ticket_id:'t-1'}).ok, true);
  assert.equal(validateAgainstSchema(byName.get_ticket.inputSchema, {ticket_id:''}).ok, false);

  assert.equal(validateAgainstSchema(byName.search_tickets.inputSchema, {query:'ремонт'}).ok, true);
  assert.equal(validateAgainstSchema(byName.search_tickets.inputSchema, {query:''}).ok, false);

  assert.equal(validateAgainstSchema(byName.get_statistics.inputSchema, {period:'day'}).ok, true);
  assert.equal(validateAgainstSchema(byName.get_statistics.inputSchema, {period:'year'}).ok, false);
  assert.equal(validateAgainstSchema(byName.get_statistics.inputSchema, {period:'week', anchor_date:'16.09.2026'}).ok, true);

  assert.equal(validateAgainstSchema(byName.get_reports.inputSchema, {date_from:'01.09.2026', date_to:'16.09.2026'}).ok, true);
  assert.equal(validateAgainstSchema(byName.get_reports.inputSchema, {date_from:'01.09.2026'}).ok, false);

  assert.equal(validateAgainstSchema(byName.get_shifts.inputSchema, {}).ok, true);
  assert.equal(validateAgainstSchema(byName.get_shifts.inputSchema, {date_from:'01.09.2026', date_to:'16.09.2026'}).ok, true);
  assert.equal(validateAgainstSchema(byName.get_shifts.inputSchema, {date_from:'bad'}).ok, false);
});
