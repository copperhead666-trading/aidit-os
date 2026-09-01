// ops-watcher/test-runner.mjs
// Automatically runs the allowlisted test command for Paperclip issues labeled
// TEST_REQUIRED in the canonical company, posts the pass/fail output as a
// comment, and on PASS swaps the label to REVIEW_REQUIRED (remove TEST_REQUIRED,
// add REVIEW_REQUIRED) WITHOUT changing the issue status (it stays todo so the
// review lane picks it up purely on the REVIEW_REQUIRED label). On FAIL it leaves
// TEST_REQUIRED and posts a clear FAIL comment (rework signal). One pass per
// issue per --once run; no retry loop (bounded by design).
//
//   node ops-watcher/test-runner.mjs --once
//
// === PRODUCTION SWEEP (runTestSweep) ===
// main() calls runTestSweep (NOT runTestOnce). runTestSweep uses the REAL
// fenced-block test-command parser (parseTestCommand: a ```test-command ... ```
// block, falling back to the legacy `test-cmd:` line), enforces the allowlist,
// posts TEST RESULT comments as the board (authorType:"user"), and on PASS swaps
// TEST_REQUIRED->REVIEW_REQUIRED while leaving status unchanged (todo). The
// return shape is a summary counter object: { passed, failed, skipped,
// processed, errors }.
//
// runTestOnce (the legacy entrypoint that sets status=in_review on PASS and
// parses only the `test-cmd:` line form) is KEPT as an exported function: it is
// still exercised by runners.regression.test.mjs and the T7 concurrent-sweep
// regression test. It is NOT called by main() anymore.
//
// === Test-command convention ===
// The command to run for an issue is resolved in this priority:
//   1. A triple-backtick fenced block labelled "test-command" in the issue
//      description, e.g.
//        ```test-command
//        node ops-watcher/watcher.regression.test.mjs
//        ```
//      (the content is trimmed; whitespace-split into argv; no shell is
//      involved, so no $expansion / piping / chaining — safe by construction).
//   2. A legacy inline line  `test-cmd: <argv>`  (kept for back-compat with any
//      issue still using that form).
//   3. Otherwise the repo default: `node ops-watcher/watcher.regression.test.mjs`
//      (this repo's existing offline regression suite — a sensible default
//      "does our own deterministic test suite pass" check that needs no network
//      and no external services).
// The resolved command MUST match an allowlist (ALLOWED_COMMANDS below) or the
// issue is FAILED with a "not on the allowlist" comment (the command is NOT
// executed). This keeps a semi-trusted issue description from running arbitrary
// code. The default command is on the allowlist by construction.
//
// === PHASE 3 HARDENING ===
// (H1) Duplicate-dispatch protection ("fresh" TEST RESULT rule):
//   A TEST_REQUIRED issue is NOT re-tested while it already carries a TEST RESULT
//   comment. We intentionally use this SIMPLE rule rather than a timestamp-based
//   "posted after the most recent TEST_REQUIRED application" rule, and document
//   why: Paperclip exposes NO per-label-application timestamp. The label object
//   only carries createdAt/updatedAt for the label *definition* (company-level),
//   not for when it was applied to a given issue. The issue's own updatedAt is
//   bumped by THIS script's own PATCH (the label swap), so it cannot distinguish
//   "TEST_REQUIRED was freshly re-applied by a human" from "we just processed
//   it" — using it would re-trigger on FAIL issues we just processed, which is
//   the exact double-dispatch bug we must prevent. Therefore the honest, robust
//   rule is: any TEST RESULT comment present => already processed => skip. To
//   retrigger a test after a FAIL, a human clears the old TEST RESULT comment
//   (and re-applies TEST_REQUIRED if it was removed). This fully satisfies the
//   duplicate-dispatch requirement: two `--once` runs back to back against the
//   same issue state never double-comment / double-swap.
// (H2) OWNER-blocker protection:
//   If an issue carries a label named OWNER_REQUIRED, test-runner NEVER acts on
//   it — not tested, not transitioned — even if it also carries TEST_REQUIRED.
//   The skip is LOGGED ("skipped, OWNER_REQUIRED"), never silent. OWNER_REQUIRED
//   is created in the company if missing (idempotent) so a human can apply it.
// (H3) Worker failure must not kill the runner:
//   Each issue is processed inside a try/catch. If the test command's spawn
//   throws, the process crashes, or any unexpected error occurs for one issue,
//   it is logged clearly and the sweep continues to the next issue rather than
//   crashing the whole --once run. (Normal test-assertion FAIL is not an error —
//   it is a non-zero exit code, handled as the FAIL outcome.)
//
// === SINGLE-INSTANCE SWEEP LOCK (preemptive fix, same bug class as KOL-37/KOL-38) ===
//   test-runner has the SAME unlocked check-then-act shape as review-runner
//   (GET-comments -> no TEST RESULT -> runCommand + POST). Multiple concurrent
//   invocations (heartbeat-daemon.mjs's 5-min timer + manual --once runs +
//   telegram-listener.mjs's event-driven wake, all overlapping) each
//   independently GET the issue's comments, see no TEST RESULT comment yet, and
//   dispatch again before any of them finish and post. This is the EXACT same
//   bug class already fixed in ahmad-dispatch.mjs (KOL-33) and review-runner.mjs
//   (KOL-37/KOL-38). We apply the EXACT same solution preemptively: a PID-based
//   single-instance file lock reusing the atomic acquireLock/releaseLock/
//   isPidAliveReal from telegram-listener-daemon.mjs wraps the WHOLE sweep. A
//   concurrent second invocation sees the lock held, logs clearly, and exits
//   cleanly (returns an empty summary with refused:true) instead of racing the
//   first.
//
// This is externally driven (Paperclip's own heartbeat/adapter system is NOT
// involved — see hatta/workspace/PAPERCLIP-API-NOTES-phase2.md "stale-config
// hazard"). Comments are posted as the board (authorType:"user") which needs no
// run context in local_trusted mode; the test result is a system record, not a
// GIBRAN review verdict, so agent attribution is not required here.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  discoverPaperclipPort,
  httpGet,
  httpPost,
  httpPatch,
} from "./paperclip-write-client.mjs";
import {
  acquireLock as acquireLockReal,
  releaseLock as releaseLockReal,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const LABEL_SPECS = {
  TEST_REQUIRED: "#3b82f6",
  REVIEW_REQUIRED: "#ef4444",
  // H2: owner-blocker label. Created idempotently so a human can apply it; never
  // swapped by this script. Distinct dark-red color.
  OWNER_REQUIRED: "#991b1b",
};
const TEST_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_CAP = 4000;
const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

const DEFAULT_TEST_CMD = ["node", "ops-watcher/watcher.regression.test.mjs"];

// Allowlist: (exe, rule on args[0]). npm is resolved to npm.cmd on Windows.
const ALLOWED_COMMANDS = [
  { exe: "node", arg0Prefix: "ops-watcher/" },
  { exe: "node", arg0: "--test" },
  { exe: "npm", arg0: "test" },
  { exe: "npm", arg0: "run" },
];

// Single-instance sweep lock (preemptive fix, same bug class as KOL-37/KOL-38).
// Separate lock file from review-runner.lock and ahmad-dispatch.lock — these
// scripts run independently and legitimately concurrently with each other.
const LOCK_FILE = path.join(__dirname, "test-runner.lock");

const iso = () => new Date().toISOString();

// Case-insensitive label-name check on an issue's labels array (handles both
// string labels and {name} label objects, as the live API returns).
function hasLabel(it, name) {
  const want = String(name).toUpperCase();
  return (it.labels || []).some((l) => {
    const n = typeof l === "string" ? l : l && l.name ? l.name : "";
    return String(n).toUpperCase() === want;
  });
}

// Legacy inline `test-cmd: <argv>` line parser (used by runTestOnce). Returns
// { argv } on success, { rejected } when the line carries pipe/metachar junk, or
// null when no test-cmd: line is present.
function parseTestCmd(description) {
  if (!description) return null;
  const m = description.match(/^\s*test-cmd:\s*(.+?)\s*$/im);
  if (!m) return null;
  const line = m[1].trim();
  // Split on whitespace. No shell -> no expansion. Reject empty / pipe-looking.
  if (/[|;&`$><]/.test(line)) return { rejected: line };
  const argv = line.split(/\s+/).filter(Boolean);
  if (argv.length === 0) return { rejected: line };
  return { argv };
}

function isAllowed(argv) {
  if (!argv || !argv.length) return false;
  const exe = argv[0];
  const arg0 = argv[1] || "";
  return ALLOWED_COMMANDS.some((r) => {
    if (r.exe !== exe) return false;
    if (r.arg0 != null) return arg0 === r.arg0;
    if (r.arg0Prefix != null) return arg0.startsWith(r.arg0Prefix);
    return false;
  });
}

// Exported command extractor — the REAL fenced-block parser used by the
// production sweep (runTestSweep). Recognizes a triple-backtick "test-command"
// fenced block (the format the regression tests assert on) and, for back-compat,
// the legacy inline "test-cmd: <argv>" line form. Returns the trimmed command
// STRING, or null when neither is present.
export function parseTestCommand(text) {
  if (!text) return null;
  const s = String(text);
  // 1. triple-backtick test-command fenced block (case-insensitive label).
  const fence = s.match(/```test-command[\t ]*\n([\s\S]*?)\n?```/i);
  if (fence) {
    const cmd = fence[1].trim();
    return cmd.length ? cmd : null;
  }
  // 2. Legacy inline line:  test-cmd: <argv>
  const line = s.match(/^\s*test-cmd:\s*(.+?)\s*$/im);
  if (line) {
    const cmd = line[1].trim();
    return cmd.length ? cmd : null;
  }
  return null;
}

// Exported allowlist view. The live allowlist is RULE-based (ALLOWED_COMMANDS +
// isAllowed above, supporting prefix matching), which cannot be enumerated as a
// finite string Set. So this exposes a Set-like adapter whose .has(commandString)
// delegates to the SAME isAllowed() implementation — one source of truth.
export const TEST_COMMAND_ALLOWLIST = {
  has(commandString) {
    const argv = String(commandString || "").split(/\s+/).filter(Boolean);
    return isAllowed(argv);
  },
};

function resolveExe(exe) {
  if (exe === "npm" && process.platform === "win32") return "npm.cmd";
  return exe;
}

// Default real command runner. Returns { code, stdout, stderr, timedOut }.
// Never throws — spawn errors are reported as code=null + stderr=message.
export function runCommandReal(argv, { timeoutMs = TEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(resolveExe(argv[0]), argv.slice(1), {
        cwd: path.resolve(__dirname, ".."),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: String(err && err.message), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err && err.message), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function cap(s, n = OUTPUT_CAP) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + `\n...[truncated ${s.length - n} bytes]` : s;
}

// ---- ensureLabels (shared) ----
async function ensureLabels(base, companyId, specs, _get, _post, log) {
  const res = await _get(`${base}/api/companies/${companyId}/labels`);
  const existing = Array.isArray(res.body) ? res.body : [];
  const map = {};
  for (const l of existing) map[l.name] = l.id;
  for (const [name, color] of Object.entries(specs)) {
    if (map[name]) continue;
    log(`test-runner: creating missing label ${name}`);
    const cr = await _post(`${base}/api/companies/${companyId}/labels`, { name, color });
    if (cr.body && cr.body.id) map[name] = cr.body.id;
  }
  return map;
}

// =====================================================================
// PRODUCTION SWEEP: runTestSweep (the real production entrypoint)
// =====================================================================
// deps: { base, companyId, httpGet, httpPost, httpPatch,
//         runCommand | runTestCommandFn (legacy test key), log,
//         lockFile, acquireLock, releaseLock, isAlive, lockPid, _fs }
//
// Return shape (the spec the regression tests assert on):
//   { passed, failed, skipped, processed, errors: [] }
// plus a `refused: true` flag when the single-instance lock is held by another
// sweep. On a Paperclip network error the sweep does NOT throw — it returns the
// same summary with at least one `errors` entry (test e). The lock wraps the whole
// sweep exactly as it wraps runTestOnce, so the T7 TOCTOU protection is preserved.
export async function runTestSweep(deps) {
  const {
    base,
    companyId = COMPANY_ID,
    httpGet: _get = httpGet,
    httpPost: _post = httpPost,
    httpPatch: _patch = httpPatch,
    runCommand = runCommandReal,
    runTestCommandFn, // legacy regression-test injection key -> runCommand
    log = (m) => console.log(m),
    lockFile = LOCK_FILE,
    acquireLock: _acquireLock = acquireLockReal,
    releaseLock: _releaseLock = releaseLockReal,
    isAlive = isPidAliveReal,
    lockPid = process.pid,
    _fs = fs,
  } = deps || {};
  const run = runTestCommandFn || runCommand;
  const summary = { passed: 0, failed: 0, skipped: 0, processed: 0, errors: [] };

  // ---- SINGLE-INSTANCE SWEEP LOCK (same wrap as runTestOnce) ----
  let lock;
  try {
    lock = await _acquireLock({ lockFile, pid: lockPid, isAlive, _fs });
  } catch (err) {
    const msg = (err && err.stack) ? err.stack : String(err);
    log(`test-runner sweep: lock acquire threw (${msg}) -> refusing (no double-dispatch on unknown lock state)`);
    summary.errors.push(`lock-failed: ${err && err.message || err}`);
    summary.refused = true;
    return summary;
  }
  if (!lock.acquired) {
    log(`test-runner sweep: REFUSING to run — another sweep is in progress (pid=${lock.pid}). No Paperclip reads/writes, no double-dispatch risk.`);
    summary.refused = true;
    return summary;
  }
  log(`test-runner sweep: acquired lock (pid=${lock.pid}) at ${iso()}`);

  try {
    if (!base) {
      log("test-runner sweep: no Paperclip base resolved (instance not running)");
      summary.errors.push("no Paperclip base resolved");
      return summary;
    }

    const labelMap = await ensureLabels(base, companyId, LABEL_SPECS, _get, _post, log);
    if (!labelMap.TEST_REQUIRED || !labelMap.REVIEW_REQUIRED) {
      log("test-runner sweep: could not ensure TEST_REQUIRED/REVIEW_REQUIRED labels");
      summary.errors.push("could not ensure TEST_REQUIRED/REVIEW_REQUIRED labels");
      return summary;
    }

    const issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
    if (issuesRes.networkError) {
      log(`test-runner sweep: issues list network error: ${issuesRes.networkErrorMessage}`);
      summary.errors.push(`issues list network error: ${issuesRes.networkErrorMessage}`);
      return summary;
    }
    const issues = Array.isArray(issuesRes.body) ? issuesRes.body : [];

    for (const it of issues) {
      const id = it.id;
      const ident = it.identifier || id;
      try {
        const r = await processTestSweepIssue(it, base, companyId, labelMap, _get, _post, _patch, run, log);
        if (r === "skip") summary.skipped += 1;
        else if (r === "pass") { summary.passed += 1; summary.processed += 1; }
        else if (r === "fail") { summary.failed += 1; summary.processed += 1; }
        // r === null -> issue not relevant / comments-fetch failed; not counted
      } catch (err) {
        const msg = (err && err.stack) ? err.stack : String(err);
        log(`test-runner sweep: ${ident} UNEXPECTED ERROR (continuing): ${msg}`);
        summary.errors.push(`${ident}: ${err && err.message || err}`);
        try {
          await _post(`${base}/api/issues/${id}/comments`, {
            body: `TEST RESULT: ERROR (ops-watcher/test-runner sweep — ${iso()})\n` +
                  `Issue: ${ident}\n` +
                  `The test command threw an unexpected error (not a normal FAIL). Sweep continued.\n` +
                  `--- error ---\n${cap(msg)}\n`,
            authorType: "user",
          });
        } catch { /* never let the error-comment itself crash the sweep */ }
      }
    }
    return summary;
  } finally {
    try {
      await _releaseLock({ lockFile, _fs });
      log(`test-runner sweep: released lock (pid=${lock.pid})`);
    } catch (err) {
      log(`test-runner sweep: WARN lock release threw (${err && err.message}) — staleness check will recover`);
    }
  }
}

// Per-issue processing for the production sweep (runTestSweep). Returns one of
// the counter tags: "skip" | "pass" | "fail", or null when the issue is not
// relevant (not TEST_REQUIRED / terminal status / OWNER_REQUIRED-blocked /
// comments-fetch failed) — null is NOT counted.
async function processTestSweepIssue(it, base, companyId, labelMap, _get, _post, _patch, runCommand, log) {
  const id = it.id;
  const ident = it.identifier || id;

  // H2: OWNER_REQUIRED blocker — checked first, never tested/transitioned.
  if (hasLabel(it, "OWNER_REQUIRED")) {
    log(`test-runner sweep: ${ident} skipped, OWNER_REQUIRED (owner-blocked)`);
    return null;
  }

  const names = (it.labels || []).map((l) => (typeof l === "string" ? l : l.name || ""));
  if (!names.includes("TEST_REQUIRED")) return null;
  if (TERMINAL_STATUSES.has((it.status || "").toLowerCase())) return null;

  // H1: duplicate-dispatch protection — skip if a TEST RESULT comment exists.
  const cRes = await _get(`${base}/api/issues/${id}/comments`);
  if (cRes.networkError) {
    log(`test-runner sweep: ${ident} comments fetch network error -> skip this run`);
    return null;
  }
  const comments = Array.isArray(cRes.body) ? cRes.body : [];
  if (comments.some((c) => /TEST RESULT/i.test(String(c.body || "")))) {
    log(`test-runner sweep: ${ident} already has a TEST RESULT comment -> skip (bounded, no double-dispatch)`);
    return "skip";
  }

  // Resolve the test command via the REAL fenced-block parser (test-command block
  // -> test-cmd: line -> repo default), then enforce the allowlist.
  const cmdStr = parseTestCommand(it.description);
  let argv = DEFAULT_TEST_CMD;
  let notAllowlisted = false;
  let blockedCmd = null;
  if (cmdStr) {
    argv = cmdStr.split(/\s+/).filter(Boolean);
    if (argv.length === 0 || !isAllowed(argv)) {
      notAllowlisted = true;
      blockedCmd = cmdStr;
    }
  }
  // else: no command found -> default (already allowlisted).

  if (notAllowlisted) {
    const body =
      `TEST RESULT: FAIL (ops-watcher/test-runner sweep — ${iso()})\n` +
      `Issue: ${ident}\n` +
      `Command: ${blockedCmd}\n` +
      `Result: Test command not on the allowlist — not executed.\n`;
    await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null });
    // Leave TEST_REQUIRED in place; leave status unchanged (rework signal).
    log(`test-runner sweep: ${ident} FAIL (command not on the allowlist: ${blockedCmd}) — not executed, TEST_REQUIRED retained`);
    return "fail";
  }

  // Run the allowlisted command.
  log(`test-runner sweep: ${ident} running: ${argv.join(" ")}`);
  const r = await runCommand(argv);
  const timedOut = !!r.timedOut;
  const outcome = timedOut ? "FAIL" : (r.code === 0 ? "PASS" : "FAIL");
  const detail = timedOut
    ? `Test command timed out after ${TEST_TIMEOUT_MS / 1000}s`
    : `exit code ${r.code}`;
  const body =
    `TEST RESULT: ${outcome} (ops-watcher/test-runner sweep — ${iso()})\n` +
    `Issue: ${ident}\n` +
    `Command: ${argv.join(" ")}\n` +
    `Result: ${detail}\n` +
    `--- stdout ---\n${cap(r.stdout)}\n--- stderr ---\n${cap(r.stderr)}\n`;
  const c = await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user", authorAgentId: null });
  if (c.networkError) log(`test-runner sweep: ${ident} comment post network error: ${c.networkErrorMessage}`);
  else log(`test-runner sweep: ${ident} posted ${outcome} comment (status ${c.status})`);

  // Label + status transition.
  const curLabelIds = Array.isArray(it.labelIds) ? it.labelIds.slice() : [];
  if (outcome === "PASS") {
    const next = new Set(curLabelIds);
    next.delete(labelMap.TEST_REQUIRED);
    next.add(labelMap.REVIEW_REQUIRED);
    // IMPORTANT: PASS swaps the label but does NOT change the issue status — it
    // stays whatever it was (typically todo). The review lane picks it up purely
    // on the REVIEW_REQUIRED label. (This differs from runTestOnce, which sets
    // status=in_review; the regression-test spec for runTestSweep mandates
    // status stays todo on PASS.)
    const p = await _patch(`${base}/api/issues/${id}`, { labelIds: [...next] });
    if (p.networkError) log(`test-runner sweep: ${ident} PASS PATCH network error: ${p.networkErrorMessage}`);
    else log(`test-runner sweep: ${ident} PASS -> swapped TEST_REQUIRED for REVIEW_REQUIRED, status unchanged (PATCH ${p.status})`);
    return "pass";
  } else {
    // FAIL: leave TEST_REQUIRED, leave status unchanged (rework signal). No loop.
    log(`test-runner sweep: ${ident} FAIL -> kept TEST_REQUIRED, status unchanged`);
    return "fail";
  }
}

// =====================================================================
// LEGACY ENTRYPOINT: runTestOnce (kept for runners.regression.test.mjs + T7)
// =====================================================================
// deps: { base, companyId, httpGet, httpPost, httpPatch, runCommand, log, now,
//         lockFile, acquireLock, releaseLock, isAlive, lockPid, _fs }
export async function runTestOnce(deps) {
  const {
    base,
    companyId = COMPANY_ID,
    httpGet: _get = httpGet,
    httpPost: _post = httpPost,
    httpPatch: _patch = httpPatch,
    runCommand = runCommandReal,
    log = (m) => console.log(m),
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
    const msg = (err && err.stack) ? err.stack : String(err);
    log(`test-runner: lock acquire threw (${msg}) -> refusing to run (no double-dispatch on unknown lock state)`);
    return { results, error: "lock-failed", refused: true };
  }
  if (!lock.acquired) {
    log(`test-runner: REFUSING to run — another --once sweep is already in progress (pid=${lock.pid}). Remove ${path.basename(lockFile)} only if you are sure it is stale. No Paperclip reads/writes performed, no double-dispatch risk.`);
    return { results, refused: true, pid: lock.pid };
  }
  log(`test-runner: acquired sweep lock (pid=${lock.pid}) at ${iso()}`);

  try {
    if (!base) {
      log("test-runner: no Paperclip base resolved (instance not running)");
      return { results, error: "no-base" };
    }

    // Ensure labels exist (idempotent). Includes OWNER_REQUIRED so a human can
    // apply the blocker label; the guard below checks by name regardless.
    const labelMap = await ensureLabels(base, companyId, LABEL_SPECS, _get, _post, log);
    if (!labelMap.TEST_REQUIRED || !labelMap.REVIEW_REQUIRED) {
      log("test-runner: could not ensure TEST_REQUIRED/REVIEW_REQUIRED labels");
      return { results, error: "labels" };
    }

    // List issues.
    const issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
    if (issuesRes.networkError) {
      log(`test-runner: issues list network error: ${issuesRes.networkErrorMessage}`);
      return { results, error: "network" };
    }
    const issues = Array.isArray(issuesRes.body) ? issuesRes.body : [];

    for (const it of issues) {
      const id = it.id;
      const ident = it.identifier || id;

      // H2: OWNER_REQUIRED blocker guard — checked FIRST, before any TEST_REQUIRED
      // logic, so an owner-blocked issue is never tested or transitioned even if
      // it also carries TEST_REQUIRED. Logged, not silent.
      if (hasLabel(it, "OWNER_REQUIRED")) {
        log(`test-runner: ${ident} skipped, OWNER_REQUIRED (owner-blocked, no action)`);
        continue;
      }

      const names = (it.labels || []).map((l) => (typeof l === "string" ? l : l.name || ""));
      if (!names.includes("TEST_REQUIRED")) continue;
      if (TERMINAL_STATUSES.has((it.status || "").toLowerCase())) continue;

      // H1: duplicate-dispatch protection — skip if a TEST RESULT comment already
      // exists (see "fresh" rule documented at top of file).
      const cRes0 = await _get(`${base}/api/issues/${id}/comments`);
      if (!cRes0.networkError) {
        const cmts0 = Array.isArray(cRes0.body) ? cRes0.body : [];
        if (cmts0.some((c) => /TEST RESULT/i.test(String(c.body || "")))) {
          log(`test-runner: ${ident} already has a TEST RESULT comment -> skip (bounded, no double-dispatch)`);
          continue;
        }
      }

      log(`test-runner: issue ${ident} (${id}) has TEST_REQUIRED; running test`);
      // H3: per-issue try/catch — a crashing/missing test binary or any unexpected
      // error for one issue must not kill the whole sweep.
      try {
        const r = await processOneIssue(it, base, companyId, labelMap, _get, _post, _patch, runCommand, log);
        results.push({ id, identifier: ident, ...r });
      } catch (err) {
        const msg = (err && err.stack) ? err.stack : String(err);
        log(`test-runner: ${ident} UNEXPECTED ERROR (continuing sweep): ${msg}`);
        results.push({ id, identifier: ident, outcome: "error", error: String(err && err.message || err) });
        // Best-effort: post a comment so the failure is visible in Paperclip, but
        // never let this itself crash the sweep.
        try {
          await _post(`${base}/api/issues/${id}/comments`, {
            body: `TEST RESULT (ops-watcher/test-runner — ${iso()}): ERROR\n` +
                  `Issue: ${ident}\n` +
                  `The test command threw an unexpected error (not a normal FAIL). Sweep continued.\n` +
                  `--- error ---\n${cap(msg)}\n`,
            authorType: "user",
          });
        } catch {
          /* never let the error-comment itself crash the sweep */
        }
      }
    }
    return { results };
  } finally {
    // Always release the lock — on success, on an early return (no-base /
    // network error / labels failure), and on a thrown error — so a crash here
    // never permanently wedges the test lane (the staleness check would also
    // recover it, but cleaning up is correct and matches ahmad-dispatch.mjs).
    try {
      await _releaseLock({ lockFile, _fs });
      log(`test-runner: released sweep lock (pid=${lock.pid})`);
    } catch (err) {
      log(`test-runner: WARN lock release threw (${err && err.message}) — staleness check will recover on next start`);
    }
  }
}

async function processOneIssue(it, base, companyId, labelMap, _get, _post, _patch, runCommand, log) {
  const id = it.id;
  // Resolve test command (legacy `test-cmd:` line form only).
  const parsed = parseTestCmd(it.description);
  let argv = DEFAULT_TEST_CMD;
  let notAllowlisted = false;
  if (parsed && parsed.rejected) {
    notAllowlisted = true;
    argv = null;
  } else if (parsed && parsed.argv) {
    argv = parsed.argv;
    if (!isAllowed(argv)) notAllowlisted = true;
  } else {
    // default — already allowlisted
  }

  let outcome = "FAIL";
  let detail = "";
  let stdout = "";
  let stderr = "";
  let code = null;
  let timedOut = false;

  if (notAllowlisted) {
    outcome = "FAIL";
    detail = `Test command not allowlisted: ${parsed && parsed.rejected ? parsed.rejected : (argv || []).join(" ")}`;
  } else {
    log(`test-runner: running: ${argv.join(" ")}`);
    const r = await runCommand(argv);
    code = r.code;
    stdout = r.stdout;
    stderr = r.stderr;
    timedOut = r.timedOut;
    outcome = r.timedOut ? "FAIL" : r.code === 0 ? "PASS" : "FAIL";
    detail = timedOut
      ? `Test command timed out after ${TEST_TIMEOUT_MS / 1000}s`
      : `exit code ${code}`;
  }

  // Post comment (board).
  const body =
    `TEST RESULT (ops-watcher/test-runner — ${iso()}): ${outcome}\n` +
    `Issue: ${it.identifier || id}\n` +
    `Command: ${notAllowlisted ? "(blocked)" : argv.join(" ")}\n` +
    `Result: ${detail}\n` +
    (timedOut ? "" : `--- stdout ---\n${cap(stdout)}\n--- stderr ---\n${cap(stderr)}\n`);
  const c = await _post(`${base}/api/issues/${id}/comments`, { body, authorType: "user" });
  if (c.networkError) log(`test-runner: comment post network error: ${c.networkErrorMessage}`);
  else if (c.authRequired) log("test-runner: comment post auth required (no token in local_trusted?)");
  else log(`test-runner: posted ${outcome} comment (status ${c.status})`);

  // Label + status transition.
  const curLabelIds = Array.isArray(it.labelIds) ? it.labelIds.slice() : [];
  if (outcome === "PASS") {
    const next = new Set(curLabelIds);
    next.delete(labelMap.TEST_REQUIRED);
    next.add(labelMap.REVIEW_REQUIRED);
    const p = await _patch(`${base}/api/issues/${id}`, {
      labelIds: [...next],
      status: "in_review",
    });
    if (p.networkError) log(`test-runner: PATCH network error: ${p.networkErrorMessage}`);
    else log(`test-runner: PASS -> swapped TEST_REQUIRED for REVIEW_REQUIRED, status=in_review (PATCH ${p.status})`);
  } else {
    // FAIL: leave TEST_REQUIRED, set status=todo (clear rework signal). No loop.
    const p = await _patch(`${base}/api/issues/${id}`, { status: "todo" });
    log(`test-runner: FAIL -> kept TEST_REQUIRED, status=todo (PATCH ${p.status})`);
  }
  return { outcome, code, timedOut, notAllowlisted };
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { once: false, selftest: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") out.once = true;
    else if (a === "--selftest") out.selftest = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  // PRODUCTION CUTOVER: main() calls runTestSweep (the real fenced-block-parser
  // sweep), NOT the legacy runTestOnce. runTestOnce is retained as an exported
  // function for runners.regression.test.mjs + the T7 lock test.
  const r = await runTestSweep({ base, log: (m) => console.log(m) });
  if (r.refused) {
    console.log(`test-runner --once: refused — another sweep is running (no Paperclip reads/writes performed)`);
    process.exit(0);
  }
  console.log(`test-runner --once: passed=${r.passed} failed=${r.failed} skipped=${r.skipped} processed=${r.processed} errors=${r.errors.length}`);
  for (const e of r.errors) console.log(`  error: ${e}`);
  if (args.selftest) {
    // selftest mode: run against nothing live — just sanity-check arg parsing.
    console.log("test-runner selftest: arg parse ok");
  }
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
    console.error("test-runner fatal:", err && err.stack ? err.stack : err);
    // Best-effort lock cleanup on fatal crash (the staleness check would also
    // recover this, but cleaning up is polite — mirrors ahmad-dispatch.mjs).
    fs.unlink(LOCK_FILE).catch(() => {});
    process.exit(1);
  });
}