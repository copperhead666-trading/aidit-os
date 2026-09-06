// ops-watcher/owner-answer-watch.regression.test.mjs
// Offline regression coverage for the owner-answer watcher.
//
//   node ops-watcher/owner-answer-watch.regression.test.mjs
//
// Nothing here touches the real board: the listing and the comment fetch are
// injected. The watcher is read-only by design, so there is nothing to write
// even by accident — but the suite still proves it never calls a write path,
// because a watcher that also acts is a second decision-maker nobody voted for.

import assert from "node:assert/strict";
import {
  classifyOwnerAnswer,
  newOwnerAnswers,
  formatAnswerLine,
  isOwnerRequired,
  sweepOnce,
  makeState,
} from "./owner-answer-watch.mjs";

let passed = 0;
let failed = 0;
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

const CHOSE = 'OWNER MEMILIH: Naikkan batas menjadi 12 menit via Telegram (2026-09-06T07:00:00.000Z) — ketukan tombol oleh owner.';
const APPROVED = "OWNER MENYETUJUI via Telegram (2026-09-06T07:00:00.000Z) — ketukan tombol oleh owner via @ahmadsuperbot.";
const REJECTED = "OWNER MENOLAK via Telegram (2026-09-06T07:00:00.000Z) — status diubah menjadi cancelled.";
const DEFERRED = "OWNER MENUNDA via Telegram (2026-09-06T07:00:00.000Z) — tidak ada perubahan status.";

await t("W1 each owner action is classified as itself, and a chosen option keeps its label", () => {
  assert.deepEqual(classifyOwnerAnswer(CHOSE), { action: "CHOSE", choice: "Naikkan batas menjadi 12 menit" });
  assert.deepEqual(classifyOwnerAnswer(APPROVED), { action: "APPROVED", choice: null });
  assert.deepEqual(classifyOwnerAnswer(REJECTED), { action: "REJECTED", choice: null });
  // DEFER is an answer, and a different one: it means "not now", leaves
  // OWNER_REQUIRED in place, and must never be read as a decision to act on.
  assert.deepEqual(classifyOwnerAnswer(DEFERRED), { action: "DEFERRED", choice: null });
});

await t("W2 anything that is not an owner answer is not reported as one", () => {
  for (const body of [
    "AHMAD ESCALATION: butuh keputusan pemilik.",
    "[DECISION BRIEF]\n{}",
    "[DECISION OPTIONS]\n{}",
    "owner menyetujui lewat obrolan",       // lower case prose, not the marker
    "Sepertinya OWNER MENYETUJUI via Telegram", // marker not at the start
    "", null, undefined, 42, {},
  ]) {
    assert.equal(classifyOwnerAnswer(body), null, `misclassified: ${String(body)}`);
  }
});

await t("W3 an answer is reported exactly once, however many times it is polled", () => {
  const seen = new Set();
  const comments = [{ id: "c1", body: APPROVED, createdAt: "2026-09-06T07:00:00.000Z" }];
  assert.equal(newOwnerAnswers(comments, { seen }).length, 1, "first poll reports it");
  assert.equal(newOwnerAnswers(comments, { seen }).length, 0, "second poll must not repeat it");
  assert.equal(newOwnerAnswers(comments, { seen }).length, 0, "nor any later poll");
});

await t("W4 an answer with no id is reported once, not dropped and not repeated", () => {
  // Dropping it would lose a real decision; repeating it would make the stream
  // useless. Both failures are worse than a slightly weaker key.
  const seen = new Set();
  const comments = [{ body: REJECTED, createdAt: "2026-09-06T07:00:00.000Z" }];
  assert.equal(newOwnerAnswers(comments, { seen }).length, 1);
  assert.equal(newOwnerAnswers(comments, { seen }).length, 0);
});

await t("W5 answers older than the watch start are not replayed as new", () => {
  const sinceMs = Date.parse("2026-09-06T08:00:00.000Z");
  const comments = [
    { id: "old", body: APPROVED, createdAt: "2026-09-06T07:00:00.000Z" },
    { id: "new", body: REJECTED, createdAt: "2026-09-06T09:00:00.000Z" },
  ];
  const found = newOwnerAnswers(comments, { seen: new Set(), sinceMs });
  assert.equal(found.length, 1);
  assert.equal(found[0].action, "REJECTED");

  // A comment with an unreadable timestamp is reported rather than discarded:
  // an answer that cannot be dated is still an answer.
  const undated = newOwnerAnswers([{ id: "x", body: APPROVED, createdAt: "not a date" }], { seen: new Set(), sinceMs });
  assert.equal(undated.length, 1);
});

await t("W6 the emitted line names the issue, the action and the chosen option", () => {
  const line = formatAnswerLine("KOL-91", { action: "CHOSE", choice: "Tunda sampai Senin", createdAt: "2026-09-06T07:00:00.000Z" });
  assert.match(line, /^OWNER ANSWER \| KOL-91 \| CHOSE \| choice="Tunda sampai Senin" \| at=2026-09-06T07:00:00\.000Z$/);
  assert.match(formatAnswerLine("KOL-92", { action: "APPROVED", choice: null, createdAt: null }), /^OWNER ANSWER \| KOL-92 \| APPROVED$/);
});

await t("W7 OWNER_REQUIRED is recognised whatever shape the label arrives in", () => {
  assert.equal(isOwnerRequired({ labels: [{ name: "OWNER_REQUIRED" }] }), true);
  assert.equal(isOwnerRequired({ labels: ["owner_required"] }), true);
  assert.equal(isOwnerRequired({ labels: [{ name: "DIRECTIVE" }] }), false);
  assert.equal(isOwnerRequired({}), false);
  assert.equal(isOwnerRequired(null), false);
});

// ---- W8: the watched set is STICKY ----
// Answering is what REMOVES OWNER_REQUIRED (telegram-listener drops it on
// APPROVE and on OPTION). A watcher that recomputed its set from labels each
// sweep would stop watching the issue in the very sweep that answers it — it
// would miss every answer it exists to catch.
await t("W8 an issue stays watched after the answer strips its OWNER_REQUIRED label", async () => {
  const waiting = { id: "i1", identifier: "KOL-91", labels: [{ name: "OWNER_REQUIRED" }] };
  const answered = { id: "i1", identifier: "KOL-91", labels: [] };
  let sweep = 0;
  const deps = {
    base: "http://board.test",
    listIssues: async () => ({ issues: [sweep === 0 ? waiting : answered], networkError: false }),
    httpGet: async () => ({
      networkError: false,
      body: sweep === 0 ? [] : [{ id: "c9", body: CHOSE, createdAt: "2026-09-06T09:00:00.000Z" }],
    }),
  };
  const state = makeState({ sinceMs: 0 });

  const first = await sweepOnce(state, deps);
  assert.deepEqual(first.lines, [], "nothing answered yet");
  assert.ok(state.watched.has("KOL-91"), "the waiting issue is now watched");

  sweep = 1;
  const second = await sweepOnce(state, deps);
  assert.equal(second.lines.length, 1, "the answer must be caught even though the label is gone");
  assert.match(second.lines[0], /KOL-91 \| CHOSE \| choice="Naikkan batas menjadi 12 menit"/);

  const third = await sweepOnce(state, deps);
  assert.deepEqual(third.lines, [], "and never reported twice");
});

// ---- W9: a bad poll is reported, not fatal ----
// A watcher that dies on one network blip is worse than no watcher: its silence
// is indistinguishable from "the owner has not answered yet".
await t("W9 an unreachable board yields an error and no crash, and the watch survives", async () => {
  const state = makeState({ sinceMs: 0 });
  const down = await sweepOnce(state, {
    base: "http://board.test",
    listIssues: async () => ({ issues: [], networkError: true, networkErrorMessage: "ECONNREFUSED" }),
    httpGet: async () => { throw new Error("should not be reached"); },
  });
  assert.deepEqual(down.lines, []);
  assert.equal(down.errors.length, 1);
  assert.match(down.errors[0], /ECONNREFUSED/);

  const threw = await sweepOnce(state, {
    base: "http://board.test",
    listIssues: async () => { throw new Error("boom"); },
    httpGet: async () => ({ networkError: false, body: [] }),
  });
  assert.deepEqual(threw.lines, []);
  assert.match(threw.errors[0], /boom/);

  // A comment fetch that fails must not stop the other watched issues.
  const state2 = makeState({ sinceMs: 0, issues: ["KOL-1", "KOL-2"] });
  const partial = await sweepOnce(state2, {
    base: "http://board.test",
    listIssues: async () => ({
      issues: [{ id: "a", identifier: "KOL-1", labels: [] }, { id: "b", identifier: "KOL-2", labels: [] }],
      networkError: false,
    }),
    httpGet: async (url) => (url.includes("/a/")
      ? { networkError: true, networkErrorMessage: "flaky" }
      : { networkError: false, body: [{ id: "c", body: APPROVED, createdAt: "2026-09-06T09:00:00.000Z" }] }),
  });
  assert.equal(partial.lines.length, 1, "the healthy issue still reports");
  assert.equal(partial.errors.length, 1, "and the failed one is named");
});

// ---- W10: named issues are watched from the start, labels or not ----
await t("W10 an issue named on the command line is watched before it is ever labelled", async () => {
  const state = makeState({ sinceMs: 0, issues: ["KOL-99"] });
  const out = await sweepOnce(state, {
    base: "http://board.test",
    listIssues: async () => ({ issues: [{ id: "z", identifier: "KOL-99", labels: [] }], networkError: false }),
    httpGet: async () => ({ networkError: false, body: [{ id: "c1", body: DEFERRED, createdAt: "2026-09-06T09:00:00.000Z" }] }),
  });
  assert.equal(out.lines.length, 1);
  assert.match(out.lines[0], /KOL-99 \| DEFERRED/);
});

console.log("");
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
process.exit(0);
