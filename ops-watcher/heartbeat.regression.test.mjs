// ops-watcher/heartbeat.regression.test.mjs
// PHASE 8 regression tests for the heartbeat single-sweep entrypoint.
// Fully offline: we inject a FAKE runStep into runHeartbeatOnce instead of
// spawning real child processes. No live Paperclip / Telegram / hermes is
// touched. Uses node:assert/strict only.
//
//   node ops-watcher/heartbeat.regression.test.mjs
//
// Covers:
//   (H1) all 18 steps are attempted even if step 2 fails (the sweep must never
//        abort on a single step's non-zero exit).
//   (H2) a compact real summary line is produced after each step and a final
//        summary (succeeded/failed counts) is produced.
//   (H3) a totally missing script file for one step (modeled as runStep
//        returning code=null + an ENOENT-style error) does NOT crash the whole
//        heartbeat — the sweep continues and the final summary still reports
//        the right counts.
//   (H6) the telegram-listener step is SKIPPED when the persistent daemon is
//        confirmed healthy, while the other 14 steps still run.
//   (H7) the telegram-listener step still RUNS as a fallback when the daemon is
//        not confirmed healthy.
//   (H8) the telegram-listener step still RUNS as a fallback if the health
//        check itself throws (fail-open design).
//   (H9) runStepReal's REAL 'error' event path resolves cleanly with
//        { code: null, error: <message>, ... } instead of throwing
//        ReferenceError: code is not defined. This exercises the real
//        runStepReal (not a fake runStep) by injecting a fake spawn that emits
//        a real 'error' event (not 'close') — the exact ENOENT-style scenario
//        (node itself not found, permissions failure) that the error handler
//        exists to catch.
//   (H10) the audit-clerk step is present as the 13th step, positioned right
//        after gbrain-curator, invoked with its mandated argv.
//   (H11) the self-repair step is the 14th step (index 13) with argv
//        ["ops-watcher/self-repair.mjs", "--once"], still right after audit-clerk.
//   (H12) the STEPS pipeline has 18 entries and the LAST one is the
//        directive-runner step with argv
//        ["ops-watcher/directive-runner.mjs", "--once"].
//
// Durable step-log coverage (R1–R5):
//   (R1) buildStepRecord output shape + excerpt cap (>300-char output truncated;
//        newlines collapsed).
//   (R2) a sweep calls appendStepLog exactly ONCE with steps.length == step
//        count, correct succeeded/failed counts, and each entry carrying
//        name/ok/exitCode.
//   (R3) a healthy-daemon telegram-listener skip is recorded with
//        skipped:true, ok:true.
//   (R4) an appendStepLog that REJECTS does not fail the sweep — the sweep
//        still returns its normal result and logs a WARN line.
//   (R5) rotation helper: given a file over the byte cap, only the last
//        STEP_LOG_KEEP_LINES lines survive (tested with injected fs, not the
//        real file).

import assert from "node:assert/strict";
import {
  runHeartbeatOnce as runHeartbeatOnceReal,
  runStepReal,
  buildStepRecord,
  rotateStepLogFile,
  STEP_LOG_KEEP_LINES,
} from "./heartbeat.mjs";
import {
  acquireLock as acquireLockPrimitive,
  releaseLock as releaseLockPrimitive,
} from "./telegram-listener-daemon.mjs";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

// A fake runStep driven by a per-step script table. Each entry maps a script
// path (argv[0]) to a result { code, stdout, stderr, error, timedOut }. If an
// entry is missing we simulate a missing-script ENOENT (code:null + error).
// An optional `throwFor` script path makes the runner throw, to test the
// defensive catch around runStep itself.
function makeFakeRunStep(table, { throwFor = null } = {}) {
  return async (argv) => {
    const script = argv[0];
    if (throwFor === script) throw new Error(`fake-throw for ${script}`);
    const r = table[script];
    if (!r) {
      // Simulate a missing script file: ENOENT.
      return { code: null, stdout: "", stderr: `Cannot find module '${script}' (ENOENT)`, error: `ENOENT: ${script}` };
    }
    // Return a shallow copy so tests can't mutate the table via the result.
    return { code: r.code, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error || null, timedOut: !!r.timedOut };
  };
}

// A default-success fake runStep for tests that only care about heartbeat sweep
// behavior, not a specific per-script result table. This keeps added steps from
// accidentally falling through to the real filesystem.
function makeDefaultSuccessfulRunStep({ overrides = {}, throwFor = null } = {}) {
  return async (argv) => {
    const script = argv[0];
    if (throwFor === script) throw new Error(`fake-throw for ${script}`);
    const r = overrides[script] || {
      code: 0,
      stdout: `${script} --once: ok\n`,
      stderr: "",
      error: null,
      timedOut: false,
    };
    return { code: r.code, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error || null, timedOut: !!r.timedOut };
  };
}

// Capture log lines into an array (also still print them, prefixed, for
// visibility during the test run).
function makeLogCapture() {
  const lines = [];
  const log = (m) => { lines.push(String(m)); console.log("  | " + m); };
  return { lines, log };
}

function makeMemoryLockFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const calls = [];
  return {
    files,
    calls,
    async writeFile(file, data, opts = {}) {
      calls.push({ op: "writeFile", file, data: String(data), opts });
      if (opts && opts.flag === "wx" && files.has(file)) {
        const err = new Error("EEXIST");
        err.code = "EEXIST";
        throw err;
      }
      files.set(file, String(data));
    },
    async readFile(file) {
      calls.push({ op: "readFile", file });
      if (!files.has(file)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return files.get(file);
    },
    async unlink(file) {
      calls.push({ op: "unlink", file });
      if (!files.has(file)) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      files.delete(file);
    },
  };
}

// A no-op durable-step-log writer injected into every existing sweep test so the
// real heartbeat-steps.jsonl file is never touched during the regression run.
// (The NEW R-series tests inject their own capturing/rejecting writers.)
const noopAppendStepLog = async () => {};

// A no-op heartbeat lock injected into existing tests so the regression suite
// never touches the real ops-watcher/heartbeat.lock file.
const noopAcquireLock = async ({ pid = 17001 } = {}) => ({ acquired: true, pid });
const noopReleaseLock = async () => {};

const SCRIPTS = {
  watcher:           "ops-watcher/watcher.mjs",
  testRunner:        "ops-watcher/test-runner.mjs",
  reviewRunner:      "ops-watcher/review-runner.mjs",
  telegramNotify:    "ops-watcher/telegram-notify.mjs",
  telegramListener:  "ops-watcher/telegram-listener.mjs",
  cockpitStatus:     "ops-watcher/cockpit-status.mjs",
  ahmadDispatch:     "ops-watcher/ahmad-dispatch.mjs",
  steward:           "ops-watcher/steward.mjs",
  stewardSjs:        "ops-watcher/steward-sjs.mjs",
  stewardCaveman:    "ops-watcher/steward-caveman.mjs",
  escalationSec:     "ops-watcher/escalation-sec.mjs",
  gbrainCurator:     "ops-watcher/gbrain-curator.mjs",
  auditClerk:        "ops-watcher/audit-clerk.mjs",
  selfRepair:        "ops-watcher/self-repair.mjs",
  graphifyRefresh:   "ops-watcher/graphify-refresh.mjs",
  ledgerWriter:      "ops-watcher/ledger-writer.mjs",
  reconcile:         "ops-watcher/reconcile.mjs",
  directiveRunner:   "ops-watcher/directive-runner.mjs",
};

// A "happy table": every step exits 0 with some real-looking output.
function happyTable() {
  return {
    [SCRIPTS.watcher]:           { code: 0, stdout: "ops-watcher --once: emitted=2 candidates=6\n" },
    [SCRIPTS.testRunner]:         { code: 0, stdout: "test-runner --once: processed 0 issue(s)\n" },
    [SCRIPTS.reviewRunner]:       { code: 0, stdout: "review-runner --once: processed 0 issue(s)\n" },
    [SCRIPTS.telegramNotify]:     { code: 0, stdout: "telegram-notify --once: sent=0 skipped/other=0 (error=none)\n" },
    [SCRIPTS.telegramListener]:   { code: 0, stdout: "telegram-listener --once: processed=0 updates=0 (error=none)\n" },
    [SCRIPTS.cockpitStatus]:      { code: 0, stdout: "wrote ops-watcher/cockpit-snapshot.html (8421 bytes)\n" },
    [SCRIPTS.ahmadDispatch]:      { code: 0, stdout: "ahmad-dispatch --once: processed 0 issue(s)\n" },
    [SCRIPTS.steward]:            { code: 0, stdout: "steward --once: 0 critical, 0 warning, 1 gap, alerted=false, suppressed=0\n" },
    [SCRIPTS.stewardSjs]:         { code: 0, stdout: "steward-sjs --once: 0 critical, 0 warning, 1 gap, alerted=false, suppressed=0\n" },
    [SCRIPTS.stewardCaveman]:     { code: 0, stdout: "steward-caveman --once: 0 critical, 0 warning, 1 gap, alerted=false, suppressed=0\n" },
    [SCRIPTS.escalationSec]:      { code: 0, stdout: "escalation-sec --once: notified=0 failed=0 skipped/other=0 (error=none)\n" },
    [SCRIPTS.gbrainCurator]:      { code: 0, stdout: "gbrain-curator --once DONE 2026-09-01T00:00:00.000Z — ingested=0 up-to-date=0 skipped=0 failed=0\n" },
    [SCRIPTS.auditClerk]:         { code: 0, stdout: "audit-clerk --once: findings=0 alerted=false suppressed=0\n" },
    [SCRIPTS.selfRepair]:         { code: 0, stdout: "self-repair: skipped (next run after 2026-09-01T00:30:00.000Z)\n" },
    [SCRIPTS.graphifyRefresh]:    { code: 0, stdout: "graphify-refresh: skipped, repo unchanged since the last refresh\n" },
    [SCRIPTS.ledgerWriter]:       { code: 0, stdout: "ledger-writer --once: derived=0 appended=0 alreadyPresent=0 unclassified=0\n" },
    [SCRIPTS.reconcile]:          { code: 0, stdout: "reconcile owner-surface: OK expected=17 actual=17 detail=split: 3 card, 14 digest\n" },
    [SCRIPTS.directiveRunner]:    { code: 0, stdout: "directive-runner --once: skipped (next sweep after 2026-09-01T00:15:00.000Z)\n" },
  };
}

// Health-check dependency that always says "run the fallback" — used by the
// pre-gate tests so they see the exact same behavior as before the gate existed.
const alwaysRunFallback = async () => true;

// Pause-check dependency for every non-pause regression test. This keeps the
// regression suite fully offline and guarantees it never touches the real
// ops-watcher/PAUSED flag file.
const notPaused = async () => ({ paused: false });
function runHeartbeatOnce(deps = {}) {
  return runHeartbeatOnceReal({
    checkPause: notPaused,
    acquireLock: noopAcquireLock,
    releaseLock: noopReleaseLock,
    lockFile: "fake-heartbeat.lock",
    ...deps,
  });
}

// =====================================================================
// A minimal fake child_process.spawn for H9 — returns a fake Child-like object
// with separate stdout/stderr/main event buses, a kill() no-op, and a _emit()
// helper so the test can fire a real 'error' event (or 'close') asynchronously,
// exactly like real spawn does. Mirrors the minimal EventEmitter surface that
// runStepReal actually touches: child.stdout.on('data'), child.stderr.on('data'),
// child.on('error'), child.on('close'), child.kill().
// =====================================================================
function makeFakeBus() {
  const handlers = {};
  return {
    on(ev, cb) { (handlers[ev] = handlers[ev] || []).push(cb); },
    _emit(ev, ...args) { (handlers[ev] || []).forEach((cb) => cb(...args)); },
  };
}

function makeFakeChild() {
  const stdout = makeFakeBus();
  const stderr = makeFakeBus();
  const main = makeFakeBus();
  return {
    stdout,
    stderr,
    on(ev, cb) { main.on(ev, cb); },
    kill() { /* no-op */ },
    _emit(ev, ...args) { main._emit(ev, ...args); },
  };
}

// The full ordered expected step pipeline (used by multiple tests).
const STEPS = [
  { name: "watcher", argv: [SCRIPTS.watcher, "--once"] },
  { name: "test-runner", argv: [SCRIPTS.testRunner, "--once"] },
  { name: "review-runner", argv: [SCRIPTS.reviewRunner, "--once"] },
  { name: "telegram-notify", argv: [SCRIPTS.telegramNotify, "--once"] },
  { name: "telegram-listener", argv: [SCRIPTS.telegramListener, "--once"] },
  { name: "cockpit-status", argv: [SCRIPTS.cockpitStatus, "--html", "ops-watcher/cockpit-snapshot.html"] },
  { name: "ahmad-dispatch", argv: [SCRIPTS.ahmadDispatch, "--once"] },
  { name: "steward", argv: [SCRIPTS.steward, "--once"] },
  { name: "steward-sjs", argv: [SCRIPTS.stewardSjs, "--once"] },
  { name: "steward-caveman", argv: [SCRIPTS.stewardCaveman, "--once"] },
  { name: "escalation-sec", argv: [SCRIPTS.escalationSec, "--once"] },
  { name: "gbrain-curator", argv: [SCRIPTS.gbrainCurator, "--once"] },
  { name: "audit-clerk", argv: [SCRIPTS.auditClerk, "--once"] },
  { name: "self-repair", argv: [SCRIPTS.selfRepair, "--once"] },
  { name: "graphify-refresh", argv: [SCRIPTS.graphifyRefresh, "--once"] },
  { name: "ledger-writer", argv: [SCRIPTS.ledgerWriter, "--once"] },
  { name: "reconcile", argv: [SCRIPTS.reconcile, "--once"] },
  { name: "directive-runner", argv: [SCRIPTS.directiveRunner, "--once"] },
];
const STEP_NAMES = STEPS.map((s) => s.name);

// =====================================================================
// H1: all 18 steps attempted even if step 2 (test-runner) fails
// =====================================================================
async function testAllStepsAttemptedOnStep2Fail() {
  const name = "H1 all 18 steps attempted even when step 2 (test-runner) fails";
  const table = happyTable();
  // Make step 2 FAIL with a non-zero exit + stderr (as a crashing test would).
  table[SCRIPTS.testRunner] = { code: 1, stdout: "test-runner --once: processed 1 issue(s)\n", stderr: "AssertionError: expected 2 === 3\n" };
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({ runStep: makeFakeRunStep(table), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback, appendStepLog: noopAppendStepLog });
    assert.equal(r.total, STEPS.length, "exactly 18 steps in the pipeline");
    assert.equal(r.results.length, STEPS.length, "all 18 steps produced a result");
    // Step ordering preserved and names correct.
    assert.deepEqual(r.results.map((x) => x.name), STEP_NAMES);
    // Step 2 failed, all others succeeded.
    assert.equal(r.results[1].code, 1, "step 2 exit code 1");
    assert.equal(r.results[1].ok, false, "step 2 ok=false");
    for (let i of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      assert.equal(r.results[i].code, 0, `step ${i + 1} (${r.results[i].name}) exit 0`);
      assert.equal(r.results[i].ok, true, `step ${i + 1} ok=true`);
    }
    assert.equal(r.succeeded, STEPS.length - 1);
    assert.equal(r.failed, 1);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H2: compact per-step summary + final summary produced
// =====================================================================
async function testSummaryLinesProduced() {
  const name = "H2 compact per-step summary line + final summary produced";
  const table = happyTable();
  const { lines, log } = makeLogCapture();
  try {
    await runHeartbeatOnce({ runStep: makeFakeRunStep(table), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback, appendStepLog: noopAppendStepLog });
    // One START line, one per-step line (18), one final DONE line.
    const startLines = lines.filter((l) => /heartbeat --once START/.test(l));
    const stepLines = lines.filter((l) => /^\s+\[/.test(l));
    const doneLines = lines.filter((l) => /heartbeat --once DONE/.test(l));
    assert.equal(startLines.length, 1, "one START line");
    assert.equal(stepLines.length, STEPS.length, "one summary line per step (18)");
    assert.equal(doneLines.length, 1, "one final DONE line");
    // Each per-step line carries the step name, an exit code, and OK/FAIL.
    for (const sl of stepLines) {
      assert.match(sl, /\[(watcher|test-runner|review-runner|telegram-notify|telegram-listener|cockpit-status|ahmad-dispatch|steward|steward-sjs|steward-caveman|escalation-sec|gbrain-curator|audit-clerk|self-repair|graphify-refresh|ledger-writer|reconcile|directive-runner)\]/, "step line has step name");
      assert.match(sl, /exit=/, "step line has exit code");
      assert.match(sl, /(OK|FAIL)/, "step line has OK/FAIL");
    }
    // Final summary reports succeeded=18/18 failed=0/18.
    const done = doneLines[0];
    assert.match(done, new RegExp(`succeeded=${STEPS.length}/${STEPS.length}`), "final summary succeeded=18/18");
    assert.match(done, new RegExp(`failed=0/${STEPS.length}`), "final summary failed=0/18");
    // The per-step line for telegram-notify carries its real stdout excerpt.
    const notifyLine = stepLines.find((l) => /\[telegram-notify\]/.test(l));
    assert.ok(notifyLine, "telegram-notify step line present");
    assert.match(notifyLine, /sent=0/, "telegram-notify excerpt relays real stdout");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H3: a totally missing script file for one step doesn't crash the heartbeat
// =====================================================================
async function testMissingScriptDoesNotCrash() {
  const name = "H3 missing script file for one step does not crash the heartbeat";
  // Build a table that deliberately OMITS the review-runner script, simulating
  // an ENOENT (the fake runStep returns code:null + error for unknown scripts).
  const table = happyTable();
  delete table[SCRIPTS.reviewRunner];
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({ runStep: makeFakeRunStep(table), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback, appendStepLog: noopAppendStepLog });
    assert.equal(r.results.length, STEPS.length, "still 18 results — sweep ran to completion");
    // The review-runner step reports a missing-script failure (code null) but
    // did NOT abort the sweep.
    const rr = r.results.find((x) => x.name === "review-runner");
    assert.ok(rr, "review-runner result present");
    assert.equal(rr.code, null, "missing script -> code null");
    assert.equal(rr.ok, false, "missing script step ok=false");
    assert.ok(rr.error, "missing script step records an error");
    assert.match(String(rr.error), /ENOENT/, "error mentions ENOENT");
    // The steps AFTER the missing one still ran and succeeded.
    const after = r.results.filter((x) => ["telegram-notify", "telegram-listener", "cockpit-status", "ahmad-dispatch", "steward", "steward-sjs", "steward-caveman", "escalation-sec", "gbrain-curator", "audit-clerk", "self-repair", "graphify-refresh", "ledger-writer", "reconcile", "directive-runner"].includes(x.name));
    assert.equal(after.length, STEPS.length - 3);
    for (const a of after) {
      assert.equal(a.code, 0, `${a.name} (after missing step) still ran and exited 0`);
      assert.equal(a.ok, true, `${a.name} ok=true`);
    }
    // Counts: 17 succeeded, 1 failed (the missing-script step).
    assert.equal(r.succeeded, STEPS.length - 1);
    assert.equal(r.failed, 1);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H4 (bonus): a runStep that THROWS for one step is caught, sweep continues
// =====================================================================
async function testThrowingRunStepCaught() {
  const name = "H4 a throwing runStep for one step is caught, sweep continues";
  const table = happyTable();
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({ runStep: makeFakeRunStep(table, { throwFor: SCRIPTS.telegramListener }), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback, appendStepLog: noopAppendStepLog });
    assert.equal(r.results.length, STEPS.length);
    const tl = r.results.find((x) => x.name === "telegram-listener");
    assert.equal(tl.code, null, "throwing step -> code null");
    assert.equal(tl.ok, false);
    // Steps before and after still ran.
    const cockpit = r.results.find((x) => x.name === "cockpit-status");
    assert.equal(cockpit.code, 0, "step after the throwing one still ran");
    const steward = r.results.find((x) => x.name === "steward");
    assert.equal(steward.code, 0, "steward step after the throwing one still ran");
    const stewardCaveman = r.results.find((x) => x.name === "steward-caveman");
    assert.equal(stewardCaveman.code, 0, "steward-caveman after the throwing one still ran");
    const escalationSec = r.results.find((x) => x.name === "escalation-sec");
    assert.equal(escalationSec.code, 0, "escalation-sec after the throwing one still ran");
    const gbrainCurator = r.results.find((x) => x.name === "gbrain-curator");
    assert.equal(gbrainCurator.code, 0, "gbrain-curator after the throwing one still ran");
    const auditClerk = r.results.find((x) => x.name === "audit-clerk");
    assert.equal(auditClerk.code, 0, "audit-clerk after the throwing one still ran");
    const selfRepair = r.results.find((x) => x.name === "self-repair");
    assert.equal(selfRepair.code, 0, "self-repair after the throwing one still ran");
    const directiveRunner = r.results.find((x) => x.name === "directive-runner");
    assert.equal(directiveRunner.code, 0, "directive-runner (final step) after the throwing one still ran");
    assert.equal(r.succeeded, STEPS.length - 1);
    assert.equal(r.failed, 1);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H5 (bonus): every step receives exactly the mandated argv (no drift)
// =====================================================================
async function testArgvDrift() {
  const name = "H5 each step is invoked with its mandated argv (no drift)";
  const seen = [];
  const runStep = async (argv) => { seen.push(argv); return { code: 0, stdout: "", stderr: "", error: null }; };
  try {
    await runHeartbeatOnce({ runStep, log: () => {}, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback, appendStepLog: noopAppendStepLog });
    assert.equal(seen.length, STEPS.length);
    assert.deepEqual(seen[0], ["ops-watcher/watcher.mjs", "--once"]);
    assert.deepEqual(seen[1], ["ops-watcher/test-runner.mjs", "--once"]);
    assert.deepEqual(seen[2], ["ops-watcher/review-runner.mjs", "--once"]);
    assert.deepEqual(seen[3], ["ops-watcher/telegram-notify.mjs", "--once"]);
    assert.deepEqual(seen[4], ["ops-watcher/telegram-listener.mjs", "--once"]);
    assert.deepEqual(seen[5], ["ops-watcher/cockpit-status.mjs", "--html", "ops-watcher/cockpit-snapshot.html"]);
    assert.deepEqual(seen[6], ["ops-watcher/ahmad-dispatch.mjs", "--once"]);
    assert.deepEqual(seen[7], ["ops-watcher/steward.mjs", "--once"]);
    assert.deepEqual(seen[8], ["ops-watcher/steward-sjs.mjs", "--once"]);
    assert.deepEqual(seen[9], ["ops-watcher/steward-caveman.mjs", "--once"]);
    assert.deepEqual(seen[10], ["ops-watcher/escalation-sec.mjs", "--once"]);
    assert.deepEqual(seen[11], ["ops-watcher/gbrain-curator.mjs", "--once"]);
    assert.deepEqual(seen[12], ["ops-watcher/audit-clerk.mjs", "--once"]);
    assert.deepEqual(seen[13], ["ops-watcher/self-repair.mjs", "--once"]);
    assert.deepEqual(seen[14], ["ops-watcher/graphify-refresh.mjs", "--once"]);
    assert.deepEqual(seen[15], ["ops-watcher/ledger-writer.mjs", "--once"]);
    assert.deepEqual(seen[16], ["ops-watcher/reconcile.mjs", "--once"]);
    assert.deepEqual(seen[17], ["ops-watcher/directive-runner.mjs", "--once"]);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H6: telegram-listener step SKIPPED when persistent daemon is healthy
// =====================================================================
async function testTelegramListenerSkippedWhenDaemonHealthy() {
  const name = "H6 telegram-listener step skipped when persistent daemon is healthy";
  const table = happyTable();
  const seen = [];
  const runStep = async (argv) => { seen.push(argv); return makeFakeRunStep(table)(argv); };
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({ runStep, log, now: () => 1700000000000, shouldRunTelegramListenerStep: async () => false, appendStepLog: noopAppendStepLog });
    assert.equal(r.total, STEPS.length, "still 18 steps reported");
    assert.equal(r.results.length, STEPS.length, "still 18 results produced");
    assert.deepEqual(r.results.map((x) => x.name), STEP_NAMES);

    const tl = r.results.find((x) => x.name === "telegram-listener");
    assert.ok(tl, "telegram-listener result present");
    assert.equal(tl.code, null, "healthy daemon -> telegram-listener skipped with code null");
    assert.equal(tl.ok, true, "skip counts as ok, not failure");
    assert.equal(tl.error, null, "skip has no error");
    assert.equal(tl.timedOut, false, "skip is not a timeout");
    assert.deepEqual(tl.argv, ["ops-watcher/telegram-listener.mjs", "--once"], "argv preserved in result for observability");
    assert.match(tl.stdout, /SKIPPED-persistent-daemon-healthy/i, "stdout names the skip reason");

    assert.ok(!seen.some((argv) => argv[0] === SCRIPTS.telegramListener), "telegram-listener argv never passed to runStep");
    assert.equal(seen.length, STEPS.length - 1, "only the other 14 steps invoked runStep");

    assert.equal(r.succeeded, STEPS.length, "skip counts toward succeeded");
    assert.equal(r.failed, 0, "no failures when all other steps exit 0");

    const tlLine = lines.find((l) => /\[telegram-listener\]/.test(l));
    assert.ok(tlLine, "telegram-listener summary line present");
    assert.match(tlLine, /exit=null/, "summary line reports exit=null");
    assert.match(tlLine, /OK/, "summary line reports OK");

    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H7: telegram-listener step RUNS as fallback when daemon is unhealthy
// =====================================================================
async function testTelegramListenerRunsWhenDaemonUnhealthy() {
  const name = "H7 telegram-listener step runs fallback when persistent daemon is not healthy";
  const seen = [];
  const runStep = async (argv) => { seen.push(argv); return makeDefaultSuccessfulRunStep()(argv); };
  const { log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({ runStep, log, now: () => 1700000000000, shouldRunTelegramListenerStep: async () => true, appendStepLog: noopAppendStepLog });
    assert.equal(r.total, STEPS.length);
    assert.equal(r.results.length, STEPS.length);
    const tl = r.results.find((x) => x.name === "telegram-listener");
    assert.ok(tl, "telegram-listener result present");
    assert.equal(tl.code, 0, "unhealthy daemon -> telegram-listener ran and exited 0");
    assert.equal(tl.ok, true);
    assert.deepEqual(
      seen.find((argv) => argv[0] === SCRIPTS.telegramListener),
      ["ops-watcher/telegram-listener.mjs", "--once"],
      "runStep invoked with the mandated telegram-listener argv",
    );
    assert.equal(r.succeeded, STEPS.length);
    assert.equal(r.failed, 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H8: telegram-listener step RUNS as fallback when health check throws
// =====================================================================
async function testTelegramListenerRunsWhenHealthCheckThrows() {
  const name = "H8 telegram-listener step runs fallback when daemon-health check throws";
  const seen = [];
  const runStep = async (argv) => { seen.push(argv); return makeDefaultSuccessfulRunStep()(argv); };
  const { log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({
      runStep,
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: async () => { throw new Error("lock read failed"); },
      appendStepLog: noopAppendStepLog,
    });
    assert.equal(r.total, STEPS.length);
    assert.equal(r.results.length, STEPS.length);
    const tl = r.results.find((x) => x.name === "telegram-listener");
    assert.ok(tl, "telegram-listener result present");
    assert.equal(tl.code, 0, "throwing health check -> fallback ran and exited 0");
    assert.equal(tl.ok, true);
    assert.ok(seen.some((argv) => argv[0] === SCRIPTS.telegramListener), "telegram-listener runStep invoked despite health-check throw");
    assert.equal(r.succeeded, STEPS.length);
    assert.equal(r.failed, 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H9: runStepReal's REAL 'error' event resolves cleanly (no ReferenceError)
//
// This is the regression test for the ReferenceError: code is not defined bug
// found by GIBRAN during a review and confirmed by AHMAD reading the code
// directly. The bug: runStepReal's `child.on("error", ...)` handler referenced
// `code`, but `code` only existed as a parameter inside the SEPARATE
// `child.on("close", (code) => {...})` handler. If spawn emitted a real 'error'
// event (e.g. ENOENT because `node` itself can't be found, or a permissions
// failure), the error handler threw ReferenceError instead of resolving cleanly.
//
// This test exercises the REAL runStepReal (not a fake runStep injected into
// runHeartbeatOnce) by injecting a fake `spawn` that returns a fake child which
// emits a real 'error' event (NOT a 'close'). It asserts runStepReal resolves
// cleanly with { code: null, error: <message>, ... } rather than throwing or
// hanging. A Promise.race with a 2-second timeout guard catches the case where
// the promise never resolves (the exact symptom of the ReferenceError — the
// thrown error escapes the EventEmitter callback, the promise stays pending, and
// `await` hangs forever).
// =====================================================================
async function testRunStepRealErrorEventResolvesCleanly() {
  const name = "H9 runStepReal 'error' event resolves cleanly (no ReferenceError: code is not defined)";
  try {
    const child = makeFakeChild();
    const fakeSpawn = () => child;
    // Emit a real 'error' event asynchronously (like real spawn does on ENOENT),
    // NOT a 'close'. This is the exact path that triggered the ReferenceError.
    queueMicrotask(() => child._emit("error", new Error("spawn ENOENT: node not found")));

    // Race against a timeout: if the bug is present, the error handler throws
    // ReferenceError, the promise never resolves, and `await` hangs. The timeout
    // converts that hang into a definitive test failure.
    const res = await Promise.race([
      runStepReal(["ops-watcher/nonexistent.mjs", "--once"], { timeoutMs: 1000, spawn: fakeSpawn }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("runStepReal did not resolve within 2s — likely ReferenceError: code is not defined")), 2000)),
    ]);

    // The error handler must resolve cleanly with code=null (the child never
    // produced an exit code) and the error message relayed.
    assert.equal(res.code, null, "error event -> code null (child never produced an exit code)");
    assert.ok(res.error, "error event -> error message present");
    assert.match(String(res.error), /ENOENT/, "error message relayed from the 'error' event");
    // stdout/stderr must be present (strings), not undefined.
    assert.equal(typeof res.stdout, "string", "stdout is a string");
    assert.equal(typeof res.stderr, "string", "stderr is a string");
    // timedOut must be absent or false (this was an error, not a timeout).
    assert.notEqual(res.timedOut, true, "error event is not a timeout");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H10: audit-clerk is the 13th step, positioned right after gbrain-curator,
// invoked with its mandated argv.
// =====================================================================
async function testAuditClerkIsThirteenthStep() {
  const name = "H10 audit-clerk step is 13th, right after gbrain-curator, correct argv";
  const table = happyTable();
  const { log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({ runStep: makeFakeRunStep(table), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback, appendStepLog: noopAppendStepLog });
    assert.deepEqual(
      { name: r.results[12].name, argv: r.results[12].argv },
      { name: "audit-clerk", argv: ["ops-watcher/audit-clerk.mjs", "--once"] },
      "13th result is audit-clerk with the mandated argv",
    );
    assert.equal(r.results[11].name, "gbrain-curator", "12th (preceding) step is gbrain-curator");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H11: the self-repair step is the 14th step (index 13) with argv
// ["ops-watcher/self-repair.mjs", "--once"], still right after audit-clerk.
// Verified by running a sweep with a capturing runStep (so the count +
// ordering + argv are observed exactly as the heartbeat dispatches them) —
// no real child process.
// =====================================================================
async function testSelfRepairIsFourteenthStep() {
  const name = "H11 STEPS has 18 entries; 14th is self-repair; last is directive-runner with mandated argv";
  const seen = [];
  const runStep = async (argv) => { seen.push(argv.slice()); return { code: 0, stdout: "", stderr: "", error: null }; };
  try {
    const r = await runHeartbeatOnce({ runStep, log: () => {}, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback, appendStepLog: noopAppendStepLog });
    assert.equal(STEPS.length, 18, "expected STEPS fixture has 18 entries");
    assert.equal(r.total, STEPS.length, "pipeline total is 18");
    assert.equal(seen.length, STEPS.length, "18 steps were dispatched");
    assert.equal(r.results.length, STEPS.length, "17 results produced");
    // The 14th dispatched argv is exactly the self-repair --once invocation.
    assert.deepEqual(seen[13], ["ops-watcher/self-repair.mjs", "--once"], "14th argv is the self-repair --once invocation");
    // And the 14th result carries the same name + argv for observability.
    assert.deepEqual(
      { name: r.results[13].name, argv: r.results[13].argv },
      { name: "self-repair", argv: ["ops-watcher/self-repair.mjs", "--once"] },
      "14th result is self-repair with the mandated argv",
    );
    // The preceding step is still audit-clerk (the original 13th), proving the
    // new step was APPENDED rather than inserted into the existing fourteen.
    assert.equal(r.results[12].name, "audit-clerk", "13th (preceding) step is still audit-clerk — self-repair was not moved");
    assert.deepEqual(seen[STEPS.length - 1], ["ops-watcher/directive-runner.mjs", "--once"], "last argv is the directive-runner --once invocation");
    assert.deepEqual(
      { name: r.results[STEPS.length - 1].name, argv: r.results[STEPS.length - 1].argv },
      { name: "directive-runner", argv: ["ops-watcher/directive-runner.mjs", "--once"] },
      "last result is directive-runner with the mandated argv",
    );
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H12: the STEPS pipeline has 18 entries and the LAST one is the
// directive-runner step with argv ["ops-watcher/directive-runner.mjs",
// "--once"]. Verified by running a sweep with a capturing runStep (so the
// count + ordering + last argv are observed exactly as the heartbeat
// dispatches them) — no real child process.
// =====================================================================
async function testDirectiveRunnerIsFifteenthStep() {
  const name = "H12 STEPS has 18 entries; last is directive-runner with argv [\"ops-watcher/directive-runner.mjs\", \"--once\"]";
  const seen = [];
  const runStep = async (argv) => { seen.push(argv.slice()); return { code: 0, stdout: "", stderr: "", error: null }; };
  try {
    const r = await runHeartbeatOnce({ runStep, log: () => {}, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback, appendStepLog: noopAppendStepLog });
    assert.equal(r.total, STEPS.length, "pipeline total is 18");
    assert.equal(seen.length, STEPS.length, "18 steps were dispatched");
    assert.equal(r.results.length, STEPS.length, "17 results produced");
    // The last dispatched argv is exactly the directive-runner --once invocation.
    assert.deepEqual(seen[STEPS.length - 1], ["ops-watcher/directive-runner.mjs", "--once"], "15th (last) argv is the directive-runner --once invocation");
    // And the last result carries the same name + argv for observability.
    assert.deepEqual(
      { name: r.results[STEPS.length - 1].name, argv: r.results[STEPS.length - 1].argv },
      { name: "directive-runner", argv: ["ops-watcher/directive-runner.mjs", "--once"] },
      "15th (last) result is directive-runner with the mandated argv",
    );
    // The preceding step is still self-repair (the original 14th), proving the
    // new step was APPENDED rather than inserted into the existing fourteen.
    assert.equal(r.results[13].name, "self-repair", "14th (preceding) step is still self-repair — directive-runner was appended");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// R1: buildStepRecord output shape + excerpt cap (>300 truncated, newlines
// collapsed). Pure — no I/O.
// =====================================================================
async function testBuildStepRecordShapeAndExcerpt() {
  const name = "R1 buildStepRecord output shape + excerpt cap (>300 truncated, newlines collapsed)";
  try {
    const step = { name: "demo", argv: ["a", "b"] };

    // Happy path: exit 0, short output.
    const rec = buildStepRecord(step, { code: 0, stdout: "hello\n", stderr: "" }, { okStep: true, skippedHealthy: false, durationMs: 42, now: () => 1700 });
    assert.equal(rec.ts, 1700, "ts from now()");
    assert.equal(rec.name, "demo", "name carried through");
    assert.deepEqual(rec.argv, ["a", "b"], "argv carried through (copy)");
    assert.equal(rec.ok, true, "ok reflects okStep");
    assert.equal(rec.exitCode, 0, "exitCode is the numeric code");
    assert.equal(rec.timedOut, false, "timedOut false");
    assert.equal(rec.skipped, false, "skipped false");
    assert.equal(rec.durationMs, 42, "durationMs carried through");
    assert.equal(typeof rec.excerpt, "string", "excerpt is a string");
    assert.ok(!rec.excerpt.includes("\n"), "newlines collapsed in short excerpt");
    assert.ok(JSON.stringify(rec).length > 0, "record is JSON-serializable");

    // argv must be a COPY — mutating the record's argv must not touch step.argv.
    rec.argv.push("MUT");
    assert.deepEqual(step.argv, ["a", "b"], "buildStepRecord copies argv, no aliasing");

    // >300-char output is truncated to <=300 chars.
    const longOut = "x".repeat(1000);
    const rec2 = buildStepRecord(step, { code: 0, stdout: longOut, stderr: "" }, { okStep: true, skippedHealthy: false, durationMs: 0, now: () => 1 });
    assert.ok(rec2.excerpt.length <= 300, `excerpt capped at <=300, got ${rec2.excerpt.length}`);
    assert.ok(rec2.excerpt.length < 1000, "excerpt truncated for >300-char input");

    // Newlines collapsed in a multi-line excerpt.
    const rec3 = buildStepRecord(step, { code: 0, stdout: "line1\nline2\nline3", stderr: "" }, { okStep: true, skippedHealthy: false, durationMs: 0, now: () => 2 });
    assert.ok(!rec3.excerpt.includes("\n"), "newlines collapsed in multi-line excerpt");
    assert.match(rec3.excerpt, /line1/, "multi-line content preserved");

    // exitCode null when code is null; timedOut reflects res.timedOut.
    const rec4 = buildStepRecord(step, { code: null, stdout: "", stderr: "boom", timedOut: true }, { okStep: false, skippedHealthy: false, durationMs: 5, now: () => 3 });
    assert.equal(rec4.exitCode, null, "null code -> exitCode null");
    assert.equal(rec4.ok, false, "okStep false");
    assert.equal(rec4.timedOut, true, "timedOut reflected");

    // stdout + stderr combined for the excerpt.
    const rec5 = buildStepRecord(step, { code: 0, stdout: "out-part", stderr: "err-part" }, { okStep: true, skippedHealthy: false, durationMs: 0, now: () => 4 });
    assert.match(rec5.excerpt, /out-part/, "stdout included in excerpt");
    assert.match(rec5.excerpt, /err-part/, "stderr included in excerpt");

    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// R2: a sweep calls appendStepLog exactly ONCE, with steps.length == step
// count, correct succeeded/failed counts, and each entry carrying
// name/ok/exitCode.
// =====================================================================
async function testSweepAppendsStepLogOnce() {
  const name = "R2 sweep calls appendStepLog exactly ONCE with correct step records";
  // Make step 2 (test-runner) fail so succeeded/failed are non-trivial.
  const overrides = {
    [SCRIPTS.testRunner]: { code: 1, stdout: "test-runner --once: processed 1 issue(s)\n", stderr: "AssertionError: boom\n" },
  };
  let calls = 0;
  let lastRecord = null;
  let lastOpts = null;
  const appendStepLog = async (record, opts) => { calls += 1; lastRecord = record; lastOpts = opts; };
  const { log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({
      runStep: makeDefaultSuccessfulRunStep({ overrides }),
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog,
      stepLogFile: "fake-step-log.jsonl",
    });
    assert.equal(calls, 1, "appendStepLog called exactly once");
    assert.equal(lastOpts && lastOpts.file, "fake-step-log.jsonl", "stepLogFile passed through to writer");
    assert.equal(lastRecord.total, STEPS.length, "sweep record total == step count");
    assert.equal(lastRecord.succeeded, STEPS.length - 1, "sweep record succeeded count");
    assert.equal(lastRecord.failed, 1, "sweep record failed count");
    assert.equal(lastRecord.steps.length, STEPS.length, "one step record per step");
    assert.equal(lastRecord.startedAt, 1700000000000, "startedAt recorded");
    assert.equal(lastRecord.finishedAt, 1700000000000, "finishedAt recorded");
    assert.equal(lastRecord.durationMs, 0, "durationMs recorded");
    for (const s of lastRecord.steps) {
      assert.ok("name" in s, "step record has name");
      assert.ok("ok" in s, "step record has ok");
      assert.ok("exitCode" in s, "step record has exitCode");
    }
    // The failing step is recorded as failed.
    const tr = lastRecord.steps.find((s) => s.name === "test-runner");
    assert.equal(tr.ok, false, "failing step ok=false");
    assert.equal(tr.exitCode, 1, "failing step exitCode=1");
    // A succeeding step is recorded as ok.
    const w = lastRecord.steps.find((s) => s.name === "watcher");
    assert.equal(w.ok, true, "succeeding step ok=true");
    assert.equal(w.exitCode, 0, "succeeding step exitCode=0");
    // The sweep still returned its normal result.
    assert.equal(r.total, STEPS.length);
    assert.equal(r.failed, 1);
    assert.equal(r.succeeded, STEPS.length - 1);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// R3: a healthy-daemon telegram-listener skip is recorded with skipped:true,
// ok:true.
// =====================================================================
async function testHealthySkipRecorded() {
  const name = "R3 healthy-daemon telegram-listener skip recorded with skipped:true, ok:true";
  const table = happyTable();
  let lastRecord = null;
  const appendStepLog = async (record) => { lastRecord = record; };
  const { log } = makeLogCapture();
  try {
    await runHeartbeatOnce({
      runStep: makeFakeRunStep(table),
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: async () => false,
      appendStepLog,
    });
    assert.ok(lastRecord, "appendStepLog received a sweep record");
    const tl = lastRecord.steps.find((s) => s.name === "telegram-listener");
    assert.ok(tl, "telegram-listener step record present");
    assert.equal(tl.skipped, true, "healthy skip recorded with skipped:true");
    assert.equal(tl.ok, true, "healthy skip recorded with ok:true");
    assert.equal(tl.exitCode, null, "healthy skip exitCode null");
    // Other steps are not marked skipped.
    const w = lastRecord.steps.find((s) => s.name === "watcher");
    assert.equal(w.skipped, false, "non-skipped step has skipped:false");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// R4: an appendStepLog that REJECTS does not fail the sweep — the sweep still
// returns its normal result and logs a WARN line.
// =====================================================================
async function testRejectingAppendStepLogNonFatal() {
  const name = "R4 a rejecting appendStepLog does not fail the sweep (WARN logged)";
  const { lines, log } = makeLogCapture();
  const appendStepLog = async () => { throw new Error("disk full"); };
  try {
    const r = await runHeartbeatOnce({
      runStep: makeDefaultSuccessfulRunStep(),
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog,
    });
    // Sweep still returns its normal result.
    assert.equal(r.total, STEPS.length, "normal total returned");
    assert.equal(r.results.length, STEPS.length, "normal results returned");
    assert.equal(r.failed, 0, "no step failures caused by the writer rejection");
    // A WARN line was logged.
    const warn = lines.find((l) => /heartbeat: WARN could not append step log/.test(l));
    assert.ok(warn, "a WARN line was logged for the failed append");
    assert.match(warn, /disk full/, "WARN line includes the error message");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// R5: rotation helper — given a file over the byte cap, only the last
// STEP_LOG_KEEP_LINES lines survive (tested with injected fs, not the real
// file).
// =====================================================================
async function testRotationHelper() {
  const name = "R5 rotation helper keeps only last STEP_LOG_KEEP_LINES when over byte cap";
  try {
    // Build a file with well over STEP_LOG_KEEP_LINES lines.
    const totalLines = STEP_LOG_KEEP_LINES + 1000;
    const lines = [];
    for (let i = 0; i < totalLines; i++) lines.push(`line-${i}`);
    const content = lines.join("\n") + "\n";

    // --- Over the cap: stat reports a size above STEP_LOG_MAX_BYTES. ---
    let written = null;
    const fakeFsOver = {
      stat: async () => ({ size: 10 * 1024 * 1024 }), // 10 MB > 5 MB cap
      readFile: async () => content,
      writeFile: async (file, data) => { written = { file, data }; },
      appendFile: async () => {},
    };
    await rotateStepLogFile({ file: "fake.jsonl", _fs: fakeFsOver });
    assert.ok(written, "rotateStepLogFile rewrote the file when over the byte cap");
    const kept = written.data.split(/\r?\n/).filter((l) => l !== "");
    assert.equal(kept.length, STEP_LOG_KEEP_LINES, `only last ${STEP_LOG_KEEP_LINES} lines survive`);
    assert.equal(kept[0], `line-${totalLines - STEP_LOG_KEEP_LINES}`, "first kept line is the (total - keep)th line");
    assert.equal(kept[kept.length - 1], `line-${totalLines - 1}`, "last kept line is the final line");

    // --- Under the cap: no rewrite. ---
    let written2 = null;
    const fakeFsUnder = {
      stat: async () => ({ size: 100 }),
      readFile: async () => "x",
      writeFile: async (file, data) => { written2 = { file, data }; },
      appendFile: async () => {},
    };
    await rotateStepLogFile({ file: "fake.jsonl", _fs: fakeFsUnder });
    assert.equal(written2, null, "no rotation rewrite when file is under the byte cap");

    // --- Missing file (stat throws): no throw, no rewrite. ---
    let written3 = null;
    const fakeFsMissing = {
      stat: async () => { throw new Error("ENOENT"); },
      readFile: async () => "",
      writeFile: async (file, data) => { written3 = { file, data }; },
      appendFile: async () => {},
    };
    await rotateStepLogFile({ file: "fake.jsonl", _fs: fakeFsMissing });
    assert.equal(written3, null, "missing file -> no rewrite and no throw");

    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// L1: lock free -> the full 15-step sweep runs, then the lock is released after
// the durable step-log append.
// =====================================================================
async function testHeartbeatLockFreeRunsAndReleases() {
  const name = "L1 lock-free heartbeat runs all 18 steps and releases after step-log append";
  const events = [];
  const seen = [];
  const runStep = async (argv) => { seen.push(argv.slice()); return makeDefaultSuccessfulRunStep()(argv); };
  const appendStepLog = async () => { events.push("append-step-log"); };
  try {
    const r = await runHeartbeatOnce({
      runStep,
      log: () => {},
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog,
      acquireLock: async ({ pid }) => { events.push("acquire-lock"); return { acquired: true, pid }; },
      releaseLock: async () => { events.push("release-lock"); },
      lockPid: 99101,
    });
    assert.equal(r.results.length, STEPS.length, "all 18 steps produced results");
    assert.equal(seen.length, STEPS.length, "all 18 steps ran");
    assert.equal(r.failed, 0, "lock-free happy sweep succeeds");
    assert.equal(events.filter((e) => e === "acquire-lock").length, 1, "_acquireLock called exactly once");
    assert.equal(events.filter((e) => e === "release-lock").length, 1, "_releaseLock called exactly once");
    assert.deepEqual(events, ["acquire-lock", "append-step-log", "release-lock"], "lock acquired before sweep and released after step-log append");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// L2: lock held by a live pid -> zero steps, success return, and a clear log
// line naming the holder pid.
// =====================================================================
async function testHeartbeatLiveLockRefusesSuccessfully() {
  const name = "L2 live-held heartbeat lock refuses overlap successfully and names pid";
  const holderPid = 24680;
  let runCalls = 0;
  let appendCalls = 0;
  let releaseCalls = 0;
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({
      runStep: async () => { runCalls += 1; return { code: 0, stdout: "should not run", stderr: "" }; },
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog: async () => { appendCalls += 1; },
      acquireLock: async () => ({ acquired: false, reason: "already-running", pid: holderPid }),
      releaseLock: async () => { releaseCalls += 1; },
    });
    assert.equal(runCalls, 0, "no heartbeat steps run when live lock is held");
    assert.equal(appendCalls, 0, "refused overlap does not append a sweep record");
    assert.equal(releaseCalls, 0, "refused caller does not release a lock it never acquired");
    assert.equal(r.results.length, 0, "refused overlap returns zero step results");
    assert.equal(r.failed, 0, "refused overlap maps to success");
    assert.equal(r.refused, true, "return value marks refused overlap");
    assert.equal(r.pid, holderPid, "return value carries holding pid");
    assert.ok(lines.some((l) => /another sweep is in progress/.test(l) && l.includes(`pid=${holderPid}`)), "log names the holding pid");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// L3: lock held by a dead pid -> the shared primitive reclaims it and the full
// 15-step sweep runs.
// =====================================================================
async function testHeartbeatDeadLockIsReclaimedBySharedPrimitive() {
  const name = "L3 dead-held heartbeat lock is reclaimed by shared primitive and all 18 steps run";
  const lockFile = "memory-heartbeat.lock";
  const deadPid = 33333;
  const fakeFs = makeMemoryLockFs({
    [lockFile]: JSON.stringify({ pid: deadPid, startedAt: "2026-09-01T00:00:00.000Z" }),
  });
  const seen = [];
  const runStep = async (argv) => { seen.push(argv.slice()); return makeDefaultSuccessfulRunStep()(argv); };
  try {
    const r = await runHeartbeatOnce({
      runStep,
      log: () => {},
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog: noopAppendStepLog,
      acquireLock: acquireLockPrimitive,
      releaseLock: releaseLockPrimitive,
      isAlive: (pid) => pid !== deadPid,
      lockPid: 44444,
      lockFile,
      _fs: fakeFs,
    });
    assert.equal(r.results.length, STEPS.length, "all 18 steps produced results after stale lock reclaim");
    assert.equal(seen.length, STEPS.length, "all 18 steps ran after stale lock reclaim");
    assert.equal(r.failed, 0, "reclaimed-lock happy sweep succeeds");
    assert.equal(fakeFs.files.has(lockFile), false, "lock released after the sweep");
    const staleUnlinks = fakeFs.calls.filter((c) => c.op === "unlink" && c.file === lockFile);
    assert.equal(staleUnlinks.length, 2, "shared primitive unlinked stale lock, then releaseLock removed the acquired lock");
    assert.equal(fakeFs.calls.filter((c) => c.op === "writeFile" && c.file === lockFile && c.opts.flag === "wx").length, 2, "primitive retried exclusive-create after stale holder removal");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// L4: a throwing mid-sweep step still releases the lock via finally, after the step-log
// append attempt.
// =====================================================================
async function testHeartbeatThrowingStepStillReleasesLock() {
  const name = "L4 throwing mid-sweep step still releases heartbeat lock after step-log append";
  const events = [];
  const appendStepLog = async () => { events.push("append-step-log"); };
  try {
    const r = await runHeartbeatOnce({
      runStep: makeDefaultSuccessfulRunStep({ throwFor: SCRIPTS.gbrainCurator }),
      log: () => {},
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog,
      acquireLock: async ({ pid }) => { events.push("acquire-lock"); return { acquired: true, pid }; },
      releaseLock: async () => { events.push("release-lock"); },
      lockPid: 51515,
    });
    assert.equal(r.results.length, STEPS.length, "sweep still produces all 15 results");
    assert.equal(r.results[11].name, "gbrain-curator", "throwing step is mid-sweep");
    assert.equal(r.results[11].ok, false, "throwing mid-sweep step is recorded as failed");
    assert.equal(r.failed, 1, "only the throwing step fails");
    assert.deepEqual(events, ["acquire-lock", "append-step-log", "release-lock"], "finally releases after appendStepLog even when a step throws");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// L5: _acquireLock throwing refuses the sweep and never releases a lock that was
// not acquired.
// =====================================================================
async function testHeartbeatAcquireLockThrowRefusesWithoutRelease() {
  const name = "L5 acquireLock throw refuses heartbeat without running steps or releasing";
  let runCalls = 0;
  let appendCalls = 0;
  let releaseCalls = 0;
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({
      runStep: async () => { runCalls += 1; return { code: 0, stdout: "should not run", stderr: "" }; },
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog: async () => { appendCalls += 1; },
      acquireLock: async () => { throw new Error("lock fs unreadable"); },
      releaseLock: async () => { releaseCalls += 1; },
    });
    assert.equal(runCalls, 0, "no heartbeat steps run when acquireLock throws");
    assert.equal(appendCalls, 0, "refused acquire failure does not append a sweep record");
    assert.equal(releaseCalls, 0, "releaseLock is not called for a lock that was never acquired");
    assert.equal(r.results.length, 0, "acquire failure returns zero step results");
    assert.equal(r.failed, 0, "acquire failure refusal maps to success");
    assert.equal(r.refused, true, "return value marks refused sweep");
    assert.equal(r.error, "lock-failed", "return value records lock failure refusal");
    assert.ok(lines.some((l) => /lock acquire threw/.test(l) && /refusing to run/.test(l) && /lock fs unreadable/.test(l)), "log records acquire failure refusal");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// L6: paused beats locked; the pause check stays first and no lock acquisition
// is attempted.
// =====================================================================
async function testHeartbeatPausedWinsBeforeLock() {
  const name = "L6 paused heartbeat wins before lock acquisition and logs pause reason";
  let acquireCalls = 0;
  let runCalls = 0;
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({
      runStep: async () => { runCalls += 1; return { code: 0, stdout: "should not run", stderr: "" }; },
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog: noopAppendStepLog,
      acquireLock: async () => { acquireCalls += 1; return { acquired: true, pid: 61616 }; },
      checkPause: async () => ({
        paused: true,
        reason: "owner stopped all sweeps",
        atIso: "2026-09-01T02:03:04.000Z",
        by: "owner",
      }),
    });
    assert.equal(acquireCalls, 0, "lock acquire is not called while paused");
    assert.equal(runCalls, 0, "no steps run while paused");
    assert.equal(r.paused, true, "return value is paused");
    assert.equal(r.failed, 0, "paused still maps to success");
    assert.ok(lines.some((l) => /PAUSED/.test(l) && /owner stopped all sweeps/.test(l)), "pause reason is logged");
    assert.equal(lines.some((l) => /another sweep is in progress/.test(l)), false, "pause log is not replaced by a lock refusal");
    ok(name);
  } catch (err) { bad(name, err); }
}
// =====================================================================
// P1-P3: owner pause stops all steps, exits successfully, and still writes a
// paused durable step-log record with the owner's reason.
// =====================================================================
async function testPausedStopsAllStepsAndWritesRecord() {
  const name = "P1-P3 paused heartbeat runs zero steps, succeeds, and records pause reason";
  let calls = 0;
  let lastRecord = null;
  const runStep = async () => { calls += 1; return { code: 0, stdout: "should not run", stderr: "" }; };
  const appendStepLog = async (record) => { lastRecord = record; };
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({
      runStep,
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog,
      checkPause: async () => ({
        paused: true,
        reason: "owner emergency stop",
        atIso: "2026-09-01T01:02:03.000Z",
        by: "owner",
      }),
    });
    assert.equal(calls, 0, "runStep is never called while paused");
    assert.equal(r.results.length, 0, "paused sweep has zero step results");
    assert.equal(r.total, STEPS.length, "paused sweep still reports the pipeline size");
    assert.equal(r.succeeded, 0, "no steps succeeded because no steps ran");
    assert.equal(r.failed, 0, "paused sweep maps to CLI success, not failure");
    assert.equal(r.paused, true, "return value is marked paused");
    assert.equal(r.pauseReason, "owner emergency stop", "return value carries pause reason");
    assert.ok(lastRecord, "paused sweep still writes one step-log record");
    assert.equal(lastRecord.paused, true, "step-log record marked paused");
    assert.equal(lastRecord.pauseReason, "owner emergency stop", "step-log record carries pause reason");
    assert.equal(lastRecord.pauseAtIso, "2026-09-01T01:02:03.000Z", "step-log record carries pause time");
    assert.equal(lastRecord.failed, 0, "step-log paused record is not a failure");
    assert.deepEqual(lastRecord.steps, [], "step-log paused record has no step records");
    assert.ok(lines.some((l) => /PAUSED/.test(l) && /owner emergency stop/.test(l) && /2026-09-01T01:02:03\.000Z/.test(l)), "pause log names reason and time");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P4: explicit not-paused regression guard: the pause seam preserves the exact
// 15-step pipeline when the owner has not paused the system.
// =====================================================================
async function testNotPausedRunsAllFifteenSteps() {
  const name = "P4 not paused heartbeat still dispatches all 18 steps";
  const seen = [];
  const runStep = async (argv) => { seen.push(argv.slice()); return makeDefaultSuccessfulRunStep()(argv); };
  try {
    const r = await runHeartbeatOnce({
      runStep,
      log: () => {},
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog: noopAppendStepLog,
      checkPause: async () => ({ paused: false }),
    });
    assert.equal(r.results.length, STEPS.length, "all 15 results produced");
    assert.equal(seen.length, STEPS.length, "all 18 steps dispatched");
    assert.deepEqual(seen, STEPS.map((s) => s.argv), "step order and argv unchanged");
    assert.equal(r.failed, 0, "happy not-paused sweep still succeeds");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P5: if the injected pause check throws, heartbeat fails closed to paused and
// does not run any step.
// =====================================================================
async function testThrowingPauseCheckFailsClosed() {
  const name = "P5 throwing pause check is treated as paused";
  let calls = 0;
  let lastRecord = null;
  const runStep = async () => { calls += 1; return { code: 0, stdout: "should not run", stderr: "" }; };
  const appendStepLog = async (record) => { lastRecord = record; };
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({
      runStep,
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: alwaysRunFallback,
      appendStepLog,
      checkPause: async () => { throw new Error("pause flag unreadable"); },
    });
    assert.equal(calls, 0, "runStep is never called when pause check throws");
    assert.equal(r.paused, true, "throwing check returns a paused sweep");
    assert.equal(r.failed, 0, "fail-closed pause is still a successful owner halt");
    assert.match(r.pauseReason, /Pause check failed closed: pause flag unreadable/, "return value explains fail-closed pause");
    assert.ok(lastRecord, "fail-closed pause still writes a step-log record");
    assert.equal(lastRecord.paused, true, "step-log record marked paused");
    assert.match(lastRecord.pauseReason, /Pause check failed closed: pause flag unreadable/, "step-log record explains fail-closed pause");
    assert.deepEqual(lastRecord.steps, [], "no step records when pause check throws");
    assert.ok(lines.some((l) => /PAUSED/.test(l) && /pause flag unreadable/.test(l)), "log shows deliberate fail-closed pause");
    ok(name);
  } catch (err) { bad(name, err); }
}
async function main() {
  console.log("# ops-watcher PHASE-8 heartbeat regression tests");
  await testHeartbeatLockFreeRunsAndReleases();
  await testHeartbeatLiveLockRefusesSuccessfully();
  await testHeartbeatDeadLockIsReclaimedBySharedPrimitive();
  await testHeartbeatThrowingStepStillReleasesLock();
  await testHeartbeatAcquireLockThrowRefusesWithoutRelease();
  await testHeartbeatPausedWinsBeforeLock();
  await testPausedStopsAllStepsAndWritesRecord();
  await testNotPausedRunsAllFifteenSteps();
  await testThrowingPauseCheckFailsClosed();
  await testAllStepsAttemptedOnStep2Fail();
  await testSummaryLinesProduced();
  await testMissingScriptDoesNotCrash();
  await testThrowingRunStepCaught();
  await testArgvDrift();
  await testTelegramListenerSkippedWhenDaemonHealthy();
  await testTelegramListenerRunsWhenDaemonUnhealthy();
  await testTelegramListenerRunsWhenHealthCheckThrows();
  await testRunStepRealErrorEventResolvesCleanly();
  await testAuditClerkIsThirteenthStep();
  await testSelfRepairIsFourteenthStep();
  await testDirectiveRunnerIsFifteenthStep();
  await testBuildStepRecordShapeAndExcerpt();
  await testSweepAppendsStepLogOnce();
  await testHealthySkipRecorded();
  await testRejectingAppendStepLogNonFatal();
  await testRotationHelper();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("heartbeat regression runner crashed:", err); process.exit(1); });
