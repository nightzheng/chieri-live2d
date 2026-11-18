'use strict';

const memoryElement = selector => document.querySelector(selector);

const MemoryUI = {
  id: null,
  offset: 0,
  chatOffset: 0,
  pageSize: 12,
  running: false,
  request(operation, value) { return (window.dataAPI || window.petAPI).memory(operation, value); },
  feedback(selector, message = '', tone = '') {
    if (!window.dataAPI) return Settings.feedback(selector, message, tone);
    const node = memoryElement(selector);
    node.dataset.tone = tone;
    node.textContent = message;
  },
  async run(task, selector = '#mFeedback') {
    if (this.running) return;
    this.running = true;
    if (memoryElement('#mEnabled')) memoryElement('#mEnabled').disabled = memoryElement('#mAuto').disabled = true;
    this.feedback(selector);
    try { await task(); }
    catch (error) { this.feedback(selector, error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), 'error'); }
    finally {
      this.running = false;
      if (memoryElement('#mEnabled')) { memoryElement('#mEnabled').disabled = false; this.modeHelp(); }
    }
  },
  open() { return this.run(() => this.refresh(true)); },
  readOptions() {
    return { enabled: memoryElement('#mEnabled').checked, mode: memoryElement('#mAuto').value, limit: +memoryElement('#mLimit').value, budget: +memoryElement('#mBudget').value,
      rules: Array.from(document.querySelectorAll('[data-memory-rule]:checked'), input => input.value) };
  },
  async refresh(loadOptions = false) {
    const status = await this.request('status');
    memoryElement('#mStatus').textContent = status.file + (status.error ? ' · ' + status.error : ' · ' + status.count + ' 条当前记忆');
    if (loadOptions) {
      memoryElement('#mEnabled').checked = status.enabled;
      memoryElement('#mAuto').value = status.mode;
      memoryElement('#mLimit').value = status.limit;
      memoryElement('#mBudget').value = status.budget;
      for (const input of document.querySelectorAll('[data-memory-rule]')) input.checked = status.rules.includes(input.value);
      this.modeHelp();
    }
    const rows = status.lastUsed.map(row => {
      const el = document.createElement('li');
      el.textContent = row.content + (row.match?.length ? ' · 匹配 ' + row.match.join('、') : ' · 主动陪伴选用');
      return el;
    });
    if (!rows.length) {
      const el = document.createElement('li');
      el.textContent = '暂无';
      rows.push(el);
    }
    memoryElement('#mUsed').replaceChildren(...rows);
  },
  modeHelp() {
    memoryElement('#mAuto').disabled = memoryElement('#mLimit').disabled = memoryElement('#mBudget').disabled = !memoryElement('#mEnabled').checked;
    for (const input of document.querySelectorAll('[data-memory-rule]')) input.disabled = !memoryElement('#mEnabled').checked || memoryElement('#mAuto').value === 'off';
    const explanations = {
      off: '你主动说「记住」或明确更正时，符合要求的内容会直接保存。',
      rules: '在本机按勾选类别识别「我喜欢」「我经常」等固定句式。符合条件的内容直接保存。临时事项、明显的假设和敏感信息会过滤。',
      ai: '保留本地规则。当旧消息超出 16 条或 6000 字符的聊天上下文预算时，可将最多三条筛选过的用户消息交给聊天服务。每 10 分钟最多一次，每 24 小时最多六次。通过检查后自动保存。',
    };
    memoryElement('#mModeHelp').textContent = memoryElement('#mEnabled').checked ? explanations[memoryElement('#mAuto').value] : '已暂停候选提取和对话引用。你仍可管理已有记忆。';
  },
  async remember(text) {
    try {
      const result = await this.request('remember', text);
      if (result?.explicit) Chat.card('happy', '已保存长期记忆。');
    } catch (_) { Chat.card('pout', '未能保存长期记忆。请检查记忆与数据设置。'); }
  },
  button(text, action) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'mini'; btn.textContent = text;
    btn.onclick = action;
    return btn;
  },
  row(text, metadata, actions) {
    const article = document.createElement('article'), content = document.createElement('p');
    const details = document.createElement('small'), buttons = document.createElement('div');
    content.textContent = text;
    details.textContent = metadata;
    buttons.className = 'row2 wrap'; buttons.append(...actions);
    article.append(details, content, buttons);
    return article;
  },
  edit(row) {
    this.id = row?.id ?? null;
    memoryElement('#mContent').value = row?.content ?? '';
    memoryElement('#mType').value = row?.type ?? '事实';
    memoryElement('#mTags').value = row?.tags ?? '';
    memoryElement('#mImportance').value = row?.importance ?? 2;
    const time = row?.expires_at ? new Date(row.expires_at) : null;
    memoryElement('#mExpiry').value = time ? new Date(+time - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    memoryElement('#mSave').textContent = row ? '保存修改' : '添加记忆';
    memoryElement('#mCancel').classList.toggle('hidden', !row);
    if (row) { memoryElement('#mEditor').open = true; memoryElement('#mContent').focus(); }
  },
  async list() {
    const rows = await this.request('list', { query: memoryElement('#mQuery').value, state: memoryElement('#mFilter').value,
      type: memoryElement('#mTypeFilter').value, offset: this.offset, limit: this.pageSize + 1 });
    if (!rows.length && this.offset) { this.offset -= this.pageSize; return this.list(); }
    memoryElement('#mPrev').disabled = this.offset === 0;
    memoryElement('#mNext').disabled = rows.length <= this.pageSize;
    memoryElement('#mPage').textContent = `第 ${1 + this.offset / this.pageSize} 页`;
    memoryElement('#mList').replaceChildren(...rows.slice(0, this.pageSize).map(row => this.row(row.content,
      [row.type, row.tags, ({ manual: '手动', explicit: '明确保存', candidate: '本地规则', semantic: 'AI 辅助', import: '导入' })[row.source],
        row.expires_at && '有效至 ' + new Date(row.expires_at).toLocaleString(), new Date(row.confirmed).toLocaleDateString()].filter(Boolean).join(' · '), [
        this.button(row.archived ? '编辑并恢复' : '编辑', () => this.edit(row)),
        this.button('删除', () => this.run(async () => {
          if (!window.confirm('删除这条长期记忆？')) return;
          await this.request('remove', row.id);
          if (this.id === row.id) this.edit();
          await this.list();
        })),
      ])));
    if (!rows.length) memoryElement('#mList').textContent = '没有匹配的记忆';
  },
  async history() {
    const rows = await this.request('conversations', { query: memoryElement('#mChatQuery').value, offset: this.chatOffset });
    const byConversation = Map.groupBy(rows, row => row.conversation);
    if (!rows.length && this.chatOffset) { this.chatOffset -= this.pageSize; return this.history(); }
    memoryElement('#mChatPrev').disabled = this.chatOffset === 0;
    memoryElement('#mChatMore').disabled = byConversation.size <= this.pageSize;
    memoryElement('#mChatPage').textContent = `第 ${1 + this.chatOffset / this.pageSize} 页`;
    memoryElement('#mHistory').replaceChildren(...Array.from(byConversation.values()).slice(0, this.pageSize).map(turn => this.row(
      turn.map(row => (row.who === 'user' ? '我' : '千绘莉') + ' · ' + row.text).join('\n\n'),
      new Date(turn[0].created).toLocaleString(), [
        this.button('删除这轮对话', () => this.run(async () => {
          if (!window.confirm('删除这轮对话中的全部消息？长期记忆保留。')) return;
          await this.request('deleteConversation', turn[0].conversation);
          await this.history();
        })),
      ])));
    if (!rows.length) memoryElement('#mHistory').textContent = '没有匹配的聊天记录';
  },
  init() {
    if (!window.petAPI) return;
    memoryElement('#mEnabled').onchange = memoryElement('#mAuto').onchange = () => this.modeHelp();
    memoryElement('#mManager').onclick = () => this.run(() => window.petAPI.openDataManager());
    document.querySelectorAll('[data-memory]').forEach(btn => btn.onclick = () => this.run(async () => {
      const action = btn.dataset.memory;
      const reloads = ['refresh', 'restore', 'relink'].includes(action);
      if (reloads && Chat.sending) throw new Error('请等待当前对话结束');
      if (reloads) Chat.sending = true;
      try {
        const result = action === 'refresh' ? true : await this.request(action);
        if (reloads && result) await Chat.reload();
        await this.refresh();
        if (result && action === 'backup') this.feedback('#mFeedback', '已备份到 ' + result, 'ok');
        if (result && action === 'exportFile') this.feedback('#mFeedback', '已导出到 ' + result, 'ok');
        if (typeof result === 'number') this.feedback('#mFeedback', '已处理 ' + result + ' 条记忆', 'ok');
      } finally { if (reloads) Chat.sending = false; }
    }));
  },
  initManager() {
    memoryElement('#mSearch').onclick = memoryElement('#mFilter').onchange = memoryElement('#mTypeFilter').onchange = () => this.run(async () => { this.offset = 0; await this.list(); });
    memoryElement('#mPrev').onclick = () => this.run(async () => { this.offset -= this.pageSize; await this.list(); });
    memoryElement('#mNext').onclick = () => this.run(async () => { this.offset += this.pageSize; await this.list(); });
    memoryElement('#mCancel').onclick = () => this.edit();
    memoryElement('#mSave').onclick = () => this.run(async () => {
      await this.request('save', { id: this.id, content: memoryElement('#mContent').value, type: memoryElement('#mType').value, tags: memoryElement('#mTags').value,
        importance: +memoryElement('#mImportance').value, expires_at: memoryElement('#mExpiry').value ? Date.parse(memoryElement('#mExpiry').value) : null });
      this.edit(); this.offset = 0; memoryElement('#mFilter').value = 'active'; memoryElement('#mTypeFilter').value = '';
      await this.list();
      this.feedback('#mEditFeedback', '记忆已保存', 'ok');
    }, '#mEditFeedback');
    memoryElement('#mChatSearch').onclick = () => this.run(async () => { this.chatOffset = 0; await this.history(); });
    memoryElement('#mChatMore').onclick = () => this.run(async () => { this.chatOffset += this.pageSize; await this.history(); });
    memoryElement('#mChatPrev').onclick = () => this.run(async () => { this.chatOffset -= this.pageSize; await this.history(); });
    memoryElement('#mClearChat').onclick = () => this.run(async () => {
      if (!window.confirm('清除全部聊天记录？长期记忆保留。')) return;
      await this.request('clearHistory'); await this.history();
      this.feedback('#mFeedback', '聊天记录已清除', 'ok');
    });
    memoryElement('#mClearMemories').onclick = () => this.run(async () => {
      if (!window.confirm('删除全部长期记忆（含已归档记忆）？聊天记录及备份文件保留。')) return;
      await this.request('clearMemories'); this.edit(); await this.list();
      this.feedback('#mEditFeedback', '长期记忆已清除', 'ok');
    }, '#mEditFeedback');
    for (const [input, button] of [['#mQuery', '#mSearch'], ['#mChatQuery', '#mChatSearch']]) {
      memoryElement(input).onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) memoryElement(button).click(); };
    }
    const tabs = [...document.querySelectorAll('[data-panel]')];
    const show = panel => {
      for (const tab of tabs) {
        const active = tab.dataset.panel === panel;
        tab.setAttribute('aria-pressed', String(active));
        memoryElement('#' + tab.dataset.panel).hidden = !active;
      }
      this.run(() => panel === 'memoryPanel' ? this.list() : this.history());
    };
    for (const tab of tabs) tab.onclick = () => show(tab.dataset.panel);
    show('memoryPanel');
  },
};

if (window.dataAPI) {
  MemoryUI.initManager();
}
