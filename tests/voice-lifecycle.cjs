'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const python = process.env.CHIERI_TEST_PYTHON || 'python';
const opts = { windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } };
const code = "import sys; sys.path.insert(0, 'voice'); from chieri_server import watch_stdin; print('ready', flush=True); watch_stdin()";
const unrelated = spawn(python, ['-u', '-c', "import time; print('ready', flush=True); time.sleep(30)"], opts);

async function check() {
  const owned = spawn(python, ['-u', '-c', code], opts);
  const exit = once(owned, 'exit');
  try {
    await Promise.all([once(owned.stdout, 'data'), once(unrelated.stdout, 'data')]);
    owned.stdin.destroy();
    const [exitCode] = await Promise.race([exit, delay(5000, [], { ref: false })]);
    assert.equal(exitCode, 0, 'owned Python should exit normally when its pipe closes');
    assert.equal(unrelated.exitCode, null, 'unrelated Python should survive');
    console.log('Owned Python exited on pipe EOF; unrelated Python survived');
  } finally {
    if (owned.exitCode === null) owned.kill();
    unrelated.kill();
  }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
