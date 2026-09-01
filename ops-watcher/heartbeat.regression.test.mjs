// ops-watcher/heartbeat.regression.test.mjs
// PHASE 8 regression tests for the heartbeat single-sweep entrypoint.
// Fully offline: we inject a FAKE runStep into runHeartbeatOnce instead of
// spawning real child processes. No live Paperclip / Telegram / hermes is
// touched. Uses node:assert/strict only.
//
//   node ops-watcher/heartbeat.regression.test.mjs
//
// Covers:
//   (H1) all 13 steps are attempted even if step 2 fails (the sweep must never
//        abort on a single step's non-zero exit).
//   (H2) a compact real summary line is produced after each step and a final
//        summary (succeeded/failed counts) is produced.
//   (H3) a totally missing script file for one step (modeled as runStep
//        returning code=null + an ENOENT-style error) does NOT crash the whole
//        heartbeat — the sweep continues and the final summary still reports
//        the right counts.
//   (H6) the telegram-listener step is SKIPPED when the persistent daemon is
//        confirmed healthy, while the other 11 steps still run.
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

import assert from "node:assert/strict";
import { runHeartbeatOnce, runStepReal } from "./heartbeat.mjs";

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

// Capture log lines into an array (also still print them, prefixed, for
// visibility during the test run).
function makeLogCapture() {
  const lines = [];
  const log = (m) => { lines.push(String(m)); console.log("  | " + m); };
  return { lines, log };
}

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
  };
}

// Health-check dependency that always says "run the fallback" — used by the
// pre-gate tests so they see the exact same behavior as before the gate existed.
const alwaysRunFallback = async () => true;

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

// The full ordered list of 13 step names (used by multiple tests).
const STEP_NAMES = [
  "watcher", "test-runner", "review-runner", "telegram-notify",
  "telegram-listener", "cockpit-status", "ahmad-dispatch",
  "steward", "steward-sjs", "steward-caveman", "escalation-sec",
  "gbrain-curator", "audit-clerk",
];

// =====================================================================
// H1: all 13 steps attempted even if step 2 (test-runner) fails
// =====================================================================
async function testAllStepsAttemptedOnStep2Fail() {
  const name = "H1 all 13 steps attempted even when step 2 (test-runner) fails";
  const table = happyTable();
  // Make step 2 FAIL with a non-zero exit + stderr (as a crashing test would).
  table[SCRIPTS.testRunner] = { code: 1, stdout: "test-runner --once: processed 1 issue(s)\n", stderr: "AssertionError: expected 2 === 3\n" };
  const { lines, log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({ runStep: makeFakeRunStep(table), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback });
    assert.equal(r.total, 13, "exactly 13 steps in the pipeline");
    assert.equal(r.results.length, 13, "all 13 steps produced a result");
    // Step ordering preserved and names correct.
    assert.deepEqual(r.results.map((x) => x.name), STEP_NAMES);
    // Step 2 failed, all others succeeded.
    assert.equal(r.results[1].code, 1, "step 2 exit code 1");
    assert.equal(r.results[1].ok, false, "step 2 ok=false");
    for (let i of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      assert.equal(r.results[i].code, 0, `step ${i + 1} (${r.results[i].name}) exit 0`);
      assert.equal(r.results[i].ok, true, `step ${i + 1} ok=true`);
    }
    assert.equal(r.succeeded, 12);
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
    await runHeartbeatOnce({ runStep: makeFakeRunStep(table), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback });
    // One START line, one per-step line (13), one final DONE line.
    const startLines = lines.filter((l) => /heartbeat --once START/.test(l));
    const stepLines = lines.filter((l) => /^\s+\[/.test(l));
    const doneLines = lines.filter((l) => /heartbeat --once DONE/.test(l));
    assert.equal(startLines.length, 1, "one START line");
    assert.equal(stepLines.length, 13, "one summary line per step (13)");
    assert.equal(doneLines.length, 1, "one final DONE line");
    // Each per-step line carries the step name, an exit code, and OK/FAIL.
    for (const sl of stepLines) {
      assert.match(sl, /\[(watcher|test-runner|review-runner|telegram-notify|telegram-listener|cockpit-status|ahmad-dispatch|steward|steward-sjs|steward-caveman|escalation-sec|gbrain-curator|audit-clerk)\]/, "step line has step name");
      assert.match(sl, /exit=/, "step line has exit code");
      assert.match(sl, /(OK|FAIL)/, "step line has OK/FAIL");
    }
    // Final summary reports succeeded=13/13 failed=0/13.
    const done = doneLines[0];
    assert.match(done, /succeeded=13\/13/, "final summary succeeded=13/13");
    assert.match(done, /failed=0\/13/, "final summary failed=0/13");
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
    const r = await runHeartbeatOnce({ runStep: makeFakeRunStep(table), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback });
    assert.equal(r.results.length, 13, "still 13 results — sweep ran to completion");
    // The review-runner step reports a missing-script failure (code null) but
    // did NOT abort the sweep.
    const rr = r.results.find((x) => x.name === "review-runner");
    assert.ok(rr, "review-runner result present");
    assert.equal(rr.code, null, "missing script -> code null");
    assert.equal(rr.ok, false, "missing script step ok=false");
    assert.ok(rr.error, "missing script step records an error");
    assert.match(String(rr.error), /ENOENT/, "error mentions ENOENT");
    // The steps AFTER the missing one still ran and succeeded.
    const after = r.results.filter((x) => ["telegram-notify", "telegram-listener", "cockpit-status", "ahmad-dispatch", "steward", "steward-sjs", "steward-caveman", "escalation-sec", "gbrain-curator", "audit-clerk"].includes(x.name));
    assert.equal(after.length, 10);
    for (const a of after) {
      assert.equal(a.code, 0, `${a.name} (after missing step) still ran and exited 0`);
      assert.equal(a.ok, true, `${a.name} ok=true`);
    }
    // Counts: 12 succeeded, 1 failed (the missing-script step).
    assert.equal(r.succeeded, 12);
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
    const r = await runHeartbeatOnce({ runStep: makeFakeRunStep(table, { throwFor: SCRIPTS.telegramListener }), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback });
    assert.equal(r.results.length, 13);
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
    assert.equal(auditClerk.code, 0, "final step (audit-clerk) after the throwing one still ran");
    assert.equal(r.succeeded, 12);
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
    await runHeartbeatOnce({ runStep, log: () => {}, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback });
    assert.equal(seen.length, 13);
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
    const r = await runHeartbeatOnce({ runStep, log, now: () => 1700000000000, shouldRunTelegramListenerStep: async () => false });
    assert.equal(r.total, 13, "still 13 steps reported");
    assert.equal(r.results.length, 13, "still 13 results produced");
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
    assert.equal(seen.length, 12, "only the other 12 steps invoked runStep");

    assert.equal(r.succeeded, 13, "skip counts toward succeeded");
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
  const table = happyTable();
  const seen = [];
  const runStep = async (argv) => { seen.push(argv); return makeFakeRunStep(table)(argv); };
  const { log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({ runStep, log, now: () => 1700000000000, shouldRunTelegramListenerStep: async () => true });
    assert.equal(r.total, 13);
    assert.equal(r.results.length, 13);
    const tl = r.results.find((x) => x.name === "telegram-listener");
    assert.ok(tl, "telegram-listener result present");
    assert.equal(tl.code, 0, "unhealthy daemon -> telegram-listener ran and exited 0");
    assert.equal(tl.ok, true);
    assert.deepEqual(
      seen.find((argv) => argv[0] === SCRIPTS.telegramListener),
      ["ops-watcher/telegram-listener.mjs", "--once"],
      "runStep invoked with the mandated telegram-listener argv",
    );
    assert.equal(r.succeeded, 13);
    assert.equal(r.failed, 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// H8: telegram-listener step RUNS as fallback when health check throws
// =====================================================================
async function testTelegramListenerRunsWhenHealthCheckThrows() {
  const name = "H8 telegram-listener step runs fallback when daemon-health check throws";
  const table = happyTable();
  const seen = [];
  const runStep = async (argv) => { seen.push(argv); return makeFakeRunStep(table)(argv); };
  const { log } = makeLogCapture();
  try {
    const r = await runHeartbeatOnce({
      runStep,
      log,
      now: () => 1700000000000,
      shouldRunTelegramListenerStep: async () => { throw new Error("lock read failed"); },
    });
    assert.equal(r.total, 13);
    assert.equal(r.results.length, 13);
    const tl = r.results.find((x) => x.name === "telegram-listener");
    assert.ok(tl, "telegram-listener result present");
    assert.equal(tl.code, 0, "throwing health check -> fallback ran and exited 0");
    assert.equal(tl.ok, true);
    assert.ok(seen.some((argv) => argv[0] === SCRIPTS.telegramListener), "telegram-listener runStep invoked despite health-check throw");
    assert.equal(r.succeeded, 13);
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
    const r = await runHeartbeatOnce({ runStep: makeFakeRunStep(table), log, now: () => 1700000000000, shouldRunTelegramListenerStep: alwaysRunFallback });
    assert.deepEqual(
      { name: r.results[12].name, argv: r.results[12].argv },
      { name: "audit-clerk", argv: ["ops-watcher/audit-clerk.mjs", "--once"] },
      "13th result is audit-clerk with the mandated argv",
    );
    assert.equal(r.results[11].name, "gbrain-curator", "12th (preceding) step is gbrain-curator");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher PHASE-8 heartbeat regression tests");
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
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("heartbeat regression runner crashed:", err); process.exit(1); });
