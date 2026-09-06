// ops-watcher/merge-steward.regression.test.mjs
// Offline regression tests for ops-watcher/merge-steward.mjs.
//
//   node ops-watcher/merge-steward.regression.test.mjs

import assert from "node:assert/strict";
import {
  checkForbiddenPaths,
  checkSecretShapedLiterals,
  checkSuite,
  checkSyntax,
  checkTestsAccompanyBehaviour,
  parseArgs,
  reviewLanes,
} from "./merge-steward.mjs";
import * as surface from "./merge-steward.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(String(e && e.stack ? e.stack : e).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(n);
  failed++;
};

function execFixture(responses = {}) {
  const calls = [];
  const exec = (cmd, args, options = {}) => {
    calls.push({ cmd, args: [...(args || [])], cwd: options.cwd });
    const key = Array.isArray(args) ? args.slice(2).join(" ") : "";
    const response = responses[key];
    if (response instanceof Error) throw response;
    if (typeof response === "function") return response(cmd, args, options);
    return response ?? "";
  };
  return { calls, exec };
}

function laneDeps({ dirty = 0, exec, suiteRunner, noSuite } = {}) {
  return {
    repoRoot: "D:\\repo\\main",
    listLaneWorktrees: () => [
      { path: "D:\\repo\\main", branch: "main" },
      { path: "D:\\worktrees\\lane-corleone", branch: "lane/corleone" },
    ],
    dirtyEntryCount: () => dirty,
    existsSync: () => true,
    execFileSync: exec,
    suiteRunner,
    noSuite,
  };
}

async function t1_idleLaneSkipsSuite() {
  const name = "(1) a lane with no ahead commits and no dirt is idle and skips the suite";
  try {
    let suiteCalls = 0;
    const ex = execFixture({
      "rev-list --count origin/main..HEAD": "0\n",
      "diff --name-only origin/main --": "",
      "diff --unified=0 origin/main --": "",
    });
    const report = await reviewLanes(laneDeps({
      dirty: 0,
      exec: ex.exec,
      suiteRunner: () => { suiteCalls++; return "SUITES: 85/85 passed"; },
    }));
    assert.equal(report.worktrees.length, 1);
    assert.equal(report.worktrees[0].verdict, "idle");
    assert.deepEqual(report.worktrees[0].checks, []);
    assert.equal(suiteCalls, 0, "idle lanes do not run the slow suite");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t2_dirtyNullIsUnknown() {
  const name = "(2) dirtyEntryCount null is unknown rather than clean";
  try {
    let suiteCalls = 0;
    const report = await reviewLanes(laneDeps({
      dirty: null,
      exec: execFixture().exec,
      suiteRunner: () => { suiteCalls++; return "SUITES: 85/85 passed"; },
    }));
    assert.equal(report.worktrees[0].verdict, "unknown");
    assert.match(report.worktrees[0].reason, /uncommitted entries could not be inspected/);
    assert.equal(suiteCalls, 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

function t3_forbiddenPaths() {
  const name = "(3) forbidden paths block protected settings, env files and ventures";
  try {
    for (const p of [".claude/settings.json", ".env.local", ".envrc", "ventures/caveman-trading-os/README.md"]) {
      const result = checkForbiddenPaths({ changedFiles: [p] });
      assert.equal(result.name, "forbidden-paths");
      assert.equal(result.ok, false, `${p} is forbidden`);
    }
    assert.equal(checkForbiddenPaths({ changedFiles: ["ops-watcher/x.mjs"] }).ok, true);
    ok(name);
  } catch (err) { bad(name, err); }
}

function t4_testsAccompanyBehaviour() {
  const name = "(4) behaviour mjs changes under watched dirs require a test change";
  try {
    assert.equal(checkTestsAccompanyBehaviour({ changedFiles: ["ops-watcher/foo.mjs"] }).ok, false);
    assert.equal(checkTestsAccompanyBehaviour({
      changedFiles: ["ops-watcher/foo.mjs", "ops-watcher/foo.regression.test.mjs"],
    }).ok, true);
    assert.equal(checkTestsAccompanyBehaviour({ changedFiles: ["ops-watcher/README.md"] }).ok, true);
    ok(name);
  } catch (err) { bad(name, err); }
}

function t5_secretShapedLiterals() {
  const name = "(5) secret shaped literals catch token assignments without firing on ordinary long text";
  try {
    const tokenLine = "+const apiToken = \"0123456789abcdef0123456789abcdef01234567\";";
    assert.equal(checkSecretShapedLiterals({ addedLines: [tokenLine] }).ok, false);
    assert.equal(checkSecretShapedLiterals({
      addedLines: [
        "+import thing from \"../../ops-watcher/some/really/long/module/path/with/names.mjs\";",
        "+// sha 0123456789abcdef0123456789abcdef01234567 from the previous run",
      ],
    }).ok, true);
    ok(name);
  } catch (err) { bad(name, err); }
}

function t6_suiteNoVerdictFails() {
  const name = "(6) suite output without a SUITES verdict fails honestly";
  try {
    const result = checkSuite({ path: "D:\\worktrees\\lane-corleone" }, { suiteRunner: () => "all done" });
    assert.equal(result.ok, false);
    assert.match(result.detail, /no verdict/);
    ok(name);
  } catch (err) { bad(name, err); }
}

function t7_suiteParsesPassedCounts() {
  const name = "(7) suite passes only when passed count equals total count";
  try {
    assert.equal(checkSuite({}, { suiteRunner: () => "SUITES: 85/85 passed" }).ok, true);
    assert.equal(checkSuite({}, { suiteRunner: () => "SUITES: 84/85 passed" }).ok, false);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t8_slowCheckSkippedAfterEarlierFailure() {
  const name = "(8) suite is skipped when an earlier check failed";
  try {
    let suiteCalls = 0;
    const ex = execFixture({
      "rev-list --count origin/main..HEAD": "1\n",
      "diff --name-only origin/main --": ".env.local\n",
      "diff --unified=0 origin/main --": "+TOKEN=notneeded\n",
    });
    const report = await reviewLanes(laneDeps({
      dirty: 0,
      exec: ex.exec,
      suiteRunner: () => { suiteCalls++; return "SUITES: 85/85 passed"; },
    }));
    assert.equal(report.worktrees[0].verdict, "blocked");
    assert.ok(report.worktrees[0].checks.some((check) => check.name === "forbidden-paths" && !check.ok));
    assert.equal(suiteCalls, 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

function t9_hostileInputsNeverThrow() {
  const name = "(9) checks return results for hostile inputs instead of throwing";
  try {
    const hostile = [null, undefined, 7, [], "x".repeat(20000)];
    for (const input of hostile) {
      for (const fn of [checkSyntax, checkForbiddenPaths, checkTestsAccompanyBehaviour, checkSecretShapedLiterals, checkSuite]) {
        const result = fn(input, { execFileSync: () => { throw new Error("hostile"); }, suiteRunner: () => { throw new Error("hostile"); } });
        assert.equal(typeof result.name, "string");
        assert.equal(typeof result.ok, "boolean");
        assert.equal(typeof result.detail, "string");
      }
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function t11_parseArgsRecognisesNoSuite() {
  const name = "(11) parseArgs recognises --no-suite and defaults it off";
  try {
    assert.equal(parseArgs(["--once", "--no-suite"]).noSuite, true, "--no-suite sets noSuite");
    assert.equal(parseArgs(["--no-suite"]).noSuite, true, "noSuite does not require --once");
    assert.equal(parseArgs(["--once"]).noSuite, false, "absence leaves today's default");
    assert.equal(parseArgs([]).noSuite, false, "empty argv leaves today's default");
    ok(name);
  } catch (err) { bad(name, err); }
}

function cleanLaneFixture() {
  return execFixture({
    "rev-list --count origin/main..HEAD": "1\n",
    "diff --name-only origin/main --": "ops-watcher/foo.mjs\nops-watcher/foo.test.mjs\n",
    "diff --unified=0 origin/main --": "",
  });
}

async function t12_noSuiteSkipsRunnerAndIsNotClean() {
  const name = "(12) --no-suite never calls the suite runner and reports unverified, not clean";
  try {
    let suiteCalls = 0;
    const report = await reviewLanes(laneDeps({
      dirty: 0,
      exec: cleanLaneFixture().exec,
      suiteRunner: () => { suiteCalls++; return "SUITES: 85/85 passed"; },
      noSuite: true,
    }));
    const tree = report.worktrees[0];
    assert.equal(suiteCalls, 0, "injected suite runner is never called with --no-suite");
    assert.notEqual(tree.verdict, "clean", "a worktree whose suite never ran must not be clean");
    assert.equal(tree.verdict, "unverified");
    const suite = tree.checks.find((check) => check.name === "suite");
    assert.ok(suite, "suite check is present");
    assert.equal(suite.skipped, true, "suite check is marked skipped");
    assert.equal(suite.ok, null, "skipped is neither pass nor fail");
    assert.equal(tree.checks.filter((check) => check.ok).length, 4, "the four cheap checks are listed as passed");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t13_withoutFlagSuiteStillRuns() {
  const name = "(13) without --no-suite the suite still runs and a passing lane is clean";
  try {
    let suiteCalls = 0;
    const report = await reviewLanes(laneDeps({
      dirty: 0,
      exec: cleanLaneFixture().exec,
      suiteRunner: () => { suiteCalls++; return "SUITES: 85/85 passed"; },
    }));
    const tree = report.worktrees[0];
    assert.equal(suiteCalls, 1, "suite runner still runs without the flag");
    assert.equal(tree.verdict, "clean", "passing worktree is still clean");
    const suite = tree.checks.find((check) => check.name === "suite");
    assert.ok(suite && suite.ok === true && !suite.skipped, "suite check ran and passed");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t14_blockedEitherWaySuiteNeverRuns() {
  const name = "(14) a cheap-check block is blocked with and without --no-suite and never runs the suite";
  try {
    for (const noSuite of [false, true]) {
      let suiteCalls = 0;
      const ex = execFixture({
        "rev-list --count origin/main..HEAD": "1\n",
        "diff --name-only origin/main --": ".env.local\n",
        "diff --unified=0 origin/main --": "+TOKEN=notneeded\n",
      });
      const report = await reviewLanes(laneDeps({
        dirty: 0,
        exec: ex.exec,
        suiteRunner: () => { suiteCalls++; return "SUITES: 85/85 passed"; },
        noSuite,
      }));
      const tree = report.worktrees[0];
      assert.equal(tree.verdict, "blocked", `blocked with noSuite=${noSuite}`);
      assert.equal(suiteCalls, 0, `suite not run when an earlier check failed (noSuite=${noSuite})`);
      assert.ok(!tree.checks.some((check) => check.name === "suite"), "no suite entry is fabricated after an early block");
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function t10_exportedSurfaceHasNoMutators() {
  const name = "(10) exported function names contain no mutating operation";
  try {
    const mutators = Object.entries(surface)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name)
      .filter((name) => /merge|commit|push|reset|clean/i.test(name));
    assert.deepEqual(mutators, []);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# merge-steward regression tests");
  await t1_idleLaneSkipsSuite();
  await t2_dirtyNullIsUnknown();
  t3_forbiddenPaths();
  t4_testsAccompanyBehaviour();
  t5_secretShapedLiterals();
  t6_suiteNoVerdictFails();
  t7_suiteParsesPassedCounts();
  await t8_slowCheckSkippedAfterEarlierFailure();
  t9_hostileInputsNeverThrow();
  t10_exportedSurfaceHasNoMutators();
  t11_parseArgsRecognisesNoSuite();
  await t12_noSuiteSkipsRunnerAndIsNotClean();
  await t13_withoutFlagSuiteStillRuns();
  await t14_blockedEitherWaySuiteNeverRuns();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => { console.error("merge-steward regression runner crashed:", err); process.exit(1); });
