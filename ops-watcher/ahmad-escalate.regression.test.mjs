// ops-watcher/ahmad-escalate.regression.test.mjs
// Offline regression coverage for the AHMAD escalation script. NO real
// Paperclip, NO real network — httpGet/ensureLabel/postComment/patchIssue are
// all injected. Run with:
//   node ops-watcher/ahmad-escalate.regression.test.mjs

import assert from "node:assert/strict";
import { runEscalateOnce, COMPANY_ID } from "./ahmad-escalate.mjs";
import { DECISION_BRIEF_MARKER } from "./decision-brief.mjs";

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

const BASE = "http://127.0.0.1:9999";
const VALID_BRIEF = Object.freeze({
  pertanyaan: "Apakah Anda menyetujui penambahan label OWNER_REQUIRED untuk keputusan biaya operasional KOL-42?",
  yang_sudah_ada: [
    {
      kutipan: "Item KOL-42 masih tertahan karena keputusan biaya operasional belum dipilih.",
      sumber: "ops-watcher/ahmad-escalate.regression.test.mjs fixture KOL-42",
    },
  ],
  pilihan: [
    {
      key: "eskalasi",
      label: "Eskalasi ke pemilik",
      konsekuensi: "Anda menerima kartu keputusan sekarang dan tim dapat melanjutkan setelah arahan dipilih.",
    },
    {
      key: "tahan",
      label: "Tahan tanpa eskalasi",
      konsekuensi: "Tim tidak mengubah label dan pekerjaan tetap menunggu sampai keputusan berikutnya tersedia.",
    },
  ],
  rekomendasi: {
    pilihan: "eskalasi",
    alasan: "Risiko biaya sudah disebutkan dan keputusan berada pada kewenangan Anda, sehingga eskalasi memberi jalur tindak lanjut paling jelas.",
  },
  kalau_didiamkan: "Jika didiamkan, pekerjaan tetap tertahan dan biaya operasional berisiko diputuskan tanpa arahan Anda.",
});
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
    brief: VALID_BRIEF,
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
  assert.equal(calls.comment.length, 2, "T1: postComment called exactly twice (escalation sentence, then structured brief)");
  assert.equal(calls.comment[0].body, "AHMAD ESCALATION: Masalah ini butuh keputusan pemilik karena menyangkut uang sungguhan.", "T1: comment body has the exact AHMAD ESCALATION: <reason> prefix and verbatim reason");
  assert.equal(calls.comment[0].opts.authorType, "user", "T1: comment authorType=user");
  assert.ok(calls.comment[1].body.startsWith(DECISION_BRIEF_MARKER), "T1: structured brief is posted after the human escalation sentence");
  assert.equal(calls.comment[1].opts.authorType, "user", "T1: brief comment authorType=user");
  assert.equal(r.briefPosted, true, "T1: result briefPosted=true");
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
    brief: VALID_BRIEF,
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
  assert.equal(calls.comment.length, 2, "T2: a NEW escalation comment and decision brief ARE still posted");
  assert.equal(calls.comment[0].body, "AHMAD ESCALATION: Alasan kedua — masih butuh perhatian pemilik.", "T2: comment body carries the new reason verbatim");
  assert.ok(calls.comment[1].body.startsWith(DECISION_BRIEF_MARKER), "T2: structured brief is posted after the repeated escalation reason");
  assert.equal(r.briefPosted, true, "T2: result briefPosted=true");
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
    brief: VALID_BRIEF,
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
    brief: VALID_BRIEF,
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
    brief: VALID_BRIEF,
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
    brief: VALID_BRIEF,
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
    brief: VALID_BRIEF,
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

// ---- G1: missing brief refuses before any board mutation ----
async function g1_noBriefRefusesBeforeWrites() {
  const calls = { ensureLabel: 0, patch: [], comment: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => { calls.ensureLabel += 1; return { id: "lbl-owner-required" }; },
    patchIssue: async (base, issueId, patch) => { calls.patch.push({ issueId, patch }); return { networkError: false, status: 200 }; },
    postComment: async (base, issueId, body, opts) => {
      calls.comment.push({ issueId, body, opts });
      return { networkError: false, status: 201, comment: { id: "refusal-1" } };
    },
    log: () => {},
  });

  assert.equal(r.ok, false, "G1: missing brief refuses with ok=false");
  assert.equal(r.reason, "brief-incomplete", "G1: reason is brief-incomplete");
  assert.equal(r.escalated, false, "G1: result escalated=false");
  assert.deepEqual(r.missing, ["pertanyaan", "yang_sudah_ada", "pilihan", "rekomendasi", "kalau_didiamkan"], "G1: result names all missing slots");
  assert.equal(calls.ensureLabel, 0, "G1: ensureLabel was NEVER called");
  assert.equal(calls.patch.length, 0, "G1: patchIssue was NEVER called");
  assert.equal(calls.comment.filter((c) => c.body.startsWith("AHMAD ESCALATION:")).length, 0, "G1: NO escalation comment was posted");
  assert.equal(calls.comment.filter((c) => c.body.startsWith(DECISION_BRIEF_MARKER)).length, 0, "G1: NO decision brief comment was posted");
  ok("G1: no brief -> refused before label/patch/escalation writes");
}

// ---- G2: refusal is recorded and names the missing slots ----
async function g2_refusalIsRecorded() {
  const calls = { comment: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => { throw new Error("G2: ensureLabel must not be called"); },
    patchIssue: async () => { throw new Error("G2: patchIssue must not be called"); },
    postComment: async (base, issueId, body, opts) => {
      calls.comment.push({ issueId, body, opts });
      return { networkError: false, status: 201, comment: { id: "refusal-2" } };
    },
    log: () => {},
  });

  assert.equal(r.ok, false, "G2: missing brief refuses with ok=false");
  assert.equal(calls.comment.length, 1, "G2: exactly one refusal comment is posted");
  assert.ok(calls.comment[0].body.startsWith("AHMAD ESCALATION REFUSED (brief incomplete)"), "G2: refusal comment starts with the refusal marker");
  for (const slot of ["pertanyaan", "yang_sudah_ada", "pilihan", "rekomendasi", "kalau_didiamkan"]) {
    assert.ok(calls.comment[0].body.includes(slot), `G2: refusal comment names missing slot ${slot}`);
  }
  assert.equal(calls.comment[0].opts.authorType, "user", "G2: refusal comment authorType=user");
  ok("G2: refusal is recorded exactly once and names missing slots");
}

// ---- G3: recordRefusal:false suppresses the refusal comment ----
async function g3_recordRefusalFalseSuppressesComment() {
  const calls = { comment: [] };
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    recordRefusal: false,
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => { throw new Error("G3: ensureLabel must not be called"); },
    patchIssue: async () => { throw new Error("G3: patchIssue must not be called"); },
    postComment: async () => { calls.comment.push({}); return { networkError: false, status: 201 }; },
    log: () => {},
  });

  assert.equal(r.ok, false, "G3: missing brief refuses with ok=false");
  assert.equal(r.reason, "brief-incomplete", "G3: reason is brief-incomplete");
  assert.equal(r.escalated, false, "G3: result escalated=false");
  assert.equal(calls.comment.length, 0, "G3: recordRefusal:false suppresses the refusal comment");
  ok("G3: recordRefusal:false refuses silently by request");
}

// ---- G4: the literal KOL-67 topic shape is refused ----
async function g4_literalKol67ShapeIsRefused() {
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "some reason",
    brief: { pertanyaan: "SJS HRD KPI commission rules need your input" },
    recordRefusal: false,
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => { throw new Error("G4: ensureLabel must not be called"); },
    patchIssue: async () => { throw new Error("G4: patchIssue must not be called"); },
    postComment: async () => { throw new Error("G4: postComment must not be called when recordRefusal=false"); },
    log: () => {},
  });

  assert.equal(r.ok, false, "G4: KOL-67 topic-only shape refuses with ok=false");
  assert.equal(r.reason, "brief-incomplete", "G4: reason is brief-incomplete");
  assert.equal(r.escalated, false, "G4: result escalated=false");
  assert.deepEqual(r.missing, ["yang_sudah_ada", "pilihan", "rekomendasi", "kalau_didiamkan"], "G4: missing names every absent KOL-67 slot except pertanyaan");
  ok("G4: literal KOL-67 topic shape is refused and names absent decision slots");
}

// ---- G5: brief comment failure is a partial success, not a blind retry case ----
async function g5_briefCommentFailureKeepsEscalationLanded() {
  const calls = { patch: [], comment: [] };
  const logs = [];
  const r = await runEscalateOnce({
    base: BASE,
    companyId: COMPANY_ID,
    issueIdentifier: "KOL-42",
    reason: "Masalah ini butuh keputusan pemilik karena menyangkut uang sungguhan.",
    brief: VALID_BRIEF,
    httpGet: async () => ({ networkError: false, body: [ISSUE] }),
    ensureLabel: async () => ({ id: "lbl-owner-required" }),
    patchIssue: async (base, issueId, patch) => {
      calls.patch.push({ issueId, patch });
      return { networkError: false, status: 200, issue: { id: issueId, ...patch } };
    },
    postComment: async (base, issueId, body, opts) => {
      calls.comment.push({ issueId, body, opts });
      if (body.startsWith(DECISION_BRIEF_MARKER)) return { networkError: false, status: 500, body: null };
      return { networkError: false, status: 201, comment: { id: "cmt-escalation" } };
    },
    log: (m) => { logs.push(m); },
  });

  assert.equal(r.ok, false, "G5: failed brief comment reports ok=false");
  assert.equal(r.escalated, true, "G5: escalation itself is marked as landed");
  assert.equal(r.briefPosted, false, "G5: result briefPosted=false");
  assert.ok(/brief comment did not land/.test(r.reason), "G5: reason names the brief comment failure");
  assert.equal(calls.patch.length, 1, "G5: label PATCH landed before the brief failure");
  assert.equal(calls.comment.length, 2, "G5: escalation comment was posted before the failed brief comment");
  assert.equal(calls.comment[0].body, "AHMAD ESCALATION: Masalah ini butuh keputusan pemilik karena menyangkut uang sungguhan.", "G5: first comment is still the human escalation sentence");
  assert.ok(calls.comment[1].body.startsWith(DECISION_BRIEF_MARKER), "G5: second comment is the structured brief attempt");
  assert.ok(logs.some((m) => /escalation itself DID land/.test(m)), "G5: log makes clear the escalation itself succeeded");
  ok("G5: brief comment failure reports partial success without inviting blind retry");
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
    g1_noBriefRefusesBeforeWrites,
    g2_refusalIsRecorded,
    g3_recordRefusalFalseSuppressesComment,
    g4_literalKol67ShapeIsRefused,
    g5_briefCommentFailureKeepsEscalationLanded,
  ];
  for (const t of tests) await t();
  console.log(`\nahmad-escalate.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();