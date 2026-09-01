// ops-watcher/test-runner.regression.test.mjs
// Offline regression tests for ops-watcher/test-runner.mjs. Pattern matches
// watcher.regression.test.mjs: node:assert, a local node:http mock Paperclip
// server, a fake runTestCommand (no real subprocess), no live Paperclip.
//
//   node ops-watcher/test-runner.regression.test.mjs
//
// Covers: happy PASS (label swap to REVIEW_REQUIRED), FAIL leaves TEST_REQUIRED,
// already-tested skip (bounded), non-allowlisted command -> FAIL not run,
// Paperclip network error does not crash the script.
//
// T7 (preemptive concurrent-sweep regression): mirrors the exact T7 test shape
// from ahmad-dispatch.regression.test.mjs — two concurrent sweeps against the
// same injected issue must not both dispatch the test command.
//
// === TEST ISOLATION (lock file) ===
// EVERY sweep test (a)-(e) injects lockFile: TMP_LOCK (a per-test temp lock path
// DISTINCT from the real production ops-watcher/test-runner.lock), plus the same
// acquireLock/releaseLock/_fs the T7 test uses. This guarantees no offline unit
// test ever touches the REAL production lock file, so a concurrently-running live
// heartbeat-daemon (which holds the real lock during its 5-min sweeps) can never
// collide with a unit test and cause a spurious "refused" failure. The pure
// helper test (f) makes no sweep call and needs no lock. Mirrors the same
// "tests must never touch real production state" principle applied to the
// telegram-listener-daemon real-spawn fix.

import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTestSweep, runTestOnce, parseTestCommand, TEST_COMMAND_ALLOWLIST } from "./test-runner.mjs";
import {
  acquireLock,
  releaseLock,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_LOCK = path.join(__dirname, "test-runner.regression.lock.tmp");

// Shared lock-deps injection: every sweep test uses the per-test TMP_LOCK (NOT
// the real production ops-watcher/test-runner.lock) so a live heartbeat-daemon
// sweep can never collide with a unit test. Mirrors the T7 pattern exactly.
const LOCK_DEPS = {
  lockFile: TMP_LOCK,
  acquireLock,
  releaseLock,
  _fs: fs,
};
// Clear any stale temp lock before a sweep test (mirrors T7's cleanup line).
const clearTempLock = () => fs.unlink(TMP_LOCK).catch(() => {});

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`       ${e && e.stack ? e.stack : e}`); failures.push(n); failed++; };

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => { try { handler(req, res); } catch (e) { res.statusCode = 500; res.end(); } });
    server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(() => r())) }));
  });
}
function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = ""; req.on("data", (c) => (data += c)); req.on("end", () => { try { resolve(data ? JSON.parse(data) : null); } catch { resolve(null); } });
  });
}

// Mutable mock Paperclip. `state` carries issues/labels/comments so tests can
// inspect side effects. Label ids: lbl-test (TEST_REQUIRED), lbl-review (REVIEW_REQUIRED).
function mockServer(state) {
  return {
    handler: async (req, res) => {
      const url = new URL(req.url, "http://x"); const p = url.pathname;
      const send = (code, body) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
      if (req.method === "GET" && p === "/api/companies/C/issues") return send(200, state.issues);
      if (req.method === "GET" && p === "/api/companies/C/labels") return send(200, state.labels);
      if (req.method === "POST" && p === "/api/companies/C/labels") {
        const b = await readJsonBody(req);
        const ex = state.labels.find((l) => l.name.toUpperCase() === String(b.name).toUpperCase());
        if (ex) return send(201, ex);
        const made = { id: `lbl-${state.labels.length + 1}`, name: b.name, color: b.color };
        state.labels.push(made); return send(201, made);
      }
      const issueMatch = p.match(/^\/api\/issues\/(.+)$/);
      if (issueMatch && !p.includes("/comments")) {
        const id = issueMatch[1];
        const it = state.issues.find((x) => x.id === id);
        if (!it) return send(404, { error: "no issue" });
        if (req.method === "GET") return send(200, it);
        if (req.method === "PATCH") {
          const b = await readJsonBody(req);
          if (b.status !== undefined) it.status = b.status;
          if (b.labelIds !== undefined) { it.labelIds = b.labelIds; it.labels = b.labelIds.map((lid) => state.labels.find((l) => l.id === lid)).filter(Boolean); }
          return send(200, it);
        }
      }
      if (p.endsWith("/comments")) {
        const id = p.match(/^\/api\/issues\/(.+)\/comments$/)[1];
        if (!state.comments[id]) state.comments[id] = [];
        if (req.method === "GET") return send(200, state.comments[id]);
        if (req.method === "POST") {
          const b = await readJsonBody(req);
          const c = { id: `c${state.comments[id].length + 1}`, body: b.body, authorType: "user", authorUserId: "local-board", authorAgentId: null, presentation: b.presentation || null, metadata: b.metadata || null };
          state.comments[id].push(c); return send(201, c);
        }
      }
      send(404, { error: "mock 404 " + p });
    },
  };
}

function baseState() {
  return {
    labels: [
      { id: "lbl-test", name: "TEST_REQUIRED", color: "#3b82f6" },
      { id: "lbl-review", name: "REVIEW_REQUIRED", color: "#ef4444" },
    ],
    issues: [
      { id: "iss-1", identifier: "KOL-100", title: "SELFTEST issue", description: "desc", status: "todo", labels: [{ id: "lbl-test", name: "TEST_REQUIRED" }], labelIds: ["lbl-test"] },
    ],
    comments: { "iss-1": [] },
  };
}

const log = () => {}; // silent during tests

async function testHappyPassSwapsLabel() {
  const name = "(a) happy PASS: posts TEST RESULT: PASS + swaps TEST_REQUIRED->REVIEW_REQUIRED";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeRun = async () => ({ code: 0, stdout: "SELFTEST OK", stderr: "", timedOut: false, error: null });
    const sum = await runTestSweep({ base, token: "t", companyId: "C", runTestCommandFn: fakeRun, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.passed, 1);
    const c = state.comments["iss-1"].find((x) => /TEST RESULT\s*:\s*PASS/i.test(x.body));
    assert.ok(c, "PASS comment posted");
    const it = state.issues[0];
    assert.deepEqual(it.labelIds, ["lbl-review"], "TEST_REQUIRED removed, REVIEW_REQUIRED added");
    assert.equal(it.status, "todo", "status not changed by test-runner");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testFailLeavesTestRequired() {
  const name = "(b) FAIL: posts TEST RESULT: FAIL and leaves TEST_REQUIRED (rework signal)";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeRun = async () => ({ code: 1, stdout: "", stderr: "boom", timedOut: false, error: null });
    const sum = await runTestSweep({ base, token: "t", companyId: "C", runTestCommandFn: fakeRun, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.failed, 1);
    assert.equal(sum.passed, 0);
    const c = state.comments["iss-1"].find((x) => /TEST RESULT\s*:\s*FAIL/i.test(x.body));
    assert.ok(c, "FAIL comment posted");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-test"], "TEST_REQUIRED left in place");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testAlreadyTestedSkipped() {
  const name = "(c) already-tested issue is skipped (bounded rework, no re-test)";
  await clearTempLock();
  const state = baseState();
  state.comments["iss-1"] = [{ id: "c0", body: "TEST RESULT: PASS\n...", authorType: "user" }];
  const s = await startServer(mockServer(state).handler);
  let runCalled = 0;
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeRun = async () => { runCalled++; return { code: 0, stdout: "", stderr: "", timedOut: false, error: null }; };
    const sum = await runTestSweep({ base, token: "t", companyId: "C", runTestCommandFn: fakeRun, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.skipped, 1);
    assert.equal(sum.processed, 0);
    assert.equal(runCalled, 0, "test command must NOT run on already-tested issue");
    assert.equal(state.comments["iss-1"].length, 1, "no new comment posted");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testNonAllowlistedCommandFailsNotRun() {
  const name = "(d) non-allowlisted ```test-command -> FAIL comment, command not run";
  await clearTempLock();
  const state = baseState();
  state.issues[0].description = "```test-command\nrm -rf /\n```\nbad";
  let runCalled = 0;
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeRun = async () => { runCalled++; return { code: 0, stdout: "", stderr: "", timedOut: false, error: null }; };
    const sum = await runTestSweep({ base, token: "t", companyId: "C", runTestCommandFn: fakeRun, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.failed, 1);
    assert.equal(runCalled, 0, "non-allowlisted command must not be executed");
    const c = state.comments["iss-1"].find((x) => /not on the allowlist/i.test(x.body));
    assert.ok(c, "FAIL-not-allowlisted comment posted");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-test"], "TEST_REQUIRED left in place");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testNetworkErrorNoCrash() {
  const name = "(e) Paperclip network error does not crash the script";
  await clearTempLock();
  try {
    const base = "http://127.0.0.1:59993"; // closed port
    const fakeRun = async () => ({ code: 0, stdout: "", stderr: "", timedOut: false, error: null });
    const sum = await runTestSweep({ base, token: "t", companyId: "C", runTestCommandFn: fakeRun, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.passed, 0);
    assert.ok(sum.errors.length >= 1, "errors recorded");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testParseTestCommandPure() {
  const name = "(f) parseTestCommand extracts + normalizes; allowlist contains default";
  try {
    assert.equal(parseTestCommand("no fence"), null);
    assert.equal(parseTestCommand("```test-command\nnode ops-watcher/watcher.mjs --selftest\n```"), "node ops-watcher/watcher.mjs --selftest");
    assert.ok(TEST_COMMAND_ALLOWLIST.has("node ops-watcher/watcher.mjs --selftest"));
    ok(name);
  } catch (e) { bad(name, e); }
}

// =====================================================================
// T7 (preemptive concurrent-sweep regression): two concurrent sweeps must not
// both dispatch the test command — mirrors the exact T7 test shape from
// ahmad-dispatch.regression.test.mjs.
// =====================================================================
async function t7_concurrentSweepsDoNotDoubleDispatch() {
  await fs.unlink(TMP_LOCK).catch(() => {});

  // Shared mutable "Paperclip" state, read+written by both sweeps.
  const comments = [];               // live comment list (TEST RESULT appended on POST)
  let runCommandCount = 0;           // count of runCommand invocations
  let commentPosts = 0;              // count of POST comments
  let patchCalls = 0;                 // count of PATCH issue calls
  let getCommentsCalls = 0;           // how many times comments were GETted
  let getIssuesCalls = 0;             // how many times the issues list was GETted

  // Gate: fires the moment sweep A has provably passed the lock and entered its
  // sweep (its issues-list GET is the first Paperclip read, and it only happens
  // after acquireLock resolved with acquired:true).
  let signalAInSweep;
  const aInSweep = new Promise((res) => { signalAInSweep = res; });

  const GET_DELAY_MS = 25;
  const WINNER_PID = 424242;
  const isAlive = (pid) => pid === WINNER_PID;

  const labels = [
    { id: "lbl-test", name: "TEST_REQUIRED", color: "#3b82f6" },
    { id: "lbl-review", name: "REVIEW_REQUIRED", color: "#ef4444" },
    { id: "lbl-owner", name: "OWNER_REQUIRED", color: "#991b1b" },
  ];

  const issue = {
    id: "iss-1",
    identifier: "KOL-100",
    title: "test",
    description: "desc",
    status: "todo",
    labels: [{ id: "lbl-test", name: "TEST_REQUIRED" }],
    labelIds: ["lbl-test"],
  };

  const sharedDeps = {
    base: "http://127.0.0.1:9999",
    companyId: "C",
    httpGet: async (url) => {
      if (url.includes("/labels")) return { networkError: false, body: labels };
      if (url.endsWith("/issues")) {
        getIssuesCalls += 1;
        if (getIssuesCalls === 1) signalAInSweep();
        return { networkError: false, body: [issue] };
      }
      if (url.includes("/comments")) {
        getCommentsCalls += 1;
        if (getCommentsCalls === 1) await new Promise((r) => setTimeout(r, GET_DELAY_MS));
        return { networkError: false, body: comments.slice() };
      }
      return { networkError: false, body: [] };
    },
    httpPost: async (url, body, opts) => {
      if (url.includes("/comments")) {
        commentPosts += 1;
        comments.push({ id: `cmt-${commentPosts}`, body: body.body, authorType: "user", authorAgentId: null });
        return { networkError: false, status: 201, body: { id: `cmt-${commentPosts}` } };
      }
      if (url.includes("/labels")) return { networkError: false, status: 201, body: { id: "lbl-x" } };
      return { networkError: false, status: 201, body: {} };
    },
    httpPatch: async (url, body) => {
      patchCalls += 1;
      return { networkError: false, status: 200, body: { ...issue, ...body } };
    },
    runCommand: async () => {
      runCommandCount += 1;
      return { code: 0, stdout: "SELFTEST OK", stderr: "", timedOut: false, error: null };
    },
    log: () => {},
  };

  // Launch sweep A (do not await yet) — it acquires the lock and enters its sweep.
  const pA = runTestOnce({
    ...sharedDeps,
    lockFile: TMP_LOCK,
    acquireLock,
    releaseLock,
    isAlive,
    lockPid: WINNER_PID,
    _fs: fs,
  });

  // Wait until A has provably acquired the lock and is inside its sweep.
  await aInSweep;

  // NOW launch sweep B against the same live state while A is still parked in
  // its comments-GET delay. B's acquireLock reads A's lock file, sees
  // WINNER_PID alive -> refused. B performs NO Paperclip read/write/runCommand.
  const rB = await runTestOnce({
    ...sharedDeps,
    lockFile: TMP_LOCK,
    acquireLock,
    releaseLock,
    isAlive,
    lockPid: WINNER_PID + 1,
    _fs: fs,
  });

  // Collect A's result (it finishes the test: runCommand + POST + PATCH).
  const rA = await pA;

  // ---- Preemptive regression assertions ----
  assert.equal(runCommandCount, 1, `T7: exactly ONE runCommand call under concurrency (got ${runCommandCount})`);
  assert.equal(commentPosts, 1, `T7: exactly ONE TEST RESULT comment posted under concurrency (got ${commentPosts})`);
  assert.equal(patchCalls, 1, `T7: exactly ONE issue transition PATCH (got ${patchCalls})`);

  // Exactly one sweep refused, exactly one performed the real test.
  const refused = [rA, rB].filter((r) => r.refused);
  assert.equal(refused.length, 1, "T7: exactly one concurrent sweep is refused (the loser sees the lock held)");
  assert.equal(rB.refused, true, "T7: the second-launched sweep (B) is the one refused");
  assert.equal(rB.results.length, 0, "T7: the refused sweep records no issue results");

  // The refused sweep must NOT have touched Paperclip at all — no issues GET.
  assert.equal(getIssuesCalls, 1, `T7: issues-list GETted exactly once (refused sweep never reads Paperclip) — got ${getIssuesCalls}`);

  // Clean up the temp lock.
  await fs.unlink(TMP_LOCK).catch(() => {});
  ok("T7: preemptive regression — two concurrent sweeps cannot both run the test command (single-instance lock closes the TOCTOU race)");
}

async function main() {
  console.log("# test-runner regression tests");
  await testHappyPassSwapsLabel();
  await testFailLeavesTestRequired();
  await testAlreadyTestedSkipped();
  await testNonAllowlistedCommandFailsNotRun();
  await testNetworkErrorNoCrash();
  await testParseTestCommandPure();
  await t7_concurrentSweepsDoNotDoubleDispatch();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error("regression runner crashed:", e); process.exit(1); });