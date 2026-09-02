// ops-watcher/lane-guard.regression.test.mjs
// Regression tests for ops-watcher/lane-guard.mjs. Fully offline: all routing
// health operations are injected, so the real routing-state.json is never read
// or written.
//
//   node ops-watcher/lane-guard.regression.test.mjs

import assert from "node:assert/strict";
import { LANE_KEYS, guardLaneStart, recordLaneOutcome, isUnusableModelOutput } from "./lane-guard.mjs";

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
    const result = await recordLaneOutcome("corleone", { ok: true, stdout: "done with quota exhausted handling", stderr: "" }, {
      clearFailure: async (laneKey) => { calls.push(laneKey); },
      recordQuotaExhausted: async () => { throw new Error("success must not record quota"); },
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

// =====================================================================
// G9: successful output that discusses quota still records success
// =====================================================================
async function testRecordOutcomeSuccessNeverClassifiesQuota() {
  const name = "G9 recordLaneOutcome ok=true quota-looking stdout records success, not quota";
  try {
    const clearCalls = [];
    const quotaCalls = [];
    const failureCalls = [];
    const result = await recordLaneOutcome("corleone", {
      ok: true,
      stdout: "provider.auth_error: 403 You've reached your weekly (7-day) usage limit.",
      stderr: "",
    }, {
      clearFailure: async (laneKey) => { clearCalls.push(laneKey); },
      recordQuotaExhausted: async (laneKey, reason) => { quotaCalls.push({ laneKey, reason }); },
      recordFailure: async (laneKey, reason) => { failureCalls.push({ laneKey, reason }); },
    });
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "success");
    assert.equal(result.laneKey, "codex");
    assert.deepEqual(clearCalls, ["codex"]);
    assert.deepEqual(quotaCalls, []);
    assert.deepEqual(failureCalls, []);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G10: prompt text is removed before quota classification
// =====================================================================
async function testRecordOutcomePromptTextScrubbedBeforeQuotaClassification() {
  const name = "G10 recordLaneOutcome promptText quota phrase alone records ordinary failure";
  try {
    const quotaCalls = [];
    const failureCalls = [];
    const promptText = "Please handle provider.auth_error: 403 You've reached your weekly (7-day) usage limit.";
    const result = await recordLaneOutcome("corleone", {
      ok: false,
      stdout: `Reading additional input from stdin...\n${promptText}\nWorking on patch.`,
      stderr: "ERROR codex_skills_extension::loader::host: skills scan reached its traversal limit",
      promptText,
    }, {
      recordQuotaExhausted: async (laneKey, reason) => { quotaCalls.push({ laneKey, reason }); },
      recordFailure: async (laneKey, reason) => { failureCalls.push({ laneKey, reason }); },
    });
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "failure");
    assert.equal(result.laneKey, "codex");
    assert.deepEqual(quotaCalls, []);
    assert.equal(failureCalls.length, 1);
    assert.equal(failureCalls[0].laneKey, "codex");
    assert.match(failureCalls[0].reason, /Reading additional input from stdin/);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G8: unusable model output truth table
// =====================================================================
async function testIsUnusableModelOutputTruthTable() {
  const name = "G8 isUnusableModelOutput classifies empty/meta/quota/short replies";
  try {
    assert.deepEqual(isUnusableModelOutput(""), { unusable: true, reason: "empty output" });
    assert.deepEqual(isUnusableModelOutput("   \n\t  "), { unusable: true, reason: "empty output" });
    assert.deepEqual(isUnusableModelOutput("Response truncated due to output length limit"), { unusable: true, reason: "output truncated" });
    assert.deepEqual(
      isUnusableModelOutput("provider.auth_error: 403 You've reached your weekly (7-day) usage limit."),
      { unusable: true, reason: "lane quota/auth error" },
    );
    assert.deepEqual(isUnusableModelOutput("ok"), { unusable: true, reason: "output too short" });
    assert.deepEqual(
      isUnusableModelOutput("Issue ini terblokir karena kredensial owner belum tersedia. Tim tidak bisa melanjutkan deploy sampai akses tersebut diberikan. Mohon konfirmasi kredensial yang aman untuk membuka jalur kerja berikutnya."),
      { unusable: false },
    );
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G11: a timed-out run is never classified as quota-exhausted, even when the
// captured output contains a quota-shaped phrase. The injected
// recordQuotaExhausted spy must never be called; the run is recorded as an
// ordinary failure instead.
// =====================================================================
async function testRecordOutcomeTimedOutNeverClassifiesQuota() {
  const name = "G11 recordLaneOutcome timedOut=true with quota-shaped stderr records failure, never quota";
  try {
    const quotaCalls = [];
    const failureCalls = [];
    const result = await recordLaneOutcome("corleone", {
      ok: false,
      timedOut: true,
      stderr: "You've hit your usage limit",
    }, {
      recordQuotaExhausted: async (laneKey, reason) => { quotaCalls.push({ laneKey, reason }); },
      recordFailure: async (laneKey, reason) => { failureCalls.push({ laneKey, reason }); },
    });
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "failure");
    assert.equal(result.laneKey, "codex");
    assert.deepEqual(quotaCalls, []);
    assert.equal(failureCalls.length, 1);
    assert.equal(failureCalls[0].laneKey, "codex");
    assert.match(failureCalls[0].reason, /You've hit your usage limit/);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G12: the same quota-shaped failure with timedOut: false still records quota
// (proves the existing quota path is intact and the timedOut guard is precise).
// =====================================================================
async function testRecordOutcomeTimedOutFalseStillClassifiesQuota() {
  const name = "G12 recordLaneOutcome timedOut=false with quota-shaped stderr records quota";
  try {
    const quotaCalls = [];
    const failureCalls = [];
    const result = await recordLaneOutcome("corleone", {
      ok: false,
      timedOut: false,
      stderr: "You've hit your usage limit",
    }, {
      recordQuotaExhausted: async (laneKey, reason) => { quotaCalls.push({ laneKey, reason }); },
      recordFailure: async (laneKey, reason) => { failureCalls.push({ laneKey, reason }); },
    });
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "quota");
    assert.equal(result.laneKey, "codex");
    assert.equal(quotaCalls.length, 1);
    assert.equal(quotaCalls[0].laneKey, "codex");
    assert.deepEqual(failureCalls, []);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G13: the same quota-shaped failure with timedOut absent still records quota
// (proves backward compatibility — the flag is not yet passed by dispatch
// wrappers and behaviour must be unchanged when it is missing).
// =====================================================================
async function testRecordOutcomeTimedOutAbsentStillClassifiesQuota() {
  const name = "G13 recordLaneOutcome timedOut absent with quota-shaped stderr records quota";
  try {
    const quotaCalls = [];
    const failureCalls = [];
    const result = await recordLaneOutcome("corleone", {
      ok: false,
      stderr: "You've hit your usage limit",
    }, {
      recordQuotaExhausted: async (laneKey, reason) => { quotaCalls.push({ laneKey, reason }); },
      recordFailure: async (laneKey, reason) => { failureCalls.push({ laneKey, reason }); },
    });
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "quota");
    assert.equal(result.laneKey, "codex");
    assert.equal(quotaCalls.length, 1);
    assert.equal(quotaCalls[0].laneKey, "codex");
    assert.deepEqual(failureCalls, []);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G14: a successful run that also reports timedOut=true still clears the lane
// and records success. A timeout flag on an ok run is contradictory, but the
// success branch must win — success is the strongest signal and must never be
// downgraded by a stale timeout flag.
// =====================================================================
async function testRecordOutcomeTimedOutSuccessStillClears() {
  const name = "G14 recordLaneOutcome ok=true timedOut=true still clears the lane";
  try {
    const clearCalls = [];
    const quotaCalls = [];
    const failureCalls = [];
    const result = await recordLaneOutcome("corleone", {
      ok: true,
      timedOut: true,
      stdout: "You've hit your usage limit",
      stderr: "",
    }, {
      clearFailure: async (laneKey) => { clearCalls.push(laneKey); },
      recordQuotaExhausted: async (laneKey, reason) => { quotaCalls.push({ laneKey, reason }); },
      recordFailure: async (laneKey, reason) => { failureCalls.push({ laneKey, reason }); },
    });
    assert.equal(result.recorded, true);
    assert.equal(result.kind, "success");
    assert.equal(result.laneKey, "codex");
    assert.deepEqual(clearCalls, ["codex"]);
    assert.deepEqual(quotaCalls, []);
    assert.deepEqual(failureCalls, []);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// G15: the quota path must hand recordQuotaExhausted the FULL text. It used to
// pass first200(text), and the provider states its reset time at the END of the
// transcript, so the hint was thrown away and the lane was parked for the flat
// 6h quota cooldown instead of the ~45 minutes it needed. Verified live on
// 2026-09-02 against the CORLEONE lane.
// =====================================================================
async function testQuotaPathReceivesFullText() {
  const name = "G15 quota classification passes the full text so the retry hint survives";
  try {
    const captured = [];
    const stdout = "transcript line\n".repeat(400)
      + "ERROR: You've hit your usage limit. Upgrade to Pro or try again at 9:03 AM.";
    const res = await recordLaneOutcome("corleone", { ok: false, stdout, stderr: "" }, {
      recordQuotaExhausted: async (lane, reason) => { captured.push({ lane, reason }); },
      recordFailure: async () => { throw new Error("must not be classified as an ordinary failure"); },
      clearFailure: async () => { throw new Error("must not clear the lane"); },
    });
    assert.equal(res.kind, "quota");
    assert.equal(captured.length, 1);
    assert.ok(captured[0].reason.length > 200, "the reason must not be pre-truncated to 200 chars");
    assert.ok(/try again at 9:03 AM/i.test(captured[0].reason), "the retry hint must reach recordQuotaExhausted");
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
  await testIsUnusableModelOutputTruthTable();
  await testRecordOutcomeSuccessNeverClassifiesQuota();
  await testRecordOutcomePromptTextScrubbedBeforeQuotaClassification();
  await testRecordOutcomeTimedOutNeverClassifiesQuota();
  await testRecordOutcomeTimedOutFalseStillClassifiesQuota();
  await testRecordOutcomeTimedOutAbsentStillClassifiesQuota();
  await testRecordOutcomeTimedOutSuccessStillClears();
  await testQuotaPathReceivesFullText();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("lane-guard regression runner crashed:", err); process.exit(1); });