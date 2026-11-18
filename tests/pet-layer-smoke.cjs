'use strict';

// Classify a separate process's real Win32 windows without taking the user's foreground focus.
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { app, BrowserWindow } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');
const root = process.env.CHIERI_TEST_APP || path.resolve(__dirname, '..');
const { createPetLayer, watchFullscreen } = require(path.join(root, 'electron/pet-layer'));
const run = promisify(execFile);

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-layer-')));

async function fixture() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 600, height: 400, show: false });
  await win.loadURL('data:text/html,Fullscreen test');
  win.showInactive();
  console.log('ready ' + nativeId(win));
  const control = process.argv.find(argument => argument.startsWith('--control='))?.slice('--control='.length);
  let last = '';
  const timer = setInterval(async () => {
    if (!fs.existsSync(control)) return;
    const line = fs.readFileSync(control, 'utf8');
    if (!line || last === line) return;
    last = line;
    if (line === 'quit') return app.exit(0);
    if (line === 'full') win.setFullScreen(true);
    if (line === 'max') { win.setFullScreen(false); win.maximize(); }
    win.showInactive();
    await delay(250);
    console.log(line);
  }, 50);
  app.on('will-quit', () => clearInterval(timer));
}

async function until(condition, message) {
  for (let step = 0; step < 100; step++) {
    if (condition()) return;
    await delay(100);
  }
  throw new Error(message);
}

function nativeId(win) {
  return win.getNativeWindowHandle().readBigUInt64LE().toString();
}

async function classify(pet, candidate) {
  const source = fs.readFileSync(path.join(root, 'electron/pet-fullscreen.ps1'), 'utf8');
  const definition = source.slice(0, source.lastIndexOf('[PetFullscreen]::Watch'));
  const script = definition + `[PetFullscreen]::Covered([IntPtr]${nativeId(pet)}, [uint32]${process.pid}, [IntPtr]${candidate})`;
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = await run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10000 });
  assert.match(result.stdout.trim(), /^(True|False)$/);
  return result.stdout.trim() === 'True';
}

async function test() {
  await app.whenReady();
  const pet = new BrowserWindow({ width: 140, height: 160, frame: false, transparent: true, show: false });
  await pet.loadURL('data:text/html,<body style="background:pink"></body>');
  const setTop = pet.setAlwaysOnTop.bind(pet);
  let update, zOrder;
  pet.setAlwaysOnTop = (enabled, mode) => { zOrder = enabled ? mode : 'normal'; setTop(enabled, mode); };
  const layer = createPetLayer(pet, (_, receive) => { update = receive; return () => {}; }, true);
  const control = path.join(app.getPath('userData'), 'fixture-command.txt');
  const fixtureProcess = spawn(process.execPath, [__filename, '--fixture', '--control=' + control],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: fixtureProcess.stdout });
  let candidate, phase;
  lines.on('line', line => {
    const ready = /^ready (\d+)$/.exec(line);
    if (ready) candidate = ready[1];
    else phase = line;
  });
  try {
    await until(() => candidate, 'Fixture window did not start');
    layer.apply('floating', false);
    layer.show();
    assert.equal(await classify(pet, candidate), false);
    update(false);
    assert.ok(pet.isVisible());
    assert.equal(zOrder, 'floating');
    fs.writeFileSync(control, 'full');
    await until(() => phase === 'full', 'The fixture did not enter fullscreen');
    assert.equal(await classify(pet, candidate), true);
    update(true);
    assert.equal(pet.isVisible(), false);
    layer.apply('top', false);
    assert.ok(pet.isVisible());
    assert.equal(zOrder, 'screen-saver');
    layer.apply('floating', false);
    update(true);
    assert.equal(pet.isVisible(), false);
    fs.writeFileSync(control, 'max');
    await until(() => phase === 'max', 'The fixture did not maximize');
    assert.equal(await classify(pet, candidate), false);
    update(false);
    assert.ok(pet.isVisible());
    assert.equal(zOrder, 'floating');
    const state = await new Promise((resolve, reject) => {
      const stop = watchFullscreen(pet, covered => { stop(); resolve(covered); }, () => reject(new Error('Live foreground watcher did not respond')));
    });
    assert.equal(typeof state, 'boolean');
    console.log('Win32 fullscreen classification, floating hide/restore, top visibility and live foreground polling passed.');
  } finally {
    layer.dispose();
    fs.writeFileSync(control, 'quit');
    if (fixtureProcess.exitCode === null) {
      const stop = setTimeout(() => fixtureProcess.kill(), 3000);
      await once(fixtureProcess, 'exit');
      clearTimeout(stop);
    }
  }
}

(process.argv.includes('--fixture') ? fixture() : test().then(() => app.exit(0)))
  .catch(error => { console.error(error); app.exit(1); });
