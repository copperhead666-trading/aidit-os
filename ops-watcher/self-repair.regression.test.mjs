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
  NOT_REPRODUCIBLE_ESCALATE_AFTER,
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
import { escalate as ownerEscalate } from "./self-repair-actuator.mjs";

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

function repairableFault(name = "gbrain-curator", opts = {}) {
  return {
    name,
    kind: opts.kind || "crash",
    reason: opts.reason || "newest record had failed exit and runtime-failure excerpt",
    consecutiveFailures: opts.consecutiveFailures || CONSECUTIVE_FAILURES_TO_ACT,
    repairable: opts.repairable === undefined ? true : opts.repairable,
    blockedBy: opts.blockedBy === undefined ? null : opts.blockedBy,
    records: opts.records || [rec(name, { excerpt: "ReferenceError: x is not defined" })],
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

// =====================================================================
// S14: repeated not-reproducible outcomes escalate exactly once at the
//      configured threshold
// =====================================================================
async function testOnceNotReproducibleEscalatesExactlyOnce() {
  const name = "S14 runSelfRepairOnce escalates not-reproducible exactly once at threshold";
  try {
    assert.equal(NOT_REPRODUCIBLE_ESCALATE_AFTER, 3, "not-reproducible threshold is 3 attempts");
    const stateFile = "state-s14.json";
    const mem = makeMemFs(new Map());
    const fault = repairableFault("gbrain-curator");
    const escalations = [];
    const logs = [];
    let attemptCalls = 0;
    let nowMs = 10_000_000;

    for (let i = 1; i <= NOT_REPRODUCIBLE_ESCALATE_AFTER; i++) {
      nowMs += SCAN_MIN_INTERVAL_MS + 1;
      const result = await runSelfRepairOnce({
        scan: async () => ({ scannedSweeps: 3, faults: [fault] }),
        attemptRepair: async () => { attemptCalls += 1; return { outcome: "not-reproducible" }; },
        escalate: async (f, evidence) => { escalations.push({ fault: f, evidence }); return { alerted: true }; },
        now: () => nowMs,
        log: (m) => logs.push(m),
        readFile: mem.readFile,
        writeFile: mem.writeFile,
        appendFile: mem.appendFile,
        stateFile,
        evidenceLogFile: "ev-s14.jsonl",
      });
      assert.equal(result.skipped, false, `sweep ${i} ran`);
      assert.equal(result.attemptsMade, 1, `sweep ${i} made one attempt`);
      assert.equal(result.outcomes[0].outcome, "not-reproducible");
      assert.equal(escalations.length, i < NOT_REPRODUCIBLE_ESCALATE_AFTER ? 0 : 1, `escalation count after sweep ${i}`);
    }

    assert.equal(attemptCalls, NOT_REPRODUCIBLE_ESCALATE_AFTER, "one repair attempt per sweep until threshold");
    assert.equal(escalations.length, 1, "not zero and not every sweep");
    assert.equal(escalations[0].fault.stuckUnhealable.count, NOT_REPRODUCIBLE_ESCALATE_AFTER);
    assert.ok(logs.some((l) => /unhealable \(not-reproducible x3\).*escalated to owner/.test(l)), "threshold escalation logged");

    nowMs += SCAN_MIN_INTERVAL_MS + 1;
    const afterEscalation = await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 3, faults: [fault] }),
      attemptRepair: async () => { attemptCalls += 1; return { outcome: "not-reproducible" }; },
      escalate: async (f, evidence) => { escalations.push({ fault: f, evidence }); return { alerted: true }; },
      now: () => nowMs,
      log: (m) => logs.push(m),
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s14.jsonl",
    });
    assert.equal(afterEscalation.skipped, false, "next sweep ran outside scan cooldown");
    assert.equal(afterEscalation.attemptsMade, 0, "already escalated stuck step is not attempted again");
    assert.equal(attemptCalls, NOT_REPRODUCIBLE_ESCALATE_AFTER, "no extra repair attempt after escalation");
    assert.equal(escalations.length, 1, "no repeat escalation after escalation stamp");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S15: detector reports an already escalated stuck fault as escalated, not
//      cooldown, and runSelfRepairOnce leaves it alone
// =====================================================================
async function testEscalatedStuckFaultBlocksBeforeCooldown() {
  const name = "S15 runSelfRepairScan reports escalated stuck faults before cooldown";
  try {
    const stateFile = "state-s15.json";
    const stepLogFile = "steps-s15.jsonl";
    const nowMs = 50_000_000;
    const sweeps = [
      sweep([rec("gbrain-curator", { excerpt: "ReferenceError: x is not defined" })]),
      sweep([rec("gbrain-curator", { excerpt: "ReferenceError: x is not defined" })]),
      sweep([rec("gbrain-curator", { excerpt: "ReferenceError: x is not defined" })]),
    ];
    const mem = makeMemFs(new Map([
      [stepLogFile, sweeps.map((s) => JSON.stringify(s)).join("\n") + "\n"],
      [stateFile, JSON.stringify({
        attempts: { "gbrain-curator": { lastAttemptMs: nowMs - 1 } },
        stuck: {
          "gbrain-curator": {
            count: NOT_REPRODUCIBLE_ESCALATE_AFTER,
            firstNotReproducibleMs: nowMs - 1000,
            escalatedMs: nowMs - 500,
          },
        },
      })],
    ]));

    const scanResult = await runSelfRepairScan({
      stepLogFile,
      stateFile,
      evidenceLogFile: "ev-s15.jsonl",
      now: () => nowMs,
      log: () => {},
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
    });
    assert.equal(scanResult.faults.length, 1);
    assert.equal(scanResult.faults[0].name, "gbrain-curator");
    assert.equal(scanResult.faults[0].repairable, false);
    assert.equal(scanResult.faults[0].blockedBy, "escalated", "escalated wins over cooldown");

    let attempts = 0;
    let escalations = 0;
    const logs = [];
    const onceResult = await runSelfRepairOnce({
      scan: async () => scanResult,
      attemptRepair: async () => { attempts += 1; return { outcome: "repaired" }; },
      escalate: async () => { escalations += 1; return { alerted: true }; },
      now: () => nowMs + SCAN_MIN_INTERVAL_MS + 1,
      log: (m) => logs.push(m),
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s15.jsonl",
    });

    assert.equal(onceResult.skipped, false);
    assert.equal(onceResult.attemptsMade, 0, "next sweep does not attempt repair");
    assert.equal(attempts, 0, "attemptRepair not called");
    assert.equal(escalations, 0, "escalate not called again");
    assert.ok(logs.some((l) => /skipping gbrain-curator \(blockedBy=escalated\)/.test(l)), "escalated skip reason logged");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S16: a recovered step clears its stuck record, so a later new failure can
//      escalate again after the threshold
// =====================================================================
async function testRecoveredStepClearsStuckRecord() {
  const name = "S16 runSelfRepairOnce clears stuck state after recovery";
  try {
    const stateFile = "state-s16.json";
    const mem = makeMemFs(new Map([
      [stateFile, JSON.stringify({
        lastScanMs: 1,
        stuck: {
          "gbrain-curator": {
            count: NOT_REPRODUCIBLE_ESCALATE_AFTER,
            firstNotReproducibleMs: 1_000,
            escalatedMs: 2_000,
          },
        },
      })],
    ]));
    let nowMs = 100_000_000;
    const logs = [];

    const recovered = await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 3, faults: [] }),
      attemptRepair: async () => ({ outcome: "repaired" }),
      escalate: async () => ({ alerted: true }),
      now: () => nowMs,
      log: (m) => logs.push(m),
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s16.jsonl",
    });
    assert.equal(recovered.skipped, false);
    assert.equal(recovered.attemptsMade, 0);
    let stateAfter = JSON.parse(mem.files.get(stateFile));
    assert.equal(Object.prototype.hasOwnProperty.call(stateAfter.stuck || {}, "gbrain-curator"), false, "stuck entry cleared");
    assert.ok(logs.some((l) => /gbrain-curator recovered.*cleared stuck record/.test(l)), "recovery cleanup logged");

    const fault = repairableFault("gbrain-curator");
    const escalations = [];
    for (let i = 1; i <= NOT_REPRODUCIBLE_ESCALATE_AFTER; i++) {
      nowMs += SCAN_MIN_INTERVAL_MS + 1;
      await runSelfRepairOnce({
        scan: async () => ({ scannedSweeps: 3, faults: [fault] }),
        attemptRepair: async () => ({ outcome: "not-reproducible" }),
        escalate: async (f) => { escalations.push(f); return { alerted: true }; },
        now: () => nowMs,
        log: () => {},
        readFile: mem.readFile,
        writeFile: mem.writeFile,
        appendFile: mem.appendFile,
        stateFile,
        evidenceLogFile: "ev-s16.jsonl",
      });
    }
    assert.equal(escalations.length, 1, "future failure can escalate again after fresh threshold");
    assert.equal(escalations[0].stuckUnhealable.count, NOT_REPRODUCIBLE_ESCALATE_AFTER);
    stateAfter = JSON.parse(mem.files.get(stateFile));
    assert.equal(stateAfter.stuck["gbrain-curator"].count, NOT_REPRODUCIBLE_ESCALATE_AFTER);
    assert.ok(Number.isFinite(stateAfter.stuck["gbrain-curator"].escalatedMs));
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S17: repairable faults retain prior behavior: reverted escalates, repaired
//      does not, and pre-threshold not-reproducible does not
// =====================================================================
async function testRepairableFaultOutcomesKeepOldEscalationBehavior() {
  const name = "S17 runSelfRepairOnce keeps repairable outcome escalation behavior";
  try {
    async function runOutcome(outcome, suffix) {
      const stateFile = `state-s17-${suffix}.json`;
      const mem = makeMemFs(new Map());
      let escalations = 0;
      let attempts = 0;
      const result = await runSelfRepairOnce({
        scan: async () => ({ scannedSweeps: 3, faults: [repairableFault("gbrain-curator")] }),
        attemptRepair: async () => { attempts += 1; return { outcome, reason: outcome === "reverted" ? "scoped-suite-red" : undefined }; },
        escalate: async () => { escalations += 1; return { alerted: true }; },
        now: () => 200_000_000 + suffix,
        log: () => {},
        readFile: mem.readFile,
        writeFile: mem.writeFile,
        appendFile: mem.appendFile,
        stateFile,
        evidenceLogFile: `ev-s17-${suffix}.jsonl`,
      });
      return { result, escalations, attempts };
    }

    const reverted = await runOutcome("reverted", 1);
    assert.equal(reverted.attempts, 1);
    assert.equal(reverted.result.outcomes[0].outcome, "reverted");
    assert.equal(reverted.escalations, 1, "reverted still escalates");

    const repaired = await runOutcome("repaired", 2);
    assert.equal(repaired.attempts, 1);
    assert.equal(repaired.result.outcomes[0].outcome, "repaired");
    assert.equal(repaired.escalations, 0, "repaired still does not escalate");

    const notReproducible = await runOutcome("not-reproducible", 3);
    assert.equal(notReproducible.attempts, 1);
    assert.equal(notReproducible.result.outcomes[0].outcome, "not-reproducible");
    assert.equal(notReproducible.escalations, 0, "not-reproducible below threshold does not replace reverted escalation");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S18: state writer failures and escalation sender throws do not escape or
//      change the sweep outcome
// =====================================================================
async function testOnceStateWriterAndEscalationThrowCaught() {
  const name = "S18 runSelfRepairOnce tolerates state writer and escalation sender throws";
  try {
    const fault = repairableFault("gbrain-curator");

    const readOnlyState = JSON.stringify({
      stuck: {
        "gbrain-curator": {
          count: NOT_REPRODUCIBLE_ESCALATE_AFTER - 1,
          firstNotReproducibleMs: 1_000,
        },
      },
    });
    const writerThrowResult = await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 3, faults: [fault] }),
      attemptRepair: async () => ({ outcome: "not-reproducible" }),
      escalate: async () => ({ alerted: true }),
      now: () => 300_000_000,
      log: () => {},
      readFile: async () => readOnlyState,
      writeFile: async () => { throw new Error("state disk full"); },
      appendFile: async () => {},
      stateFile: "state-s18a.json",
      evidenceLogFile: "ev-s18a.jsonl",
    });
    assert.equal(writerThrowResult.skipped, false, "writer-throw sweep still ran");
    assert.equal(writerThrowResult.attemptsMade, 1);
    assert.equal(writerThrowResult.outcomes[0].outcome, "not-reproducible");

    const stateFile = "state-s18b.json";
    const mem = makeMemFs(new Map([
      [stateFile, readOnlyState],
    ]));
    const logs = [];
    const senderThrowResult = await runSelfRepairOnce({
      scan: async () => ({ scannedSweeps: 3, faults: [fault] }),
      attemptRepair: async () => ({ outcome: "not-reproducible" }),
      escalate: async () => { throw new Error("alert relay down"); },
      now: () => 400_000_000,
      log: (m) => logs.push(m),
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      appendFile: mem.appendFile,
      stateFile,
      evidenceLogFile: "ev-s18b.jsonl",
    });
    assert.equal(senderThrowResult.skipped, false, "sender-throw sweep still ran");
    assert.equal(senderThrowResult.attemptsMade, 1);
    assert.equal(senderThrowResult.outcomes[0].outcome, "not-reproducible");
    assert.ok(logs.some((l) => /escalate threw for gbrain-curator/.test(l)), "sender throw logged");
    const stateAfter = JSON.parse(mem.files.get(stateFile));
    assert.equal(stateAfter.stuck["gbrain-curator"].count, NOT_REPRODUCIBLE_ESCALATE_AFTER);
    assert.equal(Number.isFinite(stateAfter.stuck["gbrain-curator"].escalatedMs), false, "failed escalation is not stamped delivered");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// S19: unhealable escalation message includes the attempt count and the reason
//      rollback-based repair cannot help
// =====================================================================
async function testUnhealableEscalationMessageIncludesCountAndReason() {
  const name = "S19 owner escalation message explains unhealable not-reproducible fault";
  try {
    const stateFile = "state-s19.json";
    const mem = makeMemFs(new Map([
      [stateFile, JSON.stringify({ escalations: {} })],
    ]));
    let message = "";
    const result = await ownerEscalate({
      name: "gbrain-curator",
      kind: "crash",
      stuckUnhealable: {
        count: NOT_REPRODUCIBLE_ESCALATE_AFTER,
        firstNotReproducibleMs: 123_000,
        escalatedMs: 456_000,
      },
    }, [], {
      now: () => 500_000_000,
      readFile: mem.readFile,
      writeFile: mem.writeFile,
      stateFile,
      postAlert: async (m) => { message = m; return { pid: 4242 }; },
    });

    assert.equal(result.alerted, true, "injected postAlert delivered");
    assert.ok(message.includes(`${NOT_REPRODUCIBLE_ESCALATE_AFTER}x percobaan perbaikan`), "message includes attempt count");
    assert.ok(message.includes("not-reproducible"), "message names the repeated outcome");
    assert.ok(message.includes("suite regresi hijau"), "message explains the scoped suite is green");
    assert.ok(message.includes("data hidup, bukan kode"), "message explains the live data/code distinction");
    assert.ok(message.includes("rollback tidak akan pernah menyentuh akar masalah"), "message explains why rollback cannot repair it");
    assert.ok(message.includes("berhenti mencoba step ini"), "message states auto-repair stops for this step");
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
  await testOnceNotReproducibleEscalatesExactlyOnce();
  await testEscalatedStuckFaultBlocksBeforeCooldown();
  await testRecoveredStepClearsStuckRecord();
  await testRepairableFaultOutcomesKeepOldEscalationBehavior();
  await testOnceStateWriterAndEscalationThrowCaught();
  await testUnhealableEscalationMessageIncludesCountAndReason();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("self-repair regression runner crashed:", err); process.exit(1); });
