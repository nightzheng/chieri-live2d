'use strict';
// Main-process side of her voice (the page side is js/voice.js):
// - tts:fetch makes online / self-hosted TTS requests from here (no CORS) and caches the audio on disk;
// - the bundled Chieri GPT-SoVITS model is served by voice/chieri_server.py, run with a Python environment
//   the settings dialog can install into %LOCALAPPDATA%\chieri-tts (PyTorch + the model package's locked
//   requirements), or with one the user already has. The online edition ships without voice/, so LOCAL is
//   false there and only the online engines exist.
const { app, ipcMain, dialog, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const VOICE_DIR = app.isPackaged ? path.join(process.resourcesPath, 'voice') : path.join(__dirname, '..', 'voice');
const MODEL = path.join(VOICE_DIR, 'Chieri_GPTSoVITS_20261103');
const SERVER = path.join(VOICE_DIR, 'chieri_server.py');
const LOCAL = fs.existsSync(path.join(MODEL, 'delivery', 'chieri-gpt.ckpt')) && fs.existsSync(SERVER);
const WORK = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'chieri-tts');
const ENV_PY = path.join(WORK, 'env', 'Scripts', 'python.exe');
// written only once setup has installed and checked everything: the venv exists long before that
const READY = path.join(WORK, 'env', 'chieri-ready.json');
const CACHE = () => path.join(app.getPath('userData'), 'tts-cache');
const CACHE_MAX = 400 * 1024 * 1024;
const TORCH = ['torch==2.7.1', 'torchaudio==2.7.1', 'torchvision==0.22.1'];
const MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple';
const WEIGHTS = ['chieri-gpt.ckpt', 'chieri-sovits.pth'].map(n => path.join(MODEL, 'delivery', n));

let getSettings = () => ({});
const cfg = () => ((getSettings().tts || {}).chieri) || {};
const send = (ch, v) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, v); };
const hash = s => crypto.createHash('sha1').update(s).digest('hex');
// which weights are on disk: the package's recorded hashes plus each file's size and time. Part of the
// audio cache key (new weights never reuse audio made with old ones) and a running server is restarted
// when it changes. Checked on every line: two stats and a 1 KB read.
function modelId() {
  let rec = '';
  try { rec = JSON.stringify(JSON.parse(fs.readFileSync(path.join(MODEL, 'delivery', 'training-summary.json'), 'utf8')).weights_sha256); } catch (_) {}
  return hash(rec + WEIGHTS.map(f => { try { const s = fs.statSync(f); return `|${s.size}:${s.mtimeMs}`; } catch (_) { return '|-'; } }).join(''));
}

// ---------------------------------------------------------------- state pushed to the settings dialog
let server = null, serverState = { state: 'off', device: '', msg: '' }, setupJob = null;
const tail = [];
function log(line) {
  line = String(line).replace(/\s+$/, ''); if (!line) return;
  tail.push(line); if (tail.length > 40) tail.shift();
  send('tts:log', line);
}
// a log line of ours that must not end up in `tail` (which a crash message quotes)
const note = line => send('tts:log', line);
// python.exe to use: the one set in the settings (o overrides them), else the installed environment
// once setup has finished it (`partial` also takes one whose setup was interrupted, for checking)
const customPy = (o = {}) => o.python !== undefined ? o.python : cfg().python;
function pythonFor(o = {}, partial = false) {
  const p = customPy(o);
  if (p) return fs.existsSync(p) ? p : null;
  return fs.existsSync(ENV_PY) && (partial || fs.existsSync(READY)) ? ENV_PY : null;
}
const info = () => ({ local: LOCAL, envReady: LOCAL && !!pythonFor(), envPartial: LOCAL && !pythonFor() && !!pythonFor({}, true),
  python: pythonFor() || '', server: serverState, setup: !!setupJob, progress: setupJob ? setupJob.progress : null });
const changed = () => send('tts:state', info());
function setState(s) { serverState = { ...serverState, ...s }; changed(); }

function lines(stream, cb) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', d => { buf += d; const parts = buf.split(/\r?\n|\r/); buf = parts.pop(); parts.forEach(cb); });
  stream.on('end', () => { if (buf) cb(buf); });
}
function run(cmd, args, { timeout = 0, onLine, track } = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    fs.mkdirSync(WORK, { recursive: true });
    const p = spawn(cmd, args, { cwd: WORK, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PIP_DISABLE_PIP_VERSION_CHECK: '1' } });
    if (track) track(p);
    const t = timeout ? setTimeout(() => killTree(p), timeout) : 0;
    const on = l => { out += l + '\n'; if (onLine) onLine(l); };
    lines(p.stdout, on); lines(p.stderr, on);
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out) : reject(Object.assign(new Error(`${path.basename(cmd)} 退出代码 ${code}`), { out })); });
  });
}

// ---------------------------------------------------------------- disk cache (LRU by mtime)
function cacheGet(key) {
  const f = path.join(CACHE(), key);
  try { const b = fs.readFileSync(f); const now = new Date(); fs.utimes(f, now, now, () => {}); return b; } catch (_) { return null; }
}
let puts = 0;
function cachePut(key, buf) {
  try { fs.mkdirSync(CACHE(), { recursive: true }); fs.writeFileSync(path.join(CACHE(), key), buf); } catch (_) { return; }
  if (puts++ % 40) return;
  try {
    const files = fs.readdirSync(CACHE()).map(n => { const f = path.join(CACHE(), n), st = fs.statSync(f); return { f, size: st.size, t: st.mtimeMs }; }).sort((a, b) => b.t - a.t);
    let total = 0; for (const x of files) { total += x.size; if (total > CACHE_MAX) fs.unlinkSync(x.f); }
  } catch (_) {}
}

// ---------------------------------------------------------------- online engines
async function ttsFetch(r) {
  try {
    const u = new URL(r.url); if (!/^https?:$/.test(u.protocol)) throw new Error('只支持 http(s) 地址');
    const key = hash('fetch|' + r.url + '|' + (r.ck || r.body));
    const hit = cacheGet(key); if (hit) return { ok: true, bytes: hit };
    const res = await fetch(u, { method: 'POST', headers: r.headers, body: r.body, signal: AbortSignal.timeout(r.timeout || 30000) });
    const buf = Buffer.from(await res.arrayBuffer()), type = res.headers.get('content-type') || '';
    // some services answer errors with 200 and a JSON body
    if (!res.ok || /json|text\/(plain|html)/.test(type)) return { ok: false, status: res.status, text: buf.toString('utf8').slice(0, 400) };
    cachePut(key, buf);
    return { ok: true, bytes: buf };
  } catch (e) { return { ok: false, error: e.name === 'TimeoutError' ? '语音请求超时' : e.message }; }
}

// ---------------------------------------------------------------- the local Chieri model
// Environment setup can spawn pip children. It is only cancelled while its tracked child is live.
function killTree(proc) {
  if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform !== 'win32') { proc.kill(); return; }
  execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, error => {
    if (error && proc.exitCode === null) note('无法停止运行环境命令，请等待它结束。');
  });
}

let stoppingVoice = Promise.resolve();
let quittingVoice = false;
let reportedLegacy = false;

function closeVoice(proc) {
  if (!proc?.pid || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(stopTimer);
      clearTimeout(deadline);
      proc.removeListener('exit', done);
      proc.removeListener('error', done);
      resolve();
    };
    const stopTimer = setTimeout(() => {
      note('语音进程未及时退出，尝试结束当前启动的进程。');
      proc.kill();
    }, 3000);
    const deadline = setTimeout(() => {
      note('未能确认语音进程退出。请检查当前语音服务后再重启。');
      done();
    }, 5000);
    proc.once('exit', done);
    proc.once('error', done);
    proc.stdin.destroy();
  });
}

// a load is left alone this long before a restart with the same settings may replace it: importing PyTorch
// and GPT-SoVITS prints nothing for a minute or more, and restarting then only starts that wait over
const LOAD_PATIENCE = 180000;
// past this a load counts as stuck: it is stopped and reported (the log has its stack dumps by then)
const LOAD_TIMEOUT = 600000;
function startServer(o = {}) {
  if (quittingVoice) return Promise.reject(new Error('应用正在退出'));
  const py = pythonFor(o), device = o.device || cfg().device || 'auto', stamp = modelId();
  if (server) {
    const why = server.py !== py ? `Python 改成了 ${py || '（无）'}` : server.device !== device ? `运行设备改成了 ${device}`
      : server.stamp !== stamp ? '模型文件变了' : o.restart ? '要求重新加载' : '';
    const loading = Date.now() - server.t0;
    if (why === '要求重新加载' && !server.port && loading < LOAD_PATIENCE) {
      note(`模型还在加载（已经 ${Math.round(loading / 1000)} 秒），不用重启。第一次加载可能要一两分钟，${Math.round(LOAD_PATIENCE / 60000)} 分钟还没好再点「加载 / 重启模型」。`);
      return server.ready;
    }
    if (why) stopServer(why);
  }
  if (server) return server.ready;
  if (!LOCAL) return Promise.reject(new Error('这个版本没有内置本地声线模型'));
  if (setupJob && !customPy(o)) return Promise.reject(new Error('正在安装本地语音的运行环境，装好之后才能用'));
  if (!py) return Promise.reject(new Error(customPy(o) ? '找不到设置里的 python.exe'
    : pythonFor(o, true) ? '本地语音的运行环境没有装完（设置 → 语音 → 继续安装）' : '还没有安装本地语音的运行环境（设置 → 语音 → 一键安装环境）'));
  fs.mkdirSync(WORK, { recursive: true });
  tail.length = 0;
  const me = server = { proc: null, py, device, stamp, port: 0, t0: Date.now() };
  setState({ state: 'starting', device: '', msg: '', model: null });
  // a stopped server's promise rejects with .stopped set: replaced on purpose, not an error to report
  const stopped = () => Object.assign(new Error('语音进程已停止'), { stopped: true });
  me.ready = stoppingVoice.then(() => new Promise((resolve, reject) => {
    if (me.stopping) return reject(stopped());
    if (!reportedLegacy) {
      reportedLegacy = true;
      note('旧版本遗留的 Python 进程无法确认归属，已跳过自动清理。');
    }
    log(`加载声线模型：${py}（设备 ${device}）`);
    // the loading itself is mostly silent: say now and then that it is still going
    me.beat = setInterval(() => {
      if (server !== me || me.port) return;
      const t = Date.now() - me.t0;
      if (t < LOAD_TIMEOUT) return note(`……仍在加载（${Math.round(t / 1000)} 秒）`);
      me.timedOut = true; clearInterval(me.beat); stoppingVoice = closeVoice(me.proc);
    }, 20000);
    const proc = me.proc = spawn(py, ['-u', SERVER, '--model', MODEL, '--cache', path.join(WORK, 'cache'), '--device', device, '--watch-stdin'],
      { cwd: WORK, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
    proc.stdin.on('error', () => {});
    lines(proc.stdout, l => {
      const m = /^CHIERI_READY (.+)$/.exec(l);
      if (!m) return log(l);
      const r = JSON.parse(m[1]), w = r.model || {}; me.port = r.port; clearInterval(me.beat);
      log(`模型已加载：${r.device}${r.gpu ? ' · ' + r.gpu : ''}（用时 ${r.seconds} 秒）· GPT ${w.gpt || '?'}${w.label ? ' ' + w.label : ''} / SoVITS ${w.sovits || '?'}`
        + (w.verified === false ? '（权重文件和模型包里记录的不一致）' : ''));
      if (server === me) setState({ state: 'ready', device: r.device, msg: '', model: r.model || null });
      resolve(me);
    });
    lines(proc.stderr, l => {
      // faulthandler's dump of a stage that is taking long (chieri_server.py STALL)
      if (/^Timeout \(\d/.test(l)) note('（这一步已经超过 1 分半钟。下面是 Python 此刻正在执行的代码；如果一直卡住，把整段日志发给开发者就能看出卡在哪里）');
      log(l);
    });
    const gone = err => {
      clearInterval(me.beat); reject(err);
      if (server === me) { server = null; setState(me.stopping ? { state: 'off', msg: '' } : { state: 'error', msg: err.message.slice(0, 300) }); }
    };
    proc.on('error', e => gone(new Error('无法启动 Python：' + e.message)));
    proc.on('exit', code => gone(me.stopping ? stopped()
      : me.timedOut ? new Error(`加载超过 ${LOAD_TIMEOUT / 60000} 分钟还没完成，已经停止。日志里「Timeout」开头的几段是它卡住的位置`)
      : new Error(`语音进程退出了（代码 ${code}）：${tail.slice(-2).join(' / ') || '没有输出'}`)));
  }));
  me.ready.catch(() => {});
  return me.ready;
}
function stopServer(why) {
  if (!server) return stoppingVoice;
  const s = server; server = null; s.stopping = true; clearInterval(s.beat);
  if (why && s.proc) log(`■ 停止语音进程：${why}`);
  if (s.proc) stoppingVoice = closeVoice(s.proc);
  setState({ state: 'off', msg: '', model: null });
  return stoppingVoice;
}

// one synthesis at a time; lines she is saying now go ahead of pre-generation, and a line made moot by
// a newer one from the same window is skipped (ids are times, so they keep growing across reloads)
const jobs = [], newest = {};
let busy = false;
function chieri(sender, o) {
  const text = String(o.text || '').trim().slice(0, 300);
  if (!text) return Promise.resolve({ ok: false, error: '没有要说的话' });
  const key = hash('chieri|' + modelId() + '|' + text), hit = cacheGet(key);
  if (hit) return Promise.resolve({ ok: true, bytes: hit });
  if (!o.batch) newest[sender] = Math.max(newest[sender] || 0, o.id || 0);
  return new Promise(resolve => {
    const job = { o, text, key, sender, resolve }, i = o.batch ? -1 : jobs.findIndex(j => j.o.batch);
    if (i < 0) jobs.push(job); else jobs.splice(i, 0, job);
    pump();
  });
}
async function pump() {
  if (busy || !jobs.length) return;
  busy = true;
  const j = jobs.shift();
  try {
    if (!j.o.batch && (j.o.id || 0) < newest[j.sender]) j.resolve({ ok: false, stale: true });
    else {
      // a server replaced while this line waited for it: the line goes to the new one
      let s;
      try { s = await startServer(j.o); } catch (e) { if (!e.stopped || !server) throw e; s = await server.ready; }
      const res = await fetch(`http://127.0.0.1:${s.port}/tts`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: j.text }), signal: AbortSignal.timeout(j.o.batch ? 600000 : 180000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) { let m = ''; try { m = JSON.parse(buf.toString('utf8')).error; } catch (_) { m = buf.toString('utf8').slice(0, 200); } throw new Error(m || 'HTTP ' + res.status); }
      cachePut(j.key, buf);
      j.resolve({ ok: true, bytes: buf });
    }
  } catch (e) { j.resolve({ ok: false, error: e.name === 'TimeoutError' ? '本地语音合成超时' : e.message }); }
  busy = false; pump();
}

// ---------------------------------------------------------------- environment: check and one-click install
const CHECK = `import json, sys, importlib.util as u
r = {'ok': True, 'python': sys.version.split()[0], 'exe': sys.executable, 'torch': '', 'cuda': False, 'gpu': ''}
mods = ['torch', 'torchaudio', 'transformers', 'pyopenjtalk', 'soundfile', 'librosa', 'numpy', 'jieba', 'pypinyin', 'cn2an', 'g2p_en',
        'split_lang', 'fast_langdetect', 'sentencepiece', 'pytorch_lightning', 'peft', 'x_transformers', 'budoux', 'sudachipy']
r['missing'] = [m for m in mods if u.find_spec(m) is None]
try:
    import torch
    r['torch'] = torch.__version__; r['cuda'] = torch.cuda.is_available(); r['gpu'] = torch.cuda.get_device_name(0) if r['cuda'] else ''
except Exception as e:
    r['torchError'] = str(e)
print('CHIERI_CHECK ' + json.dumps(r, ensure_ascii=False))`;
async function check(o) {
  const py = pythonFor(o, true);
  if (!py) return { ok: false, error: o.python ? '找不到这个 python.exe' : '还没有安装运行环境' };
  try {
    const out = await run(py, ['-c', CHECK], { timeout: 180000 }), m = /CHIERI_CHECK (.+)/.exec(out);
    if (!m) throw new Error(out.slice(-300));
    return JSON.parse(m[1]);
  } catch (e) { return { ok: false, error: e.message + (e.out ? '\n' + e.out.slice(-500) : '') }; }
}
// a 64-bit Python 3.12 to create the environment from (the py launcher, or the usual install folders)
async function findPython() {
  const L = process.env.LOCALAPPDATA || '', PF = process.env.ProgramFiles || 'C:\\Program Files';
  const tries = [['py', ['-3.12']], [path.join(L, 'Programs', 'Python', 'Python312', 'python.exe'), []], [path.join(PF, 'Python312', 'python.exe'), []], ['C:\\Python312\\python.exe', []]];
  for (const [cmd, pre] of tries) {
    if (path.isAbsolute(cmd) && !fs.existsSync(cmd)) continue;
    try {
      const out = await run(cmd, [...pre, '-c', 'import sys, struct; print("PY", sys.version_info[:2] == (3, 12) and struct.calcsize("P") == 8, sys.executable)'], { timeout: 20000 });
      const m = /PY True (.+)/.exec(out); if (m) return m[1].trim();
    } catch (_) {}
  }
  return null;
}
// pip 24.1+ can print "Progress <done> of <total>" lines for its downloads (--progress-bar raw)
async function pipRaw() {
  try { const m = /pip (\d+)\.(\d+)/.exec(await run(ENV_PY, ['-m', 'pip', '--version'], { timeout: 60000 })); return !!m && (+m[1] > 24 || (+m[1] === 24 && +m[2] >= 1)); }
  catch (_) { return false; }
}

// ---------------------------------------------------------------- setup progress
// One bar for the whole setup, pushed to the page as tts:progress (at most every 200 ms, the latest state
// always arrives). Each step has a share of it by how long it usually takes; pip steps move inside theirs
// by what pip prints (pipMeter).
function progressBar(job) {
  let plan = [], at = -1, f = 0, sent = 0, timer = null;
  const p = job.progress = { pct: 0, step: 0, steps: 0, title: '准备安装', detail: '', pulse: true, done: false, ok: false };
  const flush = () => { clearTimeout(timer); timer = null; sent = Date.now(); send('tts:progress', { ...p }); };
  const push = now => { if (now) flush(); else if (!timer) timer = setTimeout(flush, Math.max(0, 200 - (Date.now() - sent))); };
  const share = () => {
    const all = plan.reduce((s, x) => s + x[2], 0) || 1;
    return [plan.slice(0, at).reduce((s, x) => s + x[2], 0) / all, (plan[at] ? plan[at][2] : 0) / all];
  };
  return {
    plan(steps) { plan = steps; p.steps = steps.length; },
    go(key, detail = '') {
      at = plan.findIndex(x => x[0] === key); f = 0;
      Object.assign(p, { step: at + 1, title: plan[at][1], detail, pulse: true, pct: share()[0] * 100 }); push(true);
    },
    // fraction of the current step (never goes back), what is happening, whether nothing measurable moves
    move(frac, detail, pulse = false) {
      if (p.done) return;
      f = Math.max(f, Math.min(1, frac)); const [b, w] = share();
      Object.assign(p, { pct: (b + w * f) * 100, pulse }); if (detail != null) p.detail = detail; push();
    },
    end(ok, detail) { if (ok) p.pct = 100; Object.assign(p, { done: true, ok, detail, pulse: false }); push(true); },
  };
}
// pip's output -> how far one `pip install` is. 'bytes': downloaded bytes against an estimate (PyTorch is
// one huge wheel); 'count': packages, about `amount` of them (the requirements file pins every one). Each
// package counts a quarter when pip resolves it and the rest once it is downloaded: new pips resolve
// everything from metadata first and download the wheels afterwards. Without raw progress lines (an older
// pip) the bar only moves per file and pulses in between. Returns true for lines that are not worth logging.
const SIZE = { bytes: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9 };
const fmtB = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
// ".../torch-2.7.1%2Bcu128-cp312-cp312-win_amd64.whl" -> "torch 2.7.1+cu128"
const wheelName = s => {
  let f = s.split('/').pop(); try { f = decodeURIComponent(f); } catch (_) {}
  f = f.replace(/\.(whl|zip|tar\.gz|tar\.bz2)$/, ''); const m = /^([^-]+)-([^-]+)/.exec(f); return m ? `${m[1]} ${m[2]}` : f;
};
function pipMeter(bar, mode, amount) {
  let collected = 0, got = 0, bytes = 0, file = null, name = '', raw = false, phase = 'get';
  const seen = [];   // [time, bytes] over the last few seconds, for the speed
  const done = () => { if (file) { got++; bytes += file.total; file = null; } };
  const show = () => {
    if (phase === 'build') return bar.move(0.9, `编译 ${name}…`, true);
    if (phase === 'install') return bar.move(0.93, '正在安装（要解压很多文件，可能要几分钟）…', true);
    const all = bytes + (file ? file.cur : 0), now = Date.now();
    seen.push([now, all]); while (seen.length > 2 && now - seen[0][0] > 6000) seen.shift();
    const v = now - seen[0][0] > 800 ? (all - seen[0][1]) / ((now - seen[0][0]) / 1000) : 0;
    let frac;
    if (mode === 'bytes') { amount = Math.max(amount, all * 1.01, file ? (bytes + file.total) * 1.01 : 0); frac = all / amount; }
    else frac = (collected * 0.25 + (got + (file && file.total ? file.cur / file.total : 0)) * 0.75) / Math.max(amount, collected, 1);
    // pip reports progress only for files over 512 KB
    const live = raw && file && file.total > 512 * 1024;
    let d;
    if (file) {
      d = `下载 ${file.name}` + (live ? `：${fmtB(file.cur)} / ${fmtB(file.total)}` : file.total ? `（${fmtB(file.total)}）…` : '…');
      if (live && v > 0) {
        d += ` · ${fmtB(v)}/s`;
        const left = (file.total - file.cur) / v; if (left > 20) d += left < 90 ? ' · 还要约 1 分钟' : ` · 还要约 ${Math.round(left / 60)} 分钟`;
      }
      if (mode === 'count') d += ` · 第 ${got + 1} 个包，共约 ${Math.max(amount, collected)} 个`;
    } else d = `解析依赖：${name}` + (mode === 'count' ? `（${collected} / ${Math.max(amount, collected)}）` : '');
    bar.move(0.88 * Math.min(1, frac), d, !live);
  };
  return line => {
    let m;
    if ((m = /^\s*Progress (\d+) of (\d+)\s*$/.exec(line))) { raw = true; if (file) { file.cur = +m[1]; file.total = +m[2] || file.total; } show(); return true; }
    if ((m = /^\s*Collecting (.+?)(?:[=<>!~;\s(]|$)/.exec(line))) { done(); collected++; name = m[1]; show(); }
    else if ((m = /^\s*Requirement already satisfied: (.+?)(?:[=<>!~;\s(]|$)/.exec(line))) { done(); collected++; got++; name = m[1]; show(); }
    else if ((m = /^\s*(Downloading|Using cached) (\S+)(?: \(([\d.]+) (bytes|kB|KB|MB|GB)\))?/.exec(line)) && !/\.metadata$/.test(m[2])) {
      done(); const total = m[3] ? m[3] * SIZE[m[4]] : 0;
      file = { name: wheelName(m[2]), total, cur: m[1] === 'Using cached' ? total : 0 }; show();
    }
    else if ((m = /^\s*Building wheels? for (?:collected packages: )?(.+?)[\s,(]/.exec(line))) { done(); phase = 'build'; name = m[1]; show(); }
    else if (/^\s*Installing collected packages/.test(line)) { done(); phase = 'install'; show(); }
    else if (/^\s*Successfully installed/.test(line)) bar.move(1, '这一步装好了');
    return false;
  };
}

const markReady = r => fs.writeFileSync(READY, JSON.stringify({ python: r.python, torch: r.torch, cuda: r.cuda, gpu: r.gpu, at: new Date().toISOString() }));
let setupRuns = 0;
// an environment installed before READY existed is adopted if it passes the same check setup ends with
function adoptEnv() {
  if (!LOCAL || !fs.existsSync(ENV_PY) || fs.existsSync(READY)) return;
  const n = setupRuns;
  check({ python: ENV_PY }).then(r => {
    if (r.ok && !r.missing.length && !setupJob && n === setupRuns) { try { markReady(r); } catch (_) { return; } changed(); }
  });
}
async function hasNvidia() { try { return /GPU \d/.test(await run('nvidia-smi', ['-L'], { timeout: 15000 })); } catch (_) { return false; } }
async function setup(o) {
  if (setupJob) return { ok: false, error: '正在安装中' };
  if (!LOCAL) return { ok: false, error: '这个版本没有内置本地声线模型' };
  const job = setupJob = { cancelled: false, child: null, progress: null }; setupRuns++;
  const bar = progressBar(job);
  try { fs.unlinkSync(READY); } catch (_) {}
  changed();
  const step = async (title, cmd, args, meter) => {
    if (job.cancelled) throw new Error('已取消安装');
    log('▶ ' + title);
    try { await run(cmd, args, { onLine: l => { if (!(meter && meter(l))) log(l); }, track: c => { job.child = c; } }); }
    catch (e) { throw job.cancelled ? new Error('已取消安装') : e; }
  };
  try {
    await stopServer('开始安装运行环境');   // a running server holds files pip may have to replace
    const gpu = o.device === 'cpu' ? false : o.device === 'cuda' ? true : await hasNvidia();
    const torchTitle = `安装 PyTorch 2.7.1（${gpu ? 'CUDA 12.8 显卡版，约 3.3 GB' : o.device === 'cpu' ? 'CPU 版' : '没有检测到 NVIDIA 显卡，安装 CPU 版'}）`;
    const req = path.join(MODEL, 'requirements-locked.txt');
    let reqs = 150; try { reqs = fs.readFileSync(req, 'utf8').split(/\r?\n/).filter(l => /^[A-Za-z0-9]/.test(l)).length || reqs; } catch (_) {}
    // shares of the bar: about how long each step takes (PyTorch for the GPU is a 3.3 GB download)
    bar.plan([['python', '查找 Python 3.12', 1], ['venv', '创建虚拟环境', 3], ['torch', torchTitle, gpu ? 62 : 20],
      ['deps', '安装 GPT-SoVITS 依赖', gpu ? 28 : 70], ['check', '检测运行环境', 6]]);
    bar.go('python', '查找 64 位的 Python 3.12…');
    const base = await findPython();
    if (!base) {
      bar.end(false, '没有找到 64 位的 Python 3.12');
      return { ok: false, code: 'nopython', error: '没有找到 64 位的 Python 3.12。请先安装 Python 3.12（python.org），再点一次「一键安装环境」。' };
    }
    log('使用 Python：' + base);
    const venv = path.dirname(path.dirname(ENV_PY)), had = fs.existsSync(ENV_PY);
    bar.go('venv', had ? '已经有虚拟环境，接着装' : venv);
    if (!had) await step('创建虚拟环境：' + venv, base, ['-m', 'venv', venv]);
    const pip = await pipRaw() ? ['--progress-bar', 'raw'] : [];
    log('下载的文件很大，中间可能很久都没有新的输出，请等它装完；装好之前本地声线用不了。');
    bar.go('torch', '连接 download.pytorch.org…');
    await step(torchTitle, ENV_PY, ['-m', 'pip', 'install', ...pip, ...TORCH, '--index-url', gpu ? 'https://download.pytorch.org/whl/cu128' : 'https://download.pytorch.org/whl/cpu'],
      pipMeter(bar, 'bytes', gpu ? 3.35e9 : 0.28e9));
    bar.go('deps', o.mirror ? '使用清华镜像' : '连接 PyPI…');
    await step('安装 GPT-SoVITS 依赖', ENV_PY, ['-m', 'pip', 'install', ...pip, '-r', req, ...(o.mirror ? ['-i', MIRROR] : [])], pipMeter(bar, 'count', reqs));
    bar.go('check', '导入 PyTorch 和各个依赖，检查显卡…');
    const r = await check({ python: ENV_PY });
    if (!r.ok) throw new Error(r.error);
    if (r.missing.length) throw new Error('还缺少这些模块：' + r.missing.join(', '));
    markReady(r);
    log(`环境就绪：Python ${r.python} · torch ${r.torch} · ${r.cuda ? r.gpu : 'CPU'}`);
    bar.end(true, `Python ${r.python} · torch ${r.torch} · ${r.cuda ? r.gpu : 'CPU'}`);
    return { ok: true };
  } catch (e) { bar.end(false, e.message); return { ok: false, error: e.message }; }
  finally { setupJob = null; changed(); }
}

module.exports = function initVoice(settingsGetter) {
  getSettings = settingsGetter;
  ipcMain.handle('tts:info', () => info());
  ipcMain.handle('tts:fetch', (_, r) => ttsFetch(r));
  ipcMain.handle('tts:chieri', (e, o) => chieri(e.sender.id, o || {}));
  // (a server stopped on purpose is not an error: stopServer has logged why)
  ipcMain.handle('tts:start', (_, o) => { startServer(o || {}).catch(e => { if (e.stopped) return; log('✘ ' + e.message); setState({ state: 'error', msg: e.message }); }); return true; });
  ipcMain.handle('tts:check', (_, o) => check(o || {}));
  ipcMain.handle('tts:setup', (_, o) => setup(o || {}));
  ipcMain.on('tts:setupCancel', () => { if (setupJob) { setupJob.cancelled = true; killTree(setupJob.child); } });
  ipcMain.handle('tts:pickPython', async e => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: '选择已有 GPT-SoVITS 环境的 python.exe', properties: ['openFile'], filters: [{ name: 'python.exe', extensions: ['exe'] }] });
    return r.canceled ? '' : r.filePaths[0];
  });
  ipcMain.on('tts:pythonPage', () => shell.openExternal('https://www.python.org/downloads/windows/'));
  let voiceStopped = false;
  app.on('before-quit', event => {
    if (voiceStopped) return;
    event.preventDefault();
    if (quittingVoice) return;
    quittingVoice = true;
    const child = setupJob?.child;
    if (setupJob) setupJob.cancelled = true;
    if (child) killTree(child);
    stopServer().finally(() => { voiceStopped = true; app.quit(); });
  });
  adoptEnv();
};
