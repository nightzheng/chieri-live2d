'use strict';

// Use the actual 1.2.8 source from the ancestor commit, without touching any user database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MemoryStore } = require('../electron/memory-store');
const { Agenda } = require('../electron/agenda');

const repo = path.resolve(__dirname, '..');
const revision = process.argv[2] || 'd1d3d5d';
assert.match(revision, /^[a-f0-9]{7,40}$/i);
const legacy = execFileSync('git', ['-c', 'safe.directory=' + repo.replaceAll('\\', '/'), 'show', revision + ':electron/memory-store.js'], { cwd: repo });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-compat-'));
const config = { defaultDir: path.join(root, 'library'), configDir: path.join(root, 'profile') };
const fixture = path.join(root, 'legacy.cjs');
fs.writeFileSync(fixture, legacy);
const old = new (require(fixture).MemoryStore)(config);
const current = new MemoryStore(config);
try {
  old.append('user', '1.2.8 聊天', 'existing');
  old.save({ content: '1.2.8 记忆', type: '事实', tags: '' });
  const legacyBackup = old.backup();
  old.close();
  assert.equal(current.history()[0].text, '1.2.8 聊天');
  assert.equal(current.list()[0].content, '1.2.8 记忆');
  const agenda = new Agenda(() => current.open());
  agenda.save({ title: '1.2.9 合成提醒', content: '', day: '2026-11-17', time: '13:00', timezone: 'Asia/Shanghai',
    weekdays: 0, voice: false, notify: true, enabled: true }, Date.parse('2026-11-16T00:00:00Z'));
  current.close();
  assert.match(old.status().error, /版本不受支持/);
  old.close();
  assert.equal(agenda.list().reminders[0].title, '1.2.9 合成提醒');
  current.restore(legacyBackup);
  assert.equal(current.open().prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(current.history()[0].text, '1.2.8 聊天');
  assert.equal(current.list()[0].content, '1.2.8 记忆');
  assert.deepEqual(agenda.list().reminders, []);
  console.log('Actual 1.2.8 schema migrated; 1.2.8 refused schema 3 and left it intact; 1.2.8 backup restored and migrated.');
} finally {
  old.close();
  current.close();
  fs.rmSync(root, { recursive: true });
}
