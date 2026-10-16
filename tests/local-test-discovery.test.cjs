'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {discover}=require('../scripts/run-local-tests.cjs');
assert.deepEqual(discover(['a.test.js','b.test.cjs','c.spec.js','helper.cjs','nested']),['a.test.js','b.test.cjs']);
assert.ok(discover(fs.readdirSync('tests')).includes('local-test-discovery.test.cjs'));
console.log('PASS A09 portable local runner discovers both .test.js and .test.cjs');
