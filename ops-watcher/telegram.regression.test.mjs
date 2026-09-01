// ops-watcher/telegram.regression.test.mjs
// Offline regression tests for the Telegram OWNER control plane
// (telegram-client + telegram-notify + telegram-listener). No real network and
// no real credential: Telegram is mocked with a local node:http server reached
// via the telegram-client `baseUrl` test seam, and a FAKE token is injected
// through process.env.TELEGRAM_BOT_TOKEN_AHMAD. Paperclip is mocked with a
// second local node:http server (same pattern as the rest of ops-watcher).
//
//   node ops-watcher/telegram.regression.test.mjs
//
// SECURITY NOTE: this test EXPLICITLY overrides process.env.TELEGRAM_BOT_TOKEN_AHMAD
// with a fake value for its entire run (restored on exit), so even if a real
// token is present in the environment it is never used and never sent anywhere.
//
// Covers:
//   - telegram-notify: sends for an OWNER_REQUIRED issue w/o marker, skips one
//     that already has the "[TELEGRAM SENT]" marker, posts the marker comment.
//   - telegram-listener: each of the 5 callback actions (APPROVE/REJECT/DETAILS/
//     DEFER/ASK AHMAD) produces the correct Paperclip state change.
//   - offset-based dedupe: a second listener run with the persisted offset does
//     NOT reprocess the same update.
//   - Telegram API failure (network error / non-200) does not crash notify or
//     listener.
//   - PATCH FAILURE IS NOT FALSIFIED AS SUCCESS (P0 fix): if patchIssue returns
//     networkError or a non-2xx, the listener must NOT post the "flow may resume"
//     success comment / toast / edit; it must record a failure comment, edit the
//     message to "apply failed", and the update is STILL consumed (offset
//     advances — never wedges the queue, never duplicates on a second run).
//   - STATE-FILE PERSISTENCE IS NON-SILENT (P0 fix): a write failure is surfaced
//     as persistError + an ERROR log; a corrupt (non-ENOENT) read is surfaced as
//     a WARN log; a plain missing file (ENOENT) stays silent (first run).

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  sendMessage, answerCallbackQuery, editMessageText, getUpdates, tokenStatus, redact,
} from "./telegram-client.mjs";
import { runNotifyOnce } from "./telegram-notify.mjs";
import { runListenerOnce, parseCallbackData, processUpdateForCallback } from "./telegram-listener.mjs";
import {
  buildDecisionOptionsCommentBody,
  parseDecisionOptionsFromComments,
  DECISION_OPTIONS_MARKER,
} from "./telegram-decision-options.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Fake token — realistic shape (9 digits, colon, ~35 alnum/_ chars). NEVER a real
// credential. The redact() regex covers 30-64 chars after the colon.
const FAKE_TOKEN = "999999999:AAAtest_fake_token_for_regression_only_xx";
const COMPANY = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const OWNER_REQUIRED_LABEL_ID = "lbl-OR";
const OWNER_REJECTED_LABEL_ID = "lbl-ORJ";
const ESCALATED_LABEL_ID = "lbl-ESC";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`  ${e && e.stack ? e.stack : e}`); failures.push(n); failed++; };

// ---- mock Telegram API (local node:http) ----
function mockTelegram({ updatesByOffset = () => [], failGetUpdates = false, failSend = false } = {}) {
  const calls = { sendMessage: [], answerCallbackQuery: [], editMessageText: [], getUpdates: [] };
  let nextMsgId = 1000;
  const server = http.createServer((req, res) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      let body = null;
      try { body = JSON.parse(buf || "{}"); } catch { /* ignore */ }
      const url = req.url || "";
      const respond = (code, obj) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(obj));
      };
      if (failGetUpdates && url.endsWith("/getUpdates")) return respond(500, { ok: false, description: "internal" });
      if (failSend && url.endsWith("/sendMessage")) return respond(400, { ok: false, description: "bad request" });
      if (url.endsWith("/sendMessage")) {
        calls.sendMessage.push(body);
        return respond(200, { ok: true, result: { message_id: nextMsgId++, date: 1, chat: { id: 8987077084 }, text: body.text } });
      }
      if (url.endsWith("/answerCallbackQuery")) {
        calls.answerCallbackQuery.push(body);
        return respond(200, { ok: true, result: true });
      }
      if (url.endsWith("/editMessageText")) {
        calls.editMessageText.push(body);
        return respond(200, { ok: true, result: { message_id: body.message_id, edit_date: 2 } });
      }
      if (url.endsWith("/getUpdates")) {
        calls.getUpdates.push(body);
        const offset = Number(body.offset || 0);
        return respond(200, { ok: true, result: updatesByOffset(offset) });
      }
      respond(404, { ok: false, description: "unknown method" });
    });
  });
  const start = () => new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      port: server.address().port,
      base: `http://127.0.0.1:${server.address().port}/bot`,
      calls,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
  return { start, calls };
}

// ---- mock Paperclip (local node:http) ----
// seed extra knobs (used by the PATCH-failure tests):
//   seed.patchNetworkError: true  -> PATCH destroys the socket (-> networkError)
//   seed.patchStatus: <number>     -> PATCH returns that HTTP status (non-2xx)
function mockPaperclip(seed) {
  const labels = (seed && seed.labels ? seed.labels.slice() : []);
  let nextLabelId = 1;
  const issues = {};
  const comments = {};
  const patchLog = [];
  const patchNetworkError = !!(seed && seed.patchNetworkError);
  const patchStatus = (seed && seed.patchStatus) || 0;
  if (seed && seed.issues) for (const it of seed.issues) { issues[it.id] = JSON.parse(JSON.stringify(it)); comments[it.id] = []; }
  if (seed && seed.comments) for (const [id, arr] of Object.entries(seed.comments)) comments[id] = arr.slice();

  const server = http.createServer((req, res) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      let body = null;
      try { body = JSON.parse(buf || "{}"); } catch { /* ignore */ }
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      const send = (code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(obj)); };

      if (req.method === "GET" && p === `/api/companies/${COMPANY}/labels`) return send(200, labels);
      if (req.method === "POST" && p === `/api/companies/${COMPANY}/labels`) {
        if (labels.some((l) => l.name.toUpperCase() === String(body.name).toUpperCase()))
          return send(201, labels.find((l) => l.name.toUpperCase() === String(body.name).toUpperCase()));
        const made = { id: `lbl-${nextLabelId++}`, name: body.name, color: body.color };
        labels.push(made); return send(201, made);
      }
      if (req.method === "GET" && p === `/api/companies/${COMPANY}/issues`) return send(200, Object.values(issues));
      const single = p.match(/^\/api\/issues\/([^/]+)$/);
      if (req.method === "GET" && single) {
        const it = issues[single[1]];
        return it ? send(200, it) : send(404, { error: "not found" });
      }
      if (req.method === "PATCH" && single) {
        // Failure simulation (the canonical state-change call). Destroy the
        // socket for "network error", or return a chosen non-2xx status. The
        // patchLog must NOT record a mutation in either case (none happened).
        if (patchNetworkError) { res.destroy(); return; }
        if (patchStatus) return send(patchStatus, { error: "simulated patch failure" });
        const it = issues[single[1]];
        if (!it) return send(404, { error: "not found" });
        if (body.status) it.status = body.status;
        if (Array.isArray(body.labelIds)) it.labelIds = body.labelIds.slice();
        if (body.assigneeAgentId !== undefined) it.assigneeAgentId = body.assigneeAgentId;
        patchLog.push({ issueId: single[1], body: JSON.parse(JSON.stringify(body)) });
        return send(200, JSON.parse(JSON.stringify(it)));
      }
      const cm = p.match(/^\/api\/issues\/([^/]+)\/comments$/);
      if (req.method === "GET" && cm) return send(200, comments[cm[1]] || []);
      if (req.method === "POST" && cm) {
        const arr = comments[cm[1]] || (comments[cm[1]] = []);
        const c = { id: `c-${arr.length + 1}-${Date.now()}`, body: body.body, authorType: body.authorType || "user", authorUserId: "local-board", authorAgentId: null };
        arr.push(c);
        return send(201, c);
      }
      send(404, { error: "not found mock" });
    });
  });
  const start = () => new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      base: `http://127.0.0.1:${server.address().port}`,
      labels, issues, comments, patchLog,
      close: () => new Promise((r) => server.close(() => r())),
    }));
  });
  return { start };
}

// An OWNER_REQUIRED issue. The issue CARRIES the OWNER_REQUIRED label (labelIds +
// labels.name) so telegram-notify's hasOwnerRequired check is true. Optional
// extra label ids can be appended.
// NOTE: issues never carry a `metadata` field here (real Paperclip issues
// don't have one — see telegram-decision-options.mjs). Dynamic decision
// options are seeded as a "[DECISION OPTIONS]" marker COMMENT instead, via
// decisionOptionsCommentBody, matching how the real system actually works.
function ownerRequiredIssue({ id, identifier, title = "SELFTEST demo", description = "decide please", extraLabelIds = [], marker = false, decisionOptionsCommentBody = undefined }) {
  const labelIds = [OWNER_REQUIRED_LABEL_ID, ...extraLabelIds];
  const labels = [
    { id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED" },
    ...extraLabelIds.map((lid) => ({ id: lid, name: lid === OWNER_REJECTED_LABEL_ID ? "OWNER_REJECTED" : lid === ESCALATED_LABEL_ID ? "ESCALATED_TO_AHMAD" : "EXTRA" })),
  ];
  const issue = { id, identifier, companyId: COMPANY, status: "todo", title, description, labelIds, labels };
  const commentList = [];
  if (decisionOptionsCommentBody !== undefined) {
    commentList.push({ id: "c-decision-options", body: decisionOptionsCommentBody, authorType: "user" });
  }
  if (marker) {
    commentList.push({ id: "c-marker", body: `[TELEGRAM SENT] message_id=999 (x) — owner decision requested via @ahmadsuperbot for ${identifier}.`, authorType: "user" });
  }
  return {
    issue,
    comments: { [id]: commentList },
  };
}

function cbqUpdate(updateId, actionLetter, shortId, messageId) {
  return cbqDataUpdate(updateId, `${actionLetter}:${shortId}`, messageId);
}

function cbqDataUpdate(updateId, data, messageId) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cbq-${updateId}`,
      from: { id: 8987077084, is_bot: false, first_name: "Owner" },
      message: { message_id: messageId, date: 1, chat: { id: 8987077084 }, text: "x" },
      data,
    },
  };
}

function textUpdate(updateId, text, chatId = 8987077084) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 100,
      text,
      chat: { id: chatId },
      from: { id: chatId, first_name: chatId === 8987077084 ? "Owner" : "Stranger" },
    },
  };
}

function commandCtx(overrides = {}) {
  const calls = { sendMessage: [], httpPost: [], patchIssue: [] };
  return {
    calls,
    ctx: {
      base: "http://127.0.0.1:9999",
      companyId: COMPANY,
      labelMap: { OWNER_REQUIRED: OWNER_REQUIRED_LABEL_ID, DIRECTIVE: "lbl-DIRECTIVE" },
      idMap: {},
      upOpts: {},
      immediateAck: true,
      _get: async () => ({ networkError: false, status: 200, body: [] }),
      _listLabels: async () => ({ labels: [], networkError: false }),
      _ensureLabel: async (base, companyId, name) => ({ id: `lbl-${name}`, created: false, networkError: false }),
      _postComment: async () => ({ comment: { id: "c" }, status: 201, networkError: false }),
      _patchIssue: async (base, issueId, patch) => { calls.patchIssue.push({ issueId, patch }); return { issue: { id: issueId }, status: 200, networkError: false }; },
      _answerCallbackQuery: async () => ({ sent: true, ok: true }),
      _editMessageText: async () => ({ sent: true, ok: true }),
      _sendMessage: async (text, opts) => { calls.sendMessage.push({ text, opts }); return { sent: true, ok: true, status: 200 }; },
      _spawnHeartbeat: () => ({ pid: 0 }),
      _httpPost: async (url, body) => { calls.httpPost.push({ url, body }); return { status: 201, body: { id: "iss-new", identifier: "KOL-NEW" }, networkError: false }; },
      log: () => {},
      now: () => 1800000000000,
      decisionDedupe: new Map(),
      ...overrides,
    },
  };
}

// Run one listener action against fresh mocks; returns result + recorded calls.
// opts.patchNetworkError / opts.patchStatus simulate a failing canonical PATCH.
async function runOneAction(actionLetter, opts = {}) {
  const id = "iss-X";
  const shortId = "KOL-95";
  const seed = ownerRequiredIssue({ id, identifier: shortId, title: "decision target" });
  const update = cbqUpdate(5001, actionLetter, shortId, 4242);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 5001 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({
    issues: [seed.issue], comments: seed.comments,
    labels: [
      { id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" },
      { id: OWNER_REJECTED_LABEL_ID, name: "OWNER_REJECTED", color: "#7f1d1d" },
      { id: ESCALATED_LABEL_ID, name: "ESCALATED_TO_AHMAD", color: "#9333ea" },
    ],
    patchNetworkError: opts.patchNetworkError,
    patchStatus: opts.patchStatus,
  });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-state-${actionLetter}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  let result;
  try {
    result = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
  } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
  }
  await tgS.close();
  await pcS.close();
  return { result, tgCalls: tgS.calls, pc: { issues: pcS.issues, comments: pcS.comments, patchLog: pcS.patchLog } };
}

async function testTokenStatusNoLeak() {
  const name = "(0) tokenStatus + redact never leak the token value";
  try {
    const ts = tokenStatus();
    assert.equal(ts.present, true); // FAKE_TOKEN is set globally for the run
    assert.ok(!JSON.stringify(ts).includes(FAKE_TOKEN));
    assert.equal(redact(`x ${FAKE_TOKEN} y`), "x [REDACTED_TOKEN] y");
    // missing-token path
    const saved = process.env.TELEGRAM_BOT_TOKEN_AHMAD;
    process.env.TELEGRAM_BOT_TOKEN_AHMAD = "";
    try {
      const ts2 = tokenStatus();
      assert.equal(ts2.present, false);
      const s = await sendMessage("hi", { baseUrl: "http://127.0.0.1:9/bot", timeoutMs: 200 });
      assert.equal(s.sent, false);
      assert.equal(s.reason, "TELEGRAM_BOT_TOKEN_AHMAD not set");
    } finally { process.env.TELEGRAM_BOT_TOKEN_AHMAD = saved; }
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testNotifySendsAndMarks() {
  const name = "(1) telegram-notify: sends for OWNER_REQUIRED w/o marker, posts marker, skips already-sent";
  const seed1 = ownerRequiredIssue({ id: "iss-A", identifier: "KOL-91" });
  const seed2 = ownerRequiredIssue({ id: "iss-B", identifier: "KOL-92", marker: true });
  const tg = mockTelegram();
  const tgS = await tg.start();
  const pc = mockPaperclip({
    issues: [seed1.issue, seed2.issue],
    comments: { ...seed1.comments, ...seed2.comments },
    labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" }],
  });
  const pcS = await pc.start();
  try {
    const r = await runNotifyOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, log: () => {} });
    assert.equal(r.error, undefined);
    const sentA = r.results.find((x) => x.identifier === "KOL-91");
    const sentB = r.results.find((x) => x.identifier === "KOL-92");
    assert.ok(sentA && sentA.outcome === "sent", "KOL-91 should be sent");
    assert.ok(sentA.message_id >= 1000, "sent issue has a real message_id");
    assert.ok(sentB && sentB.outcome === "already-sent", "KOL-92 (has marker) should be skipped");
    assert.equal(tgS.calls.sendMessage.length, 1, "exactly one sendMessage");
    const kb = tgS.calls.sendMessage[0].reply_markup.inline_keyboard;
    assert.equal(kb.length, 4, "four buttons (ASK AHMAD removed)");
    const datas = kb.map((row) => row[0].callback_data).sort();
    assert.deepEqual(datas, ["a:KOL-91", "d:KOL-91", "r:KOL-91", "z:KOL-91"].sort());
    const markerComments = pcS.comments["iss-A"].filter((c) => c.body.startsWith("[TELEGRAM SENT]"));
    assert.equal(markerComments.length, 1, "marker landed on iss-A");
    assert.ok(markerComments[0].body.includes(`message_id=${sentA.message_id}`));
    // iss-B was seeded WITH a marker (that's why it's "already-sent"); it must
    // keep exactly that one marker and gain NO new one (no double-send).
    const markersB = pcS.comments["iss-B"].filter((c) => c.body.startsWith("[TELEGRAM SENT]"));
    assert.equal(markersB.length, 1, "iss-B keeps only its original marker (no new one added)");
    assert.equal(markersB[0].body.includes("message_id=999"), true, "iss-B marker is the original seeded one");
    ok(name);
  } catch (e) { bad(name, e); } finally { await tgS.close(); await pcS.close(); }
}

async function testNotifyTelegramFailureNoCrash() {
  const name = "(2) telegram-notify: Telegram API failure does not crash; no marker posted (so it can retry)";
  const seed = ownerRequiredIssue({ id: "iss-F", identifier: "KOL-93" });
  const tg = mockTelegram({ failSend: true });
  const tgS = await tg.start();
  const pc = mockPaperclip({ issues: [seed.issue], comments: seed.comments, labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED" }] });
  const pcS = await pc.start();
  try {
    const r = await runNotifyOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, log: () => {} });
    const f = r.results.find((x) => x.identifier === "KOL-93");
    assert.ok(f && f.outcome === "send-failed", "send should fail cleanly");
    assert.equal(pcS.comments["iss-F"].filter((c) => c.body.startsWith("[TELEGRAM SENT]")).length, 0, "no marker posted on failed send");
    ok(name);
  } catch (e) { bad(name, e); } finally { await tgS.close(); await pcS.close(); }
}

async function testApprove() {
  const name = "(3) APPROVE removes OWNER_REQUIRED, posts comment, edits message, no status change";
  try {
    const { result, tgCalls, pc } = await runOneAction("a");
    assert.equal(result.results[0].outcome, "approved");
    assert.deepEqual(pc.issues["iss-X"].labelIds, [], "OWNER_REQUIRED removed");
    assert.equal(pc.issues["iss-X"].status, "todo", "status unchanged by APPROVE");
    assert.ok(pc.comments["iss-X"].some((c) => /OWNER MENYETUJUI via Telegram/.test(c.body)), "approve comment posted");
    assert.equal(tgCalls.answerCallbackQuery.length, 1, "callback answered");
    assert.equal(tgCalls.editMessageText.length, 1, "message edited");
    assert.equal(tgCalls.editMessageText[0].message_id, 4242);
    assert.ok(!tgCalls.editMessageText[0].reply_markup || (tgCalls.editMessageText[0].reply_markup?.inline_keyboard?.length === 0), "edited message has no buttons");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testReject() {
  const name = "(4) REJECT sets status=cancelled + OWNER_REJECTED, posts comment, edits message";
  try {
    const { result, tgCalls, pc } = await runOneAction("r");
    assert.equal(result.results[0].outcome, "rejected");
    assert.equal(pc.issues["iss-X"].status, "cancelled", "status -> cancelled");
    assert.ok(pc.issues["iss-X"].labelIds.includes(OWNER_REJECTED_LABEL_ID), "OWNER_REJECTED added");
    assert.ok(!pc.issues["iss-X"].labelIds.includes(OWNER_REQUIRED_LABEL_ID), "OWNER_REQUIRED removed");
    assert.ok(pc.comments["iss-X"].some((c) => /OWNER MENOLAK via Telegram/.test(c.body)), "reject comment posted");
    assert.equal(tgCalls.editMessageText.length, 1, "message edited");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testDetails() {
  const name = "(5) DETAILS sends a follow-up message, no Paperclip state change, original buttons untouched";
  try {
    const { result, tgCalls, pc } = await runOneAction("d");
    assert.equal(result.results[0].outcome, "details-sent");
    assert.equal(pc.patchLog.length, 0, "no issue PATCH on DETAILS");
    assert.equal(tgCalls.sendMessage.length, 1, "follow-up details message sent");
    assert.equal(tgCalls.editMessageText.length, 0, "original message not edited on DETAILS");
    assert.equal(tgCalls.answerCallbackQuery.length, 1, "callback answered");
    assert.deepEqual(pc.issues["iss-X"].labelIds, [OWNER_REQUIRED_LABEL_ID], "OWNER_REQUIRED still present");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testDefer() {
  const name = "(6) DEFER posts a comment, label + status unchanged, message edited to DEFERRED with remaining buttons";
  try {
    const { result, tgCalls, pc } = await runOneAction("z");
    assert.equal(result.results[0].outcome, "deferred");
    assert.equal(pc.patchLog.length, 0, "no PATCH on DEFER");
    assert.equal(tgCalls.editMessageText.length, 1, "message edited on DEFER (shows DEFERRED)");
    assert.deepEqual(pc.issues["iss-X"].labelIds, [OWNER_REQUIRED_LABEL_ID], "label unchanged on DEFER");
    assert.equal(pc.issues["iss-X"].status, "todo", "status unchanged on DEFER");
    assert.ok(pc.comments["iss-X"].some((c) => /OWNER MENUNDA via Telegram/.test(c.body)), "defer comment posted");
    assert.equal(tgCalls.answerCallbackQuery.length, 1, "callback answered");
    // DEFER should keep APPROVE/REJECT/DETAILS but not DEFER
    if (tgCalls.editMessageText[0].reply_markup) {
      const kb = tgCalls.editMessageText[0].reply_markup.inline_keyboard;
      const btns = kb.map(row => row[0].callback_data).sort();
      assert.ok(btns.includes("a:KOL-95"), "DEFER keeps APPROVE");
      assert.ok(btns.includes("r:KOL-95"), "DEFER keeps REJECT");
      assert.ok(btns.includes("d:KOL-95"), "DEFER keeps DETAILS");
      assert.ok(!btns.includes("z:KOL-95"), "DEFER removes DEFER button");
    }
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testAskAhmad() {
  const name = "(7) ASK AHMAD adds ESCALATED_TO_AHMAD, posts comment, edits message";
  try {
    const { result, tgCalls, pc } = await runOneAction("k");
    assert.equal(result.results[0].outcome, "escalated");
    assert.ok(pc.issues["iss-X"].labelIds.includes(ESCALATED_LABEL_ID), "ESCALATED_TO_AHMAD added");
    assert.ok(pc.issues["iss-X"].labelIds.includes(OWNER_REQUIRED_LABEL_ID), "OWNER_REQUIRED retained on escalate");
    assert.ok(pc.comments["iss-X"].some((c) => /MENGESKALASI ke AHMAD via Telegram/.test(c.body)), "escalate comment posted");
    assert.equal(tgCalls.editMessageText.length, 1, "message edited");
    assert.equal(tgCalls.answerCallbackQuery.length, 1, "callback answered");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testOffsetDedupe() {
  const name = "(8) offset-based dedupe: second listener run does NOT reprocess the same update";
  const id = "iss-D";
  const shortId = "KOL-96";
  const seed = ownerRequiredIssue({ id, identifier: shortId });
  const update = cbqUpdate(7001, "a", shortId, 5555);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 7001 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({
    issues: [seed.issue], comments: seed.comments,
    labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED" }],
  });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-dedupe-${Date.now()}.json`);
  try {
    const r1 = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r1.results.length, 1);
    assert.equal(r1.results[0].outcome, "approved");
    const approveComments1 = pcS.comments[id].filter((c) => /OWNER MENYETUJUI via Telegram/.test(c.body));
    assert.equal(approveComments1.length, 1, "one approve comment after first run");
    const firstPatchCount = pcS.patchLog.length;

    const r2 = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r2.results.length, 0, "second run processed nothing");
    const approveComments2 = pcS.comments[id].filter((c) => /OWNER MENYETUJUI via Telegram/.test(c.body));
    assert.equal(approveComments2.length, 1, "still exactly one approve comment — no reprocessing");
    assert.equal(pcS.patchLog.length, firstPatchCount, "no extra PATCH on second run");
    const persisted = JSON.parse(await fs.readFile(stateFile, "utf8"));
    assert.equal(persisted.offset, 7002, "offset advanced to update_id+1");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

async function testListenerTelegramFailureNoCrash() {
  const name = "(9) telegram-listener: getUpdates non-200 does not crash; returns error result";
  const tg = mockTelegram({ failGetUpdates: true });
  const tgS = await tg.start();
  const pc = mockPaperclip({ issues: [], comments: {}, labels: [] });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-fail-${Date.now()}.json`);
  try {
    const r = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r.error, "getupdates-failed");
    assert.equal(r.results.length, 0);
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

async function testListenerNetworkErrorNoCrash() {
  const name = "(10) telegram-listener: Telegram network error (closed port) -> networkError, no throw";
  const pc = mockPaperclip({ issues: [], comments: {}, labels: [] });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-net-${Date.now()}.json`);
  try {
    const r = await runListenerOnce({
      base: pcS.base, companyId: COMPANY,
      telegramBase: "http://127.0.0.1:59983/bot", // nothing listening
      stateFile, log: () => {},
    });
    assert.equal(r.error, "getupdates-failed");
    assert.ok(r.reason && /network error/i.test(String(r.reason)), "reason mentions network error");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await pcS.close();
  }
}

async function testParseCallbackData() {
  const name = "(11) parseCallbackData maps letters + shortId correctly";
  try {
    assert.deepEqual(parseCallbackData("a:KOL-9"), { actionLetter: "a", action: "APPROVE", shortId: "KOL-9" });
    assert.deepEqual(parseCallbackData("r:KOL-9"), { actionLetter: "r", action: "REJECT", shortId: "KOL-9" });
    assert.deepEqual(parseCallbackData("d:KOL-9"), { actionLetter: "d", action: "DETAILS", shortId: "KOL-9" });
    assert.deepEqual(parseCallbackData("z:KOL-9"), { actionLetter: "z", action: "DEFER", shortId: "KOL-9" });
    assert.deepEqual(parseCallbackData("k:KOL-9"), { actionLetter: "k", action: "ASK AHMAD", shortId: "KOL-9" });
    assert.deepEqual(parseCallbackData("o:KOL-9:2"), { actionLetter: "o", action: "OPTION", shortId: "KOL-9", optionIndex: 2 });
    assert.equal(parseCallbackData("o:KOL-9"), null, "option callback without index -> null");
    assert.equal(parseCallbackData("o:KOL-9:x"), null, "option callback with non-numeric index -> null");
    assert.equal(parseCallbackData("x:KOL-9"), null, "unknown letter -> null");
    assert.equal(parseCallbackData("nope"), null, "no colon -> null");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testBuildDecisionOptionsMetadataHelper() {
  const name = "(16) buildDecisionOptionsCommentBody returns a parseable marker comment and rejects malformed options";
  try {
    const body = buildDecisionOptionsCommentBody([
      { key: "keep_remote", label: "Pakai versi GitHub" },
      { key: "reconcile", label: "Bandingkan & gabungkan" },
    ]);
    assert.ok(body.startsWith(DECISION_OPTIONS_MARKER), "body carries the marker prefix");
    const parsed = parseDecisionOptionsFromComments([{ body }]);
    assert.deepEqual(parsed, { ok: true, options: [
      { key: "keep_remote", label: "Pakai versi GitHub" },
      { key: "reconcile", label: "Bandingkan & gabungkan" },
    ] });
    assert.throws(() => buildDecisionOptionsCommentBody([{ key: "only", label: "Only" }]), /expected 2-5 options/);
    assert.throws(() => buildDecisionOptionsCommentBody([{ key: "a", label: "A" }, { key: "b" }]), /missing label/);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testNotifyDynamicDecisionButtons() {
  const name = "(17) telegram-notify: valid decision-options comment renders custom OPTION buttons instead of default 4";
  const commentBody = buildDecisionOptionsCommentBody([
    { key: "keep_remote", label: "Pakai versi GitHub" },
    { key: "reconcile", label: "Bandingkan & gabungkan" },
    { key: "keep_local", label: "Pakai versi lokal" },
  ]);
  const seed = ownerRequiredIssue({ id: "iss-OPT", identifier: "KOL-97", title: "Choose sync policy", decisionOptionsCommentBody: commentBody });
  const tg = mockTelegram();
  const tgS = await tg.start();
  const pc = mockPaperclip({
    issues: [seed.issue], comments: seed.comments,
    labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" }],
  });
  const pcS = await pc.start();
  const logs = [];
  try {
    const r = await runNotifyOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, log: (m) => logs.push(m) });
    assert.equal(r.error, undefined);
    assert.equal(tgS.calls.sendMessage.length, 1, "exactly one sendMessage");
    const kb = tgS.calls.sendMessage[0].reply_markup.inline_keyboard;
    assert.equal(kb.length, 3, "one custom button row per decision option");
    assert.deepEqual(kb.map((row) => row[0].text), ["Pakai versi GitHub", "Bandingkan & gabungkan", "Pakai versi lokal"]);
    assert.deepEqual(kb.map((row) => row[0].callback_data), ["o:KOL-97:0", "o:KOL-97:1", "o:KOL-97:2"]);
    assert.equal(kb.some((row) => /^a:|^r:|^d:|^z:/.test(row[0].callback_data)), false, "default buttons not rendered");
    assert.equal(logs.some((l) => /invalid decision-options comment/.test(l)), false, "valid options do not warn");
    ok(name);
  } catch (e) { bad(name, e); } finally { await tgS.close(); await pcS.close(); }
}

async function testNotifyMalformedDecisionOptionsFallback() {
  const name = "(18) telegram-notify: malformed decision-options comment falls back to default 4 with warnings, no crash";
  const cases = [
    { suffix: "one", body: `${DECISION_OPTIONS_MARKER}\n${JSON.stringify({ decision_options: [{ key: "only", label: "Only" }] })}`, reason: /expected 2-5 options/ },
    { suffix: "six", body: `${DECISION_OPTIONS_MARKER}\n${JSON.stringify({ decision_options: [0, 1, 2, 3, 4, 5].map((n) => ({ key: `k${n}`, label: `L${n}` })) })}`, reason: /expected 2-5 options/ },
    { suffix: "nokey", body: `${DECISION_OPTIONS_MARKER}\n${JSON.stringify({ decision_options: [{ label: "A" }, { key: "b", label: "B" }] })}`, reason: /missing key/ },
    { suffix: "nolabel", body: `${DECISION_OPTIONS_MARKER}\n${JSON.stringify({ decision_options: [{ key: "a", label: "A" }, { key: "b" }] })}`, reason: /missing label/ },
    { suffix: "badjson", body: `${DECISION_OPTIONS_MARKER}\nNOT VALID JSON{{{`, reason: /not valid JSON/ },
  ];
  try {
    for (const c of cases) {
      const seed = ownerRequiredIssue({ id: `iss-BAD-${c.suffix}`, identifier: `KOL-BAD-${c.suffix}`, decisionOptionsCommentBody: c.body });
      const tg = mockTelegram();
      const tgS = await tg.start();
      const pc = mockPaperclip({ issues: [seed.issue], comments: seed.comments, labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED" }] });
      const pcS = await pc.start();
      const logs = [];
      try {
        const r = await runNotifyOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, log: (m) => logs.push(m) });
        assert.equal(r.error, undefined);
        assert.equal(tgS.calls.sendMessage.length, 1, `sendMessage for malformed case ${c.suffix}`);
        const kb = tgS.calls.sendMessage[0].reply_markup.inline_keyboard;
        assert.equal(kb.length, 4, `default four buttons for ${c.suffix}`);
        assert.deepEqual(kb.map((row) => row[0].callback_data).sort(), [`a:KOL-BAD-${c.suffix}`, `d:KOL-BAD-${c.suffix}`, `r:KOL-BAD-${c.suffix}`, `z:KOL-BAD-${c.suffix}`].sort());
        assert.ok(logs.some((l) => /invalid decision-options comment/.test(l) && c.reason.test(l) && /falling back/.test(l)), `warning logged for ${c.suffix}`);
      } finally {
        await tgS.close();
        await pcS.close();
      }
    }
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testOptionSelection() {
  const name = "(19) OPTION removes OWNER_REQUIRED, posts selected label/key, edits message, no heartbeat semantics";
  const id = "iss-OPT-A";
  const shortId = "KOL-98";
  const commentBody = buildDecisionOptionsCommentBody([
    { key: "keep_remote", label: "Pakai versi GitHub" },
    { key: "reconcile", label: "Bandingkan & gabungkan" },
  ]);
  const seed = ownerRequiredIssue({ id, identifier: shortId, title: "dynamic target", decisionOptionsCommentBody: commentBody });
  const update = cbqDataUpdate(8101, `o:${shortId}:1`, 4646);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 8101 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({ issues: [seed.issue], comments: seed.comments, labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" }] });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-option-${Date.now()}.json`);
  try {
    const r = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r.results[0].outcome, "option-selected");
    assert.deepEqual(pcS.issues[id].labelIds, [], "OWNER_REQUIRED removed");
    assert.equal(pcS.patchLog.length, 1, "one canonical PATCH");
    assert.ok(pcS.comments[id].some((c) => /OWNER MEMILIH: Bandingkan & gabungkan via Telegram/.test(c.body) && /decision_options key=reconcile/.test(c.body)), "selection comment posted with label + key");
    assert.equal(tgS.calls.answerCallbackQuery.length, 1, "callback answered");
    assert.ok(/Dipilih: Bandingkan & gabungkan/.test(tgS.calls.answerCallbackQuery[0].text), "toast shows current label");
    assert.equal(tgS.calls.editMessageText.length, 1, "message edited");
    assert.ok(/DIPILIH OWNER/.test(tgS.calls.editMessageText[0].text) && /Bandingkan & gabungkan/.test(tgS.calls.editMessageText[0].text), "edit shows resolved choice");
    assert.ok(!tgS.calls.editMessageText[0].reply_markup || (tgS.calls.editMessageText[0].reply_markup?.inline_keyboard?.length === 0), "edited message has no buttons");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

async function testOptionOutOfRangeFailsSafely() {
  const name = "(20) OPTION out-of-range index fails safely: no patch, no comment, error toast, no crash";
  const id = "iss-OPT-B";
  const shortId = "KOL-99";
  const commentBody = buildDecisionOptionsCommentBody([{ key: "a", label: "A" }, { key: "b", label: "B" }]);
  const seed = ownerRequiredIssue({ id, identifier: shortId, decisionOptionsCommentBody: commentBody });
  const update = cbqDataUpdate(8201, `o:${shortId}:5`, 4747);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 8201 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({ issues: [seed.issue], comments: seed.comments, labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED" }] });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-option-oob-${Date.now()}.json`);
  const logs = [];
  try {
    const r = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: (m) => logs.push(m) });
    assert.equal(r.results[0].outcome, "invalid-option");
    assert.deepEqual(pcS.issues[id].labelIds, [OWNER_REQUIRED_LABEL_ID], "OWNER_REQUIRED unchanged");
    assert.equal(pcS.patchLog.length, 0, "no PATCH");
    assert.equal(pcS.comments[id].length, 1, "no new comment beyond the seeded decision-options one");
    assert.equal(tgS.calls.answerCallbackQuery.length, 1, "error toast sent");
    assert.ok(/opsi sudah tidak berlaku/i.test(tgS.calls.answerCallbackQuery[0].text), "toast explains invalid option");
    assert.equal(tgS.calls.editMessageText.length, 1, "message edited to show invalid stale option");
    assert.ok(/OPSI SUDAH TIDAK BERLAKU/.test(tgS.calls.editMessageText[0].text), "edit explains stale option");
    assert.ok(logs.some((l) => /OPTION index=5 invalid/.test(l) && /no Paperclip mutation/.test(l)), "clear log line emitted");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

async function testOptionCurrentMetadataMalformedFailsSafely() {
  const name = "(21) OPTION with malformed current decision_options fails safely against fresh Paperclip state";
  const id = "iss-OPT-C";
  const shortId = "KOL-100";
  const badBody = `${DECISION_OPTIONS_MARKER}\n${JSON.stringify({ decision_options: [{ key: "only", label: "Only" }] })}`;
  const seed = ownerRequiredIssue({ id, identifier: shortId, decisionOptionsCommentBody: badBody });
  const update = cbqDataUpdate(8301, `o:${shortId}:0`, 4848);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 8301 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({ issues: [seed.issue], comments: seed.comments, labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED" }] });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-option-badmeta-${Date.now()}.json`);
  try {
    const r = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r.results[0].outcome, "invalid-option");
    assert.deepEqual(pcS.issues[id].labelIds, [OWNER_REQUIRED_LABEL_ID], "OWNER_REQUIRED unchanged");
    assert.equal(pcS.patchLog.length, 0, "no PATCH");
    assert.equal(pcS.comments[id].length, 1, "no new comment beyond the seeded (malformed) decision-options one");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

async function testOptionPatchFailureNotFalsified() {
  const name = "(22) OPTION PATCH HTTP-500 -> patch-failed, no false selected success, update still consumed";
  const id = "iss-OPT-D";
  const shortId = "KOL-101";
  const commentBody = buildDecisionOptionsCommentBody([{ key: "remote", label: "Remote" }, { key: "local", label: "Local" }]);
  const seed = ownerRequiredIssue({ id, identifier: shortId, title: "option patch target", decisionOptionsCommentBody: commentBody });
  const update = cbqDataUpdate(8401, `o:${shortId}:0`, 4949);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 8401 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({ issues: [seed.issue], comments: seed.comments, labels: [{ id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED" }], patchStatus: 500 });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-option-pf500-${Date.now()}.json`);
  try {
    const r = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r.results[0].outcome, "patch-failed", "must NOT be reported as option-selected on a 500");
    assert.deepEqual(pcS.issues[id].labelIds, [OWNER_REQUIRED_LABEL_ID], "labelIds unchanged");
    assert.equal(pcS.patchLog.length, 0, "no successful PATCH recorded");
    assert.equal(pcS.comments[id].filter((c) => /OWNER MEMILIH: Remote via Telegram/.test(c.body)).length, 0, "must NOT post the selected success comment");
    assert.equal(pcS.comments[id].filter((c) => /OWNER MEMILIH "Remote" via Telegram/.test(c.body) && /DITERIMA/.test(c.body) && /GAGAL/.test(c.body)).length, 1, "failure comment records received option");
    assert.ok(/gagal diterapkan/i.test(tgS.calls.editMessageText[0].text), "edit shows apply failed");
    assert.ok(/gagal diterapkan/i.test(tgS.calls.answerCallbackQuery[0].text), "toast says apply failed");
    const persisted = JSON.parse(await fs.readFile(stateFile, "utf8"));
    assert.equal(persisted.offset, 8402, "offset advanced past the consumed update");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

async function testStandaloneTextStillCreatesDirectiveIssue() {
  const name = "(23) standalone non-command text still creates an OWNER DIRECTIVE issue";
  const { calls, ctx } = commandCtx();
  try {
    const r = await processUpdateForCallback(textUpdate(8170, "Beresin Barrier saya"), ctx);
    assert.equal(r.outcome, "text-ingressed");
    assert.equal(r.identifier, "KOL-NEW");
    assert.equal(calls.httpPost.length, 1, "directive issue created");
    assert.match(calls.httpPost[0].body.title, /^OWNER DIRECTIVE: Beresin Barrier saya/);
    assert.equal(calls.patchIssue.length, 1, "directive issue patched for label/assignment");
    assert.deepEqual(calls.patchIssue[0].patch.labelIds, ["lbl-DIRECTIVE"]);
    assert.equal(calls.sendMessage.length, 1, "owner ACK sent");
    assert.match(calls.sendMessage[0].text, /^Received: "Beresin Barrier saya"/);
    ok(name);
  } catch (e) { bad(name, e); }
}
// ===========================================================================
// P0 FIX regression tests: PATCH failure must NOT be falsified as success, and
// state persistence must NOT be silently swallowed.
// ===========================================================================

// (12) APPROVE whose canonical PATCH fails with a NETWORK error must:
//   - report outcome "patch-failed" (NOT "approved"),
//   - leave OWNER_REQUIRED on the issue (the mutation never happened),
//   - NOT post the lying "OWNER_REQUIRED label removed so the automatic flow
//     may resume" success comment; instead post a comment that says the
//     decision was RECEIVED but the apply FAILED,
//   - edit the Telegram message to show "apply failed" (not a clean ✅),
//   - toast an error (not "✅ Approved"),
//   - STILL consume the update (offset advances) so the queue never wedges,
//     AND a second run must NOT reprocess / duplicate the failure comment.
async function testApprovePatchNetworkFailureNotFalsified() {
  const name = "(12) APPROVE PATCH network-error -> patch-failed, no false success, update still consumed (no wedge, no dup)";
  const id = "iss-X";
  const shortId = "KOL-95";
  const seed = ownerRequiredIssue({ id, identifier: shortId, title: "decision target" });
  const update = cbqUpdate(5001, "a", shortId, 4242);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 5001 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({
    issues: [seed.issue], comments: seed.comments,
    labels: [
      { id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" },
      { id: OWNER_REJECTED_LABEL_ID, name: "OWNER_REJECTED", color: "#7f1d1d" },
      { id: ESCALATED_LABEL_ID, name: "ESCALATED_TO_AHMAD", color: "#9333ea" },
    ],
    patchNetworkError: true,
  });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-pfnet-${Date.now()}.json`);
  try {
    const r1 = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r1.results.length, 1);
    assert.equal(r1.results[0].outcome, "patch-failed", "must NOT be reported as approved");
    assert.deepEqual(pcS.issues[id].labelIds, [OWNER_REQUIRED_LABEL_ID], "OWNER_REQUIRED must STILL be present (mutation never happened)");
    assert.equal(pcS.patchLog.length, 0, "no successful PATCH recorded");
    const comments = pcS.comments[id];
    // No lying success comment:
    const lyingSuccess = comments.filter((c) => /OWNER_REQUIRED dihapus sehingga alur otomatis dapat dilanjutkan/.test(c.body));
    assert.equal(lyingSuccess.length, 0, "must NOT post the 'flow may resume' success comment");
    // A failure comment that records the DITERIMA (received) decision:
    const failComments = comments.filter((c) => /DITERIMA/.test(c.body) && /GAGAL/.test(c.body));
    assert.equal(failComments.length, 1, "exactly one failure comment recording the received decision");
    // Edit shows apply failed, not clean ✅ Disetujui:
    assert.equal(tgS.calls.editMessageText.length, 1, "message edited once");
    assert.ok(/gagal diterapkan/i.test(tgS.calls.editMessageText[0].text), "edited message text mentions apply failed");
    assert.ok(!/✅ \*Disetujui\*/.test(tgS.calls.editMessageText[0].text), "edited message is NOT the clean success text");
    // Toast is an error, not ✅ Disetujui:
    assert.equal(tgS.calls.answerCallbackQuery.length, 1, "callback answered once");
    assert.ok(/gagal diterapkan/i.test(tgS.calls.answerCallbackQuery[0].text), "toast says apply failed");
    assert.ok(!/✅ Disetujui/.test(tgS.calls.answerCallbackQuery[0].text), "toast is NOT the clean success text");
    // Offset advanced (update consumed) -> state file persisted:
    const persisted = JSON.parse(await fs.readFile(stateFile, "utf8"));
    assert.equal(persisted.offset, 5002, "offset advanced past the consumed update (no wedge)");
    // Second run is idempotent (no duplicate failure comment, no reprocess):
    const r2 = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r2.results.length, 0, "second run reprocesses nothing");
    const failComments2 = pcS.comments[id].filter((c) => /DITERIMA/.test(c.body) && /GAGAL/.test(c.body));
    assert.equal(failComments2.length, 1, "still exactly one failure comment — no duplicate on replay");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

// (13) Same contract as (12) but for a non-2xx PATCH (HTTP 500), and also
// covering REJECT so the fix is not APPROVE-specific.
async function testRejectPatchStatusFailureNotFalsified() {
  const name = "(13) REJECT PATCH HTTP-500 -> patch-failed, no false success, status NOT changed to cancelled";
  const id = "iss-X";
  const shortId = "KOL-95";
  const seed = ownerRequiredIssue({ id, identifier: shortId, title: "decision target" });
  const update = cbqUpdate(5001, "r", shortId, 4242);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 5001 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({
    issues: [seed.issue], comments: seed.comments,
    labels: [
      { id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" },
      { id: OWNER_REJECTED_LABEL_ID, name: "OWNER_REJECTED", color: "#7f1d1d" },
      { id: ESCALATED_LABEL_ID, name: "ESCALATED_TO_AHMAD", color: "#9333ea" },
    ],
    patchStatus: 500,
  });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-pf500-${Date.now()}.json`);
  try {
    const r1 = await runListenerOnce({ base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile, log: () => {} });
    assert.equal(r1.results[0].outcome, "patch-failed", "REJECT must NOT be reported as rejected on a 500");
    assert.equal(pcS.issues[id].status, "todo", "status must NOT have been changed to cancelled");
    assert.deepEqual(pcS.issues[id].labelIds, [OWNER_REQUIRED_LABEL_ID], "labelIds unchanged");
    assert.equal(pcS.patchLog.length, 0, "no successful PATCH recorded");
    const lyingSuccess = pcS.comments[id].filter((c) => /Status diubah menjadi cancelled/.test(c.body));
    assert.equal(lyingSuccess.length, 0, "must NOT post the lying 'status set to cancelled' comment");
    const failComments = pcS.comments[id].filter((c) => /DITERIMA/.test(c.body) && /GAGAL/.test(c.body));
    assert.equal(failComments.length, 1, "exactly one failure comment");
    assert.ok(/gagal diterapkan/i.test(tgS.calls.editMessageText[0].text), "edit shows apply failed");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

// (14) State-file WRITE failure must NOT be silent: the run surfaces
// `persistError` and logs an ERROR line. The update is STILL processed (we do
// not block the whole sweep on a persist hiccup), but the operator is told the
// next run may reprocess (duplicate actions possible).
async function testStateWriteFailureSurfaced() {
  const name = "(14) state-file write failure -> persistError surfaced + ERROR log (not silent); update still processed";
  const id = "iss-X";
  const shortId = "KOL-95";
  const seed = ownerRequiredIssue({ id, identifier: shortId, title: "decision target" });
  const update = cbqUpdate(5001, "a", shortId, 4242);
  const tg = mockTelegram({ updatesByOffset: (off) => (off <= 5001 ? [update] : []) });
  const tgS = await tg.start();
  const pc = mockPaperclip({
    issues: [seed.issue], comments: seed.comments,
    labels: [
      { id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" },
      { id: OWNER_REJECTED_LABEL_ID, name: "OWNER_REJECTED", color: "#7f1d1d" },
      { id: ESCALATED_LABEL_ID, name: "ESCALATED_TO_AHMAD", color: "#9333ea" },
    ],
  });
  const pcS = await pc.start();
  const stateFile = path.join(__dirname, `_tgtest-wf-${Date.now()}.json`);
  const logs = [];
  try {
    const r = await runListenerOnce({
      base: pcS.base, companyId: COMPANY, telegramBase: tgS.base, stateFile,
      writeState: async () => ({ ok: false, code: "EACCES", message: "permission denied (simulated)" }),
      log: (m) => logs.push(m),
    });
    // The update WAS still processed (we do not block on persist failure):
    assert.equal(r.results[0].outcome, "approved", "update still processed despite persist failure");
    // Failure surfaced structurally:
    assert.ok(r.persistError, "persistError must be set on a write failure");
    // Failure surfaced in the log (not silent):
    assert.ok(logs.some((l) => /ERROR persisting offset/.test(l) && /REPROCESS/.test(l)), "an ERROR log line about persist failure + reprocess risk must appear");
    ok(name);
  } catch (e) { bad(name, e); } finally {
    try { await fs.unlink(stateFile); } catch { /* ignore */ }
    await tgS.close(); await pcS.close();
  }
}

// (15) A CORRUPT state file (read failure that is NOT ENOENT) must be warned
// loudly (offset resets to 0, recent updates may be reprocessed). A plain
// missing file (ENOENT) must stay SILENT (normal first run). Both still proceed.
async function testStateReadFailureWarnedEnoentSilent() {
  const name = "(15) state-file read: corrupt (non-ENOENT) -> WARN + offset 0; ENOENT -> silent (first run); both proceed";
  const id = "iss-X";
  const shortId = "KOL-95";
  const seed = ownerRequiredIssue({ id, identifier: shortId, title: "decision target" });
  const update = cbqUpdate(5001, "a", shortId, 4242);

  // Case A: corrupt read (non-ENOENT).
  const tgA = mockTelegram({ updatesByOffset: (off) => (off <= 5001 ? [update] : []) });
  const tgSA = await tgA.start();
  const pcA = mockPaperclip({
    issues: [seed.issue], comments: seed.comments,
    labels: [
      { id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" },
      { id: OWNER_REJECTED_LABEL_ID, name: "OWNER_REJECTED", color: "#7f1d1d" },
      { id: ESCALATED_LABEL_ID, name: "ESCALATED_TO_AHMAD", color: "#9333ea" },
    ],
  });
  const pcSA = await pcA.start();
  const stateFileA = path.join(__dirname, `_tgtest-rdA-${Date.now()}.json`);
  const logsA = [];
  try {
    const rA = await runListenerOnce({
      base: pcSA.base, companyId: COMPANY, telegramBase: tgSA.base, stateFile: stateFileA,
      readState: async () => ({ ok: false, code: "EBADJSON", message: "Unexpected token < in JSON" }),
      log: (m) => logsA.push(m),
    });
    assert.equal(rA.results[0].outcome, "approved", "corrupt read must still process the update (offset reset to 0)");
    assert.ok(logsA.some((l) => /WARN state file read failed/.test(l) && /resetting offset to 0/.test(l)), "corrupt read must WARN about offset reset");
    ok(name + " [corrupt->WARN]");
  } catch (e) { bad(name + " [corrupt->WARN]", e); } finally {
    try { await fs.unlink(stateFileA); } catch { /* ignore */ }
    await tgSA.close(); await pcSA.close();
  }

  // Case B: ENOENT (normal first run) — must be silent (no WARN).
  const tgB = mockTelegram({ updatesByOffset: (off) => (off <= 5001 ? [update] : []) });
  const tgSB = await tgB.start();
  const pcB = mockPaperclip({
    issues: [seed.issue], comments: seed.comments,
    labels: [
      { id: OWNER_REQUIRED_LABEL_ID, name: "OWNER_REQUIRED", color: "#b91c1c" },
      { id: OWNER_REJECTED_LABEL_ID, name: "OWNER_REJECTED", color: "#7f1d1d" },
      { id: ESCALATED_LABEL_ID, name: "ESCALATED_TO_AHMAD", color: "#9333ea" },
    ],
  });
  const pcSB = await pcB.start();
  const stateFileB = path.join(__dirname, `_tgtest-rdB-${Date.now()}.json`);
  const logsB = [];
  try {
    const rB = await runListenerOnce({
      base: pcSB.base, companyId: COMPANY, telegramBase: tgSB.base, stateFile: stateFileB,
      readState: async () => ({ ok: false, code: "ENOENT", message: "no such file" }),
      log: (m) => logsB.push(m),
    });
    assert.equal(rB.results[0].outcome, "approved", "ENOENT read must still process the update");
    assert.equal(logsB.filter((l) => /WARN state file read failed/.test(l)).length, 0, "ENOENT must NOT warn (normal first run)");
    ok(name + " [ENOENT->silent]");
  } catch (e) { bad(name + " [ENOENT->silent]", e); } finally {
    try { await fs.unlink(stateFileB); } catch { /* ignore */ }
    await tgSB.close(); await pcSB.close();
  }
}

async function main() {
  console.log("# telegram control-plane regression tests");
  // Explicitly override any real token with the FAKE one for the whole run, so
  // no real credential is ever used or sent over the loopback mock. Restored on exit.
  const prevToken = process.env.TELEGRAM_BOT_TOKEN_AHMAD;
  process.env.TELEGRAM_BOT_TOKEN_AHMAD = FAKE_TOKEN;
  try {
    await testTokenStatusNoLeak();
    await testNotifySendsAndMarks();
    await testNotifyTelegramFailureNoCrash();
    await testApprove();
    await testReject();
    await testDetails();
    await testDefer();
    await testAskAhmad();
    await testOffsetDedupe();
    await testListenerTelegramFailureNoCrash();
    await testListenerNetworkErrorNoCrash();
    await testParseCallbackData();
    await testBuildDecisionOptionsMetadataHelper();
    await testNotifyDynamicDecisionButtons();
    await testNotifyMalformedDecisionOptionsFallback();
    await testOptionSelection();
    await testOptionOutOfRangeFailsSafely();
    await testOptionCurrentMetadataMalformedFailsSafely();
    await testOptionPatchFailureNotFalsified();
    await testStandaloneTextStillCreatesDirectiveIssue();
    await testApprovePatchNetworkFailureNotFalsified();
    await testRejectPatchStatusFailureNotFalsified();
    await testStateWriteFailureSurfaced();
    await testStateReadFailureWarnedEnoentSilent();
  } finally {
    if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN_AHMAD;
    else process.env.TELEGRAM_BOT_TOKEN_AHMAD = prevToken;
  }
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error("regression runner crashed:", e); process.exit(1); });