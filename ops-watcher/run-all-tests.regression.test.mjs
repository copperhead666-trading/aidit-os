// ops-watcher/run-all-tests.regression.test.mjs
// Offline regression tests for ops-watcher/run-all-tests.mjs.
//
//   node ops-watcher/run-all-tests.regression.test.mjs

import assert from "node:assert/strict";
import { runAllTests, summarize } from "./run-all-tests.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`       ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

function clock(start = 1700000000000, step = 10) {
  let tick = start - step;
  return () => {
    tick += step;
    return tick;
  };
}

function passResult(suite, durationMs = 7) {
  return { suite, ok: true, exitCode: 0, timedOut: false, durationMs, tail: "ok" };
}

function failResult(suite, durationMs = 9) {
  return { suite, ok: false, exitCode: 1, timedOut: false, durationMs, tail: "boom" };
}

function exitCodeFor(results) {
  return results.failed === 0 ? 0 : 1;
}

async function testDiscoveryFiltersAndSorts() {
  const name = "(1) discovery excludes run-all-tests.regression.test.mjs and includes other *.test.mjs names";
  const ran = [];
  try {
    const results = await runAllTests({
      listSuiteFiles: async () => [
        "z.test.mjs",
        "run-all-tests.regression.test.mjs",
        "notes.txt",
        "a.test.mjs",
      ],
      runSuite: async (suite) => {
        ran.push(suite);
        return passResult(suite);
      },
      now: clock(),
      log: () => {},
    });
    assert.deepEqual(ran, ["a.test.mjs", "z.test.mjs"]);
    assert.equal(results.total, 2);
    assert.equal(results.failed, 0);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testAllPassAggregateAndExitCode() {
  const name = "(2) all suites pass -> failed: 0, passed === total, exit-code decision is 0";
  try {
    const results = await runAllTests({
      listSuiteFiles: async () => ["b.test.mjs", "a.test.mjs"],
      runSuite: async (suite) => passResult(suite),
      now: clock(),
      log: () => {},
    });
    assert.equal(results.failed, 0);
    assert.equal(results.passed, results.total);
    assert.equal(exitCodeFor(results), 0);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testOneFailureAggregateAndExitCode() {
  const name = "(3) one suite fails -> failed: 1, failures includes name, exit-code decision is 1";
  try {
    const results = await runAllTests({
      listSuiteFiles: async () => ["a.test.mjs", "bad.test.mjs"],
      runSuite: async (suite) => suite === "bad.test.mjs" ? failResult(suite) : passResult(suite),
      now: clock(),
      log: () => {},
    });
    assert.equal(results.failed, 1);
    assert.deepEqual(results.failures, ["bad.test.mjs"]);
    assert.equal(exitCodeFor(results), 1);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testTimeoutDoesNotAbort() {
  const name = "(4) timed-out suite is failed and later suites still execute";
  const ran = [];
  try {
    const results = await runAllTests({
      listSuiteFiles: async () => ["hang.test.mjs", "later.test.mjs"],
      runSuite: async (suite) => {
        ran.push(suite);
        if (suite === "hang.test.mjs") {
          return { suite, ok: false, exitCode: null, timedOut: true, durationMs: 300000, tail: "timeout" };
        }
        return passResult(suite);
      },
      now: clock(),
      log: () => {},
    });
    assert.deepEqual(ran, ["hang.test.mjs", "later.test.mjs"]);
    assert.equal(results.failed, 1);
    assert.equal(results.suites[0].ok, false);
    assert.equal(results.suites[0].timedOut, true);
    assert.deepEqual(results.failures, ["hang.test.mjs"]);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testThrownRunSuiteCaptured() {
  const name = "(5) injected runSuite throw is captured as a failed suite result, not a crash";
  try {
    const results = await runAllTests({
      listSuiteFiles: async () => ["throws.test.mjs", "after.test.mjs"],
      runSuite: async (suite) => {
        if (suite === "throws.test.mjs") throw "injected runSuite boom";
        return passResult(suite);
      },
      now: clock(),
      log: () => {},
    });
    assert.equal(results.total, 2);
    assert.equal(results.failed, 1);
    assert.deepEqual(results.failures, ["throws.test.mjs"]);
    const thrown = results.suites.find((suite) => suite.suite === "throws.test.mjs");
    const after = results.suites.find((suite) => suite.suite === "after.test.mjs");
    assert.match(thrown.tail, /injected runSuite boom/);
    assert.equal(after.ok, true);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testOnlyFiltering() {
  const name = "(6) --only filtering selects the matching subset";
  const ran = [];
  try {
    const results = await runAllTests({
      listSuiteFiles: async () => ["alpha.test.mjs", "beta.test.mjs", "alphabet.test.mjs"],
      runSuite: async (suite) => {
        ran.push(suite);
        return passResult(suite);
      },
      now: clock(),
      log: () => {},
      only: "alpha",
    });
    assert.deepEqual(ran, ["alpha.test.mjs", "alphabet.test.mjs"]);
    assert.deepEqual(results.suites.map((suite) => suite.suite), ran);
    ok(name);
  } catch (e) { bad(name, e); }
}

function testSummarizePure() {
  const name = "(7) summarize is pure: same input twice -> deep-equal output apart from timestamps";
  try {
    const input = {
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      suites: [
        passResult("a.test.mjs", 10),
        failResult("b.test.mjs", 20),
      ],
    };
    const redactTimestamps = ({ startedAt, finishedAt, ...rest }) => rest;
    const first = summarize(input);
    const second = summarize(input);
    assert.deepEqual(redactTimestamps(first), redactTimestamps(second));
    assert.equal(first.durationMs, 1000);
    assert.equal(second.durationMs, 1000);
    assert.deepEqual(input.suites.map((suite) => suite.suite), ["a.test.mjs", "b.test.mjs"]);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function main() {
  console.log("# run-all-tests regression tests");
  await testDiscoveryFiltersAndSorts();
  await testAllPassAggregateAndExitCode();
  await testOneFailureAggregateAndExitCode();
  await testTimeoutDoesNotAbort();
  await testThrownRunSuiteCaptured();
  await testOnlyFiltering();
  testSummarizePure();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error("regression runner crashed:", e); process.exit(1); });
