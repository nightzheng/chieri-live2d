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
    $(status).textContent = '';
    try { await fn(); }
    catch (e) { $(status).textContent = e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
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
    ]);
  },
  async refresh() {
    const { reminders, events, timezone } = await this.call('list');
    this.timezone = timezone;
    if (!$('#aZone').value) this.edit();
    const format = (at, zone = timezone) => new Intl.DateTimeFormat(undefined, {
      timeZone: zone, dateStyle: 'medium', timeStyle: 'short',
    }).format(at);
    $('#aList').replaceChildren(...reminders.map(row => MemoryUI.row(row.title, [
      row.enabled ? '启用' : '已暂停 / 完成', row.timezone,
      row.next_fire_at ? format(row.next_fire_at, row.timezone) : row.day + ' ' + row.time,
    ].join(' · '), [
      MemoryUI.button('编辑', () => this.edit(row)),
      MemoryUI.button(row.enabled ? '暂停' : '启用', () => this.change('toggle', { id: row.id, enabled: !row.enabled })),
      MemoryUI.button('删除', () => { if (window.confirm('删除这项提醒和它的执行记录？')) this.change('remove', row.id); }),
    ])));
    $('#aEvents').replaceChildren(...events.map(row => MemoryUI.row(row.title + (row.content && row.content !== row.title ? '\n' + row.content : ''),
      ({ ready: '待显示', missed: '错过', shown: '待完成', scheduled: '稍后提醒' })[row.state] + ' · ' + format(row.at), [
        ...(row.state === 'missed' ? [MemoryUI.button('补发', () => this.change('event', { id: row.id, action: 'replay' }))] : []),
        ...(row.state !== 'scheduled' ? [MemoryUI.button('10 分钟后提醒', () => this.change('event', { id: row.id, action: 'snooze' }))] : []),
        MemoryUI.button('完成', () => this.change('event', { id: row.id, action: 'done' })),
        MemoryUI.button('跳过', () => this.change('event', { id: row.id, action: 'skip' })),
      ])));
    if (!reminders.length) $('#aList').textContent = '暂无提醒';
    if (!events.length) $('#aEvents').textContent = '没有待处理的提醒';
  },
  change(op, value) { return this.task('#aFeedback', async () => { await this.call(op, value); await this.refresh(); }); },
  edit(row) {
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
    $('#aSave').textContent = row ? '保存修改' : '创建提醒';
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
    this.edit(); await this.refresh(); $('#aFeedback').textContent = '已保存提醒';
  },
  async loadOptions() {
    const p = await this.call('options');
    for (const [key, value] of Object.entries({ Enabled: p.enabled, AI: p.ai, Memory: p.memory, Voice: p.voice, Adaptive: p.adaptive })) $('#p' + key).checked = value;
    for (const [key, value] of Object.entries({ Frequency: p.frequency, Min: p.min, QuietFrom: p.quietFrom, QuietTo: p.quietTo,
      Limit: p.limit, Strength: p.strength, Manual: p.manual })) {
      $('#p' + key).value = value;
    }
    $('#pFrequency').onchange();
    await this.refreshState();
  },
  async refreshState() {
    const p = await this.call('status', { busy: this.busy(), recording: Rec.on });
    const label = p.state + ' · ' + p.reason + (p.lastSpoken ? ' · 上次主动发言 ' + new Date(p.lastSpoken).toLocaleString() : '');
    if ($('#pState').textContent !== label) $('#pState').textContent = label;
  },
  readOptions() {
    return {
      enabled: $('#pEnabled').checked, ai: $('#pAI').checked, memory: $('#pMemory').checked, voice: $('#pVoice').checked,
      frequency: $('#pFrequency').value, min: +$('#pMin').value, limit: +$('#pLimit').value,
      quietFrom: $('#pQuietFrom').value, quietTo: $('#pQuietTo').value,
      adaptive: $('#pAdaptive').checked, strength: $('#pStrength').value, manual: $('#pManual').value,
    };
  },
  async saveOptions(options) {
    await this.call('configure', options);
    if (Voice.currentKind === 'proactive' && (!options.enabled || options.manual !== 'normal')) Voice.interrupt();
  },
  lowPriorityVoice() { return ['proactive', 'ambient'].includes(Voice.currentKind); },
  activity(kind = 'touch') {
    if (this.lowPriorityVoice()) Voice.interrupt();
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
      if (response?.proactive && !this.busy()) this.speak(response.proactive);
      if (!$('#settings').classList.contains('hidden')) await this.refreshState();
    } catch (_) {
      // The storage panel provides the error and recovery controls.
    } finally { this.polling = false; }
  },
  deliver(event) {
    if (this.lowPriorityVoice()) Voice.interrupt();
    const words = '时间到了，记得' + event.title + '。';
    Chat.card('happy', words, ['查看提醒', () => this.showAgenda()]);
    say(words, 'smile', 5, { kind: 'reminder', voice: !!event.voice, ja: '時間ですよ。予定を確認してくださいね。' });
    if (!$('#settings').classList.contains('hidden')) this.task('#aFeedback', () => this.refresh());
  },
  async speak(options) {
    this.talking = true;
    const startingActivity = this.activityAt;
    const hour = new Date().getHours();
    const choices = [
      ['休息', '要不要伸个懒腰？我才没有在催你呢。', 'ちょっと伸びをしませんか？別に急かしてるわけじゃないです。'],
      ['话题', '我在这里陪你哦。有想聊的就说吧。', 'ここにいますよ。話したいことがあれば聞きます。'],
      hour < 12 ? ['问候', '早上好呀，今天也按自己的节奏来吧。', 'おはようございます。今日も自分のペースでいきましょう。']
        : ['问候', '你今天过得怎么样？我只是随口问问啦。', '今日はどうでしたか？ちょっと聞いただけですよ。'],
    ].filter(([category]) => category !== this.lastCategory);
    let [category, reply, ja] = pick(choices), emotion = 'gentle';
    try {
      if (options.ai && AI.ready()) {
        try {
          const time = hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';
          const out = AI.parse(await AI.complete(AI.systemPrompt(aiState()) +
            '\n这是主动打招呼。只说一句。主题限定为' + category + '，避免重复上一次主题。你没有屏幕信息，不推断用户的情绪、健康或正在做什么。',
          [{ role: 'user', content: '请在' + time + '和我轻松打个招呼。' }],
          { timeout: 15000, maxTokens: 240, proactive: options.ticket }));
          const unsupported = /(?:我|刚)(?:刚才|刚刚)?(?:看见|看到|看着|注意到你正在)|你(?:一定|肯定|明显|看起来)(?:很|有点)?(?:累|难过|疲惫|生病|不舒服)/;
          if (out.reply !== '……' && out.reply !== this.lastLine && !unsupported.test(out.reply)) {
            reply = out.reply.slice(0, 100);
            ja = out.ja || 'こんにちは。少しお話ししませんか？';
            emotion = out.emotion || emotion;
          }
        } catch (_) {}
      }
      if (this.busy() || Rec.on || this.queued || startingActivity !== this.activityAt ||
          !await this.call('canSpeak', options.ticket) || this.busy() || Rec.on || this.queued || startingActivity !== this.activityAt ||
          !await this.call('spoken', options.ticket) || this.busy() || Rec.on || this.queued || startingActivity !== this.activityAt) return;
      this.lastLine = reply;
      this.lastCategory = category;
      say(reply, emotion, null, { kind: 'proactive', voice: options.voice, ja });
    } catch (_) {} finally { this.talking = false; }
  },
  init() {
    if (!window.petAPI) return;
    for (const day of '日一二三四五六') {
      const label = document.createElement('label'), box = document.createElement('input');
      box.type = 'checkbox'; label.append(box, ' 周' + day); $('#aWeekdays').append(label);
    }
    $('#aRepeat').onchange = () => $('#aWeekdays').classList.toggle('hidden', $('#aRepeat').value !== 'custom');
    $('#aSave').onclick = () => this.task('#aFeedback', () => this.save());
    $('#aCancel').onclick = () => this.edit();
    $('#aRefresh').onclick = () => this.task('#aFeedback', () => this.refresh());
    $('#aExport').onclick = () => this.task('#aFileFeedback', async () => {
      if (await this.call('exportFile')) $('#aFileFeedback').textContent = '提醒已导出到 JSON';
    });
    $('#aImport').onclick = () => this.task('#aFileFeedback', async () => {
      const count = await this.call('importFile');
      if (count === null) return;
      $('#aFileFeedback').textContent = `已导入 ${count} 条提醒，导入项目为暂停状态`;
      await this.refresh();
    });
    $('#pFrequency').onchange = () => { $('#pMin').disabled = $('#pFrequency').value !== 'custom'; };
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
