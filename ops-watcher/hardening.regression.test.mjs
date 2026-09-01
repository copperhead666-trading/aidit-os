// ops-watcher/hardening.regression.test.mjs
// PHASE 3 hardening regression tests. Offline: node:assert/strict + local
// node:http mock Paperclip (same pattern as runners.regression.test.mjs). No
// live Paperclip, no live hermes, no real LLM. The test command and hermes
// dispatch are injected fakes.
//
//   node ops-watcher/hardening.regression.test.mjs
//
// Covers:
//   (H1) Duplicate-dispatch protection for BOTH runners (two --once in a row
//        against the same issue state -> no double comment / label swap / dispatch).
//   (H2) OWNER_REQUIRED blocker: both runners skip + LOG (never act, never
//        transition) even when TEST_REQUIRED/REVIEW_REQUIRED is also present.
//   (H3) Worker/provider failure must not kill the runner: a throwing test
//        command / throwing hermes dispatch for one issue is caught, logged, and
//        the sweep continues to the next issue.
//   (H4) Retry/rework reset: after a REJECT, re-applying REVIEW_REQUIRED (fresh
//        label application, status moved away from in_review) resets the attempt
//        counter and gives a genuine new dispatch chance, while an UNCONSUMED
//        verdict still in_review is skipped (no double-dispatch), and the OLD
//        consumed verdict is not re-used as the new verdict.
//
// === TEST ISOLATION (lock file) ===
// EVERY sweep below injects lockFile: TMP_LOCK (a per-test temp lock path
// DISTINCT from the real production ops-watcher/test-runner.lock and
// ops-watcher/review-runner.lock), plus the same acquireLock/releaseLock/_fs
// the reference pattern (review-runner.regression.test.mjs / steward.regression.test.mjs)
// uses. This guarantees no offline unit test ever touches the REAL production
// lock files, so a concurrently-running live heartbeat-daemon (which holds the
// real review-runner.lock / test-runner.lock during its 5-min sweeps) can never
// collide with a unit test and cause a spurious "refused" failure. Mirrors the
// same "tests must never touch real production state" principle applied to the
// telegram-listener-daemon real-spawn fix.

import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runTestOnce } from "./test-runner.mjs";
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
const TMP_LOCK = path.join(__dirname, "hardening.regression.lock.tmp");
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
const OWNER_REQUIRED_ID = "lbl-owner-required";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

function makeState() {
  return {
    labels: [
      { id: TEST_REQUIRED_ID, name: "TEST_REQUIRED", color: "#3b82f6" },
      { id: REVIEW_REQUIRED_ID, name: "REVIEW_REQUIRED", color: "#ef4444" },
      { id: NEEDS_REWORK_ID, name: "NEEDS_REWORK", color: "#f97316" },
      { id: DONE_VERIFIED_ID, name: "DONE_VERIFIED", color: "#22c55e" },
      { id: OWNER_REQUIRED_ID, name: "OWNER_REQUIRED", color: "#991b1b" },
    ],
    issues: [],
    commentsByIssue: {},
    runs: [],
    lastCommentHeaders: null,
  };
}

function startMock(state) {
  const server = http.createServer((req, res) => {
    try { handleMock(req, res, state); }
    catch (err) { res.statusCode = 500; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: String(err && err.message) })); }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: server.address().port,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
}
function readBody(req) { return new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); }); }
function sendJson(res, code, obj) { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); }

function handleMock(req, res, state) {
  const u = req.url || "";
  const m = req.method;
  if (u === `/api/companies/${COMPANY_ID}/labels`) {
    if (m === "GET") return sendJson(res, 200, state.labels);
    if (m === "POST") return readBody(req).then((b) => { const o = JSON.parse(b || "{}"); const lbl = { id: randomUUID(), name: o.name, color: o.color }; state.labels.push(lbl); return sendJson(res, 201, lbl); });
  }
  if (u === `/api/companies/${COMPANY_ID}/issues` && m === "GET") return sendJson(res, 200, state.issues);
  const issueMatch = u.match(/^\/api\/issues\/([^/]+)$/);
  if (issueMatch) {
    const id = issueMatch[1];
    if (m === "GET") { const it = state.issues.find((x) => x.id === id); return sendJson(res, it ? 200 : 404, it || { error: "not found" }); }
    if (m === "PATCH") return readBody(req).then((b) => { const o = JSON.parse(b || "{}"); const it = state.issues.find((x) => x.id === id); if (it) Object.assign(it, o); return sendJson(res, 200, it || { error: "not found" }); });
  }
  const commentsMatch = u.match(/^\/api\/issues\/([^/]+)\/comments$/);
  if (commentsMatch) {
    const id = commentsMatch[1];
    if (m === "GET") return sendJson(res, 200, state.commentsByIssue[id] || []);
    if (m === "POST") return readBody(req).then((b) => {
      const o = JSON.parse(b || "{}");
      state.lastCommentHeaders = req.headers;
      const c = { id: randomUUID(), issueId: id, authorAgentId: o.authorType === "agent" ? GIBRAN_AGENT_ID : null, authorType: o.authorType, createdByRunId: req.headers["x-paperclip-run-id"] || null, body: o.body };
      (state.commentsByIssue[id] = state.commentsByIssue[id] || []).push(c);
      return sendJson(res, 201, c);
    });
  }
  const keysMatch = u.match(/^\/api\/agents\/([^/]+)\/keys$/);
  if (keysMatch && m === "POST") return sendJson(res, 201, { id: randomUUID(), name: "x", token: "pcp_fake_token" });
  const wakeMatch = u.match(/^\/api\/agents\/([^/]+)\/wakeup$/);
  if (wakeMatch && m === "POST") { const runId = randomUUID(); state.runs.push({ id: runId, agentId: GIBRAN_AGENT_ID, status: "running", tiedIssueId: null }); return readBody(req).then((b) => { try { const o = JSON.parse(b || "{}"); state.runs[state.runs.length - 1].tiedIssueId = o.payload && o.payload.issueId; } catch { /* */ } return sendJson(res, 202, { id: runId, agentId: GIBRAN_AGENT_ID, status: "queued" }); }); }
  if (u === `/api/companies/${COMPANY_ID}/heartbeat-runs` && m === "GET") return sendJson(res, 200, state.runs);
  const runMatch = u.match(/^\/api\/heartbeat-runs\/([^/]+)$/);
  if (runMatch && m === "GET") { const r = state.runs.find((x) => x.id === runMatch[1]); return sendJson(res, 200, r || { status: "running" }); }
  const runIssuesMatch = u.match(/^\/api\/heartbeat-runs\/([^/]+)\/issues$/);
  if (runIssuesMatch && m === "GET") { const r = state.runs.find((x) => x.id === runIssuesMatch[1]); return sendJson(res, 200, r && r.tiedIssueId ? [{ issueId: r.tiedIssueId }] : []); }
  const cancelMatch = u.match(/^\/api\/heartbeat-runs\/([^/]+)\/cancel$/);
  if (cancelMatch && m === "POST") { const r = state.runs.find((x) => x.id === cancelMatch[1]); if (r) r.status = "cancelled"; return sendJson(res, 200, r || { status: "cancelled" }); }
  res.statusCode = 404; res.end();
}

function makeIssue(opts) {
  return Object.assign({ id: randomUUID(), companyId: COMPANY_ID, identifier: "KOL-X", title: "test", description: "", status: "todo", labels: [], labelIds: [], assigneeAgentId: null }, opts);
}
function makeLogs() { const a = []; const push = a.push.bind(a); a.log = (m) => push(m); return a; }

// =====================================================================
// H1: duplicate-dispatch protection
// =====================================================================

async function testRunnerDuplicateDispatchFailCase() {
  const name = "H1 test-runner: two --once in a row (FAIL kept TEST_REQUIRED) -> no double comment/swap";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({ identifier: "KOL-DUP-T", labels: [{ name: "TEST_REQUIRED" }], labelIds: [TEST_REQUIRED_ID], status: "in_progress" });
  state.issues = [issue];
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    let calls = 0;
    const r1 = await runTestOnce({ base, companyId: COMPANY_ID, runCommand: async () => { calls++; return { code: 1, stdout: "x", stderr: "boom", timedOut: false }; }, log: () => {}, ...LOCK_DEPS });
    assert.equal(r1.results.length, 1, "first run processes 1");
    assert.equal(r1.results[0].outcome, "FAIL");
    const commentsAfter1 = state.commentsByIssue[issue.id] || [];
    assert.equal(commentsAfter1.length, 1, "exactly one comment after first run");
    assert.deepEqual(issue.labelIds, [TEST_REQUIRED_ID], "TEST_REQUIRED retained on FAIL");
    // second --once against the SAME state (TEST_REQUIRED still present, TEST RESULT comment present)
    const r2 = await runTestOnce({ base, companyId: COMPANY_ID, runCommand: async () => { calls++; return { code: 1, stdout: "x", stderr: "boom", timedOut: false }; }, log: () => {}, ...LOCK_DEPS });
    assert.equal(r2.results.length, 0, "second run processes 0 (duplicate-dispatch guard)");
    assert.equal(calls, 1, "test command executed only once total");
    const commentsAfter2 = state.commentsByIssue[issue.id] || [];
    assert.equal(commentsAfter2.length, 1, "no second comment posted");
    assert.deepEqual(issue.labelIds, [TEST_REQUIRED_ID], "no second label swap");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function testRunnerDuplicateDispatchPassCase() {
  const name = "H1 test-runner: PASS swaps label so second --once naturally skips";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({ identifier: "KOL-DUP-P", labels: [{ name: "TEST_REQUIRED" }], labelIds: [TEST_REQUIRED_ID], status: "todo" });
  state.issues = [issue];
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    let calls = 0;
    await runTestOnce({ base, companyId: COMPANY_ID, runCommand: async () => { calls++; return { code: 0, stdout: "", stderr: "", timedOut: false }; }, log: () => {}, ...LOCK_DEPS });
    await runTestOnce({ base, companyId: COMPANY_ID, runCommand: async () => { calls++; return { code: 0, stdout: "", stderr: "", timedOut: false }; }, log: () => {}, ...LOCK_DEPS });
    assert.equal(calls, 1, "test command executed only once (label swapped away after PASS)");
    assert.equal((state.commentsByIssue[issue.id] || []).length, 1, "one comment total");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function reviewRunnerDuplicateDispatch() {
  const name = "H1 review-runner: two --once in a row -> no double dispatch/comment/transition";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({ identifier: "KOL-DUP-R", status: "in_review", labels: [{ name: "REVIEW_REQUIRED" }], labelIds: [REVIEW_REQUIRED_ID] });
  state.issues = [issue];
  const srv = await startMock(state);
  const sf = path.join(__dirname, "_h_dup_r.json");
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    let dispatches = 0;
    const dep = { base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID, resolveToken: async () => "pcp_fake_token", stateFile: sf, log: () => {},
      dispatchReviewer: async () => { dispatches++; return { ok: true, stdout: "ok\nVERDICT: PASS", stderr: "", timedOut: false }; }, ...LOCK_DEPS };
    const r1 = await runReviewOnce(dep);
    assert.equal(r1.results.length, 1);
    assert.equal(r1.results[0].outcome, "done");
    const c1 = (state.commentsByIssue[issue.id] || []).filter((c) => /VERDICT/i.test(c.body));
    assert.equal(c1.length, 1, "one verdict comment after first run");
    assert.equal(issue.status, "done");
    // second --once: no REVIEW_REQUIRED anymore -> skip
    const r2 = await runReviewOnce(dep);
    assert.equal(r2.results.length, 0, "second run processes 0");
    assert.equal(dispatches, 1, "hermes dispatched only once");
    const c2 = (state.commentsByIssue[issue.id] || []).filter((c) => /VERDICT/i.test(c.body));
    assert.equal(c2.length, 1, "no second verdict comment");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(sf); } catch { /* */ } }
}

async function reviewRunnerUnconsumedVerdictSkips() {
  const name = "H1/H4 review-runner: unconsumed agent verdict + status in_review -> skip (no double-dispatch)";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({ identifier: "KOL-UNC", status: "in_review", labels: [{ name: "REVIEW_REQUIRED" }], labelIds: [REVIEW_REQUIRED_ID] });
  state.issues = [issue];
  // pre-existing unconsumed agent verdict (e.g. a transition PATCH that failed)
  state.commentsByIssue[issue.id] = [{ id: randomUUID(), issueId: issue.id, authorAgentId: GIBRAN_AGENT_ID, authorType: "agent", body: "VERDICT: PASS (prior, unconsumed)" }];
  const srv = await startMock(state);
  const sf = path.join(__dirname, "_h_unc.json");
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    let dispatches = 0;
    const r = await runReviewOnce({ base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID, resolveToken: async () => "pcp_fake_token", stateFile: sf, log: () => {},
      dispatchReviewer: async () => { dispatches++; return { ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false }; }, ...LOCK_DEPS });
    assert.equal(dispatches, 0, "must NOT re-dispatch when unconsumed verdict present + in_review");
    assert.equal(r.results.length, 0, "no issues processed");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(sf); } catch { /* */ } }
}

// =====================================================================
// H2: OWNER_REQUIRED blocker
// =====================================================================

async function testRunnerOwnerRequiredSkipped() {
  const name = "H2 test-runner: OWNER_REQUIRED + TEST_REQUIRED -> skipped, logged, no comment/transition";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({ identifier: "KOL-OWN-T", labels: [{ name: "OWNER_REQUIRED" }, { name: "TEST_REQUIRED" }], labelIds: [OWNER_REQUIRED_ID, TEST_REQUIRED_ID], status: "in_progress" });
  state.issues = [issue];
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const lg = makeLogs();
    let ran = false;
    const r = await runTestOnce({ base, companyId: COMPANY_ID, runCommand: async () => { ran = true; return { code: 0, stdout: "", stderr: "", timedOut: false }; }, log: lg.log, ...LOCK_DEPS });
    assert.equal(ran, false, "test command must NOT run on OWNER_REQUIRED issue");
    assert.equal(r.results.length, 0, "no issues processed");
    assert.equal((state.commentsByIssue[issue.id] || []).length, 0, "no comment posted");
    assert.equal(issue.status, "in_progress", "status untouched");
    assert.deepEqual(issue.labelIds, [OWNER_REQUIRED_ID, TEST_REQUIRED_ID], "labels untouched");
    assert.ok(lg.some((m) => /skipped, OWNER_REQUIRED/i.test(m)), "skip must be LOGGED: " + JSON.stringify(lg));
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function reviewRunnerOwnerRequiredSkipped() {
  const name = "H2 review-runner: OWNER_REQUIRED + REVIEW_REQUIRED -> skipped, logged, no dispatch/transition";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({ identifier: "KOL-OWN-R", labels: [{ name: "OWNER_REQUIRED" }, { name: "REVIEW_REQUIRED" }], labelIds: [OWNER_REQUIRED_ID, REVIEW_REQUIRED_ID], status: "in_review" });
  state.issues = [issue];
  const srv = await startMock(state);
  const sf = path.join(__dirname, "_h_own_r.json");
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const lg = makeLogs();
    let dispatches = 0;
    const r = await runReviewOnce({ base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID, resolveToken: async () => "pcp_fake_token", stateFile: sf, log: lg.log,
      dispatchReviewer: async () => { dispatches++; return { ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false }; }, ...LOCK_DEPS });
    assert.equal(dispatches, 0, "hermes must NOT be dispatched on OWNER_REQUIRED issue");
    assert.equal(r.results.length, 0, "no issues processed");
    assert.equal((state.commentsByIssue[issue.id] || []).length, 0, "no comment posted");
    assert.equal(issue.status, "in_review", "status untouched");
    assert.deepEqual(issue.labelIds, [OWNER_REQUIRED_ID, REVIEW_REQUIRED_ID], "labels untouched");
    assert.ok(lg.some((m) => /skipped, OWNER_REQUIRED/i.test(m)), "skip must be LOGGED: " + JSON.stringify(lg));
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(sf); } catch { /* */ } }
}

// =====================================================================
// H3: worker/provider failure must not kill the runner
// =====================================================================

async function testRunnerThrowDoesNotKillSweep() {
  const name = "H3 test-runner: a throwing test command for one issue is caught; sweep continues to next";
  await clearTempLock();
  const state = makeState();
  const a = makeIssue({ identifier: "KOL-THROW-A", labels: [{ name: "TEST_REQUIRED" }], labelIds: [TEST_REQUIRED_ID], status: "todo" });
  const b = makeIssue({ identifier: "KOL-THROW-B", labels: [{ name: "TEST_REQUIRED" }], labelIds: [TEST_REQUIRED_ID], status: "todo" });
  state.issues = [a, b];
  const srv = await startMock(state);
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const lg = makeLogs();
    let calls = 0;
    const r = await runTestOnce({
      base, companyId: COMPANY_ID, log: lg.log,
      runCommand: async () => {
        calls++;
        if (calls === 1) throw new Error("simulated missing test binary / crash");
        return { code: 0, stdout: "ok", stderr: "", timedOut: false };
      },
      ...LOCK_DEPS,
    });
    // First issue errored, second processed.
    const errIssue = r.results.find((x) => x.id === a.id);
    const okIssue = r.results.find((x) => x.id === b.id);
    assert.ok(errIssue && errIssue.outcome === "error", "first issue recorded as error, not crash: " + JSON.stringify(r.results.map((x) => x.outcome)));
    assert.ok(okIssue && okIssue.outcome === "PASS", "second issue still processed (sweep continued)");
    assert.ok(lg.some((m) => /UNEXPECTED ERROR/i.test(m)), "error logged: " + JSON.stringify(lg.slice(-4)));
    // an error comment was posted for the first issue
    const ca = state.commentsByIssue[a.id] || [];
    assert.ok(ca.some((c) => /TEST RESULT.*ERROR/i.test(c.body)), "error comment posted for throwing issue");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); }
}

async function reviewRunnerThrowDoesNotKillSweep() {
  const name = "H3 review-runner: a throwing hermes dispatch for one issue is caught; sweep continues to next";
  await clearTempLock();
  const state = makeState();
  const a = makeIssue({ identifier: "KOL-THROW-RA", status: "in_review", labels: [{ name: "REVIEW_REQUIRED" }], labelIds: [REVIEW_REQUIRED_ID] });
  const b = makeIssue({ identifier: "KOL-THROW-RB", status: "in_review", labels: [{ name: "REVIEW_REQUIRED" }], labelIds: [REVIEW_REQUIRED_ID] });
  state.issues = [a, b];
  const srv = await startMock(state);
  const sf = path.join(__dirname, "_h_throw_r.json");
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const lg = makeLogs();
    let calls = 0;
    const r = await runReviewOnce({
      base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID, resolveToken: async () => "pcp_fake_token", stateFile: sf, log: lg.log,
      dispatchReviewer: async () => { calls++; if (calls === 1) throw new Error("simulated hermes spawn crash"); return { ok: true, stdout: "ok\nVERDICT: PASS", stderr: "", timedOut: false }; },
      ...LOCK_DEPS,
    });
    const errIssue = r.results.find((x) => x.id === a.id);
    const okIssue = r.results.find((x) => x.id === b.id);
    assert.ok(errIssue && errIssue.outcome === "error", "first issue recorded as error, not crash: " + JSON.stringify(r.results.map((x) => x.outcome)));
    assert.ok(okIssue && okIssue.outcome === "done", "second issue still processed (sweep continued)");
    assert.ok(lg.some((m) => /UNEXPECTED ERROR/i.test(m)), "error logged");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(sf); } catch { /* */ } }
}

// =====================================================================
// H4: retry/rework reset
// =====================================================================

async function reviewRunnerResetOnFreshReapplication() {
  const name = "H4 review-runner: after REJECT, re-applying REVIEW_REQUIRED (status!=in_review) resets attempts + fresh dispatch; old verdict treated stale";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({ identifier: "KOL-RESET", status: "in_review", labels: [{ name: "REVIEW_REQUIRED" }], labelIds: [REVIEW_REQUIRED_ID] });
  state.issues = [issue];
  const srv = await startMock(state);
  const sf = path.join(__dirname, "_h_reset.json");
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const lg = makeLogs();
    let dispatches = 0;
    const dep = (verdict) => ({
      base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID, resolveToken: async () => "pcp_fake_token", stateFile: sf, log: lg.log,
      dispatchReviewer: async () => { dispatches++; return { ok: true, stdout: `reasoning\nVERDICT: ${verdict}`, stderr: "", timedOut: false }; },
      ...LOCK_DEPS,
    });

    // Cycle 1: REJECT -> needs-rework, status=todo, REVIEW_REQUIRED removed, agent verdict posted.
    const r1 = await runReviewOnce(dep("REJECT"));
    assert.equal(r1.results[0].outcome, "needs-rework");
    assert.equal(issue.status, "todo");
    assert.ok(issue.labelIds.includes(NEEDS_REWORK_ID), "NEEDS_REWORK added");
    assert.ok(!issue.labelIds.includes(REVIEW_REQUIRED_ID), "REVIEW_REQUIRED removed");
    const verdicts1 = (state.commentsByIssue[issue.id] || []).filter((c) => c.authorAgentId === GIBRAN_AGENT_ID && /VERDICT/i.test(c.body));
    assert.equal(verdicts1.length, 1, "one agent verdict after cycle 1");
    assert.equal(dispatches, 1, "dispatched once in cycle 1");
    const oldVerdictId = verdicts1[0].id;

    // Simulate a human/HATTA re-applying REVIEW_REQUIRED (fresh label application)
    // after the consumed REJECT. Status stays todo (NOT in_review) -> reset signal.
    // Also pre-seed a LEFTOVER attempt counter (as if there had been deferred
    // dispatch failures earlier in this issue's life) so we can prove the reset
    // path actually clears the counter and logs the reset.
    issue.labelIds = [REVIEW_REQUIRED_ID];
    issue.labels = [{ name: "REVIEW_REQUIRED" }];
    const seeded = { attempts: {} };
    seeded.attempts[issue.id] = 5;
    await fs.writeFile(sf, JSON.stringify(seeded), "utf8");

    // Cycle 2: PASS -> fresh dispatch, old REJECT treated as stale, new PASS verdict.
    const r2 = await runReviewOnce(dep("PASS"));
    assert.equal(dispatches, 2, "fresh dispatch chance given after reset");
    assert.equal(r2.results[0].outcome, "done", "new verdict acted on (done)");
    assert.equal(issue.status, "done");
    assert.ok(issue.labelIds.includes(DONE_VERIFIED_ID), "DONE_VERIFIED added");
    assert.ok(!issue.labelIds.includes(REVIEW_REQUIRED_ID), "REVIEW_REQUIRED removed");
    const verdicts2 = (state.commentsByIssue[issue.id] || []).filter((c) => c.authorAgentId === GIBRAN_AGENT_ID && /VERDICT/i.test(c.body));
    assert.equal(verdicts2.length, 2, "two agent verdicts total (old REJECT + new PASS)");
    // The NEW verdict is the PASS one (not the old REJECT being re-used).
    const passVerdict = verdicts2.find((c) => /VERDICT:\s*PASS/i.test(c.body));
    const rejectVerdict = verdicts2.find((c) => /VERDICT:\s*REJECT/i.test(c.body));
    assert.ok(passVerdict && passVerdict.id !== oldVerdictId, "a NEW PASS verdict was posted (not the stale REJECT re-used)");
    assert.ok(rejectVerdict && rejectVerdict.id === oldVerdictId, "old REJECT verdict still present (not deleted)");
    assert.ok(lg.some((m) => /reset attempt counter/i.test(m)), "attempt-counter reset logged: " + JSON.stringify(lg));
    assert.ok(lg.some((m) => /prior verdict consumed/i.test(m)), "reset detection logged: " + JSON.stringify(lg));
    // counter was cleared in the persisted state
    const finalState = JSON.parse(await fs.readFile(sf, "utf8"));
    assert.ok(!finalState.attempts[issue.id], "attempt counter cleared after reset: " + JSON.stringify(finalState.attempts));
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(sf); } catch { /* */ } }
}

async function reviewRunnerDeferredRetryDoesNotReset() {
  const name = "H4 review-runner: deferred (timeout, no verdict) re-sweeps do NOT reset attempts -> cap still bounds the SAME unresolved issue";
  await clearTempLock();
  const state = makeState();
  const issue = makeIssue({ id: "defer-issue", identifier: "KOL-DEFER", status: "in_review", labels: [{ name: "REVIEW_REQUIRED" }], labelIds: [REVIEW_REQUIRED_ID] });
  state.issues = [issue];
  const srv = await startMock(state);
  const sf = path.join(__dirname, "_h_defer.json");
  try {
    const base = `http://127.0.0.1:${srv.port}`;
    const dep = { base, companyId: COMPANY_ID, gibranAgentId: GIBRAN_AGENT_ID, resolveToken: async () => "pcp_fake_token", stateFile: sf, log: () => {},
      dispatchReviewer: async () => ({ ok: false, stdout: "", stderr: "err", timedOut: true }), ...LOCK_DEPS };
    // Run once: deferred (attempt 1). Issue stays REVIEW_REQUIRED + in_review, no verdict.
    await runReviewOnce(dep);
    assert.ok(issue.labelIds.includes(REVIEW_REQUIRED_ID), "REVIEW_REQUIRED retained on defer");
    // Pre-seed attempts at cap-1 so one more defer hits the cap (proving counter
    // persisted across sweeps, i.e. NOT reset on automatic re-sweep of same state).
    const st = JSON.parse(await fs.readFile(sf, "utf8"));
    st.attempts["defer-issue"] = 2;
    await fs.writeFile(sf, JSON.stringify(st), "utf8");
    const r2 = await runReviewOnce(dep);
    assert.equal(r2.results[0].outcome, "needs-rework", "cap reached on SAME unresolved issue -> NEEDS_REWORK");
    assert.ok(!issue.labelIds.includes(REVIEW_REQUIRED_ID), "REVIEW_REQUIRED removed at cap");
    ok(name);
  } catch (err) { bad(name, err); } finally { await srv.close(); try { await fs.unlink(sf); } catch { /* */ } }
}

async function main() {
  console.log("# ops-watcher PHASE-3 hardening regression tests");
  await testRunnerDuplicateDispatchFailCase();
  await testRunnerDuplicateDispatchPassCase();
  await reviewRunnerDuplicateDispatch();
  await reviewRunnerUnconsumedVerdictSkips();
  await testRunnerOwnerRequiredSkipped();
  await reviewRunnerOwnerRequiredSkipped();
  await testRunnerThrowDoesNotKillSweep();
  await reviewRunnerThrowDoesNotKillSweep();
  await reviewRunnerResetOnFreshReapplication();
  await reviewRunnerDeferredRetryDoesNotReset();
  await clearTempLock();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("hardening regression runner crashed:", err); process.exit(1); });