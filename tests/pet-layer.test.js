'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPetLayer } = require('../electron/pet-layer');

test('floating pets yield to fullscreen, and restore without reopening mouse input while covered', () => {
  const state = { visible: false };
  const win = {
    isDestroyed: () => false,
    isVisible: () => state.visible,
    showInactive: () => { state.visible = true; },
    hide: () => { state.visible = false; },
    setAlwaysOnTop: (value, layer) => { state.layer = value ? layer : 'normal'; },
    setIgnoreMouseEvents: value => { state.ignore = value; },
  };
  let signal, stops = 0;
  const layer = createPetLayer(win, (_, update) => { signal = update; return () => stops++; }, true);
  layer.apply('floating', false);
  layer.show();
  assert.deepEqual(state, { visible: false, layer: 'normal', ignore: true });
  layer.ignoreMouse(false);
  signal(false);
  assert.deepEqual(state, { visible: true, layer: 'floating', ignore: false });
  signal(true);
  layer.ignoreMouse(false);
  assert.deepEqual(state, { visible: false, layer: 'normal', ignore: true });
  layer.hide();
  signal(false);
  assert.equal(state.visible, false);
  layer.show();
  assert.equal(state.visible, true);
  layer.apply('top', true);
  assert.deepEqual(state, { visible: true, layer: 'screen-saver', ignore: true });
  assert.equal(stops, 1);
  layer.apply('normal', false);
  assert.equal(state.layer, 'normal');
  layer.dispose();
});
