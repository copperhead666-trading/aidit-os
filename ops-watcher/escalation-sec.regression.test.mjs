// ops-watcher/escalation-sec.regression.test.mjs
// Offline regression coverage for the ESCALATION-SEC owner-blocker sweep. NO
// real Hermes, NO real Paperclip, NO real network -- everything is injected.
//
//   node ops-watcher/escalation-sec.regression.test.mjs

import assert from "node:assert/strict";
import { runEscalationSecOnce, COMPANY_ID } from "./escalation-sec.mjs";

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

const BASE = "http://127.0.0.1:9999";
const TS = "2026-09-01T01:02:03.000Z";
const OWNER_LABEL_ID = "lbl-owner-required";

function blockedIssue(overrides = {}) {
  return {
    id: "iss-1",
    identifier: "KOL-101",
    status: "blocked",
    labelIds: ["lbl-existing"],
    labels: [{ id: "lbl-existing", name: "TEST_REQUIRED" }],
    title: "Deploy needs owner credential",
    description: "Cannot continue until the owner supplies a credential.",
    unblockDescriptor: { reason: "waiting-on-owner-credential" },
    blockedOwnerNotifiedAt: null,
    ...overrides,
  };
}

function makeDeps({
  issues,
  commentsById = {},
  hermes = async () => ({ ok: true, stdout: "Pemilik perlu memberikan kredensial agar pekerjaan bisa dilanjutkan.", stderr: "" }),
  ensureLabel = async () => ({ id: OWNER_LABEL_ID, created: false }),
  patchIssue,
  postComment,
  log = () => {},
} = {}) {
  const calls = { hermes: [], ensureLabel: [], patch: [], comment: [], get: [] };
  const deps = {
    base: BASE,
    companyId: COMPANY_ID,
    now: () => TS,
    log,
    httpGet: async (url) => {
      calls.get.push(url);
      if (url.endsWith(`/api/companies/${COMPANY_ID}/issues`)) return { networkError: false, body: issues || [] };
      const m = url.match(/\/api\/issues\/([^/]+)\/comments$/);
      if (m) return { networkError: false, body: commentsById[m[1]] || [] };
      throw new Error("unexpected GET " + url);
    },
    dispatchHermes: async (prompt) => {
      calls.hermes.push(prompt);
      return hermes(prompt);
    },
    ensureLabel: async (...args) => {
      calls.ensureLabel.push(args);
      return ensureLabel(...args);
    },
    patchIssue: patchIssue || (async (base, issueId, patch) => {
      calls.patch.push({ base, issueId, patch });
      return { networkError: false, status: 200, issue: { id: issueId, ...patch } };
    }),
    postComment: postComment || (async (base, issueId, body, opts) => {
      calls.comment.push({ base, issueId, body, opts });
      return { networkError: false, status: 201, comment: { id: `cmt-${calls.comment.length}` } };
    }),
  };
  return { deps, calls };
}

// ---- T1: happy path ----
async function t1_notifiesBlockedUnnotifiedIssue() {
  const issue = blockedIssue();
  const { deps, calls } = makeDeps({ issues: [issue] });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results.length, 1, "T1: one result");
  assert.equal(r.results[0].outcome, "notified", "T1: issue notified");
  assert.equal(calls.hermes.length, 1, "T1: Hermes dispatched once");
  assert.ok(calls.hermes[0].includes(JSON.stringify(issue.unblockDescriptor)), "T1: prompt includes unblockDescriptor JSON");
  assert.equal(calls.ensureLabel.length, 1, "T1: ensureLabel called once");
  assert.equal(calls.ensureLabel[0][2], "OWNER_REQUIRED", "T1: label name OWNER_REQUIRED");
  assert.equal(calls.ensureLabel[0][3], "#b91c1c", "T1: canonical OWNER_REQUIRED color");
  assert.equal(calls.patch.length, 2, "T1: label patch + notified-at patch");
  assert.deepEqual(calls.patch[0].patch.labelIds, ["lbl-existing", OWNER_LABEL_ID], "T1: OWNER_REQUIRED merged without clobbering existing label");
  assert.deepEqual(calls.patch[1].patch, { blockedOwnerNotifiedAt: TS }, "T1: blockedOwnerNotifiedAt patched to timestamp");
  assert.equal(calls.comment.length, 1, "T1: one comment posted");
  assert.ok(calls.comment[0].body.startsWith("ESCALATION-SEC NOTIFIED"), "T1: comment starts with marker");
  assert.equal(calls.comment[0].opts.authorType, "user", "T1: comment authorType=user");
  ok("T1: blocked+unnotified issue gets Hermes explanation, OWNER_REQUIRED label, marker comment, and notified timestamp");
}

// ---- T2: Hermes failure still escalates via deterministic fallback ----
async function t2_hermesFailureFallsBackAndCompletes() {
  const issue = blockedIssue({ id: "iss-fallback", identifier: "KOL-102" });
  const { deps, calls } = makeDeps({
    issues: [issue],
    hermes: async () => ({ ok: false, stdout: "", stderr: "provider down", error: "exit_1" }),
  });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results[0].outcome, "notified", "T2: fallback path still completes");
  assert.equal(calls.hermes.length, 1, "T2: Hermes attempted once");
  assert.equal(calls.patch.length, 2, "T2: both patches still happen");
  assert.equal(calls.comment.length, 1, "T2: comment still posted");
  assert.equal(
    calls.comment[0].body,
    `ESCALATION-SEC NOTIFIED: Issue ini terblokir: ${JSON.stringify(issue.unblockDescriptor)}. Perlu tindakan Anda untuk melanjutkan.`,
    "T2: deterministic Indonesian fallback text used",
  );
  ok("T2: Hermes ok:false -> deterministic fallback text still completes label/comment/timestamp escalation");
}

// ---- T2b: Hermes meta output is treated as unusable and falls back ----
async function t2b_hermesTruncatedMetaFallsBackAndCompletes() {
  const issue = blockedIssue({ id: "iss-truncated", identifier: "KOL-102B" });
  const { deps, calls } = makeDeps({
    issues: [issue],
    hermes: async () => ({ ok: true, stdout: "Response truncated due to output length limit", stderr: "" }),
  });
  const r = await runEscalationSecOnce(deps);

  const fallback = `Issue ini terblokir: ${JSON.stringify(issue.unblockDescriptor)}. Perlu tindakan Anda untuk melanjutkan.`;
  assert.equal(r.results[0].outcome, "notified", "T2b: unusable meta output still completes");
  assert.equal(calls.comment.length, 1, "T2b: comment still posted");
  assert.equal(calls.comment[0].body, `ESCALATION-SEC NOTIFIED: ${fallback}`, "T2b: deterministic fallback text used");
  assert.ok(!calls.comment[0].body.includes("Response truncated due to output length limit"), "T2b: meta string is not pasted to owner");
  ok("T2b: Hermes truncation meta string -> deterministic fallback text");
}

// ---- T2c: Hermes normal Indonesian paragraph is used ----
async function t2c_hermesNormalParagraphIsUsed() {
  const issue = blockedIssue({ id: "iss-composed", identifier: "KOL-102C" });
  const paragraph = "Issue ini terblokir karena kredensial owner belum tersedia. Tim perlu menerima akses yang benar sebelum deployment dapat dilanjutkan. Setelah kredensial dikonfirmasi, pekerjaan bisa berjalan kembali tanpa mengubah rencana teknis.";
  const { deps, calls } = makeDeps({
    issues: [issue],
    hermes: async () => ({ ok: true, stdout: paragraph, stderr: "" }),
  });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results[0].outcome, "notified", "T2c: composed output completes");
  assert.equal(calls.comment[0].body, `ESCALATION-SEC NOTIFIED: ${paragraph}`, "T2c: normal paragraph is used verbatim after marker");
  ok("T2c: Hermes normal Indonesian paragraph -> owner explanation is used");
}

// ---- T3: already notified by schema field ----
async function t3_alreadyBlockedOwnerNotifiedSkips() {
  const { deps, calls } = makeDeps({
    issues: [blockedIssue({ blockedOwnerNotifiedAt: "2026-08-31T00:00:00.000Z" })],
  });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results.length, 0, "T3: skipped entirely");
  assert.equal(calls.hermes.length, 0, "T3: no Hermes call");
  assert.equal(calls.patch.length, 0, "T3: no patch");
  assert.equal(calls.comment.length, 0, "T3: no comment");
  ok("T3: blocked issue with blockedOwnerNotifiedAt already set is skipped entirely");
}

// ---- T4: already notified by marker comment ----
async function t4_markerCommentSkipsDuplicate() {
  const issue = blockedIssue({ id: "iss-marker", identifier: "KOL-104" });
  const { deps, calls } = makeDeps({
    issues: [issue],
    commentsById: { [issue.id]: [{ body: "ESCALATION-SEC NOTIFIED: Sudah dikirim sebelumnya." }] },
  });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results.length, 0, "T4: marker skip has no duplicate result");
  assert.equal(calls.hermes.length, 0, "T4: no Hermes call");
  assert.equal(calls.patch.length, 0, "T4: no patch");
  assert.equal(calls.comment.length, 0, "T4: no duplicate comment");
  ok("T4: existing ESCALATION-SEC NOTIFIED marker comment skips duplicate handling");
}

// ---- T5: non-blocked issue ignored ----
async function t5_nonBlockedSkipped() {
  const { deps, calls } = makeDeps({
    issues: [blockedIssue({ status: "in_progress", blockedOwnerNotifiedAt: null })],
  });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results.length, 0, "T5: non-blocked issue not considered");
  assert.equal(calls.hermes.length, 0, "T5: no Hermes");
  assert.equal(calls.patch.length, 0, "T5: no patch");
  assert.equal(calls.comment.length, 0, "T5: no comment");
  ok("T5: status !== blocked is skipped and never considered");
}

// ---- T6: issues-list network error is contained and recorded ----
async function t6_issuesListNetworkErrorRecorded() {
  const r = await runEscalationSecOnce({
    base: BASE,
    companyId: COMPANY_ID,
    httpGet: async () => ({ networkError: true, networkErrorMessage: "ECONNRESET" }),
    dispatchHermes: async () => { throw new Error("must not dispatch"); },
    ensureLabel: async () => { throw new Error("must not ensure label"); },
    patchIssue: async () => { throw new Error("must not patch"); },
    postComment: async () => { throw new Error("must not comment"); },
    log: () => {},
  });

  assert.equal(r.error, "network", "T6: network error shape set");
  assert.equal(r.results.length, 1, "T6: clear failure result recorded");
  assert.equal(r.results[0].step, "issues-list", "T6: failure step recorded");
  ok("T6: issues-list network error does not throw and records a clear failure outcome");
}

// ---- T7: ensureLabel network error does not kill the next issue ----
async function t7_ensureLabelNetworkErrorContinues() {
  const first = blockedIssue({ id: "iss-label-fail", identifier: "KOL-107" });
  const second = blockedIssue({ id: "iss-label-ok", identifier: "KOL-108" });
  let ensureCalls = 0;
  const { deps } = makeDeps({
    issues: [first, second],
    ensureLabel: async () => {
      ensureCalls += 1;
      if (ensureCalls === 1) return { id: null, networkError: true, networkErrorMessage: "label fetch failed" };
      return { id: OWNER_LABEL_ID, created: false };
    },
  });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results.length, 2, "T7: one failure + one success result");
  assert.equal(r.results[0].outcome, "failed", "T7: first issue failed");
  assert.equal(r.results[0].step, "ensure-label", "T7: ensure-label step recorded");
  assert.equal(r.results[1].outcome, "notified", "T7: second issue still handled");
  ok("T7: ensureLabel network error is per-issue and does not kill the sweep");
}

// ---- T8: patchIssue network error does not kill the next issue ----
async function t8_patchIssueNetworkErrorContinues() {
  const first = blockedIssue({ id: "iss-patch-fail", identifier: "KOL-109" });
  const second = blockedIssue({ id: "iss-patch-ok", identifier: "KOL-110" });
  let patchCalls = 0;
  const calls = { patch: [], comment: [] };
  const { deps } = makeDeps({
    issues: [first, second],
    patchIssue: async (base, issueId, patch) => {
      calls.patch.push({ issueId, patch });
      patchCalls += 1;
      if (patchCalls === 1) return { networkError: true, networkErrorMessage: "PATCH failed" };
      return { networkError: false, status: 200, issue: { id: issueId, ...patch } };
    },
    postComment: async (base, issueId, body, opts) => {
      calls.comment.push({ issueId, body, opts });
      return { networkError: false, status: 201, comment: { id: "cmt-ok" } };
    },
  });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results.length, 2, "T8: one failure + one success result");
  assert.equal(r.results[0].step, "patch-labels", "T8: label patch failure recorded");
  assert.equal(r.results[1].outcome, "notified", "T8: second issue still notified");
  assert.equal(calls.comment.some((c) => c.issueId === first.id), false, "T8: no comment posted when label patch failed");
  ok("T8: patchIssue network error is recorded and later issues still run");
}

// ---- T9: postComment network error does not kill the next issue ----
async function t9_postCommentNetworkErrorContinues() {
  const first = blockedIssue({ id: "iss-comment-fail", identifier: "KOL-111" });
  const second = blockedIssue({ id: "iss-comment-ok", identifier: "KOL-112" });
  let commentCalls = 0;
  const { deps } = makeDeps({
    issues: [first, second],
    postComment: async (base, issueId, body, opts) => {
      commentCalls += 1;
      if (commentCalls === 1) return { networkError: true, networkErrorMessage: "comment post failed" };
      return { networkError: false, status: 201, comment: { id: "cmt-ok" } };
    },
  });
  const r = await runEscalationSecOnce(deps);

  assert.equal(r.results.length, 2, "T9: one failure + one success result");
  assert.equal(r.results[0].step, "post-comment", "T9: comment failure recorded");
  assert.equal(r.results[1].outcome, "notified", "T9: second issue still notified");
  ok("T9: postComment network error records failure and does not kill the sweep");
}

async function main() {
  const tests = [
    t1_notifiesBlockedUnnotifiedIssue,
    t2_hermesFailureFallsBackAndCompletes,
    t2b_hermesTruncatedMetaFallsBackAndCompletes,
    t2c_hermesNormalParagraphIsUsed,
    t3_alreadyBlockedOwnerNotifiedSkips,
    t4_markerCommentSkipsDuplicate,
    t5_nonBlockedSkipped,
    t6_issuesListNetworkErrorRecorded,
    t7_ensureLabelNetworkErrorContinues,
    t8_patchIssueNetworkErrorContinues,
    t9_postCommentNetworkErrorContinues,
  ];
  for (const t of tests) await t();
  console.log(`\nescalation-sec.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();
