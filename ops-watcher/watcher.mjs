// ops-watcher/watcher.mjs — dependency-free, deterministic, READ-ONLY watcher.
// NO LLM calls. Detect + route only. Never writes Paperclip issue state.
//
//   node ops-watcher/watcher.mjs                 # poll loop, default 60s
//   node ops-watcher/watcher.mjs --once          # single sweep, then exit
//   node ops-watcher/watcher.mjs --selftest      # offline assertions vs fixtures
//   node ops-watcher/watcher.mjs --interval 120  # custom poll seconds
//
// Events (append-only NDJSON to ops-watcher/events.jsonl):
//   {"ts":<epochMs>,"detector":<string>,"target_role":<string>,"payload":<object>}
// target_role ∈ {AHMAD, ESCALATION-SEC, GIBRAN, OPS-WATCHER} — a logical lane,
// never an LLM dispatch.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ENDPOINT_CONFIG_FILE = path.join(ROOT, "config", "paperclip-endpoint.json");
const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";
const HATTA_MODEL = "glm-5.3:cloud";
const STUCK_RUNNING_MIN = 45;
const SEEN_CAP = 5000;
const POLL_DEFAULT_SEC = 60;
const STATE_FILE = path.join(__dirname, "state.json");
const EVENTS_FILE = path.join(__dirname, "events.jsonl");
// The Paperclip instance lives at <repo>/.paperclip (gitignored, but always
// under the checkout), so this is DERIVED from ROOT. Hardcoding it meant the
// watcher silently resolved NO Paperclip token the moment the checkout moved or
// the folder was renamed — and a missing token reads as "board unreachable",
// which is a different and much more misleading failure.
const SECRETS_DIR = path.join(ROOT, ".paperclip", "instances", "default", "secrets");
const GBRAIN_DB = path.join(ROOT, "knowledge", "store", ".gbrain", "brain.pglite");
const GRAPH_ACTIVE = path.join(ROOT, "graphify-out", "active", "graph.json");
const GRAPH_LEGACY = path.join(ROOT, "graphify-out", "legacy", "graph.json");

// Canonical company id this ops-watcher org operates on. This is a DELIBERATE
// DUPLICATE of the identical constant already defined in
// ops-watcher/paperclip-write-client.mjs. We do NOT import it from there because
// paperclip-write-client.mjs already imports FROM watcher.mjs (discoverPaperclipPort,
// httpGet) — importing back would create a circular import. A documented duplicated
// constant is the honest, correct fix here, not a clever workaround. Keep the two
// copies in sync; watcher.regression.test.mjs asserts they stay equal.
export const CANONICAL_COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";

const nowMs = () => Date.now();
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const snapNow = (snap) => (snap && snap._now) ? snap._now : nowMs();

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}
async function writeJson(file, obj) { await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8"); }
async function statIfExists(p) { try { return await fs.stat(p); } catch { return null; } }

// ---- Verdict-comment predicate (shared by detectReviewWaiting + selftest) ----
// A comment counts as a prior verdict when its body carries a VERDICT: marker
// AND it is authored EITHER by an agent (the legacy agent-attributed model) OR by
// the board (the HONEST BOARD-RELAY model used by review-runner.mjs's
// runReviewSweep: authorType:"user", authorAgentId:null, with a metadata
// agent_link row). Recognizing board-relay verdicts here is REQUIRED so the
// watcher stops firing review-waiting for issues that review-runner has already
// verdicted as a board relay — otherwise the watcher would keep emitting the
// GIBRAN routing signal for already-resolved issues (the KOL-33/37/38
// duplicate-dispatch bug class, in routing-signal form). "REVIEW DISPATCH FAILED"
// comments (also board-authored) do NOT carry a VERDICT: marker, so they are
// correctly NOT treated as verdicts. We accept both camelCase (what the live API
// emits) and snake_case (what this watcher historically checked) for robustness.
function commentIsVerdict(c) {
  if (!c) return false;
  if (!/VERDICT\s*:/i.test(String(c.body || ""))) return false;
  const agentId = c.author_agent_id || c.authorAgentId || c.derived_author_agent_id || c.derivedAuthorAgentId;
  if (agentId) return true;
  const at = String(c.authorType || c.author_type || "").toLowerCase();
  return at === "user";
}

// ---- Canonical Paperclip endpoint discovery ----
// Never trust a hardcoded port. Probe candidate_ports from
// config/paperclip-endpoint.json, GET <health_path> on each, and accept the
// first whose nested identity field strictly equals canonical_identity's
// backup_dir_fingerprint. Returns the matched port (number) or null. Never
// throws — a dead server / closed port / mismatched identity is a clean
// "not found" outcome.
//
// Accepts an optional injected config object (same shape as the on-disk file)
// as the first argument for testability; defaults to reading the real file.
//
// Second, optional argument `opts` (default {}):
//   { attempts = 1, retryDelayMs = 1000, sleep = (ms)=>new Promise(r=>setTimeout(r,ms)) }
// `attempts` is the number of FULL candidate-list sweeps. Default 1 keeps every
// existing caller's exact behaviour and timing (one sweep, no retry delay), so
// `discoverPaperclipPort()` and `discoverPaperclipPort(cfg)` behave exactly as
// before. If a sweep finds a matching port, return it immediately (no extra
// delay). If a sweep finds nothing and further attempts remain, `await
// sleep(retryDelayMs)` and sweep again. After the last attempt, return null.
// `sleep` is injectable so tests never really wait. This exists because a
// single 2s probe can abort under heavy machine load even though the canonical
// instance is healthy — STEWARD requests attempts:3 so one transient miss is
// no longer treated as "the canonical instance is down".
function getNested(obj, dotPath) {
  return dotPath.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

async function loadEndpointConfig() {
  return JSON.parse(await fs.readFile(ENDPOINT_CONFIG_FILE, "utf8"));
}

export async function discoverPaperclipPort(injected, opts = {}) {
  const {
    attempts = 1,
    retryDelayMs = 1000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  let cfg;
  try {
    cfg = injected || await loadEndpointConfig();
  } catch {
    return null;
  }
  // Support either the full on-disk shape (with discovery_strategy) or a flat
  // strategy object handed in by tests.
  const strat = (cfg && cfg.discovery_strategy) || cfg || {};
  const ports = Array.isArray(strat.candidate_ports) ? strat.candidate_ports : [];
  const healthPath = strat.health_path || "/api/health";
  const identityField = strat.identity_field_in_health_response || "databaseBackup.backupDir";
  const fingerprint = (cfg && cfg.canonical_identity && cfg.canonical_identity.backup_dir_fingerprint)
    || (strat.canonical_identity && strat.canonical_identity.backup_dir_fingerprint)
    || strat.backup_dir_fingerprint
    || undefined;
  const timeoutMs = strat.timeout_ms_per_probe || 2000;

  // One FULL candidate-list sweep: probe every candidate port once with the
  // per-probe timeout, accept the first whose nested identity field strictly
  // equals the canonical fingerprint. Hoisted out of the retry loop so config
  // parsing happens once and the sweep body is byte-identical on every attempt
  // (candidate order, per-probe timeout, and fingerprint/identity matching are
  // all preserved exactly — not changed by the retry support). Returns the
  // matched port (number) or null; never throws.
  async function sweepOnce() {
    for (const port of ports) {
      const url = `http://127.0.0.1:${port}${healthPath}`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(url, { method: "GET", signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("json")) continue;
        const body = await res.json();
        const val = getNested(body, identityField);
        if (val === fingerprint) return port;
      } catch {
        // ECONNREFUSED, timeout, DNS, malformed JSON — try the next candidate.
        continue;
      }
    }
    return null;
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const port = await sweepOnce();
    if (port) return port;
    if (attempt < attempts) await sleep(retryDelayMs);
  }
  return null;
}

// Read-only GET. On 401/403, resolve a bearer token from the Paperclip
// secrets dir ONLY — never hardcoded, never from env.
// Every fetch is wrapped so a network-level failure (ECONNREFUSED, timeout,
// DNS, anything fetch can throw) is reported as a clean { networkError: true }
// result rather than propagating as an uncaught exception. This is the fix
// for the real crash "fatal: TypeError: fetch failed" on ECONNREFUSED.
export async function httpGet(url, { token } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, { method: "GET", headers });
  } catch (err) {
    const cause = (err && err.cause && err.cause.code) || (err && err.cause && err.cause.message);
    return {
      status: 0, body: null, authRequired: false,
      networkError: true,
      networkErrorMessage: cause || (err && err.message) || "fetch failed",
    };
  }
  if (res.status === 401 || res.status === 403)
    return { status: res.status, body: null, authRequired: true };
  if (!res.ok) return { status: res.status, body: null, authRequired: false };
  const ct = res.headers.get("content-type") || "";
  try {
    const body = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body, authRequired: false };
  } catch (err) {
    return {
      status: res.status, body: null, authRequired: false,
      networkError: true,
      networkErrorMessage: (err && err.message) || "response parse failed",
    };
  }
}

export async function resolvePaperclipToken(_fs = fs, _secretsDir = SECRETS_DIR) {
  let entries;
  try { entries = await _fs.readdir(_secretsDir); } catch { return null; }
  const pick = entries.find((f) => /token/i.test(f)) || entries.find((f) => !f.startsWith("."));
  if (!pick) return null;
  try { return (await _fs.readFile(path.join(_secretsDir, pick), "utf8")).trim() || null; }
  catch { return null; }
}

// ---- State / dedupe (restart recovery) ----
async function loadState() {
  const s = await readJson(STATE_FILE, null);
  return (s && Array.isArray(s.seen)) ? s : { cursor: 0, seen: [], seenSet: {} };
}
async function saveState(state) {
  if (state.seen.length > SEEN_CAP) {
    state.seen = state.seen.slice(-SEEN_CAP);
    state.seenSet = Object.fromEntries(state.seen.map((k) => [k, true]));
  }
  state.cursor = nowMs();
  await writeJson(STATE_FILE, state);
}
function eventKey(ev) {
  const p = ev.payload || {};
  return `${ev.detector}|${ev.target_role}|${p.issueId || p.key || p.target || ""}`;
}
// The append happens BEFORE the key is marked seen. Marking first meant that a
// failed append still recorded the event as emitted: in the polling loop the
// state object lives across sweeps and the sweep error is caught, so the next
// successful saveState persisted a seen key for an event that was never
// written. The event could then never be emitted again.
export async function emitEvent(state, ev, _fs = fs, _eventsFile = EVENTS_FILE) {
  const key = eventKey(ev);
  if (state.seenSet[key]) return false;
  try {
    await _fs.appendFile(_eventsFile, JSON.stringify({
      ts: nowMs(), detector: ev.detector, target_role: ev.target_role, payload: ev.payload,
    }) + "\n", "utf8");
  } catch (err) {
    console.error(`ops-watcher: event NOT written (${ev.detector}): ${err && err.message ? err.message : err} — not marked seen, will retry next sweep`);
    return false;
  }
  state.seen.push(key);
  state.seenSet[key] = true;
  return true;
}

// ---- Snapshot collection (network + disk, read-only) ----
async function collectSnapshot() {
  const snap = {
    paperclipReachable: false, paperclipAuthRequired: false, issues: [], health: null,
    ollamaReachable: false, ollamaModels: [],
    gbrain: { exists: false, mtimeMs: null }, graphify: { active: false, legacy: false },
    errors: [],
  };

  // Discover the canonical Paperclip endpoint ONCE per sweep. No hardcoded port.
  let base = null;
  try {
    const port = await discoverPaperclipPort();
    base = port ? `http://127.0.0.1:${port}` : null;
  } catch {
    // discoverPaperclipPort is defensive and should not throw, but guard anyway.
    base = null;
  }
  snap._paperclipBase = base;
  snap._paperclipPort = base ? Number(base.match(/:(\d+)$/)[1]) : null;
  snap._token = null;

  if (!base) {
    // Canonical instance not running on any candidate port. Record the gap and
    // skip Paperclip-dependent checks for this sweep (the paperclip-unreachable
    // detector below emits the routing event). Do NOT crash.
    snap.errors.push("paperclip discovery: no candidate port matched canonical identity");
  } else {
    const healthRes = await httpGet(`${base}/api/health`);
    if (healthRes.networkError) {
      snap.errors.push(`paperclip /api/health network error: ${healthRes.networkErrorMessage}`);
    } else if (healthRes.authRequired) {
      snap.paperclipAuthRequired = true;
    } else if (healthRes.body) {
      snap.paperclipReachable = true;
      snap.health = healthRes.body;
    } else if (healthRes.status >= 500 || healthRes.status === 0) {
      snap.errors.push(`paperclip /api/health status=${healthRes.status}`);
    }

    // Issue list: the REAL route is GET /api/companies/{companyId}/issues.
    // The bare /issues path returns the SPA HTML shell on this instance (not
    // JSON), which silently made issue_count 0 for the whole life of this
    // watcher. Fixed in the Phase 7 audit follow-up.
    const issuesUrl = `${base}/api/companies/${CANONICAL_COMPANY_ID}/issues`;
    let token = null;
    let issuesRes = await httpGet(issuesUrl);
    if (issuesRes.networkError) {
      snap.errors.push(`paperclip ${issuesUrl} network error: ${issuesRes.networkErrorMessage}`);
    } else if (issuesRes.authRequired) {
      token = await resolvePaperclipToken();
      if (token) issuesRes = await httpGet(issuesUrl, { token });
    }
    if (issuesRes.networkError) {
      snap.errors.push(`paperclip ${issuesUrl} network error: ${issuesRes.networkErrorMessage}`);
    } else if (Array.isArray(issuesRes.body)) {
      snap.paperclipReachable = true;
      snap.issues = issuesRes.body;
    } else if (issuesRes.authRequired && !token) {
      snap.errors.push("paperclip issues auth required, no token resolved");
    } else if (issuesRes.status >= 400) {
      snap.errors.push(`paperclip ${issuesUrl} status=${issuesRes.status}`);
    }
    snap._token = token;  // per-issue comments fetched lazily in detectReviewWaiting
  }

  const ollamaRes = await httpGet(OLLAMA_TAGS_URL);
  if (ollamaRes.networkError) {
    snap.errors.push(`ollama /api/tags network error: ${ollamaRes.networkErrorMessage}`);
  } else if (Array.isArray(ollamaRes.body?.models)) {
    snap.ollamaReachable = true;
    snap.ollamaModels = ollamaRes.body.models.map((m) => m.name || m.model).filter(Boolean);
  } else {
    snap.errors.push(`ollama /api/tags status=${ollamaRes.status}`);
  }

  const gStat = await statIfExists(GBRAIN_DB);
  if (gStat) { snap.gbrain.exists = true; snap.gbrain.mtimeMs = gStat.mtimeMs; }
  snap.graphify.active = !!(await statIfExists(GRAPH_ACTIVE));
  snap.graphify.legacy = !!(await statIfExists(GRAPH_LEGACY));
  return snap;
}
async function fetchIssueComments(id, token, base) {
  if (!base) return [];
  // REAL route is /api/issues/{id}/comments (the /api prefix was missing
  // before, which hit the SPA HTML shell and returned non-JSON -> []).
  const r = await httpGet(`${base}/api/issues/${id}/comments`, { token });
  if (r.networkError) return [];
  return Array.isArray(r.body) ? r.body : [];
}

// Labels are embedded DIRECTLY on each issue object returned by
// GET /api/companies/{companyId}/issues. The live response carries both
// `labelIds` (array of label ids) and `labels` (array of {id,name,color,...}
// objects). There is NO separate /api/issues/{id}/labels endpoint (verified:
// 404 against the live instance + absent from the OpenAPI spec). So this is a
// pure synchronous read off the issue object — NEVER a network call. The old
// code fetched ${base}/issues/${id}/labels (wrong: bare route + nonexistent
// endpoint) and silently got [] back, which is why review-waiting never fired.
// If an issue object carries neither `labels` nor `labelIds`, return [] (no
// derivation is possible from bare ids without a labels-list lookup, which is
// not this function's job).
export function deriveIssueLabels(it) {
  if (Array.isArray(it?.labels)) return it.labels;
  if (Array.isArray(it?.labelIds)) return it.labelIds; // bare ids; callers needing names get none
  return [];
}

// ---- Detectors (pure w.r.t. snapshot; review-waiting fetches per-issue) ----
// NOTE on field-name casing: the live Paperclip API returns these fields on
// each issue object in camelCase — executionLockedAt, blockedOwnerNotifiedAt,
// unblockDescriptor — NOT snake_case. JS property access is exact-match, so
// reading it.execution_locked_at against a real issue is ALWAYS undefined,
// which silently disabled these two detectors since day one. The reads below
// use camelCase to match the real API shape. The EMITTED EVENT payload keys,
// however, are kept snake_case (execution_locked_at, unblock_descriptor) to
// preserve the downstream-consumer contract documented in README.md — only
// the READS off the Paperclip issue object `it` were wrong, not the output.
function detectStuckRunning(snap) {
  const events = [];
  if (!snap.issues.length) return events;
  const now = snapNow(snap);
  const cutoff = now - STUCK_RUNNING_MIN * 60_000;
  for (const it of snap.issues) {
    if ((it.status || "").toLowerCase() !== "in_progress") continue;
    const locked = it.executionLockedAt ? Date.parse(it.executionLockedAt) : NaN;
    if (!Number.isFinite(locked)) continue;      // need a stale lock to flag
    if (locked > cutoff) continue;               // too fresh
    events.push({
      detector: "stuck-running", target_role: "AHMAD",
      payload: {
        issueId: it.id, identifier: it.identifier || null,
        execution_locked_at: it.executionLockedAt,
        stale_minutes: Math.round((now - locked) / 60_000),
      },
    });
  }
  return events;
}

function detectBlockedUnnotified(snap) {
  const events = [];
  for (const it of snap.issues) {
    if ((it.status || "").toLowerCase() !== "blocked") continue;
    if (it.blockedOwnerNotifiedAt) continue;  // already routed
    events.push({
      detector: "blocked-unnotified", target_role: "ESCALATION-SEC",
      payload: {
        issueId: it.id, identifier: it.identifier || null,
        unblock_descriptor: it.unblockDescriptor || null,
      },
    });
  }
  return events;
}

async function detectReviewWaiting(snap) {
  const events = [];
  const token = snap._token;
  const base = snap._paperclipBase;
  for (const it of snap.issues) {
    // Labels are read synchronously off the issue object (see deriveIssueLabels);
    // no second network call for labels.
    const labels = deriveIssueLabels(it);
    const names = labels.map((l) => (typeof l === "string" ? l : l.name || ""))
      .map((s) => String(s).toUpperCase());
    if (!names.includes("REVIEW_REQUIRED")) continue;
    const comments = await fetchIssueComments(it.id, token, base);
    // Verdict = a comment carrying a VERDICT: marker, authored by an agent
    // (legacy model) OR by the board (the honest board-relay model used by
    // review-runner.mjs runReviewSweep). We only detect its absence; we never
    // write one.
    const hasVerdict = comments.some(commentIsVerdict);
    if (hasVerdict) continue;
    events.push({
      detector: "review-waiting", target_role: "GIBRAN",
      payload: { issueId: it.id, identifier: it.identifier || null, comment_count: comments.length },
    });
  }
  return events;
}

function detectWorkerLaneAvailability(snap) {
  const events = [];
  const hattaOk = snap.ollamaReachable && snap.ollamaModels.includes(HATTA_MODEL);
  if (!hattaOk) {
    events.push({
      detector: "worker-lane-unavailable", target_role: "AHMAD",
      payload: {
        lane: "technical", role: "HATTA",
        ollama_reachable: snap.ollamaReachable,
        model_present: snap.ollamaModels.includes(HATTA_MODEL),
        expected_model: HATTA_MODEL, available_models: snap.ollamaModels,
      },
    });
  }
  if (!snap.paperclipReachable) {
    events.push({
      detector: "paperclip-unreachable", target_role: "AHMAD",
      payload: {
        base: snap._paperclipBase || null,
        discovered_port: snap._paperclipPort || null,
        auth_required: snap.paperclipAuthRequired,
      },
    });
  }
  return events;
}

function detectConnectorDegradation(snap) {
  const events = [];
  if (!snap.gbrain.exists)
    events.push({ detector: "gbrain-store-missing", target_role: "AHMAD", payload: { path: GBRAIN_DB } });
  if (!snap.graphify.active)
    events.push({ detector: "graphify-active-missing", target_role: "AHMAD", payload: { path: GRAPH_ACTIVE } });
  if (!snap.graphify.legacy)
    events.push({ detector: "graphify-legacy-missing", target_role: "AHMAD", payload: { path: GRAPH_LEGACY } });
  return events;
}

// Self-restart recovery = state.json persistence (seen-set + cursor survive
// restarts). Heartbeat emits once per sweep; its seen flag is cleared first.
function detectSelfHeartbeat(snap) {
  return [{
    detector: "watcher-heartbeat", target_role: "OPS-WATCHER",
    payload: {
      sweep: snapNow(snap),
      paperclip_reachable: snap.paperclipReachable,
      paperclip_port: snap._paperclipPort || null,
      ollama_reachable: snap.ollamaReachable,
      gbrain_exists: snap.gbrain.exists,
      graphify_active: snap.graphify.active,
      graphify_legacy: snap.graphify.legacy,
      issue_count: snap.issues.length, errors: snap.errors,
    },
  }];
}

// ---- Sweep ----
async function runOnce(state) {
  const snap = await collectSnapshot();
  const candidates = [
    ...detectStuckRunning(snap),
    ...detectBlockedUnnotified(snap),
    ...(await detectReviewWaiting(snap)),
    ...detectWorkerLaneAvailability(snap),
    ...detectConnectorDegradation(snap),
  ];
  const hb = detectSelfHeartbeat(snap)[0];
  const hbKey = eventKey(hb);
  if (state.seenSet[hbKey]) {
    delete state.seenSet[hbKey];
    state.seen = state.seen.filter((k) => k !== hbKey);
  }
  candidates.push(hb);
  let emitted = 0;
  for (const ev of candidates) if (await emitEvent(state, ev)) emitted++;
  await saveState(state);
  return { emitted, candidates: candidates.length };
}

// ---- Selftest (offline, vs fixtures) ----
async function runSelftest() {
  const fixtureDir = path.join(__dirname, "fixtures");
  const snap = await readJson(path.join(fixtureDir, "state.json"), null);
  const expect = await readJson(path.join(fixtureDir, "expect.json"), null);
  const failures = [];
  const assert = (cond, msg) => { if (!cond) failures.push(msg); };

  assert(snap && Array.isArray(snap.issues), "fixtures/state.json missing issues[]");
  assert(expect && typeof expect === "object", "fixtures/expect.json missing");

  // The offline fixture snapshot does not set _paperclipBase; supply a
  // placeholder so the (unreachable) detector behaves deterministically.
  snap._paperclipBase = snap._paperclipBase || null;
  snap._paperclipPort = snap._paperclipPort || null;
  snap._token = snap._token || null;

  const got = {
    "stuck-running": detectStuckRunning(snap).map((e) => e.payload.issueId),
    "blocked-unnotified": detectBlockedUnnotified(snap).map((e) => e.payload.issueId),
    "review-waiting": [],
    "worker-lane-unavailable": detectWorkerLaneAvailability(snap).map((e) => e.detector),
    "gbrain-store-missing": detectConnectorDegradation(snap).map((e) => e.detector),
    "graphify-active-missing": detectConnectorDegradation(snap).map((e) => e.detector),
    "graphify-legacy-missing": detectConnectorDegradation(snap).map((e) => e.detector),
  };

  // Offline review-waiting: labels come straight off the issue object via
  // deriveIssueLabels (no network). Fixture issue objects may carry `labels`
  // inline OR be supplemented by _fixtureLabelsById (legacy fixture shape);
  // comments come from _fixtureCommentsById (no live network in selftest).
  const commentsById = snap._fixtureCommentsById || {};
  const labelsById = snap._fixtureLabelsById || {};
  for (const it of snap.issues) {
    // Prefer fixture-supplied labels (legacy shape) then the issue object's own
    // labels (the real live shape), then derive synchronously.
    let labels = labelsById[it.id] || deriveIssueLabels(it);
    const names = labels.map((l) => (typeof l === "string" ? l : l.name || ""))
      .map((s) => String(s).toUpperCase());
    if (!names.includes("REVIEW_REQUIRED")) continue;
    const comments = commentsById[it.id] || [];
    const hasVerdict = comments.some(commentIsVerdict);
    if (!hasVerdict) got["review-waiting"].push(it.id);
  }

  const exp = expect.detectors || {};
  for (const [det, expIds] of Object.entries(exp)) {
    const gotIds = (got[det] || []).sort();
    const want = [...expIds].sort();
    const same = gotIds.length === want.length && gotIds.every((v, i) => v === want[i]);
    assert(same, `detector ${det}: got ${JSON.stringify(gotIds)} expected ${JSON.stringify(want)}`);
  }

  // Event-key determinism + heartbeat count.
  const k1 = eventKey({ detector: "x", target_role: "y", payload: { issueId: "z" } });
  const k2 = eventKey({ detector: "x", target_role: "y", payload: { issueId: "z" } });
  assert(k1 === k2, "eventKey not deterministic for identical events");
  assert(detectSelfHeartbeat(snap).length === 1, "heartbeat should produce exactly one event");

  // Coverage for the route/labels fix (Phase 7 audit follow-up):
  // deriveIssueLabels reads labels synchronously off the issue object and never
  // makes a network call. Verify it against a fixture issue that carries labels
  // inline (the real live shape: array of {id,name,...} objects).
  const inlineLabelIssue = { id: "i-inline-labels", labels: [{ id: "L1", name: "REVIEW_REQUIRED" }] };
  assert(
    deriveIssueLabels(inlineLabelIssue).some((l) => (l.name || "").toUpperCase() === "REVIEW_REQUIRED"),
    "deriveIssueLabels must read REVIEW_REQUIRED off an inline-labels issue object",
  );
  // An issue with only labelIds (bare ids, no names) returns the ids; name
  // derivation is intentionally not this function's job.
  const bareIdIssue = { id: "i-bare-ids", labelIds: ["L1", "L2"] };
  assert(
    Array.isArray(deriveIssueLabels(bareIdIssue)) && deriveIssueLabels(bareIdIssue).length === 2,
    "deriveIssueLabels must return labelIds when labels absent",
  );
  // An issue with neither field returns [].
  assert(
    Array.isArray(deriveIssueLabels({ id: "i-none" })) && deriveIssueLabels({ id: "i-none" }).length === 0,
    "deriveIssueLabels must return [] when issue carries no labels/labelIds",
  );

  if (failures.length) {
    console.error(`SELFTEST FAIL (${failures.length}):`);
    for (const f of failures) console.error("  - " + f);
    process.exitCode = 1;
    return;
  }
  console.log("SELFTEST OK");
  console.log(JSON.stringify(got, null, 2));
}

// ---- Main ----
function parseArgs(argv) {
  const out = { once: false, selftest: false, interval: POLL_DEFAULT_SEC };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") out.once = true;
    else if (a === "--selftest") out.selftest = true;
    else if (a === "--interval") out.interval = Number(argv[++i]) || POLL_DEFAULT_SEC;
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv);
  if (args.selftest) return runSelftest();
  const state = await loadState();
  if (args.once) {
    const r = await runOnce(state);
    console.log(`ops-watcher --once: emitted=${r.emitted} candidates=${r.candidates}`);
    return;
  }
  console.log(`ops-watcher polling every ${args.interval}s (events -> ${path.relative(ROOT, EVENTS_FILE)})`);
  while (true) {
    try {
      const r = await runOnce(state);
      console.log(`${iso()} sweep: emitted=${r.emitted} candidates=${r.candidates}`);
    } catch (err) {
      console.error(`${iso()} sweep error:`, err && err.message ? err.message : err);
    }
    await sleep(args.interval * 1000);
  }
}

// Only run main() when this file is the entry point, so test modules can
// import { discoverPaperclipPort, httpGet } without side effects.
const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => { console.error("fatal:", err); process.exit(1); });
}
