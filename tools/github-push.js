'use strict';
// Pushes this folder to GitHub through the REST API, for a machine without git: every file not matched by
// .gitignore becomes one commit on top of the branch head (files left out are deleted from the branch).
// Only blobs GitHub doesn't already have are uploaded. The token is read from githubkey.txt (git-ignored).
//
//   node tools/github-push.js <owner/repo> "<commit message>" [--dry] [--create public|private "<description>"]
//
// --dry lists what would be pushed; --create makes the repository first if it doesn't exist.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, name === '--create' ? 3 : 1).slice(1); };
const dry = !!flag('--dry'), create = flag('--create');
const [repo, message] = args;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || (!dry && !message)) {
  console.error('usage: node tools/github-push.js <owner/repo> "<commit message>" [--dry] [--create public|private "<description>"]');
  process.exit(2);
}
const MAX_FILE = 95 * 1024 * 1024;   // GitHub refuses files over 100 MB
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- local files (a small subset of .gitignore)
function rules() {
  return fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map(l => l.trim())
    .filter(l => l && !l.startsWith('#')).map(p => {
      const dir = p.endsWith('/'); if (dir) p = p.slice(0, -1);
      const anchored = p.includes('/'); if (p.startsWith('/')) p = p.slice(1);
      const re = new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
      return { re, dir, anchored };
    });
}
function listFiles() {
  const rs = rules(), out = [];
  const skip = (rel, isDir) => rs.some(r => (!r.dir || isDir) && r.re.test(r.anchored ? rel : rel.split('/').pop()));
  (function walk(dir, pre) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const rel = pre + e.name;
      if (e.name === '.git' || skip(rel, e.isDirectory())) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel + '/');
      else if (e.isFile()) out.push(rel);
    }
  })(ROOT, '');
  return out;
}
const blobSha = buf => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// ---------------------------------------------------------------- GitHub
const token = () => fs.readFileSync(path.join(ROOT, 'githubkey.txt'), 'utf8').trim();
async function api(method, url, body) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch('https://api.github.com' + url, {
        method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000),
        headers: { authorization: 'Bearer ' + token(), accept: 'application/vnd.github+json', 'user-agent': 'chieri-github-push', 'x-github-api-version': '2022-11-28' },
      });
      const text = await r.text();
      let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (_) { j = { message: text.slice(0, 200) }; }
      const retry = r.status >= 500 || r.status === 429 || (r.status === 403 && /rate limit|secondary/i.test(text));
      if (retry && k < 6) { await sleep(3000 * k); continue; }
      return { status: r.status, j };
    } catch (e) {            // connection reset, timeout
      if (k >= 6) throw e;
      await sleep(2000 * k);
    }
  }
}
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${r.j.message || ''}`); return r.j; };

(async () => {
  const files = listFiles().map(rel => {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    if (buf.length > MAX_FILE) throw new Error(`${rel} is ${(buf.length / 1048576).toFixed(0)} MB, over GitHub's limit`);
    return { rel, size: buf.length, sha: blobSha(buf) };
  });
  const total = files.reduce((s, f) => s + f.size, 0);
  console.log(`${files.length} files, ${(total / 1048576).toFixed(1)} MB`);
  if (dry) {
    for (const f of [...files].sort((a, b) => b.size - a.size).slice(0, 8)) console.log(`  largest: ${(f.size / 1048576).toFixed(2)} MB  ${f.rel}`);
    for (const top of [...new Set(files.map(f => f.rel.split('/')[0]))]) console.log(`  ${top}${files.some(f => f.rel.startsWith(top + '/')) ? '/ ' + files.filter(f => f.rel.startsWith(top + '/')).length : ''}`);
    return;
  }

  const me = must(await api('GET', '/user'), 'who am I');
  let info = await api('GET', `/repos/${repo}`);
  if (info.status === 404 && create) {
    const [vis, description] = create;
    must(await api('POST', '/user/repos', { name: repo.split('/')[1], description, private: vis === 'private', auto_init: true }), 'create repository');
    console.log(`created ${vis} repository ${repo}`);
    for (let k = 0; k < 10 && (info = await api('GET', `/repos/${repo}`)).status !== 200; k++) await sleep(2000);
  }
  const branch = must(info, 'repository').default_branch;
  let ref = null;
  for (let k = 0; k < 10; k++) { ref = await api('GET', `/repos/${repo}/git/ref/heads/${branch}`); if (ref.status === 200) break; await sleep(2000); }
  const head = must(ref, `branch ${branch}`).object.sha;
  const headTree = must(await api('GET', `/repos/${repo}/git/commits/${head}`), 'head commit').tree.sha;
  const remote = must(await api('GET', `/repos/${repo}/git/trees/${headTree}?recursive=1`), 'head tree');
  const have = new Set(remote.tree.filter(e => e.type === 'blob').map(e => e.sha));

  // upload what's missing, a few at a time
  const todo = files.filter(f => !have.has(f.sha));
  let done = 0, sent = 0;
  const worker = async () => {
    for (let f; (f = todo.shift());) {
      const b = must(await api('POST', `/repos/${repo}/git/blobs`, { content: fs.readFileSync(path.join(ROOT, f.rel)).toString('base64'), encoding: 'base64' }), f.rel);
      if (b.sha !== f.sha) throw new Error(`${f.rel}: GitHub stored ${b.sha}, expected ${f.sha}`);
      done++; sent += f.size;
      if (done % 25 === 0) console.log(`  uploaded ${done} files, ${(sent / 1048576).toFixed(1)} MB`);
    }
  };
  const n = todo.length;
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`uploaded ${n} new blobs (${(sent / 1048576).toFixed(1)} MB); ${files.length - n} already on GitHub`);

  const tree = must(await api('POST', `/repos/${repo}/git/trees`, { tree: files.map(f => ({ path: f.rel, mode: '100644', type: 'blob', sha: f.sha })) }), 'tree');
  if (tree.sha === headTree) { console.log('nothing changed: branch left as it is'); return; }
  const author = { name: me.login, email: `${me.id}+${me.login}@users.noreply.github.com`, date: new Date().toISOString() };
  const commit = must(await api('POST', `/repos/${repo}/git/commits`, { message, tree: tree.sha, parents: [head], author, committer: author }), 'commit');
  must(await api('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false }), 'update branch');
  console.log(`pushed ${commit.sha.slice(0, 7)} to ${repo}@${branch}: https://github.com/${repo}/commit/${commit.sha}`);
})().catch(e => { console.error('✘ ' + e.message); process.exit(1); });
