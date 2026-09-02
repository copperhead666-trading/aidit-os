// ops-watcher/steward-sjs.regression.test.mjs
// Offline regression coverage for the STEWARD-SJS venture-repo health watcher.
// NO real git, NO real Paperclip, NO real ahmad-notify spawn, NO real lock files
// — runGit, isAlive, spawnNotify, readState/writeState, _fs, checkGitState,
// readmeFactsFn, acquireLock/releaseLock are all injected. Run with:
//   node ops-watcher/steward-sjs.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  runStewardSjsOnce,
  STEWARD_AGENT_ID,
  STEWARD_AGENT_NAME,
  checkGitStateReal,
  buildSnapshotReport,
} from "./steward-sjs.mjs";
import {
  acquireLock,
  releaseLock,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Real PID-based lock implementation against a per-test temp file (NOT the
// production LOCK_FILE) so this stays fully offline/deterministic and never
// collides with a real sweep or another test run.
const TMP_LOCK = path.join(__dirname, "steward-sjs.regression.lock.tmp");

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

// ---- A fake in-memory filesystem supporting the operations acquireLock and
// the sweep need: readFile, writeFile (with flag:"wx"), unlink. Files are
// stored in a Map keyed by full path. Mirrors steward.regression.test.mjs.
function fakeFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    readFile: async (p) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      return files.get(p);
    },
    writeFile: async (p, content, opts) => {
      if (opts && opts.flag === "wx" && files.has(p)) {
        const err = new Error(`EEXIST: ${p}`);
        err.code = "EEXIST";
        throw err;
      }
      files.set(p, content);
    },
    unlink: async (p) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      files.delete(p);
    },
    stat: async (p) => {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      return { isFile: () => true };
    },
  };
}

// ---- Fake state store (in-memory, passes state between runStewardSjsOnce calls) ----
function fakeStateStore() {
  let stored = { alerts: {} };
  return {
    readState: async () => JSON.parse(JSON.stringify(stored)),
    writeState: async (_file, state) => {
      stored = JSON.parse(JSON.stringify(state));
    },
    getStored: () => stored,
    reset: () => { stored = { alerts: {} }; },
  };
}

// ---- Build deps with the REAL lock implementation + a fake fs, so the
// single-instance lock is exercised against real acquireLock/releaseLock logic.
// The git check defaults to an OFFLINE stub here (in-sync, clean tree) so every
// existing test stays fully offline — no real git is ever spawned by the suite.
// New tests override checkGitState to exercise the wiring.
// ----
const LOCK_DIR = "/test-locks";
const SWEEP_LOCK = path.join(LOCK_DIR, "steward-sjs.lock");

// Fake git invocations: a map of args-array (joined) -> { code, stdout, stderr, timedOut }.
// Any args not in the map fall back to a default (success/empty).
function fakeRunGit(map, fallback = { code: 0, stdout: "", stderr: "", timedOut: false }) {
  return async (args) => {
    const key = args.join(" ");
    return map[key] ? { ...map[key] } : { ...fallback };
  };
}

// Offline default git check: returns a healthy in-sync, clean-tree state with
// no findings. Used by the generic-behavior tests so they never spawn git.
async function offlineCheckGitStateHealthy() {
  return {
    branch: "dev",
    detached: false,
    ahead: 0,
    behind: 0,
    fetchOk: true,
    dirtyFiles: [],
    recentCommits: ["abc1234 last commit", "def5678 earlier commit"],
    findings: [],
  };
}

function baseDeps(overrides = {}) {
  const notifyCalls = [];
  const stateStore = fakeStateStore();
  return {
    lockFile: SWEEP_LOCK,
    acquireLock,
    releaseLock,
    isAlive: () => false, // overridden per-test
    _fs: fakeFs(),
    lockDir: LOCK_DIR,
    spawnNotify: (msg) => {
      notifyCalls.push(msg);
      return { pid: 99999 };
    },
    readState: stateStore.readState,
    writeState: stateStore.writeState,
    now: () => 1_000_000,
    log: () => {},
    checkGitState: offlineCheckGitStateHealthy,
    readmeFactsFn: async () => ({ project: "SJS SuperApps (test)", sourceOfTruth: "This repository is the source of truth." }),
    ownerDecisionNeeded: "NO",
    // expose test-side collections for assertions:
    _notifyCalls: notifyCalls,
    _stateStore: stateStore,
    ...overrides,
  };
}

// Helper: create a fake fs pre-populated with lock files (none needed for these
// tests since the sweep only touches its own lock, but kept for parity).
function fsWithLocks() {
  return fakeFs();
}

// ---- identity export sanity check ----
function t0_identityExport() {
  assert.equal(
    STEWARD_AGENT_ID,
    "a55dbfd8-b828-4c86-9e97-3c9b478c3a9e",
    "T0: STEWARD_AGENT_ID matches the STEWARD-SJS Paperclip identity",
  );
  assert.equal(STEWARD_AGENT_NAME, "STEWARD-SJS", "T0: STEWARD_AGENT_NAME is STEWARD-SJS");
  ok("T0: STEWARD_AGENT_ID / STEWARD_AGENT_NAME exported and match the real STEWARD-SJS identity");
}

// =====================================================================
// T1: happy path — in sync, clean tree -> no findings, no alert, snapshot
// reports CLEAN / in sync.
// =====================================================================
async function t1_happyPathNoFindings() {
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true,
      dirtyFiles: [], recentCommits: ["abc1234 init"], findings: [],
    }),
  });
  const r = await runStewardSjsOnce(deps);
  assert.equal(r.criticalCount, 0, "T1: zero criticals");
  assert.equal(r.warningCount, 0, "T1: zero warnings");
  assert.equal(r.gapCount, 0, "T1: zero gaps");
  assert.equal(r.alerted, false, "T1: no alert on healthy state");
  assert.equal(deps._notifyCalls.length, 0, "T1: zero ahmad-notify spawns");
  assert.ok(/CLEAN/.test(r.snapshot), "T1: snapshot reports CLEAN working tree");
  assert.ok(/in sync with origin/.test(r.snapshot), "T1: snapshot reports in sync");
  assert.ok(/OWNER DECISION NEEDED: NO/.test(r.snapshot), "T1: OWNER DECISION NEEDED is NO");
  ok("T1: happy path (in sync, clean tree) -> no findings, no alert, snapshot says CLEAN/in-sync");
}

// =====================================================================
// T2: behind origin -> WARNING, no alert (warnings never alert on their own)
// =====================================================================
async function t2_behindOriginIsWarning() {
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 0, behind: 5, fetchOk: true,
      dirtyFiles: [], recentCommits: ["abc1234 local"], findings: [
        { key: "git-behind-origin", check: "git-state", severity: "WARNING",
          detail: "local dev is 5 commit(s) behind origin/dev — a human should sync" },
      ],
    }),
  });
  const r = await runStewardSjsOnce(deps);
  assert.equal(r.warningCount, 1, "T2: one warning");
  assert.equal(r.criticalCount, 0, "T2: zero criticals");
  assert.equal(r.alerted, false, "T2: warning alone does NOT alert");
  assert.equal(deps._notifyCalls.length, 0, "T2: zero spawns");
  const w = r.findings.find((f) => f.key === "git-behind-origin");
  assert.equal(w.severity, "WARNING", "T2: behind-origin is WARNING, not CRITICAL");
  assert.ok(/5 behind origin/.test(r.snapshot), "T2: snapshot reports behind count");
  ok("T2: behind origin -> WARNING (not CRITICAL), no alert spawned");
}

// =====================================================================
// T3: dirty tree -> WARNING, no alert
// =====================================================================
async function t3_dirtyTreeIsWarning() {
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true,
      dirtyFiles: [" M frontend/page.tsx", "?? notes.md"], recentCommits: [],
      findings: [
        { key: "git-dirty-tree", check: "git-state", severity: "WARNING",
          detail: "working tree has 2 uncommitted change(s)" },
      ],
    }),
  });
  const r = await runStewardSjsOnce(deps);
  assert.equal(r.warningCount, 1, "T3: one warning");
  assert.equal(r.criticalCount, 0, "T3: zero criticals");
  assert.equal(r.alerted, false, "T3: dirty tree alone does NOT alert");
  const w = r.findings.find((f) => f.key === "git-dirty-tree");
  assert.equal(w.severity, "WARNING", "T3: dirty tree is WARNING");
  assert.ok(/DIRTY/.test(r.snapshot), "T3: snapshot reports DIRTY working tree");
  assert.ok(/frontend\/page\.tsx/.test(r.snapshot), "T3: snapshot lists the dirty file");
  ok("T3: dirty tree -> WARNING (not CRITICAL), surfaced honestly in snapshot, no alert");
}

// =====================================================================
// T4: a git command failing/timing out -> GAP, never a crash or false all-clear
// =====================================================================
async function t4_gitFailureIsGapNotCrash() {
  // (a) checkGitState throws entirely -> the sweep catches it as a GAP.
  const depsA = baseDeps({
    checkGitState: async () => { throw new Error("git binary exploded"); },
  });
  const rA = await runStewardSjsOnce(depsA);
  assert.equal(rA.gapCount, 1, "T4a: one gap on thrown checkGitState");
  assert.equal(rA.criticalCount, 0, "T4a: zero criticals");
  assert.equal(rA.warningCount, 0, "T4a: zero warnings (the throw is a GAP, not a false all-clear)");
  assert.ok(/git-state/.test(rA.findings[0].key), "T4a: gap key is git-state");
  assert.equal(rA.findings[0].severity, "GAP", "T4a: thrown check is GAP");
  assert.ok(/UNKNOWN/.test(rA.snapshot), "T4a: snapshot reports UNKNOWN state");

  // (b) git rev-parse times out -> checkGitStateReal surfaces a GAP.
  const runGitTimeout = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
  const gitState = await checkGitStateReal({ runGit: runGitTimeout });
  const branchGap = gitState.findings.find((f) => f.key === "git-branch");
  assert.ok(branchGap, "T4b: git-branch gap finding exists on timeout");
  assert.equal(branchGap.severity, "GAP", "T4b: branch timeout is GAP");
  assert.equal(gitState.branch, null, "T4b: branch is null after timeout");

  ok("T4: git command failing/timing out -> GAP (never a crash, never a false all-clear)");
}

// =====================================================================
// T5: checkGitStateReal directly — behind origin via injected runGit produces
// a WARNING; in-sync produces no findings; dirty produces a WARNING.
// =====================================================================
async function t5_checkGitStateRealBehindAndDirty() {
  // In sync + clean -> no findings.
  const inSyncGit = fakeRunGit({
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "dev\n", stderr: "", timedOut: false },
    "status --porcelain": { code: 0, stdout: "", stderr: "", timedOut: false },
    "fetch origin": { code: 0, stdout: "", stderr: "", timedOut: false },
    "rev-list --count HEAD..origin/dev": { code: 0, stdout: "0\n", stderr: "", timedOut: false },
    "rev-list --count origin/dev..HEAD": { code: 0, stdout: "0\n", stderr: "", timedOut: false },
    "log --oneline -5": { code: 0, stdout: "abc1234 hi\n", stderr: "", timedOut: false },
  });
  const rSync = await checkGitStateReal({ runGit: inSyncGit });
  assert.equal(rSync.findings.length, 0, "T5a: no findings when in sync + clean");
  assert.equal(rSync.behind, 0, "T5a: behind 0");
  assert.equal(rSync.ahead, 0, "T5a: ahead 0");

  // Behind origin -> WARNING.
  const behindGit = fakeRunGit({
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "dev\n", stderr: "", timedOut: false },
    "status --porcelain": { code: 0, stdout: "", stderr: "", timedOut: false },
    "fetch origin": { code: 0, stdout: "", stderr: "", timedOut: false },
    "rev-list --count HEAD..origin/dev": { code: 0, stdout: "22\n", stderr: "", timedOut: false },
    "rev-list --count origin/dev..HEAD": { code: 0, stdout: "0\n", stderr: "", timedOut: false },
    "log --oneline -5": { code: 0, stdout: "abc1234 hi\n", stderr: "", timedOut: false },
  });
  const rBehind = await checkGitStateReal({ runGit: behindGit });
  assert.equal(rBehind.behind, 22, "T5b: behind 22");
  const w = rBehind.findings.find((f) => f.key === "git-behind-origin");
  assert.ok(w, "T5b: git-behind-origin finding exists");
  assert.equal(w.severity, "WARNING", "T5b: behind is WARNING");
  assert.ok(/22 commit\(s\) behind/.test(w.detail), "T5b: detail mentions 22 commits");

  // Dirty tree -> WARNING.
  const dirtyGit = fakeRunGit({
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "dev\n", stderr: "", timedOut: false },
    "status --porcelain": { code: 0, stdout: " M a.ts\n?? b.md\n", stderr: "", timedOut: false },
    "fetch origin": { code: 0, stdout: "", stderr: "", timedOut: false },
    "rev-list --count HEAD..origin/dev": { code: 0, stdout: "0\n", stderr: "", timedOut: false },
    "rev-list --count origin/dev..HEAD": { code: 0, stdout: "3\n", stderr: "", timedOut: false },
    "log --oneline -5": { code: 0, stdout: "abc1234 hi\n", stderr: "", timedOut: false },
  });
  const rDirty = await checkGitStateReal({ runGit: dirtyGit });
  assert.equal(rDirty.dirtyFiles.length, 2, "T5c: two dirty files");
  assert.equal(rDirty.ahead, 3, "T5c: ahead 3 (reported as fact, not a finding)");
  const dw = rDirty.findings.find((f) => f.key === "git-dirty-tree");
  assert.ok(dw, "T5c: git-dirty-tree finding exists");
  assert.equal(dw.severity, "WARNING", "T5c: dirty tree is WARNING");
  // ahead > 0 must NOT be a finding (it's normal pre-push work).
  assert.equal(rDirty.findings.some((f) => /ahead/.test(f.key)), false, "T5c: ahead is NOT a finding");

  ok("T5: checkGitStateReal — in-sync clean (no findings), behind (WARNING), dirty (WARNING), ahead reported as fact not finding");
}

// =====================================================================
// T6: git fetch failure -> GAP (cannot verify sync freshness; never a false
// all-clear). Behind/ahead must NOT be reported as if current.
// =====================================================================
async function t6_fetchFailureIsGap() {
  const fetchFailGit = fakeRunGit({
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "dev\n", stderr: "", timedOut: false },
    "status --porcelain": { code: 0, stdout: "", stderr: "", timedOut: false },
    "fetch origin": { code: 1, stdout: "", stderr: "fatal: could not reach origin", timedOut: false },
    "log --oneline -5": { code: 0, stdout: "abc1234 hi\n", stderr: "", timedOut: false },
  });
  const r = await checkGitStateReal({ runGit: fetchFailGit });
  const fetchGap = r.findings.find((f) => f.key === "git-fetch");
  assert.ok(fetchGap, "T6: git-fetch gap finding exists");
  assert.equal(fetchGap.severity, "GAP", "T6: fetch failure is GAP");
  assert.equal(r.fetchOk, false, "T6: fetchOk false");
  assert.equal(r.behind, null, "T6: behind is null (not reported as a fake 0)");
  assert.equal(r.ahead, null, "T6: ahead is null (not reported as a fake 0)");
  // No git-behind-origin finding (can't compute without fetch).
  assert.equal(r.findings.some((f) => f.key === "git-behind-origin"), false, "T6: no behind finding when fetch failed");
  ok("T6: git fetch failure -> GAP, behind/ahead null (no false all-clear, no fake in-sync)");
}

// =====================================================================
// T7: detached HEAD -> GAP (cannot compare to a named origin branch)
// =====================================================================
async function t7_detachedHeadIsGap() {
  const detachedGit = fakeRunGit({
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "HEAD\n", stderr: "", timedOut: false },
    "status --porcelain": { code: 0, stdout: "", stderr: "", timedOut: false },
    "log --oneline -5": { code: 0, stdout: "abc1234 hi\n", stderr: "", timedOut: false },
  });
  const r = await checkGitStateReal({ runGit: detachedGit });
  assert.equal(r.detached, true, "T7: detached flag true");
  assert.equal(r.branch, "HEAD", "T7: branch is HEAD");
  const gap = r.findings.find((f) => f.key === "git-branch");
  assert.ok(gap, "T7: git-branch gap finding exists for detached HEAD");
  assert.equal(gap.severity, "GAP", "T7: detached HEAD is GAP");
  // No fetch should have run (skipped for detached).
  assert.equal(r.fetchOk, false, "T7: fetch skipped (detached)");
  ok("T7: detached HEAD -> GAP, fetch skipped");
}

// =====================================================================
// T8: snapshot report shape — all 9 sj-snapshot.md fields present, LAST
// VERIFIED is a real ISO timestamp, OWNER DECISION NEEDED honored.
// =====================================================================
async function t8_snapshotReportShape() {
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 2, behind: 0, fetchOk: true,
      dirtyFiles: [" M x.ts"], recentCommits: ["abc1234 hi", "def5678 bye"], findings: [
        { key: "git-dirty-tree", check: "git-state", severity: "WARNING", detail: "1 uncommitted" },
      ],
    }),
    ownerDecisionNeeded: "NO",
  });
  const r = await runStewardSjsOnce(deps);
  const s = r.snapshot;
  for (const field of [
    "PROJECT:", "STATE:", "CANONICAL SOURCE:", "LAST VERIFIED:",
    "WHAT CHANGED:", "ACTIVE TASKS:", "BLOCKERS:", "SAFETY:",
    "OWNER DECISION NEEDED:",
  ]) {
    assert.ok(s.includes(field), `T8: snapshot contains "${field}"`);
  }
  // LAST VERIFIED is a real ISO timestamp.
  const m = s.match(/LAST VERIFIED: (\S+)/);
  assert.ok(m, "T8: LAST VERIFIED line present");
  const parsed = Date.parse(m[1]);
  assert.ok(Number.isFinite(parsed), "T8: LAST VERIFIED is a parseable ISO timestamp");
  // OWNER DECISION NEEDED honored from deps.
  assert.ok(/OWNER DECISION NEEDED: NO/.test(s), "T8: OWNER DECISION NEEDED is NO");
  ok("T8: snapshot report has all 9 sj-snapshot fields, LAST VERIFIED is a real ISO timestamp");
}

// =====================================================================
// T9: OWNER DECISION NEEDED defaults to NO and is only YES when a real open
// owner-decision item is passed in — never fabricated.
// =====================================================================
async function t9_ownerDecisionNoByDefault() {
  const depsYes = baseDeps({
    checkGitState: offlineCheckGitStateHealthy,
    ownerDecisionNeeded: "YES — open decision X (see handoffs/sjahrir/OWNER-BACKLOG-DECISIONS.md)",
  });
  const rYes = await runStewardSjsOnce(depsYes);
  assert.ok(/OWNER DECISION NEEDED: YES/.test(rYes.snapshot), "T9a: YES honored when a real item is passed");

  const depsNo = baseDeps({ checkGitState: offlineCheckGitStateHealthy }); // default NO
  const rNo = await runStewardSjsOnce(depsNo);
  assert.ok(/OWNER DECISION NEEDED: NO/.test(rNo.snapshot), "T9b: NO by default");
  ok("T9: OWNER DECISION NEEDED defaults to NO, honored as YES only when a real item is passed (never fabricated)");
}

// =====================================================================
// T10: critical findings -> exactly ONE bundled ahmad-notify spawn with
// STEWARD-SJS attribution (the real git checks produce no CRITICALs today;
// this test injects one to exercise the alert bundling wiring).
// =====================================================================
async function t10_criticalsProduceOneBundledSpawn() {
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true,
      dirtyFiles: [], recentCommits: [], findings: [
        { key: "git-critical-A", check: "git-state", severity: "CRITICAL", detail: "critical A detail" },
        { key: "git-critical-B", check: "git-state", severity: "CRITICAL", detail: "critical B detail" },
      ],
    }),
  });
  const r = await runStewardSjsOnce(deps);
  assert.equal(r.criticalCount, 2, "T10: two criticals");
  assert.equal(deps._notifyCalls.length, 1, "T10: exactly ONE bundled spawn");
  assert.equal(r.alerted, true, "T10: alerted true");
  const msg = deps._notifyCalls[0];
  assert.ok(/critical A detail/.test(msg), "T10: message includes critical A");
  assert.ok(/critical B detail/.test(msg), "T10: message includes critical B");
  assert.ok(/STEWARD-SJS/.test(msg), "T10: message attributed to STEWARD-SJS");
  assert.ok(/a55dbfd8-b828-4c86-9e97-3c9b478c3a9e/.test(msg), "T10: message includes STEWARD-SJS Paperclip id");
  ok("T10: multiple CRITICAL findings -> exactly ONE bundled ahmad-notify spawn, attributed to STEWARD-SJS");
}

// =====================================================================
// T11: no criticals -> zero spawns (warnings/gaps never alert on their own)
// =====================================================================
async function t11_noCriticalsZeroSpawns() {
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 0, behind: 3, fetchOk: true,
      dirtyFiles: [" M x.ts"], recentCommits: [], findings: [
        { key: "git-behind-origin", check: "git-state", severity: "WARNING", detail: "behind" },
        { key: "git-dirty-tree", check: "git-state", severity: "WARNING", detail: "dirty" },
      ],
    }),
  });
  const r = await runStewardSjsOnce(deps);
  assert.equal(r.criticalCount, 0, "T11: zero criticals");
  assert.equal(r.warningCount, 2, "T11: two warnings");
  assert.equal(deps._notifyCalls.length, 0, "T11: zero spawns (warnings alone never alert)");
  assert.equal(r.alerted, false, "T11: alerted false");
  ok("T11: warnings + no criticals -> zero ahmad-notify spawns (no Telegram noise for drift)");
}

// =====================================================================
// T12: cooldown suppresses duplicate re-alert within the window
// =====================================================================
async function t12_cooldownSuppressesWithinWindow() {
  let clock = 1_000_000;
  const criticalFinding = {
    key: "git-critical-A", check: "git-state", severity: "CRITICAL", detail: "same critical detail",
  };
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true,
      dirtyFiles: [], recentCommits: [], findings: [criticalFinding],
    }),
    now: () => clock,
  });
  const r1 = await runStewardSjsOnce(deps);
  assert.equal(deps._notifyCalls.length, 1, "T12: first run alerts");
  assert.equal(r1.alerted, true, "T12: first run alerted");

  clock += 30 * 60 * 1000; // 30 min — within 1h cooldown
  const r2 = await runStewardSjsOnce(deps);
  assert.equal(deps._notifyCalls.length, 1, "T12: second run within cooldown does NOT spawn");
  assert.equal(r2.alerted, false, "T12: second run alerted false");
  assert.ok(r2.suppressedCount >= 1, "T12: suppressedCount reflects the suppressed critical");
  ok("T12: same critical within 1-hour cooldown -> suppressed (no duplicate alert)");
}

// =====================================================================
// T13: re-alerts after cooldown passes
// =====================================================================
async function t13_reAlertsAfterCooldown() {
  let clock = 5_000_000;
  const criticalFinding = {
    key: "git-critical-A", check: "git-state", severity: "CRITICAL", detail: "same critical detail",
  };
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true,
      dirtyFiles: [], recentCommits: [], findings: [criticalFinding],
    }),
    now: () => clock,
  });
  await runStewardSjsOnce(deps);
  assert.equal(deps._notifyCalls.length, 1, "T13: first run alerts");
  clock += 60 * 60 * 1000 + 1; // past 1h cooldown
  const r2 = await runStewardSjsOnce(deps);
  assert.equal(deps._notifyCalls.length, 2, "T13: second run past cooldown re-alerts");
  assert.equal(r2.alerted, true, "T13: second run alerted");
  ok("T13: same critical past 1-hour cooldown -> re-alerts");
}

// =====================================================================
// T14: cleared finding re-alerts immediately on fresh recurrence (state
// cleared when no longer critical — mirrors steward.regression T11).
// =====================================================================
async function t14_clearedFindingReAlertsImmediately() {
  let clock = 10_000_000;
  let criticalActive = true;
  const criticalFinding = {
    key: "git-critical-A", check: "git-state", severity: "CRITICAL", detail: "same critical detail",
  };
  const deps = baseDeps({
    checkGitState: async () => ({
      branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true,
      dirtyFiles: [], recentCommits: [],
      findings: criticalActive ? [criticalFinding] : [],
    }),
    now: () => clock,
  });
  // Run 1: critical -> alert.
  await runStewardSjsOnce(deps);
  assert.equal(deps._notifyCalls.length, 1, "T14: run 1 alerts");
  // Run 2: clears -> no criticals, state cleared.
  criticalActive = false;
  const r2 = await runStewardSjsOnce(deps);
  assert.equal(r2.criticalCount, 0, "T14: run 2 zero criticals");
  assert.equal(deps._notifyCalls.length, 1, "T14: run 2 no alert");
  assert.equal(Object.keys(deps._stateStore.getStored().alerts).length, 0, "T14: state cleared");
  // Run 3: fresh recurrence -> alerts immediately despite short elapsed time.
  criticalActive = true;
  clock += 5 * 60 * 1000; // 5 min (within cooldown, but state was cleared)
  const r3 = await runStewardSjsOnce(deps);
  assert.equal(deps._notifyCalls.length, 2, "T14: run 3 alerts immediately on fresh recurrence");
  assert.equal(r3.alerted, true, "T14: run 3 alerted");
  ok("T14: cleared finding re-alerts immediately on fresh recurrence (state cleared when it recovered)");
}

// =====================================================================
// T15: single-instance lock — two concurrent runStewardSjsOnce calls, only
// one actually runs. Mirrors steward.regression T12.
// =====================================================================
async function t15_singleInstanceLockOnlyOneRuns() {
  const sharedFs = fakeFs();
  let checkCalls = 0;
  let signalAInSweep;
  const aInSweep = new Promise((res) => { signalAInSweep = res; });
  const WINNER_PID = 424243;
  let notifyCount = 0;
  const criticalFinding = {
    key: "git-critical-A", check: "git-state", severity: "CRITICAL", detail: "critical A",
  };

  const sharedDeps = {
    lockFile: SWEEP_LOCK,
    acquireLock,
    releaseLock,
    isAlive: (pid) => pid === WINNER_PID,
    _fs: sharedFs,
    spawnNotify: () => { notifyCount += 1; return { pid: 88888 }; },
    readState: async () => ({ alerts: {} }),
    writeState: async () => {},
    now: () => 20_000_000,
    log: () => {},
    checkGitState: async () => {
      checkCalls += 1;
      if (checkCalls === 1) signalAInSweep();
      await new Promise((r) => setTimeout(r, 25));
      return {
        branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true,
        dirtyFiles: [], recentCommits: [], findings: [criticalFinding],
      };
    },
    readmeFactsFn: async () => ({ project: "SJS SuperApps (test)", sourceOfTruth: "source of truth" }),
  };

  // Launch sweep A (do not await) — acquires the lock and enters checks.
  const pA = runStewardSjsOnce({ ...sharedDeps, lockPid: WINNER_PID });
  await aInSweep; // A has provably acquired the lock and is inside its checks.

  // NOW launch sweep B against the same live state while A is still running.
  const rB = await runStewardSjsOnce({ ...sharedDeps, lockPid: WINNER_PID + 1 });
  const rA = await pA;

  assert.equal(rB.refused, true, "T15: sweep B is refused (lock held by A)");
  assert.ok(rB.pid === WINNER_PID, "T15: B's refused pid is A's lock pid");
  assert.equal(rB.findings.length, 0, "T15: refused sweep records no findings");
  assert.equal(checkCalls, 1, "T15: checkGitState called exactly once (B never ran checks)");
  assert.ok(rA.findings.some((f) => f.key === "git-critical-A"), "T15: sweep A found the critical");
  assert.equal(notifyCount, 1, "T15: exactly one alert spawn (only A alerts, B refused)");
  ok("T15: single-instance lock — two concurrent STEWARD-SJS sweeps, only one runs (B refused before any checks)");
}

// =====================================================================
// T16: lock acquire throws -> clean refusal, no false all-clear
// =====================================================================
async function t16_lockAcquireThrowsRefuses() {
  const deps = baseDeps({
    acquireLock: async () => { throw new Error("disk full"); },
  });
  const r = await runStewardSjsOnce(deps);
  assert.equal(r.refused, true, "T16: refused on lock acquire throw");
  assert.equal(r.error, "lock-failed", "T16: error is lock-failed");
  assert.equal(r.findings.length, 0, "T16: no findings (no checks performed)");
  assert.equal(deps._notifyCalls.length, 0, "T16: no alert (no false all-clear)");
  ok("T16: lock acquire throws -> clean refusal (no false all-clear, no checks performed)");
}

// =====================================================================
// T17: buildSnapshotReport directly — OWNER DECISION NEEDED passes through,
// STATE reflects detached/unknown correctly.
// =====================================================================
function t17_buildSnapshotReportVariants() {
  const rf = { project: "SJS SuperApps (operational ERP for SJS)", sourceOfTruth: "This repository is the source of truth." };
  const ts = "2026-09-01T00:00:00.000Z";

  // (a) healthy
  const a = buildSnapshotReport(
    { branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true, dirtyFiles: [], recentCommits: ["c1"], findings: [] },
    rf, ts, "NO",
  );
  assert.ok(/in sync with origin/.test(a), "T17a: healthy reports in sync");
  assert.ok(/CLEAN/.test(a), "T17a: healthy reports CLEAN");
  assert.ok(/BLOCKERS: none/.test(a), "T17a: healthy has no blockers");

  // (b) detached
  const b = buildSnapshotReport(
    { branch: "HEAD", detached: true, ahead: null, behind: null, fetchOk: false, dirtyFiles: [], recentCommits: [], findings: [] },
    rf, ts, "NO",
  );
  assert.ok(/DETACHED HEAD/.test(b), "T17b: detached reports DETACHED HEAD");

  // (c) unknown branch
  const c = buildSnapshotReport(
    { branch: null, detached: false, ahead: null, behind: null, fetchOk: false, dirtyFiles: [], recentCommits: [], findings: [] },
    rf, ts, "NO",
  );
  assert.ok(/UNKNOWN/.test(c), "T17c: null branch reports UNKNOWN");

  ok("T17: buildSnapshotReport — healthy (in sync/clean/no blockers), detached, unknown-branch variants all correct");
}

// =====================================================================
// Runner
// =====================================================================
// =====================================================================
// T18: a notify spawn that never started must not advance the cooldown.
// The failure arrives as a return value ({ pid: undefined }), not a throw.
// =====================================================================
async function t18_failedSpawnDoesNotAdvanceCooldown() {
  let clock = 1_000_000;
  let spawnOk = false;
  const criticalGit = async () => ({
    branch: "dev", detached: false, ahead: 0, behind: 0, fetchOk: true,
    dirtyFiles: [], recentCommits: [], findings: [
      { key: "git-critical-A", check: "git-state", severity: "CRITICAL", detail: "critical A detail" },
    ],
  });
  const deps = baseDeps({
    now: () => clock,
    checkGitState: criticalGit,
    spawnNotify: () => (spawnOk ? { pid: 4242 } : { pid: undefined }),
  });

  const r1 = await runStewardSjsOnce(deps);
  assert.equal(r1.criticalCount, 1, "T18: the critical was found");
  assert.equal(r1.alerted, false, "T18: a spawn with no pid is not a delivered alert");

  clock += 60 * 1000;
  spawnOk = true;
  const r2 = await runStewardSjsOnce(deps);
  assert.equal(r2.alerted, true, "T18: an undelivered finding is retried on the next sweep");
  assert.equal(r2.suppressedCount, 0, "T18: it was never counted as suppressed");
  ok("T18: a failed notify spawn does not stamp the cooldown");
}

async function main() {
  const tests = [
    t0_identityExport,
    t1_happyPathNoFindings,
    t2_behindOriginIsWarning,
    t3_dirtyTreeIsWarning,
    t4_gitFailureIsGapNotCrash,
    t5_checkGitStateRealBehindAndDirty,
    t6_fetchFailureIsGap,
    t7_detachedHeadIsGap,
    t8_snapshotReportShape,
    t9_ownerDecisionNoByDefault,
    t10_criticalsProduceOneBundledSpawn,
    t11_noCriticalsZeroSpawns,
    t12_cooldownSuppressesWithinWindow,
    t13_reAlertsAfterCooldown,
    t14_clearedFindingReAlertsImmediately,
    t15_singleInstanceLockOnlyOneRuns,
    t16_lockAcquireThrowsRefuses,
    t17_buildSnapshotReportVariants,
    t18_failedSpawnDoesNotAdvanceCooldown,
  ];
  for (const t of tests) await t();
  await fs.unlink(TMP_LOCK).catch(() => {});
  console.log(`\nsteward-sjs.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();