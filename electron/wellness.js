'use strict';

const { calendar, validTime } = require('./agenda');

const MINUTE = 60000;
const DEFAULTS = { water: 0, stand: 0, night: false, nightAt: '23:30', voice: false, notify: true };
const INTERVALS = [0, 30, 45, 60, 90, 120];

class Wellness {
  constructor(storage) {
    this.storage = storage;
    this.reset();
  }

  reset() {
    this.previous = null;
    this.wasActive = false;
    this.elapsed = { water: 0, stand: 0 };
  }

  options() { return { ...DEFAULTS, ...this.storage.read('wellness-options', {}) }; }

  configure(options) {
    if (!INTERVALS.includes(options?.water) || !INTERVALS.includes(options.stand) ||
        !['night', 'voice', 'notify'].every(key => typeof options[key] === 'boolean') || !validTime(options.nightAt) ||
        (options.nightAt >= '06:00' && options.nightAt < '20:00')) throw new Error('生活提醒设置无效。夜深提醒时间需在 20:00 至次日 05:59 之间。');
    const value = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, options[key]]));
    this.storage.write('wellness-options', value);
    this.reset();
    return value;
  }

  observe(now, active, options = this.options()) {
    const elapsed = this.previous === null ? 0 : now - this.previous;
    if (active && this.wasActive && elapsed > 0 && elapsed <= 10000) {
      for (const kind of ['water', 'stand']) {
        if (options[kind]) this.elapsed[kind] = Math.min(this.elapsed[kind] + elapsed, options[kind] * MINUTE);
      }
    }
    this.previous = now;
    this.wasActive = active;
  }

  claim(now, zone, active) {
    if (!active) return null;
    const options = this.options(), kinds = [];
    for (const kind of ['water', 'stand']) {
      if (options[kind] && this.elapsed[kind] >= options[kind] * MINUTE) {
        kinds.push(kind);
        this.elapsed[kind] = 0;
      }
    }
    if (options.night) {
      const { day, time } = calendar(now, zone);
      const within = options.nightAt >= '20:00' ? time >= options.nightAt || time < '06:00'
        : time >= options.nightAt && time < '06:00';
      const night = time < '06:00' ? new Date(Date.parse(day) - 24 * 60 * MINUTE).toISOString().slice(0, 10) : day;
      if (within && this.storage.read('wellness-night', '') !== night) {
        this.storage.write('wellness-night', night);
        kinds.push('night');
      }
    }
    return kinds.length ? { kinds, voice: options.voice, notify: options.notify } : null;
  }
}

module.exports = { Wellness };
