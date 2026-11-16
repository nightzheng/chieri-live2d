'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const FILE = 'memory.sqlite';
const APP_ID = 0x43484d45;
const VERSION = 2;
const { SCHEMA: AGENDA_SCHEMA } = require('./agenda');
const MAX_TEXT = 4000;
const TYPES = ['事实', '偏好', '兴趣', '事项', '约定', '关系', '其他'];
const SOURCES = ['manual', 'explicit', 'candidate', 'import'];
const SENSITIVE = /密码|口令|令牌|访问密钥|私钥|身份证|护照|银行卡|信用卡|账户号码|银行账户|病历|诊断|处方|过敏|患病|手术|病症|医疗|糖尿病|高血压|抑郁症|癌症|病史|password|passphrase|secret|api[ _-]?key|access[ _-]?token|\bbearer\b|\bsk-[\w-]{8,}|\b\d{15,18}[Xx]?\b/i;

function inputText(value, max = MAX_TEXT, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!allowEmpty && !value.trim())) {
    throw new Error('文本格式或长度无效');
  }
  return value;
}

const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const sha = text => createHash('sha256').update(text).digest('hex');

function extraction(input, auto) {
  const text = inputText(input).trim();
  if (SENSITIVE.test(text)) return null;
  const explicit = /^(?:千绘莉[，,、\s]*)?(?:请)?(?:记住|帮我记住|更正(?:一下)?)[：:，,\s]*(.+)$/u.exec(text);
  const content = (explicit ? explicit[1] : text).replace(/[。！？!?]+$/u, '').trim();
  const preference = /^我((?:现在|已经|以前|一直|最)?(?:不再|不)?)?(喜欢|爱喝|爱吃|偏爱|讨厌)([^，,。；;！？!?]{1,100})$/u.exec(content);
  const candidate = preference || /^我(?:一直在|长期在|最近在|经常|习惯于)[^，,。；;！？!?]{2,100}$/u.test(content);
  const correction = preference && /不/.test(preference[1] || '');
  if (!content || content.length > 1000 || (!explicit && !correction && (!auto || !candidate))) return null;
  if (preference?.[1]?.startsWith('以前')) return null;
  return { content, type: preference ? '偏好' : '其他', tags: '',
    source: explicit || correction ? 'explicit' : 'candidate', confidence: explicit || correction ? 1 : 0.75 };
}

function preferenceFact(content) {
  const match = /^我(?:现在|一直|最|已经)?(不再|不)?(喜欢|讨厌|偏爱|爱喝|爱吃)\s*(.+)$/u.exec(content.trim());
  if (!match) return { key: '', stance: '' };
  const topic = normalize(match[3].replace(/^(?:喝|吃)/, ''));
  return { key: 'preference:' + topic, stance: (match[1] ? 'not-' : '') + (match[2] === '讨厌' ? 'dislike' : 'like') };
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readVersion(db, pragma) {
  return Object.values(db.prepare(pragma).get())[0];
}

function verify(db) {
  const version = readVersion(db, 'PRAGMA user_version');
  if (readVersion(db, 'PRAGMA application_id') !== APP_ID || version < 1 || version > VERSION ||
      readVersion(db, 'PRAGMA integrity_check') !== 'ok') throw new Error('数据库损坏或版本不受支持');
  if (!db.prepare("SELECT value FROM metadata WHERE key='lineage'").get()?.value) throw new Error('缺少数据库标识');
  if (version >= 2) {
    db.prepare('SELECT id FROM reminders LIMIT 1').get();
    db.prepare('SELECT id FROM reminder_events LIMIT 1').get();
    db.prepare('SELECT key FROM proactive LIMIT 1').get();
    if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('提醒数据库引用无效');
  }
  return version;
}

function openDatabase(file, create = false) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { allowExtension: false });
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000');
    if (create) transaction(db, () => {
      db.exec(`
        PRAGMA application_id=${APP_ID};
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT, conversation TEXT NOT NULL,
          who TEXT NOT NULL CHECK(who IN ('user', 'bot')), text TEXT NOT NULL, created INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX messages_conversation ON messages(conversation);
        CREATE TABLE memories (
          id TEXT PRIMARY KEY, content TEXT NOT NULL, normalized TEXT NOT NULL,
          type TEXT NOT NULL, tags TEXT NOT NULL, source TEXT NOT NULL,
          confidence REAL NOT NULL, fact_key TEXT NOT NULL,
          created INTEGER NOT NULL, updated INTEGER NOT NULL, confirmed INTEGER NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
        ) STRICT;
        CREATE UNIQUE INDEX memories_unique ON memories(normalized) WHERE archived=0;
        CREATE INDEX memories_fact ON memories(fact_key) WHERE archived=0;
        CREATE INDEX memories_recent ON memories(archived, updated DESC, id);
        PRAGMA user_version=1;
      `);
      db.prepare('INSERT INTO metadata VALUES (?, ?)').run('lineage', randomUUID());
    });
    const version = verify(db);
    if (version === 1) transaction(db, () => db.exec(AGENDA_SCHEMA + 'PRAGMA user_version=2'));
    db.exec('PRAGMA foreign_keys=ON');
    if (readVersion(db, 'PRAGMA journal_mode=WAL') !== 'wal') throw new Error('数据库无法启用 WAL');
    db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE; ROLLBACK');
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

function digest(db) {
  const hash = createHash('sha256');
  const version = readVersion(db, 'PRAGMA user_version');
  const tables = [['messages', 'id'], ['memories', 'id'], ['metadata', 'key']];
  if (version >= 2) tables.push(['reminders', 'id'], ['reminder_events', 'id'], ['proactive', 'key']);
  hash.update(String(version));
  for (const [table, key] of tables) {
    hash.update(table);
    for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).iterate()) hash.update(JSON.stringify(row) + '\n');
  }
  return hash.digest('hex');
}

function inspect(file, action) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
  try {
    db.exec('PRAGMA trusted_schema=OFF');
    verify(db);
    return action(db);
  } finally { db.close(); }
}

function writeAtomic(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx', flush: true });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function tokens(value) {
  const terms = new Set();
  for (const match of value.normalize('NFKC').toLowerCase().matchAll(/\p{Script=Han}+|[a-z0-9]{2,}/gu)) {
    const chars = [...match[0]];
    if (!/\p{Script=Han}/u.test(match[0])) terms.add(match[0]);
    else for (let i = 0; i < chars.length - 1; i++) {
      const pair = chars.slice(i, i + 2).join('');
      if (!['我喜', '我的', '你知', '知道', '记得', '什么', '是不是', '请问'].includes(pair)) terms.add(pair);
      if (i + 2 < chars.length) terms.add(chars.slice(i, i + 3).join(''));
    }
  }
  return terms;
}

function validateMemory(value) {
  const content = inputText(value?.content, 1000).trim();
  const tags = inputText(value.tags ?? '', 200, true).trim();
  if (SENSITIVE.test(content + ' ' + tags)) throw new Error('记忆可能包含敏感资料，未保存');
  if (!normalize(content) || !TYPES.includes(value.type)) throw new Error('记忆内容或类型无效');
  return { content, tags, type: value.type };
}

class MemoryStore {
  constructor({ defaultDir, configDir, forbidden = [] }) {
    this.defaultDir = defaultDir;
    this.locator = path.join(configDir, 'memory-location.json');
    this.marker = path.join(defaultDir, '.library-initialized');
    this.forbidden = forbidden;
    this.close();
  }

  location() {
    try {
      const value = JSON.parse(fs.readFileSync(this.locator, 'utf8'));
      if (!path.isAbsolute(value.dir || '')) throw new Error('记忆位置配置无效');
      return value.dir;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      return null;
    }
  }

  directory(dir, create = false) {
    const inside = (target, root) => {
      const relative = path.relative(root, target);
      return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
    };
    const permitted = target => {
      if (!path.isAbsolute(target) || (process.platform === 'win32' && !/^[a-z]:\\/i.test(target)) ||
          this.forbidden.some(root => inside(target, root))) throw new Error('请选择安装目录、临时目录和系统程序目录以外的本地文件夹');
    };
    dir = path.resolve(dir);
    permitted(dir);
    let ancestor = dir;
    while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
    permitted(path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, dir)));
    if (create) fs.mkdirSync(dir, { recursive: true });
    const actual = fs.realpathSync(dir);
    permitted(actual);
    fs.accessSync(actual, fs.constants.R_OK | fs.constants.W_OK);
    return actual;
  }

  // Treat a present locator as an existing library, even when its drive is unavailable.
  open() {
    if (this.db) {
      try {
        const file = path.join(this.dir, FILE);
        this.checkFile(file);
        const stat = fs.statSync(file, { bigint: true });
        if (stat.dev !== this.identity.dev || stat.ino !== this.identity.ino) throw new Error('数据库文件已被替换，请重新定位或重启');
        return this.db;
      } catch (e) {
        this.close();
        throw e;
      }
    }
    const known = this.location();
    if (!known && fs.existsSync(this.marker)) throw new Error('记忆位置配置缺失，请重新定位已有库或恢复备份');
    const dir = this.directory(known || this.defaultDir, !known);
    const file = path.join(dir, FILE);
    const create = !known && !fs.existsSync(file);
    if (!create) this.checkFile(file);
    if (create && fs.existsSync(path.join(dir, 'backups'))) throw new Error('数据库缺失，请重新定位或恢复备份');
    const db = openDatabase(file, create);
    this.activate(db, dir);
    return db;
  }

  checkFile(file) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink > 1) throw new Error('请选择独立的数据库文件');
  }

  activate(db, dir, repair = false) {
    let identity;
    try {
      identity = fs.statSync(path.join(dir, FILE), { bigint: true });
      fs.mkdirSync(path.dirname(this.locator), { recursive: true });
      if (!fs.existsSync(this.marker)) {
        this.directory(this.defaultDir, true);
        writeAtomic(this.marker, { initialized: true });
      }
      let current;
      try { current = this.location(); } catch (e) { if (!repair) throw e; }
      if (current !== dir) writeAtomic(this.locator, { dir });
    } catch (e) { db.close(); throw e; }
    this.close();
    this.dir = dir;
    this.identity = identity;
    this.db = db;
  }

  close() {
    this.db?.close();
    this.db = null;
    this.dir = null;
    this.identity = null;
  }

  snapshot(db, dir, prefix) {
    const file = path.join(dir, prefix + '-' + randomUUID() + '.sqlite');
    const source = db.prepare('PRAGMA database_list').get().file;
    const stats = fs.statfsSync(dir, { bigint: true });
    const size = fs.statSync(source).size + (fs.statSync(source + '-wal', { throwIfNoEntry: false })?.size || 0);
    if (stats.bavail * stats.bsize < BigInt(size + 1024 * 1024)) throw new Error('目标文件夹可用空间不足');
    try {
      db.prepare('VACUUM INTO ?').run(file);
      if (inspect(file, digest) !== digest(db)) throw new Error('快照内容校验失败');
      const fd = fs.openSync(file, 'r+');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      return file;
    } catch (e) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      throw e;
    }
  }

  backup() {
    const db = this.open();
    const dir = this.directory(path.join(this.dir, 'backups'), true);
    return this.snapshot(db, dir, 'backup-' + new Date().toISOString().slice(0, 10));
  }

  migrate(destination, replace = false) {
    const db = this.open();
    const dir = this.directory(destination, true);
    if (!path.relative(this.dir, dir)) return dir;
    if (!path.relative(path.join(this.dir, 'backups'), dir) || dir.startsWith(path.join(this.dir, 'backups') + path.sep)) throw new Error('请选择备份文件夹以外的位置');
    const target = path.join(dir, FILE);
    const stage = this.snapshot(db, dir, 'migration');
    this.installSnapshot(stage, target, replace, false);
    return dir;
  }

  relink(destination) {
    const dir = this.directory(destination);
    const file = path.join(dir, FILE);
    this.checkFile(file);
    if (this.db && !path.relative(this.dir, dir)) return;
    this.activate(openDatabase(file), dir, true);
  }

  restore(backup, destination) {
    this.checkFile(backup);
    const dir = this.directory(destination || this.location() || this.defaultDir, true);
    const target = path.join(dir, FILE);
    const stage = inspect(backup, db => this.snapshot(db, dir, 'restore'));
    this.installSnapshot(stage, target, true, true);
    return dir;
  }

  installSnapshot(stage, target, replace, restoring) {
    const dir = path.dirname(target);
    const active = this.db && this.dir;
    const same = active && !path.relative(active, dir);
    const suffixes = ['', '-wal', '-shm', '-journal'];
    const retained = path.join(dir, 'retained-' + randomUUID());
    const moved = [];
    let installed = false;
    try {
      if (suffixes.some(suffix => fs.existsSync(target + suffix))) {
        if (!replace) throw new Error('目标已有数据库，请选择空文件夹，或先备份目标数据');
        if (!restoring) {
          this.checkFile(target);
          const lineage = db => db.prepare("SELECT value FROM metadata WHERE key='lineage'").get().value;
          if (inspect(target, lineage) !== lineage(this.db)) throw new Error('目标是另一个记忆库，请选择空文件夹');
        }
        fs.mkdirSync(retained);
        if (same) this.close();
        for (const suffix of suffixes) {
          const source = target + suffix;
          if (!fs.existsSync(source)) continue;
          const saved = path.join(retained, FILE + suffix);
          fs.renameSync(source, saved);
          moved.push([source, saved]);
        }
      }
      // Publish without clobbering any unexpected file created in the meantime.
      const expected = inspect(stage, digest);
      try {
        fs.linkSync(stage, target);
      } catch (e) {
        if (!['ENOTSUP', 'EPERM', 'EXDEV', 'ENOSYS', 'EINVAL'].includes(e.code)) throw e;
        fs.copyFileSync(stage, target, fs.constants.COPYFILE_EXCL);
      }
      installed = true;
      fs.unlinkSync(stage);
      if (inspect(target, digest) !== expected) throw new Error('目标数据库内容校验失败');
      this.activate(openDatabase(target), dir, restoring);
    } catch (error) {
      if (installed) {
        for (const suffix of suffixes) {
          if (fs.existsSync(target + suffix)) fs.renameSync(target + suffix, target + '.failed-' + path.basename(retained) + suffix);
        }
      }
      for (const [source, saved] of moved.reverse()) fs.renameSync(saved, source);
      if (same && fs.existsSync(target)) this.open();
      throw error;
    } finally {
      if (fs.existsSync(stage)) fs.unlinkSync(stage);
    }
  }

  append(who, text, conversation) {
    if (!['user', 'bot'].includes(who)) throw new Error('消息角色无效');
    return Number(this.open().prepare('INSERT INTO messages(conversation, who, text, created) VALUES (?, ?, ?, ?)')
      .run(inputText(conversation, 80), who, inputText(text), Date.now()).lastInsertRowid);
  }

  importLegacy(rows) {
    if (!Array.isArray(rows) || rows.length > 60) throw new Error('旧聊天记录格式无效');
    if (!rows.length) return;
    const db = this.open();
    transaction(db, () => {
      if (db.prepare("SELECT 1 FROM metadata WHERE key='legacy-chat'").get()) return;
      const stamp = db.prepare('SELECT min(created) AS stamp FROM messages').get().stamp ?? Date.now();
      let conversation = randomUUID();
      rows.forEach((row, index) => {
        if (!['user', 'bot'].includes(row?.who)) throw new Error('旧消息角色无效');
        if (row.who === 'user') conversation = randomUUID();
        const legacyId = index - rows.length;
        db.prepare('INSERT INTO messages(id, conversation, who, text, created) VALUES (?, ?, ?, ?, ?)')
          .run(legacyId, conversation, row.who, inputText(row.text, 1024 * 1024, true), stamp + legacyId);
      });
      db.prepare('INSERT INTO metadata VALUES (?, ?)').run('legacy-chat', sha(JSON.stringify(rows)));
    });
  }

  history(query = '', before = Number.MAX_SAFE_INTEGER) {
    inputText(query, 200, true);
    if (!Number.isSafeInteger(before)) throw new Error('分页位置无效');
    return this.open().prepare('SELECT * FROM messages WHERE id < ? AND instr(lower(text), lower(?)) > 0 ORDER BY id DESC LIMIT 40')
      .all(before, query);
  }

  deleteConversation(conversation) {
    this.open().prepare('DELETE FROM messages WHERE conversation=?').run(inputText(conversation, 80));
  }

  clearHistory() { this.open().exec('DELETE FROM messages'); }
  clearMemories() { this.open().exec('DELETE FROM memories'); }

  list(query = '', state = 'active', offset = 0, type = '') {
    if (!['active', 'archived'].includes(state) || !Number.isSafeInteger(offset) || offset < 0 ||
        (type !== '' && !TYPES.includes(type))) throw new Error('筛选参数无效');
    inputText(query, 200, true);
    return this.open().prepare(`SELECT * FROM memories WHERE archived=?
      AND (? = '' OR type = ?)
      AND instr(lower(content || ' ' || tags || ' ' || type), lower(?)) > 0 ORDER BY updated DESC, id LIMIT 40 OFFSET ?`)
      .all(Number(state === 'archived'), type, type, query, offset);
  }

  save(value, source = 'manual', confidence = 1) {
    const memory = validateMemory(value);
    const id = value.id == null ? null : inputText(value.id, 80);
    const db = this.open();
    return transaction(db, () => this.put(db, { ...memory, id }, source, confidence));
  }

  put(db, value, source, confidence, replaceConflicts = true) {
    const previous = value.id && db.prepare('SELECT * FROM memories WHERE id=?').get(value.id);
    if (value.id && !previous) throw new Error('该记忆已不存在');
    const normalized = normalize(value.content);
    const { key, stance } = preferenceFact(value.content);
    const matchingFact = key && db.prepare('SELECT * FROM memories WHERE fact_key=? AND archived=0').get(key);
    if (!replaceConflicts && matchingFact && preferenceFact(matchingFact.content).stance !== stance) return null;
    const equivalent = matchingFact && preferenceFact(matchingFact.content).stance === stance && matchingFact;
    const existing = db.prepare('SELECT * FROM memories WHERE normalized=? AND archived=0').get(normalized) || equivalent;
    if (!replaceConflicts && existing) return existing.id;
    const id = existing?.id || previous?.id || randomUUID();
    const now = Date.now();
    if (key) {
      const archive = db.prepare('UPDATE memories SET archived=1, updated=? WHERE fact_key=? AND id<>? AND archived=0');
      if (replaceConflicts) archive.run(now, key, id);
    }
    if (previous && previous.id !== id) db.prepare('UPDATE memories SET archived=1, updated=? WHERE id=?').run(now, previous.id);
    db.prepare(`INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET content=excluded.content, normalized=excluded.normalized, type=excluded.type,
      tags=excluded.tags, source=excluded.source, confidence=excluded.confidence, fact_key=excluded.fact_key,
      updated=excluded.updated, confirmed=excluded.confirmed, archived=0`)
      .run(id, value.content, normalized, value.type, previous ? value.tags : value.tags || existing?.tags || '', previous?.source || existing?.source || source,
        Math.max(confidence, existing?.confidence || 0), key, previous?.created || existing?.created || now, now, now);
    return id;
  }

  remove(id) { this.open().prepare('DELETE FROM memories WHERE id=?').run(inputText(id, 80)); }

  search(input) {
    const query = tokens(inputText(input));
    if (!query.size) return [];
    const db = this.open();
    const scored = [];
    for (const row of db.prepare('SELECT id, content, type, tags, confidence, updated, source FROM memories WHERE archived=0').iterate()) {
      if (SENSITIVE.test(row.content + ' ' + row.tags)) continue;
      const terms = tokens(row.content + ' ' + row.tags);
      let relevance = 0;
      for (const token of query) {
        if (terms.has(token) && !['我喜欢', '我讨厌', '喜欢', '讨厌', '现在', '以前', '不再', '一直'].includes(token)) {
          relevance += token.length > 2 ? 2 : 1;
        }
      }
      if (relevance) scored.push({ ...row, relevance });
    }
    return scored.sort((a, b) => b.relevance - a.relevance || b.confidence - a.confidence || b.updated - a.updated)
      .slice(0, 4).map(({ id, content, type }) => ({ id, content: content.slice(0, 200), type }));
  }

  exportMemories() {
    return { format: 'chieri-memory', version: 1, memories: this.open().prepare(
      'SELECT content, type, tags FROM memories WHERE archived=0 ORDER BY created, id').all() };
  }

  importMemories(data) {
    if (data?.format !== 'chieri-memory' || data.version !== 1 || !Array.isArray(data.memories) || data.memories.length > 10000) {
      throw new Error('记忆文件格式或版本无效');
    }
    const entries = data.memories.map(validateMemory);
    const db = this.open();
    return transaction(db, () => entries.reduce((count, entry) => count + Number(!!this.put(db, entry, 'import', 1, false)), 0));
  }

  status() {
    let dir = this.defaultDir;
    try {
      dir = this.location() || dir;
      const db = this.open();
      return { file: path.join(this.dir, FILE), count: db.prepare('SELECT count(*) AS count FROM memories WHERE archived=0').get().count };
    } catch (error) {
      return { file: path.join(dir, FILE), error: error.code === 'ENOENT' ? '找不到记忆数据库或文件夹' : error.message };
    }
  }
}

module.exports = { MemoryStore, extraction, writeAtomic };
