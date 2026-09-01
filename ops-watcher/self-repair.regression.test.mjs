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
  appendEvidence,
  classifyFault,
  detectFaultingSteps,
  readRecentSweeps,
  repairScopeFor,
  runSelfRepairScan,
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

async function main() {
  console.log("# ops-watcher self-repair regression tests");
  await testReadRecentSweeps();
  await testDetectFaultingSteps();
  await testClassifyFault();
  await testRepairScopeFor();
  await testShouldAttemptRepair();
  await testRunSelfRepairScan();
  await testAppendEvidenceNeverThrows();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("self-repair regression runner crashed:", err); process.exit(1); });
