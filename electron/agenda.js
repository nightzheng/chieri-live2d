'use strict';

const { randomUUID } = require('node:crypto');

const SCHEMA = `
  CREATE TABLE reminders (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, day TEXT NOT NULL,
    time TEXT NOT NULL, timezone TEXT NOT NULL, weekdays INTEGER NOT NULL CHECK(weekdays BETWEEN 0 AND 127),
    voice INTEGER NOT NULL, notify INTEGER NOT NULL, enabled INTEGER NOT NULL, next_fire_at INTEGER,
    last_fired_at INTEGER, created INTEGER NOT NULL, updated INTEGER NOT NULL, source TEXT NOT NULL
  ) STRICT;
  CREATE INDEX reminder_due ON reminders(enabled,next_fire_at);
  CREATE TABLE reminder_events (
    id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL, at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('scheduled','ready','missed','shown','done','skipped')),
    FOREIGN KEY(reminder_id) REFERENCES reminders(id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX reminder_event_due ON reminder_events(state,at);
  CREATE TABLE proactive (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
`;
const MINUTE = 60000;
const DAY = 1440 * MINUTE;
const formatters = new Map();

function calendar(at, zone) {
  if (!formatters.has(zone)) {
    if (formatters.size >= 32) formatters.clear();
    formatters.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  }
  const fields = Object.fromEntries(formatters.get(zone).formatToParts(at).map(p => [p.type, p.value]));
  return { day: fields.year + '-' + fields.month + '-' + fields.day, time: fields.hour + ':' + fields.minute };
}

const wallUtc = (day, time) => Date.parse(day + 'T' + time + ':00Z');
const dateAt = at => new Date(at).toISOString().slice(0, 10);
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

function zoned(day, time, zone) {
  const wall = wallUtc(day, time);
  const candidates = new Set();
  for (const offset of [-DAY, 0, DAY]) {
    const stamp = wall + offset, local = calendar(stamp, zone);
    candidates.add(wall + stamp - wallUtc(local.day, local.time));
  }
  const localDelta = at => {
    const local = calendar(at, zone);
    return wallUtc(local.day, local.time) - wall;
  };
  // On a fall-back choose the earlier of the two occurrences; advance through a spring-forward gap.
  return [...candidates].map(at => ({ at, delta: localDelta(at) })).filter(t => t.delta >= 0)
    .sort((a, b) => a.delta - b.delta || a.at - b.at)[0].at;
}

function nextOccurrence(row, after) {
  if (!row.weekdays) {
    const due = zoned(row.day, row.time, row.timezone);
    return due > after ? due : null;
  }
  const start = Math.max(wallUtc(row.day, '00:00'), wallUtc(calendar(after, row.timezone).day, '00:00'));
  for (let offset = 0; offset < 8; offset++) {
    const day = start + DAY * offset;
    if (!(row.weekdays & (1 << new Date(day).getUTCDay()))) continue;
    const at = zoned(dateAt(day), row.time, row.timezone);
    if (at > after) return at;
  }
  throw new Error('无法计算下一次提醒');
}

function validate(value) {
  const text = (v, cap, optional = false) => {
    if (typeof v !== 'string' || v.length > cap || v.includes('\0') || (!optional && !v.trim())) throw new Error('提醒内容或参数无效');
    return v.trim();
  };
  const day = text(value?.day, 10);
  const time = text(value.time, 5);
  const timezone = text(value.timezone, 80);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(wallUtc(day, '00:00')) ||
      dateAt(wallUtc(day, '00:00')) !== day || !validTime(time) ||
      !Number.isInteger(value.weekdays) || value.weekdays < 0 || value.weekdays > 127 ||
      !['voice','notify','enabled'].every(k => typeof value[k] === 'boolean')) throw new Error('提醒日期、时间或重复规则无效');
  calendar(Date.now(), timezone);
  return { title: text(value.title, 100), content: text(value.content ?? '', 500, true), day, time, timezone,
    weekdays: value.weekdays, voice: +value.voice, notify: +value.notify, enabled: +value.enabled };
}

function parseReminder(input, now, zone) {
  if (typeof input !== 'string' || input.length > 300) return null;
  const english = /^(?:Chieri,?\s+)?(?:please\s+)?remind me(?:\s+(today|tomorrow|every day|on weekdays))?\s+at\s+(\d{1,2}):(\d{2})\s+to\s+(.+)$/iu.exec(input.trim());
  if (english) {
    const [, day, hour, minute, content] = english;
    const when = { today: '今天', tomorrow: '明天', 'every day': '每天', 'on weekdays': '工作日' }[day?.toLowerCase()] || '';
    return parseReminder(`${when}${hour}:${minute}提醒我${content.replace(/\.$/, '')}`, now, zone);
  }
  const match = /^(?:千绘莉[，,、\s]*)?(?:请)?(?:(今天|明天|后天|每天|工作日|每周[日天一二三四五六])\s*)?(早上|上午|中午|下午|晚上)?\s*([\d零〇一二两三四五六七八九十]{1,3})(?:[点时]([\d零〇一二两三四五六七八九十]{1,3}分?|半)?|[:：](\d{2}))\s*提醒我(.+)$/u.exec(input.trim());
  if (!match) return null;
  const [, when, period, h, mn, colon, message] = match;
  const numerals = '零一二三四五六七八九';
  const number = value => {
    const v = value.replace(/分$/, '').replace(/两/g, '二').replace(/〇/g, '零');
    if (/^\d+$/.test(v)) return +v;
    const [a, b] = v.split('十');
    const digit = n => n.length === 1 && numerals.includes(n) ? numerals.indexOf(n) : NaN;
    return b === undefined ? digit(a) : (a ? digit(a) : 1) * 10 + (b ? digit(b) : 0);
  };
  let hour = number(h);
  if (period === '晚上' && hour === 12) hour = 0;
  else if (['下午', '晚上', '中午'].includes(period) && hour < 12) hour += 12;
  const minute = mn === '半' ? 30 : number(mn || colon || '0');
  const pad = n => String(n).padStart(2, '0');
  const time = pad(hour) + ':' + pad(minute);
  const content = message.trim().replace(/[。！？!?]+$/u, '');
  if (!content || !validTime(time)) return null;
  const start = wallUtc(calendar(now, zone).day, '00:00');
  let day = dateAt(start + DAY * (when === '明天' ? 1 : when === '后天' ? 2 : 0));
  const weekdays = when === '每天' ? 127 : when === '工作日' ? 62 : when?.startsWith('每周') ? 1 << '日一二三四五六'.indexOf(when.at(-1).replace('天', '日')) : 0;
  if (!when && zoned(day, time, zone) <= now) day = dateAt(start + DAY);
  return { title: content.slice(0, 100), content, day, time, timezone: zone, weekdays, voice: true, notify: true, enabled: true };
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

class Agenda {
  constructor(open) { this.open = open; }

  list() {
    const db = this.open();
    return { reminders: db.prepare('SELECT * FROM reminders ORDER BY enabled DESC,next_fire_at IS NULL,next_fire_at,created LIMIT 1000').all(),
      events: db.prepare(`SELECT e.*, r.title,r.content,r.voice,r.notify FROM reminder_events e JOIN reminders r ON r.id=e.reminder_id
        WHERE e.state IN ('ready','missed','shown','scheduled') ORDER BY e.at LIMIT 200`).all() };
  }

  save(value, now, source = 'manual') {
    const reminder = validate(value);
    const db = this.open();
    const id = value.id === undefined ? randomUUID() : validId(value.id);
    const old = db.prepare('SELECT * FROM reminders WHERE id=?').get(id);
    if (value.id !== undefined && !old) throw new Error('提醒已不存在');
    if (!old && db.prepare('SELECT count(*) AS count FROM reminders').get().count >= 1000) throw new Error('提醒已达 1000 条上限');
    const sameSchedule = old && ['day', 'time', 'timezone', 'weekdays'].every(key => old[key] === reminder[key]);
    const next = nextOccurrence(reminder, sameSchedule ? Math.max(now, old.last_fired_at || 0) : now);
    if (reminder.enabled && next === null) throw new Error('请为启用的提醒选择未来时间');
    db.prepare(`INSERT INTO reminders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,day=excluded.day,time=excluded.time,
      timezone=excluded.timezone,weekdays=excluded.weekdays,voice=excluded.voice,notify=excluded.notify,
      enabled=excluded.enabled,next_fire_at=excluded.next_fire_at,updated=excluded.updated`)
      .run(id, reminder.title, reminder.content, reminder.day, reminder.time, reminder.timezone, reminder.weekdays,
        reminder.voice, reminder.notify, reminder.enabled, reminder.enabled ? next : null, old?.last_fired_at ?? null,
        old?.created ?? now, now, old?.source || source);
    return id;
  }

  toggle(id, enabled, now) {
    if (typeof enabled !== 'boolean') throw new Error('提醒状态无效');
    const db = this.open();
    const row = db.prepare('SELECT * FROM reminders WHERE id=?').get(validId(id));
    if (!row) throw new Error('提醒已不存在');
    if (enabled) {
      const next = nextOccurrence(row, Math.max(now, row.last_fired_at || 0));
      if (next === null) throw new Error('请先编辑一个未来提醒时间');
      db.prepare('UPDATE reminders SET enabled=1,next_fire_at=?,updated=? WHERE id=?').run(next, now, id);
    } else transaction(db, () => {
      db.prepare('UPDATE reminders SET enabled=0,next_fire_at=NULL,updated=? WHERE id=?').run(now, id);
      db.prepare("UPDATE reminder_events SET state='skipped' WHERE reminder_id=? AND state='scheduled'").run(id);
    });
  }

  remove(id) { this.open().prepare('DELETE FROM reminders WHERE id=?').run(validId(id)); }

  tick(now, missed = false) {
    const db = this.open();
    return transaction(db, () => {
      const ready = [];
      const stateFor = at => missed || now - at > MINUTE ? 'missed' : 'ready';
      for (const row of db.prepare('SELECT * FROM reminders WHERE enabled=1 AND next_fire_at<=? ORDER BY next_fire_at LIMIT 100').all(now)) {
        const at = row.next_fire_at, state = stateFor(at), id = randomUUID();
        const next = nextOccurrence(row, now);
        db.prepare('UPDATE reminders SET next_fire_at=?,last_fired_at=?,enabled=? WHERE id=?').run(next, at, +(next !== null), row.id);
        db.prepare('INSERT INTO reminder_events VALUES (?,?,?,?)').run(id, row.id, at, state);
        if (state === 'ready') ready.push({ ...row, id, at, reminder_id: row.id });
      }
      for (const row of db.prepare(`SELECT e.*,r.title,r.content,r.voice,r.notify FROM reminder_events e JOIN reminders r ON r.id=e.reminder_id
          WHERE e.state='scheduled' AND e.at<=? ORDER BY e.at LIMIT 100`).all(now)) {
        const state = stateFor(row.at);
        db.prepare('UPDATE reminder_events SET state=? WHERE id=?').run(state, row.id);
        if (state === 'ready') ready.push(row);
      }
      db.prepare("DELETE FROM reminder_events WHERE state IN ('done','skipped') AND at<?").run(now - 90 * DAY);
      return ready;
    });
  }

  recoverPending() {
    this.open().exec("UPDATE reminder_events SET state='missed' WHERE state='ready'");
  }

  pending() {
    return this.open().prepare(`SELECT e.*,r.title,r.content,r.voice FROM reminder_events e JOIN reminders r ON r.id=e.reminder_id
      WHERE e.state='ready' ORDER BY e.at LIMIT 1`).get();
  }

  missedCount() {
    return this.open().prepare("SELECT count(*) AS total FROM reminder_events WHERE state='missed'").get().total;
  }

  event(id) {
    return this.open().prepare(`SELECT e.*,r.title,r.content,r.voice,r.notify FROM reminder_events e JOIN reminders r ON r.id=e.reminder_id
      WHERE e.id=?`).get(validId(id));
  }

  action(id, action, now) {
    const db = this.open();
    const options = {
      show: ['ready', 'shown'], replay: ['missed', 'ready'],
      snooze: ['ready missed shown', 'scheduled'],
      done: ['ready missed shown scheduled', 'done'], skip: ['ready missed shown scheduled', 'skipped'],
    };
    if (!Object.hasOwn(options, action)) throw new Error('提醒操作无效');
    const [states, state] = options[action];
    const row = db.prepare('SELECT * FROM reminder_events WHERE id=?').get(validId(id));
    if (!row || !states.split(' ').includes(row.state)) return false;
    db.prepare('UPDATE reminder_events SET state=?,at=? WHERE id=?').run(state, action === 'snooze' ? now + 10 * MINUTE : row.at, id);
    return true;
  }

  export() {
    const rows = this.list().reminders.map(r => ({ title: r.title, content: r.content, day: r.day, time: r.time, timezone: r.timezone,
      weekdays: r.weekdays, voice: !!r.voice, notify: !!r.notify, enabled: !!r.enabled }));
    return { format: 'chieri-reminders', version: 1, reminders: rows };
  }

  import(file, now) {
    if (file?.format !== 'chieri-reminders' || file.version !== 1 || !Array.isArray(file.reminders) || file.reminders.length > 1000) {
      throw new Error('提醒文件的格式或版本无效');
    }
    const rows = file.reminders.map(row => { validate(row); return { ...row, id: undefined, enabled: false }; });
    const db = this.open();
    return transaction(db, () => { for (const row of rows) this.save(row, now, 'import'); return rows.length; });
  }
}

function validId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) throw new Error('提醒标识无效');
  return value;
}

module.exports = { SCHEMA, Agenda, calendar, nextOccurrence, parseReminder, validTime, zoned };
