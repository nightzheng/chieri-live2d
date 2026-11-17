'use strict';

const { calendar, validTime } = require('./agenda');

const MINUTE = 60000;
const LIMITS = { occasional: [45, 90], medium: [20, 40], frequent: [10, 20] };
const DEFAULTS = { enabled: false, frequency: 'occasional', min: 30, quietFrom: '23:00', quietTo: '08:00',
  limit: 4, ai: false, memory: false, voice: false, adaptive: true, strength: 'medium', manual: 'normal' };

function validOptions(options) {
  options = { ...DEFAULTS, ...options };
  if (!options || !['enabled', 'ai', 'memory', 'voice'].every(k => typeof options[k] === 'boolean') ||
    ![...Object.keys(LIMITS), 'custom'].includes(options.frequency) || !validTime(options.quietFrom) || !validTime(options.quietTo) ||
    !Number.isInteger(options.min) || options.min < 10 || options.min > 1440 ||
    !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 24 ||
    !['gentle','medium','strong'].includes(options.strength) || !['normal','quiet','focus'].includes(options.manual) ||
    typeof options.adaptive !== 'boolean') {
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

function command(text) {
  if (typeof text !== 'string') return null;
  const line = text.trim().replace(/^千绘莉[，、,\s]*/, '').replace(/[。！!]+$/, '');
  if (/^(?:现在)?(?:请)?(?:别打扰我|不要打扰我|安静一下)$/.test(line)) return { mode: 'quiet', minutes: 60 };
  if (/^(?:可以陪我聊聊天|恢复陪伴|可以聊天了)$/.test(line)) return { mode: 'normal', minutes: 0 };
  if (/^你说话太频繁了$/.test(line)) return { frequency: 'less' };
  if (/^以后可以偶尔主动找我$/.test(line)) return { frequency: 'occasional' };
  const focus = /^接下来(一|两|二|三|四|[1-4])(?:个)?小时我要(?:专心|专注)(?:工作|学习)?$/.exec(line);
  if (focus) return { mode: 'focus', minutes: 60 * (+focus[1] || ({ 一: 1, 两: 2, 二: 2, 三: 3, 四: 4 })[focus[1]]) };
  return null;
}

class Proactive {
  constructor(open, random = Math.random) {
    this.open = open;
    this.random = random;
    this.reset();
  }

  reset() { this.session = { chat: 0, touch: 0, latest: 0, waiting: 0, ignored: 0, until: 0, focus: '' }; }

  read(key, initial) {
    const row = this.open().prepare('SELECT value FROM proactive WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : initial;
  }

  write(key, value) {
    this.open().prepare('INSERT INTO proactive VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }

  options() { return { ...DEFAULTS, ...this.read('options', {}) }; }

  feedback(kind, now) {
    const session = this.session;
    if (kind === 'chat') {
      if (session.waiting && now - session.waiting <= 5 * MINUTE) {
        session.ignored = 0;
        session.waiting = 0;
      }
      session.chat = now;
    } else if (kind === 'touch') session.touch = now;
  }

  temporary(mode, minutes, now) {
    if (!['quiet','focus','normal'].includes(mode) || !Number.isInteger(minutes) || minutes < 0 || minutes > 240) throw new Error('陪伴时长无效');
    this.session.focus = mode;
    this.session.until = mode === 'normal' ? 0 : now + minutes * MINUTE;
  }

  spoken(now) {
    this.session.latest = this.session.waiting = now;
    const state = this.read('state', {});
    this.write('state', { ...state, lastSpoken: now });
  }

  status({ now, zone, idle = Infinity, busy, locked, recording, reminder }, options = this.options()) {
    const s = this.session;
    if (s.waiting && now - s.waiting > 5 * MINUTE) {
      s.ignored = Math.min(6, s.ignored + 1);
      s.waiting = 0;
    }
    if (s.latest && now - s.latest > 24 * 60 * MINUTE) s.ignored = 0;
    const mode = s.until > now ? s.focus : options.manual;
    const lastSpoken = this.read('state', {}).lastSpoken ?? null;
    const result = (state, reason, blocked = true) => ({ state, reason, blocked, lastSpoken });
    if (reminder) return result('关心提醒', '有正式提醒等待处理');
    if (recording || locked) return result('安静', recording ? '录制模式' : '系统锁定或休眠');
    if (mode === 'quiet' || mode === 'focus') return result(mode === 'focus' ? '专注' : '安静',
      s.until > now ? '临时状态，直到 ' + new Date(s.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '手动设置');
    if (quiet(calendar(now, zone).time, options)) return result('安静', '当前处于安静时段');
    if (busy || idle < 3 * MINUTE || (s.chat && now - s.chat < 3 * MINUTE) || (s.touch && now - s.touch < 3 * MINUTE)) {
      return result('活跃交流', '正在处理交互、语音或处于互动冷却期');
    }
    if (!options.enabled) return result('安静', '主动闲聊已关闭');
    if (options.adaptive && s.ignored >= 2) return result('低打扰', '近期主动发言未获得聊天回应，正在延长间隔', false);
    return result('日常', '按设置的间隔等待主动发言', false);
  }

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
    if (this.status({ now, zone, idle, busy, locked, recording }, options).blocked) return null;
    const { day } = calendar(now, zone);
    const state = this.read('state', {});
    if (!Number.isFinite(state.next)) {
      this.write('state', { ...state, next: now + delay(options, this.random) });
      return null;
    }
    const recent = (state.sent || []).filter(at => now - at < 48 * 60 * MINUTE);
    const s = this.session;
    const strength = { gentle: .35, medium: .65, strong: 1 }[options.strength];
    const backoff = options.adaptive && s.ignored >= 2 ? (state.interval || delay(options, () => 0)) * Math.min(3, (s.ignored - 1) * strength) : 0;
    if (state.next + backoff > now || recent.filter(at => calendar(at, zone).day === day).length >= options.limit) return null;
    const interval = delay(options, this.random);
    this.write('state', { ...state, next: now + interval, interval, sent: [...recent, now] });
    return options;
  }
}

module.exports = { Proactive, quiet, delay, command };
