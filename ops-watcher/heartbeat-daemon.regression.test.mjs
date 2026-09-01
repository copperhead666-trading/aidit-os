// ops-watcher/heartbeat-daemon.regression.test.mjs
// Offline tests for heartbeat-daemon.mjs. No live Paperclip/Telegram/Hermes.

import assert from "node:assert/strict";
import { runHeartbeatDaemon } from "./heartbeat-daemon.mjs";

let passed = 0;
let failed = 0;
function ok(name) { console.log(`PASS: ${name}`); passed += 1; }
function bad(name, err) { console.log(`FAIL: ${name}`); console.log(String(err && err.stack ? err.stack : err)); failed += 1; }

async function t1_onceRunsOneSweep() {
  let calls = 0;
  const r = await runHeartbeatDaemon({
    once: true,
    runHeartbeat: async () => { calls += 1; return { failed: 0 }; },
    acquireLock: async () => ({ acquired: true, pid: 1 }),
    releaseLock: async () => {},
    log: () => {},
  });
  assert.equal(r.sweeps, 1);
  assert.equal(calls, 1);
  assert.equal(r.failedSweeps, 0);
  ok("T1 --once runs exactly one heartbeat sweep");
}

async function t2_refusesDuplicateDaemon() {
  let called = false;
  const r = await runHeartbeatDaemon({
    once: true,
    runHeartbeat: async () => { called = true; return { failed: 0 }; },
    acquireLock: async () => ({ acquired: false, pid: 222 }),
    releaseLock: async () => { throw new Error("must not release unowned lock"); },
    log: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(r.pid, 222);
  assert.equal(called, false);
  ok("T2 daemon lock prevents duplicate heartbeat supervisors");
}

async function t3_continuesAfterFailedSweep() {
  let currentTime = 0;
  let calls = 0;
  const r = await runHeartbeatDaemon({
    maxRuntimeMs: 25,
    intervalMs: 10,
    runHeartbeat: async () => {
      calls += 1;
      if (calls === 1) return { failed: 1 };
      if (calls === 2) throw new Error("simulated sweep crash");
      return { failed: 0 };
    },
    acquireLock: async () => ({ acquired: true, pid: 1 }),
    releaseLock: async () => {},
    sleep: async (ms) => { currentTime += ms; },
    now: () => currentTime,
    log: () => {},
  });
  assert.ok(calls >= 3, `expected at least 3 sweeps, got ${calls}`);
  assert.equal(r.failedSweeps, 2);
  ok("T3 failed/thrown sweeps are recorded and daemon continues");
}

for (const t of [t1_onceRunsOneSweep, t2_refusesDuplicateDaemon, t3_continuesAfterFailedSweep]) {
  try { await t(); } catch (err) { bad(t.name, err); }
}
console.log("");
console.log(`HEARTBEAT DAEMON REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
