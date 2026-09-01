// ops-watcher/steward-caveman.mjs - STEWARD-CAVEMAN local repo watcher.
//
// Read-only Caveman observer. This file never imports Caveman runtime modules,
// broker adapters, execution services, risk ledgers, or any trading gateway. It
// only reads the migrated local repository's git/control-plane state and
// reports structural findings. The only files this watcher writes are its own
// ops-watcher lock/state files for single-instance execution and alert cooldown.
//
//   node ops-watcher/steward-caveman.mjs --once

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  acquireLock as acquireLockReal,
  releaseLock as releaseLockReal,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CAVEMAN_REPO_ROOT = path.join(REPO_ROOT, "ventures", "caveman-trading-os");

export const STEWARD_CAVEMAN_AGENT_ID = "516fd58f-24e6-4d8f-8234-34df848e2352";
const STEWARD_CAVEMAN_AGENT_NAME = "STEWARD-CAVEMAN";

const LOCK_FILE = path.join(__dirname, "steward-caveman.lock");
const STATE_FILE = path.join(__dirname, "steward-caveman-state.json");
const NODE = process.execPath || "node";
const COOLDOWN_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;

const PROJECT_STATE = "control/project-state.json";
const REVIEW_VERDICT = "control/review-verdict.json";
const README = "README.md";

const iso = () => new Date().toISOString();

function compact(s, n = 500) {
  const oneLine = String(s || "").replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n - 3).trimEnd() + "..." : oneLine;
}

async function boundedCall(label, fn, timeoutMs = DEFAULT_TIMEOUT_MS, ctrl = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      try { ctrl?.abort?.(); } catch { /* ignore */ }
      resolve({
        ok: false,
        timedOut: true,
        value: null,
        error: `${label} timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      timeout,
    ]);
    clearTimeout(timer);
    if (value && value.ok === false && value.timedOut) return value;
    return { ok: true, timedOut: false, value, error: null };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      timedOut: false,
      value: null,
      error: `${label} failed: ${err && err.message ? err.message : err}`,
    };
  }
}

export function boundedSpawn(bin, args, {
  cwd = REPO_ROOT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
} = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        env: { ...env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: String(err && err.message ? err.message : err), timedOut: false });
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
    child.on("error", (err) => {
      finish({ code: null, stdout, stderr: stderr + String(err && err.message ? err.message : err), timedOut });
    });
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));
  });
}

export async function runGitReal(args, { repoRoot = CAVEMAN_REPO_ROOT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return boundedSpawn("git", args, { cwd: repoRoot, timeoutMs });
}

async function readTextFileReal(relPath, {
  repoRoot = CAVEMAN_REPO_ROOT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  _fs = fs,
} = {}) {
  const full = path.join(repoRoot, relPath);
  return boundedCall(`${relPath} read`, () => _fs.readFile(full, "utf8"), timeoutMs);
}

async function statPathReal(relPath, {
  repoRoot = CAVEMAN_REPO_ROOT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  _fs = fs,
} = {}) {
  const full = path.join(repoRoot, relPath);
  return boundedCall(`${relPath || "."} stat`, () => _fs.stat(full), timeoutMs);
}

async function readJsonFile(relPath, deps) {
  const r = await deps.readTextFile(relPath, deps);
  if (!r.ok) return { ok: false, error: r.error, timedOut: r.timedOut, value: null };
  try {
    return { ok: true, error: null, timedOut: false, value: JSON.parse(r.value) };
  } catch (err) {
    return {
      ok: false,
      error: `${relPath} is not valid JSON: ${err && err.message ? err.message : err}`,
      timedOut: false,
      value: null,
    };
  }
}

function gitFailureFinding(key, command, result) {
  const why = result && result.timedOut
    ? `${command} timed out`
    : compact((result && result.stderr) || `${command} exited ${result && result.code}`);
  return {
    key,
    check: "git-state",
    severity: "GAP",
    detail: `Caveman git state check could not complete ${command}: ${why}`,
  };
}

export async function checkRepoReachabilityReal({
  repoRoot = CAVEMAN_REPO_ROOT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  statPath = statPathReal,
  readTextFile = readTextFileReal,
  _fs = fs,
} = {}) {
  const findings = [];
  const deps = { repoRoot, timeoutMs, _fs, readTextFile, statPath };
  const st = await statPath("", deps);
  if (!st.ok) {
    findings.push({
      key: "caveman-repo-reachability",
      check: "repo-reachability",
      severity: "GAP",
      detail: `Caveman repo is unreachable at ${repoRoot}: ${st.error}`,
    });
    return { reachable: false, findings };
  }
  const readme = await readTextFile(README, deps);
  if (!readme.ok) {
    findings.push({
      key: "caveman-repo-readme",
      check: "repo-reachability",
      severity: "GAP",
      detail: `Caveman README is unreadable at ${README}: ${readme.error}`,
    });
    return { reachable: false, findings };
  }
  return { reachable: true, findings };
}

export async function checkGitStateReal({
  repoRoot = CAVEMAN_REPO_ROOT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  runGit = runGitReal,
} = {}) {
  const findings = [];
  let fetched = false;

  try {
    const fetch = await runGit(["fetch", "origin"], { repoRoot, timeoutMs });
    if (!fetch || fetch.timedOut || fetch.code !== 0) {
      findings.push(gitFailureFinding("git-fetch-origin", "git fetch origin", fetch || {}));
    } else {
      fetched = true;
    }
  } catch (err) {
    findings.push({
      key: "git-fetch-origin",
      check: "git-state",
      severity: "GAP",
      detail: `Caveman git state check threw during git fetch origin: ${err && err.message ? err.message : err}`,
    });
  }

  try {
    const status = await runGit(["status", "--porcelain"], { repoRoot, timeoutMs });
    if (!status || status.timedOut || status.code !== 0) {
      findings.push(gitFailureFinding("git-status", "git status --porcelain", status || {}));
    } else if (String(status.stdout || "").trim()) {
      const dirtyLines = String(status.stdout || "").split(/\r?\n/).filter(Boolean).length;
      findings.push({
        key: "git-dirty-tree",
        check: "git-state",
        severity: "WARNING",
        detail: `Caveman working tree is dirty (${dirtyLines} porcelain line(s)); source: git status --porcelain`,
      });
    }
  } catch (err) {
    findings.push({
      key: "git-status",
      check: "git-state",
      severity: "GAP",
      detail: `Caveman git state check threw during git status --porcelain: ${err && err.message ? err.message : err}`,
    });
  }

  if (!fetched) return findings;

  try {
    const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], { repoRoot, timeoutMs });
    if (!branch || branch.timedOut || branch.code !== 0 || !String(branch.stdout || "").trim()) {
      findings.push(gitFailureFinding("git-current-branch", "git symbolic-ref --quiet --short HEAD", branch || {}));
      return findings;
    }
    const branchName = String(branch.stdout || "").trim();
    const remoteRef = `origin/${branchName}`;
    const counts = await runGit(["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`], { repoRoot, timeoutMs });
    if (!counts || counts.timedOut || counts.code !== 0) {
      findings.push(gitFailureFinding("git-ahead-behind", `git rev-list --left-right --count HEAD...${remoteRef}`, counts || {}));
      return findings;
    }
    const [aheadRaw, behindRaw] = String(counts.stdout || "").trim().split(/\s+/);
    const ahead = Number(aheadRaw);
    const behind = Number(behindRaw);
    if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
      findings.push({
        key: "git-ahead-behind",
        check: "git-state",
        severity: "GAP",
        detail: `Caveman git ahead/behind output was not parseable; source: git rev-list --left-right --count HEAD...${remoteRef}`,
      });
      return findings;
    }
    if (behind > 0) {
      findings.push({
        key: "git-behind-origin",
        check: "git-state",
        severity: "WARNING",
        detail: `Caveman local branch ${branchName} is ${behind} commit(s) behind ${remoteRef} (ahead ${ahead}); source: git fetch origin + git rev-list --left-right --count HEAD...${remoteRef}`,
      });
    }
  } catch (err) {
    findings.push({
      key: "git-ahead-behind",
      check: "git-state",
      severity: "GAP",
      detail: `Caveman git ahead/behind check threw: ${err && err.message ? err.message : err}`,
    });
  }

  return findings;
}

function fact(source, field, value) {
  return { source, field, value };
}

function structuralStateFrom({ projectState, reviewVerdict, readmeAvailable }) {
  const phase = projectState?.phase?.current;
  const reviewedAt = reviewVerdict?.reviewer?.reviewed_at;
  return {
    instrument: fact(
      README,
      "README Phase 1 status",
      readmeAvailable ? "UNREACHABLE: no live trading state source in this repo" : "UNREACHABLE: README could not be read",
    ),
    direction: fact(
      README,
      "README Phase 1 status",
      readmeAvailable ? "UNREACHABLE: no live trading state source in this repo" : "UNREACHABLE: README could not be read",
    ),
    status: fact(
      PROJECT_STATE,
      "phase.current",
      phase == null ? "UNKNOWN" : String(phase),
    ),
    lastUpdated: fact(
      REVIEW_VERDICT,
      "reviewer.reviewed_at",
      reviewedAt == null ? "UNKNOWN" : String(reviewedAt),
    ),
  };
}

function addCriticalIfTrue(findings, key, source, field, value) {
  if (value === true) {
    findings.push({
      key,
      check: "safety-compliance",
      severity: "CRITICAL",
      detail: `${source}#/${field} is true; structural fact indicates live/real-capital trading capability is enabled`,
    });
  }
}

export async function checkSafetyComplianceReal({
  repoRoot = CAVEMAN_REPO_ROOT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  readTextFile = readTextFileReal,
  _fs = fs,
} = {}) {
  const deps = { repoRoot, timeoutMs, _fs, readTextFile };
  const findings = [];
  const project = await readJsonFile(PROJECT_STATE, deps);
  const review = await readJsonFile(REVIEW_VERDICT, deps);
  const readme = await readTextFile(README, deps);

  if (!project.ok) {
    findings.push({
      key: "control-project-state-read",
      check: "safety-compliance",
      severity: "GAP",
      detail: `Could not read ${PROJECT_STATE}; Caveman trading state is unreachable: ${project.error}`,
    });
  }
  if (!review.ok) {
    findings.push({
      key: "control-review-verdict-read",
      check: "safety-compliance",
      severity: "GAP",
      detail: `Could not read ${REVIEW_VERDICT}; Caveman review state is unreachable: ${review.error}`,
    });
  }
  if (!readme.ok) {
    findings.push({
      key: "caveman-readme-read",
      check: "safety-compliance",
      severity: "GAP",
      detail: `Could not read ${README}; Caveman Phase-1 status is unreachable: ${readme.error}`,
    });
  }

  const projectState = project.ok ? project.value : null;
  const reviewVerdict = review.ok ? review.value : null;

  const architectureStatus = projectState?.architecture?.status;
  if (architectureStatus != null && String(architectureStatus) !== "FROZEN") {
    findings.push({
      key: "architecture-status-not-frozen",
      check: "safety-compliance",
      severity: "CRITICAL",
      detail: `${PROJECT_STATE}#/architecture/status is ${JSON.stringify(architectureStatus)}; structural fact no longer says FROZEN`,
    });
  }

  addCriticalIfTrue(
    findings,
    "live-trading-allowed",
    PROJECT_STATE,
    "capability_gates/live_trading_allowed",
    projectState?.capability_gates?.live_trading_allowed,
  );
  addCriticalIfTrue(
    findings,
    "micro-live-allowed",
    PROJECT_STATE,
    "capability_gates/micro_live_allowed",
    projectState?.capability_gates?.micro_live_allowed,
  );
  addCriticalIfTrue(
    findings,
    "live-capital-authorised",
    PROJECT_STATE,
    "owner_decisions/operating_scope/live_capital_authorised",
    projectState?.owner_decisions?.operating_scope?.live_capital_authorised,
  );
  addCriticalIfTrue(
    findings,
    "capability-gate-opened-by-review",
    REVIEW_VERDICT,
    "checklist/capability_gate_opened_by_this_task",
    reviewVerdict?.checklist?.capability_gate_opened_by_this_task,
  );
  if (reviewVerdict?.checklist?.no_real_capital_authorised === false) {
    findings.push({
      key: "real-capital-not-closed-by-review",
      check: "safety-compliance",
      severity: "CRITICAL",
      detail: `${REVIEW_VERDICT}#/checklist/no_real_capital_authorised is false; structural fact no longer confirms real capital is closed`,
    });
  }

  return {
    findings,
    structuralState: structuralStateFrom({
      projectState,
      reviewVerdict,
      readmeAvailable: readme.ok,
    }),
  };
}

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
    // Crash-proof: a state write failure must not throw from the sweep.
  }
}

export function spawnNotifyReal(message) {
  const child = spawn(
    NODE,
    ["ops-watcher/ahmad-notify.mjs", message],
    { cwd: REPO_ROOT, detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  return { pid: child.pid };
}

function buildAlertMessage(criticals, warnings, gaps) {
  const lines = [];
  lines.push(
    `Peringatan keamanan STEWARD-CAVEMAN (atas nama ${STEWARD_CAVEMAN_AGENT_NAME}, ` +
    `Paperclip id ${STEWARD_CAVEMAN_AGENT_ID})`,
  );
  lines.push("");
  lines.push(`Temuan KRITIS (${criticals.length}):`);
  for (let i = 0; i < criticals.length; i += 1) {
    lines.push(`  ${i + 1}. [${criticals[i].key}] ${criticals[i].detail}`);
  }
  if (warnings.length > 0) {
    lines.push("");
    lines.push(`Peringatan (${warnings.length}, drift informatif):`);
    for (const w of warnings) lines.push(`  - [${w.key}] ${w.detail}`);
  }
  if (gaps.length > 0) {
    lines.push("");
    lines.push("Celah (pemeriksaan tidak dapat dilakukan):");
    for (const g of gaps) lines.push(`  - [${g.key}] ${g.detail}`);
  }
  return lines.join("\n");
}

function summarizeStateForLog(state) {
  if (!state) return "state unavailable";
  return [
    `instrument=${state.instrument.value} (source: ${state.instrument.source}#/${state.instrument.field})`,
    `direction=${state.direction.value} (source: ${state.direction.source}#/${state.direction.field})`,
    `status=${state.status.value} (source: ${state.status.source}#/${state.status.field})`,
    `last-updated=${state.lastUpdated.value} (source: ${state.lastUpdated.source}#/${state.lastUpdated.field})`,
  ].join("; ");
}

export async function runStewardCavemanOnce(deps = {}) {
  const {
    checkRepoReachability = checkRepoReachabilityReal,
    checkGitState = checkGitStateReal,
    checkSafetyCompliance = checkSafetyComplianceReal,
    repoRoot = CAVEMAN_REPO_ROOT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    isAlive = isPidAliveReal,
    now = Date.now,
    spawnNotify = spawnNotifyReal,
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
  let structuralState = null;
  let lock;

  try {
    lock = await acquireLock({ lockFile, pid: lockPid, isAlive, _fs });
  } catch (err) {
    const msg = err && err.stack ? err.stack : String(err);
    log(`steward-caveman: lock acquire threw (${msg}) -> refusing to run (no false all-clear on unknown lock state)`);
    return { findings, error: "lock-failed", refused: true };
  }
  if (!lock.acquired) {
    log(
      `steward-caveman: REFUSING to run - another STEWARD-CAVEMAN sweep is already in progress ` +
      `(pid=${lock.pid}). Remove ${path.basename(lockFile)} only if you are sure it is stale. ` +
      `No checks performed, no false all-clear.`,
    );
    return { findings, refused: true, pid: lock.pid };
  }
  log(`steward-caveman: acquired sweep lock (pid=${lock.pid}) at ${iso()}`);

  try {
    try {
      const reach = await checkRepoReachability({ repoRoot, timeoutMs, _fs });
      if (reach && Array.isArray(reach.findings)) findings.push(...reach.findings);
    } catch (err) {
      findings.push({
        key: "caveman-repo-reachability",
        check: "repo-reachability",
        severity: "GAP",
        detail: `Caveman repo reachability check threw: ${err && err.message ? err.message : err}`,
      });
    }

    try {
      const gitFindings = await checkGitState({ repoRoot, timeoutMs });
      if (Array.isArray(gitFindings)) findings.push(...gitFindings);
    } catch (err) {
      findings.push({
        key: "git-state",
        check: "git-state",
        severity: "GAP",
        detail: `Caveman git state check threw: ${err && err.message ? err.message : err}`,
      });
    }

    try {
      const safety = await checkSafetyCompliance({ repoRoot, timeoutMs, _fs });
      if (safety && Array.isArray(safety.findings)) findings.push(...safety.findings);
      structuralState = safety && safety.structuralState ? safety.structuralState : null;
    } catch (err) {
      findings.push({
        key: "safety-compliance",
        check: "safety-compliance",
        severity: "GAP",
        detail: `Caveman safety-compliance check threw: ${err && err.message ? err.message : err}`,
      });
    }

    const criticals = findings.filter((f) => f.severity === "CRITICAL");
    const warnings = findings.filter((f) => f.severity === "WARNING");
    const gaps = findings.filter((f) => f.severity === "GAP");
    log(`steward-caveman: ${criticals.length} critical, ${warnings.length} warning, ${gaps.length} gap`);
    if (structuralState) log(`steward-caveman: structural state: ${summarizeStateForLog(structuralState)}`);

    let state;
    try {
      state = await readState(stateFile);
    } catch {
      state = { alerts: {} };
    }
    if (!state || !state.alerts) state = { alerts: {} };
    const alerts = state.alerts || {};

    const toAlert = [];
    for (const f of criticals) {
      const prev = alerts[f.key];
      if (!prev || prev.finding !== f.detail) toAlert.push(f);
      else if (now() - (prev.lastAlertedAt || 0) >= COOLDOWN_MS) toAlert.push(f);
    }

    const newAlerts = {};
    for (const f of criticals) {
      const prev = alerts[f.key];
      newAlerts[f.key] = toAlert.includes(f)
        ? { lastAlertedAt: now(), finding: f.detail }
        : prev;
    }
    try {
      await writeState(stateFile, { alerts: newAlerts });
    } catch (err) {
      log(`steward-caveman: state write threw (${err && err.message}) - dedupe may repeat on next run`);
    }

    let notified = false;
    let notifyPid = null;
    if (toAlert.length > 0) {
      const message = buildAlertMessage(toAlert, warnings, gaps);
      try {
        const spawned = spawnNotify(message);
        notified = true;
        notifyPid = spawned && spawned.pid;
        log(`steward-caveman: spawned ahmad-notify (pid=${notifyPid}) with ${toAlert.length} critical finding(s)`);
      } catch (err) {
        log(`steward-caveman: ahmad-notify spawn FAILED (${err && err.message}) - critical findings not relayed`);
      }
    } else {
      log(
        criticals.length > 0
          ? `steward-caveman: ${criticals.length} critical finding(s) suppressed (within ${COOLDOWN_MS / 60000}min re-alert cooldown)`
          : "steward-caveman: no critical findings - no alert spawned",
      );
    }

    return {
      findings,
      structuralState,
      criticalCount: criticals.length,
      warningCount: warnings.length,
      gapCount: gaps.length,
      alerted: notified,
      notifyPid,
      suppressedCount: criticals.length - toAlert.length,
    };
  } finally {
    try {
      await releaseLock({ lockFile, _fs });
      log(`steward-caveman: released sweep lock (pid=${lock.pid})`);
    } catch (err) {
      log(`steward-caveman: WARN lock release threw (${err && err.message}) - staleness check will recover on next start`);
    }
  }
}

function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i += 1) if (argv[i] === "--once") out.once = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/steward-caveman.mjs --once");
    process.exit(2);
  }
  const r = await runStewardCavemanOnce({ log: (m) => console.log(m) });
  if (r.refused) {
    console.log(`steward-caveman --once: refused - another sweep is running (pid=${r.pid})`);
    process.exit(0);
  }
  console.log(
    `steward-caveman --once: ${r.criticalCount} critical, ${r.warningCount} warning, ` +
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
    console.error("steward-caveman fatal:", err && err.stack ? err.stack : err);
    fs.unlink(LOCK_FILE).catch(() => {});
    process.exit(1);
  });
}