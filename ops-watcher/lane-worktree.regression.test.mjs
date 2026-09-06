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
    // The one git call it MAY make is a read: how dirty is the tree it is about
    // to hand over. Reused does not mean clean, and a lane that inherits another
    // run's leftovers produces a diff containing work nobody asked it to do.
    assert.deepEqual(ex.calls.map((c) => c.args.slice(2).join(" ")), ["status --porcelain"],
      "reuse asks exactly one read-only question and mutates nothing");
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
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("lane-worktree regression runner crashed:", err); process.exit(1); });
