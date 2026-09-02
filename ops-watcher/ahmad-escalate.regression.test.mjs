// ops-watcher/ahmad-escalate.regression.test.mjs
// Offline regression coverage for the AHMAD escalation script. NO real
// Paperclip, NO real network — httpGet/ensureLabel/postComment/patchIssue are
// all injected. Run with:
//   node ops-watcher/ahmad-escalate.regression.test.mjs

import assert from "node:assert/strict";
import { runEscalateOnce, COMPANY_ID } from "./ahmad-escalate.mjs";

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

const BASE = "http://127.0.0.1:9999";
const ISSUE = {
  id: "iss-1",
  identifier: "KOL-42",
  status: "in_progress",
  labelIds: ["lbl-directive"],
  labels: [{ id: "lbl-directive", name: "DIRECTIVE" }],
  title: "Stuck work item",
  description: "something stalled",
};

// ---- T1: escalating an issue that doesn't yet have OWNER_REQUIRED ----
async function t1_addsLabelAndPostsComment() {
  const calls = { patch: [], comment: [], ensureLabel: 0 };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "Masalah ini butuh keputusan pemilik karena menyangkut uang sungguhan.",
    httpGet: async (url) => {
      if (url.endsWith(`/companies/${COMPANY_ID}/issues`)) return { networkError: false, body: [ISSUE] };
      throw new Error("unexpected GET " + url);
    },
    ensureLabel: async (base, companyId, name, color) => {
      calls.ensureLabel += 1;
      assert.equal(name, "OWNER_REQUIRED", "T1: ensureLabel called with OWNER_REQUIRED");
      assert.equal(color, "#b91c1c", "T1: ensureLabel called with the canonical OWNER_REQUIRED color");
      return { id: "lbl-owner-required", created: true };
    },
    patchIssue: async (base, issueId, patch) => {
      calls.patch.push({ base, issueId, patch });
      return { networkError: false, status: 200, issue: { id: issueId, ...patch } };
    },
    postComment: async (base, issueId, body, opts) => {
      calls.comment.push({ base, issueId, body, opts });
      return { networkError: false, status: 201, comment: { id: "cmt-1" } };
    },
    log: () => {},
  });

  assert.equal(r.ok, true, "T1: result ok=true");
  assert.equal(r.escalated, true, "T1: result escalated=true");
  assert.equal(r.identifier, "KOL-42", "T1: result identifier matches");
  assert.equal(calls.ensureLabel, 1, "T1: ensureLabel called exactly once");
  assert.equal(calls.patch.length, 1, "T1: patchIssue called exactly once (label not yet present)");
  // PATCH must merge with existing labelIds, not clobber them.
  assert.deepEqual(calls.patch[0].patch.labelIds, ["lbl-directive", "lbl-owner-required"], "T1: PATCH merges OWNER_REQUIRED id with existing labelIds");
  assert.equal(calls.comment.length, 1, "T1: postComment called exactly once");
  assert.equal(calls.comment[0].body, "AHMAD ESCALATION: Masalah ini butuh keputusan pemilik karena menyangkut uang sungguhan.", "T1: comment body has the exact AHMAD ESCALATION: <reason> prefix and verbatim reason");
  assert.equal(calls.comment[0].opts.authorType, "user", "T1: comment authorType=user");
  ok("T1: escalating an issue without OWNER_REQUIRED adds the label (merged) and posts the comment");
}

// ---- T2: escalating an issue that ALREADY has OWNER_REQUIRED ----
async function t2_alreadyEscalatedSkipsPatchButStillComments() {
  const calls = { patch: [], comment: [] };
  const alreadyEscalatedIssue = {
    ...ISSUE,
    labelIds: ["lbl-directive", "lbl-owner-required"],
  };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "Alasan kedua — masih butuh perhatian pemilik.",
    httpGet: async () => ({ networkError: false, body: [alreadyEscalatedIssue] }),
    ensureLabel: async () => ({ id: "lbl-owner-required", created: false }),
    patchIssue: async (base, issueId, patch) => {
      calls.patch.push({ issueId, patch });
      return { networkError: false, status: 200, issue: {} };
    },
    postComment: async (base, issueId, body, opts) => {
      calls.comment.push({ issueId, body, opts });
      return { networkError: false, status: 201, comment: { id: "cmt-2" } };
    },
    log: () => {},
  });

  assert.equal(r.ok, true, "T2: result ok=true even when already escalated");
  assert.equal(r.escalated, true, "T2: result escalated=true");
  assert.equal(calls.patch.length, 0, "T2: NO duplicate PATCH (label already present — idempotent)");
  assert.equal(calls.comment.length, 1, "T2: a NEW comment IS still posted (repeated reasons not lost)");
  assert.equal(calls.comment[0].body, "AHMAD ESCALATION: Alasan kedua — masih butuh perhatian pemilik.", "T2: comment body carries the new reason verbatim");
  ok("T2: already-escalated issue -> no duplicate PATCH, but new comment still posted (idempotent label, non-lossy comment)");
}

// ---- T3: issue identifier not found ----
async function t3_issueNotFound() {
  const calls = { patch: [], comment: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-999",
    reason: "some reason",
    httpGet: async () => ({ networkError: false, body: [ISSUE] }), // only KOL-42 exists
    ensureLabel: async () => ({ id: "lbl-owner-required" }),
    patchIssue: async () => { calls.patch.push({}); return { networkError: false, status: 200 }; },
    postComment: async () => { calls.comment.push({}); return { networkError: false, status: 201 }; },
    log: () => {},
  });

  assert.equal(r.ok, false, "T3: result ok=false");
  assert.ok(/not found/i.test(r.reason), "T3: clear error reason mentions 'not found'");
  assert.equal(calls.patch.length, 0, "T3: no PATCH when issue not found");
  assert.equal(calls.comment.length, 0, "T3: no comment when issue not found");
  ok("T3: issue identifier not found -> ok:false, no PATCH, no comment, clear error reason");
}

// ---- T4: network error on issues list ----
async function t4_networkErrorOnIssuesList() {
  const calls = { patch: [], comment: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => ({ networkError: true, networkErrorMessage: "ECONNRESET" }),
    ensureLabel: async () => ({ id: "lbl-owner-required" }),
    patchIssue: async () => { calls.patch.push({}); return { networkError: false }; },
    postComment: async () => { calls.comment.push({}); return { networkError: false }; },
    log: () => {},
  });

  assert.equal(r.ok, false, "T4: result ok=false on issues-list network error");
  assert.ok(/network error/i.test(r.reason), "T4: error reason mentions network error");
  assert.equal(calls.patch.length, 0, "T4: no PATCH on network error");
  assert.equal(calls.comment.length, 0, "T4: no comment on network error");
  ok("T4: network error on issues list -> ok:false, no crash, no PATCH, no comment");
}

// ---- T5: network error on ensureLabel ----
async function t5_networkErrorOnEnsureLabel() {
  const calls = { patch: [], comment: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => ({ id: null, networkError: true, networkErrorMessage: "label fetch failed" }),
    patchIssue: async () => { calls.patch.push({}); return { networkError: false }; },
    postComment: async () => { calls.comment.push({}); return { networkError: false }; },
    log: () => {},
  });

  assert.equal(r.ok, false, "T5: result ok=false on ensureLabel network error");
  assert.equal(calls.patch.length, 0, "T5: no PATCH when ensureLabel fails");
  assert.equal(calls.comment.length, 0, "T5: no comment when ensureLabel fails");
  ok("T5: network error on ensureLabel -> ok:false, no PATCH, no comment, clear error reason");
}

// ---- T6: network error on patchIssue ----
async function t6_networkErrorOnPatchIssue() {
  const calls = { comment: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => ({ id: "lbl-owner-required" }),
    patchIssue: async () => ({ networkError: true, networkErrorMessage: "PATCH failed" }),
    postComment: async () => { calls.comment.push({}); return { networkError: false, status: 201 }; },
    log: () => {},
  });

  assert.equal(r.ok, false, "T6: result ok=false on patchIssue network error");
  assert.equal(calls.comment.length, 0, "T6: no comment when patchIssue fails (label not confirmed added)");
  ok("T6: network error on patchIssue -> ok:false, no comment (label add not confirmed)");
}

// ---- T7: network error on postComment (after successful label add) ----
async function t7_networkErrorOnPostComment() {
  const calls = { patch: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => ({ id: "lbl-owner-required" }),
    patchIssue: async () => { calls.patch.push({}); return { networkError: false, status: 200 }; },
    postComment: async () => ({ networkError: true, networkErrorMessage: "comment post failed" }),
    log: () => {},
  });

  assert.equal(r.ok, false, "T7: result ok=false on postComment network error");
  assert.equal(calls.patch.length, 1, "T7: PATCH WAS still attempted (label add happened before comment attempt)");
  ok("T7: network error on postComment -> ok:false (label added but comment not recorded)");
}

// ---- T8: no Paperclip base resolved ----
async function t8_noBase() {
  const r = await runEscalateOnce({
    base: null,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => { throw new Error("must not call httpGet with no base"); },
    ensureLabel: async () => { throw new Error("must not call ensureLabel with no base"); },
    postComment: async () => { throw new Error("must not call postComment with no base"); },
    patchIssue: async () => { throw new Error("must not call patchIssue with no base"); },
    log: () => {},
  });

  assert.equal(r.ok, false, "T8: result ok=false when no base");
  assert.ok(/base/i.test(r.reason), "T8: error reason mentions base");
  ok("T8: no Paperclip base -> ok:false, no network calls attempted");
}

// ---- T9: Paperclip REJECTED the label PATCH (401) — networkError is false ----
// This is the shape that used to pass: a rejected write reports no network
// error, so the escalation would go on to post a comment while the
// OWNER_REQUIRED label was never applied — an escalation nobody is routed to.
async function t9_rejectedPatchIsNotAnEscalation() {
  const calls = { comment: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => ({ id: "lbl-owner-required" }),
    patchIssue: async () => ({ networkError: false, authRequired: true, status: 401, body: null }),
    postComment: async () => { calls.comment.push({}); return { networkError: false, status: 201 }; },
    log: () => {},
  });

  assert.equal(r.ok, false, "T9: a 401 on the label PATCH is not a successful escalation");
  assert.ok(/did not land/.test(r.reason), "T9: reason says the write did not land");
  assert.ok(/401/.test(r.reason), "T9: reason names the status");
  assert.equal(calls.comment.length, 0, "T9: no comment when the label was not actually applied");
  ok("T9: rejected label PATCH (401) -> ok:false, no comment");
}

// ---- T10: Paperclip REJECTED the escalation comment (5xx) ----
async function t10_rejectedCommentIsNotAnEscalation() {
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => ({ id: "lbl-owner-required" }),
    patchIssue: async () => ({ networkError: false, status: 200 }),
    postComment: async () => ({ networkError: false, status: 500, body: null }),
    log: () => {},
  });

  assert.equal(r.ok, false, "T10: a 500 on the comment is not a recorded escalation");
  assert.ok(/did not land/.test(r.reason), "T10: reason says the write did not land");
  assert.ok(/500/.test(r.reason), "T10: reason names the status");
  ok("T10: rejected escalation comment (500) -> ok:false");
}

async function main() {
  const tests = [
    t1_addsLabelAndPostsComment,
    t2_alreadyEscalatedSkipsPatchButStillComments,
    t3_issueNotFound,
    t4_networkErrorOnIssuesList,
    t5_networkErrorOnEnsureLabel,
    t6_networkErrorOnPatchIssue,
    t7_networkErrorOnPostComment,
    t8_noBase,
    t9_rejectedPatchIsNotAnEscalation,
    t10_rejectedCommentIsNotAnEscalation,
  ];
  for (const t of tests) await t();
  console.log(`\nahmad-escalate.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();