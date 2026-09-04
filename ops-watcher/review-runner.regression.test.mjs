// ops-watcher/review-runner.regression.test.mjs
// Offline regression tests for ops-watcher/review-runner.mjs. Pattern matches
// watcher.regression.test.mjs: node:assert, a local node:http mock Paperclip
// server, a FAKE dispatchGibran (no real hermes call), no live Paperclip.
//
//   node ops-watcher/review-runner.regression.test.mjs
//
// Covers: happy PASS (status=done, REVIEW_REQUIRED->DONE_VERIFIED), REJECT
// (NEEDS_REWORK, status=todo, not done), already-verdicted skip (bounded),
// hermes timeout/failure does NOT crash the script (posts REVIEW DISPATCH FAILED,
// leaves REVIEW_REQUIRED; after MAX attempts skips), Paperclip network error no
// crash, parse_failed handling.
//
// T7 (KOL-37/KOL-38 regression): concurrent sweeps must not double-dispatch GIBRAN
// — mirrors the exact T7 test shape from ahmad-dispatch.regression.test.mjs.
//
// === TEST ISOLATION (lock file) ===
// EVERY sweep test (a)-(h) injects lockFile: TMP_LOCK (a per-test temp lock path
// DISTINCT from the real production ops-watcher/review-runner.lock), plus the
// same acquireLock/releaseLock/_fs the T7 test uses. This guarantees no offline
// unit test ever touches the REAL production lock file, so a concurrently-running
// live heartbeat-daemon (which holds the real lock during its 5-min sweeps) can
// never collide with a unit test and cause a spurious "refused" failure. The
// pure helper test (i) makes no sweep call and needs no lock. Mirrors the same
// "tests must never touch real production state" principle applied to the
// telegram-listener-daemon real-spawn fix.

import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReviewSweep, runReviewOnce, parseVerdict, verdictCategory, isUnusableReviewerReply, isReviewerQuotaFailure } from "./review-runner.mjs";
import {
  acquireLock,
  releaseLock,
  isPidAliveReal,
} from "./telegram-listener-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_LOCK = path.join(__dirname, "review-runner.regression.lock.tmp");
// The workspace review-runner.mjs actually hands to hermes, derived the same way
// the module derives it (both files live in <repo>/ops-watcher/). Used by case (r)
// to build a path that is genuinely INSIDE the workspace on whatever machine the
// suite runs on.
const TEST_WORKSPACE_ROOT = path.resolve(__dirname, "..");
const TMP_STATE = path.join(__dirname, "review-runner.regression.state.tmp");

// Shared lock-deps injection: every sweep test uses the per-test TMP_LOCK (NOT
// the real production ops-watcher/review-runner.lock) so a live heartbeat-daemon
// sweep can never collide with a unit test. Mirrors the T7 pattern exactly.
const LOCK_DEPS = {
  lockFile: TMP_LOCK,
  acquireLock,
  releaseLock,
  _fs: fs,
  probeLane: async () => ({ available: true, lane: "nous", reason: "test-available" }),
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
      { id: "lbl-review", name: "REVIEW_REQUIRED", color: "#ef4444" },
      { id: "lbl-done", name: "DONE_VERIFIED", color: "#22c55e" },
      { id: "lbl-rework", name: "NEEDS_REWORK", color: "#f59e0b" },
    ],
    issues: [
      { id: "iss-1", identifier: "KOL-100", title: "SELFTEST issue", description: "a change", status: "in_review", labels: [{ id: "lbl-review", name: "REVIEW_REQUIRED" }], labelIds: ["lbl-review"] },
    ],
    comments: { "iss-1": [] },
  };
}

const log = () => {};

async function testHappyPass() {
  const name = "(a) happy PASS: VERDICT comment attributed to GIBRAN via agent_link, status=done, REVIEW_REQUIRED->DONE_VERIFIED";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "Looks good.\nVERDICT: PASS", stderr: "", timedOut: false, error: null });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.passed, 1);
    const c = state.comments["iss-1"].find((x) => /VERDICT\s*:\s*PASS/i.test(x.body));
    assert.ok(c, "VERDICT PASS comment posted");
    assert.equal(c.authorType, "user", "honest board relay authorType");
    assert.equal(c.authorAgentId, null, "authorAgentId NOT forged");
    assert.ok(c.metadata && c.metadata.sections && c.metadata.sections[0].rows.some((r) => r.type === "agent_link" && r.agentId), "metadata agent_link to GIBRAN present");
    const it = state.issues[0];
    assert.equal(it.status, "done");
    assert.deepEqual(it.labelIds, ["lbl-done"], "REVIEW_REQUIRED removed, DONE_VERIFIED added");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testPassWithNotes() {
  const name = "(b) PASS WITH NOTES treated as pass -> done";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "Minor nits.\nVERDICT: PASS WITH NOTES", stderr: "", timedOut: false, error: null });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.passed, 1);
    assert.equal(state.issues[0].status, "done");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-done"]);
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testRejectGoesToNeedsRework() {
  const name = "(c) REJECT: NEEDS_REWORK added, status=todo, REVIEW_REQUIRED removed, NOT done";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "Nope.\nVERDICT: REJECT", stderr: "", timedOut: false, error: null });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.rejected, 1);
    assert.equal(sum.passed, 0);
    const c = state.comments["iss-1"].find((x) => /VERDICT\s*:\s*REJECT/i.test(x.body));
    assert.ok(c, "REJECT verdict comment posted (not silently dropped)");
    const it = state.issues[0];
    assert.equal(it.status, "todo");
    assert.deepEqual(it.labelIds, ["lbl-rework"], "REVIEW_REQUIRED removed, NEEDS_REWORK added");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testHermesTimeoutNoCrash() {
  const name = "(d) hermes timeout/failure does not crash: posts REVIEW DISPATCH FAILED, leaves REVIEW_REQUIRED";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: false, stdout: "", stderr: "slow", timedOut: true, error: "timeout" });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.dispatchFailed, 1);
    const c = state.comments["iss-1"].find((x) => /REVIEW DISPATCH FAILED/i.test(x.body));
    assert.ok(c, "REVIEW DISPATCH FAILED comment posted (visible, not silent)");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-review"], "REVIEW_REQUIRED left in place for retry");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testHermesFailureBoundedSkipsAfterMaxAttempts() {
  const name = "(e) after MAX attempts of REVIEW DISPATCH FAILED, issue is skipped (no infinite loop)";
  await clearTempLock();
  const state = baseState();
  // pre-seed MAX failed comments
  const MAX = 3;
  state.comments["iss-1"] = Array.from({ length: MAX }, (_, i) => ({ id: `f${i}`, body: `REVIEW DISPATCH FAILED (attempt ${i + 1}/${MAX})`, authorType: "user" }));
  let dispatchCalled = 0;
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => { dispatchCalled++; return { ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false, error: null }; };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.skipped, 1);
    assert.equal(dispatchCalled, 0, "must NOT dispatch again after MAX failed attempts (bounded)");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testAlreadyVerdictedSkipped() {
  const name = "(f) already-verdicted issue is skipped (bounded, no re-dispatch)";
  await clearTempLock();
  const state = baseState();
  state.comments["iss-1"] = [{ id: "c0", body: "VERDICT: PASS\n...", authorType: "user" }];
  let dispatchCalled = 0;
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => { dispatchCalled++; return { ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false, error: null }; };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.skipped, 1);
    assert.equal(dispatchCalled, 0, "must not re-dispatch a verdicted issue");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testParseFailedHandling() {
  const name = "(g) GIBRAN replies without a VERDICT line -> PARSE_FAILED -> NEEDS_REWORK (not silent, not done)";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "I reviewed it. Looks fine I guess.", stderr: "", timedOut: false, error: null });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.parseFailed, 1);
    const c = state.comments["iss-1"].find((x) => /VERDICT:\s*PARSE_FAILED/i.test(x.body));
    assert.ok(c, "PARSE_FAILED comment posted");
    const it = state.issues[0];
    assert.equal(it.status, "todo");
    assert.deepEqual(it.labelIds, ["lbl-rework"], "routed to NEEDS_REWORK, not done");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testNetworkErrorNoCrash() {
  const name = "(h) Paperclip network error does not crash the script";
  await clearTempLock();
  try {
    const base = "http://127.0.0.1:59992"; // closed port
    const fakeDispatch = async () => ({ ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false, error: null });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.passed, 0);
    assert.ok(sum.errors.length >= 1, "errors recorded, no throw");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testParseVerdictPure() {
  const name = "(i) parseVerdict/verdictCategory pure helpers";
  try {
    assert.equal(parseVerdict("VERDICT: PASS WITH NOTES\nx"), "PASS WITH NOTES");
    assert.equal(parseVerdict("VERDICT: PASS"), "PASS");
    assert.equal(parseVerdict("VERDICT: REJECT"), "REJECT");
    assert.equal(parseVerdict("VERDICT: WORKSPACE-ERROR"), "WORKSPACE-ERROR");
    assert.equal(parseVerdict("no line"), null);
    assert.equal(verdictCategory("PASS"), "pass");
    assert.equal(verdictCategory("REJECT"), "reject");
    assert.equal(verdictCategory("WORKSPACE-ERROR"), "workspace-error");
    assert.equal(verdictCategory(null), null);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testUnusableReviewerReplyPure() {
  const name = "(i2) isUnusableReviewerReply truth table";
  try {
    assert.deepEqual(isUnusableReviewerReply(""), { unusable: true, reason: "empty reviewer output" });
    assert.deepEqual(isUnusableReviewerReply("   "), { unusable: true, reason: "empty reviewer output" });
    assert.deepEqual(isUnusableReviewerReply("Response truncated due to output length limit"), { unusable: true, reason: "reviewer output truncated" });
    assert.deepEqual(isUnusableReviewerReply("ok"), { unusable: true, reason: "reviewer output too short to be a verdict" });
    assert.deepEqual(isUnusableReviewerReply("VERDICT: PASS\n- looks good"), { unusable: false });
    assert.deepEqual(isUnusableReviewerReply("I reviewed the implementation carefully and found no explicit verdict marker in this longer prose reply."), { unusable: false });
    assert.equal(isReviewerQuotaFailure({ stdout: "", stderr: "provider.auth_error: usage limit" }), true);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testRunOnceEmptyReviewerOutputDeferred() {
  const name = "(i3) runReviewOnce: empty reviewer output is lane failure defer, not PARSE_FAILED/NEEDS_REWORK";
  await clearTempLock();
  await fs.unlink(TMP_STATE).catch(() => {});
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "", stderr: "", timedOut: false, error: null });
    const r = await runReviewOnce({ base, companyId: "C", dispatchReviewer: fakeDispatch, resolveToken: async () => null, stateFile: TMP_STATE, log, ...LOCK_DEPS });
    assert.equal(r.results[0].outcome, "deferred");
    assert.equal(r.results[0].reason, "empty reviewer output");
    const saved = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
    assert.equal(saved.attempts["iss-1"], 1, "attempt counter increments once");
    const bodies = state.comments["iss-1"].map((x) => x.body).join("\n---\n");
    assert.match(bodies, /REVIEW DISPATCH FAILED/i, "lane failure comment posted");
    assert.match(bodies, /empty reviewer output/i, "comment includes helper reason");
    assert.doesNotMatch(bodies, /PARSE_FAILED/i, "must not post PARSE_FAILED for unusable lane output");
    assert.equal(state.issues[0].status, "in_review");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-review"], "REVIEW_REQUIRED remains, no NEEDS_REWORK patch");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); await fs.unlink(TMP_STATE).catch(() => {}); }
}

async function testRunOnceEmptyReviewerOutputEscalatesAtCap() {
  const name = "(i4) runReviewOnce: repeated empty reviewer output escalates only at MAX_HERMES_ATTEMPTS";
  await clearTempLock();
  await fs.unlink(TMP_STATE).catch(() => {});
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "", stderr: "", timedOut: false, error: null });
    const dep = { base, companyId: "C", dispatchReviewer: fakeDispatch, resolveToken: async () => null, stateFile: TMP_STATE, log, ...LOCK_DEPS };
    const r1 = await runReviewOnce(dep);
    assert.equal(r1.results[0].outcome, "deferred");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-review"], "first unusable reply does not rework");
    const r2 = await runReviewOnce(dep);
    assert.equal(r2.results[0].outcome, "deferred");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-review"], "second unusable reply still does not rework");
    const r3 = await runReviewOnce(dep);
    assert.equal(r3.results[0].outcome, "needs-rework", "third unusable reply reaches cap");
    assert.equal(state.issues[0].status, "todo");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-rework"], "REVIEW_REQUIRED swapped for NEEDS_REWORK at cap");
    const bodies = state.comments["iss-1"].map((x) => x.body).join("\n---\n");
    assert.equal((bodies.match(/REVIEW DISPATCH FAILED/gi) || []).length, 3, "three lane-failure comments posted");
    assert.doesNotMatch(bodies, /PARSE_FAILED/i, "empty output never becomes PARSE_FAILED");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); await fs.unlink(TMP_STATE).catch(() => {}); }
}

async function testRunOnceQuotaFailureHeldNoAttemptBurn() {
  const name = "(i5) runReviewOnce: reviewer quota failure is held without burning attempts";
  await clearTempLock();
  await fs.unlink(TMP_STATE).catch(() => {});
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: false, stdout: "", stderr: "provider.auth_error: 403 You've reached your weekly (7-day) usage limit.", timedOut: false, error: "auth_error" });
    const r = await runReviewOnce({ base, companyId: "C", dispatchReviewer: fakeDispatch, resolveToken: async () => null, stateFile: TMP_STATE, log, ...LOCK_DEPS });
    assert.equal(r.results[0].outcome, "deferred");
    assert.equal(r.results[0].reason, "quota");
    const saved = JSON.parse(await fs.readFile(TMP_STATE, "utf8"));
    assert.equal(saved.attempts["iss-1"] || 0, 0, "quota does not increment attempts");
    assert.equal(state.issues[0].status, "in_review");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-review"], "no NEEDS_REWORK on quota outage");
    const body = state.comments["iss-1"][0].body;
    assert.match(body, /executor lane quota is exhausted/i);
    assert.match(body, /review is being held/i);
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); await fs.unlink(TMP_STATE).catch(() => {}); }
}

async function testRunOnceParseFailedStillNeedsRework() {
  const name = "(i6) runReviewOnce: non-empty no-VERDICT reply remains PARSE_FAILED -> NEEDS_REWORK";
  await clearTempLock();
  await fs.unlink(TMP_STATE).catch(() => {});
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "I reviewed it. Looks fine I guess.", stderr: "", timedOut: false, error: null });
    const r = await runReviewOnce({ base, companyId: "C", dispatchReviewer: fakeDispatch, resolveToken: async () => null, stateFile: TMP_STATE, log, ...LOCK_DEPS });
    assert.equal(r.results[0].outcome, "needs-rework");
    assert.equal(r.results[0].reason, "parse-failed");
    const c = state.comments["iss-1"].find((x) => /VERDICT:\s*PARSE_FAILED/i.test(x.body));
    assert.ok(c, "PARSE_FAILED comment posted for usable but unparsable reply");
    assert.equal(state.issues[0].status, "todo");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-rework"]);
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); await fs.unlink(TMP_STATE).catch(() => {}); }
}

async function testRunOncePassStillDone() {
  const name = "(i7) runReviewOnce: VERDICT PASS remains done + DONE_VERIFIED";
  await clearTempLock();
  await fs.unlink(TMP_STATE).catch(() => {});
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false, error: null });
    const r = await runReviewOnce({ base, companyId: "C", dispatchReviewer: fakeDispatch, resolveToken: async () => null, stateFile: TMP_STATE, log, ...LOCK_DEPS });
    assert.equal(r.results[0].outcome, "done");
    assert.equal(r.results[0].kind, "pass");
    assert.equal(state.issues[0].status, "done");
    assert.deepEqual(state.issues[0].labelIds, ["lbl-done"]);
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); await fs.unlink(TMP_STATE).catch(() => {}); }
}

// =====================================================================
// KOL-47 regression: WORKSPACE-ERROR self-report must not be trusted as a verdict
// =====================================================================
async function testWorkspaceErrorSelfReported() {
  const name = "(k) WORKSPACE-ERROR self-report: classified as dispatch-failed, no status/label change, anomaly comment posted";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  let dispatchCalled = 0;
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => {
      dispatchCalled++;
      return { ok: true, stdout: "I cannot find ops-watcher/review-runner.mjs; I see D:\\FounderOS-Aidit De Maestros\\app\nVERDICT: WORKSPACE-ERROR", stderr: "", timedOut: false, error: null };
    };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(dispatchCalled, 1, "GIBRAN must be dispatched exactly once");
    assert.equal(sum.dispatchFailed, 1, "WORKSPACE-ERROR counts as a dispatch failure");
    assert.equal(sum.passed + sum.rejected + sum.parseFailed, 0, "must not be treated as a real verdict");
    const it = state.issues[0];
    assert.equal(it.status, "in_review", "issue status must NOT change on a single workspace-error");
    assert.deepEqual(it.labelIds, ["lbl-review"], "REVIEW_REQUIRED must remain in place");
    const c = state.comments["iss-1"].find((x) => /WORKSPACE-ERROR/i.test(x.body));
    assert.ok(c, "anomaly comment posted");
    assert.ok(/D:\\FounderOS-Aidit De Maestros\\app/i.test(c.body), "comment must report what GIBRAN said it saw");
    assert.equal(c.authorType, "user", "honest board relay authorType");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testWorkspaceErrorBoundedRetry() {
  const name = "(l) WORKSPACE-ERROR counts toward MAX_HERMES_ATTEMPTS and stops dispatching at the cap";
  await clearTempLock();
  const state = baseState();
  // Pre-seed the maximum number of anomaly comments so the next sweep must skip.
  const MAX = 3;
  state.comments["iss-1"] = Array.from({ length: MAX }, (_, i) => ({
    id: `w${i}`,
    body: `WORKSPACE-ERROR (ops-watcher/review-runner sweep): attempt ${i + 1}`,
    authorType: "user",
  }));
  let dispatchCalled = 0;
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => { dispatchCalled++; return { ok: true, stdout: "VERDICT: WORKSPACE-ERROR", stderr: "", timedOut: false, error: null }; };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.skipped, 1, "issue is skipped once the anomaly attempt cap is reached");
    assert.equal(dispatchCalled, 0, "must NOT dispatch again after MAX workspace-error attempts");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testWorkspaceErrorCapMovesToNeedsRework() {
  const name = "(m) WORKSPACE-ERROR at the cap transitions the issue to NEEDS_REWORK";
  await clearTempLock();
  const state = baseState();
  // One prior anomaly comment -> the next workspace-error will be attempt 3 (the cap).
  state.comments["iss-1"] = [
    { id: "w1", body: "WORKSPACE-ERROR (ops-watcher/review-runner sweep): attempt 1", authorType: "user" },
    { id: "w2", body: "WORKSPACE-ERROR (ops-watcher/review-runner sweep): attempt 2", authorType: "user" },
  ];
  const s = await startServer(mockServer(state).handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => ({ ok: true, stdout: "VERDICT: WORKSPACE-ERROR\nI see the wrong directory.", stderr: "", timedOut: false, error: null });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(sum.dispatchFailed, 1, "the cap-reaching attempt is counted as dispatch-failed");
    const it = state.issues[0];
    assert.equal(it.status, "todo", "issue moved to todo at the cap");
    assert.deepEqual(it.labelIds, ["lbl-rework"], "REVIEW_REQUIRED swapped for NEEDS_REWORK at the cap");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testOutOfWorkspacePathHeuristic() {
  const name = "(n) layer-3 heuristic: PASS verdict stdout citing a wrong workspace path is treated as workspace-error";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  let dispatchCalled = 0;
  try {
    const base = `http://127.0.0.1:${s.port}`;
    // GIBRAN issues a PASS but its reasoning reveals it was looking at the legacy
    // wrong-workspace path — exactly the KOL-47 incident shape.
    const fakeDispatch = async () => {
      dispatchCalled++;
      return {
        ok: true,
        stdout: "I reviewed the codebase at D:\\FounderOS-Aidit De Maestros\\app\\src\\foo.js and it looks good.\nVERDICT: PASS",
        stderr: "",
        timedOut: false,
        error: null,
      };
    };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(dispatchCalled, 1, "GIBRAN must be dispatched exactly once");
    assert.equal(sum.dispatchFailed, 1, "out-of-workspace PASS must be downgraded to dispatch-failed");
    assert.equal(sum.passed, 0, "must NOT trust the PASS verdict");
    const it = state.issues[0];
    assert.equal(it.status, "in_review", "issue status must NOT change");
    assert.deepEqual(it.labelIds, ["lbl-review"], "REVIEW_REQUIRED must remain in place");
    const c = state.comments["iss-1"].find((x) => /WORKSPACE-ERROR/i.test(x.body));
    assert.ok(c, "anomaly comment posted");
    assert.ok(/FounderOS-Aidit De Maestros/i.test(c.body), "comment must include the path GIBRAN cited");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

// =====================================================================
// FOS-19 regression: runReviewSweep must probe the nous lane before dispatching
// =====================================================================
async function testNousLaneAvailabilityRefusesOrRuns() {
  const name = "(j) FOS-19: nous lane unavailable -> refused, no dispatch/writes; available -> normal PASS";
  await clearTempLock();

  // (a) Unavailable lane: sweep must refuse before any Paperclip read/write.
  const stateUnavailable = baseState();
  const sUnavailable = await startServer(mockServer(stateUnavailable).handler);
  let dispatchCalledUnavailable = 0;
  try {
    const base = `http://127.0.0.1:${sUnavailable.port}`;
    const fakeDispatch = async () => { dispatchCalledUnavailable++; return { ok: true, stdout: "VERDICT: PASS", stderr: "", timedOut: false, error: null }; };
    const unavailableProbe = async () => ({ available: false, lane: "nous", reason: "test-unavailable" });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS, probeLane: unavailableProbe });
    assert.equal(sum.refused, true, "sweep is refused when nous lane is unavailable");
    assert.equal(sum.reason, "nous-lane-unavailable", "refusal reason is nous-lane-unavailable");
    assert.equal(dispatchCalledUnavailable, 0, "must NOT dispatch GIBRAN when lane is unavailable");
    assert.equal(stateUnavailable.comments["iss-1"].length, 0, "must NOT post any comment when lane is unavailable");
    assert.equal(stateUnavailable.issues[0].status, "in_review", "issue status must not change");
    assert.deepEqual(stateUnavailable.issues[0].labelIds, ["lbl-review"], "issue labels must not change");
    assert.deepEqual(sum.errors, [], "no errors recorded for a clean refusal");
    assert.equal(sum.passed + sum.rejected + sum.dispatchFailed + sum.skipped + sum.parseFailed, 0, "all counters stay zero");
  } catch (e) { bad(name, e); return; } finally { await sUnavailable.close(); }

  // (b) Available lane: sweep behavior is unchanged (happy PASS path).
  await clearTempLock();
  const stateAvailable = baseState();
  const sAvailable = await startServer(mockServer(stateAvailable).handler);
  let dispatchCalledAvailable = 0;
  try {
    const base = `http://127.0.0.1:${sAvailable.port}`;
    const fakeDispatch = async () => { dispatchCalledAvailable++; return { ok: true, stdout: "Looks good.\nVERDICT: PASS", stderr: "", timedOut: false, error: null }; };
    const availableProbe = async () => ({ available: true, lane: "nous", reason: "test-available" });
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS, probeLane: availableProbe });
    assert.equal(sum.passed, 1, "normal pass when lane is available");
    assert.equal(sum.refused, undefined, "not refused when lane is available");
    assert.equal(dispatchCalledAvailable, 1, "exactly one dispatch when lane is available");
    assert.equal(stateAvailable.issues[0].status, "done", "issue transitioned to done");
    assert.deepEqual(stateAvailable.issues[0].labelIds, ["lbl-done"], "REVIEW_REQUIRED swapped for DONE_VERIFIED");
    const c = stateAvailable.comments["iss-1"].find((x) => /VERDICT\s*:\s*PASS/i.test(x.body));
    assert.ok(c, "VERDICT PASS comment posted");
    ok(name);
  } catch (e) { bad(name, e); } finally { await sAvailable.close(); }
}

// =====================================================================
// T7 (KOL-37/KOL-38 regression): concurrent sweeps must not double-dispatch
// =====================================================================
// Reproduces the TOCTOU race that caused 8 duplicate GIBRAN VERDICT comments on
// KOL-37 and 11 on KOL-38: two runReviewOnce() calls against the SAME injected
// issue, with a comments GET that deliberately WIDENS the race window (small
// async delay) so that WITHOUT the single-instance lock both calls would read
// "no verdict yet" before either dispatch lands, and both would dispatch a
// fresh GIBRAN hermes call + post a duplicate VERDICT comment. WITH the lock,
// the second call is refused before any Paperclip read/write — only one
// dispatch happens and only one verdict is posted.
//
// Uses runReviewOnce directly (not runReviewSweep) to inject lock deps against
// a per-test temp lock file, exactly mirroring the T7 test shape from
// ahmad-dispatch.regression.test.mjs.
async function t7_concurrentSweepsDoNotDoubleDispatch() {
  await fs.unlink(TMP_LOCK).catch(() => {});
  await fs.unlink(TMP_STATE).catch(() => {});

  // Shared mutable "Paperclip" state, read+written by both sweeps.
  const comments = [];               // live comment list (verdict appended on POST)
  let dispatchCount = 0;             // count of dispatchReviewer invocations
  let commentPosts = 0;              // count of POST comments
  let patchCalls = 0;                 // count of PATCH issue calls
  let getCommentsCalls = 0;           // how many times comments were GETted
  let getIssuesCalls = 0;             // how many times the issues list was GETted

  // Gate: fires the moment sweep A has provably passed the lock and entered its
  // sweep (its issues-list GET is the first Paperclip read, and it only happens
  // after acquireLock resolved with acquired:true).
  let signalAInSweep;
  const aInSweep = new Promise((res) => { signalAInSweep = res; });

  // A small artificial delay on the FIRST comments GET widens the race window
  // so sweep A is still parked in its comments read when sweep B launches.
  const GET_DELAY_MS = 25;
  const WINNER_PID = 424242;
  const isAlive = (pid) => pid === WINNER_PID;

  const labels = [
    { id: "lbl-review", name: "REVIEW_REQUIRED", color: "#ef4444" },
    { id: "lbl-rework", name: "NEEDS_REWORK", color: "#f97316" },
    { id: "lbl-done", name: "DONE_VERIFIED", color: "#22c55e" },
    { id: "lbl-owner", name: "OWNER_REQUIRED", color: "#991b1b" },
  ];

  const issue = {
    id: "iss-1",
    identifier: "KOL-100",
    title: "test",
    description: "a change",
    status: "in_review",
    labels: [{ id: "lbl-review", name: "REVIEW_REQUIRED" }],
    labelIds: ["lbl-review"],
  };

  // Shared http* / dispatchReviewer closures (used by both sweeps).
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
    dispatchReviewer: async () => {
      dispatchCount += 1;
      return { ok: true, stdout: "Looks good.\nVERDICT: PASS", stderr: "", timedOut: false, error: null };
    },
    resolveToken: async () => null, // board fallback — avoids the attribution dance
    log: () => {},
    stateFile: TMP_STATE,
  };

  // Launch sweep A (do not await yet) — it acquires the lock and enters its sweep.
  const pA = runReviewOnce({
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
  // WINNER_PID alive -> refused. B performs NO Paperclip read/write/dispatch.
  const rB = await runReviewOnce({
    ...sharedDeps,
    lockFile: TMP_LOCK,
    acquireLock,
    releaseLock,
    isAlive,
    lockPid: WINNER_PID + 1,
    _fs: fs,
  });

  // Collect A's result (it finishes the dispatch: verdict POST + transition).
  const rA = await pA;

  // ---- KOL-37/KOL-38 regression assertions ----
  assert.equal(dispatchCount, 1, `T7: exactly ONE dispatchReviewer call under concurrency (got ${dispatchCount}) — KOL-37/KOL-38 regression`);
  assert.equal(commentPosts, 1, `T7: exactly ONE verdict comment posted under concurrency (got ${commentPosts})`);
  assert.equal(patchCalls, 1, `T7: exactly ONE issue transition PATCH (got ${patchCalls})`);

  // Exactly one sweep refused, exactly one performed the real dispatch.
  const refused = [rA, rB].filter((r) => r.refused);
  assert.equal(refused.length, 1, "T7: exactly one concurrent sweep is refused (the loser sees the lock held)");
  assert.equal(rB.refused, true, "T7: the second-launched sweep (B) is the one refused");
  assert.equal(rB.results.length, 0, "T7: the refused sweep records no issue results");

  // The refused sweep must NOT have touched Paperclip at all — no issues GET.
  assert.equal(getIssuesCalls, 1, `T7: issues-list GETted exactly once (refused sweep never reads Paperclip) — got ${getIssuesCalls}`);

  // Clean up the temp lock and state.
  await fs.unlink(TMP_LOCK).catch(() => {});
  await fs.unlink(TMP_STATE).catch(() => {});
  ok("T7: KOL-37/KOL-38 regression — two concurrent sweeps cannot both dispatch GIBRAN (single-instance lock closes the TOCTOU race)");
}

// =====================================================================
// KOL-49 regression: workspace-path heuristic must not flag benign Windows paths
// =====================================================================
async function testAppDataPathNotWorkspaceError() {
  const name = "(o) KOL-49: PASS mentioning C:\\Users\\ASUS\\AppData\\... must NOT be downgraded to workspace-error";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  let dispatchCalled = 0;
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => {
      dispatchCalled++;
      return {
        ok: true,
        stdout: "Build cache log at C:\\Users\\ASUS\\AppData\\Local\\npm-cache\\_logs\\foo.log is irrelevant.\nVERDICT: PASS WITH NOTES",
        stderr: "",
        timedOut: false,
        error: null,
      };
    };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(dispatchCalled, 1, "GIBRAN must be dispatched exactly once");
    assert.equal(sum.dispatchFailed, 0, "AppData must NOT be flagged as out-of-workspace");
    assert.equal(sum.passed, 1, "PASS WITH NOTES must be treated as a real pass");
    const it = state.issues[0];
    assert.equal(it.status, "done", "issue must transition to done");
    assert.deepEqual(it.labelIds, ["lbl-done"], "REVIEW_REQUIRED swapped for DONE_VERIFIED");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testScoopAppsPathNotWorkspaceError() {
  const name = "(p) KOL-49: REJECT mentioning C:\\Users\\ASUS\\scoop\\apps\\... must NOT be downgraded to workspace-error";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  let dispatchCalled = 0;
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => {
      dispatchCalled++;
      return {
        ok: true,
        stdout: "Node is installed under C:\\Users\\ASUS\\scoop\\apps\\node\\current\\node_modules\\foo\\index.js.\nVERDICT: REJECT",
        stderr: "",
        timedOut: false,
        error: null,
      };
    };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(dispatchCalled, 1, "GIBRAN must be dispatched exactly once");
    assert.equal(sum.dispatchFailed, 0, "scoop\\apps must NOT be flagged as out-of-workspace");
    assert.equal(sum.rejected, 1, "REJECT must be treated as a real reject");
    const it = state.issues[0];
    assert.equal(it.status, "todo", "issue must transition to todo");
    assert.deepEqual(it.labelIds, ["lbl-rework"], "REVIEW_REQUIRED swapped for NEEDS_REWORK");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testKol47IncidentPathStillFlagged() {
  const name = "(q) KOL-49: the real KOL-47 path 'D:\\FounderOS-Aidit De Maestros\\app' is still flagged as workspace-error";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  let dispatchCalled = 0;
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => {
      dispatchCalled++;
      return {
        ok: true,
        stdout: "I reviewed D:\\FounderOS-Aidit De Maestros\\app and it looks good.\nVERDICT: PASS",
        stderr: "",
        timedOut: false,
        error: null,
      };
    };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(dispatchCalled, 1, "GIBRAN must be dispatched exactly once");
    assert.equal(sum.dispatchFailed, 1, "the KOL-47 incident path must still be downgraded to workspace-error");
    assert.equal(sum.passed, 0, "must NOT trust the out-of-workspace PASS");
    const it = state.issues[0];
    assert.equal(it.status, "in_review", "issue status must NOT change");
    assert.deepEqual(it.labelIds, ["lbl-review"], "REVIEW_REQUIRED must remain in place");
    const c = state.comments["iss-1"].find((x) => /WORKSPACE-ERROR/i.test(x.body));
    assert.ok(c, "anomaly comment posted");
    assert.ok(/FounderOS-Aidit De Maestros/i.test(c.body), "comment must include the path GIBRAN cited");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testInWorkspacePathNotFlagged() {
  const name = "(r) KOL-49: a path inside the real workspace must NOT be flagged as out-of-workspace";
  await clearTempLock();
  const state = baseState();
  const s = await startServer(mockServer(state).handler);
  let dispatchCalled = 0;
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const fakeDispatch = async () => {
      dispatchCalled++;
      return {
        ok: true,
        // The "real workspace" is now DERIVED (review-runner.mjs resolves
        // HERMES_WORKSPACE from its own location), so the fixture derives the
        // same way. Hardcoding "D:\AI\Active FounderOS-Aidit" here made this
        // case assert the opposite of its own name the moment the checkout
        // moved: that path is genuinely out-of-workspace on this machine.
        stdout: `Reviewed ${path.join(TEST_WORKSPACE_ROOT, "ops-watcher", "review-runner.mjs")}; clean.\nVERDICT: PASS`,
        stderr: "",
        timedOut: false,
        error: null,
      };
    };
    const sum = await runReviewSweep({ base, token: "t", companyId: "C", dispatchGibranFn: fakeDispatch, log, api: {}, ...LOCK_DEPS });
    assert.equal(dispatchCalled, 1, "GIBRAN must be dispatched exactly once");
    assert.equal(sum.dispatchFailed, 0, "in-workspace path must NOT be flagged");
    assert.equal(sum.passed, 1, "PASS inside the workspace must be treated as a real pass");
    const it = state.issues[0];
    assert.equal(it.status, "done", "issue must transition to done");
    assert.deepEqual(it.labelIds, ["lbl-done"], "REVIEW_REQUIRED swapped for DONE_VERIFIED");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testUnusableReviewerReplyFourShapesViaSharedHelper() {
  const name = "(i8) isUnusableReviewerReply wrapper classifies empty/truncation/quota/usable shapes correctly";
  try {
    assert.deepEqual(isUnusableReviewerReply(""), { unusable: true, reason: "empty reviewer output" }, "empty string");
    assert.deepEqual(
      isUnusableReviewerReply("Response truncated due to output length limit"),
      { unusable: true, reason: "reviewer output truncated" },
      "truncation meta output",
    );
    // isUnusableReviewerReply has no quota/auth gate: a >=20-char provider
    // auth_error string is still usable (the shared helper's quota check is
    // deliberately not adopted here).
    const quota = "provider.auth_error: 403 You've reached your weekly (7-day) usage limit.";
    assert.deepEqual(isUnusableReviewerReply(quota), { unusable: false }, "quota string (>=20 chars) -> usable");
    assert.deepEqual(isUnusableReviewerReply("Looks good.\nVERDICT: PASS"), { unusable: false }, "normal usable reply");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function main() {
  console.log("# review-runner regression tests");
  await testHappyPass();
  await testPassWithNotes();
  await testRejectGoesToNeedsRework();
  await testHermesTimeoutNoCrash();
  await testHermesFailureBoundedSkipsAfterMaxAttempts();
  await testAlreadyVerdictedSkipped();
  await testParseFailedHandling();
  await testNetworkErrorNoCrash();
  await testParseVerdictPure();
  await testUnusableReviewerReplyPure();
  await testRunOnceEmptyReviewerOutputDeferred();
  await testRunOnceEmptyReviewerOutputEscalatesAtCap();
  await testRunOnceQuotaFailureHeldNoAttemptBurn();
  await testRunOnceParseFailedStillNeedsRework();
  await testRunOncePassStillDone();
  await testWorkspaceErrorSelfReported();
  await testWorkspaceErrorBoundedRetry();
  await testWorkspaceErrorCapMovesToNeedsRework();
  await testOutOfWorkspacePathHeuristic();
  await testNousLaneAvailabilityRefusesOrRuns();
  await t7_concurrentSweepsDoNotDoubleDispatch();
  await testAppDataPathNotWorkspaceError();
  await testScoopAppsPathNotWorkspaceError();
  await testKol47IncidentPathStillFlagged();
  await testInWorkspacePathNotFlagged();
  await testUnusableReviewerReplyFourShapesViaSharedHelper();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error("regression runner crashed:", e); process.exit(1); });