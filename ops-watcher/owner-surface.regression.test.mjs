// ops-watcher/owner-surface.regression.test.mjs
// Offline coverage for the card-vs-digest split. NO network, NO Paperclip: every
// input is a literal object and the clock is injected. Run with:
//   node ops-watcher/owner-surface.regression.test.mjs

import assert from "node:assert/strict";
import { surfaceFor, cardWorthy, buildDigest, renderDigest, SURFACE, OVERDUE_MS } from "./owner-surface.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`  ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

const NOW = Date.parse("2026-09-03T02:00:00.000Z");
const now = () => NOW;
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function issue(over = {}) {
  return {
    identifier: "KOL-1",
    title: "something",
    status: "todo",
    labels: [],
    labelIds: [],
    createdAt: daysAgo(1),
    ...over,
  };
}

// ── The split, which is the whole point of this module ─────────────────

function t1_labelledIssuesStillGetTheirOwnCard() {
  // This is today's behaviour and it must not change: widening what counts as
  // waiting must not change what interrupts the owner.
  const v = surfaceFor(issue({ labels: [{ name: "OWNER_REQUIRED" }] }), { now });
  assert.equal(v.surface, SURFACE.CARD, "T1: an escalated issue still interrupts");
  assert.equal(cardWorthy(issue({ labels: [{ name: "OWNER_REQUIRED" }] }), { now }), true, "T1: cardWorthy agrees");
  ok("T1: a labelled issue still gets its own card — today's behaviour preserved");
}

function t2_undecidedPlanInterrupts() {
  const v = surfaceFor(issue({ title: "no prefix" }), { planUndecided: true, now });
  assert.equal(v.surface, SURFACE.CARD, "T2: the runner asked and stopped; that interrupts");
  ok("T2: a posted plan awaiting a yes gets its own card");
}

function t3_backlogTitlesGoToTheDigestNotTheFlood() {
  // The fourteen that were invisible. Making them visible must not mean making
  // them fourteen notifications.
  for (const title of [
    "APPROVE: start real work on SJS SuperApps now?",
    "P4 DECISION NEEDED: Health OS -- storage",
    "DECISION: which version?",
    "FYI/DECISION: KPI rules",
  ]) {
    const v = surfaceFor(issue({ title }), { now });
    assert.equal(v.surface, SURFACE.DIGEST, `T3: "${title}" is summarised, not fired at him`);
    assert.equal(cardWorthy(issue({ title }), { now }), false, "T3: cardWorthy says no");
  }
  ok("T3: unlabelled backlog decisions go to the digest, never a card burst");
}

function t4_theLiveBoardSplitsThreeAndFourteen() {
  // The shape of the real 2026-09-03 board: 3 labelled, the rest by title.
  const board = [
    issue({ identifier: "KOL-29", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-30", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-67", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-50", title: "P4 DECISION NEEDED: Health OS" }),
    issue({ identifier: "KOL-52", title: "P4 DECISION NEEDED: Lawyer Copilot" }),
    issue({ identifier: "KOL-62", title: "APPROVE: SJS now?" }),
    issue({ identifier: "KOL-63", title: "APPROVE: Trading now?" }),
  ];
  const s = buildDigest(board, { now });
  assert.equal(s.total, 7, "T4: everything waiting is counted");
  assert.equal(s.cards.length, 3, "T4: exactly the labelled three interrupt");
  assert.equal(s.digest.length, 4, "T4: the rest are summarised");
  ok("T4: nothing invisible, and only the escalated ones interrupt");
}

// ── Ordering, overdue, and the summary itself ──────────────────────────

function t5_oldestFirstWithinEachSurface() {
  const board = [
    issue({ identifier: "KOL-A", title: "APPROVE: a?", createdAt: daysAgo(1) }),
    issue({ identifier: "KOL-B", title: "APPROVE: b?", createdAt: daysAgo(9) }),
    issue({ identifier: "KOL-C", title: "APPROVE: c?", createdAt: daysAgo(4) }),
  ];
  const s = buildDigest(board, { now });
  assert.deepEqual(s.digest.map((r) => r.identifier), ["KOL-B", "KOL-C", "KOL-A"], "T5: oldest first");
  assert.equal(s.oldest.identifier, "KOL-B", "T5: the oldest is named");
  ok("T5: the summary is ordered oldest first and names the oldest");
}

function t6_overdueIsARealBoundary() {
  const under = buildDigest(
    [issue({ title: "APPROVE: x?", createdAt: new Date(NOW - OVERDUE_MS + 1000).toISOString() })],
    { now },
  );
  const over = buildDigest(
    [issue({ title: "APPROVE: x?", createdAt: new Date(NOW - OVERDUE_MS - 1000).toISOString() })],
    { now },
  );
  assert.equal(under.overdue, 0, "T6: one second under four days is not overdue");
  assert.equal(over.overdue, 1, "T6: one second over it is");
  ok("T6: the overdue threshold is a real boundary, not a vibe");
}

function t7_emptyBoardSaysSoPlainly() {
  const text = renderDigest(buildDigest([], { now }));
  assert.match(text, /nggak ada yang nunggu/i, "T7: an empty morning says nothing is waiting");
  assert.equal(text.includes("undefined"), false, "T7: no placeholder leaks into the message");
  ok("T7: an empty board produces a plain, complete sentence");
}

function t8_theMessageCarriesTheNumbersThatMatter() {
  const board = [
    issue({ identifier: "KOL-29", labels: [{ name: "OWNER_REQUIRED" }], createdAt: daysAgo(5) }),
    issue({ identifier: "KOL-62", title: "APPROVE: SJS now?", createdAt: daysAgo(2) }),
    issue({ identifier: "KOL-50", title: "P4 DECISION NEEDED: Health OS", createdAt: daysAgo(9) }),
  ];
  const text = renderDigest(buildDigest(board, { now }), { cockpitUrl: "https://example.invalid/" });
  assert.match(text, /^3 nunggu keputusan lo\./m, "T8: the count leads");
  assert.match(text, /2 udah lewat 4 hari/, "T8: overdue is called out");
  assert.match(text, /Paling lama: KOL-50, 9 hari/, "T8: the oldest is named with its age");
  assert.match(text, /1 udah gua kirimin kartunya/, "T8: says how many already interrupted him");
  assert.match(text, /example\.invalid/, "T8: the cockpit link is included when given");
  ok("T8: the morning message carries count, overdue, oldest, and the link");
}

function t9_suspectedNoiseIsOfferedNotHidden() {
  const board = [
    issue({ identifier: "KOL-27", title: "OWNER DIRECTIVE: oke", status: "backlog", createdAt: daysAgo(7) }),
  ];
  const s = buildDigest(board, { now, commentCounts: new Map([["KOL-27", 0]]) });
  assert.equal(s.total, 1, "T9: it is still counted as waiting, never dropped");
  assert.deepEqual(s.suspectedNoise, ["KOL-27"], "T9: and it is flagged");
  const text = renderDigest(s);
  assert.match(text, /kekirim nggak sengaja \(KOL-27\)/, "T9: the message offers to close it");
  assert.match(text, /tutup aja\?/, "T9: it asks, it does not decide");
  ok("T9: suspected noise is surfaced as a question, never closed automatically");
}

function t10_finishedWorkNeverAppears() {
  const board = [
    issue({ identifier: "KOL-98", title: "APPROVE: old?", status: "done" }),
    issue({ identifier: "KOL-97", title: "APPROVE: older?", status: "cancelled" }),
  ];
  const s = buildDigest(board, { now });
  assert.equal(s.total, 0, "T10: finished work is not waiting on anybody");
  ok("T10: done and cancelled never reach either surface");
}

function t11_malformedInputIsAnsweredNotThrownOn() {
  assert.equal(buildDigest(null, { now }).total, 0, "T11: a non-array board is empty");
  assert.equal(buildDigest([null, 42, {}], { now }).total, 0, "T11: junk rows are skipped");
  assert.equal(surfaceFor(null, { now }).surface, SURFACE.NONE, "T11: nothing is on no surface");
  ok("T11: malformed input is answered, never thrown on");
}

async function main() {
  const tests = [
    t1_labelledIssuesStillGetTheirOwnCard,
    t2_undecidedPlanInterrupts,
    t3_backlogTitlesGoToTheDigestNotTheFlood,
    t4_theLiveBoardSplitsThreeAndFourteen,
    t5_oldestFirstWithinEachSurface,
    t6_overdueIsARealBoundary,
    t7_emptyBoardSaysSoPlainly,
    t8_theMessageCarriesTheNumbersThatMatter,
    t9_suspectedNoiseIsOfferedNotHidden,
    t10_finishedWorkNeverAppears,
    t11_malformedInputIsAnsweredNotThrownOn,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (e) {
      bad(t.name, e);
    }
  }
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("regression runner crashed:", e);
  process.exit(1);
});
