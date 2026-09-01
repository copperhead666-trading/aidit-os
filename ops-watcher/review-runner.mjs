// ops-watcher/review-runner.mjs
// Automatically reviews Paperclip issues labeled REVIEW_REQUIRED (with no existing
// agent VERDICT comment) by dispatching GIBRAN via the documented hermes CLI
// one-shot command, then posts the verdict back as a comment ATTRIBUTED TO GIBRAN
// (authorAgentId = GIBRAN), and on a PASS verdict transitions the issue to a DONE
// status; on a REJECT/FAIL verdict it adds NEEDS_REWORK instead. Hermes
// failures/timeouts never crash the script and are bounded (after N failed
// dispatch attempts the issue is moved to NEEDS_REWORK so it cannot silently
// vanish or loop forever).
//
//   node ops-watcher/review-runner.mjs --once
//
// === PRODUCTION SWEEP (runReviewSweep — the honest board-relay model) ===
// main() calls runReviewSweep (NOT runReviewOnce). runReviewSweep posts each
// GIBRAN verdict as an HONEST BOARD-RELAY comment:
//   - authorType: "user" (the board, NOT forging agent authorship)
//   - authorAgentId: null (NOT forging an agent id)
//   - metadata.sections[0].rows[] carries an { type:"agent_link", agentId:<GIBRAN> }
//     row that transparently relays "this verdict came from GIBRAN via the hermes
//     CLI", so the attribution is honest and visible WITHOUT the hard Paperclip
//     constraint that agent authorship requires a native heartbeat run.
// Already-verdicted detection (findAgentVerdict) recognizes a board-relay
// (authorType:"user") comment carrying a VERDICT: marker as a REAL prior verdict
// — so the KOL-33/37/38 duplicate-dispatch bug class cannot recur under the new
// model. Bounded retry is comment-based (count of "REVIEW DISPATCH FAILED"
// comments on the issue, NOT review-runner.state.json). The return shape is a
// summary counter object: { passed, rejected, dispatchFailed, skipped,
// parseFailed, errors }.
//
// runReviewOnce (the legacy agent-attribution-dance entrypoint) is KEPT as an
// exported function: it is still exercised by runners.regression.test.mjs and
// the T7 concurrent-sweep regression test (which injects lock deps against a
// temp lock file via runReviewOnce directly). It is NOT called by main() anymore.
//
// === GIBRAN dispatch (mandated external mechanism) ===
// Per hatta/workspace/PAPERCLIP-API-NOTES-phase2.md, GIBRAN is dispatched via the
// hermes CLI one-shot (NOT Paperclip's native heartbeat/adapter):
//   hermes -z "<prompt>" --provider nous -m "upstage/solar-pro4:free" --in "D:\AI\Active FounderOS-Aidit"
// Nous Free is slow (~70s–7min); we use a 10-minute timeout and never crash on
// timeout/failure (we catch, log, and bound-retry).
//
// === PHASE 3 HARDENING ===
// (H2) OWNER-blocker protection:
//   If an issue carries a label named OWNER_REQUIRED, review-runner NEVER acts
//   on it — not dispatched, not reviewed, not transitioned — even if it also
//   carries REVIEW_REQUIRED. The skip is LOGGED ("skipped, OWNER_REQUIRED"),
//   never silent. OWNER_REQUIRED is created in the company if missing
//   (idempotent) so a human can apply it.
// (H3) Provider failure must not kill the runner:
//   Each issue is processed inside a try/catch. If the hermes child fails to
//   even spawn (ENOENT), or dispatchReviewer throws, or any unexpected error
//   occurs for one issue, it is logged clearly and the sweep continues to the
//   next issue rather than crashing the whole --once run. (Normal timeout is
//   already handled as a bounded defer, not an exception.)
// (H4) Retry/rework loop — reset condition (documented, STATELESS):
//   After a FAIL/REJECT, the issue is transitioned to status=todo + NEEDS_REWORK
//   and the agent VERDICT comment remains on the issue. A human/HATTA re-applies
//   REVIEW_REQUIRED to give it a fresh chance. The reset condition we implement
//   is derived ENTIRELY from Paperclip's own live state (no fragile local cache):
//     "A prior agent VERDICT is considered CONSUMED (and a fresh REVIEW_REQUIRED
//      application is detected) when an agent verdict comment exists AND the
//      issue's current status is NOT in_review."
//   Rationale: during an active review cycle the issue is in_review; once we
//   act on a verdict we transition it away (PASS->done, REJECT->todo), so a
//   verdict that is no longer in_review is necessarily from a PRIOR, already-
//   acted-on cycle. Re-applying REVIEW_REQUIRED after that is a genuine fresh
//   request. On detecting a consumed verdict we RESET the attempt counter
//   (state.attempts[id]) and dispatch a fresh GIBRAN review, treating the old
//   verdict comment as STALE (by id) so it is neither re-used nor blocks the
//   new verdict. Conversely, an agent verdict present WHILE status is still
//   in_review is an UNCONSUMED verdict from the current cycle (e.g. a transition
//   PATCH that failed, or the native GIBRAN winning the race) -> we SKIP it
//   (no double-dispatch). Repeated automatic re-processing of the SAME
//   UNRESOLVED issue (hermes timeout/defer, no verdict yet, status still
//   in_review) never exceeds MAX_HERMES_ATTEMPTS -> NEEDS_REWORK (unchanged).
//
// === SINGLE-INSTANCE SWEEP LOCK (KOL-37/KOL-38 duplicate-verdict incident fix) ===
//   The existing duplicate-dispatch guard (H4's findAgentVerdict check-then-act)
//   is a GET-comments -> no-verdict -> dispatch+POST pattern with NO lock between
//   the GET and the POST. When multiple concurrent invocations of this script
//   run (heartbeat-daemon.mjs's 5-min timer + manual --once runs + telegram-
//   listener.mjs's event-driven wake, all overlapping), ALL of them read "no
//   verdict yet" before any of their POSTs land, and ALL of them dispatch a
//   fresh GIBRAN hermes call and post a duplicate VERDICT comment. This is the
//   EXACT same bug class already fixed in ahmad-dispatch.mjs (KOL-33 incident)
//   and uses the EXACT same solution: a PID-based single-instance file lock
//   (reusing the atomic acquireLock/releaseLock/isPidAliveReal already exported
//   from telegram-listener-daemon.mjs) wraps the WHOLE sweep. A concurrent
//   second invocation sees the lock held, logs clearly, and exits cleanly
//   (returns an empty summary with refused:true) instead of racing the first.
//
// === Agent attribution mechanism (verified live, see report) ===
// Paperclip attributes a comment to an agent ONLY when ALL of these hold:
//   - the request carries the agent's OWN API key as `Authorization: Bearer pcp_...`
//     (minted via POST /api/agents/{id}/keys; the plaintext `token` is returned
//      exactly once and cached to ops-watcher/gibran-api.key, gitignored via *.key),
//   - the comment is posted with `authorType: "agent"`,
//   - the request carries a valid `X-Paperclip-Run-Id` header pointing at a
//     heartbeat run that is (a) for THIS agent, (b) tied to THIS issue, and
//     (c) currently ACTIVE (a cancelled/finished run is rejected with 422
//      "Comment authorType must match authenticated actor"),
//   - the issue is ASSIGNED to the agent and in `in_review` status (an unassigned
//      or non-in_review issue rejects agent authorship with the same 422).
// runReviewOnce implements the full attribution dance (assign + active run +
// post + cancel) for the legacy agent-attributed path. runReviewSweep (the
// production path) instead uses the HONEST BOARD-RELAY model described at the
// top of this file, which needs none of that dance and cannot hit the 422.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  discoverPaperclipPort,
  httpGet,
  httpPost,
  httpPatch,
  resolveGibranToken,
  invalidateGibranToken,
} from "./paperclip-write-client.mjs";
import {
  acquireLock as acquireLockReal,
  releaseLock as releaseLockReal,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";
import {
  probeLaneAvailability as probeLaneAvailabilityReal,
  isInCooldown as isInCooldownReal,
} from "./routing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const GIBRAN_AGENT_ID = "ce433688-4e0d-4902-addd-b7d27eb081b7";
const HERMES_WORKSPACE = "D:\\AI\\Active FounderOS-Aidit";
const HERMES_PROVIDER = "nous";
const HERMES_MODEL = "upstage/solar-pro4:free";
const HERMES_TIMEOUT_MS = 10 * 60 * 1000;
const RUN_WAIT_MS = 15000;
const MAX_HERMES_ATTEMPTS = 3;
const OUTPUT_CAP = 6000;

const LABEL_SPECS = {
  REVIEW_REQUIRED: "#ef4444",
  NEEDS_REWORK: "#f97316",
  DONE_VERIFIED: "#22c55e",
  // H2: owner-blocker label. Created idempotently; never swapped by this script.
  OWNER_REQUIRED: "#991b1b",
};

const STATE_FILE = path.join(__dirname, "review-runner.state.json");
// Single-instance sweep lock (KOL-37/KOL-38 duplicate-verdict fix). Reuses the
// EXACT same PID-based, stale-lock-aware acquireLock/releaseLock/isPidAliveReal
// already exported from telegram-listener-daemon.mjs. Separate lock file from
// ahmad-dispatch.lock and test-runner.lock — these scripts run independently and
// legitimately concurrently with each other.
const LOCK_FILE = path.join(__dirname, "review-runner.lock");
const iso = () => new Date().toISOString();

// Cheap "is the nous lane usable right now?" probe used by runReviewSweep before
// any Paperclip read/write/dispatch. Mirrors routing.mjs's own resolveLane logic:
// a lane is usable only when the probe reports available AND it is not in our
// own cooldown window. Dependency-injected like every other real I/O call so
// offline regression tests can substitute a fake.
async function probeNousLaneReal(deps = {}) {
  const probe = await probeLaneAvailabilityReal("nous", deps);
  if (!probe.available) {
    return { available: false, lane: "nous", reason: `probe unavailable (${probe.reason || probe.signal || "unknown"})` };
  }
  const cd = await isInCooldownReal("nous", deps);
  if (cd.inCooldown) {
    return { available: false, lane: "nous", reason: `in cooldown (${cd.remainingMs}ms remaining)` };
  }
  return { available: true, lane: "nous", reason: "available" };
}

const VERDICT_RE = /VERDICT\s*:\s*([^\n\r]+)/i;
const PASS_RE = /^\s*(PASS(?:\s+WITH\s+NOTES)?)\b/i;
const REJECT_RE = /^\s*(REJECT(?:ED)?|FAIL(?:ED)?)\b/i;
const WORKSPACE_ERROR_RE = /^\s*WORKSPACE-ERROR\b/i;
// Bounded-retry counter: counts both hermes dispatch failures and GIBRAN
// self-reported WORKSPACE-ERROR anomalies as the same retry budget.
const DISPATCH_FAIL_RE = /REVIEW DISPATCH FAILED|WORKSPACE-ERROR/i;

// Defense-in-depth heuristic: detect an absolute Windows path in GIBRAN's
// stdout that is clearly outside the expected workspace. This is intentionally
// conservative: it only flags paths that look like a codebase/workspace path
// (containing a project-relevant directory segment) so generic system paths do
// not falsely block real verdicts. It is a backstop for the case where GIBRAN
// ignores the self-check instruction in buildPrompt() and proceeds to issue a
// PASS/REJECT from the wrong checkout.
function looksLikeOutOfWorkspacePath(stdout, workspace) {
  if (!stdout || !workspace) return false;
  const ws = String(workspace).toLowerCase().replace(/\\/g, "/");
  // Windows absolute path: drive letter + colon + backslash, then path segments
  // separated by backslashes. Segments may contain spaces (e.g. the incident path
  // "D:\FounderOS-Aidit De Maestros\app"). Terminate on newline/CR or chars that
  // cannot appear in a Windows path.
  const winsAbs = /[A-Za-z]:\\(?:[^\\\n\r"<>|]+\\?)+/g;
  // Conservative filter: the path must look like a codebase/workspace path. This
  // avoids flagging benign system paths (C:\Windows\System32, D:\Program Files,
  // etc.). The list is project-specific enough to catch the KOL-47 shape while
  // keeping false positives low.
  // Anchor the short, generic tokens (app/src/config/.git) so they only match
  // as whole path segments, not as substrings inside common Windows paths such
  // as "AppData", "apps", "config-server", or ".github". The longer project-
  // specific tokens are unambiguous enough to leave as substring matches.
  // KNOWN TRADE-OFF (GIBRAN, KOL-55 review): this anchoring introduces a narrow
  // false-negative surface -- an out-of-workspace path whose only distinguishing
  // token is a near-miss like "MyApp"/"webapp"/"configs" (not an exact app/src/
  // config segment or one of the broad unanchored tokens) will silently pass
  // Layer 3. Accepted as a reasonable cost because Layer 3 is a conservative
  // backstop, not the primary defense (the buildPrompt() self-check is), and the
  // real KOL-47 incident shape stays caught (independently, via "De Maestros").
  const workspaceLike = /((?<=[/]|^)(?:app|src|config)(?=[/]|$)|ops-watcher|hatta|knowledge|skills|FounderOS|De Maestros|(?<=[/]|^)\.git(?=[/]|$))/i;
  for (const m of String(stdout).matchAll(winsAbs)) {
    const p = m[0].toLowerCase().replace(/\\/g, "/");
    if (p === ws || p.startsWith(ws + "/")) continue;
    if (workspaceLike.test(p)) return true;
  }
  return false;
}

// Extract the raw VERDICT value from a block of text, or null when no
// "VERDICT: <value>" line is present. The value is trimmed and excludes the
// trailing newline (the regex captures up to the line break). Pure + EXPORTED
// so the offline regression tests can exercise the exact extraction the live
// sweep path uses (single implementation, no duplication).
export function parseVerdict(text) {
  const m = String(text || "").match(VERDICT_RE);
  return m ? m[1].trim() : null;
}

// Classify an already-extracted verdict string into a coarse category:
// "pass" | "reject" | "workspace-error" | "ambiguous", or null when given
// null/undefined. Pure + EXPORTED. Mirrors the kind-classification that
// classifyVerdict used to inline.
export function verdictCategory(verdict) {
  if (verdict == null) return null;
  const raw = String(verdict);
  if (WORKSPACE_ERROR_RE.test(raw)) return "workspace-error";
  if (PASS_RE.test(raw)) return "pass";
  if (REJECT_RE.test(raw)) return "reject";
  return "ambiguous";
}

export function isUnusableReviewerReply(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return { unusable: true, reason: "empty reviewer output" };
  if (/response truncated due to output length limit/i.test(trimmed)) {
    return { unusable: true, reason: "reviewer output truncated" };
  }
  if (trimmed.length < 20 && !/VERDICT/i.test(trimmed)) {
    return { unusable: true, reason: "reviewer output too short to be a verdict" };
  }
  return { unusable: false };
}

export function isReviewerQuotaFailure(h) {
  const combined = `${h && h.stdout != null ? h.stdout : ""}\n${h && h.stderr != null ? h.stderr : ""}`;
  return /usage limit|quota|auth_error|insufficient_quota|rate limit exceeded/i.test(combined);
}

// Single internal classifier built on the two exported helpers above so there
// is exactly one verdict-extraction implementation in this file.
function classifyVerdict(text) {
  const verdict = parseVerdict(text);
  if (verdict == null) return { verdict: null, kind: "no-verdict", raw: null };
  const kind = verdictCategory(verdict);
  return { verdict, kind, raw: verdict };
}

// Case-insensitive label-name check on an issue's labels array (handles both
// string labels and {name} label objects, as the live API returns).
function hasLabel(it, name) {
  const want = String(name).toUpperCase();
  return (it.labels || []).some((l) => {
    const n = typeof l === "string" ? l : l && l.name ? l.name : "";
    return String(n).toUpperCase() === want;
  });
}

// Detect an existing VERDICT comment. Under the HONEST BOARD-RELAY model the
// production sweep (runReviewSweep) posts verdicts as the board:
//   authorType: "user", authorAgentId: null, with a metadata agent_link row.
// Such a comment MUST be recognized as a real prior verdict, otherwise the
// sweep would re-dispatch GIBRAN on the next run and post a DUPLICATE verdict —
// the EXACT KOL-33/37/38 duplicate-dispatch incident class. So the predicate is:
//   a comment whose body contains a VERDICT: marker, AND which is EITHER
//   (a) authored by an agent (authorAgentId/author_agent_id/derived... truthy)
//       — the legacy agent-attributed model, OR
//   (b) authored by the board (authorType:"user") — the honest board-relay
//       model used by runReviewSweep.
// "REVIEW DISPATCH FAILED" comments (also board-authored) do NOT carry a
// VERDICT: marker, so they are correctly NOT treated as verdicts. We accept
// both camelCase (what the live API emits) and snake_case (what watcher.mjs
// checks) for robustness.
// excludeId (H4): when re-reviewing after a consumed verdict, the OLD verdict
// comment id is passed so it is treated as stale and ignored.
function findAgentVerdictExcluding(comments, excludeId) {
  if (!Array.isArray(comments)) return null;
  return comments.find((c) => {
    if (excludeId && c.id === excludeId) return false;
    const body = String(c.body || "");
    const verdict = parseVerdict(body);
    if (verdict == null) return false;
    // WORKSPACE-ERROR anomaly comments are self-reported routing failures, NOT
    // real verdicts. They must not block legitimate retry dispatches.
    if (verdictCategory(verdict) === "workspace-error") return false;
    const agentId = c.authorAgentId || c.author_agent_id || c.derivedAuthorAgentId || c.derived_author_agent_id;
    if (agentId) return true;
    const at = String(c.authorType || c.author_type || "").toLowerCase();
    return at === "user";
  }) || null;
}
function findAgentVerdict(comments) {
  return findAgentVerdictExcluding(comments, null);
}

// ---- Hermes dispatch (real). Returns { ok, stdout, stderr, timedOut, error }. ----
export function dispatchReviewerReal(prompt, { timeoutMs = HERMES_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const candidates = process.platform === "win32" ? ["hermes", "hermes.cmd"] : ["hermes"];
    let child = null;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let launched = false;

    const tryLaunch = (idx) => {
      if (idx >= candidates.length) {
        resolve({ ok: false, stdout, stderr: stderr + `\nhermes executable not found (tried ${candidates.join(", ")})`, timedOut, error: "enoent" });
        return;
      }
      const exe = candidates[idx];
      try {
        child = spawn(exe, ["-z", prompt, "--provider", HERMES_PROVIDER, "-m", HERMES_MODEL, "--in", HERMES_WORKSPACE], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        launched = true;
      } catch (err) {
        stderr += `\nspawn(${exe}) threw: ${err && err.message}`;
        tryLaunch(idx + 1);
        return;
      }
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
      }, timeoutMs);
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => {
        if (err && err.code === "ENOENT" && !launched) {
          // first candidate missing on PATH; try next
          clearTimeout(timer);
          tryLaunch(idx + 1);
        } else {
          clearTimeout(timer);
          resolve({ ok: false, stdout, stderr: stderr + String(err && err.message), timedOut, error: String(err && err.code || err && err.message) });
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0 && !timedOut, stdout, stderr, timedOut, error: timedOut ? "timeout" : code === 0 ? null : `exit_${code}` });
      });
    };
    tryLaunch(0);
  });
}

function buildPrompt(it) {
  return [
    "You are GIBRAN, the review/acceptance agent for material changes in the FounderOS-Aidit Paperclip workspace.",
    "Review the following issue and decide whether it passes acceptance review.",
    "",
    `Issue identifier: ${it.identifier || it.id}`,
    `Title: ${it.title || "(untitled)"}`,
    "",
    "Description:",
    String(it.description || "(no description)"),
    "",
    "Workspace verification (MUST be performed before reviewing):",
    `1. Confirm you are running inside the correct workspace: "${HERMES_WORKSPACE}".`,
    `2. Verify that the marker file "ops-watcher/review-runner.mjs" exists and is readable at the expected location. Report, in one sentence, what marker file you found and its full path.`,
    "3. If the marker file is missing, or you are clearly in a different directory/drive, stop immediately. Describe what workspace path or files you actually see, then end your reply with a single line in EXACTLY this form:",
    "   VERDICT: WORKSPACE-ERROR",
    "4. Only if the marker file is present should you proceed to review the issue below.",
    "",
    "Review instructions:",
    "1. Read the issue above.",
    "2. If there is no concrete HATTA work product / change artifact described, you may still PASS a self-test/wiring verification issue whose stated goal is to prove wiring.",
    "3. Give a short reasoning block.",
    "4. End your reply with a single line in EXACTLY one of these forms:",
    "   VERDICT: PASS",
    "   VERDICT: PASS WITH NOTES",
    "   VERDICT: REJECT",
    "Choose exactly one. The VERDICT: line must be the last non-empty line.",
  ].join("\n");
}

function cap(s, n = OUTPUT_CAP) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + `\n...[truncated ${s.length - n} bytes]` : s;
}

// ---- State (bounded hermes-failure retry — runReviewOnce only) ----
// NOTE (H4 / phase-3 item 5): this file is the ONLY local state review-runner
// keeps, and it is purely an attempt COUNTER. It is safe to delete/corrupt: on
// the next run the counter simply re-derives as 0, and all DUPLICATE-DISPATCH
// protection (verdict-exists / label-state) is derived from Paperclip's own live
// issue/comment state, never from this file. Deleting it cannot cause a double
// verdict or double transition; at worst it resets the bounded-retry counter
// (a degraded but safe mode).
async function loadState(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return { attempts: {} }; }
}
async function saveState(file, st) {
  try { await fs.writeFile(file, JSON.stringify(st, null, 2), "utf8"); } catch { /* best-effort */ }
}

// ---- ensureLabels (shared) ----
async function ensureLabels(base, companyId, specs, _get, _post, log) {
  const res = await _get(`${base}/api/companies/${companyId}/labels`);
  const existing = Array.isArray(res.body) ? res.body : [];
  const map = {};
  for (const l of existing) map[l.name] = l.id;
  for (const [name, color] of Object.entries(specs)) {
    if (map[name]) continue;
    log(`review-runner: creating missing label ${name}`);
    const cr = await _post(`${base}/api/companies/${companyId}/labels`, { name, color });
    if (cr.body && cr.body.id) map[name] = cr.body.id;
  }
  return map;
}

// ---- Core legacy entrypoint (agent-attribution dance), dependency-injected ----
// deps: { base, companyId, gibranAgentId, httpGet, httpPost, httpPatch,
//         dispatchReviewer, resolveToken, log, stateFile, now,
//         lockFile, acquireLock, releaseLock, isAlive, lockPid, _fs }
//
// SINGLE-INSTANCE SWEEP LOCK: the WHOLE sweep is single-instance. acquireLock is
// the FIRST async action and releaseLock is in a finally, so a sweep that throws,
// returns early (no base / network error / labels failure), or completes
// normally always releases the lock. A concurrent invocation that finds the lock
// held gets { refused: true, pid } back and does NO Paperclip GET/POST/dispatch
// at all — closing the KOL-37/KOL-38 TOCTOU race at its source (the GET-comments /
// dispatch check-then-act) by making the entire sweep mutually exclusive.
export async function runReviewOnce(deps) {
  const {
    base,
    companyId = COMPANY_ID,
    gibranAgentId = GIBRAN_AGENT_ID,
    httpGet: _get = httpGet,
    httpPost: _post = httpPost,
    httpPatch: _patch = httpPatch,
    dispatchReviewer = dispatchReviewerReal,
    resolveToken = (o) => resolveGibranToken(o),
    log = (m) => console.log(m),
    stateFile = STATE_FILE,
    lockFile = LOCK_FILE,
    acquireLock: _acquireLock = acquireLockReal,
    releaseLock: _releaseLock = releaseLockReal,
    isAlive = isPidAliveReal,
    lockPid = process.pid,
    _fs = fs,
  } = deps;
  const results = [];

  // ---- SINGLE-INSTANCE SWEEP LOCK ----
  let lock;
  try {
    lock = await _acquireLock({ lockFile, pid: lockPid, isAlive, _fs });
  } catch (err) {
    // A lock-layer failure must never silently let the race through; treat it
    // as a refusal so we do not double-dispatch on an unknown lock state.
    const msg = (err && err.stack) ? err.stack : String(err);
    log(`review-runner: lock acquire threw (${msg}) -> refusing to run (no double-dispatch on unknown lock state)`);
    return { results, error: "lock-failed", refused: true };
  }
  if (!lock.acquired) {
    log(`review-runner: REFUSING to run — another --once sweep is already in progress (pid=${lock.pid}). Remove ${path.basename(lockFile)} only if you are sure it is stale. No Paperclip reads/writes performed, no double-dispatch risk.`);
    return { results, refused: true, pid: lock.pid };
  }
  log(`review-runner: acquired sweep lock (pid=${lock.pid}) at ${iso()}`);

  try {
    if (!base) {
      log("review-runner: no Paperclip base resolved (instance not running)");
      return { results, error: "no-base" };
    }

    const labelMap = await ensureLabels(base, companyId, LABEL_SPECS, _get, _post, log);
    if (!labelMap.REVIEW_REQUIRED || !labelMap.NEEDS_REWORK || !labelMap.DONE_VERIFIED) {
      log("review-runner: could not ensure labels");
      return { results, error: "labels" };
    }

    const issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
    if (issuesRes.networkError) {
      log(`review-runner: issues list network error: ${issuesRes.networkErrorMessage}`);
      return { results, error: "network" };
    }
    const issues = Array.isArray(issuesRes.body) ? issuesRes.body : [];
    const state = await loadState(stateFile);

    for (const it of issues) {
      const id = it.id;
      const ident = it.identifier || id;

      // H2: OWNER_REQUIRED blocker guard — checked FIRST, before any REVIEW_REQUIRED
      // logic, so an owner-blocked issue is never dispatched/reviewed/transitioned
      // even if it also carries REVIEW_REQUIRED. Logged, not silent.
      if (hasLabel(it, "OWNER_REQUIRED")) {
        log(`review-runner: ${ident} skipped, OWNER_REQUIRED (owner-blocked, no action)`);
        continue;
      }

      const names = (it.labels || []).map((l) => (typeof l === "string" ? l : l.name || ""));
      if (!names.includes("REVIEW_REQUIRED")) continue;
      if ((it.status || "").toLowerCase() === "done") continue;

      // Existing agent verdict?
      const cRes = await _get(`${base}/api/issues/${id}/comments`);
      if (cRes.networkError) {
        log(`review-runner: ${ident} comments fetch network error -> skip`);
        continue;
      }
      const comments = Array.isArray(cRes.body) ? cRes.body : [];
      const existing = findAgentVerdict(comments);

      // H4: retry/rework reset logic.
      let staleVerdictId = null;
      if (existing) {
        const inReview = (it.status || "").toLowerCase() === "in_review";
        if (inReview) {
          // Unconsumed verdict from the CURRENT cycle (transition PATCH failed, or
          // native GIBRAN won the race). Do NOT re-dispatch hermes (no double).
          log(`review-runner: ${ident} unconsumed agent VERDICT present + status in_review -> skip (no double-dispatch)`);
          continue;
        } else {
          // Consumed verdict from a PRIOR cycle (issue was transitioned away from
          // in_review). A fresh REVIEW_REQUIRED re-application -> RESET attempts and
          // give a genuine new chance. Mark the old verdict stale by id.
          staleVerdictId = existing.id;
          if (state.attempts[id]) {
            log(`review-runner: ${ident} fresh REVIEW_REQUIRED re-application after consumed verdict -> reset attempt counter`);
            delete state.attempts[id];
          }
          log(`review-runner: ${ident} fresh REVIEW_REQUIRED (prior verdict consumed) -> dispatching fresh GIBRAN review`);
        }
      } else {
        log(`review-runner: ${ident} (${id}) REVIEW_REQUIRED, no verdict -> dispatching GIBRAN via hermes`);
      }

      // H3: per-issue try/catch — a spawn failure (ENOENT) or any unexpected error
      // for one issue must not kill the whole sweep.
      try {
        const r = await processOneIssue(it, base, companyId, gibranAgentId, labelMap, _get, _post, _patch, dispatchReviewer, resolveToken, log, state, staleVerdictId);
        results.push({ id, identifier: ident, ...r });
      } catch (err) {
        const msg = (err && err.stack) ? err.stack : String(err);
        log(`review-runner: ${ident} UNEXPECTED ERROR (continuing sweep): ${msg}`);
        results.push({ id, identifier: ident, outcome: "error", error: String(err && err.message || err) });
        // Best-effort: post a comment so the failure is visible, never crash sweep.
        try {
          await _post(`${base}/api/issues/${id}/comments`, {
            body: `REVIEW DISPATCH ERROR (ops-watcher/review-runner — ${iso()}): unexpected error (not a normal timeout/defer). Sweep continued.\n--- error ---\n${cap(msg)}\n`,
            authorType: "user",
          });
        } catch {
          /* never let the error-comment itself crash the sweep */
        }
      }
    }
    await saveState(stateFile, state);
    return { results };
  } finally {
    // Always release the lock — on success, on an early return (no-base /
    // network error / labels failure), and on a thrown error — so a crash here
    // never permanently wedges the review lane (the staleness check would also
    // recover it, but cleaning up is correct and matches ahmad-dispatch.mjs).
    try {
      await _releaseLock({ lockFile, _fs });
      log(`review-runner: released sweep lock (pid=${lock.pid})`);
    } catch (err) {
      log(`review-runner: WARN lock release threw (${err && err.message}) — staleness check will recover on next start`);
    }
  }
}

// ---- PRODUCTION SWEEP: runReviewSweep (honest board-relay model) ----
// This is the real production entrypoint. main() calls THIS, not runReviewOnce.
//
// deps: { base, companyId, gibranAgentId, httpGet, httpPost, httpPatch,
//         dispatchReviewer | dispatchGibranFn (legacy test key), resolveToken,
//         log, lockFile, acquireLock, releaseLock, isAlive, lockPid, _fs,
//         probeLane }
//
// Return shape (the spec the regression tests assert on):
//   { passed, rejected, dispatchFailed, skipped, parseFailed, errors: [] }
// plus a `refused: true` flag when the single-instance lock is held by another
// sweep (so main() can report cleanly). On a Paperclip network error the sweep
// does NOT throw — it returns the same summary with at least one `errors` entry
// (test h). Bounded retry is COMMENT-BASED (a count of "REVIEW DISPATCH FAILED"
// comments on the issue, NOT review-runner.state.json) — test e. The lock wraps
// the whole sweep exactly as it wraps runReviewOnce, so the T7 TOCTOU protection
// is preserved.
export async function runReviewSweep(deps) {
  const {
    base,
    companyId = COMPANY_ID,
    gibranAgentId = GIBRAN_AGENT_ID,
    httpGet: _get = httpGet,
    httpPost: _post = httpPost,
    httpPatch: _patch = httpPatch,
    dispatchReviewer = dispatchReviewerReal,
    dispatchGibranFn, // legacy regression-test injection key -> dispatchReviewer
    log = (m) => console.log(m),
    lockFile = LOCK_FILE,
    acquireLock: _acquireLock = acquireLockReal,
    releaseLock: _releaseLock = releaseLockReal,
    isAlive = isPidAliveReal,
    lockPid = process.pid,
    _fs = fs,
    probeLane = probeNousLaneReal,
  } = deps || {};
  const dispatch = dispatchGibranFn || dispatchReviewer;
  const summary = { passed: 0, rejected: 0, dispatchFailed: 0, skipped: 0, parseFailed: 0, errors: [] };

  // ---- SINGLE-INSTANCE SWEEP LOCK (same wrap as runReviewOnce) ----
  let lock;
  try {
    lock = await _acquireLock({ lockFile, pid: lockPid, isAlive, _fs });
  } catch (err) {
    const msg = (err && err.stack) ? err.stack : String(err);
    log(`review-runner sweep: lock acquire threw (${msg}) -> refusing (no double-dispatch on unknown lock state)`);
    summary.errors.push(`lock-failed: ${err && err.message || err}`);
    summary.refused = true;
    return summary;
  }
  if (!lock.acquired) {
    log(`review-runner sweep: REFUSING to run — another sweep is in progress (pid=${lock.pid}). No Paperclip reads/writes, no double-dispatch risk.`);
    summary.refused = true;
    return summary;
  }
  log(`review-runner sweep: acquired lock (pid=${lock.pid}) at ${iso()}`);

  try {
    // ---- NOUS LANE AVAILABILITY CHECK (FOS-19 fix) ----
    // Before reading Paperclip or dispatching GIBRAN/hermes, confirm the nous
    // lane is actually usable (probe says available AND not in our own cooldown).
    // If not, skip this entire sweep cleanly: no dispatches, no verdicts, no
    // transitions, no "failed" markings — the next sweep will retry naturally.
    const lane = await probeLane("nous");
    if (!lane.available) {
      log(`review-runner sweep: REFUSING to run — nous lane unavailable (${lane.reason}). No Paperclip reads/writes, no dispatch risk.`);
      summary.refused = true;
      summary.reason = "nous-lane-unavailable";
      return summary;
    }
    log(`review-runner sweep: nous lane available`);

    if (!base) {
      log("review-runner sweep: no Paperclip base resolved (instance not running)");
      summary.errors.push("no Paperclip base resolved");
      return summary;
    }

    const labelMap = await ensureLabels(base, companyId, LABEL_SPECS, _get, _post, log);
    if (!labelMap.REVIEW_REQUIRED || !labelMap.NEEDS_REWORK || !labelMap.DONE_VERIFIED) {
      log("review-runner sweep: could not ensure labels");
      summary.errors.push("could not ensure REVIEW_REQUIRED/NEEDS_REWORK/DONE_VERIFIED labels");
      return summary;
    }

    const issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
    if (issuesRes.networkError) {
      log(`review-runner sweep: issues list network error: ${issuesRes.networkErrorMessage}`);
      summary.errors.push(`issues list network error: ${issuesRes.networkErrorMessage}`);
      return summary;
    }
    const issues = Array.isArray(issuesRes.body) ? issuesRes.body : [];

    for (const it of issues) {
      const id = it.id;
      const ident = it.identifier || id;
      try {
        const r = await processReviewSweepIssue(it, base, companyId, gibranAgentId, labelMap, _get, _post, _patch, dispatch, log);
        if (r === "skip") summary.skipped += 1;
        else if (r === "pass") summary.passed += 1;
        else if (r === "reject") summary.rejected += 1;
        else if (r === "dispatch-failed") summary.dispatchFailed += 1;
        else if (r === "parse-failed") summary.parseFailed += 1;
        // r === null -> issue not relevant / comments fetch failed; not counted
      } catch (err) {
        const msg = (err && err.stack) ? err.stack : String(err);
        log(`review-runner sweep: ${ident} UNEXPECTED ERROR (continuing): ${msg}`);
        summary.errors.push(`${ident}: ${err && err.message || err}`);
        // Best-effort visible failure comment, never crash the sweep.
        try {
          await _post(`${base}/api/issues/${id}/comments`, {
            body: `REVIEW DISPATCH ERROR (ops-watcher/review-runner sweep — ${iso()}): unexpected error. Sweep continued.\n--- error ---\n${cap(msg)}\n`,
            authorType: "user",
          });
        } catch { /* never let the error-comment itself crash the sweep */ }
      }
    }
    return summary;
  } finally {
    try {
      await _releaseLock({ lockFile, _fs });
      log(`review-runner sweep: released lock (pid=${lock.pid})`);
    } catch (err) {
      log(`review-runner sweep: WARN lock release threw (${err && err.message}) — staleness check will recover`);
    }
  }
}

// ---- KOL-40 FIX: VERDICT comment POST result inspection ----
// The _post (httpPost) helper from paperclip-write-client.mjs returns:
//   { status, body, authRequired, networkError, networkErrorMessage }
// A non-2xx status (e.g. 400 validation error) or a networkError means the
// comment was NOT posted. Previously runReviewSweep did `await _post(...)` and
// NEVER inspected the result before proceeding to _patch the issue's
// status/labels — so a 400 (like the KOL-40 missing metadata.version incident)
// silently dropped the verdict comment while the issue was still marked
// done/NEEDS_REWORK. This helper makes the failure LOUD (matching the
// defensive pattern in ahmad-dispatch.mjs that checks mc.networkError before
// proceeding): it logs an unmistakable WARN so a human/AHMAD notices immediately.
// The PATCH (status/label transition) still proceeds afterward so the issue is
// not stuck forever — but the missing verdict comment is unmistakably visible.
// Returns true if the comment was posted successfully, false otherwise.
function _warnCommentPostFailed(r, ident, branchLabel, log) {
  if (r.networkError) {
    log(`review-runner sweep: WARN ${ident} VERDICT comment POST (${branchLabel}) NETWORK ERROR — comment was NOT posted (${r.networkErrorMessage}). Issue will still be transitioned (PATCH) so it is not stuck, but the verdict comment is MISSING — investigate immediately.`);
    return false;
  }
  if (r.status < 200 || r.status >= 300) {
    const detail = r.body ? JSON.stringify(r.body).slice(0, 500) : "(no response body)";
    log(`review-runner sweep: WARN ${ident} VERDICT comment POST (${branchLabel}) returned HTTP ${r.status} — comment was NOT posted. Response: ${detail}. Issue will still be transitioned (PATCH) so it is not stuck, but the verdict comment is MISSING — investigate immediately.`);
    return false;
  }
  return true;
}

// Per-issue processing for the production sweep (runReviewSweep). Returns one of
// the counter tags: "skip" | "pass" | "reject" | "dispatch-failed" | "parse-failed",
// or null when the issue is not relevant (not REVIEW_REQUIRED / already done /
// OWNER_REQUIRED-blocked / comments-fetch failed) — null is NOT counted.
async function processReviewSweepIssue(it, base, companyId, gibranAgentId, labelMap, _get, _post, _patch, dispatch, log) {
  const id = it.id;
  const ident = it.identifier || id;

  // H2: OWNER_REQUIRED blocker — checked first, never dispatched/reviewed/transitioned.
  if (hasLabel(it, "OWNER_REQUIRED")) {
    log(`review-runner sweep: ${ident} skipped, OWNER_REQUIRED (owner-blocked)`);
    return null;
  }

  const names = (it.labels || []).map((l) => (typeof l === "string" ? l : l.name || ""));
  if (!names.includes("REVIEW_REQUIRED")) return null;
  if ((it.status || "").toLowerCase() === "done") return null;

  // Fetch existing comments.
  const cRes = await _get(`${base}/api/issues/${id}/comments`);
  if (cRes.networkError) {
    log(`review-runner sweep: ${ident} comments fetch network error -> skip this run`);
    return null;
  }
  const comments = Array.isArray(cRes.body) ? cRes.body : [];

  // (f) Already-verdicted? Recognize BOTH legacy agent-attributed verdicts AND the
  // honest board-relay verdicts this sweep posts (authorType:"user" + VERDICT
  // marker). Without recognizing board-relay verdicts we would re-dispatch and
  // duplicate — the KOL-33/37/38 bug class.
  if (findAgentVerdict(comments)) {
    log(`review-runner sweep: ${ident} already has a VERDICT comment -> skip (bounded, no double-dispatch)`);
    return "skip";
  }

  // (e) Bounded retry via COMMENT count (not review-runner.state.json). Count the
  // existing "REVIEW DISPATCH FAILED" comments on this issue; at/above the cap
  // we skip (the issue stays REVIEW_REQUIRED but is no longer re-dispatched every
  // sweep — a human must intervene or it is already routed to NEEDS_REWORK by the
  // cap-reached transition below).
  const failCount = comments.filter((c) => DISPATCH_FAIL_RE.test(String(c.body || ""))).length;
  if (failCount >= MAX_HERMES_ATTEMPTS) {
    log(`review-runner sweep: ${ident} ${failCount} prior REVIEW DISPATCH FAILED comments (>= ${MAX_HERMES_ATTEMPTS}) -> skip (bounded)`);
    return "skip";
  }

  // Dispatch GIBRAN via hermes.
  const prompt = buildPrompt(it);
  const h = await dispatch(prompt);
  if (!h.ok) {
    if (isReviewerQuotaFailure(h)) {
      log(`review-runner sweep: ${ident} executor lane quota exhausted -> holding review (retry budget not consumed)`);
      const body =
        `REVIEW DISPATCH HELD (ops-watcher/review-runner sweep — ${iso()}): executor lane quota is exhausted; review is being held.\n` +
        `Issue remains REVIEW_REQUIRED. Retry budget was not consumed.\n` +
        `--- hermes stderr ---\n${cap(h.stderr)}\n` +
        `--- hermes stdout ---\n${cap(h.stdout)}\n`;
      await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null });
      return "dispatch-failed";
    }
    const attempt = failCount + 1;
    const reason = h.timedOut ? "timeout" : (h.error || "hermes-failed");
    log(`review-runner sweep: ${ident} hermes dispatch failed (${reason}), attempt ${attempt}/${MAX_HERMES_ATTEMPTS}`);
    const body =
      `REVIEW DISPATCH FAILED (ops-watcher/review-runner sweep — ${iso()}): hermes ${reason}\n` +
      `Attempt ${attempt} of ${MAX_HERMES_ATTEMPTS}. Issue remains REVIEW_REQUIRED.\n` +
      (attempt >= MAX_HERMES_ATTEMPTS
        ? `Attempt cap reached -> moving to NEEDS_REWORK so this does not silently loop.\n`
        : `Will retry on the next sweep.\n`) +
      `--- hermes stderr ---\n${cap(h.stderr)}\n`;
    await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null });
    if (attempt >= MAX_HERMES_ATTEMPTS) {
      const next = new Set(Array.isArray(it.labelIds) ? it.labelIds : []);
      next.delete(labelMap.REVIEW_REQUIRED);
      next.add(labelMap.NEEDS_REWORK);
      await _patch(`${base}/api/issues/${id}`, { labelIds: [...next], status: "todo", assigneeAgentId: null });
      log(`review-runner sweep: ${ident} -> NEEDS_REWORK (hermes attempt cap reached)`);
    }
    return "dispatch-failed";
  }

  const unusable = isUnusableReviewerReply(h.stdout);
  if (unusable.unusable) {
    const attempt = failCount + 1;
    const reason = unusable.reason;
    log(`review-runner sweep: ${ident} hermes lane failure (${reason}), attempt ${attempt}/${MAX_HERMES_ATTEMPTS}`);
    const body =
      `REVIEW DISPATCH FAILED (ops-watcher/review-runner sweep — ${iso()}): hermes lane failure: ${reason}\n` +
      `Attempt ${attempt} of ${MAX_HERMES_ATTEMPTS}. Issue remains REVIEW_REQUIRED.\n` +
      (attempt >= MAX_HERMES_ATTEMPTS
        ? `Attempt cap reached -> moving to NEEDS_REWORK so this does not silently loop.\n`
        : `Will retry on the next sweep.\n`) +
      `--- hermes stderr ---\n${cap(h.stderr)}\n` +
      `--- hermes stdout ---\n${cap(h.stdout)}\n`;
    await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null });
    if (attempt >= MAX_HERMES_ATTEMPTS) {
      const next = new Set(Array.isArray(it.labelIds) ? it.labelIds : []);
      next.delete(labelMap.REVIEW_REQUIRED);
      next.add(labelMap.NEEDS_REWORK);
      await _patch(`${base}/api/issues/${id}`, { labelIds: [...next], status: "todo", assigneeAgentId: null });
      log(`review-runner sweep: ${ident} -> NEEDS_REWORK (hermes lane failure attempt cap reached)`);
    }
    return "dispatch-failed";
  }

  // Hermes succeeded — parse the verdict.
  let cls = classifyVerdict(h.stdout);
  log(`review-runner sweep: ${ident} hermes verdict kind=${cls.kind} raw=${cls.raw}`);

  // Layer-3 defense-in-depth: if GIBRAN ignored the self-check and its stdout
  // references an out-of-workspace path, treat it as a workspace anomaly even
  // though the verdict line itself says PASS/REJECT.
  if ((cls.kind === "pass" || cls.kind === "reject") && looksLikeOutOfWorkspacePath(h.stdout, HERMES_WORKSPACE)) {
    log(`review-runner sweep: ${ident} stdout references an out-of-workspace path -> treating as workspace-error (defense-in-depth)`);
    cls = { verdict: "WORKSPACE-ERROR", kind: "workspace-error", raw: "WORKSPACE-ERROR" };
  }

  // Honest board-relay attribution: post as the board (authorType:"user",
  // authorAgentId:null) with a metadata agent_link row that transparently relays
  // "this verdict came from GIBRAN via the hermes CLI". No agent-authorship dance,
  // no 422 risk, no forged attribution.
  const metadata = {
    version: 1,
    sections: [{
      title: "Review verdict",
      rows: [{ type: "agent_link", agentId: gibranAgentId, label: "GIBRAN (reviewed via hermes CLI relay)" }],
    }],
  };
  const curLabelIds = Array.isArray(it.labelIds) ? it.labelIds.slice() : [];
  const next = new Set(curLabelIds);
  next.delete(labelMap.REVIEW_REQUIRED);

  // WORKSPACE-ERROR: GIBRAN self-reported that it could not see the expected
  // repository workspace. Treat exactly like a dispatch failure: post a visible
  // anomaly comment, do NOT transition the issue, and count it toward the same
  // MAX_HERMES_ATTEMPTS bounded-retry budget (the comment is matched by
  // DISPATCH_FAIL_RE so subsequent sweeps count it).
  if (cls.kind === "workspace-error") {
    const attempt = failCount + 1;
    log(`review-runner sweep: ${ident} GIBRAN self-reported workspace routing anomaly (attempt ${attempt}/${MAX_HERMES_ATTEMPTS})`);
    const body =
      `WORKSPACE-ERROR (ops-watcher/review-runner sweep — ${iso()}): GIBRAN self-reported workspace routing anomaly\n` +
      `GIBRAN reported that it could not see the expected repository workspace (${HERMES_WORKSPACE}).\n` +
      `What GIBRAN reported it saw:\n${cap(h.stdout)}\n` +
      `Attempt ${attempt} of ${MAX_HERMES_ATTEMPTS}. Issue remains REVIEW_REQUIRED.\n` +
      (attempt >= MAX_HERMES_ATTEMPTS
        ? `Attempt cap reached -> moving to NEEDS_REWORK so this does not silently loop.\n`
        : `Will retry on the next sweep.\n`);
    const cp = await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null });
    _warnCommentPostFailed(cp, ident, "WORKSPACE-ERROR anomaly", log);
    if (attempt >= MAX_HERMES_ATTEMPTS) {
      next.add(labelMap.NEEDS_REWORK);
      const p = await _patch(`${base}/api/issues/${id}`, { labelIds: [...next], status: "todo", assigneeAgentId: null });
      log(`review-runner sweep: ${ident} -> NEEDS_REWORK (workspace-error attempt cap reached) (PATCH ${p.status})`);
    }
    return "dispatch-failed";
  }

  if (cls.kind === "pass") {
    const body =
      `VERDICT review (GIBRAN via hermes — ${iso()}):\n` +
      `VERDICT: ${cls.raw}\n\n` +
      `Reasoning (hermes stdout):\n${cap(h.stdout)}\n`;
    const cp = await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null, metadata });
    _warnCommentPostFailed(cp, ident, "PASS verdict", log);
    next.add(labelMap.DONE_VERIFIED);
    const p = await _patch(`${base}/api/issues/${id}`, { status: "done", labelIds: [...next], assigneeAgentId: null });
    log(`review-runner sweep: ${ident} PASS -> status=done + DONE_VERIFIED (PATCH ${p.status})`);
    return "pass";
  } else if (cls.kind === "reject") {
    const body =
      `VERDICT review (GIBRAN via hermes — ${iso()}):\n` +
      `VERDICT: ${cls.raw}\n\n` +
      `Reasoning (hermes stdout):\n${cap(h.stdout)}\n`;
    const cp = await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null, metadata });
    _warnCommentPostFailed(cp, ident, "REJECT verdict", log);
    next.add(labelMap.NEEDS_REWORK);
    const p = await _patch(`${base}/api/issues/${id}`, { status: "todo", labelIds: [...next], assigneeAgentId: null });
    log(`review-runner sweep: ${ident} REJECT -> status=todo + NEEDS_REWORK (PATCH ${p.status})`);
    return "reject";
  } else {
    // (g) No parseable VERDICT line (or an ambiguous verdict) -> PARSE_FAILED.
    // Post a visible VERDICT: PARSE_FAILED comment and route to NEEDS_REWORK so
    // it is not silently dropped and not marked done.
    const body =
      `VERDICT review (GIBRAN via hermes — ${iso()}):\n` +
      `VERDICT: PARSE_FAILED\n\n` +
      `GIBRAN replied without a parseable VERDICT: line. Routed to NEEDS_REWORK for human review.\n\n` +
      `Reasoning (hermes stdout):\n${cap(h.stdout)}\n`;
    const cp = await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null, metadata });
    _warnCommentPostFailed(cp, ident, "PARSE_FAILED verdict", log);
    next.add(labelMap.NEEDS_REWORK);
    const p = await _patch(`${base}/api/issues/${id}`, { status: "todo", labelIds: [...next], assigneeAgentId: null });
    log(`review-runner sweep: ${ident} PARSE_FAILED -> status=todo + NEEDS_REWORK (PATCH ${p.status})`);
    return "parse-failed";
  }
}

async function deferProcessOneIssueLaneFailure({ it, id, ident, base, labelMap, _post, _patch, log, state, reason, stderr = "", stdout = null, laneFailure = false }) {
  const attempts = (state.attempts[id] || 0) + 1;
  state.attempts[id] = attempts;
  const summary = laneFailure ? `hermes lane failure: ${reason}` : `hermes ${reason}`;
  log(`review-runner: ${ident} ${summary}, attempt ${attempts}/${MAX_HERMES_ATTEMPTS}`);
  const body =
    `REVIEW DISPATCH FAILED (ops-watcher/review-runner — ${iso()}): ${summary}\n` +
    `Attempt ${attempts} of ${MAX_HERMES_ATTEMPTS}. Issue remains REVIEW_REQUIRED.\n` +
    (attempts >= MAX_HERMES_ATTEMPTS
      ? `Attempt cap reached -> moving to NEEDS_REWORK so this does not silently loop.\n`
      : `Will retry on the next --once sweep.\n`) +
    `--- hermes stderr ---\n${cap(stderr)}\n` +
    (stdout == null ? "" : `--- hermes stdout ---\n${cap(stdout)}\n`);
  await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user" });
  if (attempts >= MAX_HERMES_ATTEMPTS) {
    const next = new Set(Array.isArray(it.labelIds) ? it.labelIds : []);
    next.delete(labelMap.REVIEW_REQUIRED);
    next.add(labelMap.NEEDS_REWORK);
    await _patch(`${base}/api/issues/${id}`, { labelIds: [...next], status: "todo", assigneeAgentId: null });
    delete state.attempts[id];
    log(`review-runner: ${ident} -> NEEDS_REWORK (hermes attempt cap reached)`);
    return { outcome: "needs-rework", reason };
  }
  return { outcome: "deferred", reason };
}
async function processOneIssue(it, base, companyId, gibranAgentId, labelMap, _get, _post, _patch, dispatchReviewer, resolveToken, log, state, staleVerdictId = null) {
  const id = it.id;
  const ident = it.identifier || id;
  const prompt = buildPrompt(it);

  // 1. Dispatch hermes.
  const h = await dispatchReviewer(prompt);
  if (!h.ok) {
    if (isReviewerQuotaFailure(h)) {
      const reason = "quota";
      log(`review-runner: ${ident} executor lane quota exhausted -> holding review (retry budget not consumed)`);
      const body =
        `REVIEW DISPATCH HELD (ops-watcher/review-runner — ${iso()}): executor lane quota is exhausted; review is being held.\n` +
        `Issue remains REVIEW_REQUIRED. Retry budget was not consumed.\n` +
        `--- hermes stderr ---\n${cap(h.stderr)}\n` +
        `--- hermes stdout ---\n${cap(h.stdout)}\n`;
      await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user" });
      return { outcome: "deferred", reason };
    }
    const reason = h.timedOut ? "timeout" : (h.error || "hermes-failed");
    return deferProcessOneIssueLaneFailure({ it, id, ident, base, labelMap, _post, _patch, log, state, reason, stderr: h.stderr });
  }

  const unusable = isUnusableReviewerReply(h.stdout);
  if (unusable.unusable) {
    return deferProcessOneIssueLaneFailure({ it, id, ident, base, labelMap, _post, _patch, log, state, reason: unusable.reason, stderr: h.stderr, stdout: h.stdout, laneFailure: true });
  }

  // hermes succeeded.
  let cls = classifyVerdict(h.stdout);
  log(`review-runner: ${ident} hermes verdict kind=${cls.kind} raw=${cls.raw}`);

  // Layer-3 defense-in-depth: if GIBRAN ignored the self-check and its stdout
  // references an out-of-workspace path, treat it as a workspace anomaly even
  // though the verdict line itself says PASS/REJECT.
  if ((cls.kind === "pass" || cls.kind === "reject") && looksLikeOutOfWorkspacePath(h.stdout, HERMES_WORKSPACE)) {
    log(`review-runner: ${ident} stdout references an out-of-workspace path -> treating as workspace-error (defense-in-depth)`);
    cls = { verdict: "WORKSPACE-ERROR", kind: "workspace-error", raw: "WORKSPACE-ERROR" };
  }

  // WORKSPACE-ERROR: GIBRAN self-reported that it could not see the expected
  // repository workspace. Treat like a dispatch failure: visible anomaly comment,
  // no status/label change, and count toward the same MAX_HERMES_ATTEMPTS budget
  // via the per-issue state.attempts counter.
  if (cls.kind === "workspace-error") {
    const attempts = (state.attempts[id] || 0) + 1;
    state.attempts[id] = attempts;
    log(`review-runner: ${ident} GIBRAN self-reported workspace routing anomaly (attempt ${attempts}/${MAX_HERMES_ATTEMPTS})`);
    const body =
      `WORKSPACE-ERROR (ops-watcher/review-runner — ${iso()}): GIBRAN self-reported workspace routing anomaly\n` +
      `GIBRAN reported that it could not see the expected repository workspace (${HERMES_WORKSPACE}).\n` +
      `What GIBRAN reported it saw:\n${cap(h.stdout)}\n` +
      `Attempt ${attempts} of ${MAX_HERMES_ATTEMPTS}. Issue remains REVIEW_REQUIRED.\n` +
      (attempts >= MAX_HERMES_ATTEMPTS
        ? `Attempt cap reached -> moving to NEEDS_REWORK so this does not silently loop.\n`
        : `Will retry on the next --once sweep.\n`);
    await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user" });
    if (attempts >= MAX_HERMES_ATTEMPTS) {
      const next = new Set(Array.isArray(it.labelIds) ? it.labelIds : []);
      next.delete(labelMap.REVIEW_REQUIRED);
      next.add(labelMap.NEEDS_REWORK);
      await _patch(`${base}/api/issues/${id}`, { labelIds: [...next], status: "todo", assigneeAgentId: null });
      delete state.attempts[id];
      log(`review-runner: ${ident} -> NEEDS_REWORK (workspace-error attempt cap reached)`);
      return { outcome: "needs-rework", reason: "workspace-error" };
    }
    return { outcome: "deferred", reason: "workspace-error" };
  }

  if (cls.kind !== "pass" && cls.kind !== "reject") {
    delete state.attempts[id];
    const body =
      `VERDICT review (GIBRAN via hermes — ${iso()}):\n` +
      `VERDICT: PARSE_FAILED\n\n` +
      `GIBRAN replied without a parseable VERDICT: line. Routed to NEEDS_REWORK for human review.\n\n` +
      `Reasoning (hermes stdout):\n${cap(h.stdout)}\n`;
    await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user" });
    const curLabelIds = Array.isArray(it.labelIds) ? it.labelIds.slice() : [];
    const next = new Set(curLabelIds);
    next.delete(labelMap.REVIEW_REQUIRED);
    next.add(labelMap.NEEDS_REWORK);
    const p = await _patch(`${base}/api/issues/${id}`, { status: "todo", labelIds: [...next], assigneeAgentId: null });
    log(`review-runner: ${ident} PARSE_FAILED -> status=todo + NEEDS_REWORK (PATCH ${p.status})`);
    return { outcome: "needs-rework", kind: "reject", reason: "parse-failed", posted: true };
  }

  // Clear the bounded-retry counter once a real verdict is reached.
  delete state.attempts[id];

  // 2. Post verdict attributed to GIBRAN (attribution dance). staleVerdictId
  //    tells the re-checkes to ignore the prior-cycle (consumed) verdict.
  const posted = await postVerdictAttributed({
    base, issue: it, gibranAgentId, verdictText: composeVerdictComment(h, cls), _get, _post, _patch, resolveToken, log, staleVerdictId,
  });

  // 3. Determine final verdict: re-read comments and find the agent verdict
  //    (ours if we posted, or the native GIBRAN's if it won the race), EXCLUDING
  //    the stale prior-cycle verdict.
  const cRes2 = await _get(`${base}/api/issues/${id}/comments`);
  const comments2 = Array.isArray(cRes2.body) ? cRes2.body : [];
  const agentVerdict = findAgentVerdictExcluding(comments2, staleVerdictId);
  const finalCls = agentVerdict ? classifyVerdict(agentVerdict.body) : cls;
  const kind = finalCls.kind === "pass" ? "pass" : "reject";
  log(`review-runner: ${ident} final verdict kind=${kind} (source=${agentVerdict && agentVerdict.id === (posted && posted.commentId) ? "hermes" : agentVerdict ? "native-gibran" : "hermes-unverified"})`);

  // 4. Transition.
  const curLabelIds = Array.isArray(it.labelIds) ? it.labelIds.slice() : [];
  const next = new Set(curLabelIds);
  next.delete(labelMap.REVIEW_REQUIRED);
  if (kind === "pass") {
    next.add(labelMap.DONE_VERIFIED);
    const p = await _patch(`${base}/api/issues/${id}`, { status: "done", labelIds: [...next], assigneeAgentId: null });
    log(`review-runner: ${ident} PASS -> status=done + DONE_VERIFIED (PATCH ${p.status})`);
    return { outcome: "done", kind, posted: posted && posted.ok };
  } else {
    next.add(labelMap.NEEDS_REWORK);
    const p = await _patch(`${base}/api/issues/${id}`, { status: "todo", labelIds: [...next], assigneeAgentId: null });
    log(`review-runner: ${ident} REJECT -> status=todo + NEEDS_REWORK (PATCH ${p.status})`);
    return { outcome: "needs-rework", kind, posted: posted && posted.ok };
  }
}

function composeVerdictComment(h, cls) {
  return [
    `VERDICT review (GIBRAN via hermes — ${iso()}):`,
    cls.raw ? `VERDICT: ${cls.raw}` : `VERDICT: REJECT`,
    "",
    "Reasoning (hermes stdout):",
    cap(h.stdout),
  ].join("\n");
}

// ---- Attribution: assign + active issue-tied GIBRAN run + post + cancel ----
async function postVerdictAttributed({ base, issue, gibranAgentId, verdictText, _get, _post, _patch, resolveToken, log, staleVerdictId = null }) {
  const id = issue.id;
  // Resolve GIBRAN api key.
  let token = await resolveToken({ base, agentId: gibranAgentId });
  if (!token) {
    log("review-runner: could not resolve/mint GIBRAN api key -> verdict will be posted as board fallback");
    // Fallback: post as board so the verdict is not lost (not agent-attributed).
    const fb = await _post(`${base}/api/issues/${id}/comments`, { body: verdictText, authorType: "user" });
    return { ok: fb.status >= 200 && fb.status < 300, commentId: fb.body && fb.body.id, fallback: true };
  }

  // Assign GIBRAN + in_review (required for agent authorship; auto-creates a run).
  const needAssign = issue.assigneeAgentId !== gibranAgentId || (issue.status || "").toLowerCase() !== "in_review";
  if (needAssign) {
    const pa = await _patch(`${base}/api/issues/${id}`, { assigneeAgentId: gibranAgentId, status: "in_review" });
    if (pa.networkError) log(`review-runner: assign PATCH network error: ${pa.networkErrorMessage}`);
  }

  // Get/create an active GIBRAN run tied to this issue.
  const run = await getOrCreateActiveRun({ base, companyId: issue.companyId, agentId: gibranAgentId, issueId: id, _get, _post, log });
  if (!run) {
    log("review-runner: no active GIBRAN run could be established -> board fallback comment");
    const fb = await _post(`${base}/api/issues/${id}/comments`, { body: verdictText, authorType: "user" });
    return { ok: fb.status >= 200 && fb.status < 300, commentId: fb.body && fb.body.id, fallback: true };
  }

  // Re-check: did the native GIBRAN already post a verdict while the run was
  // spinning up? EXCLUDE the stale prior-cycle verdict (H4) so a fresh review
  // does not mis-use the old consumed verdict.
  const cRes = await _get(`${base}/api/issues/${id}/comments`);
  const comments = Array.isArray(cRes.body) ? cRes.body : [];
  const existing = findAgentVerdictExcluding(comments, staleVerdictId);
  if (existing) {
    log(`review-runner: native GIBRAN already posted verdict ${existing.id} -> using it, not duplicating`);
    await cancelRun(base, run.id, _post, log);
    return { ok: true, commentId: existing.id, native: true };
  }

  // Post the agent comment.
  let post = await _post(`${base}/api/issues/${id}/comments`, { body: verdictText, authorType: "agent" }, {
    token,
    headers: { "x-paperclip-run-id": run.id },
  });

  if (post.authRequired || post.status === 401 || post.status === 403 || post.status === 422) {
    // run may have died, or token revoked. Retry once: fresh run, maybe fresh token.
    log(`review-runner: agent comment post failed (status ${post.status}) -> one retry with fresh run`);
    if (post.status === 401 || post.status === 403) {
      await invalidateGibranToken();
      token = await resolveToken({ base, agentId: gibranAgentId });
    }
    const run2 = await getOrCreateActiveRun({ base, companyId: issue.companyId, agentId: gibranAgentId, issueId: id, _get, _post, log, forceFresh: true });
    if (run2 && token) {
      post = await _post(`${base}/api/issues/${id}/comments`, { body: verdictText, authorType: "agent" }, {
        token,
        headers: { "x-paperclip-run-id": run2.id },
      });
      await cancelRun(base, run2.id, _post, log);
    }
  }
  await cancelRun(base, run.id, _post, log);

  const ok = post.status >= 200 && post.status < 300;
  if (!ok) log(`review-runner: agent comment ultimately failed (status ${post.status}); verdict may be missing`);
  return { ok, commentId: post.body && post.body.id, authorAgentId: post.body && post.body.authorAgentId };
}

async function getOrCreateActiveRun({ base, companyId, agentId, issueId, _get, _post, log, forceFresh = false }) {
  if (!forceFresh) {
    const found = await findActiveRun({ base, companyId, agentId, issueId, _get });
    if (found) return found;
  }
  // Wake up GIBRAN tied to this issue.
  const wk = await _post(`${base}/api/agents/${agentId}/wakeup`, {
    source: "on_demand",
    triggerDetail: "manual",
    reason: "ops-watcher review-runner attribution run",
    payload: { issueId },
    idempotencyKey: randomUUID(),
  });
  if (wk.networkError || !wk.body || !wk.body.id) {
    log(`review-runner: wakeup failed: ${wk.networkErrorMessage || wk.status}`);
    return null;
  }
  const runId = wk.body.id;
  // Wait until running (or give up).
  const run = await waitForRunning(base, runId, _get, RUN_WAIT_MS);
  if (!run) {
    log(`review-runner: wakeup run ${runId} did not reach running in ${RUN_WAIT_MS}ms`);
    return null;
  }
  // Verify tie to the issue.
  const tied = await isRunTiedToIssue(base, runId, issueId, _get);
  if (!tied) {
    log(`review-runner: wakeup run ${runId} not tied to issue ${issueId} (attribution will likely fail)`);
  }
  return { id: runId, status: run.status };
}

async function findActiveRun({ base, companyId, agentId, issueId, _get }) {
  const res = await _get(`${base}/api/companies/${companyId}/heartbeat-runs`);
  const runs = Array.isArray(res.body) ? res.body : [];
  // newest-first heuristic: sort by createdAt desc
  const cand = runs
    .filter((r) => r.agentId === agentId && (r.status === "running" || r.status === "queued"))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  for (const r of cand) {
    if (await isRunTiedToIssue(base, r.id, issueId, _get)) return { id: r.id, status: r.status };
  }
  return null;
}

async function isRunTiedToIssue(base, runId, issueId, _get) {
  const r = await _get(`${base}/api/heartbeat-runs/${runId}/issues`);
  if (!Array.isArray(r.body)) return false;
  return r.body.some((x) => (x.issueId || x.id) === issueId);
}

async function waitForRunning(base, runId, _get, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await _get(`${base}/api/heartbeat-runs/${runId}`);
    if (r.networkError) return null;
    const st = r.body && r.body.status;
    if (st === "running") return r.body;
    if (st === "finished" || st === "cancelled" || st === "error" || st === "terminated") return null;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  return null;
}

async function cancelRun(base, runId, _post, log) {
  const r = await _post(`${base}/api/heartbeat-runs/${runId}/cancel`, {});
  if (r.networkError) log(`review-runner: cancel run ${runId} network error: ${r.networkErrorMessage}`);
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) if (argv[i] === "--once") out.once = true;
  return out;
}

async function main() {
  parseArgs(process.argv);
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  // PRODUCTION CUTOVER: main() calls runReviewSweep (the honest board-relay
  // model), NOT the legacy runReviewOnce. runReviewOnce is retained as an
  // exported function for runners.regression.test.mjs + the T7 lock test.
  const r = await runReviewSweep({ base, log: (m) => console.log(m) });
  if (r.refused) {
    console.log(`review-runner --once: refused — another sweep is running (no Paperclip reads/writes performed)`);
    process.exit(0);
  }
  console.log(`review-runner --once: passed=${r.passed} rejected=${r.rejected} dispatchFailed=${r.dispatchFailed} skipped=${r.skipped} parseFailed=${r.parseFailed} errors=${r.errors.length}`);
  for (const e of r.errors) console.log(`  error: ${e}`);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => {
    console.error("review-runner fatal:", err && err.stack ? err.stack : err);
    // Best-effort lock cleanup on fatal crash (the staleness check would also
    // recover this, but cleaning up is polite — mirrors ahmad-dispatch.mjs).
    fs.unlink(LOCK_FILE).catch(() => {});
    process.exit(1);
  });
}