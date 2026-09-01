// Regression tests for ops-watcher/self-repair.mjs. Fully offline: all file I/O
// is injected, so the real heartbeat, evidence, and state files are never
// touched.
//
//   node ops-watcher/self-repair.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSECUTIVE_FAILURES_TO_ACT,
  REPAIR_COOLDOWN_MS,
  SCAN_MIN_INTERVAL_MS,
  MAX_REPAIRS_PER_SWEEP,
  appendEvidence,
  classifyFault,
  detectFaultingSteps,
  readRecentSweeps,
  repairScopeFor,
  runSelfRepairScan,
  runSelfRepairOnce,
  shouldAttemptRepair,
} from "./self-repair.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

function sweep(steps) {
  return { ts: 1, startedAt: 1, finishedAt: 2, durationMs: 1, total: steps.length, succeeded: 0, failed: steps.length, steps };
}

function rec(name, opts = {}) {
  return {
    ts: opts.ts || 1,
    name,
    argv: [`ops-watcher/${name}.mjs`, "--once"],
    ok: opts.ok === undefined ? false : opts.ok,
    exitCode: opts.exitCode === undefined ? 1 : opts.exitCode,
    timedOut: !!opts.timedOut,
    skipped: !!opts.skipped,
    durationMs: opts.durationMs || 1,
    excerpt: opts.excerpt || "",
  };
}

// A tiny in-memory fs for the runSelfRepairOnce tests. Maps filenames to
// string contents; readFile returns the content or throws ENOENT, writeFile
// records the content. Used so the state-file cooldown gate can be exercised
// without touching the real self-repair-state.json.
function makeMemFs(initial = new Map()) {
  const files = new Map(initial);
  const readFile = async (file) => {
    if (!files.has(file)) {
      const err = new Error("missing");
      err.code = "ENOENT";
      throw err;
    }
    return files.get(file);
  };
  const writeFile = async (file, data) => { files.set(file, data); };
  const appendFile = async (file, data) => {
    files.set(file, (files.get(file) || "") + data);
  };
  return { files, readFile, writeFile, appendFile };
}

// =====================================================================
// S1: readRecentSweeps handles missing and malformed lines
// =====================================================================
async function testReadRecentSweeps() {
  const name = "S1 readRecentSweeps returns recent well-formed sweeps only";
  try {
    const missing = await readRecentSweeps(10, {
      readFile: async () => {
        const err = new Error("missing");
        err.code = "ENOENT";
        throw err;
      },
    });
    assert.deepEqual(missing, []);

    const one = sweep([rec("watcher", { ok: true, exitCode: 0 })]);
    const two = sweep([rec("test-runner")]);
    const text = `${JSON.stringify(one)}\nnot-json\n${JSON.stringify(two)}\n`;
    const recent = await readRecentSweeps(10, { readFile: async () => text });
    assert.deepEqual(recent, [one, two]);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S2: detectFaultingSteps honors consecutive failures and breaks
// =====================================================================
async function testDetectFaultingSteps() {
  const name = "S2 detectFaultingSteps detects only unbroken failure streaks";
  try {
    const threeFails = [
      sweep([rec("gbrain-curator", { ts: 1 })]),
      sweep([rec("gbrain-curator", { ts: 2 })]),
      sweep([rec("gbrain-curator", { ts: 3 })]),
    ];
    const detected = detectFaultingSteps(threeFails, { minConsecutive: 3 });
    assert.equal(detected.length, 1);
    assert.equal(detected[0].name, "gbrain-curator");
    assert.equal(detected[0].consecutiveFailures, 3);
    assert.deepEqual(detected[0].records.map((r) => r.ts), [1, 2, 3]);

    const successBreaks = [
      sweep([rec("gbrain-curator")]),
      sweep([rec("gbrain-curator")]),
      sweep([rec("gbrain-curator", { ok: true, exitCode: 0 })]),
    ];
    assert.deepEqual(detectFaultingSteps(successBreaks, { minConsecutive: 3 }), []);

    const skippedBreaks = [
      sweep([rec("gbrain-curator")]),
      sweep([rec("gbrain-curator", { skipped: true, ok: true, exitCode: null })]),
      sweep([rec("gbrain-curator")]),
    ];
    assert.deepEqual(detectFaultingSteps(skippedBreaks, { minConsecutive: 3 }), []);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S3: classifyFault precedence
// =====================================================================
async function testClassifyFault() {
  const name = "S3 classifyFault applies quota, timeout, crash, unknown precedence";
  try {
    assert.deepEqual(
      classifyFault([rec("x", { exitCode: 1, excerpt: "TypeError plus insufficient_quota" })]).kind,
      "lane-quota",
    );
    assert.deepEqual(
      classifyFault([rec("x", { timedOut: true, exitCode: null, excerpt: "TypeError: failed" })]).kind,
      "timeout",
    );
    assert.deepEqual(
      classifyFault([rec("x", { exitCode: 1, excerpt: "SyntaxError: nope at ops-watcher/x.mjs:10:5" })]).kind,
      "crash",
    );
    assert.deepEqual(
      classifyFault([rec("x", { exitCode: 1, excerpt: "finished with bad status" })]).kind,
      "unknown",
    );
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S4: repairScopeFor enforces safety envelope
// =====================================================================
async function testRepairScopeFor() {
  const name = "S4 repairScopeFor returns scoped files and denies unsafe names";
  try {
    assert.deepEqual(repairScopeFor("gbrain-curator"), {
      stepName: "gbrain-curator",
      files: [
        path.join(__dirname, "gbrain-curator.mjs"),
        path.join(__dirname, "gbrain-curator.regression.test.mjs"),
      ],
      suite: path.join(__dirname, "gbrain-curator.regression.test.mjs"),
    });

    for (const denied of [
      "heartbeat",
      "telegram-listener",
      "telegram-notify",
      "ahmad-dispatch",
      "ahmad-escalate",
      "steward",
      "../evil",
      "steward-sjs/../heartbeat",
      "",
    ]) {
      assert.equal(repairScopeFor(denied), null, `${denied} is denied`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S5: shouldAttemptRepair cooldown behavior
// =====================================================================
async function testShouldAttemptRepair() {
  const name = "S5 shouldAttemptRepair respects cooldown and malformed state";
  try {
    const now = 1_000_000;
    assert.equal(shouldAttemptRepair({ attempts: { watcher: { lastAttemptMs: now - 1 } } }, "watcher", now, 1000), false);
    assert.equal(shouldAttemptRepair({ attempts: { watcher: { lastAttemptMs: now - 1000 } } }, "watcher", now, 1000), true);
    assert.equal(shouldAttemptRepair({}, "watcher", now), true);
    assert.equal(shouldAttemptRepair(null, "watcher", now), true);
    assert.equal(shouldAttemptRepair({ attempts: "broken" }, "watcher", now), true);
    assert.equal(CONSECUTIVE_FAILURES_TO_ACT, 3);
    assert.equal(REPAIR_COOLDOWN_MS, 6 * 60 * 60 * 1000);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S6: runSelfRepairScan end-to-end with injected I/O only
// =====================================================================
async function testRunSelfRepairScan() {
  const name = "S6 runSelfRepairScan detects faults without any dispatch hook";
  try {
    const sweeps = [
      sweep([
        rec("gbrain-curator", { excerpt: "ReferenceError: x is not defined" }),
        rec("heartbeat", { excerpt: "Error: supervisor blew up" }),
      ]),
      sweep([
        rec("gbrain-curator", { excerpt: "ReferenceError: x is not defined" }),
        rec("heartbeat", { excerpt: "Error: supervisor blew up" }),
      ]),
      sweep([
        rec("gbrain-curator", { excerpt: "ReferenceError: x is not defined" }),
        rec("heartbeat", { excerpt: "Error: supervisor blew up" }),
      ]),
    ];
    const files = new Map([
      ["fake-step-log.jsonl", sweeps.map((s) => JSON.stringify(s)).join("\n") + "\n"],
      ["fake-state.json", JSON.stringify({ attempts: {} })],
    ]);
    const evidence = [];
    const writes = [];
    const logs = [];
    const dispatchCalls = [];
    const result = await runSelfRepairScan({
      stepLogFile: "fake-step-log.jsonl",
      stateFile: "fake-state.json",
      evidenceLogFile: "fake-evidence.jsonl",
      now: () => 123456,
      log: (line) => logs.push(line),
      dispatch: () => dispatchCalls.push("dispatch"),
      readFile: async (file) => {
        if (!files.has(file)) {
          const err = new Error("missing");
          err.code = "ENOENT";
          throw err;
        }
        return files.get(file);
      },
      appendFile: async (file, data) => evidence.push({ file, data }),
      writeFile: async (file, data) => writes.push({ file, data }),
    });

    assert.equal(result.scannedSweeps, 3);
    assert.equal(result.faults.length, 2);
    const repairable = result.faults.find((fault) => fault.name === "gbrain-curator");
    const denied = result.faults.find((fault) => fault.name === "heartbeat");
    assert.ok(repairable);
    assert.equal(repairable.kind, "crash");
    assert.equal(repairable.repairable, true);
    assert.equal(repairable.blockedBy, null);
    assert.ok(denied);
    assert.equal(denied.repairable, false);
    assert.equal(denied.blockedBy, "envelope");
    assert.equal(dispatchCalls.length, 0);
    assert.equal(evidence.length, 2);
    assert.equal(logs.length, 2);
    assert.equal(writes.length, 1);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S7: appendEvidence swallows append failures
// =====================================================================
async function testAppendEvidenceNeverThrows() {
  const name = "S7 appendEvidence never throws when appendFile rejects";
  try {
    await appendEvidence({ name: "x" }, {
      appendFile: async () => { throw new Error("disk full"); },
      now: () => 42,
    });
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S8: runSelfRepairOnce skips inside SCAN_MIN_INTERVAL_MS without scanning
// =====================================================================
async function testOnceSkipsInsideCooldown() {
  const name = "S8 runSelfRepairOnce skips inside SCAN_MIN_INTERVAL_MS (no scan, no attemptRepair)";
  try {
    const stateFile = "state-s8.json";
    const mem = makeMemFs(new Map([
      [stateFile, JSON.stringify({ lastScanMs: 1_000_000 })],
    ]));
    let scanCalls = 0;
    let attemptCalls = 0;
    const logs = [];
    const result = await runSelfRepairOnce({
      scan: async () => { scanCalls++; return { scannedSweeps: 0, faults: [] }; },
      attemptRepair: async () => { attemptCalls++; return { outcome: "repaired" }; },
      escalate: async () => ({ alerted: true }),
      now: () => 1_000_000 + 60_000, // 1 minute later — well under 30 min
      log: (m) => logs.push(m),
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s8.jsonl",
    });
    assert.equal(result.skipped, true, "returns { skipped: true }");
    assert.equal(scanCalls, 0, "scan never called inside cooldown");
    assert.equal(attemptCalls, 0, "attemptRepair never called inside cooldown");
    // lastScanMs is NOT rewritten (the sweep skipped before scanning).
    const stateAfter = JSON.parse(mem.files.get(stateFile));
    assert.equal(stateAfter.lastScanMs, 1_000_000, "lastScanMs unchanged on skip");
    assert.ok(logs.some((l) => /self-repair: skipped \(next run after/.test(l)), "skip line logged with next-run ISO");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S9: past the interval with zero faults -> scan ran, no attemptRepair,
//     lastScanMs written
// =====================================================================
async function testOncePastIntervalZeroFaults() {
  const name = "S9 runSelfRepairOnce past interval with zero faults writes lastScanMs, no attemptRepair";
  try {
    assert.equal(SCAN_MIN_INTERVAL_MS, 30 * 60 * 1000, "SCAN_MIN_INTERVAL_MS is 30 minutes");
    const stateFile = "state-s9.json";
    const mem = makeMemFs(new Map([
      [stateFile, JSON.stringify({ lastScanMs: 1_000_000 })],
    ]));
    const nowMs = 1_000_000 + SCAN_MIN_INTERVAL_MS + 1; // just past the window
    let scanCalls = 0;
    let attemptCalls = 0;
    const result = await runSelfRepairOnce({
      scan: async () => { scanCalls += 1; return { scannedSweeps: 3, faults: [] }; },
      attemptRepair: async () => { attemptCalls += 1; return { outcome: "repaired" }; },
      escalate: async () => ({ alerted: true }),
      now: () => nowMs,
      log: () => {},
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s9.jsonl",
    });
    assert.equal(result.skipped, false, "not skipped past the interval");
    assert.equal(scanCalls, 1, "scan ran exactly once");
    assert.equal(attemptCalls, 0, "attemptRepair not called with zero faults");
    assert.equal(result.attemptsMade, 0);
    const stateAfter = JSON.parse(mem.files.get(stateFile));
    assert.equal(stateAfter.lastScanMs, nowMs, "lastScanMs written to state file");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S10: two repairable faults -> attemptRepair called exactly
//      MAX_REPAIRS_PER_SWEEP times
// =====================================================================
async function testOnceCapsRepairsPerSweep() {
  const name = "S10 runSelfRepairOnce calls attemptRepair at most MAX_REPAIRS_PER_SWEEP times";
  try {
    assert.equal(MAX_REPAIRS_PER_SWEEP, 1, "MAX_REPAIRS_PER_SWEEP is 1");
    const stateFile = "state-s10.json";
    const mem = makeMemFs(new Map());
    const faults = [
      { name: "gbrain-curator", kind: "crash", repairable: true, blockedBy: null },
      { name: "audit-clerk", kind: "crash", repairable: true, blockedBy: null },
    ];
    let attemptCalls = 0;
    const attemptedNames = [];
    const result = await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 1, faults }),
      attemptRepair: async (fault) => { attemptCalls += 1; attemptedNames.push(fault.name); return { outcome: "repaired" }; },
      escalate: async () => ({ alerted: true }),
      now: () => 5_000_000,
      log: () => {},
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s10.jsonl",
    });
    assert.equal(attemptCalls, MAX_REPAIRS_PER_SWEEP, "attemptRepair called exactly the per-sweep cap");
    assert.equal(result.attemptsMade, MAX_REPAIRS_PER_SWEEP);
    assert.deepEqual(attemptedNames, ["gbrain-curator"], "only the first repairable fault is attempted");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S11: a fault blocked by the envelope is never passed to attemptRepair
// =====================================================================
async function testOnceEnvelopeBlockedNeverDispatched() {
  const name = "S11 runSelfRepairOnce never dispatches an envelope-blocked fault";
  try {
    const stateFile = "state-s11.json";
    const mem = makeMemFs(new Map());
    const faults = [
      { name: "heartbeat", kind: "crash", repairable: false, blockedBy: "envelope" },
    ];
    let attemptCalls = 0;
    const logs = [];
    const result = await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 1, faults }),
      attemptRepair: async () => { attemptCalls += 1; return { outcome: "repaired" }; },
      escalate: async () => ({ alerted: true }),
      now: () => 5_000_000,
      log: (m) => logs.push(m),
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s11.jsonl",
    });
    assert.equal(attemptCalls, 0, "attemptRepair never called for an envelope-blocked fault");
    assert.equal(result.attemptsMade, 0);
    assert.ok(logs.some((l) => /skipping heartbeat \(blockedBy=envelope\)/.test(l)), "blocked fault logged");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S12: attemptRepair `reverted` -> escalate called once; `repaired` -> escalate
//      NOT called
// =====================================================================
async function testOnceEscalateOnRevertedOnly() {
  const name = "S12 runSelfRepairOnce escalates on reverted but not on repaired";
  try {
    // --- reverted -> escalate once ---
    const stateFileA = "state-s12a.json";
    const memA = makeMemFs(new Map());
    let escalateCallsA = 0;
    const faultA = { name: "gbrain-curator", kind: "crash", repairable: true, blockedBy: null };
    await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 1, faults: [faultA] }),
      attemptRepair: async () => ({ outcome: "reverted", reason: "scoped-suite-red" }),
      escalate: async () => { escalateCallsA += 1; return { alerted: true }; },
      now: () => 5_000_000,
      log: () => {},
      readFile: memA.readFile,
      writeFile: memA.writeFile,
      appendFile: memA.appendFile,
      stateFile: stateFileA,
      evidenceLogFile: "ev-s12a.jsonl",
    });
    assert.equal(escalateCallsA, 1, "escalate called exactly once on reverted");

    // --- repaired -> escalate NOT called ---
    const stateFileB = "state-s12b.json";
    const memB = makeMemFs(new Map());
    let escalateCallsB = 0;
    const faultB = { name: "gbrain-curator", kind: "crash", repairable: true, blockedBy: null };
    await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 1, faults: [faultB] }),
      attemptRepair: async () => ({ outcome: "repaired", suite: "gbrain-curator.regression.test.mjs" }),
      escalate: async () => { escalateCallsB += 1; return { alerted: true }; },
      now: () => 6_000_000,
      log: () => {},
      readFile: memB.readFile,
      writeFile: memB.writeFile,
      appendFile: memB.appendFile,
      stateFile: stateFileB,
      evidenceLogFile: "ev-s12b.jsonl",
    });
    assert.equal(escalateCallsB, 0, "escalate NOT called on repaired");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S13: attemptRepair throwing does not throw out of runSelfRepairOnce
// =====================================================================
async function testOnceAttemptRepairThrowCaught() {
  const name = "S13 runSelfRepairOnce never throws when attemptRepair throws";
  try {
    const stateFile = "state-s13.json";
    const mem = makeMemFs(new Map());
    const fault = { name: "gbrain-curator", kind: "crash", repairable: true, blockedBy: null };
    const logs = [];
    const result = await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 1, faults: [fault] }),
      attemptRepair: async () => { throw new Error("lane exploded"); },
      escalate: async () => ({ alerted: true }),
      now: () => 7_000_000,
      log: (m) => logs.push(m),
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s13.jsonl",
    });
    assert.equal(result.skipped, false, "sweep still resolves (not skipped)");
    assert.equal(result.attemptsMade, 1, "the throwing attempt still counts as made");
    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0].outcome, "error");
    assert.ok(logs.some((l) => /attemptRepair threw for gbrain-curator/.test(l)), "throw logged");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher self-repair regression tests");
  await testReadRecentSweeps();
  await testDetectFaultingSteps();
  await testClassifyFault();
  await testRepairScopeFor();
  await testShouldAttemptRepair();
  await testRunSelfRepairScan();
  await testAppendEvidenceNeverThrows();
  await testOnceSkipsInsideCooldown();
  await testOncePastIntervalZeroFaults();
  await testOnceCapsRepairsPerSweep();
  await testOnceEnvelopeBlockedNeverDispatched();
  await testOnceEscalateOnRevertedOnly();
  await testOnceAttemptRepairThrowCaught();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("self-repair regression runner crashed:", err); process.exit(1); });