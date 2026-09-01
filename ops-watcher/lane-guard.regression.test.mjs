// ops-watcher/lane-guard.regression.test.mjs
// Regression tests for ops-watcher/lane-guard.mjs. Fully offline: all routing
// health operations are injected, so the real routing-state.json is never read
// or written.
//
//   node ops-watcher/lane-guard.regression.test.mjs

import assert from "node:assert/strict";
import { LANE_KEYS, guardLaneStart, recordLaneOutcome } from "./lane-guard.mjs";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

// =====================================================================
// G1: LANE_KEYS maps wrappers to routing probe keys
// =====================================================================
async function testLaneKeysMapping() {
  const name = "G1 LANE_KEYS maps dispatch wrapper lanes to routing lane keys";
  try {
    assert.equal(LANE_KEYS.corleone, "codex");
    assert.equal(LANE_KEYS.sjahrir, "kimi");
    assert.equal(LANE_KEYS.hatta, "ollama");
    assert.equal(LANE_KEYS["hatta-flash"], "ollama");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G2: guardLaneStart honors injected shouldSkipLane and resolved key
// =====================================================================
async function testGuardLaneStartSkipsWithResolvedKey() {
  const name = "G2 guardLaneStart returns skip=true quota and passes resolved lane key";
  try {
    const calls = [];
    const result = await guardLaneStart("sjahrir", {
      shouldSkipLane: async (laneKey) => {
        calls.push(laneKey);
        return { skip: true, reason: "quota", remainingMs: 123456 };
      },
    });
    assert.deepEqual(calls, ["kimi"]);
    assert.equal(result.skip, true);
    assert.equal(result.reason, "quota");
    assert.equal(result.remainingMs, 123456);
    assert.equal(result.laneKey, "kimi");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G3: guardLaneStart fails open
// =====================================================================
async function testGuardLaneStartFailsOpen() {
  const name = "G3 guardLaneStart fails open when injected shouldSkipLane throws";
  try {
    const result = await guardLaneStart("sjahrir", {
      shouldSkipLane: async () => { throw new Error("state file broken"); },
    });
    assert.equal(result.skip, false);
    assert.equal(result.reason, null);
    assert.equal(result.remainingMs, 0);
    assert.equal(result.laneKey, "kimi");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G4: success clears failure state
// =====================================================================
async function testRecordOutcomeSuccessClearsFailure() {
  const name = "G4 recordLaneOutcome ok=true calls clearFailure with resolved key";
  try {
    const calls = [];
    const result = await recordLaneOutcome("corleone", { ok: true, stdout: "done", stderr: "" }, {
      clearFailure: async (laneKey) => { calls.push(laneKey); },
    });
    assert.deepEqual(calls, ["codex"]);
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "success");
    assert.equal(result.laneKey, "codex");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G5: quota text records quota, not ordinary failure
// =====================================================================
async function testRecordOutcomeQuotaFailure() {
  const name = "G5 recordLaneOutcome real weekly-limit stderr records quota only";
  try {
    const quotaCalls = [];
    const failureCalls = [];
    const stderr = "provider.auth_error: 403 You've reached your weekly (7-day) usage limit.";
    const result = await recordLaneOutcome("sjahrir", { ok: false, stderr }, {
      recordQuotaExhausted: async (laneKey, reason) => { quotaCalls.push({ laneKey, reason }); },
      recordFailure: async (laneKey, reason) => { failureCalls.push({ laneKey, reason }); },
    });
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "quota");
    assert.equal(result.laneKey, "kimi");
    assert.equal(quotaCalls.length, 1);
    assert.equal(quotaCalls[0].laneKey, "kimi");
    assert.match(quotaCalls[0].reason, /weekly \(7-day\) usage limit/);
    assert.deepEqual(failureCalls, []);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G6: unrelated failure records ordinary failure, not quota
// =====================================================================
async function testRecordOutcomeOrdinaryFailure() {
  const name = "G6 recordLaneOutcome unrelated ENOENT records ordinary failure only";
  try {
    const quotaCalls = [];
    const failureCalls = [];
    const result = await recordLaneOutcome("hatta-flash", { ok: false, stderr: "ENOENT" }, {
      recordQuotaExhausted: async (laneKey, reason) => { quotaCalls.push({ laneKey, reason }); },
      recordFailure: async (laneKey, reason) => { failureCalls.push({ laneKey, reason }); },
    });
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "failure");
    assert.equal(result.laneKey, "ollama");
    assert.deepEqual(quotaCalls, []);
    assert.equal(failureCalls.length, 1);
    assert.deepEqual(failureCalls[0], { laneKey: "ollama", reason: "\nENOENT" });
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G7: recorder failures are swallowed
// =====================================================================
async function testRecordOutcomeRecorderThrows() {
  const name = "G7 recordLaneOutcome never throws when injected recorder throws";
  try {
    const result = await recordLaneOutcome("hatta", { ok: false, stderr: "ENOENT" }, {
      recordFailure: async () => { throw new Error("disk broken"); },
    });
    assert.equal(result.recorded, false);
    assert.equal(result.kind, "error");
    assert.equal(result.laneKey, "ollama");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher lane-guard regression tests");
  await testLaneKeysMapping();
  await testGuardLaneStartSkipsWithResolvedKey();
  await testGuardLaneStartFailsOpen();
  await testRecordOutcomeSuccessClearsFailure();
  await testRecordOutcomeQuotaFailure();
  await testRecordOutcomeOrdinaryFailure();
  await testRecordOutcomeRecorderThrows();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("lane-guard regression runner crashed:", err); process.exit(1); });
