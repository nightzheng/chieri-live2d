'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, safeStorage } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const { setTimeout: delay } = require('node:timers/promises');

const oldApp = path.resolve(process.env.CHIERI_BASE_APP);
const newApp = path.resolve(process.env.CHIERI_TEST_APP || path.join(__dirname, '..'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-schema-upgrade-'));
for (const sub of ['profile','tmp','local']) fs.mkdirSync(path.join(root, sub));
const profile = path.join(root, 'profile');
const defaultDir = path.join(root, 'local', '千绘莉', 'memory');
process.env.LOCALAPPDATA = path.join(root, 'local');
process.env.TEMP = path.join(root, 'tmp');
process.env.L2D_START = 'studio';
app.setPath('userData', profile);
app.setPath('temp', process.env.TEMP);

const old = new (require(path.join(oldApp, 'electron/memory-store')).MemoryStore)({ defaultDir, configDir: profile });
const { Agenda } = require(path.join(oldApp, 'electron/agenda'));
const { Proactive } = require(path.join(oldApp, 'electron/proactive'));
old.append('user', '旧版聊天样本', 'sample');
old.save({ content: '我喜欢骑单车', tags: '运动', type: '偏好' });
const agenda = new Agenda(() => old.open());
agenda.save({ title: '旧版日程样本', content: '', day: '2098-01-01', time: '08:00', timezone: 'Asia/Shanghai',
  weekdays: 0, voice: false, notify: false, enabled: true }, Date.now());
const proactive = new Proactive(() => old.open());
proactive.configure({ ...proactive.options(), enabled: true, frequency: 'medium', limit: 3, memory: true }, Date.now());
if (process.env.CHIERI_CUSTOM_DB === '1') old.migrate(path.join(root, 'custom-database'));
const existing = old.status().file;
old.close();

const saveFile = (name, data) => fs.writeFileSync(path.join(profile, name), JSON.stringify(data));
app.once('ready', () => {
  const encrypt = value => safeStorage.encryptString(value).toString('base64'); // 1.2.9 chat/voice file format
  saveFile('settings.json', { model: 'fixture-chat', apiKeyEnc: encrypt('fixture-chat-key'), aiChat: false,
    baseUrl: 'https://example.invalid/v1', tts: { engine: 'off', chieri: { python: 'D:\\Fixture\\python.exe' }, openai: {} },
    ttsKeysEnc: encrypt(JSON.stringify({ openai: 'fixture-voice-key' })) });
  saveFile('vision-settings.json', { enabled: false, provider: 'compatible', model: 'fixture-vision',
    base: 'https://example.invalid/vision', size: 768, quality: 70, timeout: 10000, encryptedKey: encrypt('fixture-vision-key') });
  saveFile('memory-options.json', { enabled: true, auto: true });
});
require(path.join(newApp, 'electron/main.js'));

async function run() {
  let win;
  for (let n = 0; n < 100 && !win; n++) {
    const candidate = BrowserWindow.getAllWindows()[0];
    if (candidate && await candidate.webContents.executeJavaScript('!!window.petAPI').catch(() => false)) win = candidate;
    else await delay(100);
  }
  assert.ok(win, 'upgraded application must expose its IPC');
  const js = source => win.webContents.executeJavaScript(source);
  const status = await js("petAPI.memory('status')");
  assert.equal(status.error, undefined);
  assert.equal(status.file, existing);
  assert.equal(status.mode, 'rules');
  assert.equal((await js("petAPI.memory('history')"))[0].text, '旧版聊天样本');
  assert.equal((await js("petAPI.memory('list')"))[0].content, '我喜欢骑单车');
  assert.equal((await js("petAPI.companion('list')")).reminders[0].title, '旧版日程样本');
  const prefs = await js("petAPI.companion('options')");
  assert.equal(prefs.frequency, 'medium'); assert.equal(prefs.limit, 3); assert.equal(prefs.memory, true);
  const config = await js('petAPI.getSettings()');
  assert.equal(config.model, 'fixture-chat');
  assert.equal(config.apiKey, 'fixture-chat-key');
  assert.equal(config.tts.chieri.python, 'D:\\Fixture\\python.exe');
  assert.equal(config.tts.openai.apiKey, 'fixture-voice-key');
  const vision = (await js("petAPI.vision('state')")).value.config;
  assert.equal(vision.model, 'fixture-vision'); assert.equal(vision.hasKey, true);
  const dir = path.join(path.dirname(existing), 'backups');
  const saved = fs.readdirSync(dir).find(file => file.startsWith('before-schema-2-to-3'));
  assert.ok(saved);
  const backup = new DatabaseSync(path.join(dir, saved), { readOnly: true });
  try {
    assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(backup.prepare('SELECT title FROM reminders').get().title, '旧版日程样本');
  } finally { backup.close(); }
  assert.match(old.status().error, /版本不受支持/);
  console.log('1.2.9 → 1.3.0 archive upgrade passed, including schema-2 backup, rejection by 1.2.9 and encrypted settings; location:',
    process.env.CHIERI_CUSTOM_DB === '1' ? 'custom' : 'default');
}
run().then(() => app.quit(), error => { console.error(error); app.exit(1); });
