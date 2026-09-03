// ops-watcher/needs-owner.regression.test.mjs
// Offline regression coverage for the single "is the owner waiting on this?"
// rule. NO network, NO Paperclip: every input is a literal object and the clock
// is injected. Run with:
//   node ops-watcher/needs-owner.regression.test.mjs

import assert from "node:assert/strict";
import {
  needsOwner,
  waitingOnOwner,
  reachableByCard,
  asksOwnerByTitle,
  labelNamesOf,
  NOISE_MIN_AGE_MS,
} from "./needs-owner.mjs";

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

// ── The gap this module exists to close ────────────────────────────────

function t1_unlabelledDecisionTitlesAreWaiting() {
  // The eight that were invisible on 2026-09-03, none of which carried a label.
  const titles = [
    "APPROVE: start real work on SJS SuperApps now?",
    "P4 DECISION NEEDED: Health OS -- storage, wearable ingestion, dashboard",
    "DECISION: Caveman Meta-Monitor Agent -- built twice, which version?",
    "FYI/DECISION: SJS HRD KPI commission rules need your input",
    "DECISION NEEDED: pick one",
  ];
  for (const title of titles) {
    const v = needsOwner(issue({ title }), { now });
    assert.equal(v.waiting, true, `T1: "${title}" must be waiting on the owner`);
    assert.equal(v.reason, "title", "T1: reason names the title rule");
  }
  ok("T1: unlabelled decision titles are waiting — the 2026-09-03 blind spot");
}

function t2_labelStillWins() {
  const v = needsOwner(issue({ title: "no prefix here", labels: [{ name: "OWNER_REQUIRED" }] }), { now });
  assert.equal(v.waiting, true, "T2: the label alone is enough");
  assert.equal(v.reason, "label", "T2: reason names the label rule");
  ok("T2: the existing label rule is preserved, not replaced");
}

function t3_labelIdsResolveThroughTheMap() {
  const idToName = new Map([["uuid-a", "OWNER_REQUIRED"]]);
  const bare = issue({ title: "plain", labelIds: ["uuid-a"] });
  assert.equal(needsOwner(bare, { now }).waiting, false, "T3: without the map the id means nothing");
  assert.equal(needsOwner(bare, { idToName, now }).waiting, true, "T3: with the map it resolves");
  ok("T3: labelIds resolve through the id->name map, ids alone do not");
}

function t4_planUndecidedIsWaitingWithoutLabelOrPrefix() {
  const v = needsOwner(issue({ title: "no prefix" }), { planUndecided: true, now });
  assert.equal(v.waiting, true, "T4: an undecided plan is waiting even with no label and no prefix");
  assert.equal(v.reason, "plan-undecided", "T4: reason names the plan rule");
  ok("T4: a posted plan with no decision after it is waiting on the owner");
}

// ── The things that must NOT be waiting ────────────────────────────────

function t5_terminalStatusIsNeverWaiting() {
  for (const status of ["done", "cancelled"]) {
    const v = needsOwner(issue({ title: "APPROVE: anything?", status, labels: [{ name: "OWNER_REQUIRED" }] }), { now });
    assert.equal(v.waiting, false, `T5: status ${status} is finished, nobody is waiting`);
    assert.equal(v.reason, "terminal", "T5: reason names the terminal check");
  }
  ok("T5: done and cancelled are never waiting, label and prefix notwithstanding");
}

function t6_alreadyRejectedIsNotWaiting() {
  const v = needsOwner(issue({ title: "APPROVE: x?", labels: [{ name: "OWNER_REJECTED" }] }), { now });
  assert.equal(v.waiting, false, "T6: the owner already said no");
  assert.equal(v.reason, "already-rejected", "T6: reason says so");
  ok("T6: an already-rejected issue does not come back as waiting");
}

function t7_lowercasePrefixIsNotARoutingPrefix() {
  const v = needsOwner(issue({ title: "approve: this is prose, not a prefix" }), { now });
  assert.equal(v.waiting, false, "T7: matching is case-sensitive on purpose");
  ok("T7: lowercase 'approve:' in prose is not a routing prefix");
}

// ── Suspected noise: evidence, never wording ───────────────────────────

function t8_strayChatterIsFlaggedButStillWaiting() {
  // KOL-27 "oke", KOL-28 "gua udh kirim nih bro": the owner's own messages,
  // wrapped by the listener, nothing ever happened to them.
  const v = needsOwner(
    issue({ title: "OWNER DIRECTIVE: oke", status: "backlog", createdAt: daysAgo(5) }),
    { commentCount: 0, now },
  );
  assert.equal(v.suspectedNoise, true, "T8: no activity for days is the signal");
  assert.equal(v.waiting, true, "T8: flagged, but still surfaced — never auto-dropped");
  ok("T8: stray chatter is flagged as suspected noise and still reported as waiting");
}

function t9_shortTitleWithActivityIsNotNoise() {
  // "openjarvis github" is 17 characters and entirely real; "gua udh kirim nih
  // bro" is 21 and is not. Length cannot separate them — activity can.
  const v = needsOwner(
    issue({ title: "OWNER DIRECTIVE: openjarvis github", status: "todo", createdAt: daysAgo(5) }),
    { commentCount: 4, now },
  );
  assert.equal(v.suspectedNoise, false, "T9: something happened to it, so it is not noise");
  assert.equal(v.waiting, true, "T9: still waiting");
  ok("T9: a short title with real activity is never flagged as noise");
}

function t10_freshAndEmptyIsNotYetNoise() {
  const v = needsOwner(
    issue({ title: "OWNER DIRECTIVE: oke", status: "backlog", createdAt: daysAgo(1) }),
    { commentCount: 0, now },
  );
  assert.equal(v.suspectedNoise, false, "T10: a day old with no comments is just new");
  ok("T10: silence younger than the threshold is not yet suspected noise");
}

function t11_noiseNeedsTheAgeThreshold() {
  const justUnder = needsOwner(
    issue({ title: "OWNER DIRECTIVE: oke", status: "backlog", createdAt: new Date(NOW - NOISE_MIN_AGE_MS + 1000).toISOString() }),
    { commentCount: 0, now },
  );
  const justOver = needsOwner(
    issue({ title: "OWNER DIRECTIVE: oke", status: "backlog", createdAt: new Date(NOW - NOISE_MIN_AGE_MS - 1000).toISOString() }),
    { commentCount: 0, now },
  );
  assert.equal(justUnder.suspectedNoise, false, "T11: one second under the threshold is not noise");
  assert.equal(justOver.suspectedNoise, true, "T11: one second over it is");
  ok("T11: the noise threshold is a real boundary, not a vibe");
}

function t12_unknownCommentCountNeverFlagsNoise() {
  const v = needsOwner(
    issue({ title: "OWNER DIRECTIVE: oke", status: "backlog", createdAt: daysAgo(9) }),
    { commentCount: null, now },
  );
  assert.equal(v.suspectedNoise, false, "T12: not knowing is not the same as knowing it is empty");
  ok("T12: an unknown comment count never produces a noise flag");
}

// ── Set operations, and the reconciliation that depends on them ────────

function t13_theLiveGapIsReproduced() {
  // Three carry the label; four more ask by title. Today's notifier can only
  // serve the three, and that difference is the whole bug.
  const board = [
    issue({ identifier: "KOL-29", title: "OWNER DIRECTIVE: retest", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-30", title: "OWNER DIRECTIVE: acceptance", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-67", title: "FYI/DECISION: KPI rules", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-62", title: "APPROVE: start real work on SJS SuperApps now?" }),
    issue({ identifier: "KOL-63", title: "APPROVE: start real work on Caveman Trading OS now?" }),
    issue({ identifier: "KOL-50", title: "P4 DECISION NEEDED: Health OS" }),
    issue({ identifier: "KOL-65", title: "DECISION: which version?" }),
    issue({ identifier: "KOL-99", title: "just some work", status: "in_progress" }),
    issue({ identifier: "KOL-98", title: "APPROVE: old thing?", status: "done" }),
  ];
  const waiting = waitingOnOwner(board, { now }).map((r) => r.identifier);
  const reachable = reachableByCard(board);
  assert.deepEqual(
    waiting,
    ["KOL-29", "KOL-30", "KOL-50", "KOL-62", "KOL-63", "KOL-65", "KOL-67"],
    "T13: every decision is counted, labelled or not",
  );
  assert.deepEqual(reachable, ["KOL-29", "KOL-30", "KOL-67"], "T13: only the labelled three can get a card today");
  const unreachable = waiting.filter((id) => !reachable.includes(id));
  assert.deepEqual(unreachable, ["KOL-50", "KOL-62", "KOL-63", "KOL-65"], "T13: the gap is exactly the unlabelled ones");
  ok("T13: reproduces the live 17-vs-3 gap as a set difference");
}

function t14_orderIsStableAndNumeric() {
  const board = [
    issue({ identifier: "KOL-100", title: "APPROVE: a?" }),
    issue({ identifier: "KOL-9", title: "APPROVE: b?" }),
    issue({ identifier: "KOL-62", title: "APPROVE: c?" }),
  ];
  const once = waitingOnOwner(board, { now }).map((r) => r.identifier);
  const twice = waitingOnOwner([...board].reverse(), { now }).map((r) => r.identifier);
  assert.deepEqual(once, ["KOL-9", "KOL-62", "KOL-100"], "T14: numeric order, not lexicographic");
  assert.deepEqual(once, twice, "T14: input order does not change output order");
  ok("T14: the waiting set is numerically sorted and order-stable");
}

// ── Guards against malformed input ─────────────────────────────────────

function t15_malformedInputNeverThrows() {
  for (const bad of [null, undefined, 42, "KOL-1", []]) {
    const v = needsOwner(bad, { now });
    assert.equal(v.waiting, false, "T15: junk is never reported as waiting");
  }
  assert.deepEqual(waitingOnOwner(null, { now }), [], "T15: a non-array board is empty, not a throw");
  assert.deepEqual(labelNamesOf(null), [], "T15: labels off nothing is empty");
  assert.equal(asksOwnerByTitle(null), false, "T15: a null title asks nobody");
  ok("T15: malformed input is answered, never thrown on");
}

function t16_duplicateLabelNamesCollapse() {
  const idToName = new Map([["a", "OWNER_REQUIRED"]]);
  const names = labelNamesOf({ labels: [{ name: "OWNER_REQUIRED" }], labelIds: ["a"] }, idToName);
  assert.deepEqual(names, ["OWNER_REQUIRED"], "T16: the same label from both shapes appears once");
  ok("T16: a label present as both an object and an id collapses to one name");
}

async function main() {
  const tests = [
    t1_unlabelledDecisionTitlesAreWaiting,
    t2_labelStillWins,
    t3_labelIdsResolveThroughTheMap,
    t4_planUndecidedIsWaitingWithoutLabelOrPrefix,
    t5_terminalStatusIsNeverWaiting,
    t6_alreadyRejectedIsNotWaiting,
    t7_lowercasePrefixIsNotARoutingPrefix,
    t8_strayChatterIsFlaggedButStillWaiting,
    t9_shortTitleWithActivityIsNotNoise,
    t10_freshAndEmptyIsNotYetNoise,
    t11_noiseNeedsTheAgeThreshold,
    t12_unknownCommentCountNeverFlagsNoise,
    t13_theLiveGapIsReproduced,
    t14_orderIsStableAndNumeric,
    t15_malformedInputNeverThrows,
    t16_duplicateLabelNamesCollapse,
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
