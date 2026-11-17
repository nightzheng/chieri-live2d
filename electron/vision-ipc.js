'use strict';

const { app, ipcMain, BrowserWindow, desktopCapturer, powerMonitor, dialog, nativeImage, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { DEFAULTS, INTERVALS, PROACTIVE_DURATIONS, MAX_IMAGE, VisionFlow, validateConfig, parseRequest } = require('./vision');
const { writeAtomic } = require('./memory-store');

module.exports = function registerVision(trustedWindow, activeWindow, proactivePolicy, chatTarget) {
  const file = path.join(app.getPath('userData'), 'vision-settings.json');
  const supported = process.platform === 'win32';
  const windows = () => BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
  let config = { ...DEFAULTS, key: '' }, configError = '', inventory, owner, confirming = false, locked = false;
  let encryptedKey = '', saving = false;
  const monitored = new WeakSet();
  const ready = (async () => {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      config = { ...validateConfig(saved), key: '' };
      if (saved.encryptedKey) {
        encryptedKey = saved.encryptedKey;
        config.key = (await safeStorage.decryptStringAsync(Buffer.from(encryptedKey, 'base64'))).result;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        config.enabled = false;
        configError = '视觉配置或加密密钥无法读取，请重新配置';
      }
    }
  })();

  const lockedNow = () => locked || powerMonitor.getSystemIdleState(10) === 'locked';
  const visible = win => win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  const allowed = () => supported && config.enabled && !lockedNow() && visible(owner) && owner === activeWindow();
  function check(win) {
    if (!supported || !config.enabled) throw new Error('请先开启并保存视觉 API 设置');
    if (lockedNow() || win !== activeWindow() || !visible(win)) throw new Error('屏幕锁定或当前窗口不可截图');
    owner = win;
    if (!monitored.has(win)) {
      monitored.add(win);
      for (const name of ['hide','minimize','closed']) {
        win.on(name, () => { if (owner === win) { revoke('窗口隐藏或关闭，视觉权限已停止'); owner = null; } });
      }
    }
  }

  const ourIds = () => new Set(windows().map(win => win.getMediaSourceId()));
  async function capture(source, options) {
    if (!allowed()) throw new Error('截图权限已暂停');
    const protectedWindows = windows().filter(win => !win.isContentProtected());
    try {
      for (const win of protectedWindows) win.setContentProtection(true);
      await delay(180); // Let Windows compose a frame with the viewer excluded.
      if (!allowed()) throw new Error('截图权限已暂停');
      const types = [source.id.startsWith('window:') ? 'window' : 'screen'];
      const own = ourIds();
      const entries = await desktopCapturer.getSources({ types, thumbnailSize: { width: options.size, height: options.size } });
      const selected = entries.find(entry => entry.id === source.id && entry.name === source.name && !own.has(entry.id));
      if (!selected || selected.thumbnail.isEmpty()) throw new Error('共享来源已关闭、更名或不可捕获');
      let jpeg = selected.thumbnail.toJPEG(options.quality);
      if (jpeg.length > MAX_IMAGE) jpeg = selected.thumbnail.resize({ width: 768 }).toJPEG(55);
      if (!jpeg.length || jpeg.length > MAX_IMAGE) throw new Error('截图超过 1 MB，请降低尺寸');
      return jpeg;
    } finally {
      for (const win of protectedWindows) if (!win.isDestroyed()) win.setContentProtection(false);
    }
  }
  const broadcast = status => {
    for (const win of windows()) win.webContents.send('vision:update', status);
  };
  const flow = new VisionFlow({ capture, notify: broadcast });
  const state = () => {
    const { key, ...publicConfig } = config;
    return { ...flow.status(), config: { ...publicConfig, hasKey: !!key }, supported, configError };
  };
  const revoke = reason => { inventory = null; flow.stop(reason); };
  const onLock = () => { locked = true; revoke('屏幕锁定或休眠，视觉权限已停止'); };
  powerMonitor.on('lock-screen', onLock);
  powerMonitor.on('suspend', onLock);
  powerMonitor.on('unlock-screen', () => { locked = false; });
  powerMonitor.on('resume', () => { locked = false; });
  const timer = setInterval(() => {
    if (owner && (owner.isDestroyed() || owner !== activeWindow())) {
      revoke('原授权窗口已关闭');
      owner = null;
    }
    try {
      const session = flow.observation;
      const current = session?.mode !== 'proactive' ||
        (proactivePolicy()?.visionEvery === session.every && chatTarget() === session.chat);
      flow.tick(!!allowed() && current).catch(() => {});
    } catch (_) { revoke('无法读取主动互动设置，已停止观察'); }
  }, 1000);
  app.on('will-quit', () => { clearInterval(timer); revoke(''); });

  async function confirm(win, text, detail) {
    if (confirming) throw new Error('请先完成当前视觉确认');
    confirming = true;
    try {
      return (await dialog.showMessageBox(win, {
        type: 'warning', message: text, detail, buttons: ['取消', '同意发送'],
        defaultId: 0, cancelId: 0, noLink: true,
      })).response === 1;
    } finally { confirming = false; }
  }

  async function send(win, token, observe) {
    check(win);
    const { source } = flow.inspect(win, token);
    if (observe && (!INTERVALS.includes(observe.duration) || !INTERVALS.includes(observe.interval) || observe.interval >= observe.duration)) {
      throw new Error('截图周期须短于观察时长');
    }
    const selectedConfig = config;
    const action = observe ? `观察 ${observe.duration} 分钟，每 ${observe.interval} 分钟截图一次` : '发送这张预览截图';
    const approved = await confirm(win, action + '？', `范围：${source.name}\n服务：${config.base}\n模型：${config.model}\n请确认画面中没有密码和私人资料。观察期间可随时停止。`);
    if (!approved) { flow.stop(); return null; }
    check(win);
    if (config !== selectedConfig) throw new Error('视觉配置已变更，请重新截图');
    return flow.send(win, token, config, observe);
  }

  const operations = {
    state,
    revealKey: () => config.key,
    async save(_, value) {
      const next = validateConfig(value);
      if (typeof value.key !== 'string' || value.key.length > 1024 || /[\r\n\0]/.test(value.key) || typeof value.clearKey !== 'boolean') {
        throw new Error('视觉密钥格式无效');
      }
      if (saving) throw new Error('视觉设置正在保存');
      saving = true;
      try {
        let nextEncrypted = value.clearKey ? '' : encryptedKey;
        let key = value.key.trim();
        if (key) {
          if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统密钥加密不可用');
          nextEncrypted = (await safeStorage.encryptStringAsync(key)).toString('base64');
        } else if (nextEncrypted) key = (await safeStorage.decryptStringAsync(Buffer.from(nextEncrypted, 'base64'))).result;
        if (next.provider === 'openai' && next.enabled && !key) throw new Error('请填写独立的视觉 API Key');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        writeAtomic(file, { ...next, encryptedKey: nextEncrypted });
        encryptedKey = nextEncrypted;
        config = { ...next, key };
        configError = '';
        flow.clear();
        inventory = null;
        return state();
      } finally {
        saving = false;
      }
    },
    async sources(win, kind) {
      check(win);
      if (!['screen', 'window'].includes(kind)) throw new Error('需要选择显示器或窗口');
      if (flow.observation || flow.busy) throw new Error('请先停止当前观察');
      const epoch = flow.generation;
      const entries = await desktopCapturer.getSources({ types: [kind], thumbnailSize: { width: 0, height: 0 } });
      check(win);
      if (epoch !== flow.generation) throw new Error('截图已取消');
      const own = ourIds();
      const sources = entries.filter(entry => !own.has(entry.id)).slice(0, 100).map(({ id, name }) => ({ id, name }));
      inventory = { win, sources, at: Date.now() };
      return sources;
    },
    async preview(win, value) {
      check(win);
      const source = inventory?.win === win && Date.now() - inventory.at < 120000 &&
        inventory.sources.find(item => item.id === value?.id);
      if (!source) throw new Error('请刷新范围并重新选择');
      return flow.stage(win, source, parseRequest(value.question), config);
    },
    send: (win, token) => send(win, token),
    observe: (win, value) => send(win, value?.token, { interval: value?.interval, duration: value?.duration }),
    async observeProactive(win, value) {
      check(win);
      const { source } = flow.inspect(win, value?.token);
      const policy = proactivePolicy(), chat = chatTarget(), selected = config;
      if (!policy || !chat) throw new Error('请先保存主动闲聊、AI 台词和看屏幕选项');
      if (!PROACTIVE_DURATIONS.includes(value.duration)) throw new Error('观察时长无效');
      const approved = await confirm(win, '授权本次主动观察？',
        `范围：${source.name}\n时长：${value.duration} 分钟\n每 ${policy.visionEvery} 次主动闲聊查看一次\n图片发送到：${config.base}\n简短描述发送到聊天服务：${chat}\n开启朗读时，回复可能由已选语音服务朗读。可以随时停止，请避开敏感内容。`);
      if (!approved) return null;
      check(win);
      if (selected !== config || chatTarget() !== chat || proactivePolicy()?.visionEvery !== policy.visionEvery) throw new Error('设置已变更，请重新授权');
      flow.beginProactive(win, value.token, config, { duration: value.duration, every: policy.visionEvery, chat });
      return true;
    },
    stop() { revoke('视觉会话已停止'); },
    clear() { inventory = null; flow.clear(); },
    async test(win, mode) {
      check(win);
      if (!['connection', 'image'].includes(mode)) throw new Error('视觉测试类型无效');
      const epoch = flow.generation, selected = config;
      if (!await confirm(win, mode === 'image' ? '向视觉服务发送合成测试色块？' : '测试视觉服务连接？', config.base)) return null;
      check(win);
      if (epoch !== flow.generation || selected !== config) throw new Error('视觉测试已取消');
      const image = mode === 'image' ? nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 255), { width: 64, height: 64 }).toJPEG(70) : null;
      return flow.test(config, image);
    },
  };
  ipcMain.handle('vision:operate', async (event, op, value) => {
    const win = trustedWindow(event);
    if (!win || typeof op !== 'string' || !Object.hasOwn(operations, op)) throw new Error('视觉操作来源无效');
    // Avoid surfacing unexpected service bodies or captured data through Electron IPC diagnostics.
    try { await ready; return { value: await operations[op](win, value) }; }
    catch (error) {
      const message = /^[\p{Script=Han}]/u.test(error.message) && error.message.length <= 140
        ? error.message : '视觉操作失败，请检查权限、来源和服务配置';
      return { error: message };
    }
  });
  return {
    stop: () => revoke('视觉会话已停止'),
    markSpoken: win => flow.markSpoken(win),
    sample: (win, endpoint, permitted) => flow.proactiveSample(win, endpoint,
      () => !!allowed() && proactivePolicy()?.visionEvery === flow.observation?.every && chatTarget() === endpoint && permitted()),
  };
};
