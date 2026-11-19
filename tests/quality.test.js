'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MemoryStore, extraction } = require('../electron/memory-store');
const { parseCandidate, configuredRequest, detect } = require('../electron/memory-extraction');
const { Proactive, command } = require('../electron/proactive');

const minute = 60000;
const start = Date.parse('2026-11-17T10:00:00+08:00');
function library(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-quality-'));
  const store = new MemoryStore({ defaultDir: path.join(root, 'memory'), configDir: path.join(root, 'config') });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true }); });
  return store;
}

test('candidate precision/recall on labelled Chinese rule cases', t => {
  const cases = [
    ['千绘莉，记住我很喜欢喝冰的美式。', true], ['更正：我现在不喜欢喝冰美式。', true],
    ['我很喜欢骑自行车', true], ['我特别喜爱骑单车', true], ['我现在住在广州', true],
    ['我的长期目标是写一本小说', true], ['我曾经参加摄影比赛', true],
    ['我今天喜欢喝奶茶', false], ['我这周在赶临时项目', false], ['开玩笑，我喜欢喝墨水', false],
    ['记住：假如我喜欢骑恐龙', false], ['我密码是虚构示例', false], ['普通聊天而已', false],
    ['以前我喜欢红茶', false], ['记住我今晚要整理附件', true],
  ];
  const outcomes = cases.map(([input, expected]) => [!!extraction(input, true, start), expected]);
  const tp = outcomes.filter(([found, expected]) => found && expected).length;
  const offered = outcomes.filter(([found]) => found).length;
  const relevant = outcomes.filter(([, expected]) => expected).length;
  t.diagnostic(`candidate precision=${tp}/${offered}; recall=${tp}/${relevant}; n=${cases.length}`);
  assert.equal(tp, offered); assert.equal(tp, relevant);
  assert.ok(extraction(cases.at(-1)[0], true, start).expires_at > start);
});

test('multi-turn equivalent confirmations merge; corrections and expiry do not pollute current recall', t => {
  const store = library(t);
  const answers = ['我很喜欢骑自行车', '我特别喜爱骑单车', '记住我喜欢骑行'];
  for (const input of answers) {
    const proposal = extraction(input, true);
    store.save(proposal, proposal.source, proposal.confidence);
  }
  t.diagnostic(`active duplicates after ${answers.length} confirmations = ${store.list().length - 1}/${answers.length}`);
  assert.equal(store.list().length, 1);
  const add = (content, type = '事实', extra = {}) => store.save({ content, type, tags: '', ...extra });
  add('我住在苏州'); add('我现居杭州');
  add('我喜欢喝冰美式', '偏好');
  add('我不喜欢喝冰的美式', '偏好');
  add('2024年参加摄影展', '其他');
  const current = Date.now();
  add('今晚整理附件', '事项', { expires_at: current + minute });
  assert.equal(store.search('整理附件', 4, current).length, 1);
  assert.equal(store.search('整理附件', 4, current + minute).length, 0);
  const queries = [
    ['骑单车和冰美式咖啡', [/骑行|骑单车/, /不喜欢.*冰/]],
    ['拍照片的展览经历', [/2024年参加摄影展/]],
    ['你还记得我现在住在杭州吗', [/我现居杭州/]],
    ['热带蕨类植物', []],
  ];
  let recalled = 0, total = 0;
  for (const [query, expected] of queries) {
    const rows = store.search(query);
    total += expected.length;
    recalled += expected.filter(match => rows.some(row => match.test(row.content))).length;
    if (!expected.length) assert.deepEqual(rows, []);
    assert.ok(rows.every(row => !/苏州/.test(row.content)));
  }
  t.diagnostic(`relevant recall@4=${recalled}/${total}; queries=${queries.length}`);
  assert.equal(recalled, total);
});

test('indexed lookup over 5,000 synthetic stored memories', t => {
  const store = library(t);
  const db = store.open();
  db.exec('BEGIN');
  for (let i = 0; i < 5000; i++) store.put(db, { content: '样本项目 synthetic' + i, tags: '', type: '事项', importance: 2, expires_at: null }, 'manual', 1);
  db.exec('COMMIT');
  store.save({ content: '我喜欢骑行', tags: '', type: '偏好' });
  const samples = [];
  for (let i = 0; i < 30; i++) {
    const begin = performance.now();
    assert.match(store.search('骑自行车')[0].content, /骑行/);
    samples.push(performance.now() - begin);
  }
  samples.sort((a,b) => a-b);
  t.diagnostic(`indexed lookup n=5001, 30 repeats, median=${samples[15].toFixed(2)} ms, p95=${samples[28].toFixed(2)} ms`);
});

test('AI candidate excerpts are user-only, validated, and rate limited including failures', async t => {
  const store = library(t);
  store.append('user', '我的长线目标是完成一项创作', 'one');
  store.append('bot', '我猜它是秘密口令', 'one');
  store.append('user', '我的密码是测试密钥', 'unsafe');
  const current = '明确一下，我指的是创作一部推理小说';
  const id = store.append('user', current, 'two');
  store.append('user', '这条新消息不属于已移出的上下文', 'later');
  const excerpts = store.candidateExcerpts(id);
  assert.equal(excerpts.length, 2);
  const model = { type: '事项', content: '我的长期目标是创作一部推理小说', evidence: current, support: [excerpts[0]] };
  assert.equal(parseCandidate(JSON.stringify(model), excerpts).content, model.content);
  assert.equal(parseCandidate(JSON.stringify({ ...model, evidence: '助手编造的内容' }), excerpts), null);
  assert.equal(parseCandidate(JSON.stringify({ ...model, content: '我居住在北京' }), excerpts), null);
  const req = configuredRequest({ aiChat: true, model: 'fake', baseUrl: 'http://localhost:8080/v1' }, excerpts);
  assert.equal(await detect(req, excerpts, async () => new Response('mock error', { status: 503 })), null);
  assert.equal(await detect(req, excerpts, async () => Response.json({ choices: [{ message: { content: JSON.stringify(model) } }] })).then(x => x.content), model.content);
  assert.equal(store.list().length, 0);
  let accepted = 0;
  for (let i = 0; i < 70; i++) accepted += Number(store.claimExtraction(start + i * minute, i + 1));
  assert.equal(accepted, 6);
  store.close();
  assert.equal(store.claimExtraction(start + 70 * minute, 71), false);
  assert.equal(store.claimExtraction(start + 2 * 24 * 60 * minute, 51), false);
  t.diagnostic('simulated quota: 6 attempts across 70 eligible checks; reviewed messages are skipped after reopening');
});

test('virtual state: response, repeated ignores, temporary focus, midnight quiet, TTS, reminder, restart', t => {
  const store = library(t), open = () => store.open();
  const p = new Proactive(open, () => 0);
  p.configure({ ...p.options(), enabled: true, presetMin: 10, strength: 'strong', presetLimit: 8 }, start);
  const input = (offset, flags = {}) => ({ now: start + offset * minute, zone: 'Asia/Shanghai', idle: 10 * minute, ...flags });
  assert.equal(p.status(input(1, { busy: true })).state, '活跃交流');
  assert.equal(p.status(input(1, { reminder: true })).state, '关心提醒');
  assert.equal(p.claim(input(9)), null);
  assert.ok(p.claim(input(10))); p.spoken(input(10).now);
  assert.ok(p.claim(input(20))); p.spoken(input(20).now);
  assert.equal(p.status(input(26)).state, '低打扰');
  assert.equal(p.claim(input(30)), null);
  assert.ok(p.claim(input(40))); p.spoken(input(40).now);
  p.feedback('chat', input(41).now);
  assert.equal(p.status(input(42)).state, '活跃交流');
  assert.notEqual(p.status(input(45)).state, '低打扰');
  p.temporary('focus', 60, input(46).now);
  assert.equal(p.status(input(47)).state, '专注');
  assert.equal(p.claim(input(47)), null);
  assert.equal(p.status(input(50, { locked: true })).state, '安静');
  assert.equal(p.status(input(107)).state, '日常');
  assert.equal(p.status(input(14 * 60)).state, '安静');
  p.configure({ ...p.options(), manual: 'quiet' }, input(108).now);
  const restart = new Proactive(open, () => 0);
  assert.equal(restart.status(input(109)).state, '安静');
  assert.equal(restart.status(input(109)).lastSpoken, input(40).now);
  assert.deepEqual(command('接下来一小时我要专心工作'), { mode: 'focus', minutes: 60 });
  assert.equal(command('我明天想专心工作'), null);
});
