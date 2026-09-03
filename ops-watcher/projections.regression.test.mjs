// ops-watcher/projections.regression.test.mjs
// Offline coverage for the fold that replaces three hand-rolled comment
// parsers. NO network, NO Paperclip, NO disk: every input is a literal event
// and the clock is injected. Run with:
//   node ops-watcher/projections.regression.test.mjs

import assert from "node:assert/strict";
import { KINDS } from "./ledger-schema.mjs";
import {
  indexEvents,
  foldDirectives,
  foldDecisions,
  foldDelivery,
  project,
  DEFAULT_STALLED_AFTER_MS,
} from "./projections.mjs";

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

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const now = () => NOW;
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();

/** A tiny event builder so each test reads as a story, not as JSON. */
function log() {
  let seq = 0;
  const events = [];
  return {
    events,
    add(kind, over = {}) {
      seq += 1;
      events.push({
        seq,
        ts: over.ts ?? at(600 - seq),
        kind,
        subject: over.subject ?? "KOL-1",
        actor: over.actor ?? "system",
        source: over.source ?? "runner",
        data: over.data ?? {},
        shadow: over.shadow ?? null,
      });
      return this;
    },
  };
}

/** The usual opening: an issue that is a directive and is not finished. */
function born(l, over = {}) {
  return l.add(KINDS.DIRECTIVE_CREATED, {
    data: { title: over.title ?? "OWNER DIRECTIVE: do the thing", status: over.status ?? "todo", labels: ["DIRECTIVE"] },
    ...over,
  });
}

const stateOf = (events, opts = {}) => foldDirectives(events, { now, ...opts }).get("KOL-1").state;

// ── The six states, each reached the way the real system reaches it ────

function t1_new() {
  const l = log();
  born(l);
  assert.equal(stateOf(l.events), "new", "T1: a fresh directive with no plan is new");
  ok("T1: created, labelled, no plan yet -> new");
}

function t2_awaitingApproval() {
  const l = log();
  born(l).add(KINDS.DIRECTIVE_PLAN_POSTED, { data: { objective: "x" } });
  assert.equal(stateOf(l.events), "awaiting-approval", "T2: a posted plan with no answer is waiting");
  ok("T2: plan posted, nobody answered -> awaiting-approval");
}

function t3_approved() {
  const l = log();
  born(l)
    .add(KINDS.DIRECTIVE_PLAN_POSTED, { data: { objective: "x" } })
    .add(KINDS.DECISION_APPROVED, { actor: "owner", source: "telegram" });
  const rec = foldDirectives(l.events, { now }).get("KOL-1");
  assert.equal(rec.state, "approved", "T3: the owner said yes");
  assert.notEqual(rec.approvedAt, null, "T3: and the moment he said it is recorded");
  ok("T3: plan then approval -> approved, with approvedAt set");
}

function t4_rejectedByOwner() {
  const l = log();
  born(l)
    .add(KINDS.DIRECTIVE_PLAN_POSTED, { data: { objective: "x" } })
    .add(KINDS.DECISION_REJECTED, { actor: "owner", source: "telegram" });
  assert.equal(stateOf(l.events), "rejected", "T4: the owner said no");
  ok("T4: plan then rejection -> rejected");
}

function t5_rejectedBySystemRefusal() {
  const l = log();
  born(l).add(KINDS.DIRECTIVE_PLAN_REFUSED, { data: { reason: "file-scope-out-of-scope" } });
  assert.equal(stateOf(l.events), "rejected", "T5: the system refused its own plan");
  ok("T5: a refused plan -> rejected, without the owner being asked");
}

function t6_done() {
  const l = log();
  born(l)
    .add(KINDS.DIRECTIVE_PLAN_POSTED, { data: { objective: "x" } })
    .add(KINDS.DECISION_APPROVED, { actor: "owner", source: "telegram" })
    .add(KINDS.EXECUTION_DONE, { data: { verified: true } });
  assert.equal(stateOf(l.events), "done", "T6: it ran and verified");
  ok("T6: execution done -> done");
}

function t7_ignoredWithoutTheDirectiveLabel() {
  const l = log();
  l.add(KINDS.DIRECTIVE_CREATED, { data: { title: "just an issue", status: "todo", labels: [] } });
  assert.equal(stateOf(l.events), "ignored", "T7: no DIRECTIVE label, not the runner's business");
  ok("T7: an unlabelled issue -> ignored");
}

function t8_stalledAfterSilence() {
  const l = log();
  born(l).add(KINDS.DISPATCH_CLAIMED, { ts: new Date(NOW - DEFAULT_STALLED_AFTER_MS - 60_000).toISOString() });
  assert.equal(stateOf(l.events), "stalled", "T8: dispatched, then nothing for over six hours");
  ok("T8: a dispatch that left no result and went quiet -> stalled");
}

function t9_silenceJustUnderTheThresholdIsNotStalled() {
  const l = log();
  born(l).add(KINDS.DISPATCH_CLAIMED, { ts: new Date(NOW - DEFAULT_STALLED_AFTER_MS + 60_000).toISOString() });
  assert.notEqual(stateOf(l.events), "stalled", "T9: one minute under the threshold is still working");
  ok("T9: the stall threshold is a real boundary, not a vibe");
}

// ── The two rules that took a production bug each to learn ─────────────

function t10_theOldestDecisionAfterThePlanWins() {
  // directive-runner's findPlanDecision returns the OLDEST decision at or after
  // the plan. Taking the newest instead is how KOL-36 read as approved while
  // the runner considered it rejected.
  const l = log();
  born(l)
    .add(KINDS.DIRECTIVE_PLAN_POSTED, { data: { objective: "x" } })
    .add(KINDS.DECISION_REJECTED, { actor: "owner", source: "telegram" })
    .add(KINDS.DECISION_APPROVED, { actor: "owner", source: "telegram" });
  assert.equal(stateOf(l.events), "rejected", "T10: the first answer after the plan is the answer");
  ok("T10: the OLDEST decision after a plan wins, not the newest");
}

function t11_approvalAfterAnExecutionCapIsStalledNotApproved() {
  // The real KOL-36 bug, fixed in 4c1ca40: the owner taps approve again after
  // the cap report. That is not "approved, run it" — the same plan already
  // failed twice. It has to go back for a new plan.
  const l = log();
  born(l)
    .add(KINDS.DIRECTIVE_PLAN_POSTED, { data: { objective: "x" } })
    .add(KINDS.DECISION_APPROVED, { actor: "owner", source: "telegram" })
    .add(KINDS.EXECUTION_FAILED, { data: { reason: "verify-red" } })
    .add(KINDS.EXECUTION_FAILED, { data: { reason: "verify-red" } })
    .add(KINDS.CAP_EXECUTION_REACHED, { data: { count: 2 } })
    .add(KINDS.DECISION_APPROVED, { actor: "owner", source: "telegram" });
  assert.equal(stateOf(l.events), "stalled", "T11: approving again after the cap must re-plan, not re-run");
  ok("T11: owner approval after an execution cap -> stalled, the KOL-36 fix");
}

// ── Determinism, forward compatibility, and not corrupting the input ───

function t12_shuffledInputProducesAnIdenticalProjection() {
  const l = log();
  born(l)
    .add(KINDS.DIRECTIVE_PLAN_POSTED, { data: { objective: "x" } })
    .add(KINDS.DECISION_APPROVED, { actor: "owner", source: "telegram" })
    .add(KINDS.EXECUTION_STARTED);
  const straight = JSON.stringify([...foldDirectives(l.events, { now })]);
  const shuffled = JSON.stringify([...foldDirectives([...l.events].reverse(), { now })]);
  assert.equal(straight, shuffled, "T12: seq is the authority, not arrival order");
  ok("T12: the same events in any order fold to a byte-identical projection");
}

function t13_orderIsBySeqNotByTimestamp() {
  // Timestamps tie, drift, and arrive out of order. The current system's worst
  // ordering bug is exactly this assumption. seq is the only authority.
  const l = log();
  born(l);
  const same = at(1);
  l.add(KINDS.DIRECTIVE_PLAN_POSTED, { ts: same, data: { objective: "x" } });
  l.add(KINDS.DECISION_APPROVED, { ts: same, actor: "owner", source: "telegram" });
  assert.equal(stateOf(l.events), "approved", "T13: identical timestamps still resolve by seq");
  ok("T13: events sharing a timestamp are ordered by seq, deterministically");
}

function t13b_seqWinsWhenTheClockContradictsIt() {
  // The case that actually distinguishes the two orderings: a later event
  // carrying an EARLIER timestamp. Clock skew, a backfilled import, a machine
  // that slept — all produce this. Sorting by ts here would read the approval
  // as arriving before the plan it approves, and the directive would sit
  // forever in awaiting-approval while the owner swears he already said yes.
  const l = log();
  born(l);
  l.add(KINDS.DIRECTIVE_PLAN_POSTED, { ts: at(10), data: { objective: "x" } });
  l.add(KINDS.DECISION_APPROVED, { ts: at(30), actor: "owner", source: "telegram" });
  assert.equal(
    stateOf(l.events),
    "approved",
    "T13b: seq decides, even when the timestamps say the opposite",
  );
  ok("T13b: a later seq with an earlier timestamp still applies later");
}

function t13c_lastWriteWinsBySeqNotByClock() {
  // The state machine compares seq VALUES, so it shrugs off a bad sort. The
  // fields that fold by last-write-wins do not: status and labels are whatever
  // the final applied event said. Feed two status changes whose seq and clock
  // disagree and the higher seq has to win, or a stale status silently sticks.
  const l = log();
  born(l);
  l.add(KINDS.ISSUE_STATUS_CHANGED, { ts: at(5), data: { status: "in_progress" } });
  l.add(KINDS.ISSUE_STATUS_CHANGED, { ts: at(90), data: { status: "blocked" } });
  const rec = foldDirectives(l.events, { now }).get("KOL-1");
  assert.equal(rec.status, "blocked", "T13c: the last event by seq wins, not the latest clock reading");
  ok("T13c: last-write-wins fields resolve by seq even when the clock disagrees");
}

function t14_anUnknownKindIsCountedNotThrownOn() {
  const l = log();
  born(l);
  l.events.push({ ...l.events[0], seq: 99, kind: "directive.teleported" });
  const idx = indexEvents(l.events);
  assert.equal(idx.unknownKind.get("directive.teleported"), 1, "T14: the unknown kind is counted");
  assert.equal(stateOf(l.events), "new", "T14: and the rest still folds");
  ok("T14: a kind from a newer writer is skipped and counted, never thrown on");
}

function t15_malformedEventsAreCountedNotThrownOn() {
  const l = log();
  born(l);
  const dirty = [null, 42, { seq: "x", kind: KINDS.DIRECTIVE_CREATED }, ...l.events];
  const idx = indexEvents(dirty);
  assert.ok(idx.invalid >= 3, "T15: the junk rows are counted as invalid");
  assert.equal(foldDirectives(dirty, { now }).get("KOL-1").state, "new", "T15: the good rows still fold");
  ok("T15: malformed events are counted and stepped over");
}

function t16_theInputArrayIsNeverMutated() {
  const l = log();
  born(l).add(KINDS.DIRECTIVE_PLAN_POSTED, { data: { objective: "x" } });
  const before = JSON.stringify(l.events);
  project(l.events, { now });
  assert.equal(JSON.stringify(l.events), before, "T16: folding must not touch what it was given");
  ok("T16: neither the input array nor its events are mutated");
}

// ── The projection that carries a fact nothing else has ────────────────

function t17_theTelegramMessageIdMapSurvives() {
  // This mapping exists today ONLY as a "[TELEGRAM SENT] message_id=N" comment
  // in Paperclip. Lose it and every owner reply to a card is orphaned.
  const l = log();
  born(l)
    .add(KINDS.CARD_SENT, { data: { messageId: 601 } })
    .add(KINDS.CARD_SENT, { data: { messageId: 608 } });
  const d = foldDelivery(l.events, { now });
  // The projection is serialised to state/projections/delivery.json, so the map
  // comes back as a plain object keyed by message id.
  const byMessage = d.byMessageId;
  assert.equal(byMessage["601"].subject, "KOL-1", "T17: the first card still resolves to its issue");
  assert.equal(byMessage["608"].subject, "KOL-1", "T17: and so does the second");
  // messageId is normalised to a string on purpose: JSON object keys are strings,
  // so a number here would silently become a lookup miss after a round trip.
  assert.deepEqual(d.bySubject["KOL-1"], ["601", "608"], "T17: and the issue knows both of its cards");
  ok("T17: two cards on one subject both keep their message_id mapping");
}

function t18_waitingIsAnsweredByTheOneSharedRule() {
  const l = log();
  l.add(KINDS.DIRECTIVE_CREATED, {
    subject: "KOL-62",
    data: { title: "APPROVE: start real work on SJS SuperApps now?", status: "todo", labels: [] },
  });
  const d = foldDecisions(l.events, { now });
  const rows = Array.isArray(d.waiting) ? d.waiting : d;
  const ids = rows.map((r) => r.identifier ?? r.subject);
  assert.ok(ids.includes("KOL-62"), "T18: an unlabelled APPROVE: title is waiting — the 2026-09-03 blind spot");
  ok("T18: the waiting set comes from needs-owner, not a second copy of the rule");
}

async function main() {
  const tests = [
    t1_new,
    t2_awaitingApproval,
    t3_approved,
    t4_rejectedByOwner,
    t5_rejectedBySystemRefusal,
    t6_done,
    t7_ignoredWithoutTheDirectiveLabel,
    t8_stalledAfterSilence,
    t9_silenceJustUnderTheThresholdIsNotStalled,
    t10_theOldestDecisionAfterThePlanWins,
    t11_approvalAfterAnExecutionCapIsStalledNotApproved,
    t12_shuffledInputProducesAnIdenticalProjection,
    t13_orderIsBySeqNotByTimestamp,
    t13b_seqWinsWhenTheClockContradictsIt,
    t13c_lastWriteWinsBySeqNotByClock,
    t14_anUnknownKindIsCountedNotThrownOn,
    t15_malformedEventsAreCountedNotThrownOn,
    t16_theInputArrayIsNeverMutated,
    t17_theTelegramMessageIdMapSurvives,
    t18_waitingIsAnsweredByTheOneSharedRule,
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
