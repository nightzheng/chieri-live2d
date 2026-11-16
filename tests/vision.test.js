'use strict';

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

test('V04 observation ends on elapsed duration and does not capture when revoked', async () => {
  let now = 0, shots = 0, requests = 0;
  const service = new VisionFlow({ now: () => now,
    capture: async () => { shots++; return picture; }, request: async () => String(++requests) });
  const preview = await service.stage('w', source, '', config);
  await service.send('w', preview.token, config, { interval: 5, duration: 10 });
  assert.equal(requests, 1);
  now = 5 * minute;
  await service.tick(true);
  assert.equal(requests, 2);
  assert.equal(service.status().observation.name, source.name);
  now = 10 * minute;
  await service.tick(true);
  assert.equal(service.status().observation, null);
  await service.tick(true);
  assert.equal(shots, 2);
  const second = await service.stage('w', source, '', config);
  await service.send('w', second.token, config, { interval: 5, duration: 15 });
  now += 5 * minute;
  await service.tick(false);
  assert.equal(shots, 3);
  assert.equal(service.status().observation, null);
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
