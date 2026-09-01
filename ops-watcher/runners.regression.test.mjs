// ops-watcher/runners.regression.test.mjs
// Dependency-free regression tests for test-runner.mjs and review-runner.mjs.
// No test framework — uses node:assert/strict and local node:http mock servers
// standing in for Paperclip. The hermes dispatch and the test command are
// replaced with injected fake functions, so these run fully offline with no
// live Paperclip, no live network, no real LLM.
//
//   node ops-watcher/runners.regression.test.mjs
//
// Pattern follows ops-watcher/watcher.regression.test.mjs (manual pass/fail
// runner, throwaway ephemeral-port http servers).
//
// === TEST ISOLATION (lock file) ===
// EVERY sweep test below injects lockFile: TMP_LOCK (a per-test temp lock path
// DISTINCT from the real production ops-watcher/test-runner.lock and
// ops-watcher/review-runner.lock), plus the same acquireLock/releaseLock/_fs
// the reference pattern (review-runner.regression.test.mjs /
// steward.regression.test.mjs) uses. This guarantees no offline unit test ever
// touches the REAL production lock files, so a concurrently-running live
// heartbeat-daemon (which holds the real review-runner.lock /
// test-runner.lock during its 5-min sweeps) can never collide with a unit test
// and cause a spurious "refused" failure. Mirrors the same "tests must never
// touch real production state" principle applied to the telegram-listener-daemon
// real-spawn fix.

import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runTestOnce, runCommandReal } from "./test-runner.mjs";
import { runReviewOnce } from "./review-runner.mjs";
import {
  acquireLock,
  releaseLock,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Per-test temp lock (NOT the real production test-runner.lock /
// review-runner.lock) so a live heartbeat-daemon sweep can never collide with a
// unit test. Both runTestOnce and runReviewOnce accept the same lockFile deps
// seam, and these tests run sequentially within one process, so a single shared
// temp lock (cleared before each test) is sufficient and matches the reference
// pattern in review-runner.regression.test.mjs.
const TMP_LOCK = path.join(__dirname, "runners.regression.lock.tmp");
const LOCK_DEPS = {
  lockFile: TMP_LOCK,
  acquireLock,
  releaseLock,
  isAlive: isPidAliveReal,
  _fs: fs,
};
// Clear any stale temp lock before a sweep test (mirrors the reference's
// clearTempLock). acquireLock's staleness check uses isAlive(pid); a leftover
// lock from a previously-crashed test carries THIS process's pid (alive), so it
// would NOT be auto-cleared — the explicit unlink is essential.
const clearTempLock = () => fs.unlink(TMP_LOCK).catch(() => {});

const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const GIBRAN_AGENT_ID = "ce433688-4e0d-4902-addd-b7d27eb081b7";
const TEST_REQUIRED_ID = "lbl-test-required";
const REVIEW_REQUIRED_ID = "lbl-review-required";
const NEEDS_REWORK_ID = "lbl-needs-rework";
const DONE_VERIFIED_ID = "lbl-done-verified";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(`       ${err && err.stack ? err.stack : err}`);
  failures.push(name); failed++;
}

// ---- Stateful Paperclip mock ----
function makeState() {
  return {
    labels: [
      { id: TEST_REQUIRED_ID, name: "TEST_REQUIRED", color: "#3b82f6" },
      { id: REVIEW_REQUIRED_ID, name: "REVIEW_REQUIRED", color: "#ef4444" },
      { id: NEEDS_REWORK_ID, name: "NEEDS_REWORK", color: "#f97316" },
      { id: DONE_VERIFIED_ID, name: "DONE_VERIFIED", color: "#22c55e" },
    ],
    issues: [],
    commentsByIssue: {}, // issueId -> [comment]
    runs: [],
    wakeupCalls: 0,
    lastCommentHeaders: null,
    lastCommentBody: null,
    createdLabels: [],
  };
}

function startMock(state) {
  const server = http.createServer((req, res) => {
    try {
      handleMock(req, res, state);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: String(err && err.message) }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function readBody(req) {
  return new Promise((r) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => r(b));
  });
}

function sendJson(res, code, obj) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}

function handleMock(req, res, state) {
  const u = req.url || "";
  const m = req.method;

  // /api/companies/{cid}/labels
  if (u === `/api/companies/${COMPANY_ID}/labels`) {
    if (m === "GET") return sendJson(res, 200, state.labels);
    if (m === "POST") return readBody(req).then((b) => {
      const obj = JSON.parse(b || "{}");
      const lbl = { id: randomUUID(), name: obj.name, color: obj.color };
      state.labels.push(lbl);
      state.createdLabels.push(lbl.name);
      return sendJson(res, 201, lbl);
    });
  }

  // /api/companies/{cid}/issues
  if (u === `/api/companies/${COMPANY_ID}/issues` && m === "GET")
    return sendJson(res, 200, state.issues);

  // /api/issues/{id}
  const issueMatch = u.match(/^\/api\/issues\/([^/]+)$/);
  if (issueMatch) {
    const id = issueMatch[1];
    if (m === "GET") {
      const it = state.issues.find((x) => x.id === id);
      return sendJson(res, it ? 200 : 404, it || { error: "not found" });
    }
    if (m === "PATCH") return readBody(req).then((b) => {
      const obj = JSON.parse(b || "{}");
      const it = state.issues.find((x) => x.id === id);
      if (it) Object.assign(it, obj);
      return sendJson(res, 200, it || { error: "not found" });
    });
  }

  // /api/issues/{id}/comments
  const commentsMatch = u.match(/^\/api\/issues\/([^/]+)\/comments$/);
  if (commentsMatch) {
    const id = commentsMatch[1];
    if (m === "GET") return sendJson(res, 200, state.commentsByIssue[id] || []);
    if (m === "POST") return readBody(req).then((b) => {
      const obj = JSON.parse(b || "{}");
      state.lastCommentHeaders = req.headers;
      state.lastCommentBody = obj;
      const c = {
        id: randomUUID(),
        issueId: id,
        authorAgentId: obj.authorType === "agent" ? GIBRAN_AGENT_ID : null,
        authorUserId: obj.authorType === "user" ? "local-board" : null,
        authorType: obj.authorType,
        createdByRunId: req.headers["x-paperclip-run-id"] || null,
        body: obj.body,
      };
      (state.commentsByIssue[id] = state.commentsByIssue[id] || []).push(c);
      return sendJson(res, 201, c);
    });
  }

  // /api/agents/{id}/keys
  const keysMatch = u.match(/^\/api\/agents\/([^/]+)\/keys$/);
  if (keysMatch && m === "POST")
    return sendJson(res, 201, { id: randomUUID(), name: "x", token: "pcp_fake_token" });

  // /api/agents/{id}/wakeup
  const wakeMatch = u.match(/^\/api\/agents\/([^/]+)\/wakeup$/);
  if (wakeMatch && m === "POST") {
    state.wakeupCalls++;
    const runId = randomUUID();
    state.runs.push({ id: runId, agentId: GIBRAN_AGENT_ID, status: "running", tiedIssueId: null });
    return readBody(req).then((b) => {
      try { const o = JSON.parse(b || "{}"); state.runs[state.runs.length - 1].tiedIssueId = o.payload && o.payload.issueId; } catch { /* */ }
      return sendJson(res, 202, { id: runId, agentId: GIBRAN_AGENT_ID, status: "queued" });
    });
  }

  // /api/companies/{cid}/heartbeat-runs
  if (u === `/api/companies/${COMPANY_ID}/heartbeat-runs` && m === "GET")
    return sendJson(res, 200, state.runs);

  // /api/heartbeat-runs/{id}
  const runMatch = u.match(/^\/api\/heartbeat-runs\/([^/]+)$/);
  if (runMatch && m === "GET") {
    const r = state.runs.find((x) => x.id === runMatch[1]);
    return sendJson(res, 200, r || { status: "running" });
  }

  // /api/heartbeat-runs/{id}/issues
  const runIssuesMatch = u.match(/^\/api\/heartbeat-runs\/([^/]+)\/issues$/);
  if (runIssuesMatch && m === "GET") {
    const r = state.runs.find((x) => x.id === runIssuesMatch[1]);
    return sendJson(res, 200, r && r.tiedIssueId ? [{ issueId: r.tiedIssueId }] : []);
  }

  // /api/heartbeat-runs/{id}/cancel
  const cancelMatch = u.match(/^\/api\/heartbeat-runs\/([^/]+)\/cancel$/);
  if (cancelMatch && m === "POST") {
    const r = state.runs.find((x) => x.id === cancelMatch[1]);
    if (r) r.status = "cancelled";
    return sendJson(res, 200, r || { status: "cancelled" });
  }

  res.statusCode = 404;
  res.end();
}

function makeIssue(opts) {
  return Object.assign({
    id: randomUUID(),
    companyId: COMPANY_ID,
    identifier: "KOL-X",
    title: "test issue",
    description: "",
    status: "todo",
    labels: [],
    labelIds: [],
    assigneeAgentId: null,
  }, opts);
}

// =====================================================================
// TEST-RUNNER TESTS
// =====================================================================

async function testRunnerPass() {
  const name = "test-runner happy path PASS -> REVIEW_REQUIRED + in_review";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({
    identifier: "KOL-PASS",
    title: "SELFTEST pass issue",
    description: "some change",
    status: "todo",
    labels: [{ name: "TEST_REQUIRED" }],
    labelIds: [TEST_REQUIRED_ID],
  });
  state.issues = [issue];
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await runTestOnce({
      base,
      companyId: COMPANY_ID,
      runCommand: async () => ({ code: 0, stdout: "all good", stderr: "", timedOut: false }),
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.equal(r.error, undefined, "no error");
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].outcome, "PASS");
    // labels swapped
    assert.deepEqual(issue.labelIds, [REVIEW_REQUIRED_ID], "TEST_REQUIRED swapped for REVIEW_REQUIRED");
    assert.equal(issue.status, "in_review", "status set to in_review");
    // a comment was posted
    const comments = state.commentsByIssue[issue.id];
    assert.ok(comments && comments.length === 1, "exactly one comment posted");
    assert.ok(/TEST RESULT.*PASS/i.test(comments[0].body), "comment says PASS");
    assert.equal(comments[0].authorType, "user", "test comment authored by board");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function testRunnerFail() {
  const name = "test-runner FAIL path keeps TEST_REQUIRED + status todo (rework signal)";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({
    identifier: "KOL-FAIL",
    title: "SELFTEST fail issue",
    description: "test-cmd: node ops-watcher/watcher.regression.test.mjs",
    status: "in_progress",
    labels: [{ name: "TEST_REQUIRED" }],
    labelIds: [TEST_REQUIRED_ID],
  });
  state.issues = [issue];
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await runTestOnce({
      base,
      companyId: COMPANY_ID,
      runCommand: async () => ({ code: 1, stdout: "out", stderr: "boom", timedOut: false }),
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.equal(r.results[0].outcome, "FAIL");
    assert.deepEqual(issue.labelIds, [TEST_REQUIRED_ID], "TEST_REQUIRED retained on FAIL");
    assert.equal(issue.status, "todo", "status set to todo on FAIL");
    const comments = state.commentsByIssue[issue.id];
    assert.ok(comments.length === 1 && /FAIL/i.test(comments[0].body), "FAIL comment posted");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function testRunnerNetworkNoCrash() {
  const name = "test-runner Paperclip network error does not crash";
  await clearTempLock();
  try {
    const r = await runTestOnce({
      base: "http://127.0.0.1:59996", // closed port
      companyId: COMPANY_ID,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.ok(r.error, "expected an error outcome, got: " + JSON.stringify(r));
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testRunnerRejectsNonAllowlisted() {
  const name = "test-runner rejects a non-allowlisted test-cmd (FAIL, no execution)";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({
    identifier: "KOL-BAD",
    title: "SELFTEST bad cmd",
    description: "test-cmd: rm -rf /",
    status: "todo",
    labels: [{ name: "TEST_REQUIRED" }],
    labelIds: [TEST_REQUIRED_ID],
  });
  state.issues = [issue];
  let ran = false;
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await runTestOnce({
      base, companyId: COMPANY_ID,
      runCommand: async () => { ran = true; return { code: 0, stdout: "", stderr: "", timedOut: false }; },
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.equal(ran, false, "non-allowlisted command must NOT be executed");
    assert.equal(r.results[0].outcome, "FAIL");
    assert.equal(r.results[0].notAllowlisted, true);
    assert.deepEqual(issue.labelIds, [TEST_REQUIRED_ID], "TEST_REQUIRED retained");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

// =====================================================================
// REVIEW-RUNNER TESTS
// =====================================================================

async function reviewRunnerPassAttributed() {
  const name = "review-runner PASS verdict -> attributed GIBRAN comment + done + DONE_VERIFIED";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({
    identifier: "KOL-REV-PASS",
    title: "SELFTEST review pass",
    description: "a wiring-verification issue",
    status: "in_review",
    labels: [{ name: "REVIEW_REQUIRED" }],
    labelIds: [REVIEW_REQUIRED_ID],
  });
  state.issues = [issue];
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await runReviewOnce({
      base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID,
      dispatchReviewer: async () => ({ ok: true, stdout: "looks good\nVERDICT: PASS", stderr: "", timedOut: false }),
      resolveToken: async () => "pcp_fake_token",
      stateFile: path.join(__dirname, "_test_state_pass.json"),
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.equal(r.error, undefined);
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].outcome, "done");
    // an agent-attributed comment landed
    const comments = state.commentsByIssue[issue.id];
    const agentC = comments.find((c) => c.authorAgentId === GIBRAN_AGENT_ID);
    assert.ok(agentC, "an agent-attributed GIBRAN comment was posted");
    assert.ok(/VERDICT:\s*PASS/i.test(agentC.body), "comment contains VERDICT: PASS");
    assert.ok(state.lastCommentHeaders["x-paperclip-run-id"], "comment carried X-Paperclip-Run-Id header");
    assert.ok(state.lastCommentHeaders.authorization, "comment carried agent Bearer token");
    // state transitioned to done + DONE_VERIFIED
    assert.equal(issue.status, "done");
    assert.ok(issue.labelIds.includes(DONE_VERIFIED_ID), "DONE_VERIFIED added");
    assert.ok(!issue.labelIds.includes(REVIEW_REQUIRED_ID), "REVIEW_REQUIRED removed");
    assert.equal(issue.assigneeAgentId, null, "GIBRAN unassigned after review");
    // run was cancelled
    assert.ok(state.runs.every((r2) => r2.status === "cancelled"), "attribution run cancelled");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function reviewRunnerReject() {
  const name = "review-runner REJECT verdict -> NEEDS_REWORK + todo, no crash";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({
    identifier: "KOL-REV-REJECT",
    title: "SELFTEST review reject",
    description: "incomplete work",
    status: "in_review",
    labels: [{ name: "REVIEW_REQUIRED" }],
    labelIds: [REVIEW_REQUIRED_ID],
  });
  state.issues = [issue];
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await runReviewOnce({
      base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID,
      dispatchReviewer: async () => ({ ok: true, stdout: "not enough\nVERDICT: REJECT", stderr: "", timedOut: false }),
      resolveToken: async () => "pcp_fake_token",
      stateFile: path.join(__dirname, "_test_state_reject.json"),
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.equal(r.results[0].outcome, "needs-rework");
    assert.equal(issue.status, "todo");
    assert.ok(issue.labelIds.includes(NEEDS_REWORK_ID));
    assert.ok(!issue.labelIds.includes(REVIEW_REQUIRED_ID));
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function reviewRunnerTimeoutNoCrash() {
  const name = "review-runner reviewer timeout does not crash, defers (REVIEW_REQUIRED kept)";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({
    identifier: "KOL-REV-TIMEOUT",
    title: "SELFTEST timeout",
    status: "in_review",
    labels: [{ name: "REVIEW_REQUIRED" }],
    labelIds: [REVIEW_REQUIRED_ID],
  });
  state.issues = [issue];
  const srv = await startMock(state);
  const stateFile = path.join(__dirname, "_test_state_timeout.json");
  try {
    // clean state
    try { await fs.unlink(stateFile); } catch { /* */ }
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await runReviewOnce({
      base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID,
      dispatchReviewer: async () => ({ ok: false, stdout: "", stderr: "timed out", timedOut: true }),
      resolveToken: async () => "pcp_fake_token",
      stateFile,
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.equal(r.error, undefined, "must not crash");
    assert.equal(r.results[0].outcome, "deferred");
    // REVIEW_REQUIRED kept; status unchanged by review-runner (it didn't PATCH on defer)
    assert.ok(issue.labelIds.includes(REVIEW_REQUIRED_ID), "REVIEW_REQUIRED retained");
    // a failure comment was posted as board
    const comments = state.commentsByIssue[issue.id] || [];
    assert.ok(comments.some((c) => /REVIEW DISPATCH FAILED/i.test(c.body)), "failure comment posted");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function reviewRunnerAttemptCapConvertsToNeedsRework() {
  const name = "review-runner hermes attempt cap -> NEEDS_REWORK (bounded, no infinite loop)";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({
    id: "cap-issue-id",
    identifier: "KOL-CAP",
    title: "SELFTEST cap",
    status: "in_review",
    labels: [{ name: "REVIEW_REQUIRED" }],
    labelIds: [REVIEW_REQUIRED_ID],
  });
  state.issues = [issue];
  const srv = await startMock(state);
  const stateFile = path.join(__dirname, "_test_state_cap.json");
  try {
    // pre-seed attempts at MAX-1 so one more failure hits the cap
    await fs.writeFile(stateFile, JSON.stringify({ attempts: { "cap-issue-id": 2 } }), "utf8");
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await runReviewOnce({
      base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID,
      dispatchReviewer: async () => ({ ok: false, stdout: "", stderr: "err", timedOut: false }),
      resolveToken: async () => "pcp_fake_token",
      stateFile,
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.equal(r.results[0].outcome, "needs-rework");
    assert.ok(issue.labelIds.includes(NEEDS_REWORK_ID));
    assert.ok(!issue.labelIds.includes(REVIEW_REQUIRED_ID), "REVIEW_REQUIRED removed at cap");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function reviewRunnerSkipsExistingVerdict() {
  const name = "review-runner skips issue that already has an agent VERDICT comment (no re-processing)";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({
    identifier: "KOL-ALREADY",
    title: "SELFTEST already reviewed",
    status: "in_review",
    labels: [{ name: "REVIEW_REQUIRED" }],
    labelIds: [REVIEW_REQUIRED_ID],
  });
  state.issues = [issue];
  // pre-existing agent verdict
  state.commentsByIssue[issue.id] = [{
    id: randomUUID(), issueId: issue.id, authorAgentId: GIBRAN_AGENT_ID, authorType: "agent",
    body: "VERDICT: PASS (already done)",
  }];
  let dispatched = false;
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const r = await runReviewOnce({
      base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID,
      dispatchReviewer: async () => { dispatched = true; return { ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false }; },
      resolveToken: async () => "pcp_fake_token",
      stateFile: path.join(__dirname, "_test_state_skip.json"),
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.equal(dispatched, false, "must NOT dispatch hermes when a verdict already exists");
    assert.equal(r.results.length, 0, "no issues processed");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function reviewRunnerNetworkNoCrash() {
  const name = "review-runner Paperclip network error does not crash";
  await clearTempLock();
  try {
    const r = await runReviewOnce({
      base: "http://127.0.0.1:59995",
      companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID,
      dispatchReviewer: async () => ({ ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false }),
      resolveToken: async () => "pcp_fake_token",
      stateFile: path.join(__dirname, "_test_state_net.json"),
      log: () => {},
      ...LOCK_DEPS,
    });
    assert.ok(r.error, "expected error outcome on unreachable Paperclip");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- runner ----

async function cleanup() {
  for (const f of ["_test_state_pass.json", "_test_state_reject.json", "_test_state_timeout.json", "_test_state_cap.json", "_test_state_skip.json", "_test_state_net.json"]) {
    try { await fs.unlink(path.join(__dirname, f)); } catch { /* */ }
  }
  await clearTempLock();
}

async function main() {
  console.log("# ops-watcher runners regression tests");
  await testRunnerPass();
  await testRunnerFail();
  await testRunnerNetworkNoCrash();
  await testRunnerRejectsNonAllowlisted();
  await reviewRunnerPassAttributed();
  await reviewRunnerReject();
  await reviewRunnerTimeoutNoCrash();
  await reviewRunnerAttemptCapConvertsToNeedsRework();
  await reviewRunnerSkipsExistingVerdict();
  await reviewRunnerNetworkNoCrash();
  await cleanup();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("regression runner crashed:", err); process.exit(1); });