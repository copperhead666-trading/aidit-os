// ops-watcher/steward.regression.test.mjs
// Offline regression coverage for the STEWARD infra-drift watchdog. NO real
// Paperclip, NO real ahmad-notify spawn, NO real lock files, NO real schtasks,
// NO real pm2 jlist, NO real pm2 restart — discoverPort, isAlive, spawnNotify,
// readState/writeState, _fs, checkScheduledTasks, checkPm2StaleCode,
// runPm2Restart (and the sub-deps of the REAL checkScheduledTasksReal /
// checkPm2StaleCodeReal when tested directly) are all injected. Run with:
//   node ops-watcher/steward.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  runStewardOnce,
  STEWARD_AGENT_ID,
  defaultCheckScheduledTasks,
  checkScheduledTasksReal,
  checkPm2StaleCodeReal,
  runPm2RestartReal,
} from "./steward.mjs";
import {
  acquireLock,
  releaseLock,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Real PID-based lock implementation against a per-test temp file (NOT the
// production LOCK_FILE) so this stays fully offline/deterministic and never
// collides with a real sweep or another test run.
const TMP_LOCK = path.join(__dirname, "steward.regression.lock.tmp");

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

// ---- A fake in-memory filesystem supporting the operations acquireLock and
// readLockFile need: readFile, writeFile (with flag:"wx"), unlink. Files are
// stored in a Map keyed by full path. This avoids touching real disk for the
// daemon/stale lock reads while still exercising the REAL acquireLock/releaseLock
// logic (the same approach ahmad-dispatch's test uses, but extended to cover
// STEWARD's additional lock-file reads).
function fakeFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    readFile: async (p) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(p);
    },
    writeFile: async (p, content, opts) => {
      if (opts && opts.flag === "wx" && files.has(p)) {
        const err = new Error(`EEXIST: ${p}`);
        err.code = "EEXIST";
        throw err;
      }
      files.set(p, content);
    },
    unlink: async (p) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      files.delete(p);
    },
    stat: async (p) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      return { isFile: () => true };
    },
  };
}

// ---- Fake state store (in-memory, passes state between runStewardOnce calls) ----
function fakeStateStore() {
  let stored = { alerts: {} };
  return {
    readState: async () => JSON.parse(JSON.stringify(stored)),
    writeState: async (_file, state) => {
      stored = JSON.parse(JSON.stringify(state));
    },
    getStored: () => stored,
    reset: () => { stored = { alerts: {} }; },
  };
}

// ---- Build deps with the REAL lock implementation + a fake fs, so the
// single-instance lock is exercised against real acquireLock/releaseLock logic
// while daemon/stale lock file contents are fully controlled. The two NEW
// STEWARD checks default to OFFLINE stubs here (the documented-gap fallback for
// scheduled tasks, and a no-op for pm2 stale-code) so every existing test stays
// fully offline — no real schtasks or pm2 is ever spawned by the suite. New
// tests override these to exercise the wiring. ----
const LOCK_DIR = "/test-locks";
const SWEEP_LOCK = path.join(LOCK_DIR, "steward.lock");

// Offline default for the pm2 stale-code check: returns no findings. New tests
// that exercise the wiring inject their own.
async function offlinePm2StaleCodeNoop() {
  return [];
}

// A canonical stale-code finding detail (matches the real shape produced by
// checkPm2StaleCodeReal) used by the auto-restart wiring tests.
function staleDetail(pm2AppName, relPath) {
  return (
    `PM2 app '${pm2AppName}' is running stale code: ${relPath} was modified ` +
    `at 2026-09-01T13:04:20.000Z but the process started at ` +
    `2026-09-01T02:45:09.000Z (10h+ earlier) — restart required: pm2 restart ${pm2AppName}`
  );
}

function staleFinding(pm2AppName, relPath) {
  return {
    key: `pm2-stale-code:${pm2AppName}:${relPath}`,
    check: "pm2-stale-code",
    severity: "CRITICAL",
    pm2AppName,
    detail: staleDetail(pm2AppName, relPath),
  };
}

function baseDeps(overrides = {}) {
  const notifyCalls = [];
  const stateStore = fakeStateStore();
  const restartCalls = [];
  return {
    lockFile: SWEEP_LOCK,
    acquireLock,
    releaseLock,
    isAlive: () => false, // overridden per-test
    _fs: fakeFs(),
    lockDir: LOCK_DIR,
    discoverPort: async () => 3000, // overridden per-test
    spawnNotify: (msg) => {
      notifyCalls.push(msg);
      return { pid: 99999 };
    },
    readState: stateStore.readState,
    writeState: stateStore.writeState,
    now: () => 1_000_000,
    log: () => {},
    // NEW checks default to OFFLINE stubs so no real schtasks/pm2 spawns:
    checkScheduledTasks: defaultCheckScheduledTasks, // documented-gap fallback (GAP, no alert)
    checkPm2StaleCode: offlinePm2StaleCodeNoop, // no-op (no findings)
    // Default fake runPm2Restart — records calls, returns success. Tests that
    // exercise the auto-restart wiring override this. Never a real pm2 spawn.
    runPm2Restart: async (appName) => {
      restartCalls.push(appName);
      return { ok: true, stdout: "", stderr: "", error: null, timedOut: false };
    },
    // expose test-side collections for assertions:
    _notifyCalls: notifyCalls,
    _stateStore: stateStore,
    _restartCalls: restartCalls,
    ...overrides,
  };
}

// Helper: write a lock file into a fake fs's initial map.
function lockEntry(pid) {
  return JSON.stringify({ pid, startedAt: "2026-01-01T00:00:00.000Z" });
}

// Helper: create a fake fs pre-populated with lock files.
function fsWithLocks(lockMap) {
  const initial = {};
  for (const [name, pid] of Object.entries(lockMap)) {
    if (pid !== null) initial[path.join(LOCK_DIR, name)] = lockEntry(pid);
  }
  return fakeFs(initial);
}

// =====================================================================
// T1: Paperclip down -> CRITICAL
// =====================================================================
async function t1_paperclipDownCritical() {
  const deps = baseDeps({
    discoverPort: async () => null,
    isAlive: () => true,
  });
  const r = await runStewardOnce(deps);
  const pc = r.findings.find((f) => f.key === "paperclip-canonical");
  assert.ok(pc, "T1: paperclip-canonical finding exists");
  assert.equal(pc.severity, "CRITICAL", "T1: Paperclip down is CRITICAL");
  assert.ok(r.criticalCount >= 1, "T1: at least one critical finding");
  ok("T1: Paperclip down (discoverPort returns null) -> CRITICAL finding");
}

// =====================================================================
// T2: Paperclip up -> no Paperclip finding
// =====================================================================
async function t2_paperclipUpNoFinding() {
  // Provide live daemon locks so no other criticals fire.
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 100 || pid === 101,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 100,
      "heartbeat-daemon.lock": 101,
    }),
  });
  const r = await runStewardOnce(deps);
  const pc = r.findings.find((f) => f.key === "paperclip-canonical");
  assert.equal(pc, undefined, "T2: no paperclip finding when up");
  assert.equal(r.criticalCount, 0, "T2: zero criticals when everything healthy");
  assert.equal(deps._notifyCalls.length, 0, "T2: no alert spawned when healthy");
  ok("T2: Paperclip up (discoverPort returns a port) -> no Paperclip finding");
}

// =====================================================================
// T3: daemon lock missing -> CRITICAL
// =====================================================================
async function t3_daemonLockMissingCritical() {
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: () => true,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 100,
      // heartbeat-daemon.lock MISSING
    }),
  });
  const r = await runStewardOnce(deps);
  const hb = r.findings.find((f) => f.key === "daemon-lock:heartbeat-daemon.lock");
  assert.ok(hb, "T3: heartbeat-daemon.lock finding exists");
  assert.equal(hb.severity, "CRITICAL", "T3: missing daemon lock is CRITICAL");
  assert.ok(/missing/.test(hb.detail), "T3: detail mentions missing");
  ok("T3: daemon lock file missing -> CRITICAL finding");
}

// =====================================================================
// T4: daemon lock dead pid -> CRITICAL
// =====================================================================
async function t4_daemonLockDeadPidCritical() {
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: () => false, // all pids dead
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 200,
      "heartbeat-daemon.lock": 201,
    }),
  });
  const r = await runStewardOnce(deps);
  const tl = r.findings.find((f) => f.key === "daemon-lock:telegram-listener-daemon.lock");
  assert.ok(tl, "T4: telegram-listener-daemon.lock finding exists");
  assert.equal(tl.severity, "CRITICAL", "T4: dead daemon pid is CRITICAL");
  assert.ok(/dead pid 200/.test(tl.detail), "T4: detail mentions dead pid");
  ok("T4: daemon lock file present but pid is dead -> CRITICAL finding");
}

// =====================================================================
// T5: daemon lock live pid -> no finding
// =====================================================================
async function t5_daemonLockLivePidNoFinding() {
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
  });
  const r = await runStewardOnce(deps);
  const daemonFindings = r.findings.filter((f) => f.check === "daemon-health");
  assert.equal(daemonFindings.length, 0, "T5: no daemon findings when both pids live");
  assert.equal(r.criticalCount, 0, "T5: zero criticals");
  ok("T5: daemon lock file present with live pid -> no finding");
}

// =====================================================================
// T6: non-daemon stale lock -> WARNING, not CRITICAL
// =====================================================================
async function t6_staleLockIsWarningNotCritical() {
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301, // daemon pids alive
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
      "ahmad-dispatch.lock": 999, // stale non-daemon lock, pid 999 is dead
      "review-runner.lock": 998, // another stale lock
    }),
  });
  const r = await runStewardOnce(deps);
  const stale1 = r.findings.find((f) => f.key === "stale-lock:ahmad-dispatch.lock");
  const stale2 = r.findings.find((f) => f.key === "stale-lock:review-runner.lock");
  assert.ok(stale1, "T6: ahmad-dispatch stale lock finding exists");
  assert.equal(stale1.severity, "WARNING", "T6: stale non-daemon lock is WARNING, not CRITICAL");
  assert.ok(stale2, "T6: review-runner stale lock finding exists");
  assert.equal(stale2.severity, "WARNING", "T6: second stale lock is also WARNING");
  assert.equal(r.criticalCount, 0, "T6: stale locks do NOT produce criticals");
  assert.equal(r.warningCount, 2, "T6: two warnings from two stale locks");
  assert.equal(deps._notifyCalls.length, 0, "T6: warnings alone do NOT trigger an alert spawn");
  ok("T6: non-daemon stale lock with dead pid -> WARNING (not critical, no alert)");
}

// =====================================================================
// T7: critical findings -> exactly ONE bundled ahmad-notify spawn
// =====================================================================
async function t7_criticalsProduceOneBundledSpawn() {
  const deps = baseDeps({
    discoverPort: async () => null, // Paperclip down
    isAlive: () => false, // all daemon pids dead
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 200,
      "heartbeat-daemon.lock": 201,
    }),
  });
  const r = await runStewardOnce(deps);
  // 3 criticals: Paperclip + 2 daemon locks
  assert.ok(r.criticalCount >= 3, `T7: at least 3 criticals (got ${r.criticalCount})`);
  assert.equal(deps._notifyCalls.length, 1, `T7: exactly ONE ahmad-notify spawn (got ${deps._notifyCalls.length})`);
  assert.equal(r.alerted, true, "T7: alerted flag is true");
  // The single message must contain ALL critical findings bundled together.
  const msg = deps._notifyCalls[0];
  assert.ok(/paperclip-canonical/.test(msg), "T7: bundled message includes Paperclip critical");
  assert.ok(/daemon-lock:telegram-listener-daemon\.lock/.test(msg), "T7: bundled message includes telegram-listener-daemon critical");
  assert.ok(/daemon-lock:heartbeat-daemon\.lock/.test(msg), "T7: bundled message includes heartbeat-daemon critical");
  // Attribution to STEWARD identity is present.
  assert.ok(/OPS-WATCHER/.test(msg), "T7: message attributed to OPS-WATCHER");
  assert.ok(/79060e98-c048-44fb-8c29-2dd3cf5868a6/.test(msg), "T7: message includes STEWARD Paperclip id");
  ok("T7: multiple CRITICAL findings -> exactly ONE bundled ahmad-notify spawn with all criticals");
}

// =====================================================================
// T8: no criticals -> zero spawns
// =====================================================================
async function t8_noCriticalsZeroSpawns() {
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
  });
  const r = await runStewardOnce(deps);
  assert.equal(r.criticalCount, 0, "T8: zero criticals");
  assert.equal(deps._notifyCalls.length, 0, "T8: zero ahmad-notify spawns");
  assert.equal(r.alerted, false, "T8: alerted flag is false");
  ok("T8: zero critical findings -> zero ahmad-notify spawns (no Telegram noise)");
}

// =====================================================================
// T9: cooldown suppresses duplicate re-alert within the window
// =====================================================================
async function t9_cooldownSuppressesWithinWindow() {
  let clock = 1_000_000;
  const deps = baseDeps({
    discoverPort: async () => null,
    isAlive: () => false,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 200,
      "heartbeat-daemon.lock": 201,
    }),
    now: () => clock,
  });

  // First run: should alert (first-ever finding).
  const r1 = await runStewardOnce(deps);
  assert.equal(deps._notifyCalls.length, 1, "T9: first run alerts");
  assert.equal(r1.alerted, true, "T9: first run alerted=true");

  // Advance clock by only 30 minutes (within the 1-hour cooldown).
  clock += 30 * 60 * 1000;

  // Second run: same findings, within cooldown -> suppressed.
  const r2 = await runStewardOnce(deps);
  assert.equal(deps._notifyCalls.length, 1, `T9: second run within cooldown does NOT spawn a new alert (got ${deps._notifyCalls.length})`);
  assert.equal(r2.alerted, false, "T9: second run alerted=false");
  assert.ok(r2.suppressedCount >= 3, "T9: suppressedCount reflects the suppressed criticals");

  ok("T9: same critical finding within 1-hour cooldown -> suppressed (no duplicate alert)");
}

// =====================================================================
// T10: re-alerts after cooldown passes
// =====================================================================
async function t10_reAlertsAfterCooldown() {
  let clock = 5_000_000;
  const deps = baseDeps({
    discoverPort: async () => null,
    isAlive: () => false,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 200,
      "heartbeat-daemon.lock": 201,
    }),
    now: () => clock,
  });

  // First run: alert.
  await runStewardOnce(deps);
  assert.equal(deps._notifyCalls.length, 1, "T10: first run alerts");

  // Advance clock past the 1-hour cooldown.
  clock += 60 * 60 * 1000 + 1;

  // Second run: same findings, past cooldown -> re-alerts.
  const r2 = await runStewardOnce(deps);
  assert.equal(deps._notifyCalls.length, 2, `T10: second run past cooldown re-alerts (got ${deps._notifyCalls.length})`);
  assert.equal(r2.alerted, true, "T10: second run alerted=true");

  ok("T10: same critical finding past 1-hour cooldown -> re-alerts");
}

// =====================================================================
// T11: cleared finding re-alerts immediately on fresh recurrence
// =====================================================================
async function t11_clearedFindingReAlertsImmediately() {
  let clock = 10_000_000;
  let paperclipUp = false;
  let daemonAlive = false;

  const deps = baseDeps({
    discoverPort: async () => (paperclipUp ? 3000 : null),
    isAlive: () => daemonAlive,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 200,
      "heartbeat-daemon.lock": 201,
    }),
    now: () => clock,
  });

  // Run 1: Paperclip down, daemons dead -> alert.
  await runStewardOnce(deps);
  assert.equal(deps._notifyCalls.length, 1, "T11: run 1 alerts (Paperclip down)");

  // Run 2: everything recovers -> no criticals, state cleared.
  paperclipUp = true;
  daemonAlive = true;
  const r2 = await runStewardOnce(deps);
  assert.equal(r2.criticalCount, 0, "T11: run 2 has zero criticals (recovered)");
  assert.equal(deps._notifyCalls.length, 1, "T11: run 2 does not alert (no criticals)");
  // State for the previously-critical keys should be cleared.
  const stored = deps._stateStore.getStored();
  assert.equal(Object.keys(stored.alerts).length, 0, "T11: state cleared when no longer critical");

  // Run 3: Paperclip goes down again, daemons die again -> FRESH recurrence.
  // Only 5 minutes have passed (well within the 1-hour cooldown), but since
  // the state was cleared in run 2, this should alert IMMEDIATELY.
  paperclipUp = false;
  daemonAlive = false;
  clock += 5 * 60 * 1000;
  const r3 = await runStewardOnce(deps);
  assert.equal(deps._notifyCalls.length, 2, `T11: run 3 alerts immediately on fresh recurrence despite short elapsed time (got ${deps._notifyCalls.length})`);
  assert.equal(r3.alerted, true, "T11: run 3 alerted=true");

  ok("T11: cleared finding re-alerts immediately on fresh recurrence (state was cleared when it recovered)");
}

// =====================================================================
// T12: single-instance lock — two concurrent runStewardOnce calls, only one
// actually runs. Mirrors the T7 pattern from ahmad-dispatch.regression.test.mjs:
// sweep A acquires the lock and provably enters its checks (its discoverPort
// call only fires after the lock is held), then sweep B is launched against
// the same state and must be refused before doing any checks.
// =====================================================================
async function t12_singleInstanceLockOnlyOneRuns() {
  // Use a fresh fake fs for the lock file. Both sweeps share it so B sees A's
  // lock file written by the real acquireLock.
  const sharedFs = fakeFs();
  let discoverCalls = 0;
  let signalAInSweep;
  const aInSweep = new Promise((res) => { signalAInSweep = res; });

  const WINNER_PID = 424242;
  const isAlive = (pid) => pid === WINNER_PID;

  let notifyCount = 0;

  const sharedDeps = {
    lockFile: SWEEP_LOCK,
    acquireLock,
    releaseLock,
    isAlive,
    _fs: sharedFs,
    lockDir: LOCK_DIR,
    discoverPort: async () => {
      discoverCalls += 1;
      // The FIRST discoverPort call is sweep A entering its checks — signal B
      // to launch now. A is past the lock; B will see it held.
      if (discoverCalls === 1) signalAInSweep();
      // Small delay so A is still in its checks when B launches.
      await new Promise((r) => setTimeout(r, 25));
      return null; // Paperclip down -> critical (so A would alert)
    },
    spawnNotify: () => { notifyCount += 1; return { pid: 88888 }; },
    readState: async () => ({ alerts: {} }),
    writeState: async () => {},
    now: () => 20_000_000,
    log: () => {},
    // NEW checks default to OFFLINE stubs so the concurrent-sweep test never
    // spawns real schtasks/pm2:
    checkScheduledTasks: defaultCheckScheduledTasks,
    checkPm2StaleCode: offlinePm2StaleCodeNoop,
  };

  // Pre-populate daemon locks so A has criticals (to prove A actually ran its
  // checks and B did not).
  sharedFs.writeFile(
    path.join(LOCK_DIR, "telegram-listener-daemon.lock"),
    lockEntry(WINNER_PID),
  );
  // Make isAlive return true for the daemon pid so the only critical is
  // Paperclip-down (simpler to assert). But we also need isAlive to return
  // true for WINNER_PID (the lock holder). Both are WINNER_PID so this works.
  // Actually we need the daemon pids to be ALIVE so they're not critical.
  // Let's use different pids for the daemon locks.
  // Rewrite: use alive daemon pids.
  sharedFs.writeFile(
    path.join(LOCK_DIR, "telegram-listener-daemon.lock"),
    lockEntry(555),
  );
  // isAlive only returns true for WINNER_PID, so 555 is "dead" -> that would
  // be critical. Let's fix isAlive to also return true for 555.
  // Actually, let's keep it simple: make isAlive return true for WINNER_PID
  // and 555 and 556.
  sharedFs.writeFile(
    path.join(LOCK_DIR, "heartbeat-daemon.lock"),
    lockEntry(556),
  );

  // Override isAlive to also treat daemon pids as alive.
  sharedDeps.isAlive = (pid) => pid === WINNER_PID || pid === 555 || pid === 556;

  // Launch sweep A (do not await yet) — it acquires the lock and enters checks.
  const pA = runStewardOnce({
    ...sharedDeps,
    lockPid: WINNER_PID,
  });

  // Wait until A has provably acquired the lock and is inside its checks.
  await aInSweep;

  // NOW launch sweep B against the same live state while A is still running.
  const rB = await runStewardOnce({
    ...sharedDeps,
    lockPid: WINNER_PID + 1,
  });

  // Collect A's result.
  const rA = await pA;

  // ---- Assertions ----
  assert.equal(rB.refused, true, "T12: sweep B is refused (lock held by A)");
  assert.ok(rB.pid === WINNER_PID, "T12: B's refused pid is A's lock pid");
  assert.equal(rB.findings.length, 0, "T12: refused sweep records no findings (no checks performed)");

  // A ran its checks: discoverPort was called exactly once (B never called it).
  assert.equal(discoverCalls, 1, `T12: discoverPort called exactly once (B never ran checks) — got ${discoverCalls}`);

  // A found the Paperclip-down critical and alerted exactly once.
  assert.ok(rA.findings.some((f) => f.key === "paperclip-canonical"), "T12: sweep A found the Paperclip critical");
  assert.equal(notifyCount, 1, `T12: exactly one ahmad-notify spawn (only A alerts, B is refused) — got ${notifyCount}`);

  ok("T12: single-instance lock — two concurrent STEWARD sweeps, only one actually runs (B refused before any checks)");
}

// ---- identity export sanity check ----
function t0_identityExport() {
  assert.equal(
    STEWARD_AGENT_ID,
    "79060e98-c048-44fb-8c29-2dd3cf5868a6",
    "T0: STEWARD_AGENT_ID matches the OWNER-approved canonical OPS-WATCHER Paperclip identity",
  );
  ok("T0: STEWARD_AGENT_ID exported and matches the OWNER-approved identity id");
}

// =====================================================================
// NEW CHECK 3 (scheduled tasks, real): schtasks /query via injected runSchtasks.
// Tests the REAL checkScheduledTasksReal directly with dependency-injected
// runSchtasks fixtures — no real schtasks process is ever spawned.
// =====================================================================

// Helper: build a schtasks /query /fo LIST stdout block for one task.
function schtasksStdout(taskName, status) {
  return (
    `\r\nFolder: \\\r\n` +
    `HostName:      LAPTOP-TEST\r\n` +
    `TaskName:      \\${taskName}\r\n` +
    `Next Run Time: N/A\r\n` +
    `Status:        ${status}\r\n` +
    `Logon Mode:    Interactive only\r\n`
  );
}

// T13: happy path — PM2-Resurrect Ready, all 3 legacy tasks Disabled ->
// { checked:true, severity:null } (gap closed, no finding).
async function t13_schtasksHappyPath() {
  const calls = [];
  const runSchtasks = async (name) => {
    calls.push(name);
    if (name === "FounderOS-Aidit-PM2-Resurrect") {
      return { code: 0, stdout: schtasksStdout(name, "Ready"), stderr: "", timedOut: false };
    }
    return { code: 0, stdout: schtasksStdout(name, "Disabled"), stderr: "", timedOut: false };
  };
  const r = await checkScheduledTasksReal({ runSchtasks });
  assert.equal(r.checked, true, "T13: checked true");
  assert.equal(r.severity, null, "T13: severity null (gap closed, all good)");
  assert.ok(/Ready/.test(r.reason), "T13: reason mentions Ready");
  assert.ok(/Disabled/.test(r.reason), "T13: reason mentions Disabled");
  assert.equal(calls.length, 4, "T13: queried all 4 tasks exactly once");
  ok("T13: schtasks happy path (Resurrect Ready, legacy Disabled) -> { checked:true, severity:null } (gap closed)");
}

// T14: finds a problem — (a) a legacy task re-enabled, (b) PM2-Resurrect
// disabled. Both -> CRITICAL.
async function t14_schtasksFindsProblem() {
  // (a) FounderOS-Aidit-Heartbeat re-enabled (Ready) while Resurrect is Ready.
  const runSchtasksA = async (name) => {
    if (name === "FounderOS-Aidit-PM2-Resurrect") {
      return { code: 0, stdout: schtasksStdout(name, "Ready"), stderr: "", timedOut: false };
    }
    if (name === "FounderOS-Aidit-Heartbeat") {
      return { code: 0, stdout: schtasksStdout(name, "Ready"), stderr: "", timedOut: false };
    }
    return { code: 0, stdout: schtasksStdout(name, "Disabled"), stderr: "", timedOut: false };
  };
  const rA = await checkScheduledTasksReal({ runSchtasks: runSchtasksA });
  assert.equal(rA.severity, "CRITICAL", "T14a: legacy re-enabled -> CRITICAL");
  assert.equal(rA.checked, true, "T14a: checked true (schtasks ran)");
  assert.ok(/Heartbeat.*re-enabled/.test(rA.reason), "T14a: reason names the re-enabled legacy task");

  // (b) PM2-Resurrect disabled (all tasks Disabled).
  const runSchtasksB = async (name) => ({
    code: 0,
    stdout: schtasksStdout(name, "Disabled"),
    stderr: "",
    timedOut: false,
  });
  const rB = await checkScheduledTasksReal({ runSchtasks: runSchtasksB });
  assert.equal(rB.severity, "CRITICAL", "T14b: PM2-Resurrect disabled -> CRITICAL");
  assert.ok(/PM2-Resurrect is not Ready/i.test(rB.reason), "T14b: reason names PM2-Resurrect not being Ready");

  // (c) PM2-Resurrect task missing entirely (schtasks exits non-zero, no Status
  // line) — treated as "not Ready/enabled" -> CRITICAL (not a schtasks-unavailable
  // GAP, because schtasks itself DID run and exit non-zero).
  const runSchtasksC = async (name) => {
    if (name === "FounderOS-Aidit-PM2-Resurrect") {
      return { code: 1, stdout: "", stderr: "ERROR: The system cannot find the file specified.", timedOut: false };
    }
    return { code: 0, stdout: schtasksStdout(name, "Disabled"), stderr: "", timedOut: false };
  };
  const rC = await checkScheduledTasksReal({ runSchtasks: runSchtasksC });
  assert.equal(rC.severity, "CRITICAL", "T14c: PM2-Resurrect task missing -> CRITICAL (not a GAP)");
  ok("T14: schtasks finds a problem (legacy re-enabled / Resurrect disabled / Resurrect missing) -> CRITICAL");
}

// T15: schtasks itself errors (spawn-level, code null / thrown) -> falls back
// to GAP, never a false all-clear.
async function t15_schtasksErrorsGraceful() {
  // (a) schtasks binary unavailable (spawn-level failure, code null).
  const runSchtasksA = async () => ({
    code: null,
    stdout: "",
    stderr: "spawn schtasks ENOENT",
    timedOut: false,
  });
  const rA = await checkScheduledTasksReal({ runSchtasks: runSchtasksA });
  assert.equal(rA.checked, false, "T15a: checked false (fell back to GAP)");
  assert.equal(rA.severity, "GAP", "T15a: severity GAP");
  assert.ok(/schtasks unavailable/.test(rA.reason), "T15a: reason explains schtasks unavailable");

  // (b) runSchtasks throws — caught per-query, treated as spawn-level failure
  // on the resurrect query -> GAP fallback.
  const runSchtasksB = async () => { throw new Error("boom"); };
  const rB = await checkScheduledTasksReal({ runSchtasks: runSchtasksB });
  assert.equal(rB.severity, "GAP", "T15b: thrown runSchtasks -> GAP fallback");
  assert.equal(rB.checked, false, "T15b: checked false");
  ok("T15: schtasks itself errors (ENOENT / throws) -> falls back to GAP (no false all-clear)");
}

// =====================================================================
// NEW CHECK 5 (pm2 stale-code drift): pm2 jlist via injected runPm2Jlist and
// fs.stat via injected statFile. Tests the REAL checkPm2StaleCodeReal directly
// — no real pm2 process is ever spawned.
// =====================================================================

// T16: happy path — file mtime is BEFORE process start (process started after
// the file was last edited) -> no findings.
async function t16_pm2StaleCodeHappy() {
  const startTime = 1787971509828; // 2026-08-29T02:45:09.828Z
  const mtimeBeforeStart = startTime - 3600000; // 1h BEFORE start
  const runPm2Jlist = async () => ({
    ok: true,
    list: [
      { name: "heartbeat", pm2_env: { pm_uptime: startTime } },
      { name: "telegram-listener", pm2_env: { pm_uptime: startTime } },
    ],
    error: null,
    timedOut: false,
  });
  const statFile = async () => mtimeBeforeStart;
  const findings = await checkPm2StaleCodeReal({ runPm2Jlist, statFile });
  assert.equal(findings.length, 0, "T16: no findings when file mtime is before process start");
  ok("T16: pm2 stale-code happy path (mtime before start) -> no finding");
}

// T17: catches the exact tonight's-incident shape — file mtime AFTER process
// start -> CRITICAL, with the detail phrased like the incident report.
async function t17_pm2StaleCodeCatchesIncident() {
  const startedAt = 1787971509828; // 2026-08-29T02:45:09.828Z (the stale process)
  const mtimeMs = 1787983460939; // 2026-08-29T06:04:20.939Z (the on-disk fix)
  const runPm2Jlist = async () => ({
    ok: true,
    list: [{ name: "heartbeat", pm2_env: { pm_uptime: startedAt } }],
    error: null,
    timedOut: false,
  });
  const statFile = async (_root, rel) =>
    rel === "ops-watcher/heartbeat.mjs" ? mtimeMs : 0;
  const findings = await checkPm2StaleCodeReal({ runPm2Jlist, statFile });
  assert.equal(findings.length, 1, "T17: exactly one CRITICAL finding");
  const f = findings[0];
  assert.equal(f.severity, "CRITICAL", "T17: severity CRITICAL");
  assert.equal(f.check, "pm2-stale-code", "T17: check field is pm2-stale-code");
  assert.ok(/heartbeat/.test(f.key), "T17: key mentions heartbeat");
  assert.ok(/running stale code/.test(f.detail), "T17: detail says 'running stale code'");
  assert.ok(/heartbeat\.mjs/.test(f.detail), "T17: detail names the watched file");
  assert.ok(/pm2 restart heartbeat/.test(f.detail), "T17: detail gives the restart command");
  assert.ok(/2026-08-29T02:45:09/.test(f.detail), "T17: detail includes the process start ISO time");
  assert.ok(/h\+/.test(f.detail), "T17: detail includes the staleness age (Nh+ earlier)");
  ok("T17: pm2 stale-code catches tonight's-incident shape (mtime after start) -> CRITICAL");
}

// T18: pm2 stale-code call itself errors / times out -> degrades to a single
// WARNING (no crash, no false all-clear).
async function t18_pm2StaleCodeDegradesOnError() {
  // (a) pm2 jlist times out -> single WARNING.
  const runPm2JlistTimeout = async () => ({
    ok: false,
    list: null,
    error: "pm2 jlist timed out after 8000ms",
    timedOut: true,
  });
  const findingsA = await checkPm2StaleCodeReal({
    runPm2Jlist: runPm2JlistTimeout,
    statFile: async () => 0,
  });
  assert.equal(findingsA.length, 1, "T18a: one finding on timeout");
  assert.equal(findingsA[0].severity, "WARNING", "T18a: timeout -> WARNING (not critical, not silent)");
  assert.ok(/timed out/.test(findingsA[0].detail), "T18a: detail mentions the timeout");

  // (b) runPm2Jlist throws -> caught -> single WARNING.
  const runPm2JlistThrow = async () => { throw new Error("pm2 exploded"); };
  const findingsB = await checkPm2StaleCodeReal({
    runPm2Jlist: runPm2JlistThrow,
    statFile: async () => 0,
  });
  assert.equal(findingsB.length, 1, "T18b: one finding on throw");
  assert.equal(findingsB[0].severity, "WARNING", "T18b: throw -> WARNING");
  assert.ok(/could not run pm2 jlist/.test(findingsB[0].detail), "T18b: detail explains the failure");
  ok("T18: pm2 stale-code call errors/times out -> degrades to WARNING (no crash, no false all-clear)");
}

// =====================================================================
// Wiring tests: the two new checks' CRITICAL findings flow through
// runStewardOnce into exactly ONE bundled ahmad-notify alert (same bundling/
// cooldown behavior as every other CRITICAL). Healthy Paperclip + healthy
// daemon locks so the ONLY critical is the injected one.
// =====================================================================

// T19: scheduled-tasks CRITICAL (e.g. PM2-Resurrect disabled) wires through to
// one bundled alert.
async function t19_schtasksCriticalWiresToAlert() {
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
    checkScheduledTasks: async () => ({
      checked: true,
      severity: "CRITICAL",
      reason: "FounderOS-Aidit-PM2-Resurrect is not Ready/enabled (statuses: Disabled)",
    }),
  });
  const r = await runStewardOnce(deps);
  assert.equal(r.criticalCount, 1, "T19: exactly one critical (the schtasks one)");
  const st = r.findings.find((f) => f.key === "scheduled-tasks");
  assert.ok(st, "T19: scheduled-tasks finding present");
  assert.equal(st.severity, "CRITICAL", "T19: scheduled-tasks finding is CRITICAL");
  assert.equal(deps._notifyCalls.length, 1, "T19: one alert spawned");
  assert.ok(/PM2-Resurrect is not Ready/.test(deps._notifyCalls[0]), "T19: alert message includes the schtasks reason");
  ok("T19: schtasks CRITICAL finding wires through runStewardOnce -> one bundled alert");
}

// T20: pm2 stale-code CRITICAL wires through to one bundled alert.
async function t20_pm2StaleCodeCriticalWiresToAlert() {
  const staleFinding = {
    key: "pm2-stale-code:heartbeat:ops-watcher/heartbeat.mjs",
    check: "pm2-stale-code",
    severity: "CRITICAL",
    detail: "PM2 app 'heartbeat' is running stale code: ops-watcher/heartbeat.mjs was modified at ... but the process started at ... — restart required: pm2 restart heartbeat",
  };
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
    checkPm2StaleCode: async () => [staleFinding],
  });
  const r = await runStewardOnce(deps);
  assert.equal(r.criticalCount, 1, "T20: exactly one critical (the pm2 stale-code one)");
  const f = r.findings.find((x) => x.check === "pm2-stale-code");
  assert.ok(f, "T20: pm2-stale-code finding present");
  assert.equal(f.severity, "CRITICAL", "T20: pm2-stale-code finding is CRITICAL");
  assert.equal(deps._notifyCalls.length, 1, "T20: one alert spawned");
  assert.ok(/running stale code/.test(deps._notifyCalls[0]), "T20: alert message includes the stale-code detail");
  ok("T20: pm2-stale-code CRITICAL finding wires through runStewardOnce -> one bundled alert");
}

// =====================================================================
// AUTO-RESTART wiring tests (STEP C): a pm2-stale-code CRITICAL finding
// triggers runPm2Restart, the finding's detail is rewritten to report the
// OUTCOME, and the 5-minute cooldown (tracked in the state file under a
// separate `restarts` key) prevents restart loops. All fully injected —
// never a real pm2 restart spawn.
// =====================================================================

// T21: stale CRITICAL with NO prior restart-attempt record -> runPm2Restart IS
// called with the correct app name; on success, the finding's detail reflects
// "auto-restarted"; state file records the attempt timestamp.
async function t21_pm2AutoRestartSuccess() {
  const restartCalls = [];
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
    checkPm2StaleCode: async () => [
      staleFinding("heartbeat", "ops-watcher/heartbeat.mjs"),
    ],
    runPm2Restart: async (appName) => {
      restartCalls.push(appName);
      return {
        ok: true,
        stdout: "[PM2] Applying action restartProcessId on app",
        stderr: "",
        error: null,
        timedOut: false,
      };
    },
  });
  const r = await runStewardOnce(deps);
  assert.equal(restartCalls.length, 1, `T21: runPm2Restart called exactly once (got ${restartCalls.length})`);
  assert.equal(restartCalls[0], "heartbeat", "T21: runPm2Restart called with 'heartbeat'");
  const f = r.findings.find((x) => x.check === "pm2-stale-code");
  assert.ok(f, "T21: pm2-stale-code finding present");
  assert.equal(f.severity, "CRITICAL", "T21: severity stays CRITICAL (owner still informed)");
  assert.ok(/auto-restarted by STEWARD/.test(f.detail), "T21: detail says auto-restarted");
  assert.ok(/pm2 restart heartbeat succeeded/.test(f.detail), "T21: detail mentions the successful restart");
  assert.ok(/will re-verify fresh on next sweep/.test(f.detail), "T21: detail mentions re-verification");
  assert.ok(!/restart required: pm2 restart heartbeat/.test(f.detail), "T21: detail no longer says 'restart required'");
  // State records the attempt timestamp.
  const stored = deps._stateStore.getStored();
  assert.ok(stored.restarts, "T21: state has a restarts key");
  const rec = stored.restarts["pm2-stale-code:heartbeat:ops-watcher/heartbeat.mjs"];
  assert.ok(rec, "T21: restart attempt recorded for the exact finding key");
  assert.ok(
    Number.isFinite(rec.restartAttemptedAt),
    "T21: restartAttemptedAt is a finite number",
  );
  ok("T21: stale CRITICAL, no prior restart -> auto-restart succeeds, detail reflects it, state records attempt");
}

// T22: stale CRITICAL, injected runPm2Restart returns ok:false -> finding
// detail still says restart is needed / auto-restart failed, mentions the
// failure; state file STILL records the attempt (so cooldown still applies).
async function t22_pm2AutoRestartFailure() {
  const restartCalls = [];
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
    checkPm2StaleCode: async () => [
      staleFinding("heartbeat", "ops-watcher/heartbeat.mjs"),
    ],
    runPm2Restart: async (appName) => {
      restartCalls.push(appName);
      return {
        ok: false,
        stdout: "",
        stderr: "Error: process not found",
        error: "pm2 restart heartbeat exited with code 1",
        timedOut: false,
      };
    },
  });
  const r = await runStewardOnce(deps);
  assert.equal(restartCalls.length, 1, "T22: runPm2Restart called exactly once");
  const f = r.findings.find((x) => x.check === "pm2-stale-code");
  assert.ok(f, "T22: pm2-stale-code finding present");
  assert.equal(f.severity, "CRITICAL", "T22: severity stays CRITICAL");
  // The original "restart required" wording is KEPT (owner still needs to act).
  assert.ok(/restart required: pm2 restart heartbeat/.test(f.detail), "T22: detail keeps 'restart required' wording");
  // The failure is appended (the errTxt logic prefers the `error` field).
  assert.ok(/auto-restart attempt failed/.test(f.detail), "T22: detail mentions auto-restart failure");
  assert.ok(/exited with code 1/.test(f.detail), "T22: detail includes the error text");
  // State STILL records the attempt (cooldown applies even on failure).
  const stored = deps._stateStore.getStored();
  assert.ok(stored.restarts, "T22: state has a restarts key");
  const rec = stored.restarts["pm2-stale-code:heartbeat:ops-watcher/heartbeat.mjs"];
  assert.ok(rec, "T22: restart attempt recorded even on failure");
  assert.ok(Number.isFinite(rec.restartAttemptedAt), "T22: restartAttemptedAt is a finite number");
  ok("T22: stale CRITICAL, restart fails -> detail says restart needed + failure, state records attempt (cooldown applies)");
}

// T23: stale CRITICAL where the state file already has a restartAttemptedAt
// within the last 5 minutes for that exact key -> runPm2Restart is NOT called
// again (skip, avoid restart-loop); detail text explains why.
async function t23_pm2AutoRestartCooldownSkip() {
  const restartCalls = [];
  let clock = 1_000_000;
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
    now: () => clock,
    checkPm2StaleCode: async () => [
      staleFinding("heartbeat", "ops-watcher/heartbeat.mjs"),
    ],
    runPm2Restart: async (appName) => {
      restartCalls.push(appName);
      return { ok: true, stdout: "", stderr: "", error: null, timedOut: false };
    },
  });

  // Run 1: no prior restart -> restart attempted (success).
  await runStewardOnce(deps);
  assert.equal(restartCalls.length, 1, "T23: first run calls runPm2Restart");

  // Advance clock by only 2 minutes (within the 5-minute restart cooldown).
  clock += 2 * 60 * 1000;

  // Run 2: same stale finding, restart within cooldown -> SKIP.
  const r2 = await runStewardOnce(deps);
  assert.equal(
    restartCalls.length,
    1,
    `T23: second run within cooldown does NOT call runPm2Restart again (got ${restartCalls.length})`,
  );
  const f = r2.findings.find((x) => x.check === "pm2-stale-code");
  assert.ok(f, "T23: pm2-stale-code finding still present on run 2");
  // The original "restart required" wording is KEPT.
  assert.ok(/restart required: pm2 restart heartbeat/.test(f.detail), "T23: detail keeps 'restart required' wording");
  // The skip reason is appended.
  assert.ok(/auto-restart already attempted/.test(f.detail), "T23: detail explains auto-restart was already attempted");
  assert.ok(/skipping to avoid a restart loop/.test(f.detail), "T23: detail mentions restart-loop prevention");
  assert.ok(/manual investigation needed if this persists/.test(f.detail), "T23: detail recommends manual investigation");
  ok("T23: stale CRITICAL with recent prior restart attempt -> runPm2Restart NOT called, detail explains skip");
}

// T24: two simultaneous pm2-stale-code findings (two different stale apps in
// one sweep) -> both get independently restart-attempted, one succeeding and
// one failing, and both outcomes are correctly reflected without one
// affecting the other.
async function t24_twoStaleFindingsIndependent() {
  const restartCalls = [];
  const deps = baseDeps({
    discoverPort: async () => 3000,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
    checkPm2StaleCode: async () => [
      staleFinding("heartbeat", "ops-watcher/heartbeat.mjs"),
      staleFinding("telegram-listener", "ops-watcher/telegram-listener-daemon.mjs"),
    ],
    runPm2Restart: async (appName) => {
      restartCalls.push(appName);
      if (appName === "heartbeat") {
        return { ok: true, stdout: "", stderr: "", error: null, timedOut: false };
      }
      // telegram-listener fails.
      return {
        ok: false,
        stdout: "",
        stderr: "process not found",
        error: "pm2 restart telegram-listener exited with code 1",
        timedOut: false,
      };
    },
  });
  const r = await runStewardOnce(deps);
  // Both apps were independently restart-attempted.
  assert.equal(restartCalls.length, 2, `T24: runPm2Restart called for both apps (got ${restartCalls.length})`);
  assert.ok(restartCalls.includes("heartbeat"), "T24: heartbeat restart attempted");
  assert.ok(restartCalls.includes("telegram-listener"), "T24: telegram-listener restart attempted");

  const hb = r.findings.find((x) => x.key === "pm2-stale-code:heartbeat:ops-watcher/heartbeat.mjs");
  const tl = r.findings.find((x) => x.key === "pm2-stale-code:telegram-listener:ops-watcher/telegram-listener-daemon.mjs");
  assert.ok(hb, "T24: heartbeat finding present");
  assert.ok(tl, "T24: telegram-listener finding present");

  // Heartbeat succeeded -> detail says auto-restarted.
  assert.ok(/auto-restarted by STEWARD/.test(hb.detail), "T24: heartbeat detail says auto-restarted (success)");
  assert.ok(!/auto-restart attempt failed/.test(hb.detail), "T24: heartbeat detail does NOT mention failure");
  assert.ok(!/restart required: pm2 restart heartbeat/.test(hb.detail), "T24: heartbeat detail no longer says 'restart required'");

  // Telegram-listener failed -> detail keeps 'restart required' + failure.
  assert.ok(/restart required: pm2 restart telegram-listener/.test(tl.detail), "T24: telegram-listener detail keeps 'restart required' wording");
  assert.ok(/auto-restart attempt failed/.test(tl.detail), "T24: telegram-listener detail says auto-restart failed");
  assert.ok(!/auto-restarted by STEWARD/.test(tl.detail), "T24: telegram-listener detail does NOT mention success");

  // Both recorded independently in state.
  const stored = deps._stateStore.getStored();
  assert.ok(stored.restarts, "T24: state has a restarts key");
  assert.ok(stored.restarts["pm2-stale-code:heartbeat:ops-watcher/heartbeat.mjs"], "T24: heartbeat restart recorded");
  assert.ok(stored.restarts["pm2-stale-code:telegram-listener:ops-watcher/telegram-listener-daemon.mjs"], "T24: telegram-listener restart recorded");

  ok("T24: two simultaneous stale findings -> both independently restart-attempted, outcomes correct and independent");
}

// T25: runPm2Restart throwing synchronously -> caught, does not crash
// runStewardOnce, the rest of the sweep (other checks, other findings) still
// completes normally.
async function t25_runPm2RestartThrowCaught() {
  let otherCheckRan = false;
  const deps = baseDeps({
    discoverPort: async () => { otherCheckRan = true; return 3000; },
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
    checkPm2StaleCode: async () => [
      staleFinding("heartbeat", "ops-watcher/heartbeat.mjs"),
    ],
    runPm2Restart: async () => { throw new Error("synchronous boom"); },
  });
  const r = await runStewardOnce(deps);
  // Sweep did not crash.
  assert.ok(r, "T25: runStewardOnce returned (did not crash)");
  assert.equal(r.refused, undefined, "T25: not refused");
  // Other checks still ran (discoverPort was called and returned 3000).
  assert.ok(otherCheckRan, "T25: other checks (discoverPort) still ran after the throw");
  // The stale finding is still present (the throw was caught, not fatal).
  const f = r.findings.find((x) => x.check === "pm2-stale-code");
  assert.ok(f, "T25: pm2-stale-code finding still present after throw");
  assert.equal(f.severity, "CRITICAL", "T25: severity still CRITICAL");
  // The detail reflects the auto-restart failure (the throw was caught and
  // recorded as a failure outcome).
  assert.ok(/auto-restart attempt failed/.test(f.detail), "T25: detail mentions the auto-restart failure");
  assert.ok(/synchronous boom/.test(f.detail), "T25: detail includes the throw message");
  ok("T25: runPm2Restart throwing -> caught, sweep completes, other checks still run");
}

// =====================================================================
// RETRY wiring tests (Check 1): STEWARD now calls discoverPort with
// { attempts: 3, retryDelayMs: 1500 } so a single transient probe miss under
// load is no longer escalated to CRITICAL + owner alert. The injected
// discoverPort stub may ignore the second argument — nothing must break.
// =====================================================================

// T26: discoverPort returning null still produces exactly ONE CRITICAL
// paperclip-canonical finding, and its detail states the retries ("setelah 3
// percobaan"). The key/check stay "paperclip-canonical" (cooldown state keys
// off them).
async function t26_paperclipDownCriticalWithRetryDetail() {
  const deps = baseDeps({
    discoverPort: async () => null,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
  });
  const r = await runStewardOnce(deps);
  const pcFindings = r.findings.filter((f) => f.key === "paperclip-canonical");
  assert.equal(pcFindings.length, 1, `T26: exactly one paperclip-canonical finding (got ${pcFindings.length})`);
  assert.equal(pcFindings[0].severity, "CRITICAL", "T26: it is CRITICAL");
  assert.equal(pcFindings[0].check, "paperclip-canonical", "T26: check value preserved exactly");
  assert.ok(
    /setelah 3 percobaan/.test(pcFindings[0].detail),
    `T26: detail states the retries in Bahasa Indonesia ("setelah 3 percobaan"), got: ${pcFindings[0].detail}`,
  );
  ok("T26: discoverPort null -> exactly one CRITICAL paperclip-canonical finding, detail mentions 'setelah 3 percobaan'");
}

// T27: discoverPort returning a port still produces NO paperclip-canonical
// finding (the retry does not introduce a false finding on success).
async function t27_paperclipUpNoFindingWithRetry() {
  const deps = baseDeps({
    discoverPort: async () => 3110,
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
  });
  const r = await runStewardOnce(deps);
  const pc = r.findings.find((f) => f.key === "paperclip-canonical");
  assert.equal(pc, undefined, "T27: no paperclip-canonical finding when discoverPort returns a port");
  assert.equal(r.criticalCount, 0, "T27: zero criticals when healthy");
  ok("T27: discoverPort returning a port -> no paperclip-canonical finding (retry does not add false findings)");
}

// T28: STEWARD passes { attempts: 3, retryDelayMs: 1500 } as the SECOND
// argument to the injected discoverPort. The first argument is undefined
// (read the real on-disk config).
async function t28_stewardPassesRetryOptsToDiscoverPort() {
  let lastCall = null;
  const deps = baseDeps({
    discoverPort: async (injected, opts) => {
      lastCall = { injected, opts };
      return 3110;
    },
    isAlive: (pid) => pid === 300 || pid === 301,
    _fs: fsWithLocks({
      "telegram-listener-daemon.lock": 300,
      "heartbeat-daemon.lock": 301,
    }),
  });
  await runStewardOnce(deps);
  assert.ok(lastCall, "T28: discoverPort was called");
  assert.equal(lastCall.injected, undefined, "T28: first arg is undefined (read real config, not an injected one)");
  assert.deepEqual(
    lastCall.opts,
    { attempts: 3, retryDelayMs: 1500 },
    `T28: second arg is exactly { attempts: 3, retryDelayMs: 1500 }, got ${JSON.stringify(lastCall.opts)}`,
  );
  ok("T28: STEWARD passes { attempts: 3, retryDelayMs: 1500 } as the second argument to discoverPort");
}

// =====================================================================
// Runner
// =====================================================================
// =====================================================================
// T29: a notify spawn that never started must not advance the cooldown.
// spawnNotify reports that by RETURN VALUE ({ pid: undefined }), not by
// throwing, so the old try/catch caught nothing and alerted=true stamped an
// hour of silence on an alert the owner never received.
// =====================================================================
async function t29_failedSpawnDoesNotAdvanceCooldown() {
  let clock = 1_000_000;
  let spawnOk = false;
  let spawnCalls = 0;
  const deps = baseDeps({
    now: () => clock,
    discoverPort: async () => null, // Paperclip down -> a CRITICAL finding
    isAlive: () => true,
    spawnNotify: () => { spawnCalls += 1; return spawnOk ? { pid: 4242 } : { pid: undefined }; },
  });

  const r1 = await runStewardOnce(deps);
  assert.ok(r1.criticalCount >= 1, "T29: at least one critical was found");
  assert.equal(r1.alerted, false, "T29: a spawn with no pid is not a delivered alert");

  // One minute later, far inside the 1-hour cooldown. The finding never
  // reached the owner, so it must be retried rather than suppressed.
  clock += 60 * 1000;
  spawnOk = true;
  const r2 = await runStewardOnce(deps);
  assert.equal(r2.alerted, true, "T29: an undelivered finding is retried on the next sweep");
  assert.equal(r2.suppressedCount, 0, "T29: it was never counted as suppressed");
  assert.equal(spawnCalls, 2, "T29: both attempts really called spawnNotify");
  ok("T29: a failed notify spawn does not stamp the cooldown");
}

// =====================================================================
// T30: the restart cooldown must survive the alert-state write. The two live
// under separate keys and the alert path rewrites the state object.
// =====================================================================
async function t30_failedSpawnKeepsRestartState() {
  let clock = 1_000_000;
  const deps = baseDeps({
    now: () => clock,
    discoverPort: async () => null,
    isAlive: () => true,
    spawnNotify: () => ({ pid: null, error: "spawn ENOENT" }),
  });
  await deps.writeState(null, { alerts: {}, restarts: { "pm2:heartbeat": { at: 123 } } });
  const r = await runStewardOnce(deps);
  assert.equal(r.alerted, false, "T30: an errored spawn is not a delivered alert");
  const saved = await deps.readState(null);
  assert.deepEqual(saved.restarts, { "pm2:heartbeat": { at: 123 } }, "T30: restart cooldown preserved");
  ok("T30: an undelivered alert still preserves the separate restart cooldown");
}

async function main() {
  const tests = [
    t0_identityExport,
    t1_paperclipDownCritical,
    t2_paperclipUpNoFinding,
    t3_daemonLockMissingCritical,
    t4_daemonLockDeadPidCritical,
    t5_daemonLockLivePidNoFinding,
    t6_staleLockIsWarningNotCritical,
    t7_criticalsProduceOneBundledSpawn,
    t8_noCriticalsZeroSpawns,
    t9_cooldownSuppressesWithinWindow,
    t10_reAlertsAfterCooldown,
    t11_clearedFindingReAlertsImmediately,
    t12_singleInstanceLockOnlyOneRuns,
    t13_schtasksHappyPath,
    t14_schtasksFindsProblem,
    t15_schtasksErrorsGraceful,
    t16_pm2StaleCodeHappy,
    t17_pm2StaleCodeCatchesIncident,
    t18_pm2StaleCodeDegradesOnError,
    t19_schtasksCriticalWiresToAlert,
    t20_pm2StaleCodeCriticalWiresToAlert,
    t21_pm2AutoRestartSuccess,
    t22_pm2AutoRestartFailure,
    t23_pm2AutoRestartCooldownSkip,
    t24_twoStaleFindingsIndependent,
    t25_runPm2RestartThrowCaught,
    t26_paperclipDownCriticalWithRetryDetail,
    t27_paperclipUpNoFindingWithRetry,
    t28_stewardPassesRetryOptsToDiscoverPort,
    t29_failedSpawnDoesNotAdvanceCooldown,
    t30_failedSpawnKeepsRestartState,
  ];
  for (const t of tests) await t();
  await fs.unlink(TMP_LOCK).catch(() => {});
  console.log(`\nsteward.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();