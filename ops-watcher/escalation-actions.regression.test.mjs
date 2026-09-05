// ops-watcher/escalation-actions.regression.test.mjs
// E2 — four actions, declared per escalation.
//
//   node ops-watcher/escalation-actions.regression.test.mjs
//
// The owner's complaint, in his words: "the buttons never change, and there is
// no way to disagree." These tests hold the fix in place — the SENDER declares
// which actions an escalation supports, the card renders those and only those,
// and `edit` returns his revision as a NEW plan so the original never runs.

import assert from "node:assert/strict";
import {
  ACTION_FLAGS,
  DEFAULT_ACTIONS,
  ESCALATION_ACTIONS_MARKER,
  EDIT_REQUESTED_MARKER,
  OWNER_REVISION_MARKER,
  buildEditRequestedCommentBody,
  buildEscalationActionsCommentBody,
  buildOwnerRevisionCommentBody,
  buttonsForActions,
  parseEscalationActionsFromComments,
  pendingEditRequest,
  validateEscalationActions,
} from "./escalation-actions.mjs";
import { buildButtons } from "./telegram-notify.mjs";
import { applyOwnerRevisionIfRequested } from "./telegram-listener.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(String(e && e.stack ? e.stack : e).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(n); failed++;
};
async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

const comment = (body, createdAt = "2026-09-05T00:00:00.000Z") => ({ id: `c-${createdAt}`, body, createdAt, authorType: "user" });
const labels = (rows) => rows.flat().map((b) => b.text);

// --- the declaration ---------------------------------------------------------

await t("E2: a declaration validates, round-trips through a comment, and keeps its flags", () => {
  const body = buildEscalationActionsCommentBody({
    allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: false,
  });
  assert.ok(body.startsWith(ESCALATION_ACTIONS_MARKER), "house convention: a marker line and one JSON object");
  const parsed = parseEscalationActionsFromComments([comment(body)]);
  assert.deepEqual(parsed, { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: false });
});

await t("E2: an omitted flag falls back to today's card, not to silence", () => {
  const v = validateEscalationActions({ allow_edit: true });
  assert.equal(v.ok, true);
  assert.equal(v.actions.allow_accept, DEFAULT_ACTIONS.allow_accept, "approve stays available");
  assert.equal(v.actions.allow_ignore, DEFAULT_ACTIONS.allow_ignore, "so does decline");
  assert.equal(v.actions.allow_edit, true);
  assert.equal(v.actions.allow_respond, false, "an action nobody declared is not invented");
});

await t("E2: a declaration that allows nothing is refused", () => {
  const v = validateEscalationActions({ allow_accept: false, allow_edit: false, allow_respond: false, allow_ignore: false });
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /tidak ada aksi/);
  assert.throws(() => buildEscalationActionsCommentBody({ allow_accept: false, allow_ignore: false }), /invalid escalation actions/);
});

await t("E2: a non-boolean flag is refused rather than coerced", () => {
  const v = validateEscalationActions({ allow_accept: "yes" });
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /allow_accept/);
});

await t("E2: the newest declaration wins, and a broken one never inherits the last round's buttons", () => {
  const good = buildEscalationActionsCommentBody({ allow_accept: true, allow_edit: true });
  const older = buildEscalationActionsCommentBody({ allow_accept: true, allow_edit: false });
  // Paperclip returns comments NEWEST FIRST.
  assert.equal(parseEscalationActionsFromComments([comment(good), comment(older)]).allow_edit, true);
  // A malformed NEWEST declaration falls back to the default card rather than
  // reading past it: inheriting the previous round's flags would offer an
  // action this escalation never declared.
  assert.equal(parseEscalationActionsFromComments([comment(`${ESCALATION_ACTIONS_MARKER} {not json`), comment(older)]), null);
  assert.equal(parseEscalationActionsFromComments([comment("just a comment")]), null);
});

await t("E2 edit: a request with NO message_id cannot claim a reply to a known card", () => {
  // Otherwise the owner's next reply to any card at all becomes a plan revision
  // on this issue.
  const anonymous = comment(`${EDIT_REQUESTED_MARKER} ${JSON.stringify({ edit_requested: { short_id: "KOL-70", at: "2026-09-05T00:00:00.000Z" } })}`);
  assert.equal(pendingEditRequest([anonymous], 4242), null, "a known card id must be matched, not assumed");
  assert.ok(pendingEditRequest([anonymous], null), "with no card id in hand, the newest request still stands");
});

// --- the card ----------------------------------------------------------------

await t("E2: the card renders the declared actions, and only those", () => {
  const rows = buttonsForActions("KOL-70", { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: false });
  const texts = labels(rows);
  assert.deepEqual(texts, ["SETUJUI", "UBAH RENCANA", "BALAS", "DETAIL", "TUNDA"]);
  assert.equal(texts.includes("TOLAK"), false, "an undeclared action is not rendered");
  const data = rows.flat().map((b) => b.callback_data);
  assert.ok(data.includes("e:KOL-70"), "edit has its own letter");
  assert.ok(data.includes("b:KOL-70"), "so does response");
});

await t("E2: DETAIL and TUNDA are always there — one only reads, one only says 'not now'", () => {
  const texts = labels(buttonsForActions("KOL-70", { allow_accept: false, allow_edit: false, allow_respond: true, allow_ignore: false }));
  assert.deepEqual(texts, ["BALAS", "DETAIL", "TUNDA"]);
});

await t("E2: buildButtons honours a declaration on the issue", () => {
  const body = buildEscalationActionsCommentBody({ allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true });
  const texts = labels(buildButtons("KOL-70", [comment(body)]));
  assert.deepEqual(texts, ["SETUJUI", "UBAH RENCANA", "BALAS", "TOLAK", "DETAIL", "TUNDA"]);
});

await t("E2: an escalation that declares nothing keeps the card it has today", () => {
  const texts = labels(buildButtons("KOL-70", [comment("no declaration here")]));
  assert.deepEqual(texts, ["SETUJUI", "TOLAK", "DETAIL", "TUNDA"], "a producer that has not been taught to declare loses nothing");
});

await t("E2: a [DECISION OPTIONS] comment still takes precedence over the action flags", () => {
  const options = comment(`[DECISION OPTIONS] ${JSON.stringify({ decision_options: [
    { key: "commit", label: "Commit semuanya" },
    { key: "buang", label: "Buang semuanya" },
  ] })}`);
  const declaration = comment(buildEscalationActionsCommentBody({ allow_accept: true, allow_edit: true }));
  const texts = labels(buildButtons("KOL-66", [options, declaration]));
  assert.deepEqual(texts, ["Commit semuanya", "Buang semuanya"], "named options beat generic actions");
});

// --- edit: the revision comes back as a NEW plan ------------------------------

const VALID_PLAN = [
  "OBJECTIVE: Perbaiki kartu keputusan.",
  "FILES: ops-watcher/telegram-notify.mjs",
  "STEPS:",
  "- Tambahkan keterangan issue ke kartu.",
  "VERIFY: node ops-watcher/run-all-tests.mjs --only telegram.regression.test.mjs",
  "OUT OF SCOPE: Tidak mengubah listener.",
  "RISK: low",
].join("\n");

function fakePaperclip(comments) {
  const posted = [];
  return {
    posted,
    _get: async () => ({ body: comments, networkError: false }),
    _postComment: async (_base, _id, body) => { posted.push(body); return { status: 201, networkError: false }; },
  };
}

await t("E2 edit: a reply to a card that never asked for a revision stays an ordinary note", async () => {
  const pc = fakePaperclip([comment("nothing pending here")]);
  const r = await applyOwnerRevisionIfRequested({
    base: "http://x", issueId: "i1", targetLabel: "KOL-70", msgText: "sebaiknya jangan",
    cardMessageId: 4242, _get: pc._get, _postComment: pc._postComment,
  });
  assert.equal(r, null, "null means: not an edit, handle it as a note");
  assert.equal(pc.posted.length, 0, "and nothing is written");
});

await t("E2 edit: a plan-shaped revision is recorded AND posted as a new plan", async () => {
  const pc = fakePaperclip([comment(buildEditRequestedCommentBody({ shortId: "KOL-70", messageId: 4242 }))]);
  const r = await applyOwnerRevisionIfRequested({
    base: "http://x", issueId: "i1", targetLabel: "KOL-70", msgText: VALID_PLAN,
    cardMessageId: 4242, _get: pc._get, _postComment: pc._postComment,
  });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, "owner-revision-planned");
  assert.equal(pc.posted.length, 2, "the revision verbatim, then the new plan");
  assert.ok(pc.posted[0].startsWith(OWNER_REVISION_MARKER), "his words are kept verbatim under their own marker");
  assert.ok(pc.posted[1].includes("DIRECTIVE PLAN"), "and the plan is a real plan comment");
  assert.ok(pc.posted[1].includes("OBJECTIVE: Perbaiki kartu keputusan."), "carrying what he wrote");
  assert.match(r.ack, /tidak dijalankan/, "he is told the original will not run");
});

await t("E2 edit: a revision that is not in plan shape is kept, but never posted as a plan", async () => {
  const pc = fakePaperclip([comment(buildEditRequestedCommentBody({ shortId: "KOL-70", messageId: 4242 }))]);
  const r = await applyOwnerRevisionIfRequested({
    base: "http://x", issueId: "i1", targetLabel: "KOL-70", msgText: "jangan sentuh file itu, pakai yang lain",
    cardMessageId: 4242, _get: pc._get, _postComment: pc._postComment,
  });
  assert.equal(r.outcome, "owner-revision-recorded");
  assert.equal(pc.posted.length, 1, "an unparseable plan comment would burn the runner's plan attempts");
  assert.ok(pc.posted[0].startsWith(OWNER_REVISION_MARKER));
  assert.match(r.ack, /rencana lama tetap tidak dijalankan/);
});

await t("E2 edit: a failed revision post is reported, not swallowed", async () => {
  const r = await applyOwnerRevisionIfRequested({
    base: "http://x", issueId: "i1", targetLabel: "KOL-70", msgText: VALID_PLAN, cardMessageId: 4242,
    _get: async () => ({ body: [comment(buildEditRequestedCommentBody({ shortId: "KOL-70", messageId: 4242 }))], networkError: false }),
    _postComment: async () => ({ networkError: true, networkErrorMessage: "ECONNREFUSED" }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.outcome, "owner-revision-failed");
});

await t("E2 edit: one request is consumed by one revision", () => {
  const request = comment(buildEditRequestedCommentBody({ shortId: "KOL-70", messageId: 4242 }), "2026-09-05T00:01:00.000Z");
  const revision = comment(buildOwnerRevisionCommentBody({ shortId: "KOL-70", revision: "..." }), "2026-09-05T00:02:00.000Z");
  assert.ok(pendingEditRequest([request], 4242), "a request with no revision after it is pending");
  // Newest first: the revision precedes the request it consumed.
  assert.equal(pendingEditRequest([revision, request], 4242), null, "a second reply is an ordinary note again");
});

await t("E2 edit: a request belonging to a DIFFERENT card is not consumed by this reply", () => {
  const request = comment(buildEditRequestedCommentBody({ shortId: "KOL-70", messageId: 1111 }));
  assert.equal(pendingEditRequest([request], 2222), null);
  assert.ok(pendingEditRequest([request], 1111));
  assert.ok(pendingEditRequest([request], null), "no card id known: the newest request stands");
});

await t("E2: every flag name is the one agent-inbox uses", () => {
  assert.deepEqual([...ACTION_FLAGS], ["allow_accept", "allow_edit", "allow_respond", "allow_ignore"]);
  assert.equal(EDIT_REQUESTED_MARKER.startsWith("["), true, "markers stay in the house shape");
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
