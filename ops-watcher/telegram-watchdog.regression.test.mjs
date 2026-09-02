// ops-watcher/telegram-watchdog.regression.test.mjs
// Offline tests for telegram-watchdog.mjs. No real daemon process is spawned.

import assert from "node:assert/strict";
import { runWatchdog, inspectDaemon, startDaemonReal } from "./telegram-watchdog.mjs";

let passed = 0;
let failed = 0;
function ok(name) { console.log(`PASS: ${name}`); passed += 1; }
function bad(name, err) { console.log(`FAIL: ${name}`); console.log(String(err && err.stack ? err.stack : err)); failed += 1; }

async function t1_missingLockStartsDaemon() {
  const starts = [];
  const logs = [];
  const r = await runWatchdog({
    once: true,
    readLock: async () => ({ ok: false, code: "ENOENT" }),
    isAlive: () => false,
    startDaemon: async () => { starts.push("start"); return { ok: true, pid: 101 }; },
    acquireLock: async () => ({ acquired: true, pid: 1 }),
    releaseLock: async () => {},
    log: (m) => logs.push(m),
  });
  assert.equal(r.starts, 1);
  assert.equal(starts.length, 1);
  assert.ok(logs.some((m) => /missing-lock/.test(m)));
  ok("T1 missing daemon lock -> watchdog starts daemon");
}

async function t2_aliveLockDoesNotStart() {
  const r = await runWatchdog({
    once: true,
    readLock: async () => ({ ok: true, value: { pid: 202 } }),
    isAlive: (pid) => pid === 202,
    startDaemon: async () => { throw new Error("must not start"); },
    acquireLock: async () => ({ acquired: true, pid: 1 }),
    releaseLock: async () => {},
    log: () => {},
  });
  assert.equal(r.starts, 0);
  assert.equal(r.checks, 1);
  ok("T2 alive daemon lock -> no duplicate daemon start");
}

async function t3_staleLockStartsDaemon() {
  const starts = [];
  const r = await runWatchdog({
    once: true,
    readLock: async () => ({ ok: true, value: { pid: 303 } }),
    isAlive: () => false,
    startDaemon: async () => { starts.push("start"); return { ok: true, pid: 304 }; },
    acquireLock: async () => ({ acquired: true, pid: 1 }),
    releaseLock: async () => {},
    log: () => {},
  });
  assert.equal(r.starts, 1);
  assert.equal(starts.length, 1);
  ok("T3 stale daemon lock -> watchdog starts replacement");
}

async function t4_refusesSecondWatchdog() {
  let inspected = false;
  const r = await runWatchdog({
    once: true,
    readLock: async () => { inspected = true; return { ok: false, code: "ENOENT" }; },
    acquireLock: async () => ({ acquired: false, pid: 404 }),
    releaseLock: async () => { throw new Error("must not release unowned lock"); },
    log: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(r.pid, 404);
  assert.equal(inspected, false);
  ok("T4 watchdog lock prevents duplicate supervisors");
}

async function t5_inspectInvalidLock() {
  const r = await inspectDaemon({
    readLock: async () => ({ ok: true, value: { pid: "not-a-number" } }),
    isAlive: () => true,
  });
  assert.equal(r.running, false);
  assert.equal(r.reason, "invalid-lock");
  ok("T5 invalid daemon lock is treated as not running");
}

async function t6_recoversMidFlight() {
  let tick = 0;
  const starts = [];
  const locks = [
    { ok: true, value: { pid: 501 } },
    { ok: true, value: { pid: 501 } },
    { ok: true, value: { pid: 501 } },
  ];
  let currentTime = 0;
  const r = await runWatchdog({
    maxRuntimeMs: 30,
    intervalMs: 10,
    readLock: async () => locks[Math.min(tick, locks.length - 1)],
    isAlive: () => tick++ < 1,
    startDaemon: async () => { starts.push("restart"); return { ok: true, pid: 502 }; },
    acquireLock: async () => ({ acquired: true, pid: 1 }),
    releaseLock: async () => {},
    sleep: async (ms) => { currentTime += ms; },
    now: () => currentTime,
    log: () => {},
  });
  assert.ok(r.checks >= 2);
  assert.ok(starts.length >= 1, "watchdog must restart after PID goes stale mid-flight");
  ok("T6 daemon death during watchdog runtime -> automatic restart");
}

// A spawn that never started reports { ok: false, pid: null }. startDaemonReal
// used to return ok:true unconditionally, so a daemon that did not start was
// counted as started and logged with pid=undefined.
async function t7_failedStartIsNotCounted() {
  const logs = [];
  const r = await runWatchdog({
    once: true,
    readLock: async () => ({ ok: false, code: "ENOENT" }),
    isAlive: () => false,
    startDaemon: async () => ({ ok: false, pid: null, reason: "no pid" }),
    acquireLock: async () => ({ acquired: true, pid: 1 }),
    releaseLock: async () => {},
    log: (m) => logs.push(m),
  });
  assert.equal(r.starts, 0, "a daemon that did not start is not a start");
  assert.equal(r.checks, 1);
  assert.ok(logs.some((m) => /NOT started/.test(m)), "the failure is said out loud");
  ok("T7 a daemon spawn that never started is not counted as a start");
}

// startDaemonReal is exercised against an injected spawn, so no real process is
// created: a child with no pid must be reported as a failure, not a start.
async function t8_startDaemonRealJudgesThePid() {
  const noPid = startDaemonReal({
    nodePath: "node",
    daemonScript: "does-not-matter.mjs",
    log: () => {},
    spawn: () => ({ pid: undefined, unref() {}, on() {} }),
  });
  assert.equal(noPid.ok, false, "no pid means the daemon did not start");
  assert.equal(noPid.pid, null);

  const withPid = startDaemonReal({
    nodePath: "node",
    daemonScript: "does-not-matter.mjs",
    log: () => {},
    spawn: () => ({ pid: 4242, unref() {}, on() {} }),
  });
  assert.equal(withPid.ok, true);
  assert.equal(withPid.pid, 4242);

  const threw = startDaemonReal({
    nodePath: "node",
    daemonScript: "does-not-matter.mjs",
    log: () => {},
    spawn: () => { throw new Error("EACCES"); },
  });
  assert.equal(threw.ok, false);
  assert.ok(/EACCES/.test(threw.reason));
  ok("T8 startDaemonReal reports a start only when the child has a pid");
}

const tests = [t1_missingLockStartsDaemon, t2_aliveLockDoesNotStart, t3_staleLockStartsDaemon, t4_refusesSecondWatchdog, t5_inspectInvalidLock, t6_recoversMidFlight, t7_failedStartIsNotCounted, t8_startDaemonRealJudgesThePid];
for (const t of tests) {
  try { await t(); } catch (err) { bad(t.name, err); }
}
console.log("");
console.log(`TELEGRAM WATCHDOG REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;

