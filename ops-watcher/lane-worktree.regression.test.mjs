// ops-watcher/lane-worktree.regression.test.mjs
// Regression coverage for one isolated git worktree per writing lane.
//
//   node ops-watcher/lane-worktree.regression.test.mjs
//
// CLAUDE.md has required worktree isolation since it was written, and it was
// never built: on 2026-09-04 `grep -rn worktree` across ops-watcher/ and
// scripts/ returned exactly one line, and it was a comment. All three
// dispatchers ran with cwd: REPO_ROOT, so every lane wrote into the same tree at
// once. Two deliberately broken commits shipped that day because a commit landed
// mid mutation-check.
//
// Every git call is injected. Nothing here creates, moves or deletes a real
// worktree.

import assert from "node:assert/strict";
import path from "node:path";
import {
  ensureLaneWorktree,
  listLaneWorktrees,
  worktreePathFor,
  branchNameFor,
  WORKTREE_ROOT,
  REPO_ROOT,
} from "./lane-worktree.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(String(e && e.stack ? e.stack : e).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(n); failed++;
};

function fakeFs({ exists = () => false } = {}) {
  const mkdirs = [];
  return {
    mkdirs,
    existsSync: (p) => exists(p),
    mkdirSync: (p) => { mkdirs.push(p); },
  };
}

function fakeExec(handler) {
  const calls = [];
  const exec = (cmd, args, options = {}) => {
    calls.push({ cmd, args: [...args], cwd: options.cwd });
    return handler ? handler(args, options) : "";
  };
  return {
    calls,
    exec,
  };
}

// Route git calls by their verb line ("status --porcelain", "rev-parse HEAD",
// ...). A value may be a string to return or a function to call, so a single
// command can be made to fail while the rest answer. Any unlisted call throws,
// which surfaces accidental extra git invocations as test failures instead of
// silent "" answers.
function gitResponder(responses) {
  return fakeExec((args) => {
    const key = args.slice(2).join(" ");
    if (Object.prototype.hasOwnProperty.call(responses, key)) {
      const value = responses[key];
      return typeof value === "function" ? value() : value;
    }
    throw new Error(`unexpected git call: ${key}`);
  });
}

// A reused-worktree setup: fake fs says the tree exists, git answers the four
// read-only probes plus whatever extras the scenario needs (e.g. the
// fast-forward).
function reuseDeps(lane, { status = "", head = "abc123", onBranch = null, behind = "0", extra = {} } = {}) {
  const fs = fakeFs({ exists: (p) => String(p).endsWith(".git") });
  const ex = gitResponder({
    "status --porcelain": status,
    "rev-parse HEAD": head,
    "rev-parse --abbrev-ref HEAD": onBranch === null ? `lane/${lane}` : onBranch,
    "rev-list --count HEAD..origin/main": behind,
    ...extra,
  });
  return { fs, ex };
}

const DESTRUCTIVE_VERB = /(^| )(clean|reset|stash|switch)( |$)|checkout/;

function assertGitCallIsSafe(call, expectedCwd) {
  assert.equal(call.cmd, "git");
  assert.equal(call.args[0], "-c", "git call starts with a per-command config override");
  assert.equal(call.args[1], `safe.directory=${expectedCwd}`, "git trusts only the cwd it is about to inspect");
}

async function t1_eachLaneGetsItsOwnPathAndBranch() {
  const name = "W1 each lane gets its own path and its own branch";
  try {
    // The whole property: two lanes can never resolve to the same tree.
    const lanes = ["corleone", "sjahrir", "hatta", "soekarno"];
    const paths = lanes.map((l) => worktreePathFor(l));
    const branches = lanes.map((l) => branchNameFor(l));
    assert.equal(new Set(paths).size, lanes.length, "every lane path is distinct");
    assert.equal(new Set(branches).size, lanes.length, "every lane branch is distinct");
    for (const p of paths) {
      assert.ok(p.startsWith(WORKTREE_ROOT), "worktrees live under the worktree root");
      // Nesting a checkout inside the repo makes every parent `git status`
      // report the child's contents.
      assert.ok(!p.startsWith(REPO_ROOT + path.sep), "and OUTSIDE the repository itself");
    }
    for (const b of branches) {
      assert.notEqual(b, "main", "no lane ever commits on main");
      assert.ok(b.startsWith("lane/"), "lane branches are namespaced");
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t2_laneNamesAreSanitised() {
  const name = "W2 a hostile or empty lane name cannot escape the worktree root";
  try {
    // A lane name reaching a filesystem path is an injection surface. Path
    // separators and traversal must not survive.
    for (const hostile of ["../../etc", "a/b", "a\\b", "CoRLeOnE"]) {
      const p = worktreePathFor(hostile);
      assert.ok(p.startsWith(WORKTREE_ROOT), `${hostile} stays under the root`);
      assert.ok(!path.basename(p).includes(".."), `${hostile} cannot traverse`);
    }
    assert.throws(() => worktreePathFor(""), /lane name is required/);
    assert.throws(() => branchNameFor("   "), /lane name is required/);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t3_createsTheWorktreeWhenAbsent() {
  const name = "W3 a missing worktree is created with git worktree add -B";
  try {
    const fs = fakeFs({ exists: () => false });
    const ex = fakeExec();
    const r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec });
    assert.equal(r.isolated, true);
    assert.equal(r.created, true);
    assert.equal(r.branch, "lane/corleone");
    const add = ex.calls.find((c) => c.args.slice(2, 4).join(" ") === "worktree add");
    assert.ok(add, "git worktree add was called");
    // -B, not -b: the branch can outlive its directory, and plain -b fails on an
    // existing branch, so a re-run after someone deleted the folder by hand
    // would break.
    assertGitCallIsSafe(add, REPO_ROOT);
    assert.equal(add.args[4], "-B", "uses -B so a re-run after a manual delete still works");
    assert.equal(add.args[5], "lane/corleone");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t3b_withoutSourceRepoKeepsTheOldPathAndCwd() {
  const name = "W3b omitting sourceRepo keeps the original target path and git cwd";
  try {
    const fs = fakeFs({ exists: () => false });
    const ex = fakeExec();
    const r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec });
    const oldTarget = path.join(WORKTREE_ROOT, "lane-corleone");

    assert.equal(worktreePathFor("corleone"), oldTarget, "the no-sourceRepo path remains byte-identical");
    assert.equal(r.path, oldTarget, "ensureLaneWorktree still targets the old lane path");

    const add = ex.calls.find((c) => c.args.slice(2, 4).join(" ") === "worktree add");
    assert.ok(add, "git worktree add was called");
    assert.equal(add.cwd, REPO_ROOT, "the default source repository is still Aidit OS");
    assertGitCallIsSafe(add, REPO_ROOT);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t3c_sourceRepoGetsItsOwnSafeWorktreeDirectory() {
  const name = "W3c sourceRepo adds a sanitized repo directory under the worktree root";
  try {
    const sourceRepo = "D:\\AI\\Aidit OS\\ventures\\caveman-trading-os";
    const p = worktreePathFor("corleone", { sourceRepo });
    assert.equal(p, path.join(WORKTREE_ROOT, "caveman-trading-os", "lane-corleone"));
    assert.equal(path.relative(WORKTREE_ROOT, p).startsWith(".."), false, "target stays under the worktree root");
    assert.equal(path.isAbsolute(path.relative(WORKTREE_ROOT, p)), false, "target does not escape through an absolute segment");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t3d_sourceRepoControlsGitCwdTargetAndFallback() {
  const name = "W3d sourceRepo controls git cwd while keeping the lane branch name";
  try {
    const sourceRepo = "D:\\AI\\Aidit OS\\ventures\\sjs-superapps";
    const resolvedSourceRepo = path.resolve(sourceRepo);
    const fs = fakeFs({ exists: () => false });
    const ex = fakeExec();
    const r = ensureLaneWorktree("corleone", { sourceRepo, _fs: fs, _exec: ex.exec });
    const add = ex.calls.find((c) => c.args.slice(2, 4).join(" ") === "worktree add");

    assert.equal(r.path, path.join(WORKTREE_ROOT, "sjs-superapps", "lane-corleone"));
    assert.equal(r.branch, "lane/corleone", "the branch name is still repo-local");
    assert.ok(add, "git worktree add was called");
    assert.equal(add.cwd, resolvedSourceRepo, "worktree add runs in the source repo");
    assert.equal(add.args[5], "lane/corleone", "the branch argument omits the repo name");
    assertGitCallIsSafe(add, resolvedSourceRepo);

    const failing = fakeExec(() => { throw new Error("fatal: not a git repository"); });
    const fallback = ensureLaneWorktree("corleone", { sourceRepo, _fs: fs, _exec: failing.exec });
    assert.equal(fallback.path, resolvedSourceRepo, "failure falls back to the source repo, not Aidit OS");
    assert.equal(fallback.isolated, false);
    assert.equal(fallback.refused, undefined, "fallback is degraded but still usable");
    assert.ok(fallback.reason, "fallback reason names what went wrong");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t3e_sourceRepoSegmentCannotEscapeTheWorktreeRoot() {
  const name = "W3e hostile sourceRepo endings become one safe directory segment";
  try {
    for (const [sourceRepo, safeSegment] of [
      ["D:\\AI\\Aidit OS\\ventures\\SJS Super Apps", "sjs-super-apps"],
      ["D:\\AI\\Aidit OS\\ventures\\..", "--"],
    ]) {
      const p = worktreePathFor("corleone", { sourceRepo });
      const rel = path.relative(WORKTREE_ROOT, p);
      assert.equal(path.isAbsolute(rel), false, `${sourceRepo} stays relative to the root`);
      assert.equal(rel.startsWith(".."), false, `${sourceRepo} does not walk above the root`);
      assert.equal(rel.split(path.sep)[0], safeSegment, `${sourceRepo} uses one sanitized repo segment`);
      assert.equal(path.basename(path.dirname(p)), safeSegment, `${sourceRepo} cannot introduce separators`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t4_reusesAnExistingWorktree() {
  const name = "W4 an existing worktree is reused, not recreated";
  try {
    const fs = fakeFs({ exists: (p) => String(p).endsWith(".git") });
    const ex = fakeExec();
    const r = ensureLaneWorktree("sjahrir", { _fs: fs, _exec: ex.exec });
    assert.equal(r.isolated, true);
    assert.equal(r.created, false);
    assert.equal(ex.calls.some((c) => c.args[0] === "worktree" && c.args[1] === "add"), false,
      "an existing tree is never recreated");
    // The git calls it MAY make are reads: how dirty is the tree, what commit
    // and branch is it really on, how far behind origin/main. Reused does not
    // mean clean or current, and a lane that inherits another run's leftovers
    // produces a diff containing work nobody asked it to do.
    assert.deepEqual(ex.calls.map((c) => c.args.slice(2).join(" ")), [
      "status --porcelain",
      "rev-parse HEAD",
      "rev-parse --abbrev-ref HEAD",
      "rev-list --count HEAD..origin/main",
    ], "reuse asks only read-only questions and mutates nothing");
    assertGitCallIsSafe(ex.calls[0], worktreePathFor("sjahrir"));
    ok(name);
  } catch (err) { bad(name, err); }
}

// A worktree handed over dirty is the E4 finding from the 2026-09-05 health
// diagnosis: five of nine lane worktrees were carrying an earlier run's files.
async function t4b_reuseReportsTheDirtItIsHandingOver() {
  const name = "W4b a reused worktree reports how dirty it is, and an unanswerable git is not called clean";
  try {
    const fs = fakeFs({ exists: (p) => String(p).endsWith(".git") });
    const dirty = fakeExec(() => [" M ops-watcher/routing.mjs", "?? scratch.txt", ""].join("\n"));
    const r = ensureLaneWorktree("corleone", { _fs: fs, _exec: dirty.exec });
    assert.equal(r.dirty, 2, "counts the uncommitted entries");
    assert.match(r.reason, /NOT clean/, "the reason says it out loud");

    const clean = fakeExec(() => "");
    const r2 = ensureLaneWorktree("corleone", { _fs: fs, _exec: clean.exec });
    assert.equal(r2.dirty, 0);
    assert.equal(r2.reason, "existing worktree reused", "a clean tree gets no warning to ignore");

    const broken = fakeExec(() => { throw new Error("fatal: not a git repository"); });
    const r3 = ensureLaneWorktree("corleone", { _fs: fs, _exec: broken.exec });
    assert.equal(r3.dirty, null, "could not look is not the same fact as no dirt");
    assert.equal(r3.isolated, true, "an unanswerable status does not cost the lane its isolation");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t5_fallbackIsReportedNotSilent() {
  const name = "W5 a failed worktree falls back to the repo root and SAYS so";
  try {
    const fs = fakeFs({ exists: () => false });
    const ex = fakeExec(() => { throw new Error("fatal: not a git repository"); });
    const r = ensureLaneWorktree("hatta", { _fs: fs, _exec: ex.exec });
    assert.equal(r.path, REPO_ROOT, "degrades to the shared root rather than refusing to run");
    // A SILENT fallback would recreate the exact bug this module prevents, with
    // a module in place that everyone assumes is protecting them.
    assert.equal(r.isolated, false, "and it does not claim to be isolated");
    assert.equal(r.refused, undefined, "fallback is not a refusal");
    assert.match(r.reason, /falling back/, "and the reason says so out loud");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t6_neverThrows() {
  const name = "W6 ensureLaneWorktree never throws, whatever git or fs does";
  try {
    const throwingFs = {
      existsSync() { throw new Error("EACCES"); },
      mkdirSync() { throw new Error("EACCES"); },
    };
    const r = ensureLaneWorktree("corleone", { _fs: throwingFs, _exec: () => "" });
    assert.equal(r.isolated, false);
    assert.ok(r.reason);
    // A bad lane name is reported, not thrown, for the same reason: a dispatcher
    // must always be able to start.
    const r2 = ensureLaneWorktree("", { _fs: fakeFs(), _exec: () => "" });
    assert.equal(r2.isolated, false);
    assert.match(r2.reason, /bad lane name/);
    assert.match(r2.reason, /lane name/);

    // An invalid sourceRepo is also reported separately, not as a lane-name problem.
    const r3 = ensureLaneWorktree("corleone", { sourceRepo: "///", _fs: fakeFs(), _exec: () => "" });
    assert.equal(r3.isolated, false);
    assert.equal(r3.path, path.resolve(REPO_ROOT), "invalid sourceRepo falls back to the source repo");
    assert.ok(r3.reason);
    assert.match(r3.reason, /sourceRepo/);
    assert.doesNotMatch(r3.reason, /lane name/);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t7_listParsesPorcelain() {
  const name = "W7 listLaneWorktrees parses git's porcelain output";
  try {
    const out = [
      "worktree D:/AI/Aidit OS",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree D:/AI/worktrees/lane-corleone",
      "HEAD def456",
      "branch refs/heads/lane/corleone",
      "",
    ].join("\n");
    const trees = listLaneWorktrees({ _exec: () => out });
    assert.equal(trees.length, 2);
    assert.equal(trees[1].branch, "lane/corleone", "refs/heads/ is stripped");
    // An unreadable git must not take the caller down with it.
    assert.deepEqual(listLaneWorktrees({ _exec: () => { throw new Error("no git"); } }), []);
    ok(name);
  } catch (err) { bad(name, err); }
}

// === Base revision: measured, fast-forwarded, and refused when unsafe ===
// PACKET-LANE-BASE-REVISION: a lane ran, passed, and reported against a copy
// of the code from thirteen commits ago because nothing measured staleness and
// the returned branch name was never checked against the real checkout.

// Packet test 1: clean and 5 behind -> fast-forwarded, behind reported.
async function t8_cleanAndBehindFastForwards() {
  const name = "W8 a clean stale worktree is fast-forwarded to origin/main";
  try {
    const { fs, ex } = reuseDeps("hatta", { behind: "5", extra: { "merge --ff-only origin/main": "" } });
    const r = ensureLaneWorktree("hatta", { _fs: fs, _exec: ex.exec });
    assert.equal(r.isolated, true, "a clean tree that fast-forwards stays usable");
    assert.equal(r.created, false);
    assert.equal(r.behind, 5, "the measured gap is reported");
    assert.equal(r.head, "abc123", "the actual HEAD is reported");
    assert.equal(r.checkedOutBranch, "lane/hatta", "the real checkout matches the lane branch here");
    const ff = ex.calls.find((c) => c.args[2] === "merge");
    assert.ok(ff, "a fast-forward was attempted");
    assert.deepEqual(ff.args.slice(2), ["merge", "--ff-only", "origin/main"], "and it was ff-only, never a merge commit");
    assert.match(r.reason, /fast-forwarded 5 commits/, "the reason carries the number");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 2: clean and current -> nothing to do, no fast-forward attempted.
async function t9_cleanAndCurrentStaysPut() {
  const name = "W9 a clean current worktree is not touched";
  try {
    const { fs, ex } = reuseDeps("sjahrir", { behind: "0" });
    const r = ensureLaneWorktree("sjahrir", { _fs: fs, _exec: ex.exec });
    assert.equal(r.isolated, true);
    assert.equal(r.refused, undefined, "clean and current is usable");
    assert.equal(r.behind, 0, "origin/main is not ahead");
    assert.equal(ex.calls.some((c) => c.args[2] === "merge"), false, "no fast-forward attempted when there is nothing to pull");
    assert.equal(r.reason, "existing worktree reused", "a clean current tree gets no warning to ignore");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 3: dirty and current -> the pre-existing behaviour, unregressed.
async function t10_dirtyAndCurrentStillReused() {
  const name = "W10 a dirty current worktree is still handed over with its dirt reported";
  try {
    const { fs, ex } = reuseDeps("corleone", { status: " M ops-watcher/x.mjs\n?? scratch.txt", behind: "0" });
    const r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec });
    assert.equal(r.isolated, true, "dirt alone never costs a lane its tree");
    assert.equal(r.refused, undefined, "dirty but current is still usable");
    assert.equal(r.dirty, 2, "the dirt count is still reported");
    assert.match(r.reason, /NOT clean/, "the warning still says it out loud");
    assert.equal(ex.calls.some((c) => c.args[2] === "merge"), false, "a dirty tree is never fast-forwarded");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 4: dirty AND behind -> refuse, naming both numbers.
async function t11_dirtyAndBehindRefuses() {
  const name = "W11 a dirty stale worktree is refused, with the dirt and the gap both named";
  try {
    const { fs, ex } = reuseDeps("hatta", { status: " M a.mjs\n?? b.txt", behind: "13" });
    const r = ensureLaneWorktree("hatta", { _fs: fs, _exec: ex.exec });
    assert.equal(r.isolated, true, "isolation still only says which tree was returned");
    assert.equal(r.refused, true, "dirty and stale is a refusal");
    assert.match(r.reason, /2 uncommitted entries/, "the reason names the dirt count");
    assert.match(r.reason, /13 commits behind origin\/main/, "the reason names the behind count");
    assert.equal(ex.calls.some((c) => c.args[2] === "merge"), false, "a dirty tree is never updated behind its dirt");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 5: the checkout is not the lane branch -> reported, never switched.
async function t12_branchMismatchIsReportedNotFixed() {
  const name = "W12 a worktree on the wrong branch is reported and never switched";
  try {
    const { fs, ex } = reuseDeps("hatta", { onBranch: "lane/p0-probe", behind: "0" });
    const r = ensureLaneWorktree("hatta", { _fs: fs, _exec: ex.exec });
    assert.equal(r.checkedOutBranch, "lane/p0-probe", "the real checkout is reported");
    assert.match(r.reason, /lane\/p0-probe/, "and named in the reason");
    assert.match(r.reason, /lane\/hatta/, "alongside the branch the caller was promised");
    for (const call of ex.calls) {
      const verbs = call.args.slice(2);
      assert.notEqual(verbs[0], "checkout", "no checkout is executed");
      assert.notEqual(verbs[0], "switch", "no branch switch is executed");
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 6: the behind measurement itself fails -> null, still no throw.
async function t13_unmeasurableBehindIsNullNotZero() {
  const name = "W13 an unmeasurable behind is null, and the call still returns";
  try {
    const { fs, ex } = reuseDeps("corleone", {
      behind: () => { throw new Error("fatal: bad revision 'origin/main'"); },
    });
    let r;
    assert.doesNotThrow(() => { r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec }); });
    assert.equal(r.behind, null, "could not look is not the same fact as in sync");
    assert.equal(r.dirty, 0);
    assert.equal(r.isolated, true, "an unknown gap does not cost the lane its tree");
    assert.equal(ex.calls.some((c) => c.args[2] === "merge"), false, "nothing is fast-forwarded on a guess");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 7: a freshly created worktree starts at HEAD, zero behind.
async function t14_createdWorktreeIsCurrent() {
  const name = "W14 a newly created worktree reports behind 0 and created true";
  try {
    const fs = fakeFs({ exists: () => false });
    const ex = fakeExec();
    const r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec });
    assert.equal(r.created, true);
    assert.equal(r.isolated, true);
    assert.equal(r.behind, 0, "a tree just created at HEAD is not stale");
    assert.equal(r.dirty, 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 8: across every path, no destructive git verb is ever executed.
async function t15_noDestructiveGitVerbEver() {
  const name = "W15 no path ever runs clean, reset, checkout --, stash, or switch";
  try {
    const runs = [];
    // Clean + stale: fast-forward path.
    runs.push(reuseDeps("hatta", { behind: "5", extra: { "merge --ff-only origin/main": "" } }));
    // Clean + current.
    runs.push(reuseDeps("sjahrir", { behind: "0" }));
    // Dirty + current.
    runs.push(reuseDeps("corleone", { status: " M a.mjs", behind: "0" }));
    // Dirty + stale: refusal path.
    runs.push(reuseDeps("hatta", { status: " M a.mjs\n?? b.txt", behind: "13" }));
    // Branch mismatch.
    runs.push(reuseDeps("hatta", { onBranch: "lane/p0-probe", behind: "3" }));
    // Clean + stale but not fast-forwardable: merge --ff-only fails.
    runs.push(reuseDeps("w2", { behind: "8", extra: { "merge --ff-only origin/main": () => { throw new Error("Not possible to fast-forward, aborting."); } } }));
    // Runtime-state-only dirt + stale: the packet's motivating fast-forward.
    runs.push(reuseDeps("hatta", { status: " M state/ledger.jsonl", behind: "7", extra: { "merge --ff-only origin/main": "" } }));
    // Runtime-state-only dirt + current: reuse, no fast-forward.
    runs.push(reuseDeps("sjahrir", { status: " M state/ledger.jsonl", behind: "0" }));

    for (const { fs, ex } of runs) {
      ensureLaneWorktree("hatta", { _fs: fs, _exec: ex.exec });
      for (const call of ex.calls) {
        const verbLine = call.args.slice(2).join(" ");
        assert.doesNotMatch(verbLine, DESTRUCTIVE_VERB,
          `no destructive verb in: ${verbLine}`);
      }
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

// === Runtime state vs work: PACKET-DIRT-VS-RUNTIME-STATE ===
// state/ledger.jsonl is tracked in git AND appended to at runtime by
// ops-watcher/ledger.mjs, so every lane worktree carries it permanently dirty.
// Dirt that is not work must not trip the staleness refusal, and must still be
// named in the reason so "clean" and "dirty only in runtime state" differ in
// the log.

// Packet test 1: only state/ledger.jsonl modified -> clean, reason names it.
async function t16_runtimeStateOnlyCountsAsClean() {
  const name = "W16 runtime-state-only dirt counts as clean, and the reason names it";
  try {
    const { fs, ex } = reuseDeps("hatta", { status: " M state/ledger.jsonl", behind: "0" });
    const r = ensureLaneWorktree("hatta", { _fs: fs, _exec: ex.exec });
    assert.equal(r.dirty, 0, "runtime state is not work");
    assert.equal(r.isolated, true, "a runtime-state-only tree stays usable");
    assert.match(r.reason, /runtime-state/, "the reason says so out loud, not silent zero");
    assert.match(r.reason, /state\/ledger\.jsonl/, "and names the file");
    assert.doesNotMatch(r.reason, /NOT clean/, "no work-dirt warning on a clean tree");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 2: ledger plus a real source file -> dirty, count is the work only.
async function t17_runtimeStatePlusWorkCountsTheWorkOnly() {
  const name = "W17 runtime state plus real work is dirty, and the count is the work only";
  try {
    const { fs, ex } = reuseDeps("corleone", { status: " M state/ledger.jsonl\n M ops-watcher/x.mjs", behind: "0" });
    const r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec });
    assert.equal(r.dirty, 1, "only the real source file counts");
    assert.match(r.reason, /NOT clean: 1 uncommitted entry/, "the count and warning name the work");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 3: only real source files -> unchanged from before the packet.
async function t18_realWorkOnlyIsUnchanged() {
  const name = "W18 real work alone is counted exactly as before the packet";
  try {
    const { fs, ex } = reuseDeps("corleone", { status: " M ops-watcher/x.mjs\n M docs/y.md", behind: "0" });
    const r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec });
    assert.equal(r.dirty, 2, "every real entry still counts");
    assert.match(r.reason, /NOT clean: 2 uncommitted entries/, "the warning is unchanged");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 4: an untracked file is work whatever it is called -- even when
// its name sits next to a runtime-state path.
async function t19_untrackedFilesAlwaysCountAsDirt() {
  const name = "W19 an untracked file is dirt, whatever it is called";
  try {
    const { fs, ex } = reuseDeps("corleone", { status: "?? scratch.txt", behind: "0" });
    const r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec });
    assert.equal(r.dirty, 1, "a new file is work");

    const { fs: fs2, ex: ex2 } = reuseDeps("corleone", { status: "?? state/ledger.jsonl.bak", behind: "0" });
    const r2 = ensureLaneWorktree("corleone", { _fs: fs2, _exec: ex2.exec });
    assert.equal(r2.dirty, 1, "an untracked sibling of a runtime-state path is NOT runtime state");
    assert.match(r2.reason, /NOT clean/, "and it is reported as work");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 5: THE motivating case -- stale with only runtime-state dirt is
// fast-forwarded, not refused. Before the packet this tree was refused on
// ledger lines that are not work.
async function t20_staleWithOnlyRuntimeStateFastForwards() {
  const name = "W20 a stale tree dirty only in runtime state is fast-forwarded, not refused";
  try {
    const { fs, ex } = reuseDeps("hatta", { status: " M state/ledger.jsonl", behind: "7", extra: { "merge --ff-only origin/main": "" } });
    const r = ensureLaneWorktree("hatta", { _fs: fs, _exec: ex.exec });
    assert.equal(r.isolated, true, "not refused");
    assert.equal(r.dirty, 0, "runtime state did not count against it");
    assert.equal(r.behind, 7, "the measured gap is still reported");
    const ff = ex.calls.find((c) => c.args[2] === "merge");
    assert.ok(ff, "a fast-forward was attempted");
    assert.deepEqual(ff.args.slice(2), ["merge", "--ff-only", "origin/main"], "and it was ff-only, never a merge commit");
    assert.match(r.reason, /fast-forwarded 7 commits/, "the reason carries the number");
    assert.match(r.reason, /runtime-state/, "and says the dirt it skipped is runtime state");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 6: real work plus stale is still refused, both numbers named.
async function t21_workPlusStaleStillRefuses() {
  const name = "W21 real work plus runtime state on a stale tree is still refused, both numbers named";
  try {
    const { fs, ex } = reuseDeps("hatta", { status: " M state/ledger.jsonl\n M a.mjs\n?? b.txt", behind: "13" });
    const r = ensureLaneWorktree("hatta", { _fs: fs, _exec: ex.exec });
    assert.equal(r.isolated, true, "isolation still only says which tree was returned");
    assert.equal(r.refused, true, "work plus stale is a refusal");
    assert.equal(r.dirty, 2, "the count is the real work only, runtime state excluded");
    assert.match(r.reason, /2 uncommitted entries/, "the reason names the work count");
    assert.match(r.reason, /13 commits behind origin\/main/, "the reason names the behind count");
    assert.equal(ex.calls.some((c) => c.args[2] === "merge"), false, "a dirty tree is never updated behind its dirt");
    ok(name);
  } catch (err) { bad(name, err); }
}

// Packet test 7: an unanswerable git still yields the unknown-dirt behaviour
// and never throws.
async function t22_unanswerableGitStillUnknownNotThrown() {
  const name = "W22 an unanswerable git still yields unknown dirt and does not throw";
  try {
    const { fs, ex } = reuseDeps("corleone", {
      status: () => { throw new Error("fatal: not a git repository"); },
    });
    let r;
    assert.doesNotThrow(() => { r = ensureLaneWorktree("corleone", { _fs: fs, _exec: ex.exec }); });
    assert.equal(r.dirty, null, "could not look is not the same fact as no dirt");
    assert.equal(r.isolated, true, "an unanswerable status does not cost the lane its tree");
    assert.doesNotMatch(r.reason, /NOT clean/, "no false work warning on an unknown tree");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher lane-worktree regression tests");
  await t1_eachLaneGetsItsOwnPathAndBranch();
  await t2_laneNamesAreSanitised();
  await t3_createsTheWorktreeWhenAbsent();
  await t3b_withoutSourceRepoKeepsTheOldPathAndCwd();
  await t3c_sourceRepoGetsItsOwnSafeWorktreeDirectory();
  await t3d_sourceRepoControlsGitCwdTargetAndFallback();
  await t3e_sourceRepoSegmentCannotEscapeTheWorktreeRoot();
  await t4_reusesAnExistingWorktree();
  await t4b_reuseReportsTheDirtItIsHandingOver();
  await t5_fallbackIsReportedNotSilent();
  await t6_neverThrows();
  await t7_listParsesPorcelain();
  await t8_cleanAndBehindFastForwards();
  await t9_cleanAndCurrentStaysPut();
  await t10_dirtyAndCurrentStillReused();
  await t11_dirtyAndBehindRefuses();
  await t12_branchMismatchIsReportedNotFixed();
  await t13_unmeasurableBehindIsNullNotZero();
  await t14_createdWorktreeIsCurrent();
  await t15_noDestructiveGitVerbEver();
  await t16_runtimeStateOnlyCountsAsClean();
  await t17_runtimeStatePlusWorkCountsTheWorkOnly();
  await t18_realWorkOnlyIsUnchanged();
  await t19_untrackedFilesAlwaysCountAsDirt();
  await t20_staleWithOnlyRuntimeStateFastForwards();
  await t21_workPlusStaleStillRefuses();
  await t22_unanswerableGitStillUnknownNotThrown();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("lane-worktree regression runner crashed:", err); process.exit(1); });
