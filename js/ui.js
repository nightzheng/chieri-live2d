'use strict';
// ============================================================================
//  Chrome around the character: chat window, settings dialog, toasts, and the
//  desktop-pet window behaviour (hover bar, click-through on empty pixels).
// ============================================================================
const DESKTOP = !!window.petAPI;
if (DESKTOP) document.documentElement.classList.add('desktop');

let toastTimer = 0;
// mood: a sticker of her beside the message (happy / pout / think / shy, img/st_*.png)
function toast(msg, ms = 2600, mood = '') {
  const t = $('#toast'); t.lastElementChild.textContent = msg; t.classList.toggle('mood', !!mood);
  if (mood) t.firstElementChild.src = `img/st_${mood}.png`;
  t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

// stage background: the café by day / at night (auto follows the clock) or the plain gradient
function applyBg() {
  const m = Store.data.bg || 'auto', h = new Date().getHours(), k = m === 'auto' ? (h >= 6 && h < 18 ? 'day' : 'night') : m;
  for (const c of ['day', 'night', 'plain']) document.documentElement.classList.toggle('bg-' + c, c === k);
  document.querySelectorAll('#bgBtns button').forEach(b => b.classList.toggle('on', b.dataset.bg === m));
}

// ---------------------------------------------------------------- chat
const Chat = {
  log: [],
  open(show = true) {
    $('#chat').classList.toggle('hidden', !show);
    $('#btnChat').classList.toggle('on', show);
    if (show) { setTimeout(() => $('#chatInput').focus(), 30); this.scroll(); }
    petSide(); resize();
  },
  toggle() { this.open($('#chat').classList.contains('hidden')); },
  add(who, text, save = true) {
    const el = document.createElement('div'); el.className = 'msg ' + who; el.textContent = text;
    $('#msgs').append(el); this.scroll();
    if (save && !DESKTOP && who !== 'sys') { this.log.push({ who, text }); this.log = this.log.slice(-60); try { localStorage.setItem('l2d.chat', JSON.stringify(this.log)); } catch (_) {} }
    return el;
  },
  // a sticker beside a short note, for the greeting and for errors (never saved); link: [text, onclick]
  card(mood, text, link) {
    const el = this.add('sys', '', false), img = new Image(), p = document.createElement('span');
    el.classList.add('card', mood); img.src = `img/st_${mood}.png`; img.alt = ''; p.textContent = text;
    if (link) { const a = document.createElement('a'); a.textContent = link[0]; a.onclick = link[1]; p.append(a); }
    el.append(img, p); this.scroll(); return el;
  },
  // her "thinking" sticker with typing dots, while the AI answers
  typing(on) {
    const old = $('#msgs .typing'); if (old) old.remove();
    if (!on) return;
    const el = document.createElement('div'); el.className = 'msg bot typing';
    el.innerHTML = '<img src="img/st_think.png" alt=""><span class="dots"><b></b><b></b><b></b></span>';
    $('#msgs').append(el); this.scroll();
  },
  scroll() { const m = $('#msgs'); m.scrollTop = m.scrollHeight; },
  status(text, busy) { const s = $('#chatStatus'); s.textContent = text; s.classList.toggle('busy', !!busy); },
  async reload() {
    $('#msgs').replaceChildren();
    await this.restore();
  },
  async restore() {
    let legacy;
    try {
      const value = JSON.parse(localStorage.getItem('l2d.chat') || '[]');
      if (Array.isArray(value)) legacy = value;
    } catch (_) {}
    this.log = (legacy || []).filter(row => ['user', 'bot'].includes(row?.who) && typeof row.text === 'string');
    if (DESKTOP) {
      try {
        if (legacy) await window.petAPI.memory('legacy', legacy);
        else this.card('pout', '旧聊天格式无法读取，原记录仍保留。');
        this.log = (await window.petAPI.memory('history')).reverse();
      } catch (e) {
        this.card('pout', '聊天数据库暂不可用。可在记忆与数据设置中重试或恢复。');
      }
    }
    for (const m of this.log) this.add(m.who, m.text, false);
    // the model gets the recent conversation back as context
    AI.history = this.log.slice(-16).map(m => ({ id: m.id, role: m.who === 'user' ? 'user' : 'assistant',
      content: m.who === 'user' ? m.text : JSON.stringify({ reply: m.text }) }));
    if (!this.log.length) this.hello();
  },
  hello() {
    if (AI.ready()) this.card('happy', `已连接 ${AI_PRESETS[Store.data.preset] ? AI_PRESETS[Store.data.preset].label : 'AI'} · ${Store.data.model}`);
    else this.card('happy', '还没有配置 AI，她只会说固定台词。', ['去设置', () => Settings.open()]);
  },
  async persist(who, text, conversation) {
    if (!DESKTOP) return;
    try { return await window.petAPI.memory('append', { who, text, conversation }); }
    catch (_) { this.card('pout', '上一条消息未写入聊天数据库。'); }
  },
  async send(text) {
    text = text.trim();
    if (!text || this.sending) return;
    this.sending = true;
    const button = $('#chatForm button[type=submit]');
    button.disabled = true;
    try { await this.respond(text); }
    finally { this.sending = false; button.disabled = false; }
  },
  async respond(text) {
    if (DESKTOP) {
      CompanionUI.activity('chat');
      const feedback = await CompanionUI.call('command', text).catch(() => null);
      if (feedback) { this.card('happy', feedback); return; }
    }
    if (DESKTOP && VisionUI.handleChat(text)) return;
    const conversation = DESKTOP ? crypto.randomUUID() : null;
    touch(); this.add('user', text);
    const messageId = await this.persist('user', text, conversation);
    if (DESKTOP) {
      try {
        const reminder = await CompanionUI.call('schedule', text);
        if (reminder) {
          if (reminder === 'saved') this.card('happy', '提醒已保存。', ['查看提醒', () => CompanionUI.showAgenda()]);
          return;
        }
      } catch (e) {
        this.card('pout', e.message.includes('提醒时间已过') ? '提醒时间已过，请选择未来时间。' :
          '保存提醒失败。请在「提醒与日程」检查时间和数据库。');
        return;
      }
      await MemoryUI.remember(text);
    }
    S.look = { x: PET ? 0 : -0.35, y: 0.5, until: S.t + 2 };
    if (!Store.data.aiChat || !AI.ready()) {
      const r = localReply(text);
      await new Promise(resolve => setTimeout(resolve, 350));
      say(r.reply, r.emotion, null, { kind: 'chat', ja: r.ja });
      this.add('bot', r.reply);
      await this.persist('bot', r.reply, conversation);
      return;
    }
    const id = ++AI.seq; AI.lastAt = S.t;
    setFace('curious', 30); twitchEars(); think(); this.status('正在输入…', true); this.typing(true);
    try {
      const o = await AI.ask(text, aiState(), { remember: true, timeout: 45000, messageId });
      // with a voice the reply waits (a little) for its audio, so words and voice start together
      if (id === AI.seq) await Voice.prepare(o.reply, { ja: o.ja, kind: 'chat' }, 10000);
      this.typing(false); this.add('bot', o.reply);
      await this.persist('bot', o.reply, conversation);
      if (id === AI.seq) applyAI(o, 'smile', null, true); else please(Math.max(0, o.affection) * 0.5);
    } catch (e) {
      this.typing(false); this.card('pout', 'AI 请求失败：' + e.message);
      if (Store.data.bubbleOnly) toast('AI 请求失败：' + e.message, 4000, 'pout');
      if (id === AI.seq) say('唔…刚刚没听清，能再说一遍吗？', 'troubled', 2.5);
    } finally { this.typing(false); this.status('在线'); }
  },
  async clear() {
    if (this.sending) return toast('请等待当前对话结束');
    if (!window.confirm('清除全部聊天记录？长期记忆保留。')) return;
    if (DESKTOP) {
      this.sending = true;
      try { await window.petAPI.memory('clearHistory'); }
      catch (_) { return toast('清除失败，请检查记忆数据库状态'); }
      finally { this.sending = false; }
    }
    this.log = []; AI.history = []; $('#msgs').innerHTML = '';
    try { localStorage.removeItem('l2d.chat'); } catch (_) {}
    this.hello();
  },
};

// without an AI configured: a few keyword answers, otherwise a gentle shrug
function localReply(text) {
  const R = [
    [/你好|hi|hello|嗨|在吗/i, ['你好呀～', '在的在的！'], 'smile'],
    [/可爱|喜欢|爱你|好看|漂亮/, ['才、才没有很开心呢！', '嘿嘿…被夸了♪'], 'shy'],
    [/笨|讨厌|丑|烦/, ['哼！不理你了！', '…你才笨呢。'], 'pout'],
    [/摸|抱|蹭/, ['嗯…可以哦，就一下下。', '呼噜呼噜…'], 'enjoy'],
    [/吃|饿|饭/, ['说起来…肚子有点饿了。', '想吃小鱼干！'], 'happy'],
    [/睡|困|晚安/, ['哈啊～…晚安。', '一起打个盹吧…'], 'sleepy'],
    [/名字|你是谁/, [`我是${Store.data.name}哦～`], 'smile', `${Voice.jaName()}です～`],
  ];
  for (const [re, lines, emotion, ja] of R) if (re.test(text)) return { reply: pick(lines), emotion, ja };
  return { reply: pick(['嗯嗯，然后呢？', '诶？是这样吗～', '唔…听不太懂，但是我在听哦！', '嗯？']), emotion: pick(['curious', 'smile', 'gentle']) };
}

// ---------------------------------------------------------------- settings
const Settings = {
  baseline: {},
  loading: false,
  saving: false,
  open() {
    if (!$('#settings').classList.contains('hidden')) return;
    const s = Store.data, sel = $('#sPreset');
    sel.innerHTML = Object.entries(AI_PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
    sel.value = AI_PRESETS[s.preset] ? s.preset : 'custom';
    $('#sBase').value = s.baseUrl; $('#sKey').value = s.apiKey; $('#sModel').value = s.model;
    this.maskKey($('#sKey'), $('#sKeyShow'));
    $('#sName').value = s.name; $('#sPersona').value = s.persona;
    $('#sAiChat').checked = s.aiChat; $('#sAiReact').checked = s.aiReact; $('#sBubbleOnly').checked = !!s.bubbleOnly; $('#sSleep').value = String(s.sleepAfter);
    $('#sLevel').value = s.pet.level; $('#sScale').value = s.pet.scale; $('#sClick').checked = s.pet.clickThrough; $('#sStartPet').checked = !!s.pet.startAsPet;
    $('#sScaleOut').textContent = Math.round(s.pet.scale * 100) + '%';
    $('#sAmbient').value = String([0, 1, 5, 15, 30].includes(s.ambientMinutes) ? s.ambientMinutes : 5);
    $('#sTestOut').textContent = ''; $('#sTestOut').className = '';
    VoiceUI.open();
    this.note(); $('#settings').classList.remove('hidden'); petSide(); this.markSection();
    this.baseline = {};
    this.capture('regular');
    if (DESKTOP) {
      this.loading = $('#sSave').disabled = $('#settings .body').inert = true;
      Promise.allSettled([this.autoStart(), MemoryUI.open(), CompanionUI.open(), VisionUI.open()]).then(() => {
        for (const key of ['startup', 'memory', 'proactive', 'vision']) this.capture(key);
        this.loading = $('#sSave').disabled = $('#settings .body').inert = false;
      });
    }
  },
  maskKey(input, button, visible = false) {
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? '隐藏' : '显示';
    button.setAttribute('aria-pressed', String(visible));
  },
  feedback(selector, message = '', tone = '') {
    const node = $(selector);
    node.classList.add('action-status');
    node.dataset.tone = tone;
    node.textContent = message ? (tone === 'ok' ? '成功 · ' : tone === 'error' ? '异常 · ' : '') + message : '';
  },
  value(key) {
    if (key === 'regular') return this.read();
    if (key === 'startup') return $('#sAutoStart').checked;
    if (key === 'memory') return MemoryUI.readOptions();
    if (key === 'proactive') return CompanionUI.readOptions();
    return VisionUI.readOptions();
  },
  capture(key) { this.baseline[key] = JSON.stringify(this.value(key)); },
  changed(key) {
    return Object.hasOwn(this.baseline, key) && this.baseline[key] !== JSON.stringify(this.value(key));
  },
  goTo(section) {
    const body = $('#settings .body'), target = document.getElementById(section);
    body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 4;
    this.markSection();
  },
  markSection() {
    if (!DESKTOP || $('#settings').classList.contains('hidden')) return;
    const body = $('#settings .body'), viewport = body.getBoundingClientRect(), edge = viewport.top + 16;
    const buttons = [...document.querySelectorAll('#settings [data-section]')];
    const last = document.getElementById(buttons.at(-1).dataset.section).getBoundingClientRect();
    const atBottom = body.scrollTop > 2 && last.top > edge && last.top < viewport.bottom &&
      Math.abs(body.scrollHeight - body.scrollTop - body.clientHeight) < 2;
    const active = (body.scrollTop <= 2 ? buttons[0] : atBottom ? buttons.at(-1) : buttons.findLast(btn => {
      const rect = document.getElementById(btn.dataset.section).getBoundingClientRect();
      return rect.height && rect.top <= edge;
    })) || buttons[0];
    for (const btn of buttons) {
      if (btn === active) btn.setAttribute('aria-current', 'location');
      else btn.removeAttribute('aria-current');
    }
  },
  // the login item as Windows has it; {on} counts only when Task Manager hasn't turned it off
  auto: null,
  async autoStart() {
    const box = $('#sAutoStart'), note = $('#sAutoNote');
    this.auto = null; box.disabled = true; note.classList.add('hidden');
    try {
      const a = await window.petAPI.autoStart();
      this.auto = { on: a.on && !a.blocked }; box.checked = this.auto.on; box.disabled = false;
      note.textContent = a.blocked ? '已在 Windows 的「启动应用」（任务管理器）里被关掉了。勾上并保存会重新打开。'
        : a.dev ? '开发模式：只在这次运行里记住，不写入系统。' : '';
      note.classList.toggle('hidden', !note.textContent);
    } catch (e) { box.checked = false; note.textContent = '读取开机启动设置失败：' + e.message; note.classList.remove('hidden'); }
  },
  close(saved = false) {
    if ($('#settings').classList.contains('hidden') || this.loading || (this.saving && !saved)) return;
    if (!saved && Object.keys(this.baseline).some(key => this.changed(key)) &&
        !window.confirm('还有未保存的设置，放弃修改并关闭？')) return;
    if (DESKTOP && VisionUI.token) VisionUI.stop();
    $('#settings').classList.add('hidden'); petSide();
    this.baseline = {};
    if (DESKTOP) {
      $('#visKey').value = VisionUI.revealedKey = '';
      this.maskKey($('#visKey'), $('#visKeyShow'));
    }
  },
  note() {
    const k = $('#sPreset').value, p = AI_PRESETS[k];
    $('#sNote').textContent = k === 'ollama' ? '本地 Ollama 不需要 API Key，请先运行 ollama serve 并拉取模型。'
      : p.kind === 'anthropic' ? '使用 Anthropic Messages API（x-api-key）。'
      : DESKTOP ? '兼容 OpenAI /chat/completions 格式的服务都可以使用。' : '浏览器中直接请求可能被服务商的跨域策略拦截；桌面版没有这个限制。';
  },
  read() {
    const k = $('#sPreset').value;
    return {
      preset: k, kind: AI_PRESETS[k].kind, baseUrl: $('#sBase').value.trim(), apiKey: $('#sKey').value.trim(), model: $('#sModel').value.trim(),
      name: $('#sName').value.trim() || '千绘莉', persona: $('#sPersona').value.trim() || DEFAULT_PERSONA,
      aiChat: $('#sAiChat').checked, aiReact: $('#sAiReact').checked, bubbleOnly: $('#sBubbleOnly').checked, sleepAfter: +$('#sSleep').value,
      ambientMinutes: +$('#sAmbient').value,
      pet: { level: $('#sLevel').value, scale: +$('#sScale').value, clickThrough: $('#sClick').checked, startAsPet: $('#sStartPet').checked },
      tts: VoiceUI.read(),
    };
  },
  async save() {
    if (this.loading || this.saving) return;
    this.saving = $('#sSave').disabled = $('#settings .body').inert = true;
    const was = Voice.engine(), chieri = JSON.stringify(Store.data.tts.chieri);
    const actions = {
      vision: ['视觉', value => VisionUI.saveOptions(value)],
      proactive: ['主动互动', value => CompanionUI.saveOptions(value)],
      memory: ['记忆与数据', value => MemoryUI.request('options', value)],
      regular: ['常规', async value => {
        await Store.save(value, true);
        applyNames();
        if (DESKTOP && Voice.engine() === 'chieri' && (was !== 'chieri' || chieri !== JSON.stringify(Store.data.tts.chieri))) {
          window.petAPI.chieriStart({ restart: was === 'chieri' });
        }
      }],
      startup: ['开机自启', value => window.petAPI.autoStart(value)],
    };
    let label = '';
    try {
      for (const [key, [name, action]] of Object.entries(actions)) {
        if (!this.changed(key)) continue;
        label = name;
        await action(this.value(key));
        this.capture(key);
      }
      this.close(true);
      toast('设置已保存', 2600, 'happy');
    } catch (e) {
      toast(label + '设置保存失败，未保存的修改仍在表单中。' + e.message, 6500, 'pout');
    } finally {
      this.saving = $('#sSave').disabled = $('#settings .body').inert = false;
    }
  },
  async test() {
    const out = $('#sTestOut'), prev = Store.data;
    out.textContent = '连接中…'; out.className = '';
    Store.data = { ...prev, ...this.read() };
    try {
      const o = await AI.ask('[测试] 用一句话向对方打个招呼。', aiState(), { remember: false, timeout: 30000 });
      out.textContent = '成功：' + o.reply; out.className = 'ok';
    } catch (e) { out.textContent = '失败：' + e.message; out.className = 'bad'; }
    finally { Store.data = prev; }
  },
};

// ---------------------------------------------------------------- voice settings
// Edits a draft of Store.data.tts; each engine's own fields come from TTS_ENGINES (voice.js).
const VoiceUI = {
  draft: null, eng: 'off',
  open() {
    const d = this.draft = JSON.parse(JSON.stringify(Store.data.tts));
    $('#vEngine').innerHTML = Object.entries(TTS_ENGINES).filter(([k]) => Voice.allowed(k)).map(([k, e]) => `<option value="${k}">${e.label}</option>`).join('');
    this.eng = Voice.allowed(d.engine) ? d.engine : 'off'; $('#vEngine').value = this.eng;
    $('#vVol').value = d.volume; $('#vVolOut').textContent = Math.round(d.volume * 100) + '%';
    $('#vChat').checked = d.chat; $('#vReact').checked = d.react;
    $('#vPy').value = d.chieri.python || ''; $('#vDevice').value = d.chieri.device || 'auto';
    $('#vTestOut').textContent = ''; $('#vTestOut').className = '';
    if (!Voice.caps.setup) $('#vProg').classList.add('hidden');   // the last run's bar only while the dialog stays open
    this.render();
  },
  // the selected engine's fields
  render() {
    const e = TTS_ENGINES[this.eng], c = this.draft[this.eng] || {}, box = $('#vFields');
    box.innerHTML = (e.fields || []).map(([k, label, ph, type]) => Array.isArray(ph)
      ? `<label class="f"><span>${label}</span><select data-vk="${k}">${ph.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`
      : type === 'password'
        ? `<label class="f"><span>${label}</span><span class="pw"><input data-vk="${k}" type="password" placeholder="${ph}" spellcheck="false" autocomplete="off"><button type="button" class="mini" data-show-key>显示</button></span></label>`
        : `<label class="f"><span>${label}</span><input data-vk="${k}" type="${type || 'text'}" placeholder="${ph}" spellcheck="false" autocomplete="off"></label>`).join('');
    box.querySelectorAll('[data-vk]').forEach(el => { el.value = c[el.dataset.vk] != null ? c[el.dataset.vk] : ''; });
    box.querySelectorAll('[data-show-key]').forEach(button => {
      const input = button.previousElementSibling;
      button.onclick = () => Settings.maskKey(input, button, input.type === 'password');
    });
    const preset = box.querySelector('[data-vk=preset]');
    if (preset) preset.onchange = () => { const p = TTS_OPENAI_PRESETS[preset.value]; if (preset.value !== 'custom') for (const k of ['baseUrl', 'model', 'voice']) box.querySelector(`[data-vk=${k}]`).value = p[k]; };
    $('#vChieri').classList.toggle('hidden', this.eng !== 'chieri');
    const off = '选一个语音引擎，她说的话就会读出来。' + (Voice.caps.local ? '' : DESKTOP
      ? '这是在线版，只能用在线语音服务；千绘莉的本地声线模型在完整版里。' : '网页版只能用在线服务（可能被跨域策略拦截），本地模型请用桌面完整版。');
    $('#vNote').textContent = this.eng === 'off' ? off : e.note || '';
    if (this.eng === 'chieri') this.env();
  },
  // the dialog back into the draft
  pull() {
    const c = this.draft[this.eng];
    if (c) $('#vFields').querySelectorAll('[data-vk]').forEach(el => { c[el.dataset.vk] = el.value.trim(); });
    Object.assign(this.draft.chieri, { python: $('#vPy').value.trim(), device: $('#vDevice').value });
    Object.assign(this.draft, { engine: this.eng, volume: +$('#vVol').value, chat: $('#vChat').checked, react: $('#vReact').checked });
  },
  read() { if (!this.draft) return Store.data.tts; this.pull(); return JSON.parse(JSON.stringify(this.draft)); },
  async env() { if (DESKTOP) { Object.assign(Voice.caps, await window.petAPI.ttsInfo()); this.state(); } },
  // local model: environment and server status (pushed by the shell while it changes)
  state() {
    if (!DESKTOP || !Voice.caps.local) return;
    const c = Voice.caps, s = c.server || {}, el = $('#vEnv');
    const env = c.setup ? '正在安装运行环境（装好之前本地声线用不了）…' : c.envReady ? '运行环境已就绪'
      : c.envPartial ? '运行环境上次没有装完：点「继续安装」' : '还没有运行环境：点「一键安装环境」，或填写已有 GPT-SoVITS 环境的 python.exe';
    // which weights the server loaded (short hashes; the label only when they match the package's records)
    const m = s.model, w = m ? ` · ${m.label ? m.label + ' ' : 'GPT '}${m.gpt}${m.verified === false ? '，和模型包记录的不一致' : ''}` : '';
    const run = { starting: ' · 正在加载模型…', ready: ` · 模型已加载（${s.device === 'cuda' ? 'NVIDIA 显卡' : 'CPU'}${w}）`, error: ' · ' + (s.msg || '出错了') }[s.state] || '';
    el.textContent = env + run; el.className = s.state === 'error' ? 'bad' : s.state === 'ready' ? 'ok' : '';
    $('#vSetup').textContent = c.setup ? '取消安装' : c.envReady ? '重新安装环境' : c.envPartial ? '继续安装' : '一键安装环境';
    if (c.setup && c.progress) this.progress(c.progress);
  },
  // environment setup: one bar for all its steps (pushed by the shell; stripes while nothing measurable moves)
  progress(p) {
    const box = $('#vProg'), pct = Math.floor(p.pct || 0);
    box.classList.remove('hidden');
    box.classList.toggle('pulse', !!p.pulse);
    box.classList.toggle('ok', !!(p.done && p.ok)); box.classList.toggle('bad', !!(p.done && !p.ok));
    box.querySelector('.pbar i').style.width = Math.max(pct, 3) + '%';
    $('#vProgPct').textContent = p.done && !p.ok ? '未完成' : pct + '%';
    $('#vProgStep').textContent = p.done && p.ok ? '安装完成，运行环境已就绪' : !p.step ? p.title + '…'
      : `第 ${p.step} / ${p.steps} 步${p.done ? '没有完成' : ''} · ${p.title}`;
    $('#vProgText').textContent = p.detail || '';
  },
  log(line) {
    const el = $('#vLog'); el.classList.remove('hidden');
    el.textContent = (el.textContent + line + '\n').slice(-20000); el.scrollTop = el.scrollHeight;
  },
  async test() {
    const out = $('#vTestOut'), prev = Store.data.tts;
    out.textContent = '合成中…'; out.className = '';
    Store.data.tts = this.read();
    try { const d = await Voice.test(); out.textContent = `成功（${d.toFixed(1)} 秒）`; out.className = 'ok'; }
    catch (e) { out.textContent = '失败：' + e.message; out.className = 'bad'; }
    finally { Store.data.tts = prev; }
  },
  async pregen() {
    const out = $('#vPregenOut'), btn = $('#vPregen');
    if (Voice.pregenStop === false) { Voice.pregenStop = true; return; }
    if (Settings.changed('regular')) { out.textContent = '请先保存设置后再预生成。'; return; }
    btn.textContent = '停止'; out.className = '';
    try {
      const r = await Voice.pregen((n, all, failed) => { out.textContent = `${n} / ${all}${failed ? `（失败 ${failed}）` : ''}`; });
      const ok = r.done - r.failed, stopped = r.done < r.total;
      out.textContent = `${stopped ? '已停止' : '完成'}：${ok} 句已缓存${r.failed ? `，失败 ${r.failed} 句（${r.lastErr.message}）` : ''}`;
      if (!stopped) toast('固定台词的语音已经准备好了', 2600, 'happy');
    } catch (e) { out.textContent = '失败：' + e.message; out.className = 'bad'; }
    finally { btn.textContent = '预生成固定台词'; Voice.pregenStop = null; }
  },
  init() {
    $('#vEngine').onchange = () => { this.pull(); this.eng = $('#vEngine').value; this.render(); };
    $('#vVol').oninput = () => { $('#vVolOut').textContent = Math.round($('#vVol').value * 100) + '%'; };
    $('#vTest').onclick = () => this.test();
    $('#vPregen').onclick = () => this.pregen();
    if (!DESKTOP) return;
    window.petAPI.onTtsLog(l => this.log(l));
    window.petAPI.onTtsProgress(p => this.progress(p));
    $('#vSetup').onclick = async () => {
      if (Voice.caps.setup) { window.petAPI.chieriSetupCancel(); return; }
      $('#vLog').textContent = '';
      this.progress({ pct: 0, step: 0, title: '准备安装', detail: '', pulse: true });
      const r = await window.petAPI.chieriSetup({ mirror: $('#vMirror').checked, device: $('#vDevice').value });
      this.log(r.ok ? '✔ 安装完成' : '✘ ' + r.error); this.env();
      if (r.ok) toast('本地语音环境安装好了', 2600, 'happy');
      if (r.code === 'nopython' && confirm('没有找到 Python 3.12。要打开 Python 官网的下载页面吗？\n安装时请勾选「Add python.exe to PATH」，装好后再点一次「一键安装环境」。')) window.petAPI.pythonPage();
    };
    $('#vCheck').onclick = async () => {
      this.log('检测中…');
      const r = await window.petAPI.chieriCheck({ python: $('#vPy').value.trim() });
      this.log(!r.ok ? '✘ ' + r.error : `${r.exe}\nPython ${r.python} · torch ${r.torch || '未安装'} · ${r.cuda ? 'NVIDIA 显卡：' + r.gpu : '没有可用的 CUDA 显卡（会用 CPU，很慢）'}\n${r.missing.length ? '缺少：' + r.missing.join(', ') : '依赖齐全'}`);
    };
    $('#vStart').onclick = () => { this.pull(); window.petAPI.chieriStart({ restart: true, python: this.draft.chieri.python, device: this.draft.chieri.device }); };
    $('#vPyPick').onclick = async () => { const p = await window.petAPI.pickPython(); if (p) $('#vPy').value = p; };
  },
};

function applyNames() {
  const n = Store.data.name;
  $('#charName').textContent = n; $('#chatName').textContent = n; document.title = n;
  document.documentElement.classList.toggle('bubble-only', !!Store.data.bubbleOnly);
}

// ---------------------------------------------------------------- desktop pet window
// Chat and settings open in a strip the window grows for on the left, so they never cover her.
function petSide() {
  if (!PET) return;
  const on = ['#chat', '#settings', '#recHud'].some(s => !$(s).classList.contains('hidden'));
  if (on === document.documentElement.classList.contains('side')) return;
  document.documentElement.classList.toggle('side', on);
  if (DESKTOP) window.petAPI.side(on);
  resize();
}

// ---------------------------------------------------------------- recording mode
// F8 (or the panel switch / the desktop menu) turns it on; single keys then cue the shots listed
// on the cheat sheet (REC_ACTS in app.js plus the two below). On the desktop the shell also offers
// them as Ctrl+Alt+key, for when OBS or another window has the focus.
const REC_UI = {
  U: ['隐藏界面按钮', () => recSet({ clean: !Store.data.rec.clean })],
  H: ['隐藏这张快捷键表', () => recSet({ hud: !Store.data.rec.hud })],
};
function recSet(patch, save = true) {
  const r = Store.data.rec = { ...Store.data.rec, ...patch }, root = document.documentElement;
  Rec.on = r.on;
  if (!r.on) { Rec.ai = false; if (Rec.freeze) recThaw(); }
  root.classList.toggle('rec-clean', r.on && r.clean);
  $('#recHud').classList.toggle('hidden', !(r.on && r.hud));
  $('#optRec').checked = r.on;
  petSide(); resize();
  if (save) Store.save();
}
function recToggle() {
  recSet({ on: !Rec.on, hud: true });
  toast(Rec.on ? '录制模式已开启 · 按 H 收起快捷键表' : '录制模式已关闭');
}
function recKey(k) { const a = REC_ACTS[k] || REC_UI[k]; if (a && Rec.on && pose) a[1](); }
function initRec() {
  $('#recKeys').innerHTML = Object.entries({ ...REC_ACTS, ...REC_UI }).map(([k, [label]]) => `<kbd>${k}</kbd><span>${label}</span>`).join('');
  $('#optRec').onchange = () => { if ($('#optRec').checked !== Rec.on) recToggle(); };
  window.addEventListener('keydown', e => {
    if (e.key === 'F8') { e.preventDefault(); recToggle(); return; }
    if (!Rec.on || e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.isComposing) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    recKey(e.code.replace(/^(Digit|Key|Numpad)/, ''));
  });
  recSet({}, false);
}

// stepless size: drag the frame's corner, scroll the wheel, or step with +/-
const Sizer = {
  on(v) {
    if (v) { Chat.open(false); Settings.close(); }
    document.documentElement.classList.toggle('resizing', v); this.show();
  },
  show() { $('#sizerVal').textContent = Math.round(Store.data.pet.scale * 100) + '%'; },
  set(k) {
    k = Math.round(Math.min(2.5, Math.max(0.4, k)) * 100) / 100;
    if (k === Store.data.pet.scale) return;
    Store.data.pet.scale = k; window.petAPI.setScale(k); this.show();
  },
};

// Transparent pixels let clicks through to the desktop; anything she or the UI covers catches them.
function initPet() {
  let ignoring = null, hoverT = 0;
  const root = document.documentElement, bar = $('#petbar'), dot = $('#petdot');
  const overUI = el => el && el.closest && el.closest('#chat, #settings, #bubble, #visionIndicator');
  const setIgnore = v => { if (v !== ignoring) { ignoring = v; window.petAPI.setIgnoreMouse(v); } };
  // the menu opens only with the mouse on it: on the dot while collapsed, on the bar once open
  const over = (el, m, x, y) => { const r = el.getBoundingClientRect(); return x > r.left - m && x < r.right + m && y > r.top - m && y < r.bottom + m; };
  window.addEventListener('mousemove', e => {
    const x = e.clientX, y = e.clientY, [sx, sy] = toSprite(x, y);
    const hot = !!S.carry || (root.classList.contains('menu') ? over(bar, 4, x, y) : over(dot, 2, x, y));
    const onChar = !!(pose && hitTest(sx, sy)), ui = overUI(e.target), sizing = root.classList.contains('resizing');
    root.classList.toggle('menu', hot && !sizing);
    if (onChar || ui || hot) { root.classList.add('hover'); clearTimeout(hoverT); hoverT = setTimeout(() => root.classList.remove('hover'), 1800); }
    setIgnore(!(onChar || ui || hot || sizing || S.drag || !$('#settings').classList.contains('hidden')));
  });
  document.addEventListener('mouseleave', () => { if (!S.carry) root.classList.remove('menu'); if (!S.drag) setIgnore(true); });
  // holding the menu bar (anywhere but on a button) carries her around
  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    try { bar.setPointerCapture(e.pointerId); } catch (_) {}
    onDown({ type: 'grip' }, 0, 0, e); startCarry();
  });
  bar.addEventListener('pointerup', () => { if (S.carry) onUp(); });
  bar.addEventListener('pointercancel', () => { if (S.carry) onUp(); });
  // resizing
  const handle = $('#sizer .handle');
  handle.addEventListener('pointerdown', e => {
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    const k0 = Store.data.pet.scale, h0 = innerHeight, x0 = e.screenX, y0 = e.screenY;
    // the window keeps its bottom-right corner, so pulling this corner up/left makes her bigger
    const mv = ev => Sizer.set(k0 * (1 - ((ev.screenY - y0) + (ev.screenX - x0) * 0.6) / (h0 * 1.3)));
    const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
  });
  document.querySelectorAll('#sizer [data-k]').forEach(b => b.onclick = () => Sizer.set(Store.data.pet.scale * (+b.dataset.k > 0 ? 1.05 : 1 / 1.05)));
  $('#sizerDone').onclick = () => Sizer.on(false);
  // Ctrl + wheel over her (or just the wheel while resizing) scales her smoothly
  window.addEventListener('wheel', e => {
    if (!root.classList.contains('resizing') && !(e.ctrlKey && !overUI(e.target))) return;
    e.preventDefault(); Sizer.set(Store.data.pet.scale * Math.exp(-e.deltaY * 0.0012));
  }, { passive: false });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') Sizer.on(false); });
  $('#petSize').onclick = () => Sizer.on(true);
  $('#petChat').onclick = () => Chat.toggle();
  $('#petSettings').onclick = () => Settings.open();
  $('#petHome').onclick = () => window.petAPI.toStudio();
  $('#petMore').onclick = () => window.petAPI.showMenu();
  window.addEventListener('contextmenu', e => { e.preventDefault(); window.petAPI.showMenu(); });
}

function initUI() {
  applyNames(); applyBg(); setInterval(applyBg, 60000);
  document.querySelectorAll('#bgBtns button').forEach(b => b.onclick = () => { Store.save({ bg: b.dataset.bg }); applyBg(); });
  $('#btnChat').onclick = () => Chat.toggle();
  $('#chatClose').onclick = () => Chat.open(false);
  $('#chatClear').onclick = () => Chat.clear();
  $('#chatHide').onclick = () => Chat.open(false);
  $('#btnSettings').onclick = () => Settings.open();
  $('#btnPet').onclick = () => window.petAPI && window.petAPI.toPet();
  const inp = $('#chatInput');
  $('#chatForm').onsubmit = e => { e.preventDefault(); if (Chat.sending) return; const v = inp.value; inp.value = ''; inp.style.height = ''; Chat.send(v); };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chatForm').requestSubmit(); }
    if (e.key === 'Escape' && !e.isComposing) Chat.open(false);
  });
  inp.addEventListener('input', () => { inp.style.height = ''; inp.style.height = Math.min(96, inp.scrollHeight) + 'px'; });
  document.querySelectorAll('#settings [data-close]').forEach(b => b.onclick = () => Settings.close());
  document.querySelectorAll('#settings [data-section]').forEach(b => b.onclick = () => {
    Settings.goTo(b.dataset.section);
  });
  $('#settings .body').addEventListener('scroll', () => Settings.markSection(), { passive: true });
  $('#settings').addEventListener('pointerdown', e => { if (e.target.id === 'settings') Settings.close(); });
  $('#sSave').onclick = () => Settings.save();
  $('#sTest').onclick = () => Settings.test();
  $('#sKeyShow').onclick = () => Settings.maskKey($('#sKey'), $('#sKeyShow'), $('#sKey').type === 'password');
  $('#sPreset').onchange = () => { const p = AI_PRESETS[$('#sPreset').value]; if (p.baseUrl || $('#sPreset').value !== 'custom') { $('#sBase').value = p.baseUrl; $('#sModel').value = p.model; } Settings.note(); };
  $('#sScale').oninput = () => {
    $('#sScaleOut').textContent = Math.round($('#sScale').value * 100) + '%';
  };
  window.addEventListener('keydown', e => { if (e.key === 'Escape') Settings.close(); });
  VoiceUI.init();
  MemoryUI.init();
  CompanionUI.init();
  VisionUI.init();
  Chat.sending = true;
  Chat.restore().finally(() => { Chat.sending = false; });
  initRec();
  if (DESKTOP) {
    window.petAPI.onHistoryChanged(async () => {
      while (Chat.sending) await new Promise(resolve => setTimeout(resolve, 100));
      await Chat.reload();
    });
    window.petAPI.onSettings(async () => { await Store.load(); applyNames(); applyBg(); if (PET) Sizer.show(); });
    window.petAPI.onCmd(c => {
      if (c === 'chat') Chat.open(true); if (c === 'settings') Settings.open(); if (c === 'resize' && PET) Sizer.on(true);
      if (c === 'rec') recToggle(); if (c.startsWith('key:')) recKey(c.slice(4));
    });
    if (PET) initPet();
  }
}
