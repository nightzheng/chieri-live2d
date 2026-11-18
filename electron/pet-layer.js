'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');

function watchFullscreen(win, update, unavailable) {
  const script = fs.readFileSync(path.join(__dirname, 'pet-fullscreen.ps1'), 'utf8');
  const command = Buffer.from(script, 'utf16le').toString('base64');
  const handle = win.getNativeWindowHandle();
  const nativeId = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
    windowsHide: true,
    env: { ...process.env, CHIERI_PET_HANDLE: nativeId, CHIERI_PET_OWNER: String(process.pid) },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  let stopped = false;
  lines.on('line', line => {
    if (line === 'covered' || line === 'clear') {
      clearTimeout(startup);
      update(line === 'covered');
    }
  });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(startup);
    lines.close();
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  const failed = () => {
    if (stopped) return;
    stop();
    unavailable();
  };
  const startup = setTimeout(failed, 8000);
  child.stdin.on('error', () => {});
  child.on('error', failed);
  child.on('exit', failed);
  return stop;
}

function createPetLayer(win, probe = watchFullscreen, windows = process.platform === 'win32') {
  let level, floatingState, stopProbe, retry, applied, wanted = false, hidden = false, ignore = true, forward = true;
  const zOrder = () => {
    if (applied === 'floating' || applied === 'top') win.setAlwaysOnTop(true, applied === 'top' ? 'screen-saver' : 'floating');
    else win.setAlwaysOnTop(false);
  };
  const visibility = () => {
    if (win.isDestroyed()) return false;
    if (wanted && !hidden) {
      if (!win.isVisible()) {
        win.showInactive();
        // Apply the level after showing the window, as on the initial pet launch.
        zOrder();
        return true;
      }
    } else if (win.isVisible()) win.hide();
    return false;
  };
  const mouse = () => {
    if (win.isDestroyed()) return;
    if (hidden || !forward) win.setIgnoreMouseEvents(true);
    else win.setIgnoreMouseEvents(ignore, { forward: true });
  };
  const render = () => {
    if (win.isDestroyed()) return;
    let state = level === 'top' ? 'top' : 'normal';
    if (level === 'floating' && (!windows || floatingState === 'clear')) state = 'floating';
    if (level === 'floating' && windows && ['checking', 'covered'].includes(floatingState)) state = 'hidden';
    if (state === applied) return;
    applied = state;
    hidden = state === 'hidden';
    mouse();
    if (!visibility()) zOrder();
  };
  const begin = () => {
    if (win.isDestroyed()) return;
    const unavailable = () => {
      floatingState = 'unavailable';
      stopProbe = undefined;
      render();
      retry = setTimeout(begin, 30000);
    };
    try {
      stopProbe = probe(win, covered => {
        floatingState = covered ? 'covered' : 'clear';
        render();
      }, unavailable);
    } catch (_) { unavailable(); }
  };
  const stop = () => { clearTimeout(retry); stopProbe?.(); stopProbe = undefined; };
  return {
    apply(next, clickThrough) {
      if (next !== level) {
        stop();
        level = next;
        floatingState = 'checking';
        if (windows && level === 'floating') begin();
        render();
      }
      forward = !clickThrough;
      mouse();
    },
    show() { wanted = true; visibility(); },
    hide() { wanted = false; visibility(); },
    get wantsVisible() { return wanted; },
    ignoreMouse(value) { ignore = value; mouse(); },
    dispose: stop,
  };
}

module.exports = { createPetLayer, watchFullscreen };
