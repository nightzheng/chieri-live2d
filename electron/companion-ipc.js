'use strict';

const { app, ipcMain, Notification, powerMonitor, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Agenda, calendar, nextOccurrence, parseReminder } = require('./agenda');
const { Proactive, command } = require('./proactive');

module.exports = function companion({ store, trustedWindow, activeWindow, settings }) {
  const reminders = new Agenda(() => store.open());
  const proactive = new Proactive(() => store.open());
  const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const notifications = new Map();
  let ticket, delivery, locked = false, activity = Date.now(), pendingDb, suspended = false, announcedMissed = 0;
  const invalidate = () => { ticket = delivery = null; };
  const presence = (busy = false, recording = false) => ({ now: Date.now(), zone: zone(), idle: Date.now() - activity,
    locked: locked || suspended, busy, recording: recording || !!settings().rec?.on, reminder: !!reminders.pending() });

  function showNotice(event) {
    if (!event.notify || !Notification.isSupported()) return;
    const notice = new Notification({ title: event.title, body: event.content || '千绘莉的日程提醒' });
    notifications.set(event.id, notice);
    const cleanup = () => notifications.delete(event.id);
    notice.once('close', cleanup);
    notice.once('failed', cleanup);
    notice.once('click', () => {
      cleanup();
      const win = activeWindow();
      if (win) {
        win.show();
        win.focus();
        win.webContents.send('companion:agenda');
      }
    });
    notice.show();
  }

  function tick(missed = false) {
    if (suspended) return;
    try {
      const db = store.open();
      const first = db !== pendingDb;
      pendingDb = db;
      if (first) { reminders.recoverPending(); proactive.reset(); invalidate(); announcedMissed = 0; }
      for (const row of reminders.tick(Date.now(), missed || first)) showNotice(row);
    } catch (_) {
      // The memory panel surfaces unavailable data and recovery actions.
    }
  }

  powerMonitor.on('lock-screen', () => { locked = true; invalidate(); });
  powerMonitor.on('unlock-screen', () => { locked = false; activity = Date.now(); });
  powerMonitor.on('suspend', () => { suspended = true; invalidate(); });
  powerMonitor.on('resume', () => { suspended = false; activity = Date.now(); tick(true); });
  const timer = setInterval(tick, 3000);
  tick(true);
  app.on('will-quit', () => clearInterval(timer));

  const confirmSchedule = async (win, input) => {
    const now = Date.now(), draft = parseReminder(input, now, zone());
    if (!draft) return null;
    const next = nextOccurrence(draft, now);
    if (next === null) throw new Error('提醒时间已过，请选择未来时间');
    const first = calendar(next, draft.timezone);
    const { response } = await dialog.showMessageBox(win, {
      buttons: ['取消', '保存提醒'], defaultId: 0, cancelId: 0, message: draft.title,
      detail: '首次提醒 ' + first.day + ' ' + first.time + ' · ' + draft.timezone +
        (draft.weekdays ? ' · 重复星期' + [...'日一二三四五六'].filter((_, i) => draft.weekdays & (1 << i)).join('、') : ' · 单次提醒'),
    });
    if (response !== 1 || win.isDestroyed()) return 'cancelled';
    reminders.save(draft, Date.now(), 'chat');
    return 'saved';
  };

  const operations = {
    list: () => ({ ...reminders.list(), timezone: zone() }),
    save: (_, value) => reminders.save(value, Date.now()),
    toggle: (_, value) => reminders.toggle(value?.id, value?.enabled, Date.now()),
    remove: (_, id) => reminders.remove(id),
    event(_, value) {
      if (value?.action === 'show') throw new Error('无效的提醒操作');
      const changed = reminders.action(value?.id, value?.action, Date.now());
      if (changed && value.action === 'replay') showNotice(reminders.event(value.id));
      return changed;
    },
    schedule: confirmSchedule,
    async exportFile(win) {
      const { filePath } = await dialog.showSaveDialog(win, { defaultPath: 'chieri-reminders.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!filePath || win.isDestroyed()) return false;
      if (path.extname(filePath).toLowerCase() !== '.json') throw new Error('请选择新的 JSON 文件');
      store.directory(path.dirname(filePath));
      fs.writeFileSync(filePath, JSON.stringify(reminders.export(), null, 2), { flag: 'wx', flush: true });
      return true;
    },
    async importFile(win) {
      const { filePaths } = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!filePaths[0] || win.isDestroyed()) return null;
      const f = fs.statSync(filePaths[0]);
      if (!f.isFile() || f.size > 2 * 1024 * 1024) throw new Error('提醒文件必须小于 2 MB');
      const text = fs.readFileSync(filePaths[0], 'utf8');
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { throw new Error('提醒文件不是有效的 JSON'); }
      return reminders.import(parsed, Date.now());
    },
    options: () => proactive.options(),
    configure: (_, value) => { invalidate(); proactive.temporary('normal', 0, Date.now()); return proactive.configure(value, Date.now()); },
    status: (_, value) => proactive.status(presence(value?.busy === true, value?.recording === true)),
    activity: (_, kind) => {
      activity = Date.now();
      proactive.feedback(kind, activity);
      invalidate();
    },
    async command(win, text) {
      const intent = command(text);
      if (!intent) return null;
      invalidate();
      const now = Date.now(), options = proactive.options();
      if (intent.frequency) {
        const increase = intent.frequency === 'occasional';
        const frequency = increase ? 'occasional' : ({ frequent: 'medium', medium: 'occasional' })[options.frequency] || 'custom';
        const min = !increase && frequency === 'custom' ? Math.min(1440, Math.max(90, options.min + 15)) : options.min;
        const result = await dialog.showMessageBox(win, { message: '保存新的主动互动频率？',
          detail: frequency === 'custom' ? '最小间隔 ' + min + ' 分钟' : frequency === 'medium' ? '20–40 分钟' : '45–90 分钟',
          buttons: ['取消', '保存'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1 || win.isDestroyed()) return '未更改主动互动设置。';
        proactive.configure({ ...proactive.options(), enabled: increase || options.enabled, frequency, min }, Date.now());
        return '已保存新的主动互动频率。';
      }
      proactive.temporary(intent.mode, intent.minutes, now);
      if (intent.mode === 'normal') {
        if (options.manual !== 'normal') proactive.configure({ ...options, manual: 'normal' }, now);
        return '可以聊天了。主动闲聊仍按你的开关和安静时段运行。';
      }
      return '接下来 ' + intent.minutes + ' 分钟暂停普通闲聊，日程提醒照常。';
    },
    canSpeak(win, id) {
      return delivery?.win === win && delivery.id === id && Date.now() < delivery.expires && win === activeWindow() &&
        !proactive.status(presence()).blocked;
    },
    spoken(win, id) {
      if (delivery?.win !== win || delivery.id !== id || proactive.status(presence()).blocked) return false;
      delivery = null;
      proactive.spoken(Date.now());
      return true;
    },
    poll(win, value) {
      if (typeof value?.busy !== 'boolean' || typeof value.recording !== 'boolean' || typeof value.proactiveBusy !== 'boolean' || win !== activeWindow() ||
          locked || suspended || value.busy) return null;
      let reminder;
      let missed;
      try {
        reminder = reminders.pending();
        const count = reminders.missedCount();
        if (count !== announcedMissed) { announcedMissed = count; missed = count; }
      } catch (_) { return null; }
      const now = Date.now();
      if (reminder && reminders.action(reminder.id, 'show', now)) return { reminder, missed };
      const next = proactive.claim({ now, zone: zone(), idle: now - activity, busy: value.proactiveBusy, locked, recording: value.recording || !!settings().rec?.on });
      if (!next) return missed ? { missed } : null;
      ticket = { id: randomUUID(), win, expires: now + 20000 };
      delivery = { ...ticket, expires: now + 30000 };
      return { proactive: { ai: next.ai, voice: next.voice, ticket: ticket.id }, missed };
    },
  };
  ipcMain.handle('companion:operate', (event, operation, value) => {
    const win = trustedWindow(event);
    if (!win || typeof operation !== 'string' || !Object.hasOwn(operations, operation)) throw new Error('提醒操作来源无效');
    return operations[operation](win, value);
  });

  return {
    useTicket(win, id) {
      if (!ticket || ticket.win !== win || ticket.id !== id || ticket.expires < Date.now() || proactive.status(presence()).blocked) return null;
      ticket = null;
      const options = proactive.options();
      return options.enabled && options.ai ? { memory: options.memory } : null;
    },
    pause() {
      const options = proactive.options();
      proactive.temporary('normal', 0, Date.now());
      proactive.configure({ ...options, manual: 'quiet' }, Date.now());
      invalidate();
      activeWindow()?.webContents.send('companion:paused');
    },
  };
};
