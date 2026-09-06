// ops-watcher/heartbeat.mjs — PHASE 8 (bounded, safe activation) single-sweep
// entrypoint for the FounderOS-Aidit agent org.
//
//   node ops-watcher/heartbeat.mjs --once
//
// This is a SINGLE SWEEP, not a daemon. It runs, in order, ONE invocation each
// of the fifteen ops-watcher scripts:
//
//   1. node ops-watcher/watcher.mjs          --once
//   2. node ops-watcher/test-runner.mjs      --once
//   3. node ops-watcher/review-runner.mjs    --once
//   4. node ops-watcher/telegram-notify.mjs  --once
//   5. node ops-watcher/telegram-listener.mjs --once   (gated fallback; see below)
//   6. node ops-watcher/cockpit-status.mjs   --html ops-watcher/cockpit-snapshot.html
//   7. node ops-watcher/ahmad-dispatch.mjs   --once
//   8. node ops-watcher/steward.mjs          --once
//   9. node ops-watcher/steward-sjs.mjs      --once
//  10. node ops-watcher/steward-caveman.mjs  --once
//  11. node ops-watcher/escalation-sec.mjs   --once
//  12. node ops-watcher/gbrain-curator.mjs  --once
//  13. node ops-watcher/audit-clerk.mjs     --once
//  14. node ops-watcher/self-repair.mjs     --once   (bounded self-repair sweep)
//  15. node ops-watcher/directive-runner.mjs --once  (owner-directive plan + approval + execution)
//
// Step 5 (telegram-listener) is GATED: it only runs its one-shot getUpdates check
// when the persistent telegram-listener-daemon is NOT confirmed healthy. The
// daemon is now permanently managed by PM2 and holds the exclusive Telegram
// long-poll; the one-shot step's getUpdates races with the daemon's in-flight
// long-poll and has been observed to trigger a real HTTP 409 Conflict from
// Telegram. "Healthy" means ops-watcher/telegram-listener-daemon.lock exists,
// is readable JSON of the form {pid, startedAt}, and its recorded pid is alive
// according to isPidAliveReal — the same ground-truth signal steward.mjs uses.
// Missing lock, dead pid, unreadable JSON, or any thrown error reading the lock
// is treated as "not confirmed healthy" and the fallback check runs. We never
// silently skip when uncertain; the gate fails OPEN toward running the check,
// because the one-shot step's remaining job is real recovery when the daemon is
// actually down (e.g. PM2 down or the daemon crashed and has not restarted yet).
//
// Step 7 (added for the P0 canonical-AHMAD-auto-assign-and-heartbeat mission):
// wakes the real AHMAD orchestrator (headless `claude -p`, scoped via
// ops-watcher/ahmad-mcp-server.mjs) for any DIRECTIVE issue Paperclip already
// shows assigned to AHMAD but not yet dispatched. This single addition serves
// BOTH required wake paths without any other new spawn call: the FAST path is
// this same heartbeat.mjs already being spawned immediately by
// telegram-listener.mjs's pre-existing event-driven wake the moment a DIRECTIVE
// issue is created; the RECOVERY path is heartbeat-daemon.mjs's existing 5-min
// periodic re-run of this same file. See ahmad-dispatch.mjs's own header for
// why the dispatch is external (never Paperclip's native heartbeat engine) and
// how duplicate wake is prevented.
//
// Step 8 (STEWARD infra-drift watchdog): checks infra health itself — canonical
// Paperclip reachability, daemon lock-file pid-liveness, stale non-daemon lock
// scan, and a documented scheduled-task gap — and flags drift BEFORE it becomes
// an outage. Any CRITICAL finding spawns ONE bundled ahmad-notify message to the
// OWNER; zero criticals = zero spawns (no Telegram noise for warnings or
// all-clear). Duplicate-alert protection via a state file with a 1-hour re-alert
// cooldown. STEWARD has a dormant Paperclip identity (STEWARD-SJS) used purely
// for attribution, never invoked via Paperclip's own engine — same external
// dispatch pattern as GIBRAN/AHMAD. See steward.mjs's own header for full
// design. This step was added because today's incidents (wrong scheduled-task
// target, canonical Paperclip silently down, PM2 process issues) all traced to
// nothing watching infra itself.
//
// Step 9 (STEWARD-SJS venture-repo health watcher): a read-only git-state health
// watcher for ventures/sjs-superapps/. Checks branch, behind/ahead vs origin,
// dirty working tree, and recent commits — all via read-only git commands
// (fetch/status/rev-parse/rev-list/log, never pull/merge/push). Builds the
// sj-snapshot.md status-answer report (PROJECT, STATE, CANONICAL SOURCE, LAST
// VERIFIED, WHAT CHANGED, ACTIVE TASKS, BLOCKERS, SAFETY, OWNER DECISION
// NEEDED). Findings are WARNING/GAP today (behind-origin, dirty-tree, git
// failures) — no CRITICAL is produced by the real git checks, but the CRITICAL +
// alert path is wired and unit-tested so a future extension can elevate a
// finding without rewiring the alerting/dedup layer. Single-instance PID lock,
// 1-hour re-alert cooldown state file. See steward-sjs.mjs's own header.
//
// Step 10 (STEWARD-CAVEMAN read-only structural observer): a read-only observer
// of ventures/caveman-trading-os/. Checks repo reachability, git-state
// (fetch/status/behind), and safety-compliance — reads control/project-state.json
// and control/review-verdict.json for structural safety facts (architecture
// FROZEN, no live-trading capability gates opened, no real-capital authorised).
// A CRITICAL finding is produced if any safety gate is structurally opened
// (architecture not FROZEN, live_trading_allowed=true, etc.) and spawns ONE
// bundled ahmad-notify. This watcher NEVER imports Caveman runtime trading
// modules, broker adapters, execution services, risk ledgers, or any trading
// gateway — it only reads structural git/control-plane files and reports
// findings. Single-instance PID lock, 1-hour re-alert cooldown state file. See
// steward-caveman.mjs's own header for the full read-only safety contract.
//
// Step 14 (self-repair --once): the BOUNDED self-repair sweep. It runs the
// fault detector, then for at most one repairable fault per sweep delegates to
// the actuator's attemptRepair (snapshot/rollback + two-stage verification),
// escalating to the owner only when an attempt ended `reverted`. It self-skips
// for 30 minutes after each attempt-sweep (SCAN_MIN_INTERVAL_MS) and never
// dispatches more than one lane call per sweep (MAX_REPAIRS_PER_SWEEP), so it
// can never turn into the unbounded repair loop that burned the SJAHRIR quota.
// See ops-watcher/self-repair.mjs's header for the full bounds rationale. This
// step is the LAST step on purpose: it reads the durable step log written by the
// sweep above, so it must run after every other step has recorded its outcome.
//
// Step 15 (directive-runner --once): turns an owner directive into a plan,
// validates its scope, sends a Telegram decision card to the owner, and then
// waits for the owner's approval in Telegram before executing the approved plan
// inside the repo-only envelope (snapshot, two-stage verification, rollback).
// It self-throttles to at most one sweep per 15 minutes (SWEEP_MIN_INTERVAL_MS):
// a --once call inside that window returns { skipped: true } immediately without
// touching a lane, because planning and executing each directive cost a real
// lane call. See ops-watcher/directive-runner.mjs's own header for the full
// design.
//
// It does NOT modify, import, or reference the internals of those scripts. It
// only invokes them as child processes exactly the way a human would from the
// command line, capturing and relaying their real stdout / exit codes.
//
// Resilience contract: a failing or erroring step NEVER aborts the whole
// heartbeat. Each step is wrapped so an ENOENT (missing script), a crash, a
// non-zero exit, or a thrown error for one step is recorded and the sweep
// continues to the next step. After each step a compact real summary line is
// printed (step name, exit code, one-line result excerpt). After all fifteen a
// final summary is printed (how many succeeded / failed).
//
// Durable step log: after every sweep, exactly ONE JSON line is appended to
// ops-watcher/heartbeat-steps.jsonl describing the whole sweep (timestamps,
// counts, and a flat per-step record built by buildStepRecord). This gives the
// self-repair layer a machine-readable answer to "has step X failed on the last
// three cycles?" without scraping console text. The append is best-effort and
// never fails the sweep; the file is rotated (by byte size, keeping the last
// STEP_LOG_KEEP_LINES lines) before appending. The writer is injectable through
// runHeartbeatOnce's deps so tests never touch the real file.
//
// Bounded by design: no setInterval, no while(true), no loop. Whether this is
// invoked periodically by a human or by an external scheduler is an OWNER
// decision, not this script's. This script just does ONE sweep and exits.
//
// SCOPE GUARD: this heartbeat ONLY touches the safe, already-reviewed pipeline
// above. It explicitly does NOT touch, reference, or activate: SOEKARNO,
// CORLEONE, TRADING-QUANT, any TradingOS / real-money trading-execution path, or
// any KOL-LEGACY-TRADING-* issue. STEWARD-CAVEMAN (step 10) is activated ONLY as
// a read-only structural observer of the Caveman repo's git/control-plane state
// — it never imports Caveman runtime trading modules, broker adapters,
// execution services, risk ledgers, or any trading gateway (see
// steward-caveman.mjs's own header for the full read-only safety contract). It
// never reads Telegram/Paperclip credentials directly — it only invokes the
// existing scripts, which handle their own credentials internally.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireLock as acquireLockReal,
  releaseLock as releaseLockReal,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";
// checkPauseReal() calls these. They were used without being imported, so the
// real (uninjected) pause check threw ReferenceError, failed closed as designed,
// and halted every sweep for ~4 minutes on 2026-09-01. The tests never caught it
// because they inject `checkPause` and so never exercise checkPauseReal.
import { isPaused, readPause } from "./pause-gate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The child scripts expect to be run from the repo root (their own discovery
// and relative paths are resolved against the root). Spawn them with cwd = the
// repo root, exactly like a human typing `node ops-watcher/<script> ...` from the
// root.
const REPO_ROOT = path.resolve(__dirname, "..");

const NODE = process.execPath || "node";
// A hard cap so a misbehaving child step can never wedge the heartbeat
// indefinitely. Generous (10 min) because review-runner dispatches hermes which
// can take minutes; still bounded.
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

// The ground-truth lock file for the persistent PM2-managed Telegram listener
// daemon. Used by the step-5 gate so the one-shot getUpdates only runs when the
// daemon is not confirmed healthy.
const TELEGRAM_LISTENER_DAEMON_LOCK_FILE = path.join(__dirname, "telegram-listener-daemon.lock");
export const HEARTBEAT_LOCK_FILE = path.join(__dirname, "heartbeat.lock");

// ---- Durable step log (one JSON line per sweep) ----
// Appended after every sweep so the self-repair layer can answer "has step X
// failed on the last N cycles?" as DATA, not by scraping console text. Rotated
// by byte size before each append, keeping only the most recent lines. The
// append is best-effort and never fails the sweep.
export const STEP_LOG_FILE = path.join(__dirname, "heartbeat-steps.jsonl");
export const STEP_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const STEP_LOG_KEEP_LINES = 2000;
// Hard cap on the per-step excerpt stored in the durable record. Reuses the
// excerpt() collapsing behaviour but enforces a strict <=300-char bound so a
// record is always bounded (the per-step console line uses a looser 200-cap +
// marker that can exceed 300 once the marker is appended).
const STEP_RECORD_EXCERPT_MAX = 300;

// The fifteen steps, in order. Each entry: { name, argv }. argv is the full argv as
// a human would type after `node` (the script path relative to repo root + any
// flags). This is a literal, hand-maintained list of the safe pipeline — NOT
// derived from a directory scan, so a stray file can never sneak in.
export const STEPS = [
  { name: "watcher",           argv: ["ops-watcher/watcher.mjs", "--once"] },
  { name: "test-runner",       argv: ["ops-watcher/test-runner.mjs", "--once"] },
  { name: "review-runner",     argv: ["ops-watcher/review-runner.mjs", "--once"] },
  { name: "telegram-notify",   argv: ["ops-watcher/telegram-notify.mjs", "--once"] },
  { name: "telegram-listener", argv: ["ops-watcher/telegram-listener.mjs", "--once"] },
  { name: "cockpit-status",    argv: ["ops-watcher/cockpit-status.mjs", "--html", "ops-watcher/cockpit-snapshot.html"] },
  { name: "ahmad-dispatch",    argv: ["ops-watcher/ahmad-dispatch.mjs", "--once"] },
  { name: "steward",           argv: ["ops-watcher/steward.mjs", "--once"] },
  { name: "steward-sjs",       argv: ["ops-watcher/steward-sjs.mjs", "--once"] },
  { name: "steward-caveman",   argv: ["ops-watcher/steward-caveman.mjs", "--once"] },
  { name: "escalation-sec",    argv: ["ops-watcher/escalation-sec.mjs", "--once"] },
  { name: "gbrain-curator",    argv: ["ops-watcher/gbrain-curator.mjs", "--once"] },
  { name: "audit-clerk",       argv: ["ops-watcher/audit-clerk.mjs", "--once"] },
  { name: "self-repair",       argv: ["ops-watcher/self-repair.mjs", "--once"] },
  // Read-only. Exits 1 when the ledger's projection and the live board disagree,
  // so a drift shows up as a failed step instead of as a number nobody checked.
  // Sits before directive-runner on purpose: it reports on the state every other
  // step just finished writing, and the runner stays last.
  // Rebuilds the code graph only when enough time has passed AND the repo
  // actually moved — see graphify-refresh.mjs. Cheap when there is nothing to
  // do, and it runs before reconcile so the graph is current when anything
  // downstream asks it a structural question.
  { name: "graphify-refresh",  argv: ["ops-watcher/graphify-refresh.mjs", "--once"] },
  // Appends the events the board proves happened and the ledger never recorded,
  // through ops-watcher/ledger.mjs (the single writer). Until this step existed,
  // NOTHING had appended to state/ledger.jsonl since 2026-08-28 — the only
  // writer had ever been the one-shot scripts/migrate-to-ledger.mjs — so the
  // system's source of truth was a frozen snapshot and every card sent and
  // decision approved since then lived on the board and nowhere else.
  //
  // Sits BEFORE reconcile on purpose: reconcile compares the ledger's
  // projection against the live board, so it must run after the ledger has
  // caught up, or it reports a difference that the previous step was already
  // fixing.
  { name: "ledger-writer",     argv: ["ops-watcher/ledger-writer.mjs", "--once"] },
  { name: "reconcile",         argv: ["ops-watcher/reconcile.mjs", "--once"] },
  { name: "directive-runner",  argv: ["ops-watcher/directive-runner.mjs", "--once"] },
  { name: "merge-steward",     argv: ["ops-watcher/merge-steward.mjs", "--once", "--no-suite"] },
];

const iso = () => new Date().toISOString();

// One-line excerpt of a child's combined output, for the compact per-step line.
// Collapses all whitespace to single spaces and trims to a readable length.
function excerpt(text, max = 200) {
  const oneLine = String(text || "").replace(/\r?\n/g, " ⏎ ").replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max) + " …[truncated]";
}

// Excerpt for the durable per-step record. Reuses excerpt()'s collapsing
// behaviour (newlines -> " ⏎ ", whitespace collapse, trim) but enforces a HARD
// <=STEP_RECORD_EXCERPT_MAX bound on the stored string so the durable record is
// always bounded (excerpt() otherwise appends a " …[truncated]" marker that can
// push the result just over the cap).
function excerptForRecord(text) {
  const ex = excerpt(text, STEP_RECORD_EXCERPT_MAX);
  return ex.length <= STEP_RECORD_EXCERPT_MAX ? ex : ex.slice(0, STEP_RECORD_EXCERPT_MAX);
}

// Pure record builder. Returns a flat, JSON-safe object describing ONE step's
// outcome in a sweep. Never performs I/O and never throws — a thrown error here
// would be a bug, but the defensive try/catch guarantees the sweep is never
// endangered by record construction.
//
//   step            : the STEPS entry { name, argv }
//   res             : the runStep result { code, stdout, stderr, error, timedOut }
//   opts.okStep     : boolean — did this step count as success?
//   opts.skippedHealthy : boolean — was this step skipped because the persistent
//                     daemon was healthy (telegram-listener gate)?
//   opts.durationMs : number — wall-clock ms this step took
//   opts.now        : () => ms (default Date.now) — for the record timestamp
export function buildStepRecord(step, res, { okStep, skippedHealthy, durationMs, now = Date.now } = {}) {
  const safeRes = res || {};
  const stdout = safeRes.stdout || "";
  const stderr = safeRes.stderr || "";
  const combined = stdout + (stderr ? (stdout ? "\n" : "") + stderr : "");
  let ex = "";
  try {
    ex = excerptForRecord(combined);
  } catch {
    ex = "";
  }
  const code = safeRes.code;
  return {
    ts: now(),
    name: step && step.name,
    argv: Array.isArray(step && step.argv) ? step.argv.slice() : [],
    ok: !!okStep,
    exitCode: Number.isFinite(code) ? code : null,
    timedOut: !!safeRes.timedOut,
    skipped: !!skippedHealthy,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    excerpt: ex,
  };
}

// Rotate the durable step log BEFORE appending. If the file already exceeds
// STEP_LOG_MAX_BYTES, keep only the last STEP_LOG_KEEP_LINES lines (rewriting
// the file in place). Rotation is best-effort and non-fatal: any fs error
// (missing file, unreadable, unwritable) just returns — the caller's append is
// still attempted and itself wrapped in its own non-fatal try/catch.
//
// `file`, `maxBytes`, `keepLines`, and `_fs` are all injectable so the rotation
// can be exercised in tests against an in-memory fake fs without touching the
// real heartbeat-steps.jsonl.
export async function rotateStepLogFile({ file = STEP_LOG_FILE, maxBytes = STEP_LOG_MAX_BYTES, keepLines = STEP_LOG_KEEP_LINES, _fs = fs } = {}) {
  let stat;
  try {
    stat = await _fs.stat(file);
  } catch {
    // File does not exist (or stat failed) — nothing to rotate.
    return;
  }
  if (!stat || !(stat.size > maxBytes)) return;
  let text;
  try {
    text = await _fs.readFile(file, "utf8");
  } catch {
    return;
  }
  const all = text.split(/\r?\n/);
  // Drop a single trailing empty line produced by a final "\n" so the line
  // count is accurate.
  if (all.length && all[all.length - 1] === "") all.pop();
  const kept = all.slice(Math.max(0, all.length - keepLines));
  try {
    await _fs.writeFile(file, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  } catch {
    // Non-fatal: rotation write failed; the append will still be attempted.
  }
}

// Default real step-log writer. Rotates (if needed) then appends ONE JSON line
// describing the whole sweep. Injectable through runHeartbeatOnce's deps as
// `appendStepLog` (default: this) plus `stepLogFile`.
export async function appendStepLogReal(record, { file = STEP_LOG_FILE, _fs = fs } = {}) {
  await rotateStepLogFile({ file, _fs });
  await _fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
}

// Default real child-process runner. Spawns `node <argv...>` with cwd=REPO_ROOT.
// Never throws: spawn errors (ENOENT on node, missing script, etc.) are returned
// as { code: null, stdout, stderr, error }. Honors STEP_TIMEOUT_MS (on timeout
// the child is SIGTERM'd and the result reports timedOut:true, code:null). Both
// stdout and stderr are captured; they are returned separately but also combined
// for the excerpt.
//
// `code` is declared in the Promise executor's outer scope (alongside stdout,
// stderr, timedOut) so BOTH the 'error' handler (code stays null — the child
// never produced an exit code) and the 'close' handler (code = the real exit
// code) reference the SAME binding. This was a real ReferenceError: previously
// `code` only existed as a parameter inside the separate 'close' handler, so an
// actual spawn 'error' event (e.g. ENOENT — node itself not found, or a
// permissions failure) threw `ReferenceError: code is not defined` inside the
// error handler instead of resolving cleanly — defeating the whole point of
// that handler (never crash the sweep).
//
// This function is the seam used by the regression test: the test injects a
// fake runStep instead of spawning real processes, so the test is fully offline
// and touches no live Paperclip / Telegram / hermes. Additionally, `spawn`
// itself is injectable (defaults to the real node:child_process spawn) so a
// regression test can exercise runStepReal's real 'error'-event path without a
// real subprocess.
export function runStepReal(argv, { timeoutMs = STEP_TIMEOUT_MS, spawn: spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let code = null;
    let timedOut = false;
    let child;
    try {
      child = spawnFn(NODE, argv, {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: String(err && err.message), error: String(err && err.message) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      // E.g. ENOENT if `node` itself is not found, or the script file is missing.
      // `code` stays null here — the child never produced an exit code. The
      // outer-scope `code` binding is shared with the 'close' handler below.
      clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr + String(err && err.message), error: String(err && err.message) });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      code = exitCode;
      resolve({ code, stdout, stderr, timedOut, error: timedOut ? "timeout" : null });
    });
  });
}

// Step-5 gate: should the one-shot telegram-listener step run as a fallback?
// Returns true  -> run the one-shot getUpdates check (daemon not confirmed healthy).
// Returns false -> skip the step (persistent daemon lock exists and pid is alive).
//
// Injectable via { lockFile, isAlive, _fs } for tests. Any read/parse failure or
// malformed lock fails OPEN to true (run the check) — never silently skip.
export async function shouldRunTelegramListenerStepReal({ lockFile = TELEGRAM_LISTENER_DAEMON_LOCK_FILE, isAlive = isPidAliveReal, _fs = fs } = {}) {
  let holder;
  try {
    const raw = await _fs.readFile(lockFile, "utf8");
    holder = JSON.parse(raw);
  } catch {
    // Lock missing, unreadable, or not valid JSON -> not confirmed healthy.
    return true;
  }
  if (!holder || !Number.isFinite(holder.pid)) return true;
  // Alive pid means the persistent daemon is healthy; do NOT run the one-shot.
  return !isAlive(holder.pid);
}

function cleanPauseText(value, fallback = "") {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

function pauseStateFromCheckFailure(err) {
  const detail = err && err.message ? `: ${err.message}` : "";
  return {
    paused: true,
    reason: `Pause check failed closed${detail}`,
    atIso: null,
    by: null,
  };
}

function normalizePauseState(raw) {
  if (raw === true) {
    return { paused: true, reason: "Pause flag is set.", atIso: null, by: null };
  }
  if (!raw || raw === false || !raw.paused) {
    return { paused: false, reason: "", atIso: null, by: null };
  }
  return {
    paused: true,
    reason: cleanPauseText(raw.reason, "Pause flag is set."),
    atIso: cleanPauseText(raw.atIso) || null,
    by: cleanPauseText(raw.by) || null,
  };
}

export function checkPauseReal() {
  try {
    if (!isPaused()) return { paused: false, reason: "", atIso: null, by: null };
    return normalizePauseState({ ...readPause(), paused: true });
  } catch (err) {
    return pauseStateFromCheckFailure(err);
  }
}

async function getPauseState(checkPause) {
  try {
    return normalizePauseState(await checkPause());
  } catch (err) {
    return pauseStateFromCheckFailure(err);
  }
}

// Core sweep, dependency-injected for testability.
// deps: { runStep, steps, shouldRunTelegramListenerStep, checkPause, log, now,
//         appendStepLog, stepLogFile, lockFile, acquireLock, releaseLock,
//         isAlive, lockPid, _fs }
// runStep: async (argv) => { code, stdout, stderr, error, timedOut }
// shouldRunTelegramListenerStep: async () => boolean (true = run fallback)
// checkPause: async () => { paused, reason, atIso, by } | boolean
// appendStepLog: async (record, { file }) => void (default: appendStepLogReal)
// stepLogFile: path string for the durable step log (default: STEP_LOG_FILE)
// Returns { results, succeeded, failed, total, startedAt, finishedAt }.
export async function runHeartbeatOnce(deps = {}) {
  const {
    runStep = runStepReal,
    steps = STEPS,
    shouldRunTelegramListenerStep = shouldRunTelegramListenerStepReal,
    checkPause = checkPauseReal,
    log = (m) => console.log(m),
    now = Date.now,
    appendStepLog = appendStepLogReal,
    stepLogFile = STEP_LOG_FILE,
    lockFile = HEARTBEAT_LOCK_FILE,
    acquireLock: _acquireLock = acquireLockReal,
    releaseLock: _releaseLock = releaseLockReal,
    isAlive = isPidAliveReal,
    lockPid = process.pid,
    _fs = fs,
  } = deps;

  const startedAt = now();
  const pauseState = await getPauseState(checkPause);
  if (pauseState.paused) {
    const finishedAt = now();
    const pauseReason = pauseState.reason || "Pause flag is set.";
    const pauseAtIso = pauseState.atIso || null;
    const pauseBy = pauseState.by || null;
    log(`heartbeat --once PAUSED since ${pauseAtIso || "waktu tidak diketahui"} — reason: ${pauseReason}`);
    try {
      const sweepRecord = {
        ts: finishedAt,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        total: steps.length,
        succeeded: 0,
        failed: 0,
        paused: true,
        pauseReason,
        pauseAtIso,
        pauseBy,
        steps: [],
      };
      await appendStepLog(sweepRecord, { file: stepLogFile });
    } catch (err) {
      log(`heartbeat: WARN could not append step log (${err && (err.code || err.message) || String(err)})`);
    }
    return {
      results: [],
      succeeded: 0,
      failed: 0,
      total: steps.length,
      startedAt,
      finishedAt,
      paused: true,
      pauseReason,
      pauseAtIso,
      pauseBy,
    };
  }

  let lock;
  try {
    lock = await _acquireLock({ lockFile, pid: lockPid, isAlive, _fs });
  } catch (err) {
    const finishedAt = now();
    const msg = (err && err.stack) ? err.stack : String(err);
    log(`heartbeat --once: lock acquire threw (${msg}) -> refusing to run (no concurrent sweep on unknown lock state)`);
    return {
      results: [],
      succeeded: 0,
      failed: 0,
      total: steps.length,
      startedAt,
      finishedAt,
      refused: true,
      error: "lock-failed",
    };
  }
  if (!lock.acquired) {
    const finishedAt = now();
    log(`heartbeat --once: REFUSING to run — another sweep is in progress (pid=${lock.pid}). Remove ${path.basename(lockFile)} only if you are sure it is stale. No heartbeat steps ran.`);
    return {
      results: [],
      succeeded: 0,
      failed: 0,
      total: steps.length,
      startedAt,
      finishedAt,
      refused: true,
      pid: lock.pid,
    };
  }
  log(`heartbeat --once: acquired sweep lock (pid=${lock.pid}) at ${iso()}`);

  log(`heartbeat --once START ${new Date(startedAt).toISOString()} (${steps.length} steps)`);

  const results = [];
  // Per-step metadata kept in PARALLEL to results so the results array's shape
  // stays byte-for-byte identical to before (it never carried skipped/duration).
  const stepMeta = [];
  let succeeded = 0;
  let failed = 0;

  try {
    for (const step of steps) {
      let res;
      let skippedHealthy = false;
      const stepStart = now();
      try {
        if (step.name === "telegram-listener") {
          let shouldRun = true;
          try {
            shouldRun = await shouldRunTelegramListenerStep();
          } catch (err) {
            // Uncertain health state must fail OPEN to running the fallback check.
            log(`  [${step.name}] daemon-health check threw — ${excerpt(String(err && err.message || err))}`);
          }
          if (!shouldRun) {
            skippedHealthy = true;
            res = {
              code: null,
              stdout:
                "telegram-listener --once: SKIPPED-persistent-daemon-healthy " +
                "(lock + live pid) — one-shot getUpdates would race with the daemon's " +
                "long-poll and could cause a Telegram 409 Conflict\n",
              stderr: "",
              error: null,
              timedOut: false,
            };
          } else {
            res = await runStep(step.argv);
          }
        } else {
          res = await runStep(step.argv);
        }
      } catch (err) {
        // Defensive: even a throwing runStep must not abort the sweep.
        res = { code: null, stdout: "", stderr: String(err && err.stack || err), error: String(err && err.message || err) };
      }
      const stepEnd = now();
      const code = res.code;
      // A healthy-daemon skip is intentional and counts as success, not failure.
      const okStep = skippedHealthy || code === 0;
      if (okStep) succeeded += 1; else failed += 1;

      const combined = (res.stdout || "") + (res.stderr ? (res.stdout ? "\n" : "") + res.stderr : "");
      const tag = res.timedOut ? " (timeout)" : (res.error && code === null) ? " (error)" : "";
      log(`  [${step.name}] exit=${code === null ? "null" : code}${tag} ${okStep ? "OK" : "FAIL"} — ${excerpt(combined)}`);

      results.push({
        name: step.name,
        argv: step.argv,
        code,
        ok: okStep,
        timedOut: !!res.timedOut,
        error: res.error || null,
        stdout: res.stdout || "",
        stderr: res.stderr || "",
      });
      stepMeta.push({ skippedHealthy, durationMs: stepEnd - stepStart });
    }

    const finishedAt = now();
    log(`heartbeat --once DONE ${new Date(finishedAt).toISOString()} — succeeded=${succeeded}/${steps.length} failed=${failed}/${steps.length} (took ${Math.round((finishedAt - startedAt) / 1000)}s)`);

    // Durable, machine-readable record of every step's outcome. ONE JSON line per
    // sweep. Best-effort: a failure here MUST NEVER fail the sweep — the sweep's
    // return value and exit code are already determined by the steps above.
    try {
      const stepRecords = results.map((r, i) =>
        buildStepRecord(steps[i], { code: r.code, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut, error: r.error }, {
          okStep: r.ok,
          skippedHealthy: stepMeta[i].skippedHealthy,
          durationMs: stepMeta[i].durationMs,
          now,
        })
      );
      const sweepRecord = {
        ts: finishedAt,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        total: steps.length,
        succeeded,
        failed,
        steps: stepRecords,
      };
      await appendStepLog(sweepRecord, { file: stepLogFile });
    } catch (err) {
      log(`heartbeat: WARN could not append step log (${err && (err.code || err.message) || String(err)})`);
    }

    return { results, succeeded, failed, total: steps.length, startedAt, finishedAt };
  } finally {
    try {
      await _releaseLock({ lockFile, _fs });
      log(`heartbeat --once: released sweep lock (pid=${lock.pid})`);
    } catch (err) {
      log(`heartbeat --once: WARN lock release threw (${err && err.message}) — staleness check will recover on next start`);
    }
  }
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) if (argv[i] === "--once") out.once = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/heartbeat.mjs --once");
    process.exit(2);
  }
  const r = await runHeartbeatOnce();
  // Exit 0 if every step succeeded; non-zero if any failed. We still exit
  // non-zero (not a hard crash) so an external scheduler can detect a degraded
  // sweep — but we never abort mid-sweep (all 15 always run first).
  process.exit(r.failed === 0 ? 0 : 1);
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
    console.error("heartbeat fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

