import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquirePoolSlot, laneTimeoutMs } from '../conductor/lanes.mjs';

test('file semaphore rejects a second acquire beyond the configured limit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidit-lanes-lock-'));
  const first = await acquirePoolSlot('test-pool', 1, { lockDir: dir, waitMs: 0, pollMs: 5 });
  assert.equal(first.ok, true);
  try {
    const second = await acquirePoolSlot('test-pool', 1, { lockDir: dir, waitMs: 0, pollMs: 5 });
    assert.deepEqual(second, { ok: false, error: 'semaphore: test-pool busy' });
  } finally {
    first.release();
  }
});

test('file semaphore reclaims a stale lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidit-lanes-lock-'));
  const lock = path.join(dir, 'pool-test-pool-0.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 99999999, at: new Date(Date.now() - 91 * 60000).toISOString() }));

  const acquired = await acquirePoolSlot('test-pool', 1, { lockDir: dir, waitMs: 0, pollMs: 5 });
  assert.equal(acquired.ok, true);
  try {
    const payload = JSON.parse(fs.readFileSync(lock, 'utf8'));
    assert.equal(payload.pid, process.pid);
  } finally {
    acquired.release();
  }
});

test('lane timeout is read from config with a 25 minute default', () => {
  assert.equal(laneTimeoutMs({ timeoutMinutes: 40 }), 40 * 60000);
  assert.equal(laneTimeoutMs({}), 25 * 60000);
});
