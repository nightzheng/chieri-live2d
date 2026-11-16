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
    $('#agendaSettings').scrollIntoView({ block: 'start' });
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
    for (const [key, value] of Object.entries({ Enabled: p.enabled, AI: p.ai, Memory: p.memory, Voice: p.voice })) $('#p' + key).checked = value;
    for (const [key, value] of Object.entries({ Frequency: p.frequency, Min: p.min, QuietFrom: p.quietFrom, QuietTo: p.quietTo, Limit: p.limit })) {
      $('#p' + key).value = value;
    }
    $('#pFrequency').onchange();
  },
  async configure(pause = false) {
    const options = pause ? { ...await this.call('options'), enabled: false } : {
      enabled: $('#pEnabled').checked, ai: $('#pAI').checked, memory: $('#pMemory').checked, voice: $('#pVoice').checked,
      frequency: $('#pFrequency').value, min: +$('#pMin').value, limit: +$('#pLimit').value,
      quietFrom: $('#pQuietFrom').value, quietTo: $('#pQuietTo').value,
    };
    await this.call('configure', options);
    if (pause && Voice.currentKind === 'proactive') Voice.interrupt();
    await this.loadOptions();
    $('#pFeedback').textContent = pause ? '已暂停主动闲聊，日程提醒继续运行' : '设置已保存';
  },
  activity() {
    if (Voice.currentKind === 'proactive') Voice.interrupt();
    const now = Date.now();
    if (!window.petAPI || now - this.activityAt < 1000) return;
    this.activityAt = now;
    this.call('activity').catch(() => {});
  },
  busy() {
    return Chat.sending || AI.interacting > 0 || Voice.pending > 0 || Voice.playing;
  },
  reminderBusy() {
    return Chat.sending || AI.interacting > 0 || (Voice.currentKind !== 'proactive' && (Voice.pending > 0 || Voice.playing));
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
    } catch (_) {
      // The storage panel provides the error and recovery controls.
    } finally { this.polling = false; }
  },
  deliver(event) {
    if (Voice.currentKind === 'proactive') Voice.interrupt();
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
      ['要不要伸个懒腰？我才没有在催你呢。', 'ちょっと伸びをしませんか？別に急かしてるわけじゃないです。'],
      ['我在这里陪你哦。有想聊的就说吧。', 'ここにいますよ。話したいことがあれば聞きます。'],
      hour < 12 ? ['早上好呀，今天也按自己的节奏来吧。', 'おはようございます。今日も自分のペースでいきましょう。']
        : ['你今天过得怎么样？我只是随口问问啦。', '今日はどうでしたか？ちょっと聞いただけですよ。'],
    ].filter(([line]) => line !== this.lastLine);
    let [reply, ja] = pick(choices), emotion = 'gentle';
    try {
      if (options.ai && AI.ready()) {
        try {
          const time = hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';
          const out = AI.parse(await AI.complete(AI.systemPrompt(aiState()) +
            '\n这是主动打招呼。只说一句，可以问候、关心或聊用户明确保存的兴趣。你没有屏幕信息，不能声称看到对方的活动。',
          [{ role: 'user', content: '请在' + time + '和我轻松打个招呼。' }],
          { timeout: 15000, maxTokens: 240, proactive: options.ticket }));
          if (out.reply !== '……' && !/(?:我|刚)(?:刚才|刚刚)?(?:看见|看到|看着|注意到你正在)/.test(out.reply)) {
            reply = out.reply.slice(0, 100);
            ja = out.ja || 'こんにちは。少しお話ししませんか？';
            emotion = out.emotion || emotion;
          }
        } catch (_) {}
      }
      if (this.busy() || Rec.on || this.queued || startingActivity !== this.activityAt ||
          !await this.call('canSpeak', true) || this.busy() || startingActivity !== this.activityAt) return;
      this.lastLine = reply;
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
    $('#pSave').onclick = () => this.task('#pFeedback', () => this.configure());
    $('#pPause').onclick = () => this.task('#pFeedback', () => this.configure(true));
    // Only keep the time of input in Chieri. No keys or text are inspected or persisted.
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => this.activity(), true);
    window.petAPI.onAgenda(() => this.showAgenda());
    window.petAPI.onProactivePaused(() => {
      if (Voice.currentKind === 'proactive') Voice.interrupt();
      if (!$('#settings').classList.contains('hidden')) this.task('#pFeedback', () => this.loadOptions());
    });
    setInterval(() => this.poll(), 2000);
  },
};
