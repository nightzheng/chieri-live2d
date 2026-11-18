'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow } = require('electron');

const mode = process.env.CHIERI_SETTINGS_MODE || 'studio';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chieri-settings-test-'));
for (const name of ['profile', 'local', 'temp']) fs.mkdirSync(path.join(root, name));
app.setPath('userData', path.join(root, 'profile'));
app.setPath('temp', path.join(root, 'temp'));
Object.assign(process.env, { LOCALAPPDATA: path.join(root, 'local'), TEMP: path.join(root, 'temp'), L2D_START: mode });
fs.writeFileSync(path.join(root, 'profile', 'settings.json'), JSON.stringify({ pet: { scale: .4 } }));
require(path.resolve(process.env.CHIERI_TEST_APP || path.join(__dirname, '..'), 'electron/main.js'));

async function until(check) {
  for (let i = 0; i < 100; i++) {
    try { const result = await check(); if (result) return result; } catch (_) {}
    await delay(120);
  }
  throw new Error('Timed out waiting for settings UI');
}

async function run() {
  const desktop = await until(() => BrowserWindow.getAllWindows()[0]);
  const win = mode === 'web' ? new BrowserWindow({ show: false, width: 375, height: 500 }) : desktop;
  if (mode === 'web') {
    await win.loadURL('app://local/index.html');
    win.setContentSize(375, 500);
  } else if (mode === 'studio') {
    win.setContentSize(720, 560);
  }
  const js = source => win.webContents.executeJavaScript(source);
  await until(() => js("typeof Settings !== 'undefined' && !Chat.sending && !!document.querySelector('#loading.done')"));
  await js('Settings.open(); true');
  await delay(550);
  if (mode === 'web') {
    const web = await js(`({
      desktop: !!window.petAPI, agenda: getComputedStyle(document.querySelector('#agendaSettings')).display,
      navigation: getComputedStyle(document.querySelector('.settings-sections')).display,
      save: !!document.querySelector('#sSave').getBoundingClientRect().height,
      widths: [document.querySelector('#settings .body').clientWidth, document.querySelector('#settings .body').scrollWidth]
    })`);
    assert.equal(web.desktop, false);
    assert.equal(web.agenda, 'none');
    assert.equal(web.navigation, 'none');
    assert.ok(web.save);
    assert.ok(web.widths[1] <= web.widths[0] + 1, JSON.stringify(web));
    console.log('Web settings passed at 375 × 500 without desktop APIs');
    return;
  }
  await until(() => js("!Settings.loading && !MemoryUI.running && document.querySelector('#mStatus').textContent.includes('memory.sqlite')"));
  const sectionIds = ['aiSettings', 'voiceSettings', 'agendaSettings', 'proactiveSettings', 'visionSettings', 'memorySettings'];
  for (const id of sectionIds) {
    const layout = await js(`(() => {
      const id = ${JSON.stringify(id)}, body = document.querySelector('#settings .body');
      const section = document.getElementById(id);
      for (const details of section.querySelectorAll('details')) details.open = true;
      document.querySelector('[data-section="' + id + '"]').click();
      const base = getComputedStyle(body).fontFamily;
      const fields = [...section.querySelectorAll('select, summary, input[type=date], input[type=time], input[type=datetime-local]')];
      const date = section.querySelector('input:is([type=date], [type=time], [type=datetime-local])');
      return { body: body.clientWidth, scroll: body.scrollWidth, height: body.clientHeight,
        viewport: window.innerHeight, y: body.scrollTop, full: body.scrollHeight,
        sections: [...document.querySelectorAll('[data-section]')].map(b => [b.dataset.section,
          document.getElementById(b.dataset.section).getBoundingClientRect().top - body.getBoundingClientRect().top]),
        active: document.querySelector('.settings-sections [aria-current]').dataset.section,
        consistent: fields.every(node => getComputedStyle(node).fontFamily === base),
        nativeDate: !date || getComputedStyle(date, '::-webkit-datetime-edit').fontFamily === base,
        save: !!document.querySelector('#sSave').getBoundingClientRect().height };
    })()`);
    assert.equal(layout.active, id, JSON.stringify(layout));
    assert.ok(layout.scroll <= layout.body + 1, JSON.stringify({ mode, id, ...layout }));
    assert.ok(layout.height >= 100, JSON.stringify({ mode, id, ...layout }));
    assert.ok(layout.consistent && layout.nativeDate && layout.save);
    if (process.env.CHIERI_SETTINGS_SHOTS && ['agendaSettings','memorySettings'].includes(id)) {
      await delay(180);
      const screenshot = await win.webContents.capturePage();
      fs.writeFileSync(path.join(process.env.CHIERI_SETTINGS_SHOTS, mode + '-' + id + '.png'), screenshot.toPNG());
    }
  }
  await js("document.querySelector('#settings .body').scrollTop = 1e6; true");
  await until(() => js("document.querySelector('[data-section=desktopSettings]').getAttribute('aria-current') === 'location'"));
  await js("document.querySelector('#settings .body').scrollTop = 0; true");
  await until(() => js("document.querySelector('[data-section=aiSettings]').getAttribute('aria-current') === 'location'"));
  assert.equal(await js("document.querySelector('#mModeHelp').textContent.includes('直接保存')"), true);
  await js("document.querySelector('#mAuto').value = 'ai'; document.querySelector('#mAuto').dispatchEvent(new Event('change'))");
  assert.equal(await js("document.querySelector('#mModeHelp').textContent.includes('三条')"), true);
  await js("document.querySelector('#mAuto').value = 'rules'; document.querySelector('#mAuto').dispatchEvent(new Event('change'))");
  assert.equal(await js("document.querySelector('#mModeHelp').textContent.includes('直接保存')"), true);
  assert.equal(await js("petAPI.memory('status').then(s => s.mode)"), 'rules');
  await js("document.querySelector('[data-memory-rule][value=habits]').checked = false");
  await js("window.confirm = () => false; Settings.close(); true");
  assert.equal(await js("document.querySelector('#settings').classList.contains('hidden')"), false);
  await js(`document.querySelector('#sAmbient').value = '15';
    document.querySelector('#pLimit').value = '7';
    document.querySelector('#visModel').value = 'vision-test';
    document.querySelector('#visKey').value = 'test-vision-key';
    Settings.save()`);
  assert.equal(await js("petAPI.memory('status').then(s => s.mode)"), 'rules');
  assert.equal(await js("petAPI.companion('options').then(s => s.limit)"), 7);
  assert.equal(await js("petAPI.getSettings().then(s => s.ambientMinutes)"), 15);
  await js('Settings.open(); true');
  await until(() => js('!Settings.loading'));
  await js("document.querySelector('#visKeyShow').click(); true");
  await until(() => js("document.querySelector('#visKey').type === 'text'"));
  assert.equal(await js("document.querySelector('#visKey').value"), 'test-vision-key');
  assert.equal(await js("Settings.changed('vision')"), false);
  await js("document.querySelector('#visModel').value = 'unsaved'; document.querySelector('#visConnection').click(); true");
  await until(() => js("document.querySelector('#visTestFeedback').dataset.tone === 'error'"));
  assert.equal(await js("document.querySelector('#visTestFeedback').previousElementSibling.contains(document.querySelector('#visConnection'))"), true);
  await js("document.querySelector('#sAmbient').value = '0'; window.confirm = () => true; Settings.close(); true");
  assert.equal(await js("petAPI.getSettings().then(s => s.ambientMinutes)"), 15);
  const ambient = await js(`(async () => {
    const options = await CompanionUI.call('options');
    await CompanionUI.call('configure', {...options, quietFrom:'00:00', quietTo:'00:00', manual:'normal'});
    Store.data.ambientMinutes = 5;
    ambientFrequency = 5; ambientNext = 300; S.anim = null; S.sleep = 0; bubble.classList.add('hidden');
    S.t = 290; await ambientMoment(); const early = bubble.classList.contains('hidden') && !S.anim;
    const prepare = Voice.prepareAnimation, speak = Voice.speak, fakeBuffer = {};
    let waited = false, pairedAudio = false;
    Voice.prepareAnimation = async () => { waited = !S.anim && bubble.classList.contains('hidden'); return fakeBuffer; };
    Voice.speak = (_, opt) => { pairedAudio = opt.buffer === fakeBuffer && S.anim?.ambient === true; };
    S.t = 310;
    try { await ambientMoment(); } finally { Voice.prepareAnimation = prepare; Voice.speak = speak; }
    const due = !bubble.classList.contains('hidden') && S.anim?.ambient === true;
    const inRange = ambientNext >= S.t + 299 && ambientNext <= S.t + 601;
    bubble.classList.add('hidden'); S.anim = null; S.t = 330; await ambientMoment();
    const repeated = !bubble.classList.contains('hidden') || !!S.anim;
    Store.data.ambientMinutes = 0; S.t = 1000; await ambientMoment(); const disabled = bubble.classList.contains('hidden') && !S.anim;
    return {early, due, inRange, repeated, disabled, waited, pairedAudio};
  })()`);
  assert.deepEqual(ambient, { early: true, due: true, inRange: true, repeated: false, disabled: true, waited: true, pairedAudio: true });
  await js("window.confirm = () => { throw new Error('保存记忆不应弹确认'); }; MemoryUI.remember('我喜欢骑自行车')");
  assert.equal(await js("petAPI.memory('list').then(rows => rows.length)"), 1);
  assert.equal(await js("document.querySelector('#aZone').tagName"), 'SELECT');
  await js(`(async () => {
    for (let i = 0; i < 13; i++) await petAPI.memory('save', {content:'样本记忆 ' + i, type:'事实', tags:''});
    await petAPI.memory('append', {who:'user', text:'原始问句', conversation:'manage-test'});
    await petAPI.memory('append', {who:'bot', text:'旧的测试回答', conversation:'manage-test'});
    document.querySelector('#mManager').click();
  })()`);
  const manager = await until(() => BrowserWindow.getAllWindows().find(w => w !== win && w.webContents.getURL().endsWith('data-manager.html')));
  const data = code => manager.webContents.executeJavaScript(code);
  await until(() => data("document.querySelectorAll('#mList article').length === 12"));
  await data("document.querySelector('#mNext').click()");
  await until(() => data("document.querySelectorAll('#mList article').length === 2"));
  await data("document.querySelector('[data-panel=historyPanel]').click()");
  await until(() => data("document.querySelector('#mHistory article')?.textContent.includes('旧的测试回答')"));
  await data("document.querySelector('#mChatQuery').value = '原始问句'; document.querySelector('#mChatSearch').click()");
  await until(() => data("!MemoryUI.running && document.querySelectorAll('#mHistory article').length === 1"));
  assert.match(await data("document.querySelector('#mHistory article').textContent"), /原始问句.*旧的测试回答/s);
  await assert.rejects(data("dataAPI.memory('options', {enabled:false})"), /记忆操作来源无效/);
  console.log(mode + ' settings passed font, navigation, automatic memory saving and management checks');
}

run().then(() => app.quit(), error => { console.error(error); app.exit(1); });
