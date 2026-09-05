// ops-watcher/steward.mjs — STEWARD infra-drift watchdog.
// The piece that watches infra itself. Today's incidents (wrong scheduled-task
// target, canonical Paperclip silently down, PM2 process issues) all traced to
// nothing watching infra health. STEWARD checks infra health and flags drift
// BEFORE it becomes an outage — the same "external observer" role the rest of
// ops-watcher plays for Paperclip issues, but turned on ops-watcher itself.
//
// WHY EXTERNAL (same pattern as GIBRAN/AHMAD):
// STEWARD uses the canonical OPS-WATCHER Paperclip identity (id
// 79060e98-c048-44fb-8c29-2dd3cf5868a6, name "OPS-WATCHER") PURELY for
// attribution in alert messages — never invoked via Paperclip's own inert
// heartbeat/adapter engine. This is the exact same "identity of record, not the
// execution path" pattern already established for GIBRAN (review-runner.mjs
// spawns `hermes` directly, never Paperclip's engine, even though GIBRAN has a
// claude_local-labeled Paperclip record) and for AHMAD (ahmad-dispatch.mjs
// spawns `claude -p` directly, never Paperclip's engine, even though AHMAD has a
// claude_local-labeled Paperclip record). STEWARD's identity is even more
// inert than those: it is never spawned or dispatched at all — it exists only
// so alert messages carry a traceable Paperclip-attributed identity the OWNER
// can look up.
//
// WHY THE IDENTITY CHANGED: steward.mjs was originally built with the
// STEWARD-SJS placeholder identity (id a55dbfd8-b828-4c86-9e97-3c9b478c3a9e)
// because SJS SuperApps was dormant. SJS SuperApps is now active in
// ventures/sjs-superapps/, so that placeholder identity must be freed for the
// real STEWARD-SJS venture-steward role. steward.mjs's actual checks (Paperclip
// reachability, daemon health, scheduled tasks, PM2 stale-code drift) align
// with the canonical OPS-WATCHER role, making 79060e98-... the correct
// identity-of-record.
//
// CRASH-PROOF: runStewardOnce never throws. Every check is independently
// try/caught so one failing check cannot silence the others. A lock-layer
// failure is a clean refusal (no false all-clear). The whole sweep is protected
// by a single-instance PID lock (reusing acquireLock/releaseLock/isPidAliveReal
// from telegram-listener-daemon.mjs) so two concurrent heartbeat.mjs-driven
// invocations cannot both run and double-alert.
//
// ALERTING: any CRITICAL finding spawns ONE
//   `node ops-watcher/ahmad-notify.mjs "<bundled summary text>"`
// child process (cwd=repo root, windowsHide:true) with ALL critical findings
// bundled into one message — never one message per finding. Zero criticals =
// zero spawns (no Telegram noise for warnings or all-clear). Warnings (stale
// non-daemon locks) and documented gaps (scheduled tasks) are recorded in the
// return value but never trigger an alert on their own.
//
// DUPLICATE-ALERT PROTECTION: a small state file (ops-watcher/steward-state.json,
// dependency-injected read/write, crash-proof) tracks last-alerted-at per
// check-key. Only alert if the finding is new, or the same finding has
// persisted past a 1-hour re-alert cooldown. A check's alerted-state is cleared
// once it is no longer critical, so it can alert immediately on a fresh
// recurrence.
//
// AUTO-RESTART: when a pm2-stale-code CRITICAL finding is detected, STEWARD
// doesn't just alert — it ACTS, calling `pm2 restart <appName>` itself so the
// stale code is fixed without a human having to read the alert and run the
// command manually (the 2026-09-01 incident: a real STEWARD alert fired for
// `heartbeat` running 12h+ stale code and sat unfixed until the orchestrator
// manually restarted it). A separate 5-minute cooldown per finding key (tracked
// in the same state file under a `restarts` key, distinct from the 1-hour
// `alerts` cooldown) prevents a restart loop if restarting doesn't actually fix
// the staleness. The finding's detail text is rewritten to report the OUTCOME
// (auto-restarted / failed / skipped) so the alert tells the owner what
// STEWARD DID, not just what it found.
//
//   node ops-watcher/steward.mjs --once

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { deliverAlert } from "./alert-delivery.mjs";
import { discoverPaperclipPort } from "./watcher.mjs";
import {
  acquireLock as acquireLockReal,
  releaseLock as releaseLockReal,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// STEWARD's canonical Paperclip identity — used PURELY for attribution in alert
// messages, never invoked via Paperclip's own engine (same pattern as
// GIBRAN/AHMAD's identity-of-record).
export const STEWARD_AGENT_ID = "79060e98-c048-44fb-8c29-2dd3cf5868a6";
const STEWARD_AGENT_NAME = "OPS-WATCHER";

const LOCK_FILE = path.join(__dirname, "steward.lock");
const STATE_FILE = path.join(__dirname, "steward-state.json");
const NODE = process.execPath || "node";
const COOLDOWN_MS = 60 * 60 * 1000; // 1-hour re-alert cooldown
const RESTART_COOLDOWN_MS = 5 * 60 * 1000; // 5-min auto-restart cooldown (prevents restart loops)

// Daemon locks whose holders must be alive at all times. This workspace's 3
// daemons (telegram-listener-daemon, heartbeat-daemon, and the PM2 resurrect
// task) are now PM2-managed; STEWARD has no pm2 CLI access, so lock-file +
// pid-liveness is the ground-truth signal it CAN observe directly.
const DAEMON_LOCKS = [
  "telegram-listener-daemon.lock",
  "heartbeat-daemon.lock",
];

// Non-daemon lock files that may go stale. A dead pid here is a WARNING (not
// critical): the owning script self-heals this on its own next run. These do
// NOT include the daemon locks (already covered in check 2) or steward's own
// lock (that would be self-referential — steward's own lock is always live
// while this sweep is running).
const STALE_LOCK_FILES = [
  "ahmad-dispatch.lock",
  "review-runner.lock",
  "test-runner.lock",
  "telegram-watchdog.lock",
];

const iso = () => new Date().toISOString();

// Default scheduled-task check: the ORIGINAL documented-gap fallback. Kept
// exported as a reference/fallback — runStewardOnce now defaults to the REAL
// checkScheduledTasksReal (which actually runs schtasks), but if schtasks is
// unavailable to STEWARD the real check itself falls back to returning this
// same GAP-severity shape (so a host without schtasks degrades to the
// documented gap, never a false all-clear). This function returns
// { checked:false, reason } with no `severity` field, which runStewardOnce's
// Check 3 treats as severity "GAP".
export function defaultCheckScheduledTasks() {
  return {
    checked: false,
    reason:
      "schtasks access not available to STEWARD; a human/AHMAD must verify " +
      "FounderOS-Aidit-Heartbeat/TelegramListener/Paperclip stay DISABLED and " +
      "FounderOS-Aidit-PM2-Resurrect stays ENABLED",
  };
}

// ====================================================================
// Scheduled-task check — REAL implementation (closes the DOCUMENTED GAP at
// defaultCheckScheduledTasks). Runs `schtasks /query /tn "<task>" /fo LIST`
// via spawn for PM2-Resurrect + the 3 legacy tasks, parses the "Status:" line,
// and returns:
//   { checked: true,  severity: null,       reason: "<ok summary>" }      // all good -> no finding (gap closed)
//   { checked: true,  severity: "CRITICAL", reason: "<problem>"" }         // PM2-Resurrect missing/disabled OR legacy re-enabled
//   { checked: false, severity: "GAP",      reason: "<why schtasks down>"" }// schtasks itself failed -> fall back to documented GAP
// Never throws. One failing per-task query never silences the others.
// ====================================================================
export const PM2_RESURRECT_TASK_NAMES = [
  "AiditOS-PM2-Resurrect",
  "FounderOS-Aidit-PM2-Resurrect",
];
const SCHTASKS_LEGACY_NAMES = [
  "FounderOS-Aidit-Heartbeat",
  "FounderOS-Aidit-TelegramListener",
  "FounderOS-Aidit-Paperclip",
];
const SCHTASKS_TIMEOUT_MS = 8000;

// Bounded spawn helper (a variant of the ahmad-context-retrieval.mjs
// boundedCall pattern, AbortController-free). Returns
// { code, stdout, stderr, timedOut }. Never throws — a spawn-level failure
// (ENOENT on the binary, etc.) resolves to { code:null, stderr:<err> } so the
// caller can distinguish "binary unavailable" from "task not found" (which is a
// real schtasks exit with a non-zero code, NOT code:null).
function boundedSpawn(bin, args, { cwd = REPO_ROOT, timeoutMs = 8000, shell = true } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell,
      });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: String((err && err.message) || err), timedOut: false });
      return;
    }
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const stopChild = () => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      try { child.stdout && child.stdout.destroy(); } catch { /* ignore */ }
      try { child.stderr && child.stderr.destroy(); } catch { /* ignore */ }
      try { child.unref(); } catch { /* ignore */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stopChild();
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) =>
      finish({ code: null, stdout, stderr: stderr + String((err && err.message) || err), timedOut }),
    );
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));
  });
}

// Parse every "Status:" line out of `schtasks /query /fo LIST` stdout. Returns
// an array of trimmed status strings (e.g. ["Ready"], or ["Disabled","Disabled"]
// for the duplicated-block quirk some Windows builds emit). Robust to that
// quirk: a re-enabled legacy task is detected iff ANY status line is not
// "Disabled", and PM2-Resurrect is enabled iff ANY status line is Ready/Running.
function parseSchtasksStatuses(stdout) {
  const out = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const m = line.match(/^\s*Status:\s*(.+?)\s*$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

// Real default for the per-task schtasks query. Injectable so tests never spawn.
export async function runSchtasksSpawn(taskName, { timeoutMs = SCHTASKS_TIMEOUT_MS } = {}) {
  return boundedSpawn("schtasks", ["/query", "/tn", taskName, "/fo", "LIST"], { timeoutMs });
}

export async function checkScheduledTasksReal({ runSchtasks = runSchtasksSpawn, timeoutMs = SCHTASKS_TIMEOUT_MS } = {}) {
  const names = [...PM2_RESURRECT_TASK_NAMES, ...SCHTASKS_LEGACY_NAMES];
  const results = {};
  for (const name of names) {
    try {
      results[name] = await runSchtasks(name, { timeoutMs });
    } catch (err) {
      // One query throwing must not silence the others. Record a synthetic
      // spawn-level failure so the logic below treats it as "unknown".
      results[name] = {
        code: null,
        stdout: "",
        stderr: String((err && err.message) || err),
        timedOut: false,
      };
    }
  }

  const resurrectResults = PM2_RESURRECT_TASK_NAMES.map((name) => ({
    name,
    result: results[name],
    statuses: parseSchtasksStatuses(results[name] && results[name].stdout),
  }));
  // schtasks binary itself unavailable (spawn-level failure, NOT a "task not
  // found" exit) -> fall back to the documented GAP, never a false all-clear.
  if (resurrectResults.every(({ result }) => result.code === null && !result.timedOut)) {
    return {
      checked: false,
      severity: "GAP",
      reason:
        `schtasks unavailable to STEWARD (${(resurrectResults[0].result.stderr || "spawn error").trim()}); ` +
        `a human/AHMAD must verify one of ${PM2_RESURRECT_TASK_NAMES.join(", ")} stays ENABLED and ` +
        `the legacy tasks (${SCHTASKS_LEGACY_NAMES.join(", ")}) stay DISABLED`,
    };
  }
  if (resurrectResults.every(({ result }) => result.timedOut)) {
    return {
      checked: false,
      severity: "GAP",
      reason: `schtasks /query timed out after ${timeoutMs}ms; a human/AHMAD must verify scheduled-task state`,
    };
  }

  // Any accepted PM2-Resurrect task name may be Ready/Running (enabled).
  // Missing all accepted names, or finding only disabled/non-Ready names, is
  // CRITICAL because PM2 auto-resurrect would not fire on reboot.
  const readyResurrect = resurrectResults.find(({ statuses }) =>
    statuses.some((s) => /^Ready$/i.test(s) || /^Running$/i.test(s)),
  );
  if (!readyResurrect) {
    return {
      checked: true,
      severity: "CRITICAL",
      reason:
        `No accepted PM2 resurrect scheduled task is Ready/enabled ` +
        `(looked for: ${PM2_RESURRECT_TASK_NAMES.join(", ")}; statuses: ` +
        `${resurrectResults.map(({ name, statuses }) => `${name}=${statuses.join(", ") || "none - task missing?"}`).join("; ")}) - ` +
        `PM2 auto-resurrect will not fire on reboot; re-enable via Task Scheduler`,
    };
  }

  // Legacy tasks must all be Disabled. A re-enabled legacy task races the PM2
  // daemon (exactly the Telegram 409 Conflict shape from the wrong-task incident
  // that motivated STEWARD). A missing/removed legacy task is SAFE (cannot
  // re-enable what does not exist) -> no finding.
  for (const name of SCHTASKS_LEGACY_NAMES) {
    const r = results[name];
    const statuses = parseSchtasksStatuses(r.stdout);
    const reEnabled = statuses.some((s) => !/^Disabled$/i.test(s));
    if (reEnabled) {
      return {
        checked: true,
        severity: "CRITICAL",
        reason:
          `Legacy scheduled task ${name} is re-enabled (statuses: ${statuses.join(", ")}) — ` +
          `it must stay DISABLED to avoid racing the PM2-managed daemon`,
      };
    }
  }

  return {
    checked: true,
    severity: null,
    reason:
      `${readyResurrect.name} Ready; legacy tasks ` +
      `(${SCHTASKS_LEGACY_NAMES.join(", ")}) all Disabled`,
  };
}

// ====================================================================
// PM2 stale-code drift check (the one that would have caught the 2026-08-29
// incident: heartbeat.mjs was edited on disk at 13:04 — a fix to
// shouldRunTelegramListenerStepReal — but the PM2 `heartbeat` process was NOT
// restarted, so it kept running the 02:45 in-memory code for 10+ hours. The
// one-shot telegram-listener step fired on every 5-minute heartbeat cycle,
// each racing the persistent daemon's long-poll and producing a live Telegram
// 409 Conflict. AHMAD found it by reading raw PM2 logs and comparing file mtime
// vs process start time by hand. This check automates that comparison.)
//
// Runs `pm2 jlist`, parses the JSON, and for each { pm2AppName, watchFiles }
// pair compares each watched file's mtime against that app's
// pm2_env.pm_uptime (process start, ms since epoch). mtime AFTER start =
// stale code -> CRITICAL. Returns an array of finding objects; never throws.
// Degrades to a single WARNING (never a false all-clear) if pm2 jlist is
// unavailable/times out. The watch-list is dependency-injected.
//
// Each CRITICAL finding includes a plain `pm2AppName` field so the auto-restart
// logic in runStewardOnce can restart the right app without re-parsing the
// colon-delimited key string.
// ====================================================================
const DEFAULT_PM2_WATCH_LIST = [
  { pm2AppName: "heartbeat", watchFiles: ["ops-watcher/heartbeat.mjs"] },
  { pm2AppName: "telegram-listener", watchFiles: ["ops-watcher/telegram-listener-daemon.mjs"] },
];
const PM2_JLIST_TIMEOUT_MS = 8000;
const PM2_RESTART_TIMEOUT_MS = 15000;

// Real default for `pm2 jlist`. Returns { ok, list, error, timedOut }. Injectable
// so tests never spawn pm2.
export async function runPm2JlistSpawn({ timeoutMs = PM2_JLIST_TIMEOUT_MS } = {}) {
  const r = await boundedSpawn("pm2", ["jlist"], { timeoutMs });
  if (r.timedOut) {
    return { ok: false, list: null, error: `pm2 jlist timed out after ${timeoutMs}ms`, timedOut: true };
  }
  if (r.code !== 0) {
    return {
      ok: false,
      list: null,
      error: (r.stderr && r.stderr.trim()) || `pm2 jlist exited with code ${r.code}`,
      timedOut: false,
    };
  }
  let list;
  try {
    list = JSON.parse(r.stdout);
  } catch (err) {
    return {
      ok: false,
      list: null,
      error: `pm2 jlist stdout was not valid JSON: ${(err && err.message) || err}`,
      timedOut: false,
    };
  }
  if (!Array.isArray(list)) {
    return { ok: false, list: null, error: "pm2 jlist stdout was not a JSON array", timedOut: false };
  }
  return { ok: true, list, error: null, timedOut: false };
}

// Real default for `pm2 restart <appName>`. Spawns via the SAME boundedSpawn
// helper used by runPm2JlistSpawn — identical timeout/never-throws discipline.
// Returns { ok, stdout, stderr, error, timedOut } (ok:true ONLY if exit code 0
// and not timed out). Never throws. Injectable so tests never spawn a real pm2.
export async function runPm2RestartReal(appName, { timeoutMs = PM2_RESTART_TIMEOUT_MS } = {}) {
  const r = await boundedSpawn("pm2", ["restart", appName], { timeoutMs });
  const timedOut = !!r.timedOut;
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";
  const ok = r.code === 0 && !timedOut;
  let error = null;
  if (timedOut) {
    error = `pm2 restart ${appName} timed out after ${timeoutMs}ms`;
  } else if (r.code !== 0) {
    error = (stderr && stderr.trim()) || `pm2 restart ${appName} exited with code ${r.code}`;
  }
  return { ok, stdout, stderr, error, timedOut };
}

// Real default for statting a watched file. Returns mtimeMs (number). Throws on
// a missing/unreadable file (caught by the caller, which skips that file
// silently rather than crashing the sweep).
async function defaultStatFile(repoRoot, relPath) {
  const full = path.resolve(repoRoot, relPath);
  const st = await fs.stat(full);
  return st.mtimeMs;
}

// Human-readable age of the process start relative to the file edit, e.g.
// "10h+" or "45min" — matches the incident-report phrasing ("10h+ earlier").
function describeStalenessAge(startedAtMs, mtimeMs) {
  const deltaMs = mtimeMs - startedAtMs;
  if (deltaMs < 60000) return "less than a minute";
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h+`;
}

export async function checkPm2StaleCodeReal({
  watchList = DEFAULT_PM2_WATCH_LIST,
  runPm2Jlist = runPm2JlistSpawn,
  statFile = defaultStatFile,
  repoRoot = REPO_ROOT,
  timeoutMs = PM2_JLIST_TIMEOUT_MS,
} = {}) {
  let jlist;
  try {
    jlist = await runPm2Jlist({ timeoutMs });
  } catch (err) {
    return [{
      key: "pm2-stale-code",
      check: "pm2-stale-code",
      severity: "WARNING",
      detail: `PM2 stale-code check could not run pm2 jlist: ${(err && err.message) || err}`,
    }];
  }
  if (!jlist || !jlist.ok || !Array.isArray(jlist.list)) {
    return [{
      key: "pm2-stale-code",
      check: "pm2-stale-code",
      severity: "WARNING",
      detail:
        `PM2 stale-code check degraded (pm2 jlist unavailable` +
        `${jlist && jlist.timedOut ? " — timed out" : ""}): ` +
        `${(jlist && jlist.error) || "unknown error"} — could not verify PM2 code freshness`,
    }];
  }

  const appsByName = new Map();
  for (const app of jlist.list) {
    if (app && app.name) appsByName.set(app.name, app);
  }

  const findings = [];
  for (const { pm2AppName, watchFiles } of watchList) {
    const app = appsByName.get(pm2AppName);
    if (!app) {
      // App not in the pm2 list — the daemon-health lock-file check already
      // covers "not running"; skip here to avoid duplicating that finding.
      continue;
    }
    const env = app.pm2_env || {};
    const startedAtMs =
      typeof env.pm_uptime === "number"
        ? env.pm_uptime
        : Number(env.pm_uptime);
    if (!Number.isFinite(startedAtMs)) {
      // No usable start timestamp — skip (cannot compare). Avoid noise.
      continue;
    }
    for (const relPath of watchFiles || []) {
      let mtimeMs;
      try {
        mtimeMs = await statFile(repoRoot, relPath);
      } catch {
        // stat failed (file missing/unreadable) — skip this file, don't crash.
        continue;
      }
      if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) continue;
      if (mtimeMs > startedAtMs) {
        findings.push({
          key: `pm2-stale-code:${pm2AppName}:${relPath}`,
          check: "pm2-stale-code",
          severity: "CRITICAL",
          pm2AppName,
          detail:
            `PM2 app '${pm2AppName}' is running stale code: ${relPath} was ` +
            `modified at ${new Date(mtimeMs).toISOString()} but the process ` +
            `started at ${new Date(startedAtMs).toISOString()} ` +
            `(${describeStalenessAge(startedAtMs, mtimeMs)} earlier) — ` +
            `restart required: pm2 restart ${pm2AppName}`,
        });
      }
    }
  }
  return findings;
}

// ---- State file read/write (crash-proof defaults, injectable for tests) ----
async function defaultReadState(stateFile) {
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.alerts
      ? parsed
      : { alerts: {} };
  } catch {
    return { alerts: {} };
  }
}

async function defaultWriteState(stateFile, state) {
  try {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // crash-proof: never throw on state write failure
  }
}

// ---- Read a lock file and return parsed JSON or null (never throws) ----
async function readLockFile(filePath, _fs) {
  try {
    const raw = await _fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---- Spawn ahmad-notify (real, detached, fire-and-forget). Injectable. ----
export function spawnNotifyReal(message) {
  const child = spawn(
    NODE,
    ["ops-watcher/ahmad-notify.mjs", message],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  return { pid: child.pid };
}

// ---- Build the bundled alert message for ahmad-notify ----
function buildAlertMessage(criticals, warnings, gaps) {
  const lines = [];
  lines.push(
    `Peringatan infra-drift STEWARD (atas nama ${STEWARD_AGENT_NAME}, ` +
    `Paperclip id ${STEWARD_AGENT_ID})`,
  );
  lines.push("");
  lines.push(`Temuan KRITIS (${criticals.length}):`);
  for (let i = 0; i < criticals.length; i++) {
    lines.push(`  ${i + 1}. [${criticals[i].key}] ${criticals[i].detail}`);
  }
  if (warnings.length > 0) {
    lines.push("");
    lines.push(
      `Peringatan (${warnings.length}, tidak menghambat — script terkait bisa pulih sendiri):`,
    );
    for (const w of warnings) {
      lines.push(`  - [${w.key}] ${w.detail}`);
    }
  }
  if (gaps.length > 0) {
    lines.push("");
    lines.push("Celah yang diketahui (perlu verifikasi manusia/AHMAD):");
    for (const g of gaps) {
      lines.push(`  - [${g.key}] ${g.detail}`);
    }
  }
  return lines.join("\n");
}

// ---- Core, dependency-injected sweep (crash-proof, never throws) ----
// deps: {
//   discoverPort, checkScheduledTasks, checkPm2StaleCode, pm2WatchList, repoRoot,
//   lockDir, daemonLocks, staleLocks,
//   isAlive, now, spawnNotify,
//   runPm2Restart,             // auto-restart seam for pm2-stale-code CRITICALs
//   stateFile, readState, writeState,
//   log,
//   lockFile, acquireLock, releaseLock, lockPid, _fs,
// }
//
// Returns {
//   findings: [...],          // all findings (CRITICAL + WARNING + GAP)
//   criticalCount, warningCount, gapCount,
//   alerted: bool,            // was an ahmad-notify spawned this run?
//   notifyPid: number|null,
//   suppressedCount: number,  // criticals suppressed by cooldown
//   refused: bool,            // single-instance lock refused
//   pid: number|undefined,    // holder pid when refused
// }
export async function runStewardOnce(deps) {
  const {
    discoverPort = discoverPaperclipPort,
    checkScheduledTasks = checkScheduledTasksReal,
    checkPm2StaleCode = checkPm2StaleCodeReal,
    pm2WatchList = DEFAULT_PM2_WATCH_LIST,
    repoRoot = REPO_ROOT,
    lockDir = __dirname,
    daemonLocks = DAEMON_LOCKS,
    staleLocks = STALE_LOCK_FILES,
    isAlive = isPidAliveReal,
    now = Date.now,
    spawnNotify = spawnNotifyReal,
    runPm2Restart = runPm2RestartReal,
    stateFile = STATE_FILE,
    readState = defaultReadState,
    writeState = defaultWriteState,
    log = (m) => console.log(m),
    lockFile = LOCK_FILE,
    acquireLock = acquireLockReal,
    releaseLock = releaseLockReal,
    lockPid = process.pid,
    _fs = fs,
  } = deps;

  const findings = [];

  // ---- Single-instance lock for the whole sweep ----
  let lock;
  try {
    lock = await acquireLock({ lockFile, pid: lockPid, isAlive, _fs });
  } catch (err) {
    const msg = err && err.stack ? err.stack : String(err);
    log(`steward: lock acquire threw (${msg}) -> refusing to run (no false all-clear on unknown lock state)`);
    return { findings, error: "lock-failed", refused: true };
  }
  if (!lock.acquired) {
    log(
      `steward: REFUSING to run — another STEWARD sweep is already in progress ` +
      `(pid=${lock.pid}). Remove ${path.basename(lockFile)} only if you are ` +
      `sure it is stale. No checks performed, no false all-clear.`,
    );
    return { findings, refused: true, pid: lock.pid };
  }
  log(`steward: acquired sweep lock (pid=${lock.pid}) at ${iso()}`);

  try {
    // ---- Check 1: Canonical Paperclip ----
    // discoverPaperclipPort probes candidate ports and validates the canonical
    // identity fingerprint. Null = the canonical instance is down OR a wrong
    // instance is running on a candidate port (the exact incident that caused
    // the wrong scheduled-task target today).
    //
    // Retry: pass { attempts: 3, retryDelayMs: 1500 } as the second argument so
    // a single transient 2s probe miss under heavy machine load is no longer
    // escalated straight to CRITICAL + owner alert (the false "Paperclip not
    // reachable" incident: the instance was UP and healthy the whole time, but
    // one 2s probe aborted under a CPU-heavy local embedding job). discoverPort
    // is the injectable seam; if the injected function ignores the second
    // argument (e.g. an async () => null test stub) nothing breaks. The finding
    // key/check stay exactly "paperclip-canonical" (the alert cooldown state
    // file keys off them); only the detail text changed to state the retries.
    try {
      const port = await discoverPort(undefined, { attempts: 3, retryDelayMs: 1500 });
      if (!port) {
        findings.push({
          key: "paperclip-canonical",
          check: "paperclip-canonical",
          severity: "CRITICAL",
          detail:
            "Instance Paperclip kanonik tidak dapat dijangkau di port kandidat manapun " +
            "setelah 3 percobaan (mati, atau instance yang salah sedang berjalan)",
        });
      }
    } catch (err) {
      findings.push({
        key: "paperclip-canonical",
        check: "paperclip-canonical",
        severity: "CRITICAL",
        detail: `Paperclip discovery threw: ${err && err.message || err} — treating as critical (unknown state)`,
      });
    }

    // ---- Check 2: Daemon health via lock files ----
    // For each daemon lock, read the file and check isPidAlive on its pid.
    // Missing file or dead pid = CRITICAL (the daemon is not running). This
    // workspace's daemons are PM2-managed; STEWARD has no pm2 CLI access, so
    // lock-file + pid-liveness is the ground-truth signal it CAN observe.
    for (const lockName of daemonLocks) {
      try {
        const lockPath = path.join(lockDir, lockName);
        const holder = await readLockFile(lockPath, _fs);
        if (!holder || !Number.isFinite(holder.pid)) {
          findings.push({
            key: `daemon-lock:${lockName}`,
            check: "daemon-health",
            severity: "CRITICAL",
            detail: `Daemon lock ${lockName} missing or unreadable — daemon not running or not yet started`,
          });
        } else if (!isAlive(holder.pid)) {
          findings.push({
            key: `daemon-lock:${lockName}`,
            check: "daemon-health",
            severity: "CRITICAL",
            detail: `Daemon lock ${lockName} has dead pid ${holder.pid} — daemon process is not running (crashed or killed)`,
          });
        }
        // else: live pid -> no finding (daemon is healthy)
      } catch (err) {
        findings.push({
          key: `daemon-lock:${lockName}`,
          check: "daemon-health",
          severity: "CRITICAL",
          detail: `Daemon lock ${lockName} check threw: ${err && err.message || err} — treating as critical (unknown state)`,
        });
      }
    }

    // ---- Check 3: Scheduled Task check ----
    // The default is now checkScheduledTasksReal (closes the documented gap by
    // actually running schtasks). It returns a `severity` field so a problem
    // (PM2-Resurrect missing/disabled, or a legacy task re-enabled) becomes a
    // CRITICAL finding, while a successful check (severity null) produces NO
    // finding (the gap is closed). If schtasks itself is unavailable, the real
    // check returns { checked:false, severity:"GAP" } and we fall back to the
    // same documented-gap behavior the original default provided. The original
    // defaultCheckScheduledTasks (no severity field, checked:false) is still
    // honored here as a GAP. Never produces a false all-clear.
    try {
      const taskResult = await checkScheduledTasks();
      const sev = taskResult.severity || (!taskResult.checked ? "GAP" : null);
      if (sev === "CRITICAL") {
        findings.push({
          key: "scheduled-tasks",
          check: "scheduled-tasks",
          severity: "CRITICAL",
          detail: taskResult.reason,
          checked: !!taskResult.checked,
        });
      } else if (sev === "GAP") {
        findings.push({
          key: "scheduled-tasks",
          check: "scheduled-tasks",
          severity: "GAP",
          detail: taskResult.reason || (taskResult.checked ? "scheduled tasks checked OK" : "scheduled tasks not checked"),
          checked: !!taskResult.checked,
        });
      }
      // else: sev === null -> checked OK, the documented gap is closed -> no finding
    } catch (err) {
      findings.push({
        key: "scheduled-tasks",
        check: "scheduled-tasks",
        severity: "GAP",
        detail: `Scheduled task check threw: ${err && err.message || err}`,
        checked: false,
      });
    }

    // ---- Check 4: Stale lock scan (WARNING, not critical) ----
    // For non-daemon lock files: if present with a dead pid, emit a WARNING.
    // The owning script self-heals this on its own next run, so this is not
    // critical — but it is useful drift signal. NOT the daemon locks (already
    // covered in check 2) and NOT steward's own lock (always live during this
    // sweep).
    for (const lockName of staleLocks) {
      try {
        const lockPath = path.join(lockDir, lockName);
        const holder = await readLockFile(lockPath, _fs);
        if (holder && Number.isFinite(holder.pid) && !isAlive(holder.pid)) {
          findings.push({
            key: `stale-lock:${lockName}`,
            check: "stale-lock-scan",
            severity: "WARNING",
            detail: `Stale lock ${lockName} has dead pid ${holder.pid} — owning script will self-heal on its next run`,
          });
        }
        // else: not present (normal) or live pid (running) -> no finding
      } catch (err) {
        // A read error on a non-daemon lock is not critical; just log it.
        log(`steward: stale lock scan for ${lockName} threw: ${err && err.message}`);
      }
    }

    // ---- Check 5: PM2 stale-code drift (file mtime vs process start) ----
    // Catches the 2026-08-29 incident: heartbeat.mjs edited on disk but the PM2
    // process never restarted, so it kept running stale code that produced a
    // live Telegram 409 Conflict for 10+ hours. Compares each watched file's
    // mtime against the PM2 app's pm_uptime; mtime AFTER start = stale code ->
    // CRITICAL. Crash-proof + bounded: the real default never throws and
    // degrades to a WARNING if pm2 jlist is unavailable; this try/catch is
    // defense-in-depth so a thrown check can never silence the others.
    //
    // AUTO-RESTART: for each CRITICAL pm2-stale-code finding, STEWARD calls
    // `pm2 restart <appName>` itself (via the injectable runPm2Restart seam) so
    // the stale code is fixed without a human reading the alert and running
    // the command by hand. A 5-minute per-finding-key cooldown (tracked in the
    // same state file under a `restarts` key, separate from the 1-hour `alerts`
    // cooldown) prevents a restart loop if restarting doesn't actually fix the
    // staleness. The finding's detail text is rewritten to report the OUTCOME
    // (auto-restarted / failed / skipped) so the alert says what STEWARD DID,
    // not just what it found. Every finding is handled independently.
    try {
      const staleFindings = await checkPm2StaleCode({
        watchList: pm2WatchList,
        repoRoot,
      });
      if (Array.isArray(staleFindings)) {
        for (const f of staleFindings) {
          let detail = f.detail || "PM2 stale-code finding (no detail)";

          // ---- Auto-restart CRITICAL pm2-stale-code findings ----
          if (f.check === "pm2-stale-code" && f.severity === "CRITICAL") {
            try {
              // Extract the pm2 app name — prefer the plain pm2AppName field
              // on the finding (set by checkPm2StaleCodeReal); fall back to
              // parsing the colon-delimited key for findings from other sources.
              let pm2AppName = f.pm2AppName;
              if (!pm2AppName && f.key) {
                const m = f.key.match(/^pm2-stale-code:([^:]+):/);
                if (m) pm2AppName = m[1];
              }

              if (pm2AppName) {
                // Read the state file to check the 5-minute restart cooldown.
                // This is the SAME state file/mechanism as the 1-hour alert
                // cooldown, but a SEPARATE `restarts` key so the two purposes
                // are never conflated.
                let rState;
                try {
                  rState = await readState(stateFile);
                } catch {
                  rState = { alerts: {} };
                }
                if (!rState.restarts) rState.restarts = {};
                const restarts = rState.restarts;
                const prevAttempt = restarts[f.key];
                const attemptAgeMs =
                  now() - ((prevAttempt && prevAttempt.restartAttemptedAt) || 0);

                if (prevAttempt && attemptAgeMs < RESTART_COOLDOWN_MS) {
                  // Recently attempted — skip to avoid a restart loop. Keep
                  // the original "restart required" wording and append why the
                  // auto-restart didn't happen. The appended text is STATIC
                  // (no changing "N minutes ago" number) so repeated
                  // cooldown-skip sweeps produce the SAME detail text and
                  // are suppressed by the 1-hour alert re-alert cooldown
                  // (not re-alerted every sweep).
                  detail =
                    detail +
                    " — auto-restart already attempted recently, skipping " +
                    "to avoid a restart loop — manual investigation needed " +
                    "if this persists";
                } else {
                  // Not recently attempted — call runPm2Restart. Wrap the
                  // call itself in try/catch so a throw is recorded as a
                  // failure (with the cooldown still applying) rather than
                  // crashing the sweep.
                  let restartResult;
                  try {
                    restartResult = await runPm2Restart(pm2AppName);
                  } catch (restartCallErr) {
                    restartResult = {
                      ok: false,
                      stdout: "",
                      stderr: "",
                      error: `runPm2Restart threw: ${(restartCallErr && restartCallErr.message) || restartCallErr}`,
                      timedOut: false,
                    };
                  }

                  // Record the attempt REGARDLESS of success/failure so the
                  // 5-minute cooldown applies either way (prevents hammering
                  // pm2 if it keeps failing).
                  restarts[f.key] = { restartAttemptedAt: now() };
                  try {
                    await writeState(stateFile, {
                      alerts: rState.alerts || {},
                      restarts,
                    });
                  } catch (stateErr) {
                    log(`steward: restart-state write threw (${stateErr && stateErr.message}) — cooldown may not apply on next run`);
                  }

                  if (restartResult && restartResult.ok) {
                    // Success: REPLACE the "restart required" wording with
                    // what STEWARD actually did. Keep severity CRITICAL so the
                    // owner is still informed something needed fixing (now
                    // framed as "handled", not "needs your action").
                    detail = detail.replace(
                      /restart required: pm2 restart \S+$/,
                      `auto-restarted by STEWARD (pm2 restart ${pm2AppName} succeeded) — will re-verify fresh on next sweep`,
                    );
                  } else {
                    // Failure: KEEP the original "restart required" wording
                    // (owner still needs to act) and APPEND why the
                    // auto-restart didn't work.
                    const errTxt =
                      (restartResult &&
                        ((restartResult.error && String(restartResult.error).trim()) ||
                          (restartResult.stderr && String(restartResult.stderr).trim()))) ||
                      "unknown error";
                    detail =
                      detail +
                      ` — auto-restart attempt failed: ${errTxt}`;
                  }
                }
              }
            } catch (restartErr) {
              // One finding's restart logic throwing must never silence the
              // others or crash the sweep. The finding is still pushed below
              // with its original (unmodified) detail.
              log(`steward: pm2 auto-restart logic threw for ${f.key}: ${(restartErr && restartErr.message) || restartErr}`);
            }
          }

          findings.push({
            key: f.key || "pm2-stale-code",
            check: f.check || "pm2-stale-code",
            severity: f.severity || "WARNING",
            detail,
            pm2AppName: f.pm2AppName,
          });
        }
      }
    } catch (err) {
      findings.push({
        key: "pm2-stale-code",
        check: "pm2-stale-code",
        severity: "WARNING",
        detail: `PM2 stale-code check threw: ${err && err.message || err} — could not verify PM2 code freshness`,
      });
    }

    // ---- Summary counts ----
    const criticals = findings.filter((f) => f.severity === "CRITICAL");
    const warnings = findings.filter((f) => f.severity === "WARNING");
    const gaps = findings.filter((f) => f.severity === "GAP");
    log(`steward: ${criticals.length} critical, ${warnings.length} warning, ${gaps.length} gap`);

    // ---- Duplicate-alert protection (state file) ----
    let state;
    try {
      state = await readState(stateFile);
    } catch {
      state = { alerts: {} };
    }
    if (!state || !state.alerts) state = { alerts: {} };
    const alerts = state.alerts || {};

    // Determine which criticals should be alerted this run (dedupe + cooldown).
    const toAlert = [];
    for (const f of criticals) {
      const prev = alerts[f.key];
      if (!prev || prev.finding !== f.detail) {
        // New finding (or first-ever) -> alert immediately.
        toAlert.push(f);
      } else if (now() - (prev.lastAlertedAt || 0) >= COOLDOWN_MS) {
        // Same finding, past the 1-hour re-alert cooldown -> alert again.
        toAlert.push(f);
      }
      // else: same finding within cooldown -> suppressed.
    }

    // ---- Alerting: ONE bundled ahmad-notify spawn if any criticals to alert ----
    // The alert is attempted BEFORE the cooldown is stamped, and the spawn's
    // own result decides whether it went out. spawnNotify reports a failed
    // spawn by RETURN VALUE ({ pid: undefined }, or { pid: null, error }), not
    // by throwing, so the try/catch that used to guard this caught nothing and
    // the `notified = true` beneath it claimed a delivery nobody checked. That
    // claim then stamped a 1-hour cooldown, so the first failed alert silenced
    // the finding for an hour instead of retrying on the next sweep.
    let notified = false;
    let notifyPid = null;
    if (toAlert.length > 0) {
      const message = buildAlertMessage(toAlert, warnings, gaps);
      const delivery = await deliverAlert(() => spawnNotify(message));
      notified = delivery.delivered;
      notifyPid = delivery.pid ?? null;
      if (notified) {
        log(`steward: spawned ahmad-notify (pid=${notifyPid}) with ${toAlert.length} critical finding(s)`);
      } else {
        log(`steward: ahmad-notify spawn FAILED (${delivery.reason}) — critical findings not relayed, cooldown not advanced`);
      }
    } else {
      log(
        criticals.length > 0
          ? `steward: ${criticals.length} critical finding(s) suppressed (within ${COOLDOWN_MS / 60000}min re-alert cooldown)`
          : `steward: no critical findings — no alert spawned`,
      );
    }

    // Build new state: keep only currently-critical keys. Keys no longer
    // critical are dropped -> their alerted-state is cleared, so a fresh
    // recurrence alerts immediately (not after a cooldown wait). The `restarts`
    // key (written by the auto-restart logic in Check 5) is PRESERVED here so
    // the 5-minute restart cooldown survives the alert-cooldown write — the
    // two purposes use separate keys and must not clobber each other.
    //
    // Only a finding that actually went out advances its cooldown. One that did
    // not keeps its previous stamp, so the next sweep tries again.
    const newAlerts = {};
    for (const f of criticals) {
      const prev = alerts[f.key];
      if (notified && toAlert.includes(f)) {
        newAlerts[f.key] = { lastAlertedAt: now(), finding: f.detail };
      } else if (prev) {
        // Suppressed this run, or attempted and not delivered — keep the
        // previous record so the cooldown counts from the last real alert.
        newAlerts[f.key] = prev;
      }
    }
    const newState = { alerts: newAlerts, restarts: state.restarts || {} };
    try {
      await writeState(stateFile, newState);
    } catch (err) {
      log(`steward: state write threw (${err && err.message}) — dedupe may repeat on next run`);
    }

    return {
      findings,
      criticalCount: criticals.length,
      warningCount: warnings.length,
      gapCount: gaps.length,
      alerted: notified,
      notifyPid,
      suppressedCount: criticals.length - toAlert.length,
    };
  } finally {
    // Always release the lock — on success, on an early return, and on a
    // thrown error — so a crash here never permanently wedges the steward lane.
    try {
      await releaseLock({ lockFile, _fs });
      log(`steward: released sweep lock (pid=${lock.pid})`);
    } catch (err) {
      log(`steward: WARN lock release threw (${err && err.message}) — staleness check will recover on next start`);
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
    console.error("usage: node ops-watcher/steward.mjs --once");
    process.exit(2);
  }
  const r = await runStewardOnce({ log: (m) => console.log(m) });
  if (r.refused) {
    console.log(`steward --once: refused — another sweep is running (pid=${r.pid})`);
    process.exit(0);
  }
  console.log(
    `steward --once: ${r.criticalCount} critical, ${r.warningCount} warning, ` +
    `${r.gapCount} gap, alerted=${r.alerted}, suppressed=${r.suppressedCount}`,
  );
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
    console.error("steward fatal:", err && err.stack ? err.stack : err);
    // Best-effort lock cleanup on fatal crash (the staleness check would also
    // recover this, but cleaning up is polite — mirrors the other daemons).
    fs.unlink(LOCK_FILE).catch(() => {});
    process.exit(1);
  });
}
