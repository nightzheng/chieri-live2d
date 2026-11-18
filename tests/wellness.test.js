'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { Wellness } = require('../electron/wellness');

function storage() {
  const data = new Map();
  return { read: (key, fallback) => data.get(key) ?? fallback, write: (key, value) => data.set(key, value) };
}

test('hydration and standing count only observed active time and combine when both are due', () => {
  const wellness = new Wellness(storage());
  wellness.configure({ ...wellness.options(), water: 30, stand: 30 });
  let now = Date.parse('2026-11-18T02:00:00Z');
  wellness.observe(now, true);
  for (let i = 0; i < 300; i++) wellness.observe(now += 3000, true);
  wellness.observe(now += 3600000, true);
  wellness.observe(now += 3000, false);
  assert.equal(wellness.claim(now, 'Asia/Shanghai', false), null);
  wellness.observe(now += 3000, true);
  for (let i = 0; i < 300; i++) wellness.observe(now += 3000, true);
  assert.deepEqual(wellness.claim(now, 'Asia/Shanghai', true), { kinds: ['water', 'stand'], voice: false, notify: true });
  assert.equal(wellness.claim(now, 'Asia/Shanghai', true), null);
});

test('late-night reminder follows the local clock, including midnight and restart', () => {
  const settings = storage(), zone = 'Asia/Shanghai';
  const wellness = new Wellness(settings);
  wellness.configure({ ...wellness.options(), night: true, nightAt: '23:30' });
  assert.equal(wellness.claim(Date.parse('2026-11-18T15:29:00Z'), zone, true), null);
  assert.equal(wellness.claim(Date.parse('2026-11-18T15:40:00Z'), zone, false), null);
  assert.deepEqual(wellness.claim(Date.parse('2026-11-18T16:15:00Z'), zone, true), { kinds: ['night'], voice: false, notify: true });
  assert.equal(new Wellness(settings).claim(Date.parse('2026-11-18T20:00:00Z'), zone, true), null);
  assert.equal(wellness.claim(Date.parse('2026-11-18T22:00:00Z'), zone, true), null);
  assert.deepEqual(wellness.claim(Date.parse('2026-11-19T15:30:00Z'), zone, true), { kinds: ['night'], voice: false, notify: true });
});
