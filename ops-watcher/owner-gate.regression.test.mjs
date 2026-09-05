// ops-watcher/owner-gate.regression.test.mjs
// E3 — no path reaches the owner without passing the brief gate.
//
//   node ops-watcher/owner-gate.regression.test.mjs
//
// The measurement this exists for: decision-brief.mjs validates five slots and
// refuses what is empty, and exactly TWO files routed through it. Everything
// else landed on the owner's surface unchecked, which is why he was approving
// titles. These tests hold every producer to the same validator — including the
// templates the producers themselves generate, which is where an unvalidated
// slot would come back.

import assert from "node:assert/strict";
import { gateOwnerEscalation, postGatedBrief, unknownSlot } from "./owner-gate.mjs";
import { REQUIRED_SLOTS, validateDecisionBrief } from "./decision-brief.mjs";
import { blockedIssueBrief } from "./escalation-sec.mjs";
import { attemptCapBrief, executionCapBrief } from "./directive-runner.mjs";

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

const ISSUE = { id: "i1", identifier: "KOL-70", status: "blocked", title: "Deploy menunggu kredensial" };

await t("E3: every producer's own brief template passes the same validator", () => {
  const templates = {
    "escalation-sec (blocked issue)": blockedIssueBrief(ISSUE, "Menunggu kredensial dari pemilik sebelum deploy dapat dilanjutkan."),
    "escalation-sec (no explanation at all)": blockedIssueBrief(ISSUE, ""),
    "directive-runner (plan attempt cap)": attemptCapBrief({ issue: ISSUE, attempts: 2, failure: { reason: "parse-failed" } }),
    "directive-runner (execution cap)": executionCapBrief({ issue: ISSUE, attempts: 2, reason: "verify-red" }),
  };
  for (const [producer, brief] of Object.entries(templates)) {
    const v = validateDecisionBrief(brief);
    assert.equal(v.ok, true, `${producer} must pass the gate it is now routed through: ${JSON.stringify(v.reasons || [])}`);
    for (const slot of REQUIRED_SLOTS) {
      assert.ok(brief[slot] !== undefined && brief[slot] !== null && brief[slot] !== "", `${producer} left ${slot} empty`);
    }
  }
});

await t("E3: a producer that cannot fill a slot writes THE FACT in the slot", () => {
  const text = unknownSlot("escalation-sec", "sapuan ini tidak menganalisis penyebab hambatan");
  assert.match(text, /Belum diketahui oleh escalation-sec/);
  assert.match(text, /tidak menganalisis penyebab/);
  // It must survive the validator's "empty in disguise" check, which is the
  // whole point: "n/a" and "-" are refused, a stated unknown is not.
  const brief = blockedIssueBrief(ISSUE, "Menunggu kredensial pemilik.");
  assert.match(brief.rekomendasi.alasan, /Belum diketahui oleh/);
  assert.equal(validateDecisionBrief(brief).ok, true);
});

await t("E3: an incomplete brief is refused, and the refusal names the slots", () => {
  const gated = gateOwnerEscalation({ pertanyaan: "Apa yang harus dilakukan?" }, { producer: "test-producer" });
  assert.equal(gated.ok, false);
  assert.ok(gated.missing.includes("yang_sudah_ada"), gated.missing.join(", "));
  assert.ok(gated.missing.includes("pilihan"));
  assert.match(gated.refusalComment, /ESCALATION REFUSED \(test-producer\)/);
  assert.match(gated.refusalComment, /NOT put in front of the owner/);
});

await t("E3: a valid brief becomes the same [DECISION BRIEF] comment ahmad-escalate posts", () => {
  const gated = gateOwnerEscalation(blockedIssueBrief(ISSUE, "Menunggu kredensial pemilik untuk melanjutkan."), { producer: "escalation-sec" });
  assert.equal(gated.ok, true);
  assert.ok(gated.commentBody.startsWith("[DECISION BRIEF]"), "one marker line and one JSON object — no second scheme");
  const parsed = JSON.parse(gated.commentBody.slice("[DECISION BRIEF]".length));
  assert.ok(parsed.decision_brief, "the JSON carries the brief under its own key");
  assert.equal(parsed.decision_brief.pilihan.length >= 2, true);
});

await t("E3: postGatedBrief writes the brief when valid", async () => {
  const posted = [];
  const r = await postGatedBrief({
    base: "http://x", issueId: "i1",
    brief: attemptCapBrief({ issue: ISSUE, attempts: 2, failure: { reason: "parse-failed" } }),
    producer: "directive-runner",
    postComment: async (_b, _i, body) => { posted.push(body); return { status: 201, networkError: false }; },
  });
  assert.equal(r.ok, true);
  assert.equal(r.posted, true);
  assert.equal(posted.length, 1);
  assert.ok(posted[0].startsWith("[DECISION BRIEF]"));
});

await t("E3: postGatedBrief writes the REFUSAL when the brief is incomplete", async () => {
  const posted = [];
  const r = await postGatedBrief({
    base: "http://x", issueId: "i1",
    brief: { pertanyaan: "Apa?" },
    producer: "some-producer",
    postComment: async (_b, _i, body) => { posted.push(body); return { status: 201, networkError: false }; },
  });
  assert.equal(r.ok, false, "the escalation does not proceed");
  assert.equal(posted.length, 1, "but the attempt IS on the record");
  assert.match(posted[0], /^ESCALATION REFUSED/);
});

await t("E3: a brief that does not land is reported, never assumed", async () => {
  const r = await postGatedBrief({
    base: "http://x", issueId: "i1",
    brief: blockedIssueBrief(ISSUE, "Menunggu kredensial pemilik untuk melanjutkan."),
    producer: "escalation-sec",
    postComment: async () => ({ networkError: true, networkErrorMessage: "ECONNREFUSED" }),
  });
  assert.equal(r.ok, true, "the brief itself was fine");
  assert.equal(r.posted, false, "but it is not on the issue, and the caller must not label");
});

await t("E3: a postComment that throws is caught, not propagated into a sweep", async () => {
  const r = await postGatedBrief({
    base: "http://x", issueId: "i1",
    brief: blockedIssueBrief(ISSUE, "Menunggu kredensial pemilik untuk melanjutkan."),
    producer: "escalation-sec",
    postComment: async () => { throw new Error("socket died"); },
  });
  assert.equal(r.posted, false);
  assert.match(r.error, /socket died/);
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
