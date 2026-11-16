'use strict';

// Run with the project's Electron executable. All generated data is synthetic and isolated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-desktop-test-'));
const transient = path.join(root, 'temp');
for (const name of ['profile', 'local', 'temp']) fs.mkdirSync(path.join(root, name));
process.env.LOCALAPPDATA = path.join(root, 'local');
process.env.TEMP = transient;
process.env.L2D_START = 'studio';
app.setPath('temp', transient);
app.setPath('userData', path.join(root, 'profile'));

const voices = process.env.CHIERI_TEST_PYTHON;
const requests = [];
const endpoint = http.createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    if (request.url === '/voice') {
      response.setHeader('content-type', 'audio/wav');
      response.end('RIFF mock audio');
      return;
    }
    requests.push(JSON.parse(body));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: '{"reply":"收到测试消息","emotion":"happy"}' } }] }));
  });
});

async function waitFor(predicate, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await predicate();
    if (value) return value;
    await delay(150);
  }
  throw new Error('Timed out waiting for the desktop application');
}

async function run() {
  require('node:sqlite');
  await new Promise((resolve, reject) => endpoint.listen(0, '127.0.0.1', resolve).once('error', reject));
  const url = 'http://127.0.0.1:' + endpoint.address().port;
  require(path.resolve(process.env.CHIERI_TEST_APP || path.join(__dirname, '..'), 'electron/main.js'));
  const win = await waitFor(() => BrowserWindow.getAllWindows()[0]);
  const js = source => win.webContents.executeJavaScript(source);
  await waitFor(async () => {
    try { return await js("typeof Chat !== 'undefined' && !Chat.sending && document.querySelector('#msgs .card')"); }
    catch (_) { return false; }
  });
  const status = await js("petAPI.memory('status')");
  assert.equal(status.error, undefined, status.error);
  assert.ok(status.file.startsWith(process.env.LOCALAPPDATA));
  await js(`localStorage.setItem('l2d.chat', JSON.stringify([{ who: 'user', text: '旧消息' }, { who: 'bot', text: '旧回复' }]));
    Chat.reload()`);
  await js("Chat.reload()");
  assert.deepEqual(await js("petAPI.memory('history').then(rows => rows.reverse().map(row => row.text))"), ['旧消息', '旧回复']);
  await js("Settings.open()");
  await waitFor(() => js("document.querySelector('#mStatus').textContent.includes('memory.sqlite')"));
  await js("Settings.close(); window.confirm = () => true; Chat.send('千绘莉，记住我喜欢喝冰美式。')");
  assert.equal(await js("petAPI.memory('list').then(rows => rows.length)"), 1);
  assert.equal(await js("petAPI.memory('history').then(rows => rows.length)"), 4);

  await js(`Object.assign(Store.data, { kind: 'openai', baseUrl: ${JSON.stringify(url)}, model: 'test', aiChat: true, tts: { engine: 'off' } });
    AI.history = []; Chat.send('你还记得冰美式吗？')`);
  assert.match(requests.at(-1).messages[0].content, /我喜欢喝冰美式/);
  assert.equal(await js("petAPI.memory('status').then(s => s.lastUsed.length)"), 1);
  await js("petAPI.memory('options', {enabled: false, auto: false})");
  await js("AI.history = []; Chat.send('你还记得冰美式吗？')");
  assert.doesNotMatch(requests.at(-1).messages[0].content, /我喜欢喝冰美式/);
  assert.equal(await js("petAPI.memory('status').then(s => s.lastUsed.length)"), 0);
  const online = await js(`petAPI.ttsFetch({url:${JSON.stringify(url + '/voice')},headers:{},body:'{}'})`);
  assert.equal(online.ok, true);
  assert.equal(Buffer.from(online.bytes).toString(), 'RIFF mock audio');

  if (voices) {
    const result = await js(`petAPI.chieri({text:'こんにちは、テストです。', python:${JSON.stringify(voices)},device:'cuda'})`);
    assert.equal(result.ok, true, result.error);
    assert.equal(Buffer.from(result.bytes).subarray(0, 4).toString(), 'RIFF');
    const child = process._getActiveHandles().find(handle => handle.spawnargs?.includes('--watch-stdin'));
    assert.ok(child?.pid, 'model process must be a tracked child');
    app.once('will-quit', () => {
      if (child.exitCode !== 0) {
        console.error('CUDA voice process did not exit normally:', child.exitCode, child.signalCode);
        app.exit(1);
      } else console.log('CUDA voice synthesis and graceful child exit passed');
    });
  }
  console.log('Electron', process.versions.electron, 'Node', process.versions.node,
    '| SQLite, renderer IPC, local chat, memory injection and opt-out, mocked online voice passed');
}

run().then(() => app.quit(), e => { console.error(e); app.exit(1); }).finally(() => endpoint.close());
