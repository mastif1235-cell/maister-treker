/* Unit tests for the sliding-window rate limiter. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createRateLimiter} from '../../src/ratelimit.js';

test('allows up to the limit, then denies with Retry-After', () => {
  let now = 1_000_000;
  const limiter = createRateLimiter({limitPerMin:3, now:function(){ return now; }});
  assert.equal(limiter.check('cli').allowed, true);
  assert.equal(limiter.check('cli').allowed, true);
  assert.equal(limiter.check('cli').allowed, true);
  const denied = limiter.check('cli');
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterSec >= 1 && denied.retryAfterSec <= 60);
});

test('window slides: old hits expire after 60 seconds', () => {
  let now = 2_000_000;
  const limiter = createRateLimiter({limitPerMin:2, now:function(){ return now; }});
  assert.equal(limiter.check('cli').allowed, true);
  assert.equal(limiter.check('cli').allowed, true);
  assert.equal(limiter.check('cli').allowed, false);
  now += 60_001;
  assert.equal(limiter.check('cli').allowed, true);
});

test('clients are limited independently', () => {
  const limiter = createRateLimiter({limitPerMin:1, now:function(){ return 3_000_000; }});
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, false);
  assert.equal(limiter.check('b').allowed, true);
});
