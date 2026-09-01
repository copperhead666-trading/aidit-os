// ops-watcher/routing.mjs
// PHASE 4 — quota-aware routing. A small MODULE (not a daemon) that other
// scripts or a human can call to decide which runtime lane to use for a role,
// based on REAL observed availability/cooldown state — never hardcoded
// provider reset-clock assumptions.
//
//   import { probeLaneAvailability, recordFailure, isInCooldown,
//            resolveLane, resolveSjahrirModel } from "./routing.mjs";
//
// === Lanes & probes (documented honestly) ===
// Four real runtime lanes are probed with a CHEAP, REAL check (no full
// dispatch, no real API spend):
//   ollama  (L2 technical, HATTA's lane)
//     GET http://localhost:11434/api/tags — already used elsewhere in this
//     codebase (watcher.mjs). Reuses watcher.mjs's crash-proof httpGet. This is
//     a genuine reachability check: it only succeeds if the Ollama daemon is up
//     AND answers the tags endpoint. (Does not prove a specific model can
//     generate, but proves the lane is alive — the strongest cheap signal.)
//   nous    (L4 free-worker, GIBRAN/HERMES lane)
//     `hermes --version` (spawn). This is a WEAKER signal than "endpoint
//     reachable": it proves the hermes binary is installed and responsive, but
//     NOT that the Nous free inference endpoint is currently serving. There is
//     NO cheap unauthenticated network check for the Nous inference endpoint
//     that does not itself burn a real dispatch (`hermes -z` costs real API
//     usage); the endpoint host/auth is embedded in hermes' config and not
//     documented as a stable unauthenticated probe target. So the honest cheap
//     proxy is "binary present + responsive", clearly labelled as such. A real
//     429/timeout observed at dispatch time is recorded via recordFailure() and
//     drives the cooldown instead.
//   kimi    (L3 heavy-context, SJAHRIR's lane)
//     `kimi --version` (spawn). Same honest weaker signal: binary present +
//     responsive. Kimi Code's inference is behind OAuth (file store); there is
//     no cheap unauthenticated endpoint probe, so we do not fabricate one.
//   codex   (L6 heavy-implementation, CORLEONE's lane)
//     `codex --version` (spawn). Same honest weaker signal: binary present +
//     responsive. The Codex CLI's inference is behind its own auth (interactive
//     login / OAuth, file store); there is no cheap unauthenticated endpoint
//     probe, so we do not fabricate one.
// If a lane has no cheap probe at all (e.g. Claude Pro CLI lanes, human-gated
// lanes), probeLaneAvailability returns an explicit { available:false,
// probe:"none", reason:"no cheap probe implemented" } rather than guessing.
//
// === Cooldown policy (OUR OWN clock, never the provider's) ===
// We NEVER parse/trust a reset time printed in a provider error message — such
// a message is logged informationally only. We compute our own cooldown from the
// timestamp WE observed the failure, using exponential backoff:
//     cooldownMs = min( BASE * 2^(failureCount-1), CAP )
//     BASE = 60_000 ms (1 min)   CAP = 1_800_000 ms (30 min)
// Rationale: 1 min rides out a transient blip; exponential growth bounds
// repeated hammering of a genuinely down lane; the 30 min cap prevents a single
// bad streak from permanently blacklisting a lane (the owner's fixed-subscription
// lanes are scarce and must not be locked out indefinitely by a bad hour).
// failureCount is per-lane and resets to 0 on a successful probe.
//
// === Quota exhaustion (a SEPARATE state, not transient) ===
// Some failures are NOT transient blips: a provider returning "403 You've
// reached your weekly (7-day) usage limit." is an EXHAUSTED-QUOTA condition that
// does NOT recover inside a 30-minute cooldown window. Retrying it every 60s-
// 30min is wasteful and just re-discovers the same wall. So a quota failure is
// recorded with a LONG, separate cooldown (QUOTA_COOLDOWN_MS = 6h) and flagged
// with quotaExhausted:true on the stored entry. This is one extra state on top
// of the existing transient backoff — the existing read path (isInCooldown)
// surfaces it via the quotaExhausted boolean, and a successful dispatch clears
// it the same way it clears a normal entry (the quota window reopened).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { httpGet } from "./watcher.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ROLE_MAP_FILE = path.join(ROOT, "handoffs", "sjahrir", "CANONICAL-ROLE-MAP.json");
const STATE_FILE = path.join(__dirname, "routing-state.json");

const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";
const COOLDOWN_BASE_MS = 60_000;
const COOLDOWN_CAP_MS = 30 * 60_000;

// Quota exhaustion gets its OWN, LONG cooldown. A weekly (7-day) usage limit
// does not recover inside a 30-minute transient window; retrying it on the
// transient backoff schedule just re-discovers the wall. 6h is a deliberately
// conservative retry interval: short enough that we will resume promptly once a
// quota window genuinely reopens, long enough that we stop hammering a lane we
// already know is capped. Like the transient cooldown, this is OUR clock — we
// never parse/trust a reset time printed in a provider error.
export const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

// Probe-key -> how to probe. `kind` selects the probe mechanism.
export const LANE_PROBES = {
  ollama: { kind: "http", url: OLLAMA_TAGS_URL, label: "Ollama Cloud (L2 technical)" },
  nous: { kind: "spawn", cmd: ["hermes", "--version"], label: "Nous Free / hermes (L4 free-worker)" },
  kimi: { kind: "spawn", cmd: ["kimi", "--version"], label: "Kimi Code (L3 heavy-context)" },
  codex: { kind: "spawn", cmd: ["codex", "--version"], label: "Codex CLI (L6, CORLEONE)" },
};

// Map a canonical role-map lane STRING (e.g. "L2 glm-5.2:cloud", "L4 Nous free",
// "L3 Kimi K3 (256k ctx)") to a probe key. Returns null when no cheap probe
// exists for that lane (Claude CLI lanes, human-gated, "none", etc.) — the
// caller then treats the lane as unprobeable rather than guessing available.
export function laneStringToProbeKey(laneStr) {
  const s = String(laneStr || "").toLowerCase();
  if (!s) return null;
  // L2 = Ollama Cloud (all :cloud models live on the Ollama daemon).
  if (s.startsWith("l2") || /glm-5\.[12]:cloud|kimi-k2\.7-code:cloud|kimi-k3:cloud|gpt-oss/.test(s)) return "ollama";
  // L4 = Nous free / hermes.
  if (s.startsWith("l4") || /nous|hermes/.test(s)) return "nous";
  // L3 = Kimi K3 (heavy context).
  if (s.startsWith("l3") || /kimi/.test(s)) return "kimi";
  // L6 = Codex CLI (CORLEONE's heavy-implementation lane).
  if (s.startsWith("l6") || /codex/.test(s)) return "codex";
  // L1/L5 = Claude Pro (CLI, OAuth) — no cheap probe; L10/L11 local
  // ollama would be "ollama" but those are not in the active role roster.
  return null;
}

// ---- cheap spawn probe (real) ----
export function runSpawnReal(cmd, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd[0], cmd.slice(1), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: process.platform === "win32" });
    } catch (err) {
      return resolve({ ok: false, code: null, error: String(err && err.message), signal: "spawn-threw" });
    }
    let out = "";
    const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* */ } }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", (err) => { clearTimeout(timer); resolve({ ok: false, code: null, error: String(err && err.code || err && err.message), signal: "spawn-error" }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, error: null, signal: code === 0 ? "binary-responsive" : `exit_${code}`, version: out.trim() }); });
  });
}

// ---- probeLaneAvailability ----
// deps (optional, for tests): { httpGet, runSpawn, now }
// Returns: { lane, available, probe, signal, reason, models?, version? }
export async function probeLaneAvailability(lane, deps = {}) {
  const _httpGet = deps.httpGet || httpGet;
  const _runSpawn = deps.runSpawn || runSpawnReal;
  const probeKey = LANE_PROBES[lane] ? lane : laneStringToProbeKey(lane);
  if (!probeKey || !LANE_PROBES[probeKey]) {
    return { lane, available: false, probe: "none", signal: "unprobeable", reason: `no cheap probe implemented for lane "${lane}"` };
  }
  const spec = LANE_PROBES[probeKey];
  if (spec.kind === "http") {
    const r = await _httpGet(spec.url);
    if (r.networkError) return { lane: probeKey, available: false, probe: "http", signal: "unreachable", reason: `network error: ${r.networkErrorMessage}` };
    if (!r.body || !Array.isArray(r.body.models)) return { lane: probeKey, available: false, probe: "http", signal: `status_${r.status}`, reason: "tags endpoint answered but no models[] field" };
    const models = r.body.models.map((m) => m.name || m.model).filter(Boolean);
    return { lane: probeKey, available: true, probe: "http", signal: "ollama /api/tags reachable", models, reason: "ok" };
  }
  if (spec.kind === "spawn") {
    const r = await _runSpawn(spec.cmd);
    return {
      lane: probeKey,
      available: r.ok,
      probe: "spawn",
      signal: r.signal,
      reason: r.ok ? "binary present + responsive (weaker than endpoint-reachable; no cheap unauthenticated endpoint probe exists)" : `binary not responsive: ${r.error || r.signal}`,
      version: r.version || null,
    };
  }
  return { lane: probeKey, available: false, probe: spec.kind, signal: "unknown-kind", reason: "unhandled probe kind" };
}

// ---- state (cooldown) ----
async function loadRoutingState(file = STATE_FILE) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return { lanes: {} }; }
}
async function saveRoutingState(st, file = STATE_FILE) {
  try { await fs.writeFile(file, JSON.stringify(st, null, 2), "utf8"); } catch { /* best-effort */ }
}

export function cooldownMsFor(count) {
  if (count <= 0) return 0;
  const raw = COOLDOWN_BASE_MS * Math.pow(2, count - 1);
  return Math.min(raw, COOLDOWN_CAP_MS);
}

// ---- quota failure detection ----
// isQuotaFailureText(text): true when the text indicates an EXHAUSTED-QUOTA /
// usage-cap condition (NOT a transient blip). Matches provider-shaped phrases,
// never bare code/editor words such as "quota", "auth_error", "usage limit", or
// "429".
// Returns false for null/undefined/empty. This is the decision boundary between
// recordQuotaExhausted (long cooldown) and recordFailure (transient backoff).
export function isQuotaFailureText(text) {
  if (text == null) return false;
  const s = String(text);
  if (s === "") return false;
  const patterns = [
    /you'?ve (hit|reached) your .{0,60}limit/i,
    /weekly \(7-day\) usage limit/i,
    /rate[ _-]?limit exceeded/i,
    /insufficient_quota/i,
    /\bHTTP 429\b/i,
    /\bstatus(?: code)? 429\b/i,
    /provider\.auth_error/i,
    /quota (?:exceeded|exhausted)/i,
  ];
  return patterns.some((p) => p.test(s));
}

// recordFailure(lane, reason): persist an observed failure with a real
// timestamp. lane may be a probe key or a full lane string (normalized).
// deps: { now, stateFile }
export async function recordFailure(lane, reason, deps = {}) {
  const now = deps.now || Date.now();
  const file = deps.stateFile || STATE_FILE;
  const key = LANE_PROBES[lane] ? lane : (laneStringToProbeKey(lane) || lane);
  const st = await loadRoutingState(file);
  st.lanes = st.lanes || {};
  const prev = st.lanes[key] || { failureCount: 0 };
  const failureCount = (prev.failureCount || 0) + 1;
  st.lanes[key] = {
    lastFailureTs: now,
    lastFailureReason: String(reason || "unknown"),
    failureCount,
    cooldownMs: cooldownMsFor(failureCount),
  };
  await saveRoutingState(st, file);
  return { lane: key, failureCount, cooldownMs: st.lanes[key].cooldownMs, lastFailureTs: now };
}

// recordQuotaExhausted(lane, reason): persist an EXHAUSTED-QUOTA condition with
// the long, separate QUOTA_COOLDOWN_MS cooldown (NOT the transient exponential
// backoff). Same normalization, persistence and best-effort discipline as
// recordFailure (never throws). The stored entry is flagged
// quotaExhausted:true so the read path can distinguish it from a transient
// failure. deps: { now, stateFile }
// Returns: { lane, failureCount, cooldownMs, lastFailureTs, quotaExhausted }
export async function recordQuotaExhausted(lane, reason, deps = {}) {
  const now = deps.now || Date.now();
  const file = deps.stateFile || STATE_FILE;
  const key = LANE_PROBES[lane] ? lane : (laneStringToProbeKey(lane) || lane);
  let failureCount = 0;
  try {
    const st = await loadRoutingState(file);
    st.lanes = st.lanes || {};
    const prev = st.lanes[key] || { failureCount: 0 };
    failureCount = (prev.failureCount || 0) + 1;
    st.lanes[key] = {
      lastFailureTs: now,
      lastFailureReason: String(reason || "unknown"),
      failureCount,
      cooldownMs: QUOTA_COOLDOWN_MS,
      quotaExhausted: true,
    };
    await saveRoutingState(st, file);
  } catch { /* best-effort: never throws */ }
  return { lane: key, failureCount, cooldownMs: QUOTA_COOLDOWN_MS, lastFailureTs: now, quotaExhausted: true };
}

// Clear a lane's failure state (call after a successful probe/dispatch to reset
// the backoff). Clears a quota entry the same way it clears a normal one — a
// successful dispatch means the quota window reopened. deps: { now, stateFile }
export async function clearFailure(lane, deps = {}) {
  const file = deps.stateFile || STATE_FILE;
  const key = LANE_PROBES[lane] ? lane : (laneStringToProbeKey(lane) || lane);
  const st = await loadRoutingState(file);
  st.lanes = st.lanes || {};
  if (st.lanes[key]) {
    delete st.lanes[key];
    await saveRoutingState(st, file);
  }
  return { lane: key, cleared: true };
}

// isInCooldown(lane): true if the lane is still within its self-computed
// cooldown window. deps: { now, stateFile, loadState }
// Adds one field over the original shape: quotaExhausted (boolean, from the
// stored entry, default false). No existing field name or meaning changes, and
// the transient-failure math is unchanged.
export async function isInCooldown(lane, deps = {}) {
  const now = deps.now || Date.now();
  const file = deps.stateFile || STATE_FILE;
  const key = LANE_PROBES[lane] ? lane : (laneStringToProbeKey(lane) || lane);
  let st;
  if (deps.loadState) st = deps.loadState;
  else st = await loadRoutingState(file);
  const entry = (st.lanes || {})[key];
  if (!entry || !entry.lastFailureTs) return { inCooldown: false, lane: key, remainingMs: 0, failureCount: 0, quotaExhausted: false };
  const cooldown = entry.cooldownMs != null ? entry.cooldownMs : cooldownMsFor(entry.failureCount || 1);
  const expiresAt = entry.lastFailureTs + cooldown;
  const remainingMs = expiresAt - now;
  return {
    inCooldown: remainingMs > 0,
    lane: key,
    remainingMs: remainingMs > 0 ? remainingMs : 0,
    failureCount: entry.failureCount || 0,
    expiresAt,
    lastFailureReason: entry.lastFailureReason || null,
    quotaExhausted: entry.quotaExhausted === true,
  };
}

// shouldSkipLane(lane): convenience wrapper over isInCooldown for callers that
// only need a skip/answer. Pure wrapper — no new state; same injectable deps
// (now, stateFile, loadState) forwarded to isInCooldown.
// Returns: { skip, reason, remainingMs, quotaExhausted }
//   skip: true when isInCooldown reports inCooldown.
//   reason: "quota" when the entry is quota-flagged, "cooldown" for a transient
//           one, null when not skipping.
export async function shouldSkipLane(lane, deps = {}) {
  const cd = await isInCooldown(lane, deps);
  if (!cd.inCooldown) return { skip: false, reason: null, remainingMs: 0, quotaExhausted: cd.quotaExhausted === true };
  const reason = cd.quotaExhausted === true ? "quota" : "cooldown";
  return { skip: true, reason, remainingMs: cd.remainingMs, quotaExhausted: cd.quotaExhausted === true };
}

// ---- role map loading ----
export async function loadRoleMap(file = ROLE_MAP_FILE) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
function findRole(roleMap, role) {
  const want = String(role).toUpperCase();
  return (roleMap.roles || []).find((r) => String(r.role_id).toUpperCase() === want) || null;
}

// ---- resolveLane(role) ----
// deps: { httpGet, runSpawn, now, stateFile, roleMap, loadState }
// Returns: { role, chosen, reason, defaultLane, fallbackLane, defaultResult, fallbackResult }
//   chosen = the chosen lane STRING (from the canonical role map) or null (defer).
//   reason ∈ { "default-ok", "default-cooldown-use-fallback", "default-unavailable-use-fallback",
//              "both-unavailable-defer" }
// NEVER invents a lane not present in the canonical roster.
export async function resolveLane(role, deps = {}) {
  const roleMap = deps.roleMap || await loadRoleMap();
  const r = findRole(roleMap, role);
  if (!r) return { role, chosen: null, reason: "unknown-role", defaultLane: null, fallbackLane: null };
  const defaultLane = r.default_lane;
  const fallbackLane = r.fallback_lane;
  const results = {};

  async function evaluate(laneStr) {
    if (!laneStr || /^(none|\(none\)|human\+gated)/i.test(String(laneStr))) {
      return { laneStr, available: false, probe: "non-probeable-lane", signal: "non-probeable", reason: "lane is human-gated / none" };
    }
    const probe = await probeLaneAvailability(laneStr, deps);
    const cd = await isInCooldown(laneStr, { ...deps, loadState: deps.loadState });
    return { laneStr, available: probe.available && !cd.inCooldown, probe, cooldown: cd };
  }

  const def = await evaluate(defaultLane);
  results.default = def;
  if (def.available) {
    return { role, chosen: defaultLane, reason: "default-ok", defaultLane, fallbackLane, defaultResult: def, fallbackResult: null };
  }
  const fb = await evaluate(fallbackLane);
  results.fallback = fb;
  if (fb.available) {
    const why = def.cooldown && def.cooldown.inCooldown ? "default-cooldown-use-fallback" : "default-unavailable-use-fallback";
    return { role, chosen: fallbackLane, reason: why, defaultLane, fallbackLane, defaultResult: def, fallbackResult: fb };
  }
  return { role, chosen: null, reason: "both-unavailable-defer", defaultLane, fallbackLane, defaultResult: def, fallbackResult: fb };
}

// ---- resolveSjahrirModel(taskKind) ----
// Implements the OWNER's explicit SJAHRIR routing rule. Probe Kimi lane
// availability FIRST ("probe availability before dispatch"); if the lane is
// down, return a clear "not available, defer" — never pretend a model choice
// was made when the lane itself is down.
//
// Model name strings (used verbatim, not invented) — the OWNER's explicit
// SJAHRIR routing rule, consistent with RUNTIME-CAPACITY-MAP.md L3 ("Kimi Code",
// "K3 256k ctx") and the L2 model roster ("kimi-k2.7-code:cloud", "kimi-k3:cloud"):
//   synthesis | research | unspecified/default -> "K3-256K"   (256k-context K3)
//   bounded_coding                            -> "K2.7 Code"
//   escalation                                -> "full K3"     (unrestricted K3)
// deps: { httpGet, runSpawn, now, stateFile, loadState }
export async function resolveSjahrirModel(taskKind, deps = {}) {
  const probe = await probeLaneAvailability("kimi", deps);
  const cd = await isInCooldown("kimi", { ...deps, loadState: deps.loadState });
  if (!probe.available || cd.inCooldown) {
    return {
      available: false,
      defer: true,
      lane: "kimi",
      model: null,
      taskKind: taskKind || "default",
      reason: `kimi lane not available (probe.signal=${probe.signal}${cd.inCooldown ? `, cooldown remaining ${cd.remainingMs}ms` : ""}) -> defer`,
      probe,
      cooldown: cd,
    };
  }
  const kind = String(taskKind || "default").toLowerCase();
  let model;
  if (kind === "synthesis" || kind === "research" || kind === "default" || kind === "" || kind === "unspecified" || kind === "null") model = "K3-256K";
  else if (kind === "bounded_coding" || kind === "boundedcoding" || kind === "coding") model = "K2.7 Code";
  else if (kind === "escalation") model = "full K3";
  else model = "K3-256K"; // unknown kinds -> default (documented: unspecified/default -> K3-256K)
  return {
    available: true,
    defer: false,
    lane: "kimi",
    model,
    taskKind: kind,
    reason: `kimi lane available -> ${model} for taskKind="${kind}"`,
    probe,
  };
}

// ---- CLI smoke: probe all lanes for real ----
async function main() {
  const arg = process.argv[2];
  if (arg === "--probe-all") {
    for (const key of Object.keys(LANE_PROBES)) {
      const r = await probeLaneAvailability(key);
      console.log(`${key}: available=${r.available} signal=${r.signal}${r.models ? " models=" + JSON.stringify(r.models) : ""}${r.version ? " version=" + JSON.stringify(r.version) : ""} reason=${r.reason}`);
    }
    return;
  }
  if (arg === "--resolve" && process.argv[3]) {
    const r = await resolveLane(process.argv[3]);
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (arg === "--sjahrir" && process.argv[3]) {
    const r = await resolveSjahrirModel(process.argv[3]);
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log("usage: routing.mjs --probe-all | --resolve <ROLE> | --sjahrir <taskKind>");
}

const isEntry = (() => {
  try { return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url); }
  catch { return false; }
})();
if (isEntry) main().catch((err) => { console.error("routing fatal:", err); process.exit(1); });