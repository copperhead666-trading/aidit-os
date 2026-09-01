// ops-watcher/audit-clerk.regression.test.mjs
// Offline regression coverage for AUDIT-CLERK. NO real Hermes, NO real kimi,
// NO real ahmad-notify, NO real pm2/Paperclip, and no real repo filesystem reads.
//
//   node ops-watcher/audit-clerk.regression.test.mjs

import assert from "node:assert/strict";
import {
  buildRegistryDriftPrompt,
  classifyDriftOutput,
  extractDriftAnswer,
  isQuotaExhaustedFailure,
  runAuditClerkOnce,
  shouldRunDriftCheck,
  DRIFT_MIN_INTERVAL_MS,
} from "./audit-clerk.mjs";

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

const NOW = 2_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const REAL_KIMI_QUOTA_TEXT = "provider.auth_error: 403 You've reached your weekly (7-day) usage limit.";

function fakeStateStore(initial = { alerts: {} }) {
  let stored = JSON.parse(JSON.stringify(initial));
  return {
    readState: async () => JSON.parse(JSON.stringify(stored)),
    writeState: async (_file, state) => { stored = JSON.parse(JSON.stringify(state)); },
    getStored: () => stored,
  };
}

function makeDeps(overrides = {}) {
  const alertCalls = [];
  const stateStore = fakeStateStore(overrides.initialState || { alerts: {} });
  const deps = {
    repoRoot: "/repo",
    readAllowedScripts: async () => [],
    statFile: async () => ({ isFile: () => true }),
    readFile: async (filePath) => {
      throw new Error(`unexpected read ${filePath}`);
    },
    dispatchHermes: async () => ({ ok: true, stdout: "NO INCONSISTENCIES FOUND", stderr: "" }),
    // Default lane guard: lane is healthy, never skip. Existing tests rely on
    // the drift dispatcher actually running when the interval allows it.
    guardLane: async () => ({ skip: false, reason: null, remainingMs: 0 }),
    readState: stateStore.readState,
    writeState: stateStore.writeState,
    postAlert: (msg) => {
      alertCalls.push(msg);
      return { pid: 4242 };
    },
    now: () => NOW,
    log: () => {},
    ...overrides,
  };
  delete deps.initialState;
  return { deps, alertCalls, stateStore };
}

async function t1_orphanedAllowlistExistingNoFinding() {
  const { deps } = makeDeps({
    readAllowedScripts: async () => ["ops-watcher/heartbeat.mjs"],
    statFile: async () => ({ isFile: () => true }),
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.filter((f) => f.check === "orphaned-allowlist").length, 0, "T1: existing allowlist entry produces no finding");
  ok("T1: existing ALLOWED_SCRIPTS entry -> no orphaned-allowlist finding");
}

async function t2_orphanedAllowlistMissingWarns() {
  const missing = "ops-watcher/missing-script.mjs";
  const { deps } = makeDeps({
    readAllowedScripts: async () => ["ops-watcher/heartbeat.mjs", missing],
    statFile: async (_root, relPath) => {
      if (relPath === missing) throw new Error("ENOENT");
      return { isFile: () => true };
    },
  });
  const r = await runAuditClerkOnce(deps);
  const findings = r.results.filter((f) => f.check === "orphaned-allowlist");
  assert.equal(findings.length, 1, "T2: exactly one orphaned finding");
  assert.equal(findings[0].key, `orphaned-allowlist:${missing}`, "T2: key names missing path");
  assert.equal(findings[0].severity, "WARNING", "T2: severity WARNING");
  assert.ok(findings[0].detail.includes(missing), "T2: detail names missing path");
  ok("T2: missing ALLOWED_SCRIPTS entry -> one orphaned-allowlist WARNING");
}

async function t3_registryNoInconsistenciesNoFinding() {
  const { deps } = makeDeps({
    dispatchHermes: async () => ({ ok: true, stdout: "NO INCONSISTENCIES FOUND\n", stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.find((f) => f.check === "registry-drift"), undefined, "T3: no registry-drift finding");
  ok("T3: Hermes exact no-inconsistencies phrase -> no registry-drift finding");
}

async function t3b_registryNoInconsistenciesTrailingPeriodNoFinding() {
  const { deps, alertCalls } = makeDeps({
    dispatchHermes: async () => ({ ok: true, stdout: "NO INCONSISTENCIES FOUND.\n", stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.find((f) => f.check === "registry-drift"), undefined, "T3b: no registry-drift finding");
  assert.equal(alertCalls.length, 0, "T3b: no alert for trailing-period no-inconsistencies phrase");
  ok("T3b: Hermes no-inconsistencies phrase with trailing period/newline -> no registry-drift finding or alert");
}

async function t4_registryInconsistencyTextBecomesOneFinding() {
  const text = "- CORLEONE: registry says resting; role map says active lane.";
  const { deps } = makeDeps({
    dispatchHermes: async () => ({ ok: true, stdout: text, stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  const findings = r.results.filter((f) => f.key === "registry-drift");
  assert.equal(findings.length, 1, "T4: exactly one registry-drift finding");
  assert.equal(findings[0].severity, "WARNING", "T4: severity WARNING");
  assert.ok(findings[0].detail.includes("CORLEONE"), "T4: detail contains Hermes finding text");
  ok("T4: Hermes inconsistency text -> exactly one registry-drift WARNING containing that text");
}

async function t4b_registryTruncatedHermesOutputBecomesCheckFailed() {
  const { deps } = makeDeps({
    dispatchHermes: async () => ({ ok: true, stdout: "Response truncated due to output length limit", stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  const failed = r.results.find((f) => f.key === "registry-drift-check-failed");
  assert.ok(failed, "T4b: check-failed finding exists");
  assert.equal(r.results.find((f) => f.key === "registry-drift"), undefined, "T4b: no fake registry-drift finding");
  assert.ok(failed.detail.includes("tidak bisa menjalankan pemeriksaan konsistensi registry-drift"), "T4b: detail uses registry check failure wording");
  ok("T4b: Hermes truncation meta output -> registry-drift-check-failed, not drift");
}

async function t4c_registryBulletOutputStillBecomesDriftFinding() {
  const text = "- HATTA: registry says resting, role map says active";
  const { deps } = makeDeps({
    dispatchHermes: async () => ({ ok: true, stdout: text, stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  const findings = r.results.filter((f) => f.key === "registry-drift");
  assert.equal(findings.length, 1, "T4c: exactly one real registry-drift finding");
  assert.equal(r.results.find((f) => f.key === "registry-drift-check-failed"), undefined, "T4c: no check-failed finding on usable drift output");
  assert.equal(findings[0].detail, text, "T4c: detail preserves drift output");
  ok("T4c: Hermes bullet inconsistency output -> real registry-drift finding");
}

async function t4d_registryBlankHermesOutputBecomesCheckFailed() {
  const { deps } = makeDeps({
    dispatchHermes: async () => ({ ok: true, stdout: "   ", stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  const failed = r.results.find((f) => f.key === "registry-drift-check-failed");
  assert.ok(failed, "T4d: check-failed finding exists");
  assert.equal(r.results.find((f) => f.key === "registry-drift"), undefined, "T4d: no registry-drift finding for blank output");
  assert.ok(failed.detail.includes("output kosong"), "T4d: blank-output reason surfaced");
  ok("T4d: blank Hermes stdout -> registry-drift-check-failed, not drift");
}
async function t5_registryHermesThrowFallsBack() {
  const { deps } = makeDeps({
    dispatchHermes: async () => { throw new Error("provider exploded"); },
  });
  const r = await runAuditClerkOnce(deps);
  const findings = r.results.filter((f) => f.key === "registry-drift-check-failed");
  assert.equal(findings.length, 1, "T5: exactly one fallback finding");
  assert.equal(findings[0].severity, "WARNING", "T5: fallback severity WARNING");
  assert.ok(/tidak bisa menjalankan pemeriksaan konsistensi registry-drift/.test(findings[0].detail), "T5: detail surfaces registry check failure");
  assert.ok(/provider exploded/.test(findings[0].detail), "T5: detail includes thrown reason");
  ok("T5: Hermes throw -> fallback registry-drift-check-failed WARNING, no crash");
}

async function t6_registryHermesOkFalseFallsBack() {
  const { deps } = makeDeps({
    dispatchHermes: async () => ({ ok: false, stdout: "", stderr: "down", timedOut: true, error: "timeout" }),
  });
  const r = await runAuditClerkOnce(deps);
  const f = r.results.find((x) => x.key === "registry-drift-check-failed");
  assert.ok(f, "T6: fallback finding exists");
  assert.ok(/timeout/.test(f.detail), "T6: timeout reason surfaced");
  ok("T6: Hermes ok:false/timedOut -> visible fallback finding");
}

async function t7_cooldownSuppressesReturnedFindingOnlyFromAlert() {
  const text = "- CORLEONE drift still present.";
  const { deps, alertCalls } = makeDeps({
    initialState: {
      alerts: {
        "registry-drift": { lastAlertedAt: NOW - (60 * 60 * 1000), finding: text },
      },
    },
    dispatchHermes: async () => ({ ok: true, stdout: text, stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.length, 1, "T7: finding still returned in results");
  assert.equal(r.results[0].key, "registry-drift", "T7: registry-drift returned");
  assert.equal(alertCalls.length, 0, "T7: no alert within cooldown");
  assert.equal(r.suppressedCount, 1, "T7: suppressed count reflects finding");
  ok("T7: same finding less than 24h old is returned but suppressed from bundled alert");
}

async function t8_newAndExpiredFindingsAreAlerted() {
  const missing = "ops-watcher/old-missing.mjs";
  const text = "- CORLEONE drift present.";
  const { deps, alertCalls } = makeDeps({
    initialState: {
      alerts: {
        [`orphaned-allowlist:${missing}`]: { lastAlertedAt: NOW - DAY - 1, finding: `Entri ALLOWED_SCRIPTS tidak ada di disk: ${missing}` },
      },
    },
    readAllowedScripts: async () => [missing],
    statFile: async () => { throw new Error("ENOENT"); },
    dispatchHermes: async () => ({ ok: true, stdout: text, stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.length, 2, "T8: two findings returned");
  assert.equal(alertCalls.length, 1, "T8: one bundled alert");
  assert.ok(alertCalls[0].includes(`orphaned-allowlist:${missing}`), "T8: expired prior finding included");
  assert.ok(alertCalls[0].includes("registry-drift"), "T8: new finding included");
  assert.ok(alertCalls[0].startsWith("Peringatan drift registry/ledger AUDIT-CLERK"), "T8: bundled alert has Indonesian header");
  assert.ok(alertCalls[0].includes("Temuan (2):"), "T8: bundled alert has Indonesian findings label");
  assert.equal(r.alerted, true, "T8: alerted true");
  ok("T8: no prior alert and prior alert older than 24h are both included in one alert");
}

async function t9_zeroAlertableFindingsNoPostAlert() {
  const { deps, alertCalls } = makeDeps();
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.length, 0, "T9: zero findings");
  assert.equal(alertCalls.length, 0, "T9: postAlert not called");
  assert.equal(r.alerted, false, "T9: alerted false");
  ok("T9: zero alertable findings -> postAlert is not called");
}

async function t10_multipleFindingsOneBundledAlert() {
  const missing = "ops-watcher/not-there.mjs";
  const text = "- CORLEONE: conflicting status.";
  const { deps, alertCalls } = makeDeps({
    readAllowedScripts: async () => [missing],
    statFile: async () => { throw new Error("ENOENT"); },
    dispatchHermes: async () => ({ ok: true, stdout: text, stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.length, 2, "T10: two findings returned");
  assert.equal(alertCalls.length, 1, "T10: exactly one postAlert call");
  assert.ok(alertCalls[0].includes(`orphaned-allowlist:${missing}`), "T10: bundled alert includes allowlist finding");
  assert.ok(alertCalls[0].includes("registry-drift"), "T10: bundled alert includes registry finding");
  ok("T10: multiple simultaneous findings -> exactly ONE bundled postAlert call");
}

function t11_registryDriftPromptUsesPathsNotFileBodies() {
  const prompt = buildRegistryDriftPrompt("config/agent-registry.json", "handoffs/sjahrir/CANONICAL-ROLE-MAP.json");
  assert.ok(prompt.includes("--in pointed at the FounderOS-Aidit repository root"), "T11: prompt names workspace context");
  assert.ok(prompt.includes("config/agent-registry.json"), "T11: prompt includes registry relative path");
  assert.ok(prompt.includes("handoffs/sjahrir/CANONICAL-ROLE-MAP.json"), "T11: prompt includes role map relative path");
  assert.ok(prompt.includes("NO INCONSISTENCIES FOUND"), "T11: prompt preserves exact no-inconsistencies phrase");
  assert.ok(prompt.includes("at most 10 inconsistencies"), "T11: prompt caps drift report length");
  assert.ok(prompt.includes("hermes_generic"), "T11: prompt names the inert Paperclip adapter");
  assert.ok(prompt.includes("Paperclip agent record"), "T11: prompt distinguishes Paperclip records");
  assert.ok(prompt.includes("ops-watcher"), "T11: prompt distinguishes ops-watcher runtime lanes");
  assert.ok(prompt.includes("If unsure which kind of object a statement is about, do NOT report it"), "T11: prompt suppresses uncertain object-kind conflicts");
  assert.ok(prompt.split(/\s+/).length < 900, "T11: prompt stays under 900 words");
  assert.ok(!prompt.includes("{\"agents\""), "T11: prompt does not embed registry JSON body");
  ok("T11: registry-drift prompt instructs Hermes to read relative paths and caps output length");
}

function t13_classifyDriftOutputRejectsOnlyUnusableOutput() {
  assert.deepEqual(classifyDriftOutput("Response truncated due to output length limit"), { usable: false, reason: "output terpotong" }, "T13: truncation meta output is unusable");
  assert.deepEqual(classifyDriftOutput(""), { usable: false, reason: "output kosong" }, "T13: empty output is unusable");
  assert.deepEqual(classifyDriftOutput("ok"), { usable: false, reason: "output tidak dikenali" }, "T13: short unrecognized blob is unusable");
  const longProse = "This prose answer describes a concrete inconsistency without bullet markers and is intentionally longer than forty chars.";
  assert.ok(longProse.length >= 40, "T13: long prose fixture is at least 40 chars");
  assert.deepEqual(classifyDriftOutput(longProse), { usable: true }, "T13: long bullet-free prose remains usable drift content");
  ok("T13: classifyDriftOutput distinguishes Hermes meta/blank blobs from usable drift text");
}

async function t12_oneCheckThrowDoesNotBlockOther() {
  const text = "- Registry drift still reported.";
  const calls = { hermes: 0 };
  const { deps } = makeDeps({
    readAllowedScripts: () => { throw new Error("allowlist broke synchronously"); },
    dispatchHermes: async () => {
      calls.hermes += 1;
      return { ok: true, stdout: text, stderr: "" };
    },
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(calls.hermes, 1, "T12: registry check still ran");
  assert.ok(r.results.find((f) => f.key === "orphaned-allowlist-check-failed"), "T12: throwing check recorded");
  assert.ok(r.results.find((f) => f.key === "registry-drift"), "T12: other check reported");
  ok("T12: one check throwing synchronously does not prevent the other check from running and reporting");
}

// ---- kimi (SJAHRIR) lane: extractDriftAnswer + end-to-end coverage ----

function t14_extractDriftAnswerStripsResumeTrailer() {
  const out = extractDriftAnswer(
    "some deliberation prose\nTo resume this session: kimi -r session_abc\nleftover junk after trailer",
  );
  assert.ok(!out.includes("To resume this session"), "T14: resume trailer removed");
  assert.ok(!out.includes("session_abc"), "T14: session id removed");
  assert.ok(!out.includes("leftover junk"), "T14: text after trailer removed");
  ok("T14: extractDriftAnswer drops the `To resume this session: kimi -r ...` trailer and anything after it");
}

function t15_extractDriftAnswerLiveShapedBlobReturnsNormalizedBullets() {
  const blob = [
    "Let me analyze the two documents.",
    "I compared the registry and the role map for conflicts.",
    "",
    "• - OPS-WATCHER: CANONICAL says active, registry says resting.",
    "  - AUDIT-CLERK: CANONICAL says built, registry says dormant.",
    "",
    "To resume this session: kimi -r session_abc",
  ].join("\n");
  const out = extractDriftAnswer(blob);
  assert.equal(
    out,
    "- OPS-WATCHER: CANONICAL says active, registry says resting.\n- AUDIT-CLERK: CANONICAL says built, registry says dormant.",
    "T15: exactly the two normalized bullets returned",
  );
  assert.ok(!out.includes("To resume this session"), "T15: no resume trailer");
  assert.ok(!out.includes("Let me analyze"), "T15: prose dropped");
  ok("T15: extractDriftAnswer on a live-shaped kimi blob returns exactly the two normalized bullets");
}

function t16_extractDriftAnswerNoInconsistenciesBuriedAfterProse() {
  const blob = [
    "Some deliberation prose here describing the comparison.",
    "More prose explaining what was checked.",
    "NO INCONSISTENCIES FOUND.",
    "To resume this session: kimi -r session_xyz",
  ].join("\n");
  const out = extractDriftAnswer(blob);
  assert.equal(out, "NO INCONSISTENCIES FOUND", "T16: exact no-inconsistencies phrase returned");
  ok("T16: extractDriftAnswer returns NO INCONSISTENCIES FOUND when the phrase (trailing period, after prose) appears");
}

async function t17_runAuditClerkOnceKimiBlobBecomesOneDriftWarning() {
  const blob = [
    "Let me analyze the two documents.",
    "I compared the registry and the role map for conflicts.",
    "",
    "• - OPS-WATCHER: CANONICAL says active, registry says resting.",
    "  - AUDIT-CLERK: CANONICAL says built, registry says dormant.",
    "",
    "To resume this session: kimi -r session_abc",
  ].join("\n");
  const { deps } = makeDeps({
    dispatchDrift: async () => ({ ok: true, stdout: blob, stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  const drifts = r.results.filter((f) => f.key === "registry-drift");
  assert.equal(drifts.length, 1, "T17: exactly one registry-drift WARNING");
  assert.equal(drifts[0].severity, "WARNING", "T17: severity WARNING");
  assert.ok(drifts[0].detail.includes("OPS-WATCHER"), "T17: detail contains OPS-WATCHER");
  assert.ok(!drifts[0].detail.includes("To resume this session"), "T17: detail has no resume trailer");
  assert.equal(r.results.find((f) => f.key === "registry-drift-check-failed"), undefined, "T17: no check-failed finding on usable kimi blob");
  ok("T17: end-to-end injected dispatchDrift live-shaped blob -> exactly one registry-drift WARNING, no trailer");
}

async function t18_runAuditClerkOnceKimiTruncationStillCheckFailed() {
  const { deps } = makeDeps({
    dispatchDrift: async () => ({ ok: true, stdout: "Response truncated due to output length limit", stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  const failed = r.results.find((f) => f.key === "registry-drift-check-failed");
  assert.ok(failed, "T18: check-failed finding exists");
  assert.equal(r.results.find((f) => f.key === "registry-drift"), undefined, "T18: no fake registry-drift finding on truncation");
  ok("T18: injected dispatchDrift truncation meta output -> registry-drift-check-failed (no regression)");
}

async function t19_backwardCompatDispatchHermesDrivesCheck() {
  const calls = { hermes: 0 };
  const text = "- GIBRAN: registry says resting, role map says active.";
  const { deps } = makeDeps({
    dispatchHermes: async () => {
      calls.hermes += 1;
      return { ok: true, stdout: text, stderr: "" };
    },
  });
  // Deliberately NOT passing dispatchDrift: the legacy dispatchHermes dep must
  // drive the check so no existing test/caller silently starts spawning a real
  // kimi process.
  assert.equal(deps.dispatchDrift, undefined, "T19: fixture has no dispatchDrift");
  const r = await runAuditClerkOnce(deps);
  assert.equal(calls.hermes, 1, "T19: legacy dispatchHermes was actually invoked");
  const drifts = r.results.filter((f) => f.key === "registry-drift");
  assert.equal(drifts.length, 1, "T19: exactly one registry-drift finding via legacy dispatcher");
  assert.ok(drifts[0].detail.includes("GIBRAN"), "T19: detail contains legacy dispatcher output");
  ok("T19: backward compatibility - old dispatchHermes dep still drives the drift check");
}

function t20_isQuotaExhaustedFailureRecognizesUsageLimit() {
  assert.equal(
    isQuotaExhaustedFailure({ ok: false, stdout: "", stderr: REAL_KIMI_QUOTA_TEXT }),
    true,
    "T20: real kimi 403 usage-limit stderr is quota exhaustion",
  );
  ok("T20: isQuotaExhaustedFailure recognizes provider.auth_error weekly usage limit");
}

function t21_isQuotaExhaustedFailureIgnoresUnrelatedExit1() {
  assert.equal(
    isQuotaExhaustedFailure({ ok: false, error: "exit_1", stdout: "", stderr: "some other crash" }),
    false,
    "T21: unrelated exit_1 stderr is not quota exhaustion",
  );
  ok("T21: isQuotaExhaustedFailure ignores unrelated exit_1 failures");
}

async function t22_registryQuotaFailureBecomesDistinctFinding() {
  const { deps } = makeDeps({
    dispatchDrift: async () => ({ ok: false, error: "exit_1", stderr: REAL_KIMI_QUOTA_TEXT }),
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.length, 1, "T22: exactly one finding returned");
  assert.equal(r.results[0].key, "registry-drift-quota", "T22: quota key is distinct");
  assert.equal(r.results[0].check, "registry-drift", "T22: check is registry-drift");
  assert.equal(r.results[0].severity, "WARNING", "T22: severity WARNING");
  assert.ok(r.results[0].detail.includes("kuota lane eksekutor habis"), "T22: detail names exhausted lane quota");
  assert.equal(r.results.find((f) => f.key === "registry-drift-check-failed"), undefined, "T22: no ordinary check-failed finding");
  ok("T22: injected quota dispatchDrift failure -> registry-drift-quota WARNING");
}

async function t23_registryUnrelatedFailureStaysOrdinaryCheckFailed() {
  const { deps } = makeDeps({
    dispatchDrift: async () => ({ ok: false, error: "exit_1", stderr: "some other crash" }),
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(r.results.length, 1, "T23: exactly one finding returned");
  assert.equal(r.results[0].key, "registry-drift-check-failed", "T23: ordinary failure key preserved");
  assert.equal(r.results.find((f) => f.key === "registry-drift-quota"), undefined, "T23: no quota finding for unrelated crash");
  assert.ok(r.results[0].detail.includes("exit_1"), "T23: ordinary failure reason still surfaced");
  ok("T23: injected unrelated dispatchDrift failure -> ordinary registry-drift-check-failed");
}

async function t24_dispatchHermesStillWinsBeforeRealDefault() {
  const calls = { hermes: 0 };
  const { deps } = makeDeps({
    dispatchHermes: async () => {
      calls.hermes += 1;
      return { ok: true, stdout: "NO INCONSISTENCIES FOUND", stderr: "" };
    },
  });
  assert.equal(deps.dispatchDrift, undefined, "T24: fixture has no dispatchDrift");
  const r = await runAuditClerkOnce(deps);
  assert.equal(calls.hermes, 1, "T24: injected dispatchHermes was used");
  assert.equal(r.results.find((f) => f.check === "registry-drift"), undefined, "T24: no drift finding from injected no-op hermes");
  ok("T24: no dispatchDrift dep -> injected dispatchHermes wins before real CORLEONE default");
}

// ---- drift-check throttling + lane guard ----

function t25_shouldRunDriftCheckTruthTable() {
  // No state at all -> should run.
  assert.equal(shouldRunDriftCheck(null, NOW), true, "T25: null state -> run");
  assert.equal(shouldRunDriftCheck(undefined, NOW), true, "T25: undefined state -> run");
  // Empty object (no driftCheck) -> should run.
  assert.equal(shouldRunDriftCheck({}, NOW), true, "T25: empty object -> run");
  assert.equal(shouldRunDriftCheck({ alerts: {} }, NOW), true, "T25: alerts-only state -> run");
  // driftCheck present but no lastAttemptMs -> run.
  assert.equal(shouldRunDriftCheck({ driftCheck: {} }, NOW), true, "T25: driftCheck without lastAttemptMs -> run");
  // 1ms under the interval -> do NOT run.
  const under = NOW - (DRIFT_MIN_INTERVAL_MS - 1);
  assert.equal(
    shouldRunDriftCheck({ driftCheck: { lastAttemptMs: under } }, NOW),
    false,
    "T25: 1ms under interval -> skip",
  );
  // Exactly at the interval -> run (>= comparison).
  const exact = NOW - DRIFT_MIN_INTERVAL_MS;
  assert.equal(
    shouldRunDriftCheck({ driftCheck: { lastAttemptMs: exact } }, NOW),
    true,
    "T25: exactly at interval -> run",
  );
  // Well past -> run.
  const past = NOW - (DRIFT_MIN_INTERVAL_MS + 1000);
  assert.equal(
    shouldRunDriftCheck({ driftCheck: { lastAttemptMs: past } }, NOW),
    true,
    "T25: well past interval -> run",
  );
  // Malformed lastAttemptMs values -> run (treated as never recorded).
  assert.equal(shouldRunDriftCheck({ driftCheck: { lastAttemptMs: "oops" } }, NOW), true, "T25: string lastAttemptMs -> run");
  assert.equal(shouldRunDriftCheck({ driftCheck: { lastAttemptMs: NaN } }, NOW), true, "T25: NaN lastAttemptMs -> run");
  assert.equal(shouldRunDriftCheck({ driftCheck: { lastAttemptMs: null } }, NOW), true, "T25: null lastAttemptMs -> run");
  assert.equal(shouldRunDriftCheck({ driftCheck: { lastAttemptMs: undefined } }, NOW), true, "T25: undefined lastAttemptMs -> run");
  // Custom minInterval override is respected.
  assert.equal(
    shouldRunDriftCheck({ driftCheck: { lastAttemptMs: NOW - 5 * 1000 } }, NOW, 10 * 1000),
    false,
    "T25: custom interval override under -> skip",
  );
  assert.equal(
    shouldRunDriftCheck({ driftCheck: { lastAttemptMs: NOW - 10 * 1000 } }, NOW, 10 * 1000),
    true,
    "T25: custom interval override at -> run",
  );
  ok("T25: shouldRunDriftCheck truth table (no state, empty, under, exact, past, malformed, custom interval)");
}

async function t26_driftCheckWithinIntervalSkipsDispatcherAndKeepsAllowlist() {
  const missing = "ops-watcher/ghost.mjs";
  const dispatchCalls = { drift: 0 };
  const logLines = [];
  const { deps } = makeDeps({
    initialState: { alerts: {}, driftCheck: { lastAttemptMs: NOW - HOUR } }, // 1h < 6h
    readAllowedScripts: async () => [missing],
    statFile: async () => { throw new Error("ENOENT"); },
    dispatchDrift: async () => {
      dispatchCalls.drift += 1;
      return { ok: true, stdout: "- should not appear", stderr: "" };
    },
    log: (m) => { logLines.push(m); },
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(dispatchCalls.drift, 0, "T26: drift dispatcher never called within interval");
  assert.equal(r.results.find((f) => /^registry-drift/.test(f.key)), undefined, "T26: no registry-drift* finding produced");
  // Orphaned-allowlist check still ran normally.
  const orphan = r.results.find((f) => f.key === `orphaned-allowlist:${missing}`);
  assert.ok(orphan, "T26: orphaned-allowlist check still ran");
  assert.ok(logLines.some((l) => /registry-drift check skipped \(next run after/.test(l)), "T26: skip log line emitted");
  ok("T26: driftCheck 1h old -> dispatcher never called, no registry-drift* finding, orphaned-allowlist still runs");
}

async function t27_driftCheckPastIntervalDispatchesAndRecordsLastAttemptPreservingAlerts() {
  const text = "- CORLEONE drift present.";
  const prevAlerts = {
    "registry-drift": { lastAlertedAt: NOW - HOUR, finding: text },
  };
  const initialLastAttempt = NOW - 7 * HOUR; // 7h >= 6h -> should run
  const { deps, stateStore } = makeDeps({
    initialState: { alerts: prevAlerts, driftCheck: { lastAttemptMs: initialLastAttempt } },
    dispatchHermes: async () => ({ ok: true, stdout: text, stderr: "" }),
  });
  const r = await runAuditClerkOnce(deps);
  // Dispatcher was called -> the same-finding-within-cooldown alert is returned
  // but suppressed from alerting; alerts preserved untouched in written state.
  const drifts = r.results.filter((f) => f.key === "registry-drift");
  assert.equal(drifts.length, 1, "T27: dispatcher ran and produced the registry-drift finding");
  const stored = stateStore.getStored();
  assert.ok(stored.driftCheck && typeof stored.driftCheck.lastAttemptMs === "number", "T27: driftCheck.lastAttemptMs recorded");
  assert.equal(stored.driftCheck.lastAttemptMs, NOW, "T27: lastAttemptMs updated to now");
  assert.deepEqual(
    stored.alerts["registry-drift"],
    prevAlerts["registry-drift"],
    "T27: alerts entry preserved untouched (same finding within cooldown)",
  );
  ok("T27: driftCheck 7h old -> dispatcher called, new lastAttemptMs recorded, alerts preserved untouched");
}

async function t28_guardLaneQuotaSkipDoesNotDispatchAndPreservesLastAttempt() {
  const dispatchCalls = { drift: 0 };
  const logLines = [];
  const initialLastAttempt = NOW - 7 * HOUR; // interval allows a run
  const { deps, stateStore } = makeDeps({
    initialState: { alerts: {}, driftCheck: { lastAttemptMs: initialLastAttempt } },
    guardLane: async () => ({ skip: true, reason: "quota", remainingMs: 3600000 }),
    dispatchDrift: async () => {
      dispatchCalls.drift += 1;
      return { ok: true, stdout: "- should not appear", stderr: "" };
    },
    log: (m) => { logLines.push(m); },
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(dispatchCalls.drift, 0, "T28: dispatcher not called when guard says quota skip");
  const quotaFindings = r.results.filter((f) => f.key === "registry-drift-quota");
  assert.equal(quotaFindings.length, 1, "T28: exactly one registry-drift-quota finding");
  assert.equal(quotaFindings[0].check, "registry-drift", "T28: quota finding is a registry-drift check");
  assert.equal(r.results.find((f) => f.key === "registry-drift-check-failed"), undefined, "T28: no ordinary check-failed finding");
  assert.equal(r.results.find((f) => f.key === "registry-drift"), undefined, "T28: no real drift finding");
  const stored = stateStore.getStored();
  assert.equal(stored.driftCheck && stored.driftCheck.lastAttemptMs, initialLastAttempt, "T28: lastAttemptMs unchanged (lane never called)");
  assert.ok(logLines.some((l) => /registry-drift check skipped \(lane quota\)/.test(l)), "T28: lane-skip log line emitted");
  ok("T28: guardLane quota skip -> dispatcher not called, exactly one registry-drift-quota finding, lastAttemptMs unchanged");
}

async function t29_guardLaneCooldownSkipProducesNoFinding() {
  const dispatchCalls = { drift: 0 };
  const logLines = [];
  const initialLastAttempt = NOW - 7 * HOUR; // interval allows a run
  const { deps, stateStore } = makeDeps({
    initialState: { alerts: {}, driftCheck: { lastAttemptMs: initialLastAttempt } },
    guardLane: async () => ({ skip: true, reason: "cooldown", remainingMs: 60000 }),
    dispatchDrift: async () => {
      dispatchCalls.drift += 1;
      return { ok: true, stdout: "- should not appear", stderr: "" };
    },
    log: (m) => { logLines.push(m); },
  });
  const r = await runAuditClerkOnce(deps);
  assert.equal(dispatchCalls.drift, 0, "T29: dispatcher not called when guard says cooldown skip");
  assert.equal(r.results.length, 0, "T29: no finding at all on cooldown skip");
  assert.equal(r.results.find((f) => /^registry-drift/.test(f.key)), undefined, "T29: no registry-drift* finding");
  const stored = stateStore.getStored();
  assert.equal(stored.driftCheck && stored.driftCheck.lastAttemptMs, initialLastAttempt, "T29: lastAttemptMs unchanged (lane never called)");
  assert.ok(logLines.some((l) => /registry-drift check skipped \(lane cooldown\)/.test(l)), "T29: lane-skip log line emitted");
  ok("T29: guardLane cooldown skip -> dispatcher not called and NO finding at all");
}

async function main() {
  const tests = [
    t1_orphanedAllowlistExistingNoFinding,
    t2_orphanedAllowlistMissingWarns,
    t3_registryNoInconsistenciesNoFinding,
    t3b_registryNoInconsistenciesTrailingPeriodNoFinding,
    t4_registryInconsistencyTextBecomesOneFinding,
    t4b_registryTruncatedHermesOutputBecomesCheckFailed,
    t4c_registryBulletOutputStillBecomesDriftFinding,
    t4d_registryBlankHermesOutputBecomesCheckFailed,
    t5_registryHermesThrowFallsBack,
    t6_registryHermesOkFalseFallsBack,
    t7_cooldownSuppressesReturnedFindingOnlyFromAlert,
    t8_newAndExpiredFindingsAreAlerted,
    t9_zeroAlertableFindingsNoPostAlert,
    t10_multipleFindingsOneBundledAlert,
    t11_registryDriftPromptUsesPathsNotFileBodies,
    t12_oneCheckThrowDoesNotBlockOther,
    t13_classifyDriftOutputRejectsOnlyUnusableOutput,
    t14_extractDriftAnswerStripsResumeTrailer,
    t15_extractDriftAnswerLiveShapedBlobReturnsNormalizedBullets,
    t16_extractDriftAnswerNoInconsistenciesBuriedAfterProse,
    t17_runAuditClerkOnceKimiBlobBecomesOneDriftWarning,
    t18_runAuditClerkOnceKimiTruncationStillCheckFailed,
    t19_backwardCompatDispatchHermesDrivesCheck,
    t20_isQuotaExhaustedFailureRecognizesUsageLimit,
    t21_isQuotaExhaustedFailureIgnoresUnrelatedExit1,
    t22_registryQuotaFailureBecomesDistinctFinding,
    t23_registryUnrelatedFailureStaysOrdinaryCheckFailed,
    t24_dispatchHermesStillWinsBeforeRealDefault,
    t25_shouldRunDriftCheckTruthTable,
    t26_driftCheckWithinIntervalSkipsDispatcherAndKeepsAllowlist,
    t27_driftCheckPastIntervalDispatchesAndRecordsLastAttemptPreservingAlerts,
    t28_guardLaneQuotaSkipDoesNotDispatchAndPreservesLastAttempt,
    t29_guardLaneCooldownSkipProducesNoFinding,
  ];
  for (const t of tests) await t();
  console.log(`\naudit-clerk.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();