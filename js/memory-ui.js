'use strict';

const MemoryUI = {
  id: null,
  offset: 0,
  before: undefined,
  running: false,
  request(operation, value) { return window.petAPI.memory(operation, value); },
  async run(task) {
    if (this.running) return;
    this.running = true;
    $('#mEnabled').disabled = true;
    $('#mAuto').disabled = true;
    $('#mFeedback').textContent = '';
    try { await task(); }
    catch (error) { $('#mFeedback').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
    finally {
      this.running = false;
      $('#mEnabled').disabled = false;
      $('#mAuto').disabled = !$('#mEnabled').checked;
      $('#mLimit').disabled = $('#mBudget').disabled = !$('#mEnabled').checked;
    }
  },
  open() { return this.run(() => this.refresh(true)); },
  readOptions() {
    return { enabled: $('#mEnabled').checked, mode: $('#mAuto').value, limit: +$('#mLimit').value, budget: +$('#mBudget').value };
  },
  async refresh(loadOptions = false) {
    const status = await this.request('status');
    $('#mStatus').textContent = status.file + (status.error ? ' · ' + status.error : ' · ' + status.count + ' 条当前记忆');
    if (loadOptions) {
      $('#mEnabled').checked = status.enabled;
      $('#mAuto').value = status.mode;
      $('#mLimit').value = status.limit;
      $('#mBudget').value = status.budget;
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
    $('#mUsed').replaceChildren(...rows);
    if (status.error) {
      $('#mList').replaceChildren();
      $('#mHistory').replaceChildren();
      return;
    }
    await this.list();
    await this.history();
  },
  modeHelp() {
    $('#mAuto').disabled = $('#mLimit').disabled = $('#mBudget').disabled = !$('#mEnabled').checked;
    const explanations = {
      off: '你主动说「记住」或明确更正时，千绘莉仍会请你确认。',
      rules: '千绘莉会在本机识别可能值得记住的内容，经你确认才保存。',
      ai: '规则无法判断时，可请聊天服务辅助，最多发送三条近期用户消息。每 10 分钟最多一次，每 24 小时最多六次。经你确认才保存。',
    };
    $('#mModeHelp').textContent = $('#mEnabled').checked ? explanations[$('#mAuto').value] : '已暂停候选提取和对话引用。你仍可管理已有记忆。';
  },
  async propose(text) {
    try {
      const proposal = await this.request('propose', text);
      if (!proposal) {
        this.request('semantic', text).then(candidate => {
          if (!candidate) return;
          Chat.card('happy', '待确认的记忆：' + candidate.content, ['查看并确认', async () => {
            if (!window.confirm('保存这条 AI 候选？请核对是否准确。\n\n' + candidate.content)) return;
            try {
              await this.request('confirmSemantic', candidate.token);
              Chat.card('happy', '已保存长期记忆。');
            } catch (_) { Chat.card('pout', '候选已失效或无法保存。'); }
          }]);
        }).catch(() => {});
        return;
      }
      const expiry = proposal.expires_at ? '\n有效至 ' + new Date(proposal.expires_at).toLocaleString() : '';
      if (!window.confirm('保存为长期记忆？\n\n' + proposal.content + expiry + '\n\n更新同一长期偏好时，旧说法会归档。')) return;
      await this.request('remember', text);
      Chat.card('happy', '已保存长期记忆。');
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
    $('#mContent').value = row?.content ?? '';
    $('#mType').value = row?.type ?? '事实';
    $('#mTags').value = row?.tags ?? '';
    $('#mImportance').value = row?.importance ?? 2;
    const time = row?.expires_at ? new Date(row.expires_at) : null;
    $('#mExpiry').value = time ? new Date(+time - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    $('#mSave').textContent = row ? '保存修改' : '添加记忆';
    $('#mCancel').classList.toggle('hidden', !row);
    if (row) $('#mContent').focus();
  },
  async list() {
    const rows = await this.request('list', { query: $('#mQuery').value, state: $('#mFilter').value, type: $('#mTypeFilter').value, offset: this.offset });
    $('#mPrev').disabled = this.offset === 0;
    $('#mNext').disabled = rows.length < 40;
    $('#mList').replaceChildren(...rows.map(row => this.row(row.content,
      [row.type, row.tags, ({ manual: '手动', explicit: '明确保存', candidate: '规则候选已确认', semantic: 'AI 候选已确认', import: '导入' })[row.source],
        row.expires_at && '有效至 ' + new Date(row.expires_at).toLocaleString(), new Date(row.confirmed).toLocaleDateString()].filter(Boolean).join(' · '), [
        this.button(row.archived ? '编辑并恢复' : '编辑', () => this.edit(row)),
        this.button('删除', () => this.run(async () => {
          if (!window.confirm('删除这条长期记忆？')) return;
          await this.request('remove', row.id);
          if (this.id === row.id) this.edit();
          await this.refresh();
        })),
      ])));
    if (!rows.length) $('#mList').textContent = '没有匹配的记忆';
  },
  async history(older = false) {
    const rows = await this.request('history', { query: $('#mChatQuery').value, before: older ? this.before : undefined });
    this.before = rows.at(-1)?.id;
    $('#mChatMore').disabled = rows.length < 40;
    $('#mHistory').replaceChildren(...rows.map(row => this.row(row.text,
      [row.who === 'user' ? '我' : Store.data.name, new Date(row.created).toLocaleString()].join(' · '), [
        this.button('删除这轮对话', () => this.run(async () => {
          if (Chat.sending) throw new Error('请等待当前对话结束');
          if (!window.confirm('删除这轮对话中的全部消息？长期记忆保留。')) return;
          await this.request('deleteConversation', row.conversation);
          await Chat.reload();
          await this.history();
        })),
      ])));
    if (!rows.length) $('#mHistory').textContent = '没有匹配的聊天记录';
  },
  init() {
    if (!window.petAPI) return;
    $('#mEnabled').onchange = $('#mAuto').onchange = () => this.modeHelp();
    $('#mSearch').onclick = $('#mFilter').onchange = $('#mTypeFilter').onchange = () => this.run(async () => { this.offset = 0; await this.list(); });
    $('#mPrev').onclick = () => this.run(async () => { this.offset = Math.max(0, this.offset - 40); await this.list(); });
    $('#mNext').onclick = () => this.run(async () => { this.offset += 40; await this.list(); });
    $('#mCancel').onclick = () => this.edit();
    $('#mSave').onclick = () => this.run(async () => {
      await this.request('save', { id: this.id, content: $('#mContent').value, type: $('#mType').value, tags: $('#mTags').value,
        importance: +$('#mImportance').value, expires_at: $('#mExpiry').value ? Date.parse($('#mExpiry').value) : null });
      this.edit(); this.offset = 0; $('#mFilter').value = 'active'; $('#mTypeFilter').value = '';
      await this.refresh();
      $('#mFeedback').textContent = '记忆已保存';
    });
    $('#mChatSearch').onclick = () => this.run(() => this.history());
    $('#mChatMore').onclick = () => this.run(() => this.history(true));
    $('#mClearChat').onclick = () => this.run(async () => { await Chat.clear(); await this.history(); });
    document.querySelectorAll('[data-memory]').forEach(btn => btn.onclick = () => this.run(async () => {
      const action = btn.dataset.memory;
      const reloads = ['refresh', 'restore', 'relink'].includes(action);
      if (reloads && Chat.sending) throw new Error('请等待当前对话结束');
      if (action === 'clearMemories' && !window.confirm('删除全部长期记忆（含已归档记忆）？聊天记录及备份文件保留。')) return;
      if (reloads) Chat.sending = true;
      try {
        const result = action === 'refresh' ? true : await this.request(action);
        if (reloads && result) await Chat.reload();
        await this.refresh();
        if (result && action === 'backup') $('#mFeedback').textContent = '已备份到 ' + result;
        if (result && action === 'exportFile') $('#mFeedback').textContent = '已导出到 ' + result;
        if (typeof result === 'number') $('#mFeedback').textContent = '已处理 ' + result + ' 条记忆';
        if (action === 'clearMemories') $('#mFeedback').textContent = '已清除长期记忆';
      } finally { if (reloads) Chat.sending = false; }
    }));
  },
};
