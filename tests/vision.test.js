'use strict';

const { correctHdrBitmap } = require('../electron/vision');
const { screenGrounded } = require('../electron/screen-grounding');

const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULTS, VisionFlow, validateConfig, visionRequest } = require('../electron/vision');

const picture = Buffer.from('synthetic JPEG');
const config = { ...DEFAULTS, enabled: true, model: 'vision-test' };
const source = { id: 'window:4:0', name: 'Synthetic window' };
const minute = 60000;

test('V02 preview is local, owner-bound, single-use and expires', async () => {
  let now = 0, shots = 0, requests = 0;
  const service = new VisionFlow({ now: () => now,
    capture: async () => { shots++; return picture; },
    request: async (selected, data) => { assert.equal(data, picture); assert.equal(selected, config); requests++; return 'description'; } });
  const first = await service.stage('window A', source, 'describe', config);
  assert.equal(shots, 1);
  assert.equal(requests, 0);
  await assert.rejects(service.send('window B', first.token, config), /失效/);
  now = 2 * minute;
  await assert.rejects(service.send('window A', first.token, config), /失效/);
  const second = await service.stage('window A', source, '', config);
  assert.equal(await service.send('window A', second.token, config), 'description');
  await assert.rejects(service.send('window A', second.token, config), /失效/);
  assert.equal(requests, 1);
  service.clear();
  assert.equal(service.status().latest, '');
});

test('a local preview and single capture preserve the proactive cadence', async () => {
  let now = 0, shots = 0, requests = 0;
  const service = new VisionFlow({ now: () => now,
    capture: async () => { shots++; return picture; }, request: async () => String(++requests) });
  service.activateProactive('w', source, config, { every: 2, chat: 'chat' });
  service.markSpoken('w');
  const preview = await service.stage('w', source, '', config);
  assert.equal(requests, 0);
  assert.equal(await service.send('w', preview.token, config), '1');
  now = 5 * minute;
  await service.tick(true);
  assert.equal(shots, 1);
  assert.equal(await service.proactiveSample('w', 'chat', () => true), '2');
  await service.tick(false);
  assert.equal(service.status().observation, null);
});

test('proactive observation checks every nth actual dialogue and never runs on the timer alone', async () => {
  let now = 0, shots = 0, sent = 0;
  const service = new VisionFlow({ now: () => now, capture: async () => { shots++; return picture; },
    request: async () => { sent++; return 'private fixture'; } });
  const preview = await service.stage('w', source, '', config);
  assert.equal(await service.proactiveSample('w', 'chat', () => true), null);
  service.activateProactive('w', source, { ...config, privateWords: '微信\n密码' }, { every: 2, chat: 'chat' });
  assert.equal(shots, 1);
  assert.equal(sent, 0);
  now = 24 * 60 * minute;
  await service.tick(true);
  assert.equal(shots, 1);
  assert.equal(await service.proactiveSample('w', 'chat', () => true), null);
  service.markSpoken('w');
  assert.equal(await service.proactiveSample('w', 'wrong endpoint', () => true), null);
  assert.equal(await service.proactiveSample('w', 'chat', () => false), null);
  assert.equal(await service.proactiveSample('w', 'chat', () => true), 'private fixture');
  assert.equal(service.status().latest, '');
  service.markSpoken('w');
  service.stop();
  assert.equal(await service.proactiveSample('w', 'chat', () => true), null);
  assert.equal(sent, 1);
});

test('a private title skips the request and a private description skips forwarding', async () => {
  let blocked = false, sent = 0;
  const service = new VisionFlow({ capture: async () => blocked ? null : picture,
    request: async () => { sent++; return 'WeChat 消息'; } });
  const preview = await service.stage('w', source, '', config);
  service.activateProactive('w', source, { ...config, privateWords: 'ｗｅｃｈａｔ' }, { every: 1, chat: 'chat' });
  blocked = true;
  assert.equal(await service.proactiveSample('w', 'chat', () => true), null);
  assert.equal(sent, 0);
  blocked = false;
  assert.equal(await service.proactiveSample('w', 'chat', () => true), null);
  assert.equal(sent, 1);
  assert.match(service.status().error, /已跳过转发/);
});

test('a temporary vision failure keeps the authorized cadence for the next sample', async () => {
  let now = 0, attempts = 0;
  const service = new VisionFlow({ now: () => now, capture: async () => picture,
    request: async () => {
      if (++attempts === 1) throw new Error('service unavailable');
      return 'public topic';
    } });
  const preview = await service.stage('w', source, '', config);
  service.activateProactive('w', source, config, { every: 2, chat: 'chat' });
  service.markSpoken('w');
  assert.equal(await service.proactiveSample('w', 'chat', () => true), null);
  assert.equal(service.status().observation.mode, 'proactive');
  assert.equal(service.status().failure, true);
  service.markSpoken('w');
  now += minute;
  assert.equal(await service.proactiveSample('w', 'chat', () => true), null);
  service.markSpoken('w');
  now += minute;
  assert.equal(await service.proactiveSample('w', 'chat', () => true), 'public topic');
  assert.equal(service.status().failure, false);
});

test('every-chat observation distinguishes unsuitable images from a usable topic without retaining the description', async () => {
  let now = 0, text = 'NO_SCREEN_TOPIC';
  const service = new VisionFlow({ now: () => now, capture: async () => picture, request: async options => {
    assert.equal(options.timeout, 30000);
    return text;
  } });
  service.activateProactive('w', source, { ...config, timeout: 30000 }, { every: 1, chat: 'chat' });
  assert.equal(await service.proactiveSample('w', 'chat', () => true), null);
  assert.match(service.status().error, /未识别到/);
  assert.equal(service.status().lastProactiveSample, false);
  service.markSpoken('w');
  now += minute;
  text = '画面里是一张地图';
  assert.equal(await service.proactiveSample('w', 'chat', () => true), text);
  assert.equal(service.status().lastProactiveSample, true);
  assert.equal(service.status().latest, '');
});

test('screen grounding requires a concrete phrase from this capture in the visible reply', () => {
  const wrap = (reply, screenDetail) => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply, screenDetail }) } }] });
  const sight = '画面上是一张地图';
  assert.equal(screenGrounded(wrap('这张地图上的路线挺有趣。', '地图'), sight), true);
  assert.equal(screenGrounded(wrap('今天过得怎么样？', '地图'), sight), false);
  assert.equal(screenGrounded(wrap('我看到一个水杯', '水杯'), sight), false);
  assert.equal(screenGrounded(wrap('画面真有趣', '画面'), sight), false);
  const english = JSON.stringify({ content: [{ type: 'text', text: '{"reply":"That bicycle looks old.","screenDetail":"bicycle"}' }] });
  assert.equal(screenGrounded(english, 'A red bicycle'), true);
});

test('stopping during capture or network quarantines late results', async () => {
  let captureFinish;
  const pending = new VisionFlow({ capture: () => new Promise(resolve => { captureFinish = resolve; }) });
  const first = pending.stage('w', source, '', config);
  pending.stop();
  captureFinish(picture);
  await assert.rejects(first, /取消/);
  let finish, signal;
  const service = new VisionFlow({ capture: async () => picture,
    request: (_, __, ___, currentSignal) => new Promise(resolve => { signal = currentSignal; finish = resolve; }) });
  const preview = await service.stage('w', source, '', config);
  const request = service.send('w', preview.token, config);
  service.clear();
  assert.equal(signal.aborted, true);
  finish('late result');
  await assert.rejects(request, /取消/);
  assert.equal(service.status().latest, '');
});

test('V03/V05/V06 restricted endpoint, bounded transport, text-only result and errors', async () => {
  assert.throws(() => validateConfig({ ...config, base: 'http://example.com/v1', provider: 'compatible' }));
  assert.throws(() => validateConfig({ ...config, base: 'https://a:b@example.com/v1', provider: 'compatible' }));
  assert.throws(() => validateConfig({ ...config, base: 'https://example.com/v1' }));
  const accepted = validateConfig({ ...config, base: 'http://127.0.0.1:1234/v1/', provider: 'compatible' });
  assert.equal(accepted.base, 'http://127.0.0.1:1234/v1');
  const result = await visionRequest({ ...accepted, key: 'fake-key' }, picture, 'describe', new AbortController().signal,
    async (url, options) => {
      assert.equal(url, accepted.base + '/chat/completions');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, 'Bearer fake-key');
      const request = JSON.parse(options.body);
      assert.equal(request.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,' + picture.toString('base64'));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic result' } }] }));
    });
  assert.equal(result, 'synthetic result');
  await assert.rejects(visionRequest(accepted, picture, '', new AbortController().signal,
    async () => new Response('PRIVATE provider error', { status: 500 })), /^Error: 视觉 API 返回 HTTP 500$/);
  await assert.rejects(visionRequest(accepted, Buffer.alloc(1024 * 1024 + 1), '', new AbortController().signal), /图片大小/);
});

test('optional HDR correction darkens washed-out midtones and preserves hue and alpha', () => {
  const input = Buffer.from([120, 180, 240, 255, 255, 255, 255, 255]);
  const output = correctHdrBitmap(input);
  assert.ok(output[0] < 120 && output[1] < 180 && output[2] < 240);
  assert.ok(Math.abs(output[1] / output[0] - 1.5) < .02);
  assert.deepEqual([...output.subarray(3)], [255, 255, 255, 255, 255]);
  assert.deepEqual([...input], [120, 180, 240, 255, 255, 255, 255, 255]);
});
