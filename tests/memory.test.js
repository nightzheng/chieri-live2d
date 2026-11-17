'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { MemoryStore, extraction } = require('../electron/memory-store');

function library(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-test-'));
  const config = { defaultDir: path.join(root, '千绘莉', 'memory'), configDir: path.join(root, 'config'), forbidden: [path.join(root, 'install')] };
  let store = new MemoryStore(config);
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true });
  });
  return { root, config, get store() { return store; }, restart() { store.close(); store = new MemoryStore(config); return store; } };
}

const save = (store, message, auto = false) => {
  const candidate = extraction(message, auto);
  assert.ok(candidate);
  return store.save(candidate, candidate.source, candidate.confidence);
};

test('M01–M06: intent, Chinese lookup, restart, correction, deduplication, and deletion', t => {
  const lib = library(t);
  let { store } = lib;
  const id = save(store, '千绘莉，记住我喜欢喝冰美式。');
  assert.equal(save(store, '记住我喜欢喝冰美式！'), id);
  assert.equal(store.list().length, 1);
  assert.equal(store.search('你还记得我喝的冰美式吗？')[0].id, id);
  assert.deepEqual(store.search('你知道我喜欢什么吗'), []);
  for (let i = 0; i < 75; i++) store.append('user', '聊天 ' + i, 'test-' + i);
  store = lib.restart();
  assert.equal(store.search('今天喝冰美式')[0].id, id);
  save(store, '我现在不喜欢喝冰美式');
  assert.equal(store.list('', 'archived')[0].id, id);
  const [corrected] = store.search('冰美式');
  assert.match(corrected.content, /不喜欢/);
  store.remove(corrected.id);
  assert.deepEqual(store.search('冰美式'), []);
});

test('candidate identification requires opt-in and filters common sensitive facts', () => {
  assert.equal(extraction('我喜欢打网球', false), null);
  assert.equal(extraction('我喜欢打网球', true).source, 'candidate');
  assert.equal(extraction('我喜欢打网球', true, Date.now(), ['goals']), null);
  assert.equal(extraction('记住我喜欢打网球', true, Date.now(), []).source, 'explicit');
  assert.equal(extraction('我听说他喜欢打网球', true), null);
  assert.equal(extraction('记住我的 API Key 是假的', true), null);
  assert.equal(extraction('我以前喜欢喝可乐', true), null);
});

test('D01–D03: preserve legacy order, import only once, paginate, and clear independently', t => {
  const { store, config } = library(t);
  const original = [{ who: 'bot', text: '先打招呼' }, { who: 'user', text: '原始中文' }, { who: 'bot', text: '收到' }];
  store.importLegacy(original);
  store.importLegacy(original);
  assert.deepEqual(store.history().reverse().map(({ who, text }) => ({ who, text })), original);
  assert.equal(store.status().file, path.join(fs.realpathSync(config.defaultDir), 'memory.sqlite'));
  for (let i = 0; i < 90; i++) store.append(i % 2 ? 'bot' : 'user', '分页 ' + i, 'round-' + (i >> 1));
  const first = store.history('分页'), second = store.history('分页', first.at(-1).id);
  assert.equal(first.length, 40);
  assert.equal(second.length, 40);
  assert.ok(first.at(-1).id > second[0].id);
  store.deleteConversation(first[0].conversation);
  assert.equal(store.history('分页').some(row => row.conversation === first[0].conversation), false);
  save(store, '记住我喜欢冰美式');
  store.clearHistory();
  store.importLegacy(original);
  assert.deepEqual(store.history(), []);
  assert.equal(store.list().length, 1);
  store.append('user', '独立', 'round');
  store.clearMemories();
  assert.equal(store.history().length, 1);
});

test('failed legacy import rolls back all rows and can be retried', t => {
  const { store } = library(t);
  assert.throws(() => store.importLegacy([{ who: 'user', text: '先写入' }, { who: 'unknown', text: '错误' }]));
  assert.deepEqual(store.history(), []);
  store.importLegacy([{ who: 'user', text: '恢复' }]);
  assert.equal(store.history()[0].text, '恢复');
});

test('D04–D05: snapshot migration preserves original WAL data, no fallback on missing location', t => {
  const lib = library(t);
  const { store, root, config } = lib;
  store.append('user', '迁移前写入', 'test');
  const target = path.join(root, 'D盘示例');
  assert.throws(() => store.migrate(path.join(root, 'install', 'subdir')), /请选择/);
  store.migrate(target);
  const old = new DatabaseSync(path.join(config.defaultDir, 'memory.sqlite'), { readOnly: true });
  try { assert.equal(old.prepare('SELECT count(*) AS n FROM messages').get().n, 1); }
  finally { old.close(); }
  store.append('bot', '迁移后写入', 'test');
  assert.equal(lib.restart().history().length, 2);
  lib.store.close();
  const moved = target + '-moved';
  fs.renameSync(target, moved);
  assert.ok(lib.store.status().error);
  assert.equal(fs.existsSync(target), false);
  lib.store.relink(moved);
  lib.store.migrate(config.defaultDir, true);
  assert.equal(lib.store.history().length, 2);
  assert.ok(fs.readdirSync(config.defaultDir).some(x => x.startsWith('retained-')));
});

test('D06: corrupt database is retained, bad backup rejected, and good WAL snapshot restores', t => {
  const { store, root } = library(t);
  save(store, '记住我喜欢喝茶');
  const backup = store.backup();
  const { file } = store.status();
  const invalid = path.join(root, 'not-sqlite.sqlite');
  fs.writeFileSync(invalid, 'broken');
  assert.throws(() => store.restore(invalid));
  assert.equal(store.list().length, 1);
  store.close();
  fs.writeFileSync(file, 'corrupt original');
  assert.ok(store.status().error);
  store.restore(backup);
  assert.equal(store.list().length, 1);
  const retained = fs.readdirSync(path.dirname(file)).find(x => x.startsWith('retained-'));
  assert.equal(fs.readFileSync(path.join(path.dirname(file), retained, 'memory.sqlite'), 'utf8'), 'corrupt original');
});

test('a migration collision preserves both libraries and the active locator', t => {
  const { root, config, store } = library(t);
  const other = new MemoryStore({ defaultDir: path.join(root, 'other'), configDir: path.join(root, 'other-config') });
  t.after(() => other.close());
  save(store, '记住我喜欢红茶');
  save(other, '记住我喜欢乌龙茶');
  const destination = path.dirname(other.status().file);
  other.close();
  const expectedFile = store.status().file;
  assert.throws(() => store.migrate(destination), /目标已有数据库/);
  assert.throws(() => store.migrate(destination, true), /另一个记忆库/);
  assert.equal(store.status().file, expectedFile);
  assert.equal(JSON.parse(fs.readFileSync(path.join(config.configDir, 'memory-location.json'), 'utf8')).dir, path.dirname(expectedFile));
  assert.match(store.list()[0].content, /红茶/);
  assert.match(other.list()[0].content, /乌龙茶/);
  other.close();
});

test('missing locator does not activate a stale library and relink repairs corrupt locator', t => {
  const { store, root, config } = library(t);
  save(store, '记住我喜欢喝茶');
  const target = path.join(root, 'custom');
  store.migrate(target);
  store.close();
  const locator = path.join(config.configDir, 'memory-location.json');
  fs.unlinkSync(locator);
  assert.match(store.status().error, /配置缺失/);
  fs.writeFileSync(locator, '{');
  store.relink(target);
  assert.equal(store.list().length, 1);
});

test('portable export excludes chat and settings, import is atomic and does not reverse corrections', t => {
  const { store } = library(t);
  save(store, '记住我喜欢喝冰美式');
  const exported = store.exportMemories();
  store.append('user', '不导出的聊天', 'test');
  assert.equal(JSON.stringify(store.exportMemories()).includes('不导出的聊天'), false);
  save(store, '更正：我讨厌冰美式');
  assert.equal(store.importMemories(exported), 0);
  assert.match(store.search('冰美式')[0].content, /讨厌/);
  const invalid = { ...exported, memories: [...exported.memories, { type: '事实', content: '密码是假的' }] };
  assert.throws(() => store.importMemories(invalid));
  assert.equal(store.list().length, 1);
});

test('rejects a future schema without overwriting it', t => {
  const { store } = library(t);
  const { file } = store.status();
  store.close();
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version=999');
  db.close();
  assert.match(store.status().error, /不受支持/);
  const check = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(check.prepare('PRAGMA user_version').get().user_version, 999); }
  finally { check.close(); }
});
