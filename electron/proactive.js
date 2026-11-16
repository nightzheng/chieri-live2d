'use strict';

const { calendar, validTime } = require('./agenda');

const MINUTE = 60000;
const LIMITS = { occasional: [45, 90], medium: [20, 40], frequent: [10, 20] };
const DEFAULTS = { enabled: false, frequency: 'occasional', min: 30, quietFrom: '23:00', quietTo: '08:00',
  limit: 4, ai: false, memory: false, voice: false };

function validOptions(options) {
  if (!options || !['enabled', 'ai', 'memory', 'voice'].every(k => typeof options[k] === 'boolean') ||
    ![...Object.keys(LIMITS), 'custom'].includes(options.frequency) || !validTime(options.quietFrom) || !validTime(options.quietTo) ||
    !Number.isInteger(options.min) || options.min < 10 || options.min > 1440 ||
    !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 24) {
    throw new Error('主动互动设置无效');
  }
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, options[key]]));
}

function quiet(time, { quietFrom, quietTo }) {
  if (quietFrom === quietTo) return false;
  return quietFrom < quietTo ? time >= quietFrom && time < quietTo : time >= quietFrom || time < quietTo;
}

function delay(options, random) {
  const [min, max] = LIMITS[options.frequency] || [options.min, Math.min(options.min * 2, 2880)];
  return MINUTE * (min + (max - min) * random());
}

class Proactive {
  constructor(open, random = Math.random) {
    this.open = open;
    this.random = random;
  }

  read(key, initial) {
    const row = this.open().prepare('SELECT value FROM proactive WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : initial;
  }

  write(key, value) {
    this.open().prepare('INSERT INTO proactive VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }

  options() { return this.read('options', DEFAULTS); }

  configure(options, now) {
    const next = validOptions(options), db = this.open();
    db.exec('BEGIN IMMEDIATE');
    try {
      this.write('options', next);
      const state = this.read('state', {});
      this.write('state', { ...state, next: now + delay(next, this.random) });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return next;
  }

  claim({ now, zone, idle, busy, locked, recording }) {
    const options = this.options();
    if (!options.enabled || busy || locked || recording || idle < 3 * MINUTE) return null;
    const { day, time } = calendar(now, zone);
    if (quiet(time, options)) return null;
    const state = this.read('state', { next: now + delay(options, this.random) });
    const recent = (state.sent || []).filter(at => now - at < 48 * 60 * MINUTE);
    if (state.next > now || recent.filter(at => calendar(at, zone).day === day).length >= options.limit) return null;
    this.write('state', { next: now + delay(options, this.random), sent: [...recent, now] });
    return options;
  }
}

module.exports = { Proactive, quiet, delay };
