// ops-watcher/steward-sjs.mjs — STEWARD-SJS venture repo health watcher.
//
// A real, read-only status/health watcher for the newly-migrated
// ventures/sjs-superapps/ repo. Implements the sj-snapshot.md status-answer
// contract (PROJECT, STATE, CANONICAL SOURCE, LAST VERIFIED, WHAT CHANGED,
// ACTIVE TASKS, BLOCKERS, SAFETY, OWNER DECISION NEEDED) and EXTENDS it with a
// real git-state canonical source — the lesson from the ventures/caveman-
// trading-os incident (22 commits behind its GitHub remote with real
// uncommitted local changes, undetected until a human checked by hand).
//
// STRUCTURE (mirrors ops-watcher/steward.mjs exactly):
//   - ESM, dependency-injected, crash-proof (runStewardSjsOnce never throws).
//   - Single-instance PID lock (reusing acquireLock/releaseLock/isPidAliveReal
//     from telegram-listener-daemon.mjs) on a NEW lock file
//     (ops-watcher/steward-sjs.lock) so two concurrent heartbeat-driven
//     invocations cannot both run.
//   - Alert dedup via a NEW state file (ops-watcher/steward-sjs-state.json),
//     1-hour re-alert cooldown, cleared when a finding resolves.
//   - Any CRITICAL finding spawns ONE bundled
//     `node ops-watcher/ahmad-notify.mjs "<summary>"` child process; zero
//     criticals = zero spawns (no Telegram noise for warnings/all-clear). A
//     lock-layer failure is a clean refusal (no false all-clear).
//
// SEVERITY (per the task spec, matching steward.mjs conventions):
//   - behind origin  -> WARNING (a human should sync; a stale local checkout is
//     not an emergency).
//   - dirty tree     -> WARNING (work-in-progress is normal, but must be
//     surfaced honestly, never silently ignored).
//   - git command failing / timing out -> GAP (a check that cannot currently be
//     performed). Never a crash, never a false all-clear.
//   - No CRITICAL is produced by the real git checks today: venture-repo drift
//     is WARNING/GAP, not an active production problem. The CRITICAL + alert
//     path is wired and unit-tested (via injected checks) so a future extension
//     can elevate a finding without rewiring the alerting/dedup layer.
//
// GIT SAFETY: only read-only git commands are ever issued (fetch, status,
// rev-parse, rev-list, log — NEVER pull/merge/push/reset/checkout). Every git
// call is bounded by a timeout (the boundedSpawn helper, modeled on
// ahmad-context-retrieval.mjs's boundedCall / steward.mjs's boundedSpawn) so a
// hung git command cannot hang the whole sweep.
//
//   node ops-watcher/steward-sjs.mjs --once

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

// STEWARD-SJS's dormant Paperclip identity — used PURELY for attribution in
// alert messages, never invoked via Paperclip's own engine (same pattern as
// steward.mjs / GIBRAN / AHMAD's identity-of-record). This file's identity
// constant is the real STEWARD-SJS record (id a55dbfd8-...); the parallel
// FounderOS-level steward.mjs carries its own (a separate renaming task moves
// that file off this id — not this file's concern).
export const STEWARD_AGENT_ID = "a55dbfd8-b828-4c86-9e97-3c9b478c3a9e";
export const STEWARD_AGENT_NAME = "STEWARD-SJS";

const LOCK_FILE = path.join(__dirname, "steward-sjs.lock");
const STATE_FILE = path.join(__dirname, "steward-sjs-state.json");
const VENTURE_PATH = path.resolve(REPO_ROOT, "ventures", "sjs-superapps");
const VENTURE_README = path.join(VENTURE_PATH, "README.md");
const NODE = process.execPath || "node";
const COOLDOWN_MS = 60 * 60 * 1000; // 1-hour re-alert cooldown

const GIT_TIMEOUT_MS = 8000;
const GIT_FETCH_TIMEOUT_MS = 20000; // fetch may hit the network; give it room
const RECENT_COMMIT_COUNT = 5;

const iso = () => new Date().toISOString();

// ====================================================================
// Bounded spawn helper (a variant of steward.mjs's boundedSpawn, modeled on
// ahmad-context-retrieval.mjs's boundedCall). Returns
// { code, stdout, stderr, timedOut }. Never throws — a spawn-level failure
// (ENOENT on the binary) resolves to { code:null, stderr:<err> } so callers can
// distinguish "binary unavailable" from "git exited non-zero".
// shell:false so git args are passed verbatim (no shell quoting pitfalls).
// ====================================================================
function boundedSpawn(bin, args, { cwd = REPO_ROOT, timeoutMs = 8000, shell = false, env } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        env: env || { ...process.env },
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

// Real default for a single git invocation. Injectable so tests never spawn.
export async function runGitSpawn(args, { cwd = VENTURE_PATH, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return boundedSpawn("git", args, { cwd, timeoutMs, shell: false });
}

// ====================================================================
// The real git-state check. All git commands are read-only (fetch/status/
// rev-parse/rev-list/log). Each is independently try/caught + bounded so one
// hung/failing command cannot crash the sweep or silence the others. Returns:
//   {
//     branch: string|null,        // local branch name (null if undeterminable)
//     detached: bool,             // true if HEAD is detached (branch === "HEAD")
//     ahead: number|null,         // commits local has that origin doesn't
//     behind: number|null,        // commits origin has that local doesn't
//     fetchOk: bool,              // did git fetch succeed (fresh ref)?
//     dirtyFiles: string[],       // porcelain status lines
//     recentCommits: string[],    // last N oneline log lines (report context)
//     findings: [ {key, check, severity, detail} ],  // WARNING + GAP only here
//   }
// Never throws.
// ====================================================================
export async function checkGitStateReal({
  runGit = runGitSpawn,
  venturePath = VENTURE_PATH,
  timeoutMs = GIT_TIMEOUT_MS,
  fetchTimeoutMs = GIT_FETCH_TIMEOUT_MS,
} = {}) {
  const findings = [];
  let branch = null;
  let detached = false;
  let ahead = null;
  let behind = null;
  let fetchOk = false;
  let dirtyFiles = [];
  let recentCommits = [];

  // ---- Step 1: local branch ----
  try {
    const r = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: venturePath, timeoutMs });
    if (r.timedOut) {
      findings.push({
        key: "git-branch", check: "git-state", severity: "GAP",
        detail: `git rev-parse timed out after ${timeoutMs}ms; local branch unknown`,
      });
    } else if (r.code === 0) {
      branch = r.stdout.trim();
      if (branch === "HEAD") {
        detached = true;
        findings.push({
          key: "git-branch", check: "git-state", severity: "GAP",
          detail: "HEAD is detached (not on a branch); cannot compare to a named origin branch",
        });
      }
    } else {
      findings.push({
        key: "git-branch", check: "git-state", severity: "GAP",
        detail: `git rev-parse failed (code ${r.code}): ${(r.stderr || "").trim().slice(0, 200) || "no stderr"}; local branch unknown`,
      });
    }
  } catch (err) {
    findings.push({
      key: "git-branch", check: "git-state", severity: "GAP",
      detail: `git rev-parse threw: ${(err && err.message) || err}; local branch unknown`,
    });
  }

  // ---- Step 2: working-tree cleanliness ----
  try {
    const r = await runGit(["status", "--porcelain"], { cwd: venturePath, timeoutMs });
    if (r.timedOut) {
      findings.push({
        key: "git-dirty-tree", check: "git-state", severity: "GAP",
        detail: `git status timed out after ${timeoutMs}ms; working-tree cleanliness unknown`,
      });
    } else if (r.code === 0) {
      dirtyFiles = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (dirtyFiles.length > 0) {
        const preview = dirtyFiles.slice(0, 8).map((l) => `  ${l}`).join("\n");
        const more = dirtyFiles.length > 8 ? `\n  ...and ${dirtyFiles.length - 8} more` : "";
        findings.push({
          key: "git-dirty-tree", check: "git-state", severity: "WARNING",
          detail: `working tree has ${dirtyFiles.length} uncommitted change(s) (work-in-progress is normal, surfaced honestly):\n${preview}${more}`,
        });
      }
      // else: clean -> no finding
    } else {
      findings.push({
        key: "git-dirty-tree", check: "git-state", severity: "GAP",
        detail: `git status failed (code ${r.code}): ${(r.stderr || "").trim().slice(0, 200) || "no stderr"}; working-tree cleanliness unknown`,
      });
    }
  } catch (err) {
    findings.push({
      key: "git-dirty-tree", check: "git-state", severity: "GAP",
      detail: `git status threw: ${(err && err.message) || err}; working-tree cleanliness unknown`,
    });
  }

  // ---- Step 3: fetch (refreshes origin/<branch> ref) — skip if no branch/detached ----
  if (branch && !detached) {
    try {
      const r = await runGit(["fetch", "origin"], { cwd: venturePath, timeoutMs: fetchTimeoutMs });
      if (r.timedOut) {
        findings.push({
          key: "git-fetch", check: "git-state", severity: "GAP",
          detail: `git fetch timed out after ${fetchTimeoutMs}ms; behind/ahead counts are unknown (cannot verify sync freshness)`,
        });
      } else if (r.code === 0) {
        fetchOk = true;
      } else {
        findings.push({
          key: "git-fetch", check: "git-state", severity: "GAP",
          detail: `git fetch failed (code ${r.code}): ${(r.stderr || "").trim().slice(0, 200) || "no stderr"}; behind/ahead counts are unknown (cannot verify sync freshness — a human should confirm the remote is reachable)`,
        });
      }
    } catch (err) {
      findings.push({
        key: "git-fetch", check: "git-state", severity: "GAP",
        detail: `git fetch threw: ${(err && err.message) || err}; behind/ahead counts are unknown`,
      });
    }
  }

  // ---- Step 4: ahead/behind (only with a fresh fetch + a real branch) ----
  if (branch && !detached && fetchOk) {
    try {
      const rb = await runGit(["rev-list", "--count", `HEAD..origin/${branch}`], { cwd: venturePath, timeoutMs });
      const ra = await runGit(["rev-list", "--count", `origin/${branch}..HEAD`], { cwd: venturePath, timeoutMs });
      if (rb.timedOut || ra.timedOut) {
        findings.push({
          key: "git-revlist", check: "git-state", severity: "GAP",
          detail: `git rev-list timed out after ${timeoutMs}ms; behind/ahead counts are unknown`,
        });
      } else if (rb.code === 0 && ra.code === 0) {
        behind = Number(String(rb.stdout).trim()) || 0;
        ahead = Number(String(ra.stdout).trim()) || 0;
        if (behind > 0) {
          findings.push({
            key: "git-behind-origin", check: "git-state", severity: "WARNING",
            detail: `local ${branch} is ${behind} commit(s) behind origin/${branch} — a human should sync (read-only watcher will not pull; run: git -C ventures/sjs-superapps pull)`,
          });
        }
        // ahead > 0 is reported as a fact in the snapshot (unpushed local work)
        // but is NOT a finding — having local commits before pushing is normal
        // per the README deploy flow (commit → push to dev → Netlify deploy).
      } else {
        const which = rb.code !== 0 ? "behind" : "ahead";
        findings.push({
          key: "git-revlist", check: "git-state", severity: "GAP",
          detail: `git rev-list (${which}) failed (code ${rb.code !== 0 ? rb.code : ra.code}): ${(rb.code !== 0 ? rb.stderr : ra.stderr || "").trim().slice(0, 200)}; behind/ahead counts are unknown (origin/${branch} ref may not exist)`,
        });
      }
    } catch (err) {
      findings.push({
        key: "git-revlist", check: "git-state", severity: "GAP",
        detail: `git rev-list threw: ${(err && err.message) || err}; behind/ahead counts are unknown`,
      });
    }
  }

  // ---- Step 5: recent commits (report context only; never a finding) ----
  try {
    const r = await runGit(["log", "--oneline", `-${RECENT_COMMIT_COUNT}`], { cwd: venturePath, timeoutMs });
    if (!r.timedOut && r.code === 0) {
      recentCommits = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  } catch {
    /* non-critical — recent commits are report context, not a finding */
  }

  return { branch, detached, ahead, behind, fetchOk, dirtyFiles, recentCommits, findings };
}

// ====================================================================
// README-derived facts (PROJECT + source-of-truth). Read at runtime from the
// real README.md so PROJECT/CANONICAL SOURCE are filled from a real source
// this sweep actually read (per sj-snapshot.md: "each field filled from a
// real source you did read"). Crash-proof: falls back to constants derived
// from the README content read at build time if the read fails.
// ====================================================================
const FALLBACK_PROJECT = "SJS SuperApps (operational ERP for SJS)";
const FALLBACK_SOURCE_OF_TRUTH =
  "This repository is the source of truth for the frontend, Supabase schema, Edge Functions, and system documentation.";

async function readReadmeFacts({ readmePath = VENTURE_README, _fs = fs } = {}) {
  let project = FALLBACK_PROJECT;
  let sourceOfTruth = FALLBACK_SOURCE_OF_TRUTH;
  try {
    const raw = await _fs.readFile(readmePath, "utf8");
    const lines = raw.split(/\r?\n/);
    // PROJECT: first non-heading, non-blank, non-frontmatter line.
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("#")) continue;
      if (t.startsWith("---")) continue;
      project = t;
      break;
    }
    // Source-of-truth: first line containing "source of truth".
    for (const line of lines) {
      if (/source of truth/i.test(line)) {
        sourceOfTruth = line.trim();
        break;
      }
    }
  } catch {
    /* keep fallbacks */
  }
  return { project, sourceOfTruth };
}

// ====================================================================
// Build the sj-snapshot.md status-answer report (9 fields) from the git-state
// result + README facts. Every field is filled from a real source read this
// sweep (git state + README). OWNER DECISION NEEDED defaults to NO and is only
// YES if a real open owner-decision item is surfaced — never fabricated.
// Each field label is emitted as `LABEL:` so the contract shape is machine-
// greppable (BLOCKERS always starts with `BLOCKERS:`).
// ====================================================================
export function buildSnapshotReport(gitState, readmeFacts, verifiedAt, ownerDecisionNeeded = "NO") {
  const { branch, detached, ahead, behind, fetchOk, dirtyFiles, recentCommits } = gitState;
  const lines = [];
  const hr = "=".repeat(72);

  lines.push(hr);
  lines.push(`SJS SNAPSHOT  (as of ${verifiedAt} — a snapshot is stale the moment it is written)`);
  lines.push(hr);

  // ---- PROJECT ----
  lines.push(`PROJECT: ${readmeFacts.project}`);

  // ---- STATE ----
  const stateParts = [];
  if (!branch) {
    stateParts.push("UNKNOWN — local branch could not be determined");
  } else if (detached) {
    stateParts.push("DETACHED HEAD (not on a branch)");
  } else {
    stateParts.push(`on branch ${branch}`);
    if (fetchOk && behind !== null && ahead !== null) {
      if (behind === 0 && ahead === 0) stateParts.push("in sync with origin");
      else {
        if (behind > 0) stateParts.push(`${behind} behind origin`);
        if (ahead > 0) stateParts.push(`${ahead} ahead of origin (unpushed)`);
      }
    } else {
      stateParts.push("sync vs origin UNKNOWN (fetch did not succeed)");
    }
  }
  if (dirtyFiles.length > 0) stateParts.push(`working tree DIRTY (${dirtyFiles.length} uncommitted change(s))`);
  else if (gitState.findings.some((f) => f.key === "git-dirty-tree" && f.severity === "GAP")) {
    stateParts.push("working-tree cleanliness UNKNOWN");
  } else {
    stateParts.push("working tree CLEAN");
  }
  lines.push(`STATE: ${stateParts.join("; ")}`);

  // ---- CANONICAL SOURCE ----
  lines.push(`CANONICAL SOURCE: ventures/sjs-superapps/ local git working tree + origin/${branch || "?"} remote-tracking ref`);
  lines.push(`  README: "${readmeFacts.sourceOfTruth}"`);
  lines.push(`  Deploy flow (README): Edit → commit → push to dev → Netlify deploy → test against Supabase staging`);

  // ---- LAST VERIFIED ----
  lines.push(`LAST VERIFIED: ${verifiedAt}`);

  // ---- WHAT CHANGED ----
  const wcParts = [];
  if (recentCommits.length > 0) {
    wcParts.push(`last ${recentCommits.length} local commit(s):`);
    for (const c of recentCommits) wcParts.push(`  ${c}`);
  } else {
    wcParts.push("recent commits: not available (git log failed or empty)");
  }
  if (branch && !detached && fetchOk && behind !== null && ahead !== null) {
    wcParts.push(`vs origin/${branch}: ${ahead} ahead, ${behind} behind`);
  } else if (branch && !detached) {
    wcParts.push(`vs origin/${branch}: ahead/behind UNKNOWN (fetch did not succeed — counts may be stale, treat as unverified)`);
  }
  if (dirtyFiles.length > 0) {
    wcParts.push(`uncommitted working-tree change(s) (${dirtyFiles.length}):`);
    for (const f of dirtyFiles.slice(0, 12)) wcParts.push(`  ${f}`);
    if (dirtyFiles.length > 12) wcParts.push(`  ...and ${dirtyFiles.length - 12} more`);
  }
  lines.push(`WHAT CHANGED:`);
  for (const p of wcParts) lines.push(`  ${p}`);

  // ---- ACTIVE TASKS ----
  // Derived from the git working state this sweep actually read: uncommitted
  // files are real work-in-progress. This watcher does not query Paperclip or
  // handoffs (those are a separate canonical-source domain); it states what it
  // read honestly rather than inventing tasks.
  if (dirtyFiles.length > 0) {
    lines.push(`ACTIVE TASKS: ${dirtyFiles.length} uncommitted change(s) in the working tree (work-in-progress; active task tracking lives in Paperclip/handoffs, not queried by this git-state watcher):`);
    for (const f of dirtyFiles.slice(0, 12)) lines.push(`  ${f}`);
    if (dirtyFiles.length > 12) lines.push(`  ...and ${dirtyFiles.length - 12} more`);
  } else if (gitState.findings.some((f) => f.key === "git-dirty-tree" && f.severity === "GAP")) {
    lines.push(`ACTIVE TASKS: working-tree state UNKNOWN (git status could not run); cannot report work-in-progress`);
  } else {
    lines.push(`ACTIVE TASKS: none visible in the working tree (clean; active task tracking lives in Paperclip/handoffs, not queried by this git-state watcher)`);
  }

  // ---- BLOCKERS ----
  const blockerFindings = gitState.findings.filter(
    (f) => f.severity === "WARNING" || f.severity === "GAP",
  );
  if (blockerFindings.length === 0) {
    lines.push(`BLOCKERS: none — in sync with origin, working tree clean, all git checks succeeded`);
  } else {
    lines.push(`BLOCKERS: ${blockerFindings.length} finding(s) needing attention:`);
    for (const f of blockerFindings) {
      const sev = f.severity === "WARNING" ? "WARNING" : "GAP";
      lines.push(`  [${sev}] ${f.key}: ${f.detail}`);
    }
  }

  // ---- SAFETY ----
  lines.push(`SAFETY: this sweep issued only read-only git commands (fetch/status/rev-parse/rev-list/log)`);
  lines.push(`  against ventures/sjs-superapps/; no working-tree, branch, or remote state was mutated. Behind-origin and`);
  lines.push(`  dirty-tree are WARNING (drift that self-heals or needs eventual human attention), not CRITICAL.`);

  // ---- OWNER DECISION NEEDED ----
  lines.push(`OWNER DECISION NEEDED: ${ownerDecisionNeeded}`);

  lines.push(hr);
  return lines.join("\n");
}

// ====================================================================
// State file read/write (crash-proof defaults, injectable for tests). Mirrors
// steward.mjs's pattern exactly: { alerts: { <key>: { lastAlertedAt, finding } } }.
// ====================================================================
async function defaultReadState(stateFile) {
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.alerts ? parsed : { alerts: {} };
  } catch {
    return { alerts: {} };
  }
}

async function defaultWriteState(stateFile, state) {
  try {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* crash-proof: never throw on state write failure */
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
    `Peringatan drift repo venture STEWARD-SJS (atas nama ${STEWARD_AGENT_NAME}, ` +
    `Paperclip id ${STEWARD_AGENT_ID})`,
  );
  lines.push("");
  lines.push(`Temuan KRITIS (${criticals.length}):`);
  for (let i = 0; i < criticals.length; i++) {
    lines.push(`  ${i + 1}. [${criticals[i].key}] ${criticals[i].detail}`);
  }
  if (warnings.length > 0) {
    lines.push("");
    lines.push(`Peringatan (${warnings.length}, tidak menghambat — drift yang bisa pulih sendiri atau perlu perhatian nanti):`);
    for (const w of warnings) {
      lines.push(`  - [${w.key}] ${w.detail}`);
    }
  }
  if (gaps.length > 0) {
    lines.push("");
    lines.push("Celah yang diketahui (perlu verifikasi manusia):");
    for (const g of gaps) {
      lines.push(`  - [${g.key}] ${g.detail}`);
    }
  }
  return lines.join("\n");
}

// ====================================================================
// Core, dependency-injected sweep (crash-proof, never throws).
// deps: {
//   checkGitState, readmeFactsFn,
//   venturePath, repoRoot,
//   isAlive, now, spawnNotify,
//   stateFile, readState, writeState,
//   log,
//   lockFile, acquireLock, releaseLock, lockPid, _fs,
//   ownerDecisionNeeded,
// }
//
// Returns {
//   findings: [...],            // all findings (CRITICAL + WARNING + GAP)
//   criticalCount, warningCount, gapCount,
//   alerted: bool,              // was an ahmad-notify spawned this run?
//   notifyPid: number|null,
//   suppressedCount: number,    // criticals suppressed by cooldown
//   refused: bool,              // single-instance lock refused
//   pid: number|undefined,      // holder pid when refused
//   snapshot: string,           // the sj-snapshot report text
//   gitState: object,           // raw git-state result
//   error: string|undefined,    // "lock-failed" on lock acquire throw
// }
// ====================================================================
export async function runStewardSjsOnce(deps) {
  const {
    checkGitState = checkGitStateReal,
    venturePath = VENTURE_PATH,
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
    ownerDecisionNeeded = "NO",
    readmeFactsFn = readReadmeFacts,
  } = deps;

  const findings = [];

  // ---- Single-instance lock for the whole sweep ----
  let lock;
  try {
    lock = await acquireLock({ lockFile, pid: lockPid, isAlive, _fs });
  } catch (err) {
    const msg = err && err.stack ? err.stack : String(err);
    log(`steward-sjs: lock acquire threw (${msg}) -> refusing to run (no false all-clear on unknown lock state)`);
    return { findings, error: "lock-failed", refused: true };
  }
  if (!lock.acquired) {
    log(
      `steward-sjs: REFUSING to run — another STEWARD-SJS sweep is already in progress ` +
      `(pid=${lock.pid}). Remove ${path.basename(lockFile)} only if you are ` +
      `sure it is stale. No checks performed, no false all-clear.`,
    );
    return { findings, refused: true, pid: lock.pid };
  }
  log(`steward-sjs: acquired sweep lock (pid=${lock.pid}) at ${iso()}`);

  try {
    // ---- Read README facts (crash-proof) ----
    let readmeFacts;
    try {
      readmeFacts = await readmeFactsFn({ _fs });
    } catch {
      readmeFacts = { project: FALLBACK_PROJECT, sourceOfTruth: FALLBACK_SOURCE_OF_TRUTH };
    }

    // ---- Run the git-state check ----
    let gitState;
    try {
      gitState = await checkGitState({ venturePath });
    } catch (err) {
      // Crash-proof: a thrown check is recorded as a GAP, never a false all-clear.
      gitState = {
        branch: null, detached: false, ahead: null, behind: null,
        fetchOk: false, dirtyFiles: [], recentCommits: [],
        findings: [{
          key: "git-state", check: "git-state", severity: "GAP",
          detail: `checkGitState threw: ${(err && err.message) || err} — git state unknown`,
        }],
      };
    }

    // Roll the git check's findings into the sweep's findings list.
    for (const f of (gitState.findings || [])) {
      findings.push({
        key: f.key || "git-state",
        check: f.check || "git-state",
        severity: f.severity || "GAP",
        detail: f.detail || "git-state finding (no detail)",
      });
    }

    log(
      `steward-sjs: branch=${gitState.branch || "?"}${gitState.detached ? " (detached)" : ""}, ` +
      `ahead=${gitState.ahead ?? "?"}, behind=${gitState.behind ?? "?"}, ` +
      `dirtyFiles=${gitState.dirtyFiles.length}, fetchOk=${gitState.fetchOk}`,
    );

    // ---- Build the sj-snapshot report ----
    const verifiedAt = iso();
    const snapshot = buildSnapshotReport(gitState, readmeFacts, verifiedAt, ownerDecisionNeeded);

    // ---- Summary counts ----
    const criticals = findings.filter((f) => f.severity === "CRITICAL");
    const warnings = findings.filter((f) => f.severity === "WARNING");
    const gaps = findings.filter((f) => f.severity === "GAP");
    log(`steward-sjs: ${criticals.length} critical, ${warnings.length} warning, ${gaps.length} gap`);

    // ---- Duplicate-alert protection (state file) — mirrors steward.mjs ----
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
      if (!prev || prev.finding !== f.detail) {
        toAlert.push(f);
      } else if (now() - (prev.lastAlertedAt || 0) >= COOLDOWN_MS) {
        toAlert.push(f);
      }
      // else: same finding within cooldown -> suppressed.
    }

    const newAlerts = {};
    for (const f of criticals) {
      const prev = alerts[f.key];
      if (toAlert.includes(f)) {
        newAlerts[f.key] = { lastAlertedAt: now(), finding: f.detail };
      } else {
        newAlerts[f.key] = prev; // keep prev record so cooldown keeps counting
      }
    }
    const newState = { alerts: newAlerts };
    try {
      await writeState(stateFile, newState);
    } catch (err) {
      log(`steward-sjs: state write threw (${err && err.message}) — dedupe may repeat on next run`);
    }

    // ---- Alerting: ONE bundled ahmad-notify spawn if any criticals to alert ----
    let notified = false;
    let notifyPid = null;
    if (toAlert.length > 0) {
      const message = buildAlertMessage(toAlert, warnings, gaps);
      try {
        const spawned = spawnNotify(message);
        notified = true;
        notifyPid = spawned && spawned.pid;
        log(`steward-sjs: spawned ahmad-notify (pid=${notifyPid}) with ${toAlert.length} critical finding(s)`);
      } catch (err) {
        log(`steward-sjs: ahmad-notify spawn FAILED (${err && err.message}) — critical findings not relayed`);
      }
    } else {
      log(
        criticals.length > 0
          ? `steward-sjs: ${criticals.length} critical finding(s) suppressed (within ${COOLDOWN_MS / 60000}min re-alert cooldown)`
          : `steward-sjs: no critical findings — no alert spawned`,
      );
    }

    return {
      findings,
      criticalCount: criticals.length,
      warningCount: warnings.length,
      gapCount: gaps.length,
      alerted: notified,
      notifyPid,
      suppressedCount: criticals.length - toAlert.length,
      snapshot,
      gitState,
    };
  } finally {
    try {
      await releaseLock({ lockFile, _fs });
      log(`steward-sjs: released sweep lock (pid=${lock.pid})`);
    } catch (err) {
      log(`steward-sjs: WARN lock release threw (${err && err.message}) — staleness check will recover on next start`);
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
    console.error("usage: node ops-watcher/steward-sjs.mjs --once");
    process.exit(2);
  }
  const r = await runStewardSjsOnce({ log: (m) => console.log(m) });
  if (r.refused) {
    console.log(`steward-sjs --once: refused — another sweep is running (pid=${r.pid})`);
    process.exit(0);
  }
  // Print the full sj-snapshot report to stdout (the status-answer contract).
  console.log(r.snapshot);
  console.log(
    `steward-sjs --once: ${r.criticalCount} critical, ${r.warningCount} warning, ` +
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
    console.error("steward-sjs fatal:", err && err.stack ? err.stack : err);
    // Best-effort lock cleanup on fatal crash.
    fs.unlink(LOCK_FILE).catch(() => {});
    process.exit(1);
  });
}