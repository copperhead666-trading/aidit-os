// ops-watcher/venture-gate.regression.test.mjs
//
// The owner pre-authorized unattended venture work with five conditions. Four
// were sentences in a packet. These are the tests that make them fences.
//
// Run with:
//   node ops-watcher/venture-gate.regression.test.mjs

import assert from "node:assert/strict";
import {
  CONSECUTIVE_FAILURE_HALT,
  NIGHTLY_EXECUTION_CEILING,
  checkPlanForVentureGitWrites,
  checkUncommittedFiles,
  compareVentureGitPosition,
  dayKey,
  nightlyCeilingCheck,
  recordNightlyExecution,
  recordVentureOutcome,
  ventureGitPosition,
  ventureHaltCheck,
  ventureUncommittedPaths,
} from "./venture-gate.mjs";
import { dayKey as notifyDayKey } from "./telegram-notify.mjs";

let passed = 0;
let failed = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${e && e.stack ? e.stack : e}`);
    failures.push(name);
    failed++;
  }
}

const DAY1 = Date.parse("2026-09-05T02:00:00+07:00");
const DAY2 = Date.parse("2026-09-06T02:00:00+07:00");
const at = (ms) => () => ms;
const VENTURE = { id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" };

// ---------------------------------------------------------------------------
// G1
// ---------------------------------------------------------------------------

await t("G1: the day-key is telegram-notify's, not a second implementation", () => {
  // Two day boundaries that can disagree is a bug waiting for a timezone.
  assert.equal(dayKey, notifyDayKey, "the same function object, re-exported");
  assert.equal(dayKey(DAY1), "2026-09-05");
});

await t("G1: six executions are allowed, the seventh is DECLINED and says so", () => {
  const state = {};
  for (let i = 0; i < NIGHTLY_EXECUTION_CEILING; i++) {
    const check = nightlyCeilingCheck(state, { now: at(DAY1) });
    assert.equal(check.allowed, true, `execution ${i + 1} of ${NIGHTLY_EXECUTION_CEILING} is allowed`);
    assert.equal(check.executed, i, "the count is what has already run");
    recordNightlyExecution(state, { now: at(DAY1) });
  }
  const over = nightlyCeilingCheck(state, { now: at(DAY1) });
  assert.equal(over.allowed, false, "the seventh is declined");
  assert.equal(over.executed, 6);
  assert.match(over.reason, /nightly ceiling reached: 6\/6/);
  // Declined, not dropped: the wording is the promise.
  assert.match(over.reason, /WAIT for the next day, nothing is dropped/);
});

await t("G1: the ceiling resets by arithmetic on the next day, with nothing to run at midnight", () => {
  const state = {};
  for (let i = 0; i < 6; i++) recordNightlyExecution(state, { now: at(DAY1) });
  assert.equal(nightlyCeilingCheck(state, { now: at(DAY1) }).allowed, false);
  const tomorrow = nightlyCeilingCheck(state, { now: at(DAY2) });
  assert.equal(tomorrow.allowed, true, "a new day-key starts at zero");
  assert.equal(tomorrow.executed, 0);
});

await t("G1: a per-sweep cap of 1 is not a nightly cap — the arithmetic that motivated this", () => {
  // The heartbeat sweeps every 5 minutes. An 8-hour night is 96 sweeps, so
  // MAX_EXECUTIONS_PER_SWEEP = 1 permits ~96 executions overnight.
  const sweepsInAnEightHourNight = (8 * 60) / 5;
  assert.equal(sweepsInAnEightHourNight, 96);
  assert.ok(NIGHTLY_EXECUTION_CEILING < sweepsInAnEightHourNight, "the nightly ceiling must bind well below the sweep count");
  assert.equal(NIGHTLY_EXECUTION_CEILING, 6, "six is what the owner said he can review in one morning");
});

// ---------------------------------------------------------------------------
// G2
// ---------------------------------------------------------------------------

await t("G2: two consecutive failures halt venture execution, one does not", () => {
  const state = {};
  assert.equal(ventureHaltCheck(state, { now: at(DAY1) }).halted, false, "nothing halted to begin with");

  const first = recordVentureOutcome(state, "reverted", { now: at(DAY1), reason: "KOL-1 reverted: verify-red" });
  assert.equal(first.halted, false, "one failure is not a streak");
  assert.equal(first.consecutiveFailures, 1);

  const second = recordVentureOutcome(state, "aborted", { now: at(DAY1), reason: "KOL-2 aborted: lane timeout" });
  assert.equal(second.halted, true, "two in a row halts");
  assert.equal(second.justHalted, true, "and the halt is reported the moment it happens");
  assert.match(second.reason, /HALTED for 2026-09-05 after 2 consecutive failures/);
  assert.match(second.reason, /KOL-2 aborted: lane timeout/, "the halt names what caused it");
  assert.equal(CONSECUTIVE_FAILURE_HALT, 2);
});

await t("G2: a success between two failures breaks the streak", () => {
  const state = {};
  recordVentureOutcome(state, "reverted", { now: at(DAY1) });
  const ok = recordVentureOutcome(state, "done", { now: at(DAY1) });
  assert.equal(ok.halted, false);
  const after = recordVentureOutcome(state, "reverted", { now: at(DAY1) });
  assert.equal(after.halted, false, "the counter restarted, so this is failure number one again");
  assert.equal(after.consecutiveFailures, 1);
});

await t("G2: a success does NOT lift a halt already in effect", () => {
  // The halt exists so a person looks at what happened. A later success is not
  // that person.
  const state = {};
  recordVentureOutcome(state, "reverted", { now: at(DAY1) });
  recordVentureOutcome(state, "aborted", { now: at(DAY1) });
  assert.equal(ventureHaltCheck(state, { now: at(DAY1) }).halted, true);
  recordVentureOutcome(state, "done", { now: at(DAY1) });
  assert.equal(ventureHaltCheck(state, { now: at(DAY1) }).halted, true, "still halted for the day");
});

await t("G2: morning clears the halt, and nobody has to remember to clear it", () => {
  const state = {};
  recordVentureOutcome(state, "reverted", { now: at(DAY1) });
  recordVentureOutcome(state, "aborted", { now: at(DAY1) });
  assert.equal(ventureHaltCheck(state, { now: at(DAY1) }).halted, true);
  const morning = ventureHaltCheck(state, { now: at(DAY2) });
  assert.equal(morning.halted, false, "the halt is scoped to its day-key");
  assert.equal(morning.consecutiveFailures, 0, "and the streak does not carry over");
});

await t("G2: a no-op is not a failure — it never feeds the streak", () => {
  const state = {};
  recordVentureOutcome(state, "reverted", { now: at(DAY1) });
  // The caller skips no-op/skipped entirely; this asserts the shape it relies on.
  const done = recordVentureOutcome(state, "done", { now: at(DAY1) });
  assert.equal(done.halted, false);
});

// ---------------------------------------------------------------------------
// G3
// ---------------------------------------------------------------------------

function fakeGit(porcelain) {
  return {
    execFileSync: (cmd, args) => {
      assert.equal(cmd, "git");
      const sub = args.join(" ");
      if (sub.includes("status --porcelain")) return porcelain;
      if (sub.includes("rev-parse HEAD")) return "c74b6e9\n";
      if (sub.includes("--abbrev-ref")) return "main\n";
      if (sub.includes("for-each-ref")) return "refs/remotes/origin/main c74b6e9\n";
      throw new Error(`unexpected git: ${sub}`);
    },
  };
}

await t("G3: porcelain is parsed WITHOUT trimming the left edge", () => {
  // " M src/x.py" has a leading space that encodes the state. Trimming the
  // whole block ate it on the first line only, so the path parsed as "rc/x.py"
  // — a path that matches nothing, silently making the owner's first
  // uncommitted file touchable. Found live before this test existed.
  const deps = fakeGit(" M src/caveman_outcomes/__init__.py\n?? src/engine.py\n");
  const paths = ventureUncommittedPaths(VENTURE, { ...deps, venturePath: "/fake" });
  assert.deepEqual(paths, [
    "ventures/caveman-trading-os/src/caveman_outcomes/__init__.py",
    "ventures/caveman-trading-os/src/engine.py",
  ]);
  assert.equal(paths[0].includes("/rc/"), false, "the leading status column must not eat the path's first character");
});

await t("G3: an uncommitted venture file is refused, a committed one is not", () => {
  const deps = fakeGit(" M src/a.py\n?? docs/b.md\n");
  const bad = checkUncommittedFiles(
    ["ventures/caveman-trading-os/src/a.py", "ventures/caveman-trading-os/src/clean.py"],
    [VENTURE],
    { ...deps, venturePath: "/fake" },
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.violations.length, 1, "only the uncommitted one is refused");
  assert.match(bad.violations[0], /src\/a\.py: uncommitted in caveman-trading-os/);
  assert.match(bad.violations[0], /KOL-66/, "the refusal says whose decision it is and since when");

  const clean = checkUncommittedFiles(["ventures/caveman-trading-os/src/clean.py"], [VENTURE], { ...deps, venturePath: "/fake" });
  assert.equal(clean.ok, true);
});

await t("G3: the list is DERIVED, so committing a file makes it touchable with no code change", () => {
  const before = checkUncommittedFiles(["ventures/caveman-trading-os/src/a.py"], [VENTURE], { ...fakeGit(" M src/a.py\n"), venturePath: "/fake" });
  assert.equal(before.ok, false, "uncommitted -> refused");
  const after = checkUncommittedFiles(["ventures/caveman-trading-os/src/a.py"], [VENTURE], { ...fakeGit(""), venturePath: "/fake" });
  assert.equal(after.ok, true, "committed -> allowed, without editing a hardcoded list");
});

await t("G3: a rename claims BOTH sides", () => {
  const deps = fakeGit("R  old/name.py -> new/name.py\n");
  const paths = ventureUncommittedPaths(VENTURE, { ...deps, venturePath: "/fake" });
  assert.deepEqual(paths, [
    "ventures/caveman-trading-os/old/name.py",
    "ventures/caveman-trading-os/new/name.py",
  ]);
});

await t("G3: an unreadable git status FAILS CLOSED", () => {
  // "no uncommitted files" and "I could not tell" are the same answer only if
  // you are not paying attention.
  const broken = { execFileSync: () => { throw new Error("not a git repository"); }, venturePath: "/fake" };
  assert.equal(ventureUncommittedPaths(VENTURE, broken), null, "unreadable is null, never an empty list");
  const guard = checkUncommittedFiles(["ventures/caveman-trading-os/src/a.py"], [VENTURE], broken);
  assert.equal(guard.ok, false, "and the gate refuses rather than assuming clean");
  assert.match(guard.violations[0], /cannot read the venture's git status/);
});

await t("G3: files outside every venture are not the gate's business", () => {
  const deps = { execFileSync: () => { throw new Error("git must not be consulted"); }, venturePath: "/fake" };
  const r = checkUncommittedFiles(["ops-watcher/foo.mjs", "docs/bar.md"], [VENTURE], deps);
  assert.equal(r.ok, true, "no venture path in the plan means no git call at all");
});

// ---------------------------------------------------------------------------
// G4
// ---------------------------------------------------------------------------

await t("G4: a commit to the venture is detected by HEAD moving", () => {
  const before = { id: "v", head: "aaaaaaa", branch: "main", remoteRefs: "r 1", status: "" };
  const after = { ...before, head: "bbbbbbb" };
  const cmp = compareVentureGitPosition(before, after);
  assert.equal(cmp.ok, false);
  assert.match(cmp.violations[0], /HEAD moved aaaaaaa -> bbbbbbb/);
  assert.match(cmp.violations[0], /a commit was made to the venture repository/);
});

await t("G4: a PUSH is detected even when local HEAD never moved", () => {
  // This is the one that matters: that repository has an off-machine remote,
  // and a push is the single action snapshot/restore cannot undo.
  const before = { id: "v", head: "aaaaaaa", branch: "main", remoteRefs: "refs/remotes/origin/main aaa", status: "" };
  const after = { ...before, remoteRefs: "refs/remotes/origin/main bbb" };
  const cmp = compareVentureGitPosition(before, after);
  assert.equal(cmp.ok, false);
  assert.match(cmp.violations[0], /a remote-tracking ref moved/);
  assert.match(cmp.violations[0], /off-machine remote/);
});

await t("G4: an unchanged repository passes, and an unreadable one does NOT", () => {
  const pos = { id: "v", head: "aaaaaaa", branch: "main", remoteRefs: "r 1", status: " M x.py" };
  assert.equal(compareVentureGitPosition(pos, { ...pos }).ok, true);
  assert.equal(compareVentureGitPosition(null, pos).ok, false, "unreadable before");
  assert.equal(compareVentureGitPosition(pos, null).ok, false, "unreadable after");
  assert.match(compareVentureGitPosition(pos, null).violations[0], /refusing to certify/);
});

await t("G4: a branch switch is a violation too", () => {
  const before = { id: "v", head: "a", branch: "main", remoteRefs: "r", status: "" };
  assert.equal(compareVentureGitPosition(before, { ...before, branch: "feature" }).ok, false);
});

await t("G4: ventureGitPosition reads head, branch and every remote ref", () => {
  const seen = [];
  const deps = {
    venturePath: "/fake",
    execFileSync: (cmd, args) => {
      seen.push(args.join(" "));
      const sub = args.join(" ");
      if (sub.includes("rev-parse HEAD")) return "c74b6e9d\n";
      if (sub.includes("--abbrev-ref")) return "main\n";
      if (sub.includes("for-each-ref")) return "refs/remotes/origin/main c74b6e9d\n";
      if (sub.includes("status")) return " M a.py\n";
      throw new Error(`unexpected: ${sub}`);
    },
  };
  const pos = ventureGitPosition(VENTURE, deps);
  assert.equal(pos.head, "c74b6e9d");
  assert.equal(pos.branch, "main");
  assert.match(pos.remoteRefs, /refs\/remotes\/origin\/main/);
  assert.ok(seen.some((s) => s.includes("for-each-ref")), "remote refs are read, not assumed");

  const broken = ventureGitPosition(VENTURE, { venturePath: "/fake", execFileSync: () => { throw new Error("nope"); } });
  assert.equal(broken, null, "an unreadable repository reports null, not a fabricated position");
});

await t("G4 pre-flight: a plan that ASKS for a git write is refused before dispatch", () => {
  for (const step of ["git push origin main", "run git commit -am wip", "git  tag v2", "GIT REBASE onto main"]) {
    const r = checkPlanForVentureGitWrites({ steps: [step] });
    assert.equal(r.ok, false, `"${step}" must be refused`);
    assert.match(r.violations[0], /plan asks for a git write/);
  }
  // Reading git is not writing to it.
  assert.equal(checkPlanForVentureGitWrites({ steps: ["git status", "git log --oneline"] }).ok, true);
  assert.equal(checkPlanForVentureGitWrites({ steps: ["edit the file"], verify: "node ops-watcher/verify-file.mjs --path a --contains b" }).ok, true);
  // VERIFY and OBJECTIVE are searched too, not only STEPS.
  assert.equal(checkPlanForVentureGitWrites({ verify: "node ops-watcher/x.mjs && git push" }).ok, false);
  assert.equal(checkPlanForVentureGitWrites({ objective: "git commit the result" }).ok, false);
});

// ---------------------------------------------------------------------------
// Live, against the real venture repository.
// ---------------------------------------------------------------------------

// V2. A TEST MAY NOT ASSERT A NUMBER THE OWNER IS BEING ASKED TO CHANGE.
//
// This test used to assert the venture had exactly FIVE uncommitted files.
// KOL-82 asks the owner to commit or discard them — so acting on the
// recommendation the system itself made would have turned the suite red on the
// Lenovo, and the owner would have been told his own decision broke the build.
//
// The live read stays: reading the REAL repository is what caught the porcelain
// left-edge trimming bug (" M src/x.py" parsed as "rc/x.py"). What changes is
// what is asserted — the PARSING CONTRACT, against whatever git status returns
// today, at any count including zero.
await t("live: the venture's uncommitted files are parsed correctly, whatever git status says", () => {
  const paths = ventureUncommittedPaths(VENTURE);
  if (paths === null) {
    // No venture checked out on this machine (or git cannot answer). Skip
    // cleanly and SAY SO — a silent pass here would hide the parser entirely.
    console.log("  SKIP: no venture repository at ventures/caveman-trading-os — the live read has nothing to parse");
    return;
  }
  assert.ok(Array.isArray(paths), "the real repository answers with a list");

  for (const p of paths) {
    assert.ok(p.startsWith("ventures/caveman-trading-os/"), `${p} is repo-relative to Aidit OS`);
    // The porcelain bug this test exists for: trimming the left edge ate the
    // status column's leading space and " M src/x.py" became "rc/x.py".
    assert.equal(/\/rc\//.test(p), false, `${p} must not have lost its first path character`);
    const rel = p.slice("ventures/caveman-trading-os/".length);
    assert.ok(rel.length > 0, `${p} carries a path, not just the venture prefix`);
    assert.equal(rel.startsWith(" "), false, `${p} must not carry a status column`);
    assert.equal(rel.includes(" -> "), false, `${p} must have been split at the rename arrow`);
    assert.equal(rel.startsWith('"'), false, `${p} must have had its quoting removed`);
    assert.equal(rel.includes("\\"), false, `${p} must use forward slashes`);
  }
  assert.equal(new Set(paths).size, paths.length, "no path is reported twice");

  // The gate behaves correctly at whatever the count is today — including zero,
  // which is what KOL-82 produces once the owner acts.
  if (paths.length) {
    assert.equal(checkUncommittedFiles([paths[0]], [VENTURE]).ok, false, "a real uncommitted file is refused");
  } else {
    console.log("  (the venture is clean — the owner has acted on KOL-82)");
    assert.equal(
      checkUncommittedFiles(["ventures/caveman-trading-os/src/anything.py"], [VENTURE]).ok, true,
      "a clean venture refuses nothing",
    );
  }
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
process.exit(0);
