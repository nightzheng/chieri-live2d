'use strict';

const { app, ipcMain, BrowserWindow, desktopCapturer, powerMonitor, dialog, nativeImage, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { DEFAULTS, INTERVALS, MAX_IMAGE, VisionFlow, validateConfig, parseRequest, isPrivate } = require('./vision');
const { writeAtomic } = require('./memory-store');
const { windowIdentity } = require('./vision-window');

module.exports = function registerVision(trustedWindow, activeWindow, proactivePolicy, chatTarget, language = zh => zh) {
  const file = path.join(app.getPath('userData'), 'vision-settings.json');
  const grantFile = path.join(app.getPath('userData'), 'proactive-screen.json');
  const supported = process.platform === 'win32';
  const windows = () => BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
  let config = { ...DEFAULTS, key: '' }, configError = '', inventory, owner, confirming = false, locked = false;
  let encryptedKey = '', saving = false;
  let grant;
  try {
    const value = JSON.parse(fs.readFileSync(grantFile, 'utf8'));
      if (/^(screen|window):/.test(value?.source?.id) && typeof value.source.name === 'string' &&
        typeof value.source.display === 'string' && typeof value.chat === 'string' && typeof value.vision === 'string') grant = value;
  } catch (_) {}
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
  async function capture(source, options, proactive = false) {
    if (!allowed()) throw new Error('截图权限已暂停');
    const protectedWindows = windows().filter(win => !win.isContentProtected());
    try {
      for (const win of protectedWindows) win.setContentProtection(true);
      await delay(180); // Let Windows compose a frame with the viewer excluded.
      if (!allowed()) throw new Error('截图权限已暂停');
      const types = [source.id.startsWith('window:') ? 'window' : 'screen'];
      const own = ourIds();
      const eligible = entry => !own.has(entry.id);
      const blocked = titles => {
        if (titles.some(entry => eligible(entry) && isPrivate(entry.name, options.privateWords))) {
          flow.error = '检测到隐私窗口，已跳过这次截图';
          return true;
        }
        return false;
      };
      const display = types[0] === 'screen';
      const titles = () => desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
      if ((proactive && display && blocked(await titles())) || !allowed()) return null;
      const entries = await desktopCapturer.getSources({ types, thumbnailSize: { width: options.size, height: options.size } });
      if (proactive && display && blocked(await titles())) return null;
      const selected = entries.find(entry => entry.id === source.id && eligible(entry) &&
        (entry.display_id || '') === source.display);
      if (!selected || selected.thumbnail.isEmpty()) throw new Error('共享来源已关闭或不可捕获');
      if (proactive && !display && blocked([selected])) return null;
      if (proactive && !display && source.identity) {
        if (await windowIdentity(source.id) !== source.identity) throw new Error('共享窗口已关闭或被替换，请重新授权');
        const current = (await titles()).find(entry => entry.id === source.id);
        if (!current || current.name !== selected.name) throw new Error('共享窗口已变化，已跳过本次截图');
      } else if (selected.name !== source.name) {
        throw new Error('共享来源已更名，请重新预览并授权');
      }
      if (!allowed()) return null;
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
    const { id, name, display } = grant?.source || {};
    return { ...flow.status(), savedSource: matchesGrant() ? { id, name, display } : null, config: { ...publicConfig, hasKey: !!key }, supported, configError };
  };
  const visionTarget = () => JSON.stringify([config.base, config.model, config.provider]);
  const matchesGrant = () => grant && config.enabled && grant.vision === visionTarget() && grant.chat === chatTarget();
  const revoke = reason => { inventory = null; flow.stop(reason); };
  const forget = () => { fs.rmSync(grantFile, { force: true }); grant = undefined; revoke('已撤销主动观察授权'); };
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
        type: 'warning', message: text, detail, buttons: [language('取消', 'Cancel'), language('同意发送', 'Allow')],
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
    const action = observe ? language(`观察 ${observe.duration} 分钟，每 ${observe.interval} 分钟截图一次？`,
      `Observe for ${observe.duration} minutes and capture every ${observe.interval} minutes?`) : language('发送这张预览截图？', 'Send the previewed screenshot?');
    const approved = await confirm(win, action, language(
      `范围：${source.name}\n服务：${config.base}\n模型：${config.model}\n请确认画面中没有密码和私人资料。观察期间可随时停止。`,
      `Source: ${source.name}\nService: ${config.base}\nModel: ${config.model}\nCheck that the image contains no passwords or personal data. You can stop at any time.`));
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
      const epoch = flow.generation;
      const entries = await desktopCapturer.getSources({ types: [kind], thumbnailSize: { width: 0, height: 0 } });
      check(win);
      if (epoch !== flow.generation) throw new Error('截图已取消');
      const own = ourIds();
      const sources = entries.filter(entry => !own.has(entry.id)).slice(0, 100)
        .map(({ id, name, display_id }) => ({ id, name, display: display_id || '' }));
      if (inventory?.win !== win) inventory = { win };
      inventory[kind] = { sources, at: Date.now() };
      return sources;
    },
    async preview(win, value) {
      check(win);
      if (flow.observation?.mode === 'proactive') flow.stop();
      const selection = inventory?.win === win && inventory[value?.id?.split(':')[0]];
      const source = selection && Date.now() - selection.at < 120000 && selection.sources.find(item => item.id === value?.id);
      if (!source) throw new Error('请刷新范围并重新选择');
      const selected = config, epoch = flow.generation;
      const identity = source.id.startsWith('window:') ? await windowIdentity(source.id) : '';
      check(win);
      if (selected !== config || epoch !== flow.generation) throw new Error('截图已取消');
      return flow.stage(win, identity ? { ...source, identity } : source, parseRequest(value.question), config);
    },
    send: (win, token) => send(win, token),
    observe: (win, value) => send(win, value?.token, { interval: value?.interval, duration: value?.duration }),
    async observeProactive(win, value) {
      check(win);
      const { source } = flow.inspect(win, value?.token);
      const policy = proactivePolicy(), chat = chatTarget(), selected = config;
      if (!policy || !chat) throw new Error('请先保存主动闲聊、AI 台词、看屏幕选项和聊天 API');
      const approved = await confirm(win, language('记住主动观察授权？', 'Remember permission for proactive screen viewing?'), language(
        `范围：${source.name}\n每 ${policy.visionEvery} 次主动闲聊查看一次\n图片发送到：${config.base}\n简短描述发送到聊天服务：${chat}\n授权在重启后仍有效，可随时撤销。隐私关键词只能过滤窗口标题和识别结果，请避开敏感画面。`,
        `Source: ${source.name}\nCapture once per ${policy.visionEvery} proactive chats\nImages go to: ${config.base}\nShort descriptions go to: ${chat}\nPermission persists across restarts and can be revoked. Privacy keywords only screen window titles and descriptions. Keep sensitive content out of the shared area.`));
      if (!approved) return null;
      check(win);
      if (selected !== config || chatTarget() !== chat || proactivePolicy()?.visionEvery !== policy.visionEvery) throw new Error('设置已变更，请重新授权');
      if (source.identity && await windowIdentity(source.id) !== source.identity) throw new Error('共享窗口已关闭或被替换，请重新授权');
      check(win);
      if (selected !== config || chatTarget() !== chat || proactivePolicy()?.visionEvery !== policy.visionEvery) throw new Error('设置已变更，请重新授权');
      flow.inspect(win, value.token);
      const next = { source, chat, vision: visionTarget() };
      writeAtomic(grantFile, next);
      grant = next;
      flow.beginProactive(win, value.token, config, { every: policy.visionEvery, chat });
      return true;
    },
    forget,
    stop() { revoke('视觉会话已停止'); },
    clear() { inventory = null; flow.clear(); },
    async test(win, mode) {
      check(win);
      if (!['connection', 'image'].includes(mode)) throw new Error('视觉测试类型无效');
      const epoch = flow.generation, selected = config;
      const message = mode === 'image' ? language('向视觉服务发送合成测试色块？', 'Send a synthetic test image to the vision service?')
        : language('测试视觉服务连接？', 'Test the vision service connection?');
      if (!await confirm(win, message, config.base)) return null;
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
    stop: () => { if (grant) forget(); else revoke('视觉会话已停止'); },
    markSpoken: win => flow.markSpoken(win),
    async sample(win, endpoint, permitted) {
      await ready;
      const policy = proactivePolicy();
      if (!matchesGrant()) return { status: 'permission' };
      if (!policy || !permitted() || !visible(win) || lockedNow() || win !== activeWindow()) return { status: 'unavailable' };
      if (!flow.observation && !flow.busy && !flow.preview) {
        check(win);
        flow.activateProactive(win, grant.source, config, { every: policy.visionEvery, chat: endpoint });
      }
      const session = flow.observation;
      if (session?.mode === 'proactive' && (session.spoken + 1) % session.every !== 0) return { status: 'cadence' };
      const description = await flow.proactiveSample(win, endpoint,
        () => !!allowed() && matchesGrant() && proactivePolicy()?.visionEvery === flow.observation?.every && permitted(), language('中文', 'English'));
      return { description, status: description ? 'captured' : 'unavailable' };
    },
  };
};
