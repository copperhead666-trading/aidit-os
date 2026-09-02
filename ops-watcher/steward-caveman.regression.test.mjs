// Offline regression coverage for STEWARD-CAVEMAN.
// No real git, no real Caveman file reads, no real ahmad-notify spawn.
//
//   node ops-watcher/steward-caveman.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import {
  runStewardCavemanOnce,
  checkGitStateReal,
  checkSafetyComplianceReal,
  STEWARD_CAVEMAN_AGENT_ID,
} from "./steward-caveman.mjs";
import {
  acquireLock,
  releaseLock,
} from "./telegram-listener-daemon.mjs";

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

const LOCK_DIR = "/test-locks";
const SWEEP_LOCK = path.join(LOCK_DIR, "steward-caveman.lock");

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
    stat: async () => ({ isDirectory: () => true, isFile: () => true }),
    _files: files,
  };
}

function fakeStateStore() {
  let stored = { alerts: {} };
  return {
    readState: async () => JSON.parse(JSON.stringify(stored)),
    writeState: async (_file, state) => {
      stored = JSON.parse(JSON.stringify(state));
    },
    getStored: () => stored,
  };
}

function baseDeps(overrides = {}) {
  const notifyCalls = [];
  const stateStore = fakeStateStore();
  return {
    lockFile: SWEEP_LOCK,
    acquireLock,
    releaseLock,
    isAlive: () => false,
    _fs: fakeFs(),
    checkRepoReachability: async () => ({ reachable: true, findings: [] }),
    checkGitState: async () => [],
    checkSafetyCompliance: async () => ({
      findings: [],
      structuralState: {
        instrument: { source: "README.md", field: "README Phase 1 status", value: "UNREACHABLE: no live trading state source in this repo" },
        direction: { source: "README.md", field: "README Phase 1 status", value: "UNREACHABLE: no live trading state source in this repo" },
        status: { source: "control/project-state.json", field: "phase.current", value: "SHADOW_VALIDATION" },
        lastUpdated: { source: "control/review-verdict.json", field: "reviewer.reviewed_at", value: "2026-08-16" },
      },
    }),
    spawnNotify: (msg) => {
      notifyCalls.push(msg);
      return { pid: 77777 };
    },
    readState: stateStore.readState,
    writeState: stateStore.writeState,
    now: () => 1_000_000,
    log: () => {},
    _notifyCalls: notifyCalls,
    _stateStore: stateStore,
    ...overrides,
  };
}

function lockEntry(pid) {
  return JSON.stringify({ pid, startedAt: "2026-01-01T00:00:00.000Z" });
}

function okResult(stdout = "") {
  return { code: 0, stdout, stderr: "", timedOut: false };
}

function runGitFrom(map) {
  return async (args) => {
    const key = args.join(" ");
    if (!(key in map)) throw new Error(`unexpected git command: ${key}`);
    const value = map[key];
    return typeof value === "function" ? value(args) : value;
  };
}

function jsonReader(files) {
  return async (relPath) => {
    if (!(relPath in files)) {
      return {
        ok: false,
        timedOut: false,
        value: null,
        error: `${relPath} missing`,
      };
    }
    return {
      ok: true,
      timedOut: false,
      value: typeof files[relPath] === "string" ? files[relPath] : JSON.stringify(files[relPath]),
      error: null,
    };
  };
}

function safeProjectState(overrides = {}) {
  return {
    architecture: { status: "FROZEN" },
    phase: { current: "SHADOW_VALIDATION" },
    capability_gates: {
      live_trading_allowed: false,
      micro_live_allowed: false,
      ...overrides.capability_gates,
    },
    owner_decisions: {
      operating_scope: {
        live_capital_authorised: false,
        ...overrides.owner_operating_scope,
      },
    },
    ...overrides.root,
  };
}

function safeReviewVerdict(overrides = {}) {
  return {
    reviewer: { reviewed_at: "2026-08-16" },
    checklist: {
      no_real_capital_authorised: true,
      capability_gate_opened_by_this_task: false,
      ...overrides.checklist,
    },
    audit_summary: {
      scope: "Paper/demo only. live_trading_allowed and micro_live_allowed remain false.",
    },
  };
}

function t0_identityExport() {
  assert.equal(
    STEWARD_CAVEMAN_AGENT_ID,
    "516fd58f-24e6-4d8f-8234-34df848e2352",
    "T0: identity id matches the real Paperclip agent record",
  );
  ok("T0: STEWARD-CAVEMAN identity id is exported");
}

async function t1_happyPathNoFindings() {
  const deps = baseDeps();
  const r = await runStewardCavemanOnce(deps);
  assert.equal(r.criticalCount, 0, "T1: no criticals");
  assert.equal(r.warningCount, 0, "T1: no warnings");
  assert.equal(r.gapCount, 0, "T1: no gaps");
  assert.equal(r.findings.length, 0, "T1: no findings");
  assert.equal(deps._notifyCalls.length, 0, "T1: no alert");
  assert.equal(r.structuralState.status.value, "SHADOW_VALIDATION", "T1: structural state is returned");
  ok("T1: happy path in sync, clean tree, no live flag -> no findings");
}

async function t2_behindOriginWarning() {
  const findings = await checkGitStateReal({
    runGit: runGitFrom({
      "fetch origin": okResult(""),
      "status --porcelain": okResult(""),
      "symbolic-ref --quiet --short HEAD": okResult("main\n"),
      "rev-list --left-right --count HEAD...origin/main": okResult("0\t22\n"),
    }),
  });
  const f = findings.find((x) => x.key === "git-behind-origin");
  assert.ok(f, "T2: behind finding exists");
  assert.equal(f.severity, "WARNING", "T2: behind origin is warning");
  assert.ok(/22 commit/.test(f.detail), "T2: detail includes behind count");
  ok("T2: behind origin -> WARNING");
}

async function t3_dirtyTreeWarning() {
  const findings = await checkGitStateReal({
    runGit: runGitFrom({
      "fetch origin": okResult(""),
      "status --porcelain": okResult(" M control/project-state.json\n?? scratch.txt\n"),
      "symbolic-ref --quiet --short HEAD": okResult("main\n"),
      "rev-list --left-right --count HEAD...origin/main": okResult("0 0\n"),
    }),
  });
  const f = findings.find((x) => x.key === "git-dirty-tree");
  assert.ok(f, "T3: dirty tree finding exists");
  assert.equal(f.severity, "WARNING", "T3: dirty tree is warning");
  assert.ok(/2 porcelain line/.test(f.detail), "T3: detail includes dirty count");
  ok("T3: dirty tree -> WARNING");
}

async function t4_liveTradingFlagCritical() {
  const r = await checkSafetyComplianceReal({
    readTextFile: jsonReader({
      "README.md": "# Caveman Trading OS\nPhase 1 status only.\n",
      "control/project-state.json": safeProjectState({
        capability_gates: { live_trading_allowed: true },
      }),
      "control/review-verdict.json": safeReviewVerdict(),
    }),
  });
  const f = r.findings.find((x) => x.key === "live-trading-allowed");
  assert.ok(f, "T4: live trading critical exists");
  assert.equal(f.severity, "CRITICAL", "T4: live trading enabled shape is critical");
  assert.ok(/capability_gates\/live_trading_allowed/.test(f.detail), "T4: detail cites exact source field");
  ok("T4: synthetic live_trading_allowed=true fixture -> CRITICAL");
}

async function t5_readOrGitFailureGapNoCrash() {
  const gitFindings = await checkGitStateReal({
    runGit: async (args) => {
      if (args.join(" ") === "fetch origin") {
        return { code: null, stdout: "", stderr: "", timedOut: true };
      }
      return okResult("");
    },
  });
  assert.equal(gitFindings.find((x) => x.key === "git-fetch-origin")?.severity, "GAP", "T5: git timeout -> GAP");

  const safety = await checkSafetyComplianceReal({
    readTextFile: async (relPath) => ({
      ok: false,
      timedOut: relPath === "control/project-state.json",
      value: null,
      error: `${relPath} timed out`,
    }),
  });
  assert.ok(safety.findings.every((f) => f.severity === "GAP"), "T5: read failures are gaps");

  const deps = baseDeps({
    checkGitState: async () => { throw new Error("git exploded"); },
  });
  const r = await runStewardCavemanOnce(deps);
  assert.equal(r.gapCount, 1, "T5: thrown check becomes one GAP");
  assert.equal(r.criticalCount, 0, "T5: no false critical");
  assert.equal(deps._notifyCalls.length, 0, "T5: no false alert");
  ok("T5: git/read failure or timeout -> GAP, no crash, no false all-clear");
}

async function t6_singleInstanceLockOnlyOneRuns() {
  const sharedFs = fakeFs();
  let gitCalls = 0;
  let signalAInSweep;
  const aInSweep = new Promise((res) => { signalAInSweep = res; });
  const WINNER_PID = 424242;
  let notifyCount = 0;

  const sharedDeps = {
    lockFile: SWEEP_LOCK,
    acquireLock,
    releaseLock,
    isAlive: (pid) => pid === WINNER_PID,
    _fs: sharedFs,
    checkRepoReachability: async () => ({ reachable: true, findings: [] }),
    checkGitState: async () => {
      gitCalls += 1;
      if (gitCalls === 1) signalAInSweep();
      await new Promise((r) => setTimeout(r, 25));
      return [];
    },
    checkSafetyCompliance: async () => ({
      findings: [{ key: "live-trading-allowed", check: "safety-compliance", severity: "CRITICAL", detail: "critical" }],
      structuralState: null,
    }),
    spawnNotify: () => { notifyCount += 1; return { pid: 999 }; },
    readState: async () => ({ alerts: {} }),
    writeState: async () => {},
    now: () => 2_000_000,
    log: () => {},
  };

  const pA = runStewardCavemanOnce({ ...sharedDeps, lockPid: WINNER_PID });
  await aInSweep;
  const rB = await runStewardCavemanOnce({ ...sharedDeps, lockPid: WINNER_PID + 1 });
  const rA = await pA;

  assert.equal(rB.refused, true, "T6: second sweep refused");
  assert.equal(rB.pid, WINNER_PID, "T6: refused pid is first sweep");
  assert.equal(rB.findings.length, 0, "T6: refused sweep does no checks");
  assert.equal(gitCalls, 1, "T6: only first sweep ran checks");
  assert.equal(rA.criticalCount, 1, "T6: first sweep ran and found critical");
  assert.equal(notifyCount, 1, "T6: only first sweep alerted");
  ok("T6: single-instance lock refuses concurrent sweep before checks");
}

async function t7_alertBundlingAndCooldown() {
  let clock = 10_000_000;
  const deps = baseDeps({
    now: () => clock,
    checkGitState: async () => [
      { key: "git-dirty-tree", check: "git-state", severity: "WARNING", detail: "dirty" },
    ],
    checkSafetyCompliance: async () => ({
      findings: [
        { key: "live-trading-allowed", check: "safety-compliance", severity: "CRITICAL", detail: "live flag true" },
        { key: "micro-live-allowed", check: "safety-compliance", severity: "CRITICAL", detail: "micro live true" },
      ],
      structuralState: null,
    }),
  });

  const r1 = await runStewardCavemanOnce(deps);
  assert.equal(r1.criticalCount, 2, "T7: two criticals");
  assert.equal(deps._notifyCalls.length, 1, "T7: exactly one bundled alert");
  assert.ok(/live-trading-allowed/.test(deps._notifyCalls[0]), "T7: alert includes first critical");
  assert.ok(/micro-live-allowed/.test(deps._notifyCalls[0]), "T7: alert includes second critical");
  assert.ok(/git-dirty-tree/.test(deps._notifyCalls[0]), "T7: alert bundles warnings too");
  assert.ok(/STEWARD-CAVEMAN/.test(deps._notifyCalls[0]), "T7: alert uses STEWARD-CAVEMAN attribution");
  assert.ok(new RegExp(STEWARD_CAVEMAN_AGENT_ID).test(deps._notifyCalls[0]), "T7: alert includes Paperclip id");

  clock += 30 * 60 * 1000;
  const r2 = await runStewardCavemanOnce(deps);
  assert.equal(r2.alerted, false, "T7: duplicate criticals suppressed inside cooldown");
  assert.equal(r2.suppressedCount, 2, "T7: both criticals suppressed");
  assert.equal(deps._notifyCalls.length, 1, "T7: no second alert inside cooldown");

  clock += 60 * 60 * 1000 + 1;
  const r3 = await runStewardCavemanOnce(deps);
  assert.equal(r3.alerted, true, "T7: re-alert after cooldown");
  assert.equal(deps._notifyCalls.length, 2, "T7: second alert after cooldown");
  ok("T7: criticals are bundled once and deduped by cooldown");
}

// A spawn that never started reports { pid: undefined } — it does not throw.
// The old code set notified = true regardless and stamped the 1-hour cooldown,
// so one failed alert silenced the finding for an hour.
async function t8_failedSpawnDoesNotAdvanceCooldown() {
  let clock = 20_000_000;
  let spawnOk = false;
  const deps = baseDeps({
    now: () => clock,
    spawnNotify: () => (spawnOk ? { pid: 4242 } : { pid: undefined }),
    checkSafetyCompliance: async () => ({
      findings: [{ key: "live-trading-allowed", check: "safety-compliance", severity: "CRITICAL", detail: "live flag true" }],
      structuralState: null,
    }),
  });

  const r1 = await runStewardCavemanOnce(deps);
  assert.equal(r1.criticalCount, 1, "T8: the critical was found");
  assert.equal(r1.alerted, false, "T8: a spawn with no pid is not a delivered alert");

  // One minute later — far inside the 1-hour cooldown. Because the first alert
  // never went out, the finding must be retried, not suppressed.
  clock += 60 * 1000;
  spawnOk = true;
  const r2 = await runStewardCavemanOnce(deps);
  assert.equal(r2.alerted, true, "T8: an undelivered finding is retried on the next sweep");
  assert.equal(r2.suppressedCount, 0, "T8: it was never counted as suppressed");
  ok("T8: a failed notify spawn does not stamp the cooldown");
}

async function main() {
  const tests = [
    t0_identityExport,
    t1_happyPathNoFindings,
    t2_behindOriginWarning,
    t3_dirtyTreeWarning,
    t4_liveTradingFlagCritical,
    t5_readOrGitFailureGapNoCrash,
    t6_singleInstanceLockOnlyOneRuns,
    t7_alertBundlingAndCooldown,
    t8_failedSpawnDoesNotAdvanceCooldown,
  ];
  for (const t of tests) await t();
  console.log(`\nsteward-caveman.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();
