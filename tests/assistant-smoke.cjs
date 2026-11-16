'use strict';

// Electron integration with a synthetic image, a fake scheduler clock and loopback model APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, dialog, desktopCapturer, nativeImage, powerMonitor } = require('electron');
const { calendar } = require('../electron/agenda');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-assistant-test-'));
for (const dir of ['config', 'local', 'temp']) fs.mkdirSync(path.join(root, dir));
const profile = path.join(root, 'config');
app.setPath('userData', profile);
app.setPath('temp', path.join(root, 'temp'));
process.env.LOCALAPPDATA = path.join(root, 'local');
process.env.TEMP = path.join(root, 'temp');
process.env.L2D_START = 'studio';
let now = Date.parse('2026-11-16T03:00:00Z');
Date.now = () => now;
const realNow = performance.now.bind(performance);
let clockOffset = 0;
Object.defineProperty(performance, 'now', { value: () => realNow() + clockOffset });

let approved = false, shots = 0, sent = 0, failed = false, ownWindow, proactiveBody, chatBody;
const red = Buffer.alloc(96 * 64 * 4, 255);
const responses = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    if (req.url?.startsWith('/vision/')) {
      sent++;
      if (failed) { res.writeHead(503); return res.end('synthetic service error'); }
      const message = JSON.parse(body).messages[1].content;
      responses.push(message[1].image_url.url);
      res.end(JSON.stringify({ choices: [{ message: { content: '合成画面的视觉描述' } }] }));
    } else {
      const payload = JSON.parse(body);
      const proactive = payload.messages[0].content.includes('这是主动打招呼');
      if (proactive) proactiveBody = payload; else chatBody = payload;
      const output = { reply: proactive ? '生成的测试问候' : '正常聊天回复', emotion: 'happy' };
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
    }
  });
});

async function until(callback, wait = 10000) {
  const start = performance.now();
  while (performance.now() - start < wait) {
    try { const value = await callback(); if (value) return value; } catch (_) {}
    await delay(100);
  }
  throw new Error('Timed out waiting for integration state');
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  // Replace only the OS boundary. IPC, confirmation ordering, compression, encryption and HTTP are real.
  desktopCapturer.getSources = async ({ thumbnailSize }) => {
    if (thumbnailSize.width) shots++;
    const thumbnail = thumbnailSize.width ? nativeImage.createFromBitmap(red, { width: 96, height: 64 }) : nativeImage.createEmpty();
    return [{ id: 'screen:420:0', name: 'Synthetic monitor', thumbnail }];
  };
  dialog.showMessageBox = async () => ({ response: approved ? 1 : 0 });
  powerMonitor.getSystemIdleState = () => 'active';

  require(path.resolve(process.env.CHIERI_TEST_APP || path.join(__dirname, '..'), 'electron/main.js'));
  ownWindow = await until(() => BrowserWindow.getAllWindows()[0]);
  const runJS = source => ownWindow.webContents.executeJavaScript(source);
  await until(() => runJS("typeof Chat !== 'undefined' && !Chat.sending && document.querySelector('#msgs .card')"));
  ownWindow.isVisible = () => true; // The integration harness is started hidden.
  const ipc = (api, op, value) => runJS(`petAPI.${api}(${JSON.stringify(op)}, ${JSON.stringify(value)})`);
  const call = async (op, value) => {
    const result = await ipc('vision', op, value);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  assert.equal((await call('state')).config.enabled, false);
  await assert.rejects(call('sources', 'screen'), /开启/);
  assert.equal(shots, 0);
  await ipc('memory', 'options', { enabled: false, auto: false });

  const agenda = await ipc('companion', 'list');
  const schedule = calendar(now + 2 * 60000, agenda.timezone);
  await ipc('companion', 'save', { ...schedule, timezone: agenda.timezone, title: '合成提醒', content: '测试',
    weekdays: 0, voice: false, notify: false, enabled: true });
  assert.equal((await ipc('companion', 'list')).reminders.length, 1);
  now += 2 * 60000;
  await until(() => runJS("document.querySelector('#msgs').textContent.includes('时间到了，记得合成提醒')"));
  assert.equal(await runJS("Array.from(document.querySelectorAll('#msgs .card')).filter(el => el.textContent.includes('合成提醒')).length"), 1);
  assert.equal(proactiveBody, undefined, 'reminder works without configured AI or stored memory');
  await runJS("Settings.open()");
  await until(() => runJS("document.querySelector('#aList').textContent.includes('合成提醒')"));
  approved = false;
  assert.equal(await ipc('companion', 'schedule', '明天十点提醒我测试'), 'cancelled');
  approved = true;
  assert.equal(await ipc('companion', 'schedule', '明天十点提醒我测试'), 'saved');

  const existing = await runJS('petAPI.getSettings()');
  await call('save', { enabled: true, provider: 'compatible', base: base + '/vision',
    model: 'synthetic-vision', key: 'synthetic-vision-key', clearKey: false, size: 768, quality: 70, timeout: 10000 });
  assert.deepEqual(await runJS('petAPI.getSettings()'), existing);
  const disk = fs.readFileSync(path.join(profile, 'vision-settings.json'), 'utf8');
  assert.ok(JSON.parse(disk).encryptedKey);
  assert.ok(!disk.includes('synthetic-vision-key'));
  assert.ok(!Object.hasOwn((await call('state')).config, 'key'));
  const [source] = await call('sources', 'screen');
  assert.equal(shots, 0);
  approved = false;
  let preview = await call('preview', { id: source.id, question: 'describe' });
  assert.match(preview.data, /^data:image\/jpeg;base64,/);
  assert.equal(shots, 1);
  assert.equal(sent, 0);
  assert.equal(await call('send', preview.token), null);
  assert.equal(sent, 0);
  preview = await call('preview', { id: source.id, question: 'describe' });
  approved = true;
  assert.equal(await call('observe', { token: preview.token, interval: 5, duration: 10 }), '合成画面的视觉描述');
  assert.equal(sent, 1);
  assert.equal(responses[0], preview.data);
  await until(() => runJS("!document.querySelector('#visionIndicator').classList.contains('hidden')"));
  powerMonitor.emit('lock-screen');
  assert.equal((await call('state')).observation, null);
  await until(() => runJS("document.querySelector('#visionIndicator').classList.contains('hidden')"));
  powerMonitor.emit('unlock-screen');
  await call('clear');
  assert.equal((await call('state')).latest, '');
  assert.equal((await ipc('memory', 'list')).length, 0);
  assert.equal((await ipc('memory', 'history')).some(row => row.text.includes('视觉描述')), false);

  clockOffset += 31000;
  failed = true;
  const [nextSource] = await call('sources', 'screen');
  preview = await call('preview', { id: nextSource.id, question: 'describe' });
  await assert.rejects(call('send', preview.token), /HTTP 503/);
  await runJS(`Object.assign(Store.data, { kind: 'openai', baseUrl: ${JSON.stringify(base + '/chat')}, model: 'synth-chat',
    aiChat: true, aiReact: false }); Settings.close(); Chat.send('视觉故障后的普通聊天')`);
  assert.ok(chatBody);
  assert.equal(await runJS("document.querySelector('#msgs').textContent.includes('正常聊天回复')"), true);

  // Disable global memory while separately permitting memory for proactive dialogue.
  await ipc('memory', 'save', { content: '永远不要发送的测试记忆', type: '兴趣', tags: '' });
  await ipc('companion', 'configure', { enabled: true, frequency: 'frequent', min: 10, limit: 2, quietFrom: '00:00', quietTo: '00:00',
    ai: true, memory: true, voice: false });
  now += 21 * 60000;
  await until(() => proactiveBody);
  assert.doesNotMatch(JSON.stringify(proactiveBody), /永远不要发送的测试记忆/);
  await until(() => runJS("document.querySelector('#bubbleText').textContent.includes('生成的测试问候')"));
  console.log('Electron passed reminder delivery and confirmation, proactive memory opt-out, vision confirmation, DPAPI, indicator and lock.');
}

run().then(() => app.quit(), error => { console.error(error); app.exit(1); }).finally(() => server.close());
