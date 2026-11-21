'use strict';

const { calendar, validTime } = require('./agenda');

const MINUTE = 60000;
const LIMITS = { occasional: [45, 90], medium: [20, 40], frequent: [10, 20] };
const VISION_INTERVALS = [1, 2, 3, 5, 10];
const DEFAULTS = { enabled: false, frequency: 'occasional', min: 30, quietFrom: '23:00', quietTo: '08:00',
  limit: 12, ai: false, preset: true, presetMin: 45, presetLimit: 4, memory: false, voice: false,
  adaptive: true, strength: 'medium', manual: 'normal', vision: false, visionEvery: 3 };
const STREAMS = ['ai', 'preset'];

function compatibleOptions(options) {
  if (typeof options !== 'object' || Array.isArray(options)) throw new Error('主动互动设置无效');
  if ('preset' in options || !Object.keys(options).length) return { ...DEFAULTS, ...options };
  return { ...DEFAULTS, ...options, preset: !options.ai,
    presetMin: LIMITS[options.frequency]?.[0] ?? options.min ?? DEFAULTS.presetMin,
    presetLimit: options.ai ? DEFAULTS.presetLimit : options.limit ?? DEFAULTS.presetLimit,
    limit: options.ai ? options.limit ?? DEFAULTS.limit : DEFAULTS.limit };
}

function validOptions(options) {
  options = compatibleOptions(options ?? {});
  if (!['enabled', 'ai', 'preset', 'memory', 'voice', 'vision'].every(k => typeof options[k] === 'boolean') ||
    !VISION_INTERVALS.includes(options.visionEvery) ||
    ![...Object.keys(LIMITS), 'custom'].includes(options.frequency) || !validTime(options.quietFrom) || !validTime(options.quietTo) ||
    !Number.isInteger(options.min) || options.min < 10 || options.min > 1440 ||
    !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 60 ||
    !Number.isInteger(options.presetMin) || options.presetMin < 10 || options.presetMin > 1440 ||
    !Number.isInteger(options.presetLimit) || options.presetLimit < 1 || options.presetLimit > 24 ||
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

function streamTiming(options, stream) {
  return stream === 'ai' ? options : { frequency: 'custom', min: options.presetMin, limit: options.presetLimit };
}

function command(text) {
  if (typeof text !== 'string') return null;
  const english = text.trim().replace(/^chieri,?\s+/i, '').replace(/[.!]+$/, '').toLowerCase();
  if (/^(?:please )?(?:do not disturb|don't disturb me|be quiet)(?: now)?$/.test(english)) return { mode: 'quiet', minutes: 60 };
  if (/^(?:you can chat with me(?: now)?|resume chatting)$/.test(english)) return { mode: 'normal', minutes: 0 };
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

  reset() {
    this.session = { chat: 0, touch: 0, until: 0, focus: '' };
    for (const stream of STREAMS) this.session[stream] = { latest: 0, waiting: 0, ignored: 0 };
  }

  read(key, initial) {
    const row = this.open().prepare('SELECT value FROM proactive WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : initial;
  }

  write(key, value) {
    this.open().prepare('INSERT INTO proactive VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }

  options() { return compatibleOptions(this.read('options', {})); }

  state(options) {
    const { next, interval, sent, ...state } = this.read('state', {});
    state.streams ??= { [options.ai ? 'ai' : 'preset']: { next, interval, sent } };
    return state;
  }

  feedback(kind, now) {
    const session = this.session;
    if (kind === 'chat') {
      for (const stream of STREAMS) {
        const s = session[stream];
        if (s.waiting && now - s.waiting <= 5 * MINUTE) {
          s.ignored = 0;
          s.waiting = 0;
        }
      }
      session.chat = now;
    } else if (kind === 'touch') session.touch = now;
  }

  temporary(mode, minutes, now) {
    if (!['quiet','focus','normal'].includes(mode) || !Number.isInteger(minutes) || minutes < 0 || minutes > 240) throw new Error('陪伴时长无效');
    this.session.focus = mode;
    this.session.until = mode === 'normal' ? 0 : now + minutes * MINUTE;
  }

  spoken(now, stream = 'preset') {
    this.session[stream].latest = this.session[stream].waiting = now;
    const options = this.options(), state = this.state(options);
    if (stream === 'preset') {
      const clock = state.streams.preset ??= {};
      clock.interval = delay(streamTiming(options, stream), this.random);
      clock.next = now + clock.interval;
      clock.sent = [...(clock.sent || []).filter(at => now - at < 48 * 60 * MINUTE), now];
    }
    this.write('state', { ...state, lastSpoken: now });
  }

  status({ now, zone, idle = Infinity, busy, locked, recording, reminder }, options = this.options()) {
    const s = this.session;
    for (const stream of STREAMS) {
      const response = s[stream];
      if (response.waiting && now - response.waiting > 5 * MINUTE) {
        response.ignored = Math.min(6, response.ignored + 1);
        response.waiting = 0;
      }
      if (response.latest && now - response.latest > 24 * 60 * MINUTE) response.ignored = 0;
    }
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
    if (!options.enabled || !STREAMS.some(stream => options[stream])) return result('安静', '主动闲聊已关闭');
    if (options.adaptive && STREAMS.some(stream => options[stream] && s[stream].ignored >= 2)) {
      return result('低打扰', '近期主动发言未获得聊天回应，正在延长间隔', false);
    }
    return result('日常', '按设置的间隔等待主动发言', false);
  }

  configure(options, now) {
    const next = validOptions(options), db = this.open();
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.options(), state = this.state(previous);
      for (const stream of STREAMS) {
        const clock = state.streams[stream] ??= {};
        const before = streamTiming(previous, stream), after = streamTiming(next, stream);
        if (next.enabled && next[stream] && (!previous.enabled || !previous[stream] ||
          before.frequency !== after.frequency || before.min !== after.min || !Number.isFinite(clock.next))) {
          clock.interval = delay(after, this.random);
          clock.next = now + clock.interval;
        }
      }
      this.write('options', next);
      this.write('state', state);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return next;
  }

  claim({ now, zone, idle, busy, locked, recording, aiReady = true }) {
    const options = this.options();
    if (this.status({ now, zone, idle, busy, locked, recording }, options).blocked) return null;
    const { day } = calendar(now, zone);
    const state = this.state(options);
    if (now - (state.lastSpoken ?? -Infinity) < MINUTE) return null;
    const strength = { gentle: .35, medium: .65, strong: 1 }[options.strength];
    let changed = false;
    for (const stream of STREAMS) {
      if (!options[stream] || (stream === 'ai' && !aiReady)) continue;
      const timing = streamTiming(options, stream), clock = state.streams[stream] ??= {};
      if (!Number.isFinite(clock.next)) {
        clock.interval = delay(timing, this.random);
        clock.next = now + clock.interval;
        changed = true;
        continue;
      }
      const recent = (clock.sent || []).filter(at => now - at < 48 * 60 * MINUTE);
      const ignored = this.session[stream].ignored;
      const backoff = options.adaptive && ignored >= 2 ? (clock.interval || delay(timing, () => 0)) * Math.min(3, (ignored - 1) * strength) : 0;
      if (clock.next + backoff > now || recent.filter(at => calendar(at, zone).day === day).length >= timing.limit) continue;
      if (stream === 'preset') {
        if (changed) this.write('state', state);
        return { ai: false, voice: options.voice };
      }
      clock.interval = delay(timing, this.random);
      clock.next = now + clock.interval;
      clock.sent = [...recent, now];
      this.write('state', state);
      return { ai: stream === 'ai', voice: options.voice };
    }
    if (changed) this.write('state', state);
    return null;
  }
}

module.exports = { Proactive, quiet, delay, command, VISION_INTERVALS };
