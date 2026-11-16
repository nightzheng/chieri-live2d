'use strict';

const { app, ipcMain, Notification, powerMonitor, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Agenda, calendar, nextOccurrence, parseReminder } = require('./agenda');
const { Proactive, quiet } = require('./proactive');

module.exports = function companion({ store, trustedWindow, activeWindow, settings }) {
  const reminders = new Agenda(() => store.open());
  const proactive = new Proactive(() => store.open());
  const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const notifications = new Map();
  let ticket, locked = false, activity = Date.now(), pendingDb, suspended = false, announcedMissed = 0;

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
      if (first) { reminders.recoverPending(); announcedMissed = 0; }
      for (const row of reminders.tick(Date.now(), missed || first)) showNotice(row);
    } catch (_) {
      // The memory panel surfaces unavailable data and recovery actions.
    }
  }

  powerMonitor.on('lock-screen', () => { locked = true; ticket = null; });
  powerMonitor.on('unlock-screen', () => { locked = false; activity = Date.now(); });
  powerMonitor.on('suspend', () => { suspended = true; ticket = null; });
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
    configure: (_, value) => { ticket = null; return proactive.configure(value, Date.now()); },
    activity: () => { activity = Date.now(); ticket = null; },
    canSpeak(win) {
      const now = Date.now(), options = proactive.options();
      return win === activeWindow() && !locked && !suspended && !settings().rec?.on && now - activity >= 3 * 60000 &&
        options.enabled && !quiet(calendar(now, zone()).time, options) && !reminders.pending();
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
      if (!ticket || ticket.win !== win || ticket.id !== id || ticket.expires < Date.now() || locked || suspended) return null;
      ticket = null;
      const options = proactive.options();
      return options.enabled && options.ai ? { memory: options.memory } : null;
    },
    pause() {
      const options = proactive.options();
      proactive.configure({ ...options, enabled: false }, Date.now());
      ticket = null;
      activeWindow()?.webContents.send('companion:paused');
    },
  };
};
