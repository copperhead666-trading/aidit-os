// ops-watcher/telegram-listener-daemon.regression.test.mjs
// Offline regression coverage for the always-on Telegram OWNER control-plane
// daemon. NO real Telegram API, NO real Paperclip, NO real long-poll wait, and
// (since the _spawnHeartbeat DI seam) NO real child-process spawn —
// getUpdates, all Paperclip helpers, sleep, the pid-aliveness check, now, and
// the event-driven wake spawn are all injected. Run with:
//
//   node ops-watcher/telegram-listener-daemon.regression.test.mjs
//
// Covers:
//   T1  immediate-ACK-before-processing ordering (property 2)
//   T2  bounded backoff on a simulated getUpdates network error (property 3)
//   T3a lock-file single-instance: refuse-when-alive (property 5)
//   T3b stale-lock recovery + clean lock removal on exit (property 5 + 6)
//   T3c REAL isPidAliveReal against a known-dead PID + the current process's PID
//   T3d acquireLock clean first-start + releaseLock removes file
//   T3e acquireLock stale-rewrite: dead holder -> lock rewritten with new pid
//   T4  comment-dedupe: rapid repeat APPROVE tap suppresses the duplicate
//       confirmation comment while still answering the callback, still
//       applying the canonical PATCH, and still editing the message (property 7)
//   T4b comment-dedupe negative: when the most-recent comment is a DIFFERENT
//       decision, the confirmation comment IS posted
//   T4c hasRecentDecisionComment window unit (old=not deduped, fresh=deduped,
//       neterr=safe-not-deduped)
//   T5  durable offset advanced after a multi-update batch (property 4)
//   T6  text-message ingress — OWNER text creates a Paperclip issue tagged DIRECTIVE (no approval loop)
//   T6b non-owner text message is skipped
//   T7  APPROVE removes all buttons (edit called with removeKeyboard)
//   T8  REJECT removes all buttons
//   T9  DEFER leaves only valid next actions (APPROVE/REJECT/DETAILS, no DEFER)
//   T10 reply-to-decision-card: OWNER reply text captured as a NOTE comment on
//       the matched issue; no new issue, no patchIssue, no wake, ACK sent
//   T10b reply-to a NON-decision message falls through to directive creation
//   T10c note-match scan network error -> safe fallthrough to directive (no crash)

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import {
  runDaemon,
  acquireLock,
  releaseLock,
  isPidAliveReal,
  backoffMs,
} from "./telegram-listener-daemon.mjs";
import {
  defaultReadState,
  defaultWriteState,
  hasRecentDecisionComment,
  processUpdateForCallback,
  findIssueByTelegramMessageId,
  checkPauseReal,
  slashCommandNotImplementedReply,
  AHMAD_AGENT_ID,
  spawnHeartbeatReal,
  acceptedOptionSuffix,
} from "./telegram-listener.mjs";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tg-daemon-test-"));
let tmpSeq = 0;
const tmpFile = (name) => path.join(tmp, `${name}-${tmpSeq++}`);
const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";

// ---- _spawnHeartbeat DI mock (FIX B: no real child-process spawn) ----
// Every test injects this no-op fake so the suite is fully offline — no REAL
// `node ops-watcher/heartbeat.mjs --once` child process is ever spawned against
// a live Paperclip instance. Tests that exercise the event-driven wake paths
// (text-ingress, APPROVE) assert on spawnHeartbeatCalls to verify the real code
// path WOULD call it with the right argv.
const spawnHeartbeatCalls = [];
function _spawnHeartbeatMock() {
  spawnHeartbeatCalls.push({ argv: ["ops-watcher/heartbeat.mjs", "--once"] });
  return { pid: 12345 };
}

// ---- shared mock builders ----
function makeIssue({ id = "iss-KOL-1", identifier = "KOL-1", title = "Test issue", labelIds = ["lbl-OWNER_REQUIRED"], status = "in_progress" } = {}) {
  return { id, identifier, title, labelIds, status, labels: [] };
}

// Build a _get(url) router mock for Paperclip reads (first match wins).
function makeGet(routes, trace) {
  return async (url) => {
    if (trace) trace.push({ fn: "get", url, t: trace.length });
    for (const r of routes) {
      if (r.match(url)) {
        if (r.throw) throw new Error(r.throw);
        return { networkError: false, status: r.status || 200, body: r.body };
      }
    }
    return { networkError: false, status: 404, body: null };
  };
}

// Build mock Paperclip write helpers that record into `trace`.
function makeWriteMocks(trace) {
  return {
    _ensureLabel: async (base, companyId, name, color) => {
      if (trace) trace.push({ fn: "ensureLabel", name, t: trace.length });
      return { id: "lbl-" + name, created: false };
    },
    _listLabels: async () => ({ labels: [], networkError: false }),
    _postComment: async (base, issueId, body, opts) => {
      if (trace) trace.push({ fn: "postComment", issueId, body, t: trace.length });
      return { comment: { id: "cmt-" + Math.random().toString(36).slice(2) }, status: 201, networkError: false };
    },
    _patchIssue: async (base, issueId, patch, opts) => {
      if (trace) trace.push({ fn: "patchIssue", issueId, patch, t: trace.length });
      return { issue: { id: issueId }, status: 200, networkError: false };
    },
  };
}

// Build mock Telegram helpers that record into `trace`.
function makeTgMocks(trace) {
  return {
    _answerCallbackQuery: async (cqId, text, opts) => {
      if (trace) trace.push({ fn: "answerCallbackQuery", cqId, text, t: trace.length });
      return { sent: true, ok: true, status: 200 };
    },
    _editMessageText: async (messageId, text, opts) => {
      if (trace) trace.push({ fn: "editMessageText", messageId, text, t: trace.length });
      return { sent: true, ok: true, status: 200 };
    },
    _sendMessage: async (text, opts) => {
      if (trace) trace.push({ fn: "sendMessage", text, t: trace.length });
      return { sent: true, ok: true, status: 200, result: { message_id: 999 } };
    },
  };
}

// Build a single callback_query update for an action on a shortId.
function makeCallbackUpdate(updateId, actionLetter, shortId, messageId = 77) {
  return {
    update_id: updateId,
    callback_query: {
      id: "cbq-" + updateId,
      data: `${actionLetter}:${shortId}`,
      message: { message_id: messageId, chat: { id: 8987077084 }, text: "OWNER decision required" },
      from: { id: 8987077084 },
    },
  };
}

function makeOwnerTextUpdate(updateId, text, extraMessage = {}) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 1000,
      text,
      chat: { id: 8987077084 },
      from: { id: 8987077084, first_name: "Aidit" },
      ...extraMessage,
    },
  };
}

function makePausedState(reason = "owner emergency stop") {
  return { paused: true, reason, atIso: "2026-09-02T00:00:00.000Z", by: "owner" };
}

function makeProcessCtx(trace, overrides = {}) {
  return {
    base: "http://127.0.0.1:9999",
    companyId: COMPANY_ID,
    labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED", DIRECTIVE: "lbl-DIRECTIVE" },
    idMap: {},
    upOpts: {},
    immediateAck: true,
    _get: async (url) => { trace.push({ fn: "get", url, t: trace.length }); return { networkError: false, status: 200, body: [] }; },
    _listLabels: async () => ({ labels: [], networkError: false }),
    _ensureLabel: async (base, companyId, name, color) => {
      trace.push({ fn: "ensureLabel", name, color, t: trace.length });
      return { id: "lbl-" + name, created: true, networkError: false };
    },
    _postComment: async (base, issueId, body, opts) => {
      trace.push({ fn: "postComment", issueId, body, t: trace.length });
      return { comment: { id: "cmt-test" }, status: 201, networkError: false };
    },
    _patchIssue: async (base, issueId, patch, opts) => {
      trace.push({ fn: "patchIssue", issueId, patch, t: trace.length });
      return { issue: { id: issueId }, status: 200, networkError: false };
    },
    _answerCallbackQuery: async (cqId, text, opts) => {
      trace.push({ fn: "answerCallbackQuery", cqId, text, t: trace.length });
      return { sent: true, ok: true, status: 200 };
    },
    _editMessageText: async (messageId, text, opts) => {
      trace.push({ fn: "editMessageText", messageId, text, t: trace.length });
      return { sent: true, ok: true, status: 200 };
    },
    _sendMessage: async (text, opts) => {
      trace.push({ fn: "sendMessage", text, t: trace.length });
      return { sent: true, ok: true, status: 200, result: { message_id: 999 } };
    },
    _spawnHeartbeat: _spawnHeartbeatMock,
    _httpPost: async (url, body, opts) => {
      trace.push({ fn: "httpPost", url, body, title: body && body.title, t: trace.length });
      return { status: 201, body: { id: "iss-new-test", identifier: "KOL-TEST" }, networkError: false };
    },
    _handleCommand: async () => ({ handled: false }),
    _checkPause: async () => ({ paused: false, reason: "", atIso: null, by: null }),
    log: () => {},
    now: Date.now,
    decisionDedupe: new Map(),
    ...overrides,
  };
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

let passed = 0, failed = 0;
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`  ${e && e.stack ? e.stack : e}`); failed++; };

// =====================================================================
// T1: immediate-ACK-before-processing ordering (property 2)
// =====================================================================
async function t1_immediateAckOrdering() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const issue = makeIssue();
  const routes = [
    { match: (u) => u.endsWith(`/companies/${COMPANY_ID}/issues`), body: [issue] },
    { match: (u) => /\/issues\/[^/]+\/comments$/.test(u), body: [] }, // empty comments -> not deduped
    { match: (u) => /\/issues\/[^/]+$/.test(u), body: issue }, // freshIssue
  ];
  const _get = makeGet(routes, trace);
  const write = makeWriteMocks(trace);
  const tg = makeTgMocks(trace);

  const stateFile = tmpFile("state");
  await defaultWriteState(stateFile, { offset: 100, updatedAt: "x" });

  let getUpdatesCalls = 0;
  const updates0 = [makeCallbackUpdate(100, "a", "KOL-1")];
  const _getUpdates = async (offset, opts) => {
    getUpdatesCalls++;
    if (getUpdatesCalls === 1) return { ok: true, updates: updates0 };
    return { ok: true, updates: [] }; // idle thereafter
  };

  const lockFile = tmpFile("lock");

  const r = await runDaemon({
    base: "http://127.0.0.1:9999",
    stateFile,
    lockFile,
    lockPid: process.pid,
    isAlive: isPidAliveReal,
    _get,
    _getUpdates,
    _spawnHeartbeat: _spawnHeartbeatMock,
    ...write,
    ...tg,
    readState: defaultReadState,
    writeState: defaultWriteState,
    sleep: async () => {},
    now: Date.now,
    pollTimeoutMs: 1000,
    shouldStop: () => getUpdatesCalls >= 2,
  });

  assert.equal(r.refused, false, "T1: daemon should not refuse");

  const ackIdx = trace.findIndex((e) => e.fn === "answerCallbackQuery" && e.text === "Memproses…");
  const patchIdx = trace.findIndex((e) => e.fn === "patchIssue");
  const editIdx = trace.findIndex((e) => e.fn === "editMessageText");
  const postCommentIdx = trace.findIndex((e) => e.fn === "postComment");

  assert.notEqual(ackIdx, -1, "T1: immediate ACK 'Memproses…' must be recorded");
  assert.notEqual(patchIdx, -1, "T1: patchIssue must be recorded");
  assert.notEqual(editIdx, -1, "T1: editMessageText must be recorded");

  // Property 2: ACK happens BEFORE the canonical PATCH (and before postComment).
  assert.ok(ackIdx < patchIdx, `T1: ACK(t=${trace[ackIdx].t}) must precede patchIssue(t=${trace[patchIdx].t})`);
  assert.ok(ackIdx < postCommentIdx, "T1: ACK must precede postComment");
  // Final outcome edit happens AFTER the patch.
  assert.ok(editIdx > patchIdx, "T1: editMessageText must follow patchIssue");
  // answerCallbackQuery called exactly once (pre-acked -> no second toast).
  const ackCount = trace.filter((e) => e.fn === "answerCallbackQuery").length;
  assert.equal(ackCount, 1, "T1: answerCallbackQuery called exactly once (pre-acked, no duplicate toast)");

  // APPROVE triggers the event-driven wake spawn — verify the DI mock was called
  // (and NOT the real spawnHeartbeatReal).
  assert.equal(spawnHeartbeatCalls.length, 1, "T1: APPROVE path calls _spawnHeartbeat exactly once");
  assert.deepEqual(spawnHeartbeatCalls[0].argv, ["ops-watcher/heartbeat.mjs", "--once"], "T1: spawn argv is heartbeat --once");

  // Offset advanced past the update.
  const sr = await defaultReadState(stateFile);
  assert.equal(sr.value.offset, 101, "T1: offset advanced to update_id+1");

  ok("T1: immediate ACK precedes Paperclip work; edit follows; offset advanced; single ACK; spawn DI'd");
}

// =====================================================================
// T2: bounded backoff on simulated getUpdates network error (property 3)
// =====================================================================
async function t2_backoff() {
  const sleepCalls = [];
  let getUpdatesCalls = 0;
  const _getUpdates = async (offset, opts) => {
    getUpdatesCalls++;
    if (getUpdatesCalls <= 3) {
      return { ok: false, networkError: true, networkErrorMessage: "ECONNREFUSED mock" };
    }
    return { ok: true, updates: [] };
  };

  const stateFile = tmpFile("state");
  await defaultWriteState(stateFile, { offset: 50, updatedAt: "x" });
  const lockFile = tmpFile("lock");

  const r = await runDaemon({
    base: "http://127.0.0.1:9999",
    stateFile,
    lockFile,
    lockPid: process.pid,
    isAlive: isPidAliveReal,
    _getUpdates,
    _get: makeGet([], null),
    _spawnHeartbeat: _spawnHeartbeatMock,
    ...makeWriteMocks(null),
    ...makeTgMocks(null),
    readState: defaultReadState,
    writeState: defaultWriteState,
    sleep: async (ms) => { sleepCalls.push(ms); },
    now: Date.now,
    pollTimeoutMs: 1000,
    shouldStop: () => getUpdatesCalls >= 4,
  });

  // 3 failures -> 3 backoff sleeps with exponential growth.
  assert.equal(sleepCalls.length, 3, "T2: exactly 3 backoff sleeps for 3 failures");
  assert.deepEqual(sleepCalls, [backoffMs(1), backoffMs(2), backoffMs(3)], "T2: backoff durations match exponential formula");
  assert.deepEqual([backoffMs(1), backoffMs(2), backoffMs(3)], [2000, 4000, 8000], "T2: backoff 2s/4s/8s");
  // Cap check (property 3: never grows unbounded).
  assert.equal(backoffMs(10), 60000, "T2: backoff capped at 60s");
  assert.equal(backoffMs(20), 60000, "T2: cap holds at high counts");
  // Recovered: 4th call succeeded and loop exited cleanly (no refusal).
  assert.equal(r.refused, false, "T2: daemon recovered, not refused");
  // Offset NOT advanced (no updates processed).
  const sr = await defaultReadState(stateFile);
  assert.equal(sr.value.offset, 50, "T2: offset unchanged when no updates processed");

  ok("T2: 3 failures -> 2s/4s/8s backoff, capped at 60s, recovered on 4th call, offset held");
}

// =====================================================================
// T3a: lock refuse-when-alive (property 5)
// =====================================================================
async function t3a_lockRefuseAlive() {
  const lockFile = tmpFile("lock");
  await fs.writeFile(lockFile, JSON.stringify({ pid: 4242, startedAt: "x" }), "utf8");

  let getUpdatesCalled = false;
  const _getUpdates = async () => { getUpdatesCalled = true; return { ok: true, updates: [] }; };

  const r = await runDaemon({
    base: "http://127.0.0.1:9999",
    stateFile: tmpFile("state"),
    lockFile,
    lockPid: process.pid,
    isAlive: () => true, // the holder (pid 4242) is alive
    _getUpdates,
    _get: makeGet([], null),
    _spawnHeartbeat: _spawnHeartbeatMock,
    ...makeWriteMocks(null),
    ...makeTgMocks(null),
    readState: defaultReadState,
    writeState: defaultWriteState,
    sleep: async () => {},
    now: Date.now,
    pollTimeoutMs: 1000,
    shouldStop: () => true,
  });

  assert.equal(r.refused, true, "T3a: must refuse when lock holder alive");
  assert.equal(r.pid, 4242, "T3a: reports the alive holder's pid");
  assert.equal(getUpdatesCalled, false, "T3a: must NOT poll when refused");
  const lockContent = JSON.parse(await fs.readFile(lockFile, "utf8"));
  assert.equal(lockContent.pid, 4242, "T3a: existing lock untouched");

  ok("T3a: refused to start second instance while holder alive; did not poll; lock untouched");
}

// =====================================================================
// T3b: stale-lock recovery + clean lock removal on exit (property 5 + 6)
// =====================================================================
async function t3b_staleLockRecovery() {
  const lockFile = tmpFile("lock");
  await fs.writeFile(lockFile, JSON.stringify({ pid: 4242, startedAt: "x" }), "utf8");

  let getUpdatesCalls = 0;
  const _getUpdates = async () => { getUpdatesCalls++; return { ok: true, updates: [] }; };

  const r = await runDaemon({
    base: "http://127.0.0.1:9999",
    stateFile: tmpFile("state"),
    lockFile,
    lockPid: 5555, // the NEW instance's pid
    isAlive: () => false, // the OLD holder (4242) is dead -> stale lock
    _getUpdates,
    _get: makeGet([], null),
    _spawnHeartbeat: _spawnHeartbeatMock,
    ...makeWriteMocks(null),
    ...makeTgMocks(null),
    readState: defaultReadState,
    writeState: defaultWriteState,
    sleep: async () => {},
    now: Date.now,
    pollTimeoutMs: 1000,
    shouldStop: () => getUpdatesCalls >= 1,
  });

  assert.equal(r.refused, false, "T3b: must NOT refuse on a stale lock");
  assert.ok(getUpdatesCalls >= 1, "T3b: must proceed to poll after recovering stale lock");
  // After clean exit the lock is removed (property 6: fresh start not blocked).
  assert.ok(!await fileExists(lockFile), "T3b: lock removed on clean shutdown");

  ok("T3b: stale lock recovered (pid dead), proceeded to poll, lock removed on clean exit");
}

// =====================================================================
// T3c: REAL isPidAliveReal against a known-dead PID and the current process
// =====================================================================
async function t3c_realPidCheck() {
  const deadPid = 999999;
  assert.equal(isPidAliveReal(deadPid), false, "T3c: real check reports dead PID as not alive");
  assert.equal(isPidAliveReal(process.pid), true, "T3c: real check reports own pid as alive");
  assert.equal(isPidAliveReal(NaN), false, "T3c: NaN pid -> not alive");
  ok("T3c: real process.kill(pid,0) check works — dead PID=false, own PID=true");
}

// =====================================================================
// T3d: acquireLock clean first-start + releaseLock removes file
// =====================================================================
async function t3d_acquireLockClean() {
  const lockFile = tmpFile("lock");
  const a = await acquireLock({ lockFile, pid: 111, isAlive: isPidAliveReal, now: Date.now, _fs: fs });
  assert.equal(a.acquired, true, "T3d: clean acquire");
  const c = JSON.parse(await fs.readFile(lockFile, "utf8"));
  assert.equal(c.pid, 111, "T3d: lock records pid");
  await releaseLock({ lockFile, _fs: fs });
  assert.ok(!await fileExists(lockFile), "T3d: releaseLock removes the file");
  ok("T3d: acquireLock clean start + releaseLock removes file");
}

// =====================================================================
// T3e: acquireLock stale-rewrite (dead holder -> lock rewritten with new pid)
// =====================================================================
async function t3e_acquireLockStaleRewrite() {
  const lockFile = tmpFile("lock");
  await fs.writeFile(lockFile, JSON.stringify({ pid: 4242, startedAt: "old" }), "utf8");
  const a = await acquireLock({ lockFile, pid: 5555, isAlive: () => false, now: Date.now, _fs: fs });
  assert.equal(a.acquired, true, "T3e: stale lock -> acquired");
  const c = JSON.parse(await fs.readFile(lockFile, "utf8"));
  assert.equal(c.pid, 5555, "T3e: lock rewritten with NEW instance pid (old stale removed)");
  // And a second acquire against the now-fresh 5555 with alive=true must REFUSE.
  const a2 = await acquireLock({ lockFile, pid: 6666, isAlive: () => true, now: Date.now, _fs: fs });
  assert.equal(a2.acquired, false, "T3e: fresh lock with alive holder -> refused");
  assert.equal(a2.pid, 5555, "T3e: refuses reporting the live holder pid");
  await releaseLock({ lockFile, _fs: fs });
  ok("T3e: stale lock rewritten with new pid; fresh live holder then refused");
}

// =====================================================================
// T4: comment-dedupe on rapid repeat APPROVE tap (property 7)
// =====================================================================
async function t4_dedupeRepeatApprove() {
  const trace = [];
  const issue = makeIssue();
  const recentApproved = {
    body: "OWNER MENYETUJUI via Telegram (2026-01-01T00:00:00.000Z) — ketukan tombol oleh owner via @ahmadsuperbot. Label OWNER_REQUIRED dihapus sehingga alur otomatis dapat dilanjutkan.",
    authorType: "user",
    createdAt: new Date().toISOString(),
  };
  const routes = [
    { match: (u) => u.endsWith(`/companies/${COMPANY_ID}/issues`), body: [issue] },
    { match: (u) => /\/issues\/[^/]+\/comments$/.test(u), body: [recentApproved] },
    { match: (u) => /\/issues\/[^/]+$/.test(u), body: issue },
  ];
  const _get = makeGet(routes, trace);
  const write = makeWriteMocks(trace);
  const tg = makeTgMocks(trace);

  const update = makeCallbackUpdate(200, "a", "KOL-1");

  const r = await processUpdateForCallback(update, {
    base: "http://127.0.0.1:9999",
    companyId: COMPANY_ID,
    labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED", OWNER_REJECTED: "lbl-OWNER_REJECTED", ESCALATED_TO_AHMAD: "lbl-ESCALATED_TO_AHMAD" },
    idMap: { "KOL-1": issue },
    upOpts: {},
    immediateAck: true,
    _get,
    _spawnHeartbeat: _spawnHeartbeatMock,
    ...write,
    ...tg,
    log: () => {},
    now: Date.now,
  });

  assert.equal(r.outcome, "approved", "T4: outcome still 'approved' (canonical action applied)");
  const acks = trace.filter((e) => e.fn === "answerCallbackQuery");
  assert.equal(acks.length, 1, "T4: callback answered exactly once (Processing…)");
  assert.equal(acks[0].text, "Memproses…", "T4: immediate ACK text");
  const patches = trace.filter((e) => e.fn === "patchIssue");
  assert.equal(patches.length, 1, "T4: canonical PATCH still applied (idempotent action preserved)");
  const comments = trace.filter((e) => e.fn === "postComment");
  assert.equal(comments.length, 0, "T4: duplicate confirmation comment SUPPRESSED");
  const edits = trace.filter((e) => e.fn === "editMessageText");
  assert.equal(edits.length, 1, "T4: message still edited with final outcome");
  assert.match(edits[0].text, /DISETUJUI/i, "T4: edit shows approved outcome");

  ok("T4: repeat APPROVE -> ACK yes, PATCH yes, comment SUPPRESSED, edit yes");
}

// =====================================================================
// T4b: dedupe negative — different most-recent comment -> comment IS posted
// =====================================================================
async function t4b_dedupeNegative() {
  const trace = [];
  const issue = makeIssue();
  const otherComment = { body: "reviewer: looks good to me", authorType: "agent", createdAt: new Date().toISOString() };
  const routes = [
    { match: (u) => u.endsWith(`/companies/${COMPANY_ID}/issues`), body: [issue] },
    { match: (u) => /\/issues\/[^/]+\/comments$/.test(u), body: [otherComment] },
    { match: (u) => /\/issues\/[^/]+$/.test(u), body: issue },
  ];
  const _get = makeGet(routes, trace);
  const write = makeWriteMocks(trace);
  const tg = makeTgMocks(trace);

  const update = makeCallbackUpdate(201, "a", "KOL-1");
  const r = await processUpdateForCallback(update, {
    base: "http://127.0.0.1:9999",
    companyId: COMPANY_ID,
    labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED" },
    idMap: { "KOL-1": issue },
    upOpts: {},
    immediateAck: true,
    _get,
    _spawnHeartbeat: _spawnHeartbeatMock,
    ...write,
    ...tg,
    log: () => {},
    now: Date.now,
  });

  assert.equal(r.outcome, "approved", "T4b: outcome approved");
  const comments = trace.filter((e) => e.fn === "postComment");
  assert.equal(comments.length, 1, "T4b: confirmation comment IS posted when last comment differs");
  assert.match(comments[0].body, /OWNER MENYETUJUI via Telegram/, "T4b: posted the right decision comment");

  ok("T4b: when most-recent comment is NOT the same decision, comment IS posted");
}

// =====================================================================
// T4c: hasRecentDecisionComment window unit
// =====================================================================
async function t4c_dedupeWindow() {
  const oldDate = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
  const oldMatch = { body: "OWNER APPROVED via Telegram (...) ...", createdAt: oldDate };
  const _get = async () => ({ networkError: false, body: [oldMatch] });
  const skip = await hasRecentDecisionComment(_get, "http://x", "iss", "OWNER APPROVED via Telegram", 60_000, Date.now);
  assert.equal(skip, false, "T4c: old (>window) matching comment is NOT deduped");

  const freshMatch = { body: "OWNER APPROVED via Telegram (...) ...", createdAt: new Date().toISOString() };
  const _get2 = async () => ({ networkError: false, body: [freshMatch] });
  const skip2 = await hasRecentDecisionComment(_get2, "http://x", "iss", "OWNER APPROVED via Telegram", 60_000, Date.now);
  assert.equal(skip2, true, "T4c: fresh (<window) matching comment IS deduped");

  const _get3 = async () => ({ networkError: true, body: null });
  const skip3 = await hasRecentDecisionComment(_get3, "http://x", "iss", "OWNER APPROVED via Telegram", 60_000, Date.now);
  assert.equal(skip3, false, "T4c: network error -> not deduped (safe)");

  ok("T4c: dedupe window honoured (old=not deduped, fresh=deduped, neterr=safe-not-deduped)");
}
async function t4d_dedupeDoesNotAssumeNewestIsLast() {
  const freshMatch = { body: "OWNER APPROVED via Telegram (...) ...", createdAt: new Date().toISOString() };
  const unrelatedAfter = { body: "agent: unrelated trailing comment", createdAt: new Date().toISOString() };
  const _get = async () => ({ networkError: false, body: [freshMatch, unrelatedAfter] });
  const skip = await hasRecentDecisionComment(_get, "http://x", "iss", "OWNER APPROVED via Telegram", 60_000, Date.now);
  assert.equal(skip, true, "T4d: matching fresh decision comment should dedupe even when API ordering puts another comment last");
  ok("T4d: dedupe scans the window and does not assume newest comment is last");
}

// =====================================================================
// T5: durable offset advanced after a multi-update batch (property 4)
// =====================================================================
async function t5_offsetAdvanceBatch() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const issue = makeIssue();
  const routes = [
    { match: (u) => u.endsWith(`/companies/${COMPANY_ID}/issues`), body: [issue] },
    { match: (u) => /\/issues\/[^/]+\/comments$/.test(u), body: [] },
    { match: (u) => /\/issues\/[^/]+$/.test(u), body: issue },
  ];
  const _get = makeGet(routes, trace);
  const stateFile = tmpFile("state");
  await defaultWriteState(stateFile, { offset: 1000, updatedAt: "x" });
  const lockFile = tmpFile("lock");

  let getUpdatesCalls = 0;
  const batch = [makeCallbackUpdate(1000, "a", "KOL-1"), makeCallbackUpdate(1001, "a", "KOL-1")];
  const _getUpdates = async (offset) => {
    getUpdatesCalls++;
    if (getUpdatesCalls === 1) return { ok: true, updates: batch };
    return { ok: true, updates: [] };
  };

  await runDaemon({
    base: "http://127.0.0.1:9999",
    stateFile,
    lockFile,
    lockPid: process.pid,
    isAlive: isPidAliveReal,
    _getUpdates,
    _get,
    _spawnHeartbeat: _spawnHeartbeatMock,
    ...makeWriteMocks(trace),
    ...makeTgMocks(trace),
    readState: defaultReadState,
    writeState: defaultWriteState,
    sleep: async () => {},
    now: Date.now,
    pollTimeoutMs: 1000,
    shouldStop: () => getUpdatesCalls >= 2,
  });

  const sr = await defaultReadState(stateFile);
  assert.equal(sr.value.offset, 1002, "T5: offset advanced past max update_id+1 (1001+1)");
  const confirmationComments = trace.filter((e) => e.fn === "postComment" && /OWNER MENYETUJUI via Telegram/.test(e.body));
  assert.equal(confirmationComments.length, 1, "T5: in-process burst dedupe suppresses duplicate confirmation comment even if comment fetch is stale");
  // APPROVE was called twice (batch of 2), but dedupe suppresses the second
  // confirmation comment. The _spawnHeartbeat mock should have been called for
  // each APPROVE (event-driven wake fires on each APPROVE, regardless of dedupe).
  assert.ok(spawnHeartbeatCalls.length >= 1, "T5: _spawnHeartbeat DI mock was called (no real spawn)");
  ok("T5: batch of 2 updates -> offset advanced and only one confirmation comment posted; spawn DI'd");
}

// =====================================================================
// T6: text-message ingress — OWNER text creates a Paperclip issue tagged DIRECTIVE (no approval loop)
// =====================================================================
async function t6_textIngress() {
  spawnHeartbeatCalls.length = 0;
  const directTrace = [];
  const textUpdate = {
    update_id: 200,
    message: {
      message_id: 55,
      text: "Beresin Barrier saya",
      chat: { id: 8987077084 },
      from: { id: 8987077084, first_name: "Aidit" },
    },
  };

  const directResult = await processUpdateForCallback(textUpdate, {
    base: "http://127.0.0.1:9999",
    companyId: COMPANY_ID,
    labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED", DIRECTIVE: "lbl-DIRECTIVE" },
    idMap: {},
    upOpts: {},
    immediateAck: true,
    _get: async () => ({ networkError: false, status: 200, body: [] }),
    _listLabels: async () => ({ labels: [], networkError: false }),
    _ensureLabel: async (base, companyId, name, color) => {
      directTrace.push({ fn: "ensureLabel", name, t: directTrace.length });
      return { id: "lbl-" + name, created: true, networkError: false };
    },
    _postComment: async () => ({ comment: { id: "cmt-1" }, status: 201, networkError: false }),
    _patchIssue: async (base, issueId, patch, opts) => {
      directTrace.push({ fn: "patchIssue", issueId, patch, t: directTrace.length });
      return { issue: { id: issueId }, status: 200, networkError: false };
    },
    _answerCallbackQuery: async () => ({ sent: true, ok: true }),
    _editMessageText: async () => ({ sent: true, ok: true }),
    _sendMessage: async (text, opts) => {
      directTrace.push({ fn: "sendMessage", text, t: directTrace.length });
      return { sent: true, ok: true, status: 200, result: { message_id: 999 } };
    },
    _spawnHeartbeat: _spawnHeartbeatMock,
    _httpPost: async (url, body, opts) => {
      directTrace.push({ fn: "httpPost", url, title: body.title, t: directTrace.length });
      return { status: 201, body: { id: "iss-new-1", identifier: "KOL-99" }, networkError: false };
    },
    log: () => {},
    now: Date.now,
    decisionDedupe: new Map(),
  });

  assert.equal(directResult.outcome, "text-ingressed", "T6: text message should be ingressed as a Paperclip issue");
  assert.equal(directResult.identifier, "KOL-99", "T6: issue identifier should be returned");
  assert.equal(directResult.issueId, "iss-new-1", "T6: issue id should be returned");

  // Verify httpPost was called to create the issue
  const createCalls = directTrace.filter((e) => e.fn === "httpPost");
  assert.equal(createCalls.length, 1, "T6: exactly one createIssue httpPost call");
  assert.ok(/OWNER DIRECTIVE/.test(createCalls[0].title), "T6: issue title starts with OWNER DIRECTIVE");

  // Verify patchIssue was called with DIRECTIVE label (NOT OWNER_REQUIRED) + status "todo"
  const patchCalls = directTrace.filter((e) => e.fn === "patchIssue");
  assert.equal(patchCalls.length, 1, "T6: exactly one patchIssue call");
  assert.ok(patchCalls[0].patch.labelIds.includes("lbl-DIRECTIVE"), "T6: patchIssue adds DIRECTIVE label");
  assert.equal(patchCalls[0].patch.status, "todo", "T6: patchIssue sets status to todo");
  assert.ok(!patchCalls[0].patch.labelIds.includes("lbl-OWNER_REQUIRED"), "T6: patchIssue must NOT add OWNER_REQUIRED (no approval loop)");
  assert.equal(patchCalls[0].patch.assigneeAgentId, AHMAD_AGENT_ID, "T6: patchIssue auto-assigns AHMAD_AGENT_ID (P0 — no manual Paperclip assignment)");

  // Verify sendMessage was called for the ACK
  const sendCalls = directTrace.filter((e) => e.fn === "sendMessage");
  assert.equal(sendCalls.length, 1, "T6: exactly one sendMessage (ACK)");
  assert.ok(/Received/.test(sendCalls[0].text), "T6: ACK says 'Received'");

  // FIX B: verify the event-driven wake spawn was called via the DI mock (NOT
  // the real spawnHeartbeatReal — no real child process spawned against live Paperclip).
  assert.equal(spawnHeartbeatCalls.length, 1, "T6: text-ingress path calls _spawnHeartbeat exactly once (DI'd, no real spawn)");
  assert.deepEqual(spawnHeartbeatCalls[0].argv, ["ops-watcher/heartbeat.mjs", "--once"], "T6: spawn argv is heartbeat --once");

  ok("T6: OWNER text message -> Paperclip issue created + tagged DIRECTIVE (no approval loop); spawn DI'd (no real child)");
}

// =====================================================================
// T6b: non-owner text message is skipped
// =====================================================================
async function t6b_nonOwnerTextSkipped() {
  const trace = [];
  const textUpdate = {
    update_id: 201,
    message: {
      message_id: 56,
      text: "hello from a stranger",
      chat: { id: 12345 },
      from: { id: 12345, first_name: "Stranger" },
    },
  };

  const result = await processUpdateForCallback(textUpdate, {
    base: "http://127.0.0.1:9999",
    companyId: COMPANY_ID,
    labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED" },
    idMap: {},
    upOpts: {},
    immediateAck: true,
    _get: async () => ({ networkError: false, status: 200, body: [] }),
    _listLabels: async () => ({ labels: [], networkError: false }),
    _ensureLabel: async () => ({ id: "lbl-x", created: false }),
    _postComment: async () => ({ comment: { id: "c" }, status: 201, networkError: false }),
    _patchIssue: async () => ({ issue: {}, status: 200, networkError: false }),
    _answerCallbackQuery: async () => ({ sent: true, ok: true }),
    _editMessageText: async () => ({ sent: true, ok: true }),
    _sendMessage: async () => ({ sent: true, ok: true }),
    _spawnHeartbeat: _spawnHeartbeatMock,
    _httpPost: async () => { trace.push({ fn: "httpPost" }); return { status: 201, body: {}, networkError: false }; },
    log: () => {},
    now: Date.now,
    decisionDedupe: new Map(),
  });

  assert.equal(result.outcome, "non-owner-text-skipped", "T6b: non-owner text should be skipped");
  assert.equal(trace.length, 0, "T6b: no httpPost should be called for non-owner text");
  ok("T6b: non-owner text message is skipped");
}

// =====================================================================
// T6c: /status command is routed through _handleCommand
// =====================================================================
async function t6c_statusCommandRoutedToHandleCommand() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const handlerReply = "STATUS REPLY FROM HANDLER";

  const result = await processUpdateForCallback(makeOwnerTextUpdate(202, "/status"), makeProcessCtx(trace, {
    _handleCommand: async (text, deps) => {
      trace.push({ fn: "handleCommand", text, hasGetHeartbeat: typeof deps.getHeartbeat === "function", t: trace.length });
      return { handled: true, reply: handlerReply };
    },
  }));

  assert.equal(result.outcome, "slash-command-handled", "T6c: /status returns slash-command-handled");
  assert.equal(trace.filter((e) => e.fn === "handleCommand").length, 1, "T6c: _handleCommand called exactly once");
  assert.equal(trace.find((e) => e.fn === "handleCommand").text, "/status", "T6c: _handleCommand receives raw command text");
  const sends = trace.filter((e) => e.fn === "sendMessage");
  assert.equal(sends.length, 1, "T6c: exactly one command reply is sent");
  assert.equal(sends[0].text, handlerReply, "T6c: sent reply is exactly the _handleCommand reply");
  assert.notEqual(sends[0].text, slashCommandNotImplementedReply("/status"), "T6c: not-implemented reply is not sent");
  assert.ok(!/bukan perintah/.test(sends[0].text), "T6c: sent reply does not contain the old not-implemented copy");
  assert.equal(trace.filter((e) => e.fn === "httpPost").length, 0, "T6c: command does not create an issue");
  assert.equal(spawnHeartbeatCalls.length, 0, "T6c: command does not spawn heartbeat");
  ok("T6c: /status routed through _handleCommand; handler reply sent; fallback not sent");
}

// =====================================================================
// T6d: unknown slash command falls back to not-implemented reply
// =====================================================================
async function t6d_unknownCommandFallsBack() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];

  const result = await processUpdateForCallback(makeOwnerTextUpdate(203, "/nope"), makeProcessCtx(trace, {
    _handleCommand: async (text) => {
      trace.push({ fn: "handleCommand", text, t: trace.length });
      return { handled: false };
    },
  }));

  assert.equal(result.outcome, "slash-command-not-implemented", "T6d: unknown slash command uses fallback outcome");
  assert.equal(trace.filter((e) => e.fn === "handleCommand").length, 1, "T6d: _handleCommand called before fallback");
  const sends = trace.filter((e) => e.fn === "sendMessage");
  assert.equal(sends.length, 1, "T6d: exactly one fallback reply is sent");
  assert.equal(sends[0].text, slashCommandNotImplementedReply("/nope"), "T6d: not-implemented reply is sent for handled:false");
  assert.equal(trace.filter((e) => e.fn === "httpPost").length, 0, "T6d: unknown command does not create an issue");
  assert.equal(spawnHeartbeatCalls.length, 0, "T6d: unknown command does not spawn heartbeat");
  ok("T6d: /nope reaches _handleCommand, then sends the not-implemented reply");
}

// =====================================================================
// T6e: pause blocks plain text ingress mutations
// =====================================================================
async function t6e_pausedPlainTextBlocked() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const pause = makePausedState("owner pulled the emergency stop");

  const result = await processUpdateForCallback(makeOwnerTextUpdate(204, "Ship the invoice cleanup"), makeProcessCtx(trace, {
    _checkPause: async () => pause,
  }));

  assert.equal(result.outcome, "paused", "T6e: paused text ingress returns paused outcome");
  assert.equal(trace.filter((e) => e.fn === "httpPost" && /\/issues$/.test(e.url)).length, 0, "T6e: no issue create POST while paused");
  assert.equal(trace.filter((e) => e.fn === "patchIssue").length, 0, "T6e: no patchIssue while paused");
  assert.equal(trace.filter((e) => e.fn === "postComment").length, 0, "T6e: no comment post while paused");
  assert.equal(spawnHeartbeatCalls.length, 0, "T6e: no heartbeat spawn while paused");
  const sends = trace.filter((e) => e.fn === "sendMessage");
  assert.equal(sends.length, 1, "T6e: owner is told the text was blocked");
  assert.match(sends[0].text, /FounderOS PAUSED/, "T6e: pause reply names the paused state");
  assert.match(sends[0].text, /owner pulled the emergency stop/, "T6e: pause reply includes the pause reason");
  ok("T6e: paused plain text creates no issue, no comment, no patch, no heartbeat; owner is told why");
}

// =====================================================================
// T6f: pause blocks APPROVE callback mutations but still answers the tap
// =====================================================================
async function t6f_pausedApproveCallbackBlockedAndAnswered() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const issue = makeIssue({ id: "iss-paused", identifier: "KOL-PAUSED", labelIds: ["lbl-OWNER_REQUIRED"] });
  const pause = makePausedState("maintenance window");

  const result = await processUpdateForCallback(makeCallbackUpdate(205, "a", "KOL-PAUSED"), makeProcessCtx(trace, {
    idMap: { "KOL-PAUSED": issue },
    _checkPause: async () => pause,
  }));

  assert.equal(result.outcome, "paused", "T6f: APPROVE callback returns paused outcome");
  assert.equal(result.action, "APPROVE", "T6f: callback action is still parsed");
  assert.equal(result.shortId, "KOL-PAUSED", "T6f: callback shortId is still parsed");
  assert.equal(trace.filter((e) => e.fn === "patchIssue").length, 0, "T6f: no patchIssue while paused");
  assert.equal(trace.filter((e) => e.fn === "postComment").length, 0, "T6f: no confirmation comment while paused");
  assert.equal(trace.filter((e) => e.fn === "httpPost").length, 0, "T6f: no POST while paused");
  assert.equal(spawnHeartbeatCalls.length, 0, "T6f: no heartbeat spawn while paused");
  const acks = trace.filter((e) => e.fn === "answerCallbackQuery");
  assert.equal(acks.length, 1, "T6f: callback tap is answered, not silently swallowed");
  assert.match(acks[0].text, /paused/i, "T6f: callback answer says paused");
  const sends = trace.filter((e) => e.fn === "sendMessage");
  assert.equal(sends.length, 1, "T6f: owner also receives the full pause message");
  assert.match(sends[0].text, /maintenance window/, "T6f: owner message includes pause reason");
  ok("T6f: paused APPROVE does not mutate Paperclip or spawn heartbeat, and the owner gets a visible pause response");
}

// =====================================================================
// T6g: paused /resume-shaped command still reaches _handleCommand
// =====================================================================
async function t6g_pausedResumeCommandStillRouted() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const pause = makePausedState("owner stop active");

  const result = await processUpdateForCallback(makeOwnerTextUpdate(206, "/resume"), makeProcessCtx(trace, {
    _checkPause: async () => pause,
    _handleCommand: async (text) => {
      trace.push({ fn: "handleCommand", text, t: trace.length });
      return { handled: true, reply: "resume route reached" };
    },
  }));

  assert.equal(result.outcome, "slash-command-handled", "T6g: /resume-shaped command is not blocked before command routing");
  assert.equal(trace.filter((e) => e.fn === "handleCommand").length, 1, "T6g: _handleCommand called while paused");
  assert.equal(trace.find((e) => e.fn === "handleCommand").text, "/resume", "T6g: raw /resume command reaches handler");
  const sends = trace.filter((e) => e.fn === "sendMessage");
  assert.equal(sends.length, 1, "T6g: command response is still sent while paused");
  assert.equal(sends[0].text, "resume route reached", "T6g: non-status command reply is not replaced by pause blocker");
  assert.equal(trace.filter((e) => e.fn === "httpPost").length, 0, "T6g: /resume-shaped command creates no issue");
  assert.equal(spawnHeartbeatCalls.length, 0, "T6g: /resume-shaped command does not spawn heartbeat");
  ok("T6g: paused /resume-shaped command reaches _handleCommand, so the stop cannot hide its own undo route");
}

// =====================================================================
// T6h: paused /status reply leads with pause state
// =====================================================================
async function t6h_pausedStatusReplyLeadsWithPause() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const pause = makePausedState("nightly freeze");
  const normalStatus = "*Status sistem*\nHeartbeat: 3/3 berhasil, baru saja";

  const result = await processUpdateForCallback(makeOwnerTextUpdate(207, "/status"), makeProcessCtx(trace, {
    _checkPause: async () => pause,
    _handleCommand: async (text) => {
      trace.push({ fn: "handleCommand", text, t: trace.length });
      return { handled: true, reply: normalStatus };
    },
  }));

  assert.equal(result.outcome, "slash-command-handled", "T6h: paused /status is still a handled command");
  const sends = trace.filter((e) => e.fn === "sendMessage");
  assert.equal(sends.length, 1, "T6h: exactly one status reply is sent");
  assert.ok(sends[0].text.startsWith("FounderOS PAUSED"), "T6h: reply leads with paused state");
  assert.match(sends[0].text.split("\n")[0], /nightly freeze/, "T6h: first line names the pause reason");
  assert.ok(sends[0].text.includes("\n\n" + normalStatus), "T6h: normal status content follows after pause lead");
  assert.equal(trace.filter((e) => e.fn === "httpPost").length, 0, "T6h: paused /status creates no issue");
  assert.equal(spawnHeartbeatCalls.length, 0, "T6h: paused /status does not spawn heartbeat");
  ok("T6h: paused /status sends the pause lead before the normal status content");
}

// =====================================================================
// T6i: unpaused text ingress still creates DIRECTIVE issue and wakes heartbeat
// =====================================================================
async function t6i_unpausedTextIngressStillWorks() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];

  const result = await processUpdateForCallback(makeOwnerTextUpdate(208, "Run the weekly receivables sweep"), makeProcessCtx(trace, {
    _checkPause: async () => ({ paused: false, reason: "", atIso: null, by: null }),
    _httpPost: async (url, body) => {
      trace.push({ fn: "httpPost", url, body, title: body.title, t: trace.length });
      return { status: 201, body: { id: "iss-directive", identifier: "KOL-DIRECTIVE" }, networkError: false };
    },
  }));

  assert.equal(result.outcome, "text-ingressed", "T6i: unpaused text ingress still succeeds");
  assert.equal(result.issueId, "iss-directive", "T6i: created issue id returned");
  assert.equal(result.identifier, "KOL-DIRECTIVE", "T6i: created issue identifier returned");
  const createCalls = trace.filter((e) => e.fn === "httpPost" && e.url.endsWith(`/companies/${COMPANY_ID}/issues`));
  assert.equal(createCalls.length, 1, "T6i: exactly one issue create POST");
  assert.match(createCalls[0].title, /^OWNER DIRECTIVE:/, "T6i: issue title is OWNER DIRECTIVE");
  const patches = trace.filter((e) => e.fn === "patchIssue");
  assert.equal(patches.length, 1, "T6i: exactly one patchIssue after creation");
  assert.equal(patches[0].issueId, "iss-directive", "T6i: patch targets created issue");
  assert.equal(patches[0].patch.status, "todo", "T6i: patch sets status todo");
  assert.equal(patches[0].patch.assigneeAgentId, AHMAD_AGENT_ID, "T6i: patch auto-assigns Ahmad");
  assert.deepEqual(patches[0].patch.labelIds, ["lbl-DIRECTIVE"], "T6i: patch applies DIRECTIVE and not OWNER_REQUIRED");
  const sends = trace.filter((e) => e.fn === "sendMessage");
  assert.equal(sends.length, 1, "T6i: exactly one ACK sent");
  assert.match(sends[0].text, /Received:/, "T6i: ACK confirms receipt");
  assert.match(sends[0].text, /Created KOL-DIRECTIVE/, "T6i: ACK names created issue");
  assert.equal(spawnHeartbeatCalls.length, 1, "T6i: heartbeat spawned exactly once on normal ingress");
  assert.deepEqual(spawnHeartbeatCalls[0].argv, ["ops-watcher/heartbeat.mjs", "--once"], "T6i: spawn argv is heartbeat --once");
  ok("T6i: unpaused text ingress still creates DIRECTIVE issue, auto-assigns, ACKs, and wakes heartbeat");
}

// =====================================================================
// T6j: real default pause check is imported and resolves
// =====================================================================
async function t6j_realDefaultPauseCheckResolves() {
  assert.equal(typeof checkPauseReal, "function", "T6j: checkPauseReal is imported from telegram-listener.mjs");
  const state = await checkPauseReal();
  assert.equal(typeof state, "object", "T6j: real default pause check returns an object");
  assert.equal(typeof state.paused, "boolean", "T6j: real default pause check returns paused boolean");
  assert.ok("reason" in state, "T6j: real default pause state includes reason");
  assert.ok("atIso" in state, "T6j: real default pause state includes atIso");
  assert.ok("by" in state, "T6j: real default pause state includes by");
  assert.equal(state.paused, false, "T6j: offline regression environment should not have ops-watcher/PAUSED set");
  ok("T6j: real default checkPauseReal is imported and resolves against the actual PAUSED default path");
}
// =====================================================================
// T7: APPROVE removes all buttons (edit called with removeKeyboard)
// =====================================================================
async function t7_approveRemovesButtons() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const issue = makeIssue({ id: "iss-1", identifier: "KOL-1", labelIds: ["lbl-OWNER_REQUIRED"] });
  const cq = { id: "cbq-1", data: "a:KOL-1", message: { message_id: 42, chat: { id: 8987077084 } }, from: { id: 8987077084 } };

  const result = await processUpdateForCallback(
    { update_id: 1, callback_query: cq },
    {
      base: "http://127.0.0.1:9999", companyId: COMPANY_ID,
      labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED" },
      idMap: { "KOL-1": issue }, upOpts: {},
      immediateAck: true,
      _get: async (url) => {
        if (url.includes("/comments")) return { networkError: false, status: 200, body: [] };
        if (url.includes("/issues/")) return { networkError: false, status: 200, body: issue };
        return { networkError: false, status: 200, body: [issue] };
      },
      _listLabels: async () => ({ labels: [], networkError: false }),
      _ensureLabel: async () => ({ id: "lbl-x" }),
      _postComment: async (b, id, body) => { trace.push({ fn: "postComment", body }); return { comment: { id: "c" }, status: 201, networkError: false }; },
      _patchIssue: async (b, id, patch) => { trace.push({ fn: "patchIssue", patch }); return { issue: { id }, status: 200, networkError: false }; },
      _answerCallbackQuery: async () => ({ sent: true, ok: true }),
      _editMessageText: async (msgId, text, opts) => { trace.push({ fn: "editMessageText", msgId, text, removeKeyboard: opts?.removeKeyboard, buttons: opts?.buttons }); return { sent: true, ok: true }; },
      _sendMessage: async () => ({ sent: true, ok: true }),
      _spawnHeartbeat: _spawnHeartbeatMock,
      _httpPost: async () => ({ status: 201, body: {}, networkError: false }),
      log: () => {}, now: Date.now, decisionDedupe: new Map(),
    },
  );

  assert.equal(result.outcome, "approved", "T7: outcome is approved");
  const edits = trace.filter((e) => e.fn === "editMessageText");
  assert.equal(edits.length, 1, "T7: exactly one editMessageText");
  assert.equal(edits[0].removeKeyboard, true, "T7: editMessageText called with removeKeyboard=true");
  assert.ok(!edits[0].buttons, "T7: no buttons passed (keyboard removed)");
  // FIX B: APPROVE triggers the event-driven wake spawn — verify the DI mock was
  // called (and NOT the real spawnHeartbeatReal).
  assert.equal(spawnHeartbeatCalls.length, 1, "T7: APPROVE path calls _spawnHeartbeat exactly once (DI'd, no real spawn)");
  assert.deepEqual(spawnHeartbeatCalls[0].argv, ["ops-watcher/heartbeat.mjs", "--once"], "T7: spawn argv is heartbeat --once");
  ok("T7: APPROVE removes all buttons via removeKeyboard; spawn DI'd (no real child)");
}

// =====================================================================
// T8: REJECT removes all buttons
// =====================================================================
async function t8_rejectRemovesButtons() {
  const trace = [];
  const issue = makeIssue({ id: "iss-1", identifier: "KOL-1", labelIds: ["lbl-OWNER_REQUIRED"] });
  const cq = { id: "cbq-1", data: "r:KOL-1", message: { message_id: 42, chat: { id: 8987077084 } }, from: { id: 8987077084 } };

  const result = await processUpdateForCallback(
    { update_id: 1, callback_query: cq },
    {
      base: "http://127.0.0.1:9999", companyId: COMPANY_ID,
      labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED", OWNER_REJECTED: "lbl-OWNER_REJECTED" },
      idMap: { "KOL-1": issue }, upOpts: {},
      immediateAck: true,
      _get: async (url) => {
        if (url.includes("/comments")) return { networkError: false, status: 200, body: [] };
        if (url.includes("/issues/")) return { networkError: false, status: 200, body: issue };
        return { networkError: false, status: 200, body: [issue] };
      },
      _listLabels: async () => ({ labels: [], networkError: false }),
      _ensureLabel: async () => ({ id: "lbl-x" }),
      _postComment: async (b, id, body) => { trace.push({ fn: "postComment", body }); return { comment: { id: "c" }, status: 201, networkError: false }; },
      _patchIssue: async (b, id, patch) => { trace.push({ fn: "patchIssue", patch }); return { issue: { id }, status: 200, networkError: false }; },
      _answerCallbackQuery: async () => ({ sent: true, ok: true }),
      _editMessageText: async (msgId, text, opts) => { trace.push({ fn: "editMessageText", removeKeyboard: opts?.removeKeyboard, buttons: opts?.buttons }); return { sent: true, ok: true }; },
      _sendMessage: async () => ({ sent: true, ok: true }),
      _spawnHeartbeat: _spawnHeartbeatMock,
      _httpPost: async () => ({ status: 201, body: {}, networkError: false }),
      log: () => {}, now: Date.now, decisionDedupe: new Map(),
    },
  );

  assert.equal(result.outcome, "rejected", "T8: outcome is rejected");
  const edits = trace.filter((e) => e.fn === "editMessageText");
  assert.equal(edits.length, 1, "T8: exactly one editMessageText");
  assert.equal(edits[0].removeKeyboard, true, "T8: editMessageText called with removeKeyboard=true");
  ok("T8: REJECT removes all buttons via removeKeyboard");
}

// =====================================================================
// T9: DEFER leaves only valid next actions (APPROVE/REJECT/DETAILS, no DEFER)
// =====================================================================
async function t9_deferKeepsValidButtons() {
  const trace = [];
  const issue = makeIssue({ id: "iss-1", identifier: "KOL-1", labelIds: ["lbl-OWNER_REQUIRED"] });
  const cq = { id: "cbq-1", data: "z:KOL-1", message: { message_id: 42, chat: { id: 8987077084 } }, from: { id: 8987077084 } };

  const result = await processUpdateForCallback(
    { update_id: 1, callback_query: cq },
    {
      base: "http://127.0.0.1:9999", companyId: COMPANY_ID,
      labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED" },
      idMap: { "KOL-1": issue }, upOpts: {},
      immediateAck: true,
      _get: async (url) => {
        if (url.includes("/comments")) return { networkError: false, status: 200, body: [] };
        if (url.includes("/issues/")) return { networkError: false, status: 200, body: issue };
        return { networkError: false, status: 200, body: [issue] };
      },
      _listLabels: async () => ({ labels: [], networkError: false }),
      _ensureLabel: async () => ({ id: "lbl-x" }),
      _postComment: async (b, id, body) => { trace.push({ fn: "postComment", body }); return { comment: { id: "c" }, status: 201, networkError: false }; },
      _patchIssue: async (b, id, patch) => { trace.push({ fn: "patchIssue", patch }); return { issue: { id }, status: 200, networkError: false }; },
      _answerCallbackQuery: async () => ({ sent: true, ok: true }),
      _editMessageText: async (msgId, text, opts) => { trace.push({ fn: "editMessageText", text, removeKeyboard: opts?.removeKeyboard, buttons: opts?.buttons }); return { sent: true, ok: true }; },
      _sendMessage: async () => ({ sent: true, ok: true }),
      _spawnHeartbeat: _spawnHeartbeatMock,
      _httpPost: async () => ({ status: 201, body: {}, networkError: false }),
      log: () => {}, now: Date.now, decisionDedupe: new Map(),
    },
  );

  assert.equal(result.outcome, "deferred", "T9: outcome is deferred");
  const edits = trace.filter((e) => e.fn === "editMessageText");
  assert.equal(edits.length, 1, "T9: exactly one editMessageText");
  assert.ok(edits[0].buttons, "T9: buttons passed (not removed)");
  assert.equal(edits[0].removeKeyboard, undefined, "T9: removeKeyboard not set");
  // Check the buttons: should have APPROVE, REJECT, DETAILS but NOT DEFER
  const btns = edits[0].buttons;
  const flatBtns = btns.map(row => row.map(b => b.text)).flat();
  assert.ok(flatBtns.includes("SETUJUI"), "T9: DEFER keeps APPROVE");
  assert.ok(flatBtns.includes("TOLAK"), "T9: DEFER keeps REJECT");
  assert.ok(flatBtns.includes("DETAIL"), "T9: DEFER keeps DETAILS");
  assert.ok(!flatBtns.includes("TUNDA"), "T9: DEFER removes DEFER button");
  ok("T9: DEFER leaves only APPROVE/REJECT/DETAILS (no DEFER)");
}

// =====================================================================
// T10: reply-to-decision-card note capture
// OWNER replies to a decision-card message -> the reply text is captured as a
// NOTE comment on the matched issue (no new issue, no patchIssue, no wake).
// Match is made by findIssueByTelegramMessageId scanning the [TELEGRAM SENT]
// marker comments for message_id=<reply target>.
// =====================================================================
async function t10_replyNoteAttached() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const decisionIssue = makeIssue({ id: "iss-dec", identifier: "KOL-42", labelIds: ["lbl-OWNER_REQUIRED"] });
  const replyUpdate = {
    update_id: 300,
    message: {
      message_id: 70,
      text: "Approve because the vendor confirmed pricing",
      chat: { id: 8987077084 },
      from: { id: 8987077084, first_name: "Aidit" },
      reply_to_message: { message_id: 4242, chat: { id: 8987077084 }, text: "decision card" },
    },
  };
  // _get routes: issues list returns [decisionIssue]; comments for iss-dec
  // return a [TELEGRAM SENT] marker with message_id=4242 (the reply target).
  const markerComment = {
    body: `[TELEGRAM SENT] message_id=4242 (2026-01-01T00:00:00.000Z) — owner decision requested via @ahmadsuperbot for KOL-42.`,
    authorType: "user",
  };
  let postedNote = null;
  const _get = async (url) => {
    trace.push({ fn: "get", url });
    if (url.endsWith(`/companies/${COMPANY_ID}/issues`)) return { networkError: false, status: 200, body: [decisionIssue] };
    if (url.endsWith(`/api/issues/iss-dec/comments`)) return { networkError: false, status: 200, body: [markerComment] };
    return { networkError: false, status: 200, body: [] };
  };
  const result = await processUpdateForCallback(replyUpdate, {
    base: "http://127.0.0.1:9999", companyId: COMPANY_ID,
    labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED", DIRECTIVE: "lbl-DIRECTIVE" },
    idMap: {}, upOpts: {}, immediateAck: true,
    _get,
    _listLabels: async () => ({ labels: [], networkError: false }),
    _ensureLabel: async () => ({ id: "lbl-x" }),
    _postComment: async (b, issueId, body) => { postedNote = { issueId, body }; trace.push({ fn: "postComment", issueId, body }); return { comment: { id: "c" }, status: 201, networkError: false }; },
    _patchIssue: async () => { trace.push({ fn: "patchIssue" }); return { issue: {}, status: 200, networkError: false }; },
    _answerCallbackQuery: async () => ({ sent: true, ok: true }),
    _editMessageText: async () => ({ sent: true, ok: true }),
    _sendMessage: async (text) => { trace.push({ fn: "sendMessage", text }); return { sent: true, ok: true, status: 200 }; },
    _spawnHeartbeat: _spawnHeartbeatMock,
    _httpPost: async () => { trace.push({ fn: "httpPost" }); return { status: 201, body: {}, networkError: false }; },
    log: () => {}, now: Date.now, decisionDedupe: new Map(),
  });

  assert.equal(result.outcome, "reply-note-attached", "T10: outcome is reply-note-attached");
  assert.equal(result.issueId, "iss-dec", "T10: note attached to the matched decision issue");
  assert.equal(result.identifier, "KOL-42", "T10: identifier returned");
  // The note comment was posted with the reply text.
  assert.equal(trace.filter((e) => e.fn === "postComment").length, 1, "T10: exactly one note comment posted");
  assert.ok(postedNote, "T10: note captured");
  assert.match(postedNote.body, /OWNER NOTE via Telegram reply/, "T10: note body has the OWNER NOTE prefix");
  assert.match(postedNote.body, /decision card for KOL-42/, "T10: note body names the target issue");
  assert.match(postedNote.body, /Approve because the vendor confirmed pricing/, "T10: note body includes the OWNER's reply text verbatim");
  assert.equal(postedNote.issueId, "iss-dec", "T10: comment posted on the matched issue");
  // NO new directive issue, NO patch, NO wake.
  assert.equal(trace.filter((e) => e.fn === "httpPost").length, 0, "T10: no new issue created (no httpPost)");
  assert.equal(trace.filter((e) => e.fn === "patchIssue").length, 0, "T10: no patchIssue (note does not change state)");
  assert.equal(spawnHeartbeatCalls.length, 0, "T10: no heartbeat spawn (a note does not wake the pipeline)");
  // ACK sent to owner.
  const sends = trace.filter((e) => e.fn === "sendMessage");
  assert.equal(sends.length, 1, "T10: exactly one ACK sendMessage");
  assert.match(sends[0].text, /Note attached to KOL-42/, "T10: ACK mentions the issue");
  ok("T10: reply to decision card -> note attached as Paperclip comment; no new issue; no patch; no spawn; ACK sent");
}

// =====================================================================
// T10b: reply-to a NON-decision message (no matching marker) falls through to
// directive creation, so the OWNER's text is never lost.
// =====================================================================
async function t10b_replyNoMatchFallsThroughToDirective() {
  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const otherIssue = makeIssue({ id: "iss-other", identifier: "KOL-7" });
  const replyUpdate = {
    update_id: 301,
    message: {
      message_id: 71,
      text: "Do the thing",
      chat: { id: 8987077084 },
      from: { id: 8987077084 },
      reply_to_message: { message_id: 9999, chat: { id: 8987077084 }, text: "old message" },
    },
  };
  // The only marker present records message_id=1234 (NOT 9999), so no match.
  const markerComment = {
    body: `[TELEGRAM SENT] message_id=1234 (x) — owner decision requested via @ahmadsuperbot for KOL-7.`,
    authorType: "user",
  };
  const _get = async (url) => {
    if (url.endsWith(`/companies/${COMPANY_ID}/issues`)) return { networkError: false, status: 200, body: [otherIssue] };
    if (url.endsWith(`/api/issues/iss-other/comments`)) return { networkError: false, status: 200, body: [markerComment] };
    return { networkError: false, status: 200, body: [] };
  };
  const result = await processUpdateForCallback(replyUpdate, {
    base: "http://127.0.0.1:9999", companyId: COMPANY_ID,
    labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED", DIRECTIVE: "lbl-DIRECTIVE" },
    idMap: {}, upOpts: {}, immediateAck: true,
    _get,
    _listLabels: async () => ({ labels: [], networkError: false }),
    _ensureLabel: async (b, c, name) => ({ id: "lbl-" + name, created: true, networkError: false }),
    _postComment: async () => { trace.push({ fn: "postComment" }); return { comment: { id: "c" }, status: 201, networkError: false }; },
    _patchIssue: async (b, id, patch) => { trace.push({ fn: "patchIssue", patch }); return { issue: { id }, status: 200, networkError: false }; },
    _answerCallbackQuery: async () => ({ sent: true, ok: true }),
    _editMessageText: async () => ({ sent: true, ok: true }),
    _sendMessage: async (text) => { trace.push({ fn: "sendMessage", text }); return { sent: true, ok: true, status: 200 }; },
    _spawnHeartbeat: _spawnHeartbeatMock,
    _httpPost: async (url, body) => { trace.push({ fn: "httpPost", title: body.title }); return { status: 201, body: { id: "iss-new", identifier: "KOL-99" }, networkError: false }; },
    log: () => {}, now: Date.now, decisionDedupe: new Map(),
  });

  assert.equal(result.outcome, "text-ingressed", "T10b: falls through to directive when reply target is not a known decision card");
  assert.equal(result.identifier, "KOL-99", "T10b: directive issue created");
  assert.equal(trace.filter((e) => e.fn === "httpPost").length, 1, "T10b: directive issue created via httpPost");
  assert.equal(spawnHeartbeatCalls.length, 1, "T10b: directive path wakes the pipeline");
  ok("T10b: reply to a non-decision message falls through to directive creation (text never lost)");
}

// =====================================================================
// T10c: note-match scan network error -> safe fallthrough to directive (no crash)
// =====================================================================
async function t10c_scanNetworkErrorFallsThrough() {
  spawnHeartbeatCalls.length = 0;
  const replyUpdate = {
    update_id: 302,
    message: {
      message_id: 72,
      text: "note",
      chat: { id: 8987077084 },
      from: { id: 8987077084 },
      reply_to_message: { message_id: 4242, chat: { id: 8987077084 } },
    },
  };
  // _get always returns a network error -> findIssueByTelegramMessageId returns
  // null -> the reply falls through to directive creation (safe; no throw).
  const _get = async () => ({ networkError: true, networkErrorMessage: "Paperclip down" });
  let httpPostCalled = false;
  const result = await processUpdateForCallback(replyUpdate, {
    base: "http://127.0.0.1:9999", companyId: COMPANY_ID,
    labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED", DIRECTIVE: "lbl-DIRECTIVE" },
    idMap: {}, upOpts: {}, immediateAck: true,
    _get,
    _listLabels: async () => ({ labels: [], networkError: false }),
    _ensureLabel: async (b, c, name) => ({ id: "lbl-" + name, created: true }),
    _postComment: async () => ({ comment: { id: "c" }, status: 201, networkError: false }),
    _patchIssue: async () => ({ issue: {}, status: 200, networkError: false }),
    _answerCallbackQuery: async () => ({ sent: true, ok: true }),
    _editMessageText: async () => ({ sent: true, ok: true }),
    _sendMessage: async () => ({ sent: true, ok: true }),
    _spawnHeartbeat: _spawnHeartbeatMock,
    _httpPost: async () => { httpPostCalled = true; return { status: 201, body: { id: "iss-new", identifier: "KOL-99" }, networkError: false }; },
    log: () => {}, now: Date.now, decisionDedupe: new Map(),
  });

  assert.equal(result.outcome, "text-ingressed", "T10c: scan network error -> safe fallthrough to directive (no crash)");
  assert.ok(httpPostCalled, "T10c: directive path executed (text not lost)");
  ok("T10c: note-match scan network error -> safe fallthrough to directive, no crash");
}

// =====================================================================
// T10d: findIssueByTelegramMessageId unit (match / no-match / network error)
// =====================================================================
async function t10d_findIssueByTelegramMessageIdUnit() {
  const issueA = makeIssue({ id: "iss-A", identifier: "KOL-1" });
  const issueB = makeIssue({ id: "iss-B", identifier: "KOL-2" });
  const markerA = { body: `[TELEGRAM SENT] message_id=4242 (x) — for KOL-1.` };
  const markerB = { body: `[TELEGRAM SENT] message_id=5555 (x) — for KOL-2.` };

  // Match: scanning returns the issue whose marker matches the target message_id.
  const _getMatch = async (url) => {
    if (url.endsWith(`/companies/${COMPANY_ID}/issues`)) return { networkError: false, status: 200, body: [issueA, issueB] };
    if (url.endsWith(`/api/issues/iss-A/comments`)) return { networkError: false, status: 200, body: [markerA] };
    if (url.endsWith(`/api/issues/iss-B/comments`)) return { networkError: false, status: 200, body: [markerB] };
    return { networkError: false, status: 200, body: [] };
  };
  const found = await findIssueByTelegramMessageId("http://x", COMPANY_ID, _getMatch, 4242);
  assert.ok(found, "T10d: match returns an issue");
  assert.equal(found.id, "iss-A", "T10d: matched the right issue (marker message_id=4242)");

  // No match: no marker carries the target message_id.
  const notFound = await findIssueByTelegramMessageId("http://x", COMPANY_ID, _getMatch, 9999);
  assert.equal(notFound, null, "T10d: no match returns null");

  // Network error on the issues list -> returns null (no throw).
  const _getNetErr = async () => ({ networkError: true, networkErrorMessage: "down" });
  const netErr = await findIssueByTelegramMessageId("http://x", COMPANY_ID, _getNetErr, 4242);
  assert.equal(netErr, null, "T10d: network error returns null (no throw)");

  // Missing/invalid message_id -> returns null without any fetch.
  let fetchCount = 0;
  const _getCount = async () => { fetchCount++; return { networkError: false, status: 200, body: [] }; };
  const invalid = await findIssueByTelegramMessageId("http://x", COMPANY_ID, _getCount, null);
  assert.equal(invalid, null, "T10d: null message_id returns null");
  assert.equal(fetchCount, 0, "T10d: null message_id does not fetch");

  ok("T10d: findIssueByTelegramMessageId unit — match / no-match / network error / invalid id");
}

// =====================================================================
// runner
// =====================================================================
// =====================================================================
// T11: an APPROVE names the option it accepted
// Six issues were approved on 2026-09-05 and the confirmation comment on
// each says only that approval happened. Which option the owner accepted
// had to be reconstructed by hand from the brief.
// =====================================================================
async function t11_approveNamesTheAcceptedOption() {
  const brief = {
    pertanyaan: "Notion mau dipakai untuk apa?",
    pilihan: [
      { key: "permukaan_baca", label: "Permukaan baca di luar Telegram" },
      { key: "learning_os_saja", label: "Khusus Learning OS saja" },
    ],
    rekomendasi: { pilihan: "learning_os_saja", alasan: "cakupan sempit bisa dinilai" },
  };
  assert.match(acceptedOptionSuffix(brief), /Khusus Learning OS saja/, "T11: the suffix names the accepted label");
  assert.match(acceptedOptionSuffix(brief), /learning_os_saja/, "T11: the suffix carries the option key");
  assert.equal(acceptedOptionSuffix({ pilihan: [] }), "", "T11: no recommendation -> no suffix");
  assert.equal(acceptedOptionSuffix(null), "", "T11: no brief -> no suffix, never a throw");
  assert.match(acceptedOptionSuffix({ rekomendasi: { pilihan: "cabut" }, pilihan: [] }), /cabut/,
    "T11: a key with no matching option still gets recorded");

  spawnHeartbeatCalls.length = 0;
  const trace = [];
  const issue = makeIssue({ id: "iss-11", identifier: "KOL-11", labelIds: ["lbl-OWNER_REQUIRED"] });
  const briefComment = { id: "c-brief", body: `[DECISION BRIEF] ${JSON.stringify({ decision_brief: {
    pertanyaan: "Notion sudah punya kode dan kredensial, Anda ingin dipakai untuk apa?",
    yang_sudah_ada: [{ kutipan: "Kode sinkronisasi Notion sudah ada di ops-watcher.", sumber: "ops-watcher/learning-os-notion-sync.mjs" }],
    pilihan: [
      { key: "permukaan_baca", label: "Permukaan baca di luar Telegram", konsekuensi: "Satu tempat lagi yang harus dijaga sinkron." },
      { key: "learning_os_saja", label: "Khusus Learning OS saja", konsekuensi: "Cakupannya sempit dan bisa dinilai berguna atau tidak." },
    ],
    rekomendasi: { pilihan: "learning_os_saja", alasan: "Cakupan sempit membuat integrasi ini bisa dinilai berguna atau tidak." },
    kalau_didiamkan: "Kredensial Notion tetap ada di mesin tanpa pemakai yang jelas.",
  } })}`, createdAt: "2026-09-05T10:00:00.000Z" };

  const result = await processUpdateForCallback(
    { update_id: 11, callback_query: { id: "cbq-11", data: "a:KOL-11", message: { message_id: 111, chat: { id: 8987077084 } }, from: { id: 8987077084 } } },
    {
      base: "http://127.0.0.1:9999", companyId: COMPANY_ID,
      labelMap: { OWNER_REQUIRED: "lbl-OWNER_REQUIRED" },
      idMap: { "KOL-11": issue }, upOpts: {},
      immediateAck: true,
      _get: async (url) => {
        if (url.includes("/comments")) return { networkError: false, status: 200, body: [briefComment] };
        if (url.includes("/issues/")) return { networkError: false, status: 200, body: issue };
        return { networkError: false, status: 200, body: [issue] };
      },
      _listLabels: async () => ({ labels: [], networkError: false }),
      _ensureLabel: async () => ({ id: "lbl-x" }),
      _postComment: async (b, id, body) => { trace.push({ fn: "postComment", body }); return { comment: { id: "c" }, status: 201, networkError: false }; },
      _patchIssue: async () => ({ issue: {}, status: 200, networkError: false }),
      _answerCallbackQuery: async () => ({ sent: true, ok: true }),
      _editMessageText: async () => ({ sent: true, ok: true }),
      _sendMessage: async () => ({ sent: true, ok: true }),
      _spawnHeartbeat: _spawnHeartbeatMock,
      _httpPost: async () => ({ status: 201, body: {}, networkError: false }),
      log: () => {}, now: Date.now, decisionDedupe: new Map(),
    },
  );

  assert.equal(result.outcome, "approved", "T11: still approves");
  const approval = trace.find((e) => e.fn === "postComment" && /OWNER MENYETUJUI/.test(e.body));
  assert.ok(approval, "T11: an approval comment was posted");
  assert.match(approval.body, /Khusus Learning OS saja/, "T11: the posted comment names the accepted option");
  ok("T11: an APPROVE records WHICH option it accepted, not only that approval happened");
}

const tests = [
  ["T1", t1_immediateAckOrdering],
  ["T2", t2_backoff],
  ["T3a", t3a_lockRefuseAlive],
  ["T3b", t3b_staleLockRecovery],
  ["T3c", t3c_realPidCheck],
  ["T3d", t3d_acquireLockClean],
  ["T3e", t3e_acquireLockStaleRewrite],
  ["T4", t4_dedupeRepeatApprove],
  ["T4b", t4b_dedupeNegative],
  ["T4c", t4c_dedupeWindow],
  ["T4d", t4d_dedupeDoesNotAssumeNewestIsLast],
  ["T5", t5_offsetAdvanceBatch],
  ["T6", t6_textIngress],
  ["T6b", t6b_nonOwnerTextSkipped],
  ["T6c", t6c_statusCommandRoutedToHandleCommand],
  ["T6d", t6d_unknownCommandFallsBack],
  ["T6e", t6e_pausedPlainTextBlocked],
  ["T6f", t6f_pausedApproveCallbackBlockedAndAnswered],
  ["T6g", t6g_pausedResumeCommandStillRouted],
  ["T6h", t6h_pausedStatusReplyLeadsWithPause],
  ["T6i", t6i_unpausedTextIngressStillWorks],
  ["T6j", t6j_realDefaultPauseCheckResolves],
  ["T7", t7_approveRemovesButtons],
  ["T8", t8_rejectRemovesButtons],
  ["T9", t9_deferKeepsValidButtons],
  ["T10", t10_replyNoteAttached],
  ["T10b", t10b_replyNoMatchFallsThroughToDirective],
  ["T10c", t10c_scanNetworkErrorFallsThrough],
  ["T10d", t10d_findIssueByTelegramMessageIdUnit],
  ["T11", t11_approveNamesTheAcceptedOption],
];

for (const [name, fn] of tests) {
  try {
    await fn();
  } catch (e) {
    bad(name, e);
  }
}

try { await fs.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

console.log("");
console.log(`TELEGRAM-LISTENER-DAEMON REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;