'use strict';

const DAY = 86400000;
const TEMPORARY = /今天|今晚|明天|后天|这周|本周|下周|这几天|暂时|临时|现在正在|一会儿|这次/;
const FICTION = /假如|假设|如果我|开玩笑|逗你的|角色扮演|剧本里|虚构|我演的是|比如说/;
const ALIASES = [
  ['冰美式', '冰美式咖啡', '冰的美式', '冰美式黑咖啡'],
  ['骑行', '骑自行车', '骑单车', '单车运动'],
  ['摄影', '拍照片', '拍照'],
  ['跑步', '慢跑', '跑步运动'],
  ['科幻', '科学幻想'],
  ['编程', '写代码', '程序设计'],
  ['猫', '猫咪', '小猫'],
  ['爱好', '兴趣', '嗜好'],
];
const aliases = ALIASES.flatMap(([key, ...words]) => words.map(word => [word, key]))
  .sort((a, b) => b[0].length - a[0].length);
const stop = /(?:我|你|她)(?:现在|以前|仍然|不再|最)?(?:[不很])?(?:喜欢|喜爱|讨厌|偏爱|爱喝|爱吃|在做|正在)|(?:你还记得|还记得|记不记得|你知道|知道|记得|有没有|是什么|什么|请问|告诉我|现在|以前|一直|最近|不再|喜欢|偏好|讨厌|是不是|怎么样|以及|还有)/gu;

function canonical(text) {
  let value = text.normalize('NFKC').toLowerCase();
  for (const [word, key] of aliases) value = value.replaceAll(word, key);
  return value;
}

function terms(text) {
  const value = canonical(text).replace(stop, ' ');
  const out = new Set();
  for (const [token] of value.matchAll(/\p{Script=Han}+|[a-z0-9]{2,}/gu)) {
    if (!/^\p{Script=Han}/u.test(token)) { out.add(token); continue; }
    const chars = Array.from(token);
    for (let i = 0; i < chars.length - 1; i++) {
      out.add(chars.slice(i, i + 2).join(''));
      if (i + 2 < chars.length) out.add(chars.slice(i, i + 3).join(''));
    }
    if (token.includes('猫')) out.add('猫');
  }
  return [...out].slice(0, 360);
}

function reindex(db, id, content, tags) {
  db.prepare('DELETE FROM memory_terms WHERE memory_id=?').run(id);
  const insert = db.prepare('INSERT INTO memory_terms VALUES (?, ?)');
  for (const term of terms(content + ' ' + tags)) insert.run(term, id);
}

function validLifecycle(value) {
  const importance = value.importance ?? 2, expiry = value.expires_at ?? null;
  if (![1, 2, 3].includes(importance) || (expiry !== null && (!Number.isSafeInteger(expiry) || expiry < 0))) {
    throw new Error('记忆的重要性或有效期无效');
  }
  return { importance, expires_at: expiry };
}

function expiryFor(text, now) {
  if (!TEMPORARY.test(text)) return null;
  const days = /下周/.test(text) ? 14 : /这周|本周|这几天/.test(text) ? 7 : /后天/.test(text) ? 3 : /明天/.test(text) ? 2 : 1;
  return now + days * DAY;
}

module.exports = { DAY, TEMPORARY, FICTION, canonical, terms, reindex, validLifecycle, expiryFor };
