// ops-watcher/routing.regression.test.mjs
// PHASE 4 routing regression tests. Offline: node:assert/strict with mocked
// network/spawn probes (no real API spend, no real dispatch). Real code paths
// in routing.mjs are exercised; only the cheap probes are faked.
//
//   node ops-watcher/routing.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  probeLaneAvailability,
  recordFailure,
  recordQuotaExhausted,
  clearFailure,
  isInCooldown,
  shouldSkipLane,
  resolveLane,
  resolveSjahrirModel,
  laneStringToProbeKey,
  cooldownMsFor,
  isQuotaFailureText,
  parseRetryAtMs,
  QUOTA_COOLDOWN_MS,
} from "./routing.mjs";

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

async function tmpStateFile(label) {
  const f = path.join(__dirname, `_rt_state_${label}.json`);
  try { await fs.unlink(f); } catch { /* */ }
  return f;
}
async function cleanup(files) { for (const f of files) { try { await fs.unlink(f); } catch { /* */ } } }

// ---- laneStringToProbeKey mapping ----
async function testLaneMapping() {
  const name = "laneStringToProbeKey maps canonical lane strings to probe keys";
  try {
    assert.equal(laneStringToProbeKey("L2 glm-5.2:cloud"), "ollama");
    assert.equal(laneStringToProbeKey("L2 glm-5.1:cloud (not maker model)"), "ollama");
    assert.equal(laneStringToProbeKey("L2 kimi-k2.7-code:cloud"), "ollama");
    assert.equal(laneStringToProbeKey("L4 Nous free"), "nous");
    assert.equal(laneStringToProbeKey("L4 hermes/nous-free"), "nous");
    assert.equal(laneStringToProbeKey("L3 Kimi K3 (256k ctx)"), "kimi");
    assert.equal(laneStringToProbeKey("L3 Kimi K3"), "kimi");
    assert.equal(laneStringToProbeKey("L6 Codex"), "codex");
    assert.equal(laneStringToProbeKey("L6 codex (CORLEONE)"), "codex");
    assert.equal(laneStringToProbeKey("L1 Claude Pro ASUS"), null, "Claude CLI lane has no cheap probe");
    assert.equal(laneStringToProbeKey("human+gated"), null);
    assert.equal(laneStringToProbeKey("none (node script)"), null);
    assert.equal(laneStringToProbeKey(""), null);
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- probeLaneAvailability ----
async function testProbeOllama() {
  const name = "probeLaneAvailability ollama: reachable -> available + models; network error -> unavailable";
  try {
    const good = await probeLaneAvailability("ollama", {
      httpGet: async () => ({ status: 200, body: { models: [{ name: "glm-5.2:cloud" }, { name: "kimi-k3:cloud" }] }, networkError: false }),
    });
    assert.equal(good.available, true);
    assert.equal(good.probe, "http");
    assert.deepEqual(good.models, ["glm-5.2:cloud", "kimi-k3:cloud"]);

    const bad1 = await probeLaneAvailability("ollama", {
      httpGet: async () => ({ status: 0, body: null, networkError: true, networkErrorMessage: "ECONNREFUSED" }),
    });
    assert.equal(bad1.available, false);
    assert.equal(bad1.signal, "unreachable");

    const bad2 = await probeLaneAvailability("ollama", {
      httpGet: async () => ({ status: 200, body: { notmodels: 1 }, networkError: false }),
    });
    assert.equal(bad2.available, false, "no models[] field -> unavailable");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testProbeSpawnLanes() {
  const name = "probeLaneAvailability nous/kimi/codex: binary responsive -> available (weaker signal); missing -> unavailable";
  try {
    const nous = await probeLaneAvailability("nous", { runSpawn: async () => ({ ok: true, code: 0, signal: "binary-responsive", version: "Hermes Agent v0.20.4" }) });
    assert.equal(nous.available, true);
    assert.equal(nous.probe, "spawn");
    assert.equal(nous.version, "Hermes Agent v0.20.4");
    assert.match(nous.reason, /weaker than endpoint-reachable/);

    const nousBad = await probeLaneAvailability("nous", { runSpawn: async () => ({ ok: false, code: null, signal: "spawn-error", error: "ENOENT" }) });
    assert.equal(nousBad.available, false);

    const kimi = await probeLaneAvailability("kimi", { runSpawn: async () => ({ ok: true, code: 0, signal: "binary-responsive", version: "0.39.0" }) });
    assert.equal(kimi.available, true);
    assert.equal(kimi.version, "0.39.0");

    const codex = await probeLaneAvailability("codex", { runSpawn: async () => ({ ok: true, code: 0, signal: "binary-responsive", version: "codex-cli 0.1.0" }) });
    assert.equal(codex.available, true);
    assert.equal(codex.probe, "spawn");
    assert.equal(codex.version, "codex-cli 0.1.0");
    assert.match(codex.reason, /weaker than endpoint-reachable/);

    const codexBad = await probeLaneAvailability("codex", { runSpawn: async () => ({ ok: false, code: null, signal: "spawn-error", error: "ENOENT" }) });
    assert.equal(codexBad.available, false);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testProbeUnprobeable() {
  const name = "probeLaneAvailability: unprobeable lane -> available=false, probe=none (never fabricates)";
  try {
    const r = await probeLaneAvailability("L1 Claude Pro ASUS");
    assert.equal(r.available, false);
    assert.equal(r.probe, "none");
    assert.equal(r.signal, "unprobeable");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- cooldown policy ----
async function testCooldownBackoff() {
  const name = "cooldown: exponential backoff 60s/120s/240s... capped at 30min; isInCooldown respects window";
  try {
    assert.equal(cooldownMsFor(0), 0);
    assert.equal(cooldownMsFor(1), 60_000);
    assert.equal(cooldownMsFor(2), 120_000);
    assert.equal(cooldownMsFor(3), 240_000);
    assert.equal(cooldownMsFor(5), 960_000);
    assert.equal(cooldownMsFor(100), 1_800_000, "capped at 30 min");

    const sf = await tmpStateFile("cd");
    const t0 = 1_000_000;
    const rec = await recordFailure("nous", "429 too many requests", { now: t0, stateFile: sf });
    assert.equal(rec.failureCount, 1);
    assert.equal(rec.cooldownMs, 60_000);

    const cd1 = await isInCooldown("nous", { now: t0 + 30_000, stateFile: sf });
    assert.equal(cd1.inCooldown, true);
    assert.equal(cd1.remainingMs, 30_000);

    const cd2 = await isInCooldown("nous", { now: t0 + 61_000, stateFile: sf });
    assert.equal(cd2.inCooldown, false, "past window -> not in cooldown");

    // second failure -> 120s window
    await recordFailure("nous", "timeout", { now: t0 + 70_000, stateFile: sf });
    const cd3 = await isInCooldown("nous", { now: t0 + 70_000 + 90_000, stateFile: sf });
    assert.equal(cd3.inCooldown, true, "still in 120s window at +90s");
    assert.equal(cd3.failureCount, 2);

    // clearFailure resets
    await clearFailure("nous", { stateFile: sf });
    const cd4 = await isInCooldown("nous", { now: t0 + 70_000 + 90_000, stateFile: sf });
    assert.equal(cd4.inCooldown, false, "clearFailure removes cooldown");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testCooldownNeverTrustsProviderClock() {
  const name = "recordFailure logs provider reason but cooldown is computed from OUR timestamp, not parsed from message";
  try {
    const sf = await tmpStateFile("clk");
    const t0 = 5_000_000;
    // a provider message that LIES about a reset time — we must NOT parse it
    const reason = "Rate limit exceeded. Resets at 2099-01-01T00:00:00Z (do not trust).";
    await recordFailure("kimi", reason, { now: t0, stateFile: sf });
    const cd = await isInCooldown("kimi", { now: t0 + 61_000, stateFile: sf });
    assert.equal(cd.inCooldown, false, "cooldown is OUR 60s window, not the provider's claimed 2099 reset");
    assert.equal(cd.lastFailureReason, reason, "reason preserved for logging");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- resolveLane ----
function mockRoleMap(defaultLane, fallbackLane) {
  return { roles: [{ role_id: "TESTROLE", default_lane: defaultLane, fallback_lane: fallbackLane }] };
}
function probeDeps(ollamaOk, nousOk, kimiOk, codexOk) {
  return {
    httpGet: async () => ollamaOk ? { status: 200, body: { models: [{ name: "glm-5.2:cloud" }] }, networkError: false } : { status: 0, body: null, networkError: true, networkErrorMessage: "ECONNREFUSED" },
    runSpawn: async (cmd) => {
      if (cmd[0] === "hermes") return nousOk ? { ok: true, code: 0, signal: "binary-responsive", version: "h" } : { ok: false, code: null, signal: "spawn-error", error: "ENOENT" };
      if (cmd[0] === "kimi") return kimiOk ? { ok: true, code: 0, signal: "binary-responsive", version: "k" } : { ok: false, code: null, signal: "spawn-error", error: "ENOENT" };
      if (cmd[0] === "codex") return codexOk ? { ok: true, code: 0, signal: "binary-responsive", version: "c" } : { ok: false, code: null, signal: "spawn-error", error: "ENOENT" };
      return { ok: false, code: 1, signal: "exit_1", error: null };
    },
  };
}

async function resolveLaneDefaultOk() {
  const name = "resolveLane: default lane available -> default-ok";
  try {
    const sf = await tmpStateFile("rd");
    const r = await resolveLane("TESTROLE", { roleMap: mockRoleMap("L2 glm-5.2:cloud", "L4 Nous free"), stateFile: sf, ...probeDeps(true, true, true) });
    assert.equal(r.reason, "default-ok");
    assert.equal(r.chosen, "L2 glm-5.2:cloud");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function resolveLaneCooldownUseFallback() {
  const name = "resolveLane: default in cooldown, fallback available -> default-cooldown-use-fallback";
  try {
    const sf = await tmpStateFile("rcf");
    const t0 = 2_000_000;
    // put ollama (default) in cooldown
    await recordFailure("ollama", "429", { now: t0, stateFile: sf });
    const r = await resolveLane("TESTROLE", { roleMap: mockRoleMap("L2 glm-5.2:cloud", "L4 Nous free"), now: t0 + 10_000, stateFile: sf, ...probeDeps(true, true, true) });
    assert.equal(r.reason, "default-cooldown-use-fallback");
    assert.equal(r.chosen, "L4 Nous free");
    assert.equal(r.defaultResult.available, false, "default marked unavailable due to cooldown");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function resolveLaneBothUnavailableDefer() {
  const name = "resolveLane: both lanes unavailable -> both-unavailable-defer, chosen=null (never invents a third lane)";
  try {
    const sf = await tmpStateFile("rdefer");
    const r = await resolveLane("TESTROLE", { roleMap: mockRoleMap("L2 glm-5.2:cloud", "L4 Nous free"), stateFile: sf, ...probeDeps(false, false, false) });
    assert.equal(r.reason, "both-unavailable-defer");
    assert.equal(r.chosen, null, "must defer, never invent a third lane");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function resolveLaneUnknownRole() {
  const name = "resolveLane: unknown role -> unknown-role, chosen=null";
  try {
    const sf = await tmpStateFile("runk");
    const r = await resolveLane("NOPE", { roleMap: mockRoleMap("L2 x", "L4 y"), stateFile: sf, ...probeDeps(true, true, true) });
    assert.equal(r.reason, "unknown-role");
    assert.equal(r.chosen, null);
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function resolveLaneHumanGatedDefer() {
  const name = "resolveLane: human+gated / none lanes -> non-probeable -> defer";
  try {
    const sf = await tmpStateFile("rhuman");
    const r = await resolveLane("TESTROLE", { roleMap: mockRoleMap("human+gated", "(none)"), stateFile: sf, ...probeDeps(true, true, true) });
    assert.equal(r.chosen, null);
    assert.equal(r.reason, "both-unavailable-defer");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- resolveSjahrirModel ----
async function sjahrirModelSelection() {
  const name = "resolveSjahrirModel: kimi available -> correct model per taskKind (K3-256K / K2.7 Code / full K3)";
  try {
    const sf = await tmpStateFile("sj");
    const deps = { stateFile: sf, ...probeDeps(false, false, true) }; // kimi ok
    const synth = await resolveSjahrirModel("synthesis", deps);
    assert.equal(synth.available, true);
    assert.equal(synth.model, "K3-256K");
    const research = await resolveSjahrirModel("research", deps);
    assert.equal(research.model, "K3-256K");
    const def = await resolveSjahrirModel(undefined, deps);
    assert.equal(def.model, "K3-256K", "unspecified/default -> K3-256K");
    const coding = await resolveSjahrirModel("bounded_coding", deps);
    assert.equal(coding.model, "K2.7 Code");
    const esc = await resolveSjahrirModel("escalation", deps);
    assert.equal(esc.model, "full K3");
    const unknown = await resolveSjahrirModel("weird", deps);
    assert.equal(unknown.model, "K3-256K", "unknown kind -> default K3-256K");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function sjahrirDeferWhenLaneDown() {
  const name = "resolveSjahrirModel: kimi lane down -> defer (model=null), never pretends a model choice was made";
  try {
    const sf = await tmpStateFile("sjdown");
    const deps = { stateFile: sf, ...probeDeps(false, false, false) }; // kimi not ok
    const r = await resolveSjahrirModel("synthesis", deps);
    assert.equal(r.available, false);
    assert.equal(r.defer, true);
    assert.equal(r.model, null, "no model chosen when lane down");
    assert.match(r.reason, /defer/);
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function sjahrirDeferWhenInCooldown() {
  const name = "resolveSjahrirModel: kimi in cooldown -> defer even though binary responsive";
  try {
    const sf = await tmpStateFile("sjcd");
    const t0 = 3_000_000;
    await recordFailure("kimi", "429", { now: t0, stateFile: sf });
    const deps = { stateFile: sf, now: t0 + 5_000, ...probeDeps(false, false, true) }; // probe ok but cooldown active
    const r = await resolveSjahrirModel("bounded_coding", deps);
    assert.equal(r.available, false);
    assert.equal(r.defer, true);
    assert.equal(r.model, null);
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- uses the REAL canonical role map for at least one role ----
async function resolveLaneRealRoleMap() {
  const name = "resolveLane reads the REAL CANONICAL-ROLE-MAP.json (SJAHRIR role resolves without throwing)";
  try {
    const sf = await tmpStateFile("rreal");
    // default probe available -> SJAHRIR default K2.7 implementation lane should resolve to default-ok
    const r = await resolveLane("SJAHRIR", { stateFile: sf, ...probeDeps(true, false, true) });
    assert.equal(r.reason, "default-ok");
    assert.equal(r.chosen, "L2 kimi-k2.7-code:cloud");
    assert.equal(r.defaultLane, "L2 kimi-k2.7-code:cloud");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// FOS-22 regression: the "staff[0] hardcoding" bug class.
//
// Historical bug (handoffs/historical/FOUNDEROS-HISTORICAL-BACKLOG-HANDOFF.md
// ~line 375): "Reasoning selected the correct worker but execution hardcoded
// staff[0], dispatching Soedirman even when Gibran was chosen" — a capability-
// aware selection layer computed the RIGHT worker, but a separate execution
// path ignored that result and always used the first element of a staff/worker
// array. This pair of tests proves the CLASS of bug is gone in routing.mjs (the
// real capability-aware lane/worker routing layer), not merely the literal
// string "staff[0]":
//
//   (1) findRole must select a role by role_id match (Array.prototype.find with
//       an equality predicate), NOT by array position. We build a multi-role
//       roleMap where the TARGET role sits at a NON-ZERO index, with lanes that
//       DIFFER from the index-0 ("DECOY") role. A roles[0]-style hardcoding
//       would resolve the target to the DECOY's lane; the test asserts it
//       resolves to the TARGET's own lane. (Every pre-existing resolveLane test
//       used a single-role mock, so the target was always at index 0 and could
//       not catch a [0] hardcoding — this is the gap this test closes.)
//
//   (2) resolveLane must return the capability-probed choice, never the "first"
//       lane by position. With the default (first) lane's probe DOWN and the
//       fallback (second) lane UP, chosen must be the fallback — explicitly NOT
//       defaultLane. This is the lane-level analogue of "not staff[0]": the
//       selection result is honored even though it is not the first candidate.
// =====================================================================
async function fos22_findRoleSelectsByRoleIdNotArrayIndex() {
  const name = "FOS-22: findRole selects by role_id match, not roles[0] (non-first role resolves to its OWN lane)";
  try {
    const sf = await tmpStateFile("fos22a");
    // Multi-role map. The TARGET role is deliberately NOT at index 0; the
    // index-0 "DECOY" role has a DIFFERENT default lane. A [0]-style hardcoding
    // in findRole would return DECOY's lanes for every role.
    const roleMap = {
      roles: [
        { role_id: "DECOY", default_lane: "L4 Nous free", fallback_lane: "L3 Kimi K3" },
        { role_id: "FILLER1", default_lane: "L4 Nous free", fallback_lane: "L3 Kimi K3" },
        { role_id: "FILLER2", default_lane: "L4 Nous free", fallback_lane: "L3 Kimi K3" },
        // TARGET at index 3: default on the ollama (L2) lane, distinct from DECOY.
        { role_id: "TARGET", default_lane: "L2 glm-5.2:cloud", fallback_lane: "L4 Nous free" },
        { role_id: "FILLER3", default_lane: "L4 Nous free", fallback_lane: "L3 Kimi K3" },
      ],
    };
    // ollama (L2) reachable -> TARGET's default lane available.
    const r = await resolveLane("TARGET", { roleMap, stateFile: sf, ...probeDeps(true, true, true) });
    assert.equal(r.reason, "default-ok", "TARGET must be found and resolved");
    assert.equal(r.chosen, "L2 glm-5.2:cloud", "chosen is TARGET's own default lane, NOT DECOY's L4 lane");
    assert.notEqual(r.chosen, "L4 Nous free", "regression guard: must not resolve to the index-0 (DECOY) default lane");
    assert.equal(r.defaultLane, "L2 glm-5.2:cloud");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function fos22_resolveLaneHonorsProbedChoiceNotFirstLane() {
  const name = "FOS-22: resolveLane honors the probed choice, not the first lane (default down -> fallback chosen, NOT default)";
  try {
    const sf = await tmpStateFile("fos22b");
    // TARGET's default lane (L2 ollama) probe is DOWN; its fallback (L4 nous)
    // probe is UP. The capability-aware selection result is the fallback — the
    // NON-first candidate. A "pick the first lane / staff[0]" execution path
    // would instead return the default lane (or dispatch against it). We assert
    // the probed, non-first choice is returned and the default is explicitly
    // NOT chosen.
    const roleMap = {
      roles: [
        { role_id: "DECOY", default_lane: "L4 Nous free", fallback_lane: "L3 Kimi K3" },
        { role_id: "TARGET", default_lane: "L2 glm-5.2:cloud", fallback_lane: "L4 Nous free" },
      ],
    };
    // ollama DOWN, nous UP, kimi UP.
    const r = await resolveLane("TARGET", { roleMap, stateFile: sf, ...probeDeps(false, true, true) });
    assert.equal(r.reason, "default-unavailable-use-fallback");
    assert.equal(r.chosen, "L4 Nous free", "chosen is the fallback (non-first candidate) that probed available");
    assert.notEqual(r.chosen, r.defaultLane, "regression guard: chosen must NOT be the first (default) lane");
    assert.equal(r.defaultResult.available, false, "default lane correctly evaluated as unavailable");
    assert.equal(r.fallbackResult.available, true, "fallback lane correctly evaluated as available");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// Quota exhaustion — a SEPARATE state from transient failure.
//
// Real event: SJAHRIR's lane returned
//   "provider.auth_error: 403 You've reached your weekly (7-day) usage limit."
// The existing recordFailure treated ALL failures as transient and would have
// retried every 60s-30min forever, because a weekly quota does NOT recover inside
// a 30-minute cooldown. This block proves the new quota state is distinct:
//   - isQuotaFailureText recognizes the real weekly-limit string + 429 variants,
//     and rejects empty/null/non-quota errors.
//   - recordQuotaExhausted stores quotaExhausted:true + the long QUOTA_COOLDOWN_MS.
//   - isInCooldown surfaces quotaExhausted and respects the long window.
//   - an ordinary transient entry still reports quotaExhausted:false and the old
//     exponential timing (regression guard — quota state must not leak into the
//     transient path).
//   - clearFailure removes a quota entry (a successful dispatch reopens the quota).
//   - shouldSkipLane surfaces skip:true + reason "quota" vs "cooldown" vs null.
// All tests inject stateFile into a TEMP path; the real routing-state.json is
// never touched.
// =====================================================================

async function quota_isQuotaFailureTextTruthTable() {
  const name = "isQuotaFailureText: provider-shaped quota phrases -> true; prompt/editor quota noise -> false";
  try {
    // The exact real-world string observed today.
    const real = "provider.auth_error: 403 You've reached your weekly (7-day) usage limit.";
    assert.equal(isQuotaFailureText(real), true, "real weekly-limit string must be detected");
    assert.equal(isQuotaFailureText("insufficient_quota"), true);
    assert.equal(isQuotaFailureText("HTTP 429 Too Many Requests"), true);
    assert.equal(isQuotaFailureText("status code 429"), true);
    assert.equal(isQuotaFailureText("rate limit exceeded"), true);
    assert.equal(isQuotaFailureText("quota exhausted"), true);

    // negatives
    assert.equal(
      isQuotaFailureText(
        "Reading additional input from stdin...\nERROR codex_skills_extension::loader::host: skills scan reached its traversal limit\n(root: file:///C:/Users/ASUS/.codex/skills)",
      ),
      false,
      "codex skills-scan traversal-limit noise is NOT quota",
    );
    assert.equal(isQuotaFailureText("const quotaExhausted = true"), false, "bare quota/code symbol is NOT quota");
    assert.equal(isQuotaFailureText("AUTH_ERROR something"), false, "bare auth_error is NOT quota");
    assert.equal(isQuotaFailureText("429"), false, "bare 429 is NOT quota");
    assert.equal(isQuotaFailureText("usage limit reached"), false, "bare usage limit words are NOT quota");
    assert.equal(isQuotaFailureText("ENOENT: no such file"), false, "spawn error is NOT quota");
    assert.equal(isQuotaFailureText(""), false, "empty string -> false");
    assert.equal(isQuotaFailureText(null), false, "null -> false");
    assert.equal(isQuotaFailureText(undefined), false, "undefined -> false");
    assert.equal(isQuotaFailureText("ETIMEDOUT"), false, "timeout is transient, not quota");
    ok(name);
  } catch (err) { bad(name, err); }
}

function localMs(year, monthIndex, day, hour, minute) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).getTime();
}

async function quota_parseRetryAtMsSameDayAmPm() {
  const name = "parseRetryAtMs: try again at 9:57 PM -> today's 21:57 local when still ahead";
  try {
    const now = localMs(2026, 8, 1, 20, 0);
    const expected = localMs(2026, 8, 1, 21, 57);
    assert.equal(parseRetryAtMs("ERROR: You've hit your usage limit. Please upgrade or try again at 9:57 PM.", now), expected);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_parseRetryAtMsNextDayWhenPassed() {
  const name = "parseRetryAtMs: already-passed 9:57 PM rolls to tomorrow's 21:57 local";
  try {
    const now = localMs(2026, 8, 1, 22, 0);
    const expected = localMs(2026, 8, 1, 21, 57) + 24 * 60 * 60 * 1000;
    assert.equal(parseRetryAtMs("ERROR: You've hit your usage limit. Please upgrade or try again at 9:57 PM.", now), expected);
    assert.ok(parseRetryAtMs("try again at 9:57 PM", now) > now, "retry instant must never be in the past");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_parseRetryAtMsTwentyFourHourForm() {
  const name = "parseRetryAtMs: try again at 21:57 parses like 9:57 PM";
  try {
    const now = localMs(2026, 8, 1, 20, 0);
    const expected = localMs(2026, 8, 1, 21, 57);
    assert.equal(parseRetryAtMs("ERROR: You've hit your usage limit. Please upgrade or try again at 21:57.", now), expected);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_parseRetryAtMsNoTime() {
  const name = "parseRetryAtMs: text without retry clock time -> null";
  try {
    const now = localMs(2026, 8, 1, 20, 0);
    assert.equal(parseRetryAtMs("provider.auth_error: 403 You've reached your weekly (7-day) usage limit.", now), null);
    assert.equal(parseRetryAtMs("rate limit exceeded", now), null);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_recordQuotaExhaustedUsesProviderRetryTime() {
  const name = "recordQuotaExhausted with retry time ends near provider instant, not six hours later";
  try {
    const sf = await tmpStateFile("qretry");
    const now = localMs(2026, 8, 1, 20, 0);
    const retryAt = localMs(2026, 8, 1, 21, 57);
    const reason = "ERROR: You've hit your usage limit. Please upgrade or try again at 9:57 PM.";
    const rec = await recordQuotaExhausted("codex", reason, { now, stateFile: sf });
    assert.equal(rec.retryAtMs, retryAt);
    assert.ok(rec.cooldownUntilMs >= retryAt, "cooldown must not end before the provider-stated instant");
    assert.ok(rec.cooldownUntilMs <= retryAt + 2 * 60 * 1000, "cooldown may add only a small grace margin");
    assert.notEqual(rec.cooldownMs, QUOTA_COOLDOWN_MS, "provider retry time should not park the lane for the flat 6h default");

    const skipBefore = await shouldSkipLane("codex", { now: retryAt - 1_000, stateFile: sf });
    assert.equal(skipBefore.skip, true, "still skip before provider retry time");
    assert.equal(skipBefore.reason, "quota");

    const skipAfterGrace = await shouldSkipLane("codex", { now: retryAt + 2 * 60 * 1000 + 1, stateFile: sf });
    assert.equal(skipAfterGrace.skip, false, "no skip once provider retry time plus grace has passed");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_oldShapeStateStillSkipsCorrectly() {
  const name = "shouldSkipLane: old state shape with only cooldownMs still computes remaining time";
  try {
    const sf = await tmpStateFile("qold");
    const t0 = 50_000_000;
    await fs.writeFile(sf, JSON.stringify({
      lanes: {
        codex: {
          lastFailureTs: t0,
          lastFailureReason: "old quota entry",
          failureCount: 1,
          cooldownMs: QUOTA_COOLDOWN_MS,
          quotaExhausted: true,
        },
      },
    }, null, 2), "utf8");

    const skip = await shouldSkipLane("codex", { now: t0 + 1_000, stateFile: sf });
    assert.equal(skip.skip, true);
    assert.equal(skip.reason, "quota");
    assert.equal(skip.quotaExhausted, true);
    assert.equal(skip.remainingMs, QUOTA_COOLDOWN_MS - 1_000);
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_recordQuotaExhaustedStoresLongCooldown() {
  const name = "recordQuotaExhausted stores quotaExhausted:true and cooldownMs === QUOTA_COOLDOWN_MS (temp state file)";
  try {
    const sf = await tmpStateFile("qrec");
    const t0 = 9_000_000;
    const reason = "provider.auth_error: 403 You've reached your weekly (7-day) usage limit.";
    const rec = await recordQuotaExhausted("kimi", reason, { now: t0, stateFile: sf });
    assert.equal(rec.lane, "kimi");
    assert.equal(rec.failureCount, 1, "first quota failure -> count 1");
    assert.equal(rec.cooldownMs, QUOTA_COOLDOWN_MS, "cooldown is the long 6h window, NOT transient backoff");
    assert.equal(rec.lastFailureTs, t0);
    assert.equal(rec.quotaExhausted, true);

    // verify the stored entry shape directly
    const raw = JSON.parse(await fs.readFile(sf, "utf8"));
    const entry = raw.lanes.kimi;
    assert.equal(entry.quotaExhausted, true);
    assert.equal(entry.cooldownMs, QUOTA_COOLDOWN_MS);
    assert.equal(entry.lastFailureReason, reason);
    assert.equal(entry.failureCount, 1);

    // second quota failure increments count, keeps the long cooldown
    const rec2 = await recordQuotaExhausted("kimi", reason, { now: t0 + 10_000, stateFile: sf });
    assert.equal(rec2.failureCount, 2);
    assert.equal(rec2.cooldownMs, QUOTA_COOLDOWN_MS, "quota cooldown does NOT exponential-grow");
    assert.equal(rec2.quotaExhausted, true);
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_isInCooldownRespectsLongWindow() {
  const name = "isInCooldown on a quota entry: inCooldown true right after, quotaExhausted true, inCooldown false past lastFailureTs+QUOTA_COOLDOWN_MS";
  try {
    const sf = await tmpStateFile("qcd");
    const t0 = 12_000_000;
    const reason = "provider.auth_error: 403 You've reached your weekly (7-day) usage limit.";
    await recordQuotaExhausted("kimi", reason, { now: t0, stateFile: sf });

    // right after recording -> in cooldown, quota-flagged, long remaining
    const cd1 = await isInCooldown("kimi", { now: t0 + 1_000, stateFile: sf });
    assert.equal(cd1.inCooldown, true, "right after quota failure -> in cooldown");
    assert.equal(cd1.quotaExhausted, true, "quotaExhausted surfaces through read path");
    assert.equal(cd1.remainingMs, QUOTA_COOLDOWN_MS - 1_000, "remaining is the long 6h window");
    assert.equal(cd1.lastFailureReason, reason);

    // still inside the 6h window (e.g. 3h in)
    const cd2 = await isInCooldown("kimi", { now: t0 + 3 * 60 * 60 * 1000, stateFile: sf });
    assert.equal(cd2.inCooldown, true, "3h into a 6h quota window -> still in cooldown (transient 30min cap would have expired)");

    // one ms past the window -> inCooldown goes false again (the requirement's
    // "false again once now is past lastFailureTs + QUOTA_COOLDOWN_MS").
    // quotaExhausted reflects the STORED entry (spec: "from the stored entry,
    // default false"); the entry is not auto-deleted on window expiry — only
    // clearFailure removes it. shouldSkipLane reports skip:false regardless,
    // because it keys off inCooldown.
    const cd3 = await isInCooldown("kimi", { now: t0 + QUOTA_COOLDOWN_MS + 1, stateFile: sf });
    assert.equal(cd3.inCooldown, false, "past lastFailureTs+QUOTA_COOLDOWN_MS -> inCooldown false (\"false again\")");
    assert.equal(cd3.remainingMs, 0, "remainingMs clamps to 0 once past the window");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_transientEntryUnchangedRegressionGuard() {
  const name = "isInCooldown on an ordinary failure entry: quotaExhausted:false + old exponential timing (regression guard)";
  try {
    const sf = await tmpStateFile("qreg");
    const t0 = 20_000_000;
    // ordinary transient failure, NOT a quota one
    await recordFailure("nous", "ETIMEDOUT", { now: t0, stateFile: sf });
    const cd1 = await isInCooldown("nous", { now: t0 + 10_000, stateFile: sf });
    assert.equal(cd1.inCooldown, true);
    assert.equal(cd1.quotaExhausted, false, "transient entry must NOT be quota-flagged");
    assert.equal(cd1.failureCount, 1);
    assert.equal(cd1.remainingMs, 60_000 - 10_000, "transient 60s exponential window intact (NOT the 6h quota window)");

    // second transient failure -> 120s window (exponential growth still works)
    await recordFailure("nous", "ETIMEDOUT", { now: t0 + 20_000, stateFile: sf });
    const cd2 = await isInCooldown("nous", { now: t0 + 20_000 + 30_000, stateFile: sf });
    assert.equal(cd2.inCooldown, true);
    assert.equal(cd2.quotaExhausted, false);
    assert.equal(cd2.failureCount, 2);
    assert.equal(cd2.remainingMs, 120_000 - 30_000, "transient exponential 120s window intact");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_clearFailureRemovesQuotaEntry() {
  const name = "clearFailure removes a quota entry (successful dispatch reopens the quota window)";
  try {
    const sf = await tmpStateFile("qclear");
    const t0 = 30_000_000;
    await recordQuotaExhausted("kimi", "weekly usage limit", { now: t0, stateFile: sf });
    const cdBefore = await isInCooldown("kimi", { now: t0 + 5_000, stateFile: sf });
    assert.equal(cdBefore.inCooldown, true);
    assert.equal(cdBefore.quotaExhausted, true);

    await clearFailure("kimi", { stateFile: sf });
    const cdAfter = await isInCooldown("kimi", { now: t0 + 5_000, stateFile: sf });
    assert.equal(cdAfter.inCooldown, false, "clearFailure removes the quota cooldown");
    assert.equal(cdAfter.quotaExhausted, false, "no quota flag remains after clear");
    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function quota_shouldSkipLaneReasons() {
  const name = "shouldSkipLane: quota -> {skip:true,reason:'quota'}; transient -> {skip:true,reason:'cooldown'}; clean -> {skip:false,reason:null}";
  try {
    const sf = await tmpStateFile("qskip");
    const t0 = 40_000_000;

    // quota entry
    await recordQuotaExhausted("kimi", "weekly usage limit", { now: t0, stateFile: sf });
    const skipQuota = await shouldSkipLane("kimi", { now: t0 + 1_000, stateFile: sf });
    assert.equal(skipQuota.skip, true);
    assert.equal(skipQuota.reason, "quota", "quota entry -> reason 'quota'");
    assert.equal(skipQuota.quotaExhausted, true);
    assert.ok(skipQuota.remainingMs > 0);

    // transient entry
    await recordFailure("nous", "ETIMEDOUT", { now: t0, stateFile: sf });
    const skipCd = await shouldSkipLane("nous", { now: t0 + 1_000, stateFile: sf });
    assert.equal(skipCd.skip, true);
    assert.equal(skipCd.reason, "cooldown", "transient entry -> reason 'cooldown' (NOT 'quota')");
    assert.equal(skipCd.quotaExhausted, false);
    assert.ok(skipCd.remainingMs > 0);

    // clean lane (no entry at all)
    const skipClean = await shouldSkipLane("codex", { now: t0 + 1_000, stateFile: sf });
    assert.equal(skipClean.skip, false, "clean lane -> skip false");
    assert.equal(skipClean.reason, null, "clean lane -> reason null");
    assert.equal(skipClean.quotaExhausted, false);
    assert.equal(skipClean.remainingMs, 0);

    // a lane whose window has EXPIRED should report skip:false, reason:null
    // (quota window elapsed). skip keys off inCooldown, which is false once past
    // the window even though the stored entry still carries quotaExhausted:true.
    const skipExpiredQuota = await shouldSkipLane("kimi", { now: t0 + QUOTA_COOLDOWN_MS + 1, stateFile: sf });
    assert.equal(skipExpiredQuota.skip, false, "past quota window -> not skipping");
    assert.equal(skipExpiredQuota.reason, null, "past quota window -> reason null");

    await cleanup([sf]);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher PHASE-4 routing regression tests");
  await testLaneMapping();
  await testProbeOllama();
  await testProbeSpawnLanes();
  await testProbeUnprobeable();
  await testCooldownBackoff();
  await testCooldownNeverTrustsProviderClock();
  await resolveLaneDefaultOk();
  await resolveLaneCooldownUseFallback();
  await resolveLaneBothUnavailableDefer();
  await resolveLaneUnknownRole();
  await resolveLaneHumanGatedDefer();
  await sjahrirModelSelection();
  await sjahrirDeferWhenLaneDown();
  await sjahrirDeferWhenInCooldown();
  await resolveLaneRealRoleMap();
  // FOS-22: "staff[0] hardcoding" bug-class regression.
  await fos22_findRoleSelectsByRoleIdNotArrayIndex();
  await fos22_resolveLaneHonorsProbedChoiceNotFirstLane();
  // Quota exhaustion — a SEPARATE state from transient failure.
  await quota_isQuotaFailureTextTruthTable();
  await quota_parseRetryAtMsSameDayAmPm();
  await quota_parseRetryAtMsNextDayWhenPassed();
  await quota_parseRetryAtMsTwentyFourHourForm();
  await quota_parseRetryAtMsNoTime();
  await quota_recordQuotaExhaustedUsesProviderRetryTime();
  await quota_recordQuotaExhaustedStoresLongCooldown();
  await quota_oldShapeStateStillSkipsCorrectly();
  await quota_isInCooldownRespectsLongWindow();
  await quota_transientEntryUnchangedRegressionGuard();
  await quota_clearFailureRemovesQuotaEntry();
  await quota_shouldSkipLaneReasons();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("routing regression runner crashed:", err); process.exit(1); });