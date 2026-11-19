'use strict';

const CompanionUI = {
  id: null,
  editingEnabled: true,
  timezone: '',
  polling: false,
  talking: false,
  queued: null,
  activityAt: 0,
  lastLine: '',
  call(op, value) { return window.petAPI.companion(op, value); },
  async task(status, fn) {
    Settings.feedback(status);
    try { await fn(); }
    catch (e) { Settings.feedback(status, e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), 'error'); }
  },
  showAgenda() {
    Settings.open();
    $('#aEventsBox').open = true;
    Settings.goTo('agendaSettings');
  },
  async open() {
    await Promise.all([
      this.task('#aFeedback', () => this.refresh()),
      this.task('#pFeedback', () => this.loadOptions()),
      this.task('#aFeedback', () => this.loadWellness()),
    ]);
  },
  async refresh() {
    const { reminders, events, timezone } = await this.call('list');
    this.timezone = timezone;
    this.labelWellness();
    const zones = [...new Set([timezone, 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'UTC', ...Intl.supportedValuesOf('timeZone')])];
    const zone = $('#aZone');
    if (!zone.options.length) {
      zone.replaceChildren(...zones.map(value => new Option(value === timezone ? '本机 · ' + value : value, value)));
      this.edit();
    }
    const format = (at, zone = timezone) => new Intl.DateTimeFormat(I18n.locale, {
      timeZone: zone, dateStyle: 'medium', timeStyle: 'short',
    }).format(at);
    $('#aList').replaceChildren(...reminders.map(row => MemoryUI.row(row.title, [
      I18n.text(row.enabled ? '启用' : '已暂停 / 完成'), row.timezone,
      row.next_fire_at ? format(row.next_fire_at, row.timezone) : row.day + ' ' + row.time,
    ].join(' · '), [
      MemoryUI.button('编辑', () => this.edit(row)),
      MemoryUI.button(row.enabled ? '暂停' : '启用', () => this.change('toggle', { id: row.id, enabled: !row.enabled })),
      MemoryUI.button('删除', () => { if (window.confirm('删除这项提醒和它的执行记录？')) this.change('remove', row.id); }),
    ])));
    $('#aEvents').replaceChildren(...events.map(row => MemoryUI.row(row.title + (row.content && row.content !== row.title ? '\n' + row.content : ''),
      I18n.text(({ ready: '待显示', missed: '错过', shown: '待完成', scheduled: '稍后提醒' })[row.state]) + ' · ' + format(row.at), [
        ...(row.state === 'missed' ? [MemoryUI.button('补发', () => this.change('event', { id: row.id, action: 'replay' }))] : []),
        ...(row.state !== 'scheduled' ? [MemoryUI.button('10 分钟后提醒', () => this.change('event', { id: row.id, action: 'snooze' }))] : []),
        MemoryUI.button('完成', () => this.change('event', { id: row.id, action: 'done' })),
        MemoryUI.button('跳过', () => this.change('event', { id: row.id, action: 'skip' })),
      ])));
    if (!reminders.length) $('#aList').textContent = I18n.text('暂无提醒');
    if (!events.length) $('#aEvents').textContent = I18n.text('没有待处理的提醒');
  },
  change(op, value) { return this.task('#aFeedback', async () => { await this.call(op, value); await this.refresh(); }); },
  edit(row) {
    if (row?.timezone && !Array.from($('#aZone').options).some(option => option.value === row.timezone)) {
      $('#aZone').add(new Option(row.timezone, row.timezone));
    }
    this.id = row?.id ?? null;
    this.editingEnabled = row ? !!row.enabled : true;
    const local = new Date(Date.now() + 60000);
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    const stamp = local.toISOString();
    for (const [key, value] of Object.entries({
      Title: row?.title ?? '', Content: row?.content ?? '', Day: row?.day ?? stamp.slice(0, 10),
      Time: row?.time ?? stamp.slice(11, 16), Zone: row?.timezone ?? this.timezone,
      Repeat: !row?.weekdays ? 'once' : row.weekdays === 127 ? 'daily' : row.weekdays === 62 ? 'workdays' : 'custom',
    })) $('#a' + key).value = value;
    $('#aVoice').checked = row ? !!row.voice : true;
    $('#aNotify').checked = row ? !!row.notify : true;
    [...$('#aWeekdays').querySelectorAll('input')].forEach((box, i) => { box.checked = !!((row?.weekdays || 0) & (1 << i)); });
    $('#aRepeat').onchange();
    I18n.label($('#aSave'), row ? '保存修改' : '创建提醒');
    if (row) $('#aTitle').focus();
  },
  async save() {
    const day = $('#aDay').value, repeat = $('#aRepeat').value;
    const custom = [...$('#aWeekdays').querySelectorAll('input')].reduce((n, box, i) => n | (+box.checked << i), 0);
    if (repeat === 'custom' && !custom) throw new Error('至少选择一个星期几');
    const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
    const weekdays = { once: 0, daily: 127, weekly: 1 << weekday, workdays: 62, custom }[repeat];
    await this.call('save', { ...(this.id ? { id: this.id } : {}), title: $('#aTitle').value, content: $('#aContent').value,
      day, time: $('#aTime').value, timezone: $('#aZone').value, weekdays,
      voice: $('#aVoice').checked, notify: $('#aNotify').checked, enabled: this.editingEnabled });
    this.edit(); await this.refresh(); Settings.feedback('#aFeedback', '已保存提醒', 'ok');
  },
  async loadOptions() {
    const p = await this.call('options');
    for (const [key, value] of Object.entries({ Enabled: p.enabled, AI: p.ai, Memory: p.memory, Voice: p.voice, Adaptive: p.adaptive, Vision: p.vision })) $('#p' + key).checked = value;
    for (const [key, value] of Object.entries({ Frequency: p.frequency, Min: p.min, QuietFrom: p.quietFrom, QuietTo: p.quietTo,
      Limit: p.limit, Strength: p.strength, Manual: p.manual, VisionEvery: p.visionEvery })) {
      $('#p' + key).value = value;
    }
    $('#pFrequency').onchange();
    this.visionControls();
    await this.refreshState();
  },
  async refreshState() {
    const p = await this.call('status', { busy: this.busy(), recording: Rec.on });
    const label = I18n.text(p.state) + ' · ' + I18n.text(p.reason) +
      (p.lastSpoken ? I18n.pick(' · 上次主动发言 ', ' · Last proactive chat ') + new Date(p.lastSpoken).toLocaleString(I18n.locale) : '');
    if ($('#pState').textContent !== label) $('#pState').textContent = label;
  },
  readOptions() {
    return {
      enabled: $('#pEnabled').checked, ai: $('#pAI').checked, memory: $('#pMemory').checked, voice: $('#pVoice').checked,
      frequency: $('#pFrequency').value, min: +$('#pMin').value, limit: +$('#pLimit').value,
      quietFrom: $('#pQuietFrom').value, quietTo: $('#pQuietTo').value,
      adaptive: $('#pAdaptive').checked, strength: $('#pStrength').value, manual: $('#pManual').value,
      vision: $('#pVision').checked, visionEvery: +$('#pVisionEvery').value,
    };
  },
  visionControls() {
    $('#pVision').disabled = !$('#pEnabled').checked || !$('#pAI').checked;
    $('#pVisionEvery').disabled = $('#pVision').disabled || !$('#pVision').checked;
  },
  async saveOptions(options) {
    await this.call('configure', options);
    if (Voice.currentKind === 'proactive' && (!options.enabled || options.manual !== 'normal')) Voice.interrupt();
  },
  async loadWellness() {
    const value = await this.call('wellnessOptions');
    $('#wWater').value = value.water;
    $('#wStand').value = value.stand;
    $('#wNight').checked = value.night;
    $('#wNightAt').value = value.nightAt;
    $('#wVoice').checked = value.voice;
    $('#wNotify').checked = value.notify;
    $('#wNightAt').disabled = !value.night;
  },
  readWellness() {
    return { water: +$('#wWater').value, stand: +$('#wStand').value, night: $('#wNight').checked,
      nightAt: $('#wNightAt').value, voice: $('#wVoice').checked, notify: $('#wNotify').checked };
  },
  labelWellness() {
    for (const id of ['#wWater', '#wStand']) {
      const field = $(id), selected = field.value || '0';
      field.replaceChildren(...[0, 30, 45, 60, 90, 120].map(min => new Option(min
        ? I18n.pick(`${min} 分钟`, `${min} minutes`) : I18n.pick('关闭', 'Off'), String(min))));
      field.value = selected;
    }
    $('#wTimezone').textContent = I18n.pick('本机时区：', 'Device time zone: ') + (this.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  },
  lowPriorityVoice() { return ['proactive', 'ambient'].includes(Voice.currentKind); },
  activity(kind = 'touch') {
    if (this.lowPriorityVoice()) Voice.interrupt();
    if (S.anim?.ambient) S.anim = null;
    const now = Date.now();
    if (!window.petAPI || (kind !== 'chat' && now - this.activityAt < 1000)) return;
    this.activityAt = now;
    this.call('activity', kind).catch(() => {});
  },
  busy() {
    return Chat.sending || AI.interacting > 0 || Voice.pending > 0 || Voice.playing;
  },
  reminderBusy() {
    return Chat.sending || AI.interacting > 0 || (!this.lowPriorityVoice() && (Voice.pending > 0 || Voice.playing));
  },
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      if (this.queued && !this.reminderBusy()) { this.deliver(this.queued); this.queued = null; }
      const response = await this.call('poll', { busy: this.reminderBusy() || !!this.queued, recording: Rec.on || this.talking,
        proactiveBusy: this.busy() });
      if (response?.missed) toast(`错过了 ${response.missed} 条提醒，可在「提醒与日程」查看`, 5500);
      if (response?.reminder) this.queued = response.reminder;
      if (response?.wellness) this.deliverWellness(response.wellness);
      if (response?.proactive && !this.busy()) this.speak(response.proactive);
      if (!$('#settings').classList.contains('hidden')) await this.refreshState();
    } catch (_) {
      // The storage panel provides the error and recovery controls.
    } finally { this.polling = false; }
  },
  deliver(event) {
    if (this.lowPriorityVoice()) Voice.interrupt();
    if (S.anim?.ambient) S.anim = null;
    const words = I18n.pick('时间到了，记得' + event.title + '。', 'Reminder: ' + event.title);
    Chat.card('happy', words, ['查看提醒', () => this.showAgenda()]);
    say(words, 'smile', 5, { kind: 'reminder', voice: !!event.voice, ja: '時間ですよ。予定を確認してくださいね。' });
    if (!$('#settings').classList.contains('hidden')) this.task('#aFeedback', () => this.refresh());
  },
  deliverWellness({ kinds, voice }) {
    if (S.anim?.ambient) S.anim = null;
    const lines = {
      water: '喝口水吧，先歇一下。',
      stand: '要不要起身走几步，活动一下？',
      night: '时间不早了，有空就准备休息吧。',
    };
    const words = kinds.map(kind => I18n.text(lines[kind])).join(I18n.pick('', ' '));
    Chat.card('happy', words);
    say(words, 'gentle', 5, { kind: 'reminder', voice, ja: kinds.map(kind => VOICE_JA[lines[kind]]).join('') });
  },
  async speak(options) {
    this.talking = true;
    const startingActivity = this.activityAt;
    const { period } = localClock();
    const greeting = TIME_GREETINGS[period];
    const choices = [
      ['休息', '要不要伸个懒腰？我才没有在催你呢。', 'ちょっと伸びをしませんか？別に急かしてるわけじゃないです。'],
      ['话题', '我在这里陪你哦。有想聊的就说吧。', 'ここにいますよ。話したいことがあれば聞きます。'],
      ['问候', greeting, VOICE_JA[greeting]],
    ].filter(([category]) => category !== this.lastCategory);
    let [category, reply, ja] = pick(choices);
    let emotion = 'gentle', action = { 休息: 'swish', 话题: 'twitch', 问候: 'swish' }[category];
    try {
      if (options.ai && AI.ready()) {
        try {
          const out = AI.parse(await AI.complete(AI.systemPrompt(aiState()) +
            '\n这是主动打招呼。只说一句，避免重复上次主题。若附有本次授权的屏幕描述，可以自然提及其中的公开主题；否则以' + category + '为主题。不要猜测用户的情绪、健康或屏幕内容。',
          [{ role: 'user', content: '请在' + period + '和我轻松打个招呼。' }],
          { timeout: 15000, maxTokens: 240, proactive: options.ticket }));
          const unsupported = /(?:我|刚)(?:刚才|刚刚)?(?:看见|看到|看着|注意到你正在)|你(?:一定|肯定|明显|看起来)(?:很|有点)?(?:累|难过|疲惫|生病|不舒服)/;
          if (out.reply !== '……' && out.reply !== this.lastLine && !unsupported.test(out.reply)) {
            reply = out.reply.slice(0, 100);
            ja = out.ja || 'こんにちは。少しお話ししませんか？';
            emotion = out.emotion || emotion;
            if (['hop', 'swish', 'twitch', 'blush', 'hearts', 'notes'].includes(out.action)) action = out.action;
          }
        } catch (_) {}
      }
      const available = () => !this.busy() && !Rec.on && !this.queued && !S.drag && startingActivity === this.activityAt;
      if (!available() || !await this.call('canSpeak', options.ticket) || !available()) return;
      const opt = { kind: 'proactive', voice: options.voice, ja };
      const buffer = await Voice.prepareAnimation(reply, opt);
      if (!available() || !await this.call('canSpeak', options.ticket) || !available() ||
          !await this.call('spoken', options.ticket) || !available()) return;
      this.lastLine = reply;
      this.lastCategory = category;
      if (S.anim?.ambient) S.anim = null;
      say(reply, emotion, null, { ...opt, buffer, voice: !!buffer });
      doAction(action);
      await Chat.addProactive(I18n.fixed(reply));
    } catch (_) {} finally { this.talking = false; }
  },
  init() {
    if (!window.petAPI) return;
    this.labelWellness();
    $('#wNight').onchange = () => { $('#wNightAt').disabled = !$('#wNight').checked; };
    for (const day of '日一二三四五六') {
      const label = document.createElement('label'), box = document.createElement('input');
      box.type = 'checkbox'; label.append(box, ' 周' + day); $('#aWeekdays').append(label);
    }
    $('#aRepeat').onchange = () => $('#aWeekdays').classList.toggle('hidden', $('#aRepeat').value !== 'custom');
    $('#aSave').onclick = () => this.task('#aFeedback', () => this.save());
    $('#aCancel').onclick = () => this.edit();
    $('#aRefresh').onclick = () => this.task('#aFeedback', () => this.refresh());
    $('#aExport').onclick = () => this.task('#aFileFeedback', async () => {
      if (await this.call('exportFile')) Settings.feedback('#aFileFeedback', '提醒已导出到 JSON', 'ok');
    });
    $('#aImport').onclick = () => this.task('#aFileFeedback', async () => {
      const count = await this.call('importFile');
      if (count === null) return;
      Settings.feedback('#aFileFeedback', `已导入 ${count} 条提醒，导入项目为暂停状态`, 'ok');
      await this.refresh();
    });
    const updateFrequency = () => {
      const custom = $('#pFrequency').value === 'custom', min = +$('#pMin').value;
      $('#pMin').disabled = !custom;
      $('#pFrequencyHelp').textContent = custom && min >= 10 && min <= 1440
        ? I18n.pick(`主动闲聊通常每 ${min}–${min * 2} 分钟一次。安静时段、连续未回应或达到每日上限时可能更久。`,
          `Proactive chat usually runs every ${min}–${min * 2} minutes. Quiet hours, unanswered chats or the daily limit may delay it.`)
        : I18n.text('括号内是主动闲聊的基础间隔。安静时段、连续未回应或达到每日上限时可能更久。');
    };
    $('#pFrequency').onchange = $('#pMin').oninput = updateFrequency;
    $('#pEnabled').onchange = $('#pAI').onchange = $('#pVision').onchange = () => this.visionControls();
    // Only keep the time of input in Chieri. No keys or text are inspected or persisted.
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => this.activity(), true);
    window.petAPI.onAgenda(() => this.showAgenda());
    window.petAPI.onProactivePaused(() => {
      if (this.lowPriorityVoice()) Voice.interrupt();
      if (!$('#settings').classList.contains('hidden')) this.task('#pFeedback', () => this.refreshState());
    });
    setInterval(() => this.poll(), 2000);
  },
};
