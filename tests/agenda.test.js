'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Agenda, nextOccurrence, parseReminder, zoned } = require('../electron/agenda');
const { Proactive, quiet } = require('../electron/proactive');
const { MemoryStore } = require('../electron/memory-store');

const zone = 'Asia/Shanghai';
const now = Date.parse('2026-11-16T01:00:00Z');
const event = { title: '查课程', content: '', day: '2026-11-16', time: '10:00', timezone: zone, weekdays: 0,
  voice: true, notify: true, enabled: true };
const at = now + 3600000;

function data(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-agenda-'));
  const paths = { defaultDir: path.join(root, 'memory'), configDir: path.join(root, 'config') };
  const store = new MemoryStore(paths);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true }); });
  return { root, store, agenda: new Agenda(() => store.open()) };
}

test('R01 single reminder, atomic occurrence, snooze, and completion', t => {
  const { agenda } = data(t);
  agenda.save(event, now);
  assert.deepEqual(agenda.tick(at - 1), []);
  const [row] = agenda.tick(at);
  assert.equal(row.title, event.title);
  assert.deepEqual(agenda.tick(at), []);
  assert.equal(agenda.pending().id, row.id);
  assert.equal(agenda.action(row.id, 'show', at), true);
  assert.equal(agenda.action(row.id, 'show', at), false);
  assert.equal(agenda.action(row.id, 'snooze', at), true);
  assert.deepEqual(agenda.tick(at + 599999), []);
  assert.equal(agenda.tick(at + 600000)[0].id, row.id);
  assert.equal(agenda.action(row.id, 'done', at + 600000), true);
  assert.deepEqual(agenda.list().events, []);
});

test('R02 recurrence across weekdays, DST and midnight', () => {
  const recurring = { ...event, weekdays: 62 };
  assert.equal(nextOccurrence(recurring, at), at + 86400000);
  assert.equal(nextOccurrence(recurring, Date.parse('2026-11-20T02:00:00Z')), Date.parse('2026-11-23T02:00:00Z'));
  assert.equal(zoned('2026-03-08', '02:30', 'America/New_York'), Date.parse('2026-03-08T07:30:00Z'));
  assert.equal(zoned('2026-11-01', '01:30', 'America/New_York'), Date.parse('2026-11-01T05:30:00Z'));
  assert.equal(zoned('2026-11-17', '00:10', zone), Date.parse('2026-11-16T16:10:00Z'));
});

test('R03/R04 persisted events, coalesced missed occurrences, and clock rollback', t => {
  const { agenda, store } = data(t);
  agenda.save({ ...event, weekdays: 127 }, now);
  store.close();
  assert.deepEqual(agenda.tick(at + 3 * 86400000, true), []);
  const [missed] = agenda.list().events;
  assert.equal(missed.state, 'missed');
  assert.equal(agenda.list().reminders[0].next_fire_at, at + 4 * 86400000);
  assert.deepEqual(agenda.tick(at), []);
  assert.equal(agenda.action(missed.id, 'replay', at), true);
  assert.equal(agenda.pending().id, missed.id);
});

test('R06 reminder survives migration and restore, portable import starts paused', t => {
  const { root, agenda, store } = data(t);
  const id = agenda.save(event, now);
  agenda.tick(at);
  const backup = store.backup();
  store.migrate(path.join(root, 'other'));
  assert.equal(agenda.pending().reminder_id, id);
  const portable = agenda.export();
  agenda.remove(id);
  assert.equal(agenda.pending(), undefined);
  store.restore(backup);
  assert.equal(agenda.pending().reminder_id, id);
  assert.equal(agenda.import(portable, at), 1);
  assert.equal(agenda.list().reminders.length, 2);
  assert.ok(agenda.list().reminders.every(r => !r.enabled));
});

test('chat parser only matches explicit reminder syntax', () => {
  const english = parseReminder('Remind me tomorrow at 09:00 to call home.', Date.UTC(2026, 10, 18), 'Asia/Shanghai');
  assert.equal(english.title, 'call home');
  assert.equal(english.day, '2026-11-19');
  assert.equal(english.time, '09:00');
  assert.equal(parseReminder('明天十点开会。', now, zone), null);
  assert.equal(parseReminder('千绘莉，晚上九点提醒我休息。', now, zone).time, '21:00');
  assert.equal(parseReminder('明天十点提醒我开会。', now, zone).day, '2026-11-17');
  assert.equal(parseReminder('每周一早上八点提醒我查看课程安排。', now, zone).weekdays, 2);
});

test('P01–P04 rate, quiet windows, interaction cooldown, recording, and audio busy', t => {
  const { store } = data(t);
  const p = new Proactive(() => store.open(), () => 0.5);
  const request = { now, zone, idle: 180000, busy: false, locked: false, recording: false };
  assert.equal(p.claim(request), null);
  p.configure({ ...p.options(), enabled: true, presetMin: 10, presetLimit: 1 }, now);
  assert.equal(p.claim({ ...request, now: now + 899999 }), null);
  assert.equal(p.claim({ ...request, now: now + 900000, busy: true }), null);
  assert.equal(p.claim({ ...request, now: now + 900000, idle: 50 }), null);
  assert.equal(p.claim({ ...request, now: now + 900000, recording: true }), null);
  assert.ok(p.claim({ ...request, now: now + 900000 }));
  p.spoken(now + 900000);
  assert.equal(p.claim({ ...request, now: now + 1800000 }), null);
  assert.equal(quiet('23:30', p.options()), true);
  assert.equal(quiet('07:59', p.options()), true);
  assert.equal(quiet('08:00', p.options()), false);
});

test('a canceled preset does not consume its quota or start its cooldown', t => {
  const { store } = data(t);
  const p = new Proactive(() => store.open(), () => 0);
  const at = minutes => ({ now: now + minutes * 60000, zone });
  p.configure({ ...p.options(), enabled: true, presetMin: 10, presetLimit: 1 }, now);
  assert.deepEqual(p.claim(at(10)), { ai: false, voice: false });
  assert.deepEqual(p.claim(at(11)), { ai: false, voice: false });
  p.spoken(at(11).now);
  assert.equal(p.read('state', {}).streams.preset.next, at(21).now);
  assert.equal(p.claim(at(22)), null);
});

test('AI and preset dialogue retain independent schedules and budgets', t => {
  const { store } = data(t);
  const p = new Proactive(() => store.open(), () => 0);
  const at = (minutes, extra = {}) => ({ now: now + minutes * 60000, zone, idle: Infinity, ...extra });
  p.configure({ ...p.options(), enabled: true, ai: true, preset: true, frequency: 'frequent', limit: 60,
    presetMin: 10, presetLimit: 1, adaptive: false }, now);
  assert.deepEqual(p.claim(at(10)), { ai: true, voice: false });
  p.spoken(at(10).now, 'ai');
  assert.equal(p.claim(at(10.5)), null);
  assert.deepEqual(p.claim(at(11)), { ai: false, voice: false });
  p.spoken(at(11).now, 'preset');
  assert.equal(p.claim(at(20, { aiReady: false })), null);
  assert.deepEqual(p.claim(at(20)), { ai: true, voice: false });
  const reopened = new Proactive(() => store.open(), () => 0);
  assert.equal(reopened.claim(at(21)), null);
  assert.deepEqual(reopened.claim(at(30)), { ai: true, voice: false });
});

test('legacy preset options and accrued cooldown keep their original timing and daily count', t => {
  const { store } = data(t);
  const p = new Proactive(() => store.open(), () => 0);
  p.write('options', { enabled: true, ai: false, frequency: 'medium', min: 30, limit: 1 });
  p.write('state', { next: now + 1200000, interval: 1200000, sent: [now] });
  assert.equal(p.options().presetMin, 20);
  assert.equal(p.options().presetLimit, 1);
  assert.equal(p.options().limit, 12);
  p.configure({ ...p.options(), ai: true, frequency: 'frequent' }, now);
  assert.equal(p.read('state', {}).streams.preset.next, now + 1200000);
  assert.equal(p.claim({ now: now + 1200000, zone, aiReady: false }), null);
  assert.deepEqual(p.claim({ now: now + 1200000, zone }), { ai: true, voice: false });
});

test('D01 schema v1 upgrades transactionally with existing messages and memory', t => {
  const { store, agenda } = data(t);
  store.append('user', '旧聊天', 'old-chat');
  store.save({ type: '兴趣', content: '旧兴趣', tags: '' });
  store.open().exec('DROP TABLE reminder_events; DROP TABLE reminders; DROP TABLE proactive; DROP TABLE memory_terms; DROP INDEX memories_expiry; ALTER TABLE memories DROP COLUMN expires_at; ALTER TABLE memories DROP COLUMN importance; PRAGMA user_version=1');
  store.close();
  assert.equal(store.open().prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(store.history()[0].text, '旧聊天');
  assert.equal(store.list()[0].content, '旧兴趣');
  assert.deepEqual(agenda.list().reminders, []);
});

test('schema migration failure rolls back earlier DDL and leaves the old version/data', t => {
  const { store } = data(t);
  store.append('user', '保留的聊天', 'original');
  const file = store.status().file;
  store.open().exec(`DROP TABLE reminder_events; DROP TABLE reminders; DROP TABLE proactive; DROP TABLE memory_terms; DROP INDEX memories_expiry; ALTER TABLE memories DROP COLUMN expires_at; ALTER TABLE memories DROP COLUMN importance;
    CREATE TABLE reminder_events (collision INTEGER); PRAGMA user_version=1`);
  store.close();
  assert.match(store.status().error, /already exists/);
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='reminders'").get(), undefined);
    assert.equal(raw.prepare('SELECT text FROM messages').get().text, '保留的聊天');
  } finally { raw.close(); }
});
