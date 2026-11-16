'use strict';
// ============================================================================
//  Her voice: text-to-speech through an online service or a local GPT-SoVITS model,
//  played with WebAudio so her mouth can follow the loudness (Voice.lvl).
//  The bundled Chieri model only speaks Japanese, so for it (and for any engine set to
//  "translate to Japanese") lines are translated first: fixed lines from VOICE_JA
//  (lines_ja.js), AI replies from the "ja" field the model returns, anything else by
//  asking the AI model. Inside the desktop app requests go out from the main process
//  (no CORS) and results are cached on disk; local engines exist only in the full
//  edition, which ships the model (electron/voice.js).
// ============================================================================
const TTS_LANG = [['auto', '原文（不翻译）'], ['ja', '先翻译成日语再朗读']];
const TTS_OPENAI_PRESETS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'coral' },
  siliconflow: { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/CosyVoice2-0.5B', voice: 'FunAudioLLM/CosyVoice2-0.5B:anna' },
  custom: { label: '自定义', baseUrl: '', model: '', voice: '' },
};
// fields: [key, label, placeholder | options, input type]
const TTS_ENGINES = {
  off: { label: '关闭' },
  chieri: { label: '千绘莉声线 · 本地 GPT-SoVITS（日语）', local: true,
    note: '内置的千绘莉专属模型，只会说日语：台词会先翻译成日语（固定台词已附译文，AI 回复由 AI 模型一并翻译）。需要本地 Python 环境，推荐 NVIDIA 显卡。' },
  gsv: { label: 'GPT-SoVITS 接口（api_v2）', local: true, fields: [
    ['url', '接口地址', 'http://127.0.0.1:9880'],
    ['refAudio', '参考音频', '参考音频在服务器上的路径'],
    ['promptText', '参考文本', '参考音频里说的话'],
    ['promptLang', '参考语言', [['ja', '日语'], ['zh', '中文'], ['en', '英语'], ['ko', '韩语'], ['yue', '粤语']]],
    ['lang', '朗读语言', TTS_LANG]],
    note: '对接 GPT-SoVITS 自带的 api_v2.py（python api_v2.py -a 127.0.0.1 -p 9880），声线模型在服务那边加载。' },
  openai: { label: 'OpenAI 兼容（/audio/speech）', fields: [
    ['preset', '服务商', Object.entries(TTS_OPENAI_PRESETS).map(([k, p]) => [k, p.label])],
    ['baseUrl', '接口地址', 'https://api.openai.com/v1'],
    ['apiKey', 'API Key', 'sk-…', 'password'],
    ['model', '模型', 'gpt-4o-mini-tts'],
    ['voice', '音色', 'coral'],
    ['lang', '朗读语言', TTS_LANG]],
    note: 'OpenAI、硅基流动等兼容 /audio/speech 的服务都可以用。' },
  fish: { label: 'Fish Audio', fields: [
    ['apiKey', 'API Key', '', 'password'],
    ['voice', '音色 ID', '在 fish.audio 的音色页面复制 ID'],
    ['model', '模型', 's1'],
    ['lang', '朗读语言', TTS_LANG]] },
  elevenlabs: { label: 'ElevenLabs', fields: [
    ['apiKey', 'API Key', '', 'password'],
    ['voice', 'Voice ID', '音色 ID'],
    ['model', '模型', 'eleven_multilingual_v2'],
    ['lang', '朗读语言', TTS_LANG]] },
  azure: { label: 'Azure 语音服务', fields: [
    ['region', '区域', 'eastasia'],
    ['apiKey', '密钥', '', 'password'],
    ['voice', '音色', 'zh-CN-XiaoyiNeural'],
    ['lang', '朗读语言', TTS_LANG]],
    note: '音色名决定语言，例如 zh-CN-XiaoyiNeural、ja-JP-NanamiNeural。' },
};
const DEFAULT_TTS = {
  engine: 'off', volume: 0.9,
  chat: true, react: true,    // speak chat replies / touch reactions and other fixed lines
  chieri: { python: '', device: 'auto' },
  gsv: { url: 'http://127.0.0.1:9880', refAudio: '', promptText: '', promptLang: 'ja', lang: 'auto' },
  openai: { preset: 'openai', ...TTS_OPENAI_PRESETS.openai, apiKey: '', lang: 'auto' },
  fish: { apiKey: '', voice: '', model: 's1', lang: 'auto' },
  elevenlabs: { apiKey: '', voice: '', model: 'eleven_multilingual_v2', lang: 'auto' },
  azure: { region: 'eastasia', apiKey: '', voice: 'zh-CN-XiaoyiNeural', lang: 'auto' },
};
delete DEFAULT_TTS.openai.label;
// saved voice settings over the defaults, one level deep per engine
function mergeTts(t) {
  const d = JSON.parse(JSON.stringify(DEFAULT_TTS));
  for (const [k, v] of Object.entries(t || {})) d[k] = v && typeof v === 'object' && d[k] && typeof d[k] === 'object' ? { ...d[k], ...v } : v;
  return d;
}

const Voice = {
  caps: { desktop: false, local: false, envReady: false },
  playing: false, pending: 0, currentKind: '', lvl: 0,
  seq: 0,                  // the line being spoken: audio that arrives for an older one is dropped
  ctx: null, gain: null, an: null, src: null, buf: null,
  ready: new Map(),        // text -> pending audio made by prepare()
  ja: new Map(),           // Chinese -> Japanese translations made by the AI model (kept in localStorage)
  errAt: 0,

  async init() {
    this.caps.desktop = !!window.petAPI;
    if (window.petAPI) try { Object.assign(this.caps, await window.petAPI.ttsInfo()); } catch (_) {}
    try { this.ja = new Map(JSON.parse(localStorage.getItem('l2d.ja') || '[]')); } catch (_) {}
    // browsers keep audio muted until the first click or key
    const unlock = () => { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };
    window.addEventListener('pointerdown', unlock, true); window.addEventListener('keydown', unlock, true);
    if (window.petAPI) window.petAPI.onTtsState(i => {
      const was = (this.caps.server || {}).state, wasReady = this.caps.envReady;
      Object.assign(this.caps, i); VoiceUI.state();
      if (i.envReady && !wasReady && this.engine() === 'chieri') window.petAPI.chieriStart({});
      const s = i.server || {};
      if (s.state !== was && this.engine() === 'chieri' && typeof toast === 'function') {
        if (s.state === 'ready') toast(`声线模型已加载（${s.device === 'cuda' ? 'NVIDIA 显卡' : 'CPU，会比较慢'}）`, 2600, 'happy');
        if (s.state === 'error') toast('本地语音：' + s.msg, 5000, 'pout');
      }
    });
    // the local model takes a while to load: start it now rather than on her first line
    if (this.engine() === 'chieri' && this.caps.envReady) window.petAPI.chieriStart({});
  },
  cfg() { return Store.data.tts; },
  allowed(e) { return !!TTS_ENGINES[e] && (!TTS_ENGINES[e].local || this.caps.local); },
  engine() { const e = this.cfg().engine; return this.allowed(e) ? e : 'off'; },
  on(kind) { return this.engine() !== 'off' && (kind === 'reminder' || kind === 'proactive' || !!this.cfg()[kind === 'chat' ? 'chat' : 'react']); },
  wantsJa() { const e = this.engine(); return e === 'chieri' || (e !== 'off' && this.cfg()[e].lang === 'ja'); },
  jaName() { const n = Store.data.name; return n === '千绘莉' ? 'ちえり' : n; },
  // what is actually said: no (stage directions), no decorations
  spoken(t) {
    t = String(t || '').replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, '').replace(/[♪♡☆★～~]|Zzz/g, '').replace(/\s+/g, ' ').trim();
    return /[\p{L}\p{N}]/u.test(t) ? t : '';
  },

  // say a line aloud (called by say() in app.js); a newer line cuts the previous one
  speak(text, opt = {}) {
    if (!this.on(opt.kind)) return false;
    const id = ++this.seq, t0 = performance.now(), wait = opt.kind === 'chat' ? 40000 : 15000;
    this.stop();
    this.currentKind = opt.kind || 'react';
    const p = this.ready.get(text) || this.make(text, opt).catch(e => this.fail(e));
    this.ready.delete(text);
    p.then(buf => { if (buf && id === this.seq && performance.now() - t0 < wait) this.play(buf); });
    return true;
  },
  interrupt() { this.seq++; this.stop(); this.currentKind = ''; },
  // start making the audio of a line about to be said, so text and voice can appear together;
  // resolves when it is ready or after `timeout` ms, whichever comes first
  prepare(text, opt = {}, timeout = 8000) {
    if (!this.on(opt.kind)) return Promise.resolve();
    const p = this.make(text, opt).catch(e => this.fail(e));
    this.ready.set(text, p);
    if (this.ready.size > 6) this.ready.delete(this.ready.keys().next().value);
    return Promise.race([p, new Promise(r => setTimeout(r, timeout))]);
  },
  // text -> decoded AudioBuffer (null when there is nothing to say); throws on failure
  async make(text, opt = {}) {
    this.pending++;
    try {
      const eng = this.engine();
      const words = this.wantsJa() ? await this.toJa(text, opt.ja) : this.spoken(text);
      if (!words || eng === 'off') return null;
      const bytes = await this.synth(eng, words, opt);
      return bytes ? await this.decode(bytes) : null;
    } finally { this.pending--; }
  },

  async toJa(text, ja) {
    if (typeof ja === 'string' && ja.trim()) return this.spoken(ja);
    const key = String(text).trim();
    if (key in VOICE_JA) return this.spoken(VOICE_JA[key]);
    const plain = this.spoken(text);
    if (!plain || /[぀-ヿ]/.test(plain)) return plain;   // nothing to say, or Japanese already
    if (this.ja.has(plain)) return this.ja.get(plain);
    if (!AI.ready()) throw new Error('日语声线需要先翻译台词：请在设置里配置 AI 服务');
    const out = this.spoken(await AI.translate(plain));
    this.ja.set(plain, out);
    if (this.ja.size > 400) this.ja.delete(this.ja.keys().next().value);
    try { localStorage.setItem('l2d.ja', JSON.stringify([...this.ja])); } catch (_) {}
    return out;
  },

  // -> audio file bytes (Uint8Array / ArrayBuffer), or null when a newer line made this one moot
  async synth(eng, text, opt = {}) {
    if (eng === 'chieri') {
      const c = this.cfg().chieri;
      const r = await window.petAPI.chieri({ text, id: performance.timeOrigin + performance.now(), batch: !!opt.batch, python: c.python, device: c.device });
      if (r.stale) return null;
      if (!r.ok) throw new Error(r.error || '本地语音合成失败');
      return r.bytes;
    }
    const q = this.request(eng, text);
    if (window.petAPI) {
      const r = await window.petAPI.ttsFetch({ ...q, timeout: opt.batch ? 60000 : 30000 });
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}: ${String(r.text || '').slice(0, 160)}`);
      return r.bytes;
    }
    const memo = this.memo || (this.memo = new Map());
    if (memo.has(q.ck)) return memo.get(q.ck);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(q.url, { method: 'POST', headers: q.headers, body: q.body, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const b = await r.arrayBuffer();
      memo.set(q.ck, b); if (memo.size > 60) memo.delete(memo.keys().next().value);
      return b;
    } catch (e) { throw e.name === 'AbortError' ? new Error('语音请求超时') : e; } finally { clearTimeout(timer); }
  },
  // the HTTP request for an online (or self-hosted) engine; ck is the cache key, without secrets
  request(eng, text) {
    const c = this.cfg()[eng], base = u => String(u || '').trim().replace(/\/+$/, '');
    const ck = eng + '|' + JSON.stringify({ ...c, apiKey: '' }) + '|' + text, json = { 'content-type': 'application/json' };
    const need = (v, what) => { if (!String(v || '').trim()) throw new Error(`请先在设置里填写语音的${what}`); return String(v).trim(); };
    if (eng === 'openai') return { url: need(base(c.baseUrl), '接口地址') + '/audio/speech', ck,
      headers: { ...json, ...(c.apiKey ? { authorization: 'Bearer ' + c.apiKey } : {}) },
      body: JSON.stringify({ model: need(c.model, '模型'), voice: need(c.voice, '音色'), input: text, response_format: 'mp3' }) };
    if (eng === 'fish') return { url: 'https://api.fish.audio/v1/tts', ck,
      headers: { ...json, authorization: 'Bearer ' + need(c.apiKey, 'API Key'), model: c.model || 's1' },
      body: JSON.stringify({ text, reference_id: need(c.voice, '音色 ID'), format: 'mp3', latency: 'normal' }) };
    if (eng === 'elevenlabs') return { url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(need(c.voice, 'Voice ID'))}?output_format=mp3_44100_128`, ck,
      headers: { ...json, 'xi-api-key': need(c.apiKey, 'API Key') },
      body: JSON.stringify({ text, model_id: c.model || 'eleven_multilingual_v2' }) };
    if (eng === 'azure') {
      const voice = need(c.voice, '音色'), lang = (voice.match(/^[a-z]{2,3}-[A-Z]{2}/) || ['zh-CN'])[0];
      const esc = s => s.replace(/[<>&'"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));
      return { url: `https://${encodeURIComponent(need(c.region, '区域'))}.tts.speech.microsoft.com/cognitiveservices/v1`, ck,
        headers: { 'content-type': 'application/ssml+xml', 'ocp-apim-subscription-key': need(c.apiKey, '密钥'), 'x-microsoft-outputformat': 'audio-24khz-48kbitrate-mono-mp3' },
        body: `<speak version="1.0" xml:lang="${lang}"><voice name="${esc(voice)}">${esc(text)}</voice></speak>` };
    }
    if (eng === 'gsv') return { url: need(base(c.url), '接口地址') + '/tts', ck, headers: json,
      body: JSON.stringify({ text, text_lang: c.lang === 'ja' ? 'ja' : 'auto', ref_audio_path: need(c.refAudio, '参考音频'), prompt_text: c.promptText || '',
        prompt_lang: c.promptLang || 'ja', text_split_method: 'cut5', batch_size: 1, media_type: 'wav', streaming_mode: false }) };
    throw new Error('未知的语音引擎：' + eng);
  },

  audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain(); this.an = this.ctx.createAnalyser(); this.an.fftSize = 1024;
      this.gain.connect(this.an); this.an.connect(this.ctx.destination);
    }
    return this.ctx;
  },
  decode(bytes) {
    const ab = bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return this.audio().decodeAudioData(ab);
  },
  play(buf) {
    const ctx = this.audio(); if (ctx.state === 'suspended') ctx.resume();
    this.stop();
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(this.gain);
    this.gain.gain.value = Math.max(0, Math.min(1, +this.cfg().volume || 0));
    src.onended = () => { if (this.src === src) { this.src = null; this.playing = false; } };
    src.start(); this.src = src; this.playing = true;
    // the bubble stays up while she is still talking
    if (!bubble.classList.contains('hidden')) bubbleHide = Math.max(bubbleHide, S.t + buf.duration + 0.8);
  },
  stop() {
    if (this.src) { const s = this.src; this.src = null; s.onended = null; try { s.stop(); } catch (_) {} }
    this.playing = false;
  },
  // loudness of what is playing, 0..1, for the mouth
  meter() {
    if (!this.playing || !this.an) return 0;
    const a = this.tmp || (this.tmp = new Float32Array(this.an.fftSize));
    this.an.getFloatTimeDomainData(a);
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.min(1, Math.sqrt(s / a.length) * 5.5);
  },
  fail(e) {
    console.warn('voice failed', e);
    if (performance.now() - this.errAt > 30000 && typeof toast === 'function') { this.errAt = performance.now(); toast('语音合成失败：' + e.message, 4000, 'pout'); }
    return null;
  },

  // settings dialog: speak a test line with the settings being edited
  async test(text = '你好，我是千绘莉。今天也要好好努力哦。') {
    ++this.seq; this.stop();
    const buf = await this.make(text, { kind: 'chat' });
    if (!buf) throw new Error('这句没有可以朗读的内容');
    this.play(buf);
    return buf.duration;
  },
  // make the audio of every fixed line ahead of time (desktop: cached on disk), so reactions speak at once
  async pregen(progress) {
    const eng = this.engine(); if (eng === 'off') throw new Error('请先选择语音引擎');
    const all = [...new Set([...Object.values(LINES).flat(), ...Object.keys(VOICE_JA)])];
    let done = 0, failed = 0, lastErr = null; this.pregenStop = false;
    for (const t of all) {
      if (this.pregenStop) break;
      try { const w = this.wantsJa() ? await this.toJa(t) : this.spoken(t); if (w) await this.synth(eng, w, { batch: true }); }
      catch (e) { failed++; lastErr = e; if (failed >= 3 && failed === done + 1) throw e; }
      progress(++done, all.length, failed);
    }
    return { done, failed, total: all.length, lastErr };
  },
};
