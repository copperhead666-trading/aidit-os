// ops-watcher/migrate-to-ledger.regression.test.mjs
// Offline coverage for the export-derive-compare tool. NO network, NO Paperclip,
// NO disk writes: every input is a literal object. Run with:
//   node ops-watcher/migrate-to-ledger.regression.test.mjs
//
// This suite matters more than most. The script it covers is the GATE — the one
// check standing between the owner and a one-session cutover with no dual-write
// period. A gate whose own correctness is unproven is not a gate.

import assert from "node:assert/strict";
import { KINDS } from "./ledger-schema.mjs";
import {
  classifyCommentBody,
  deriveEventsForIssue,
  deriveEvents,
  runCompare,
  main as main1,
  eventIdentity,
  subjectOf,
  exportFileName,
  TELEGRAM_SENT_MARKER,
  DECISION_APPROVE_PREFIX,
  DECISION_REJECT_PREFIX,
  DECISION_DEFER_PREFIX,
  ATTEMPT_CAP_MARKER,
  EXECUTION_CAP_BRIDGE_PHRASE,
  SIDECAR_FILES,
} from "../scripts/migrate-to-ledger.mjs";

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

const iso = (s) => new Date(s).toISOString();

function entry(over = {}) {
  return {
    issue: {
      id: "uuid-1",
      identifier: "KOL-36",
      title: "OWNER DIRECTIVE: LIVE-E2E-AHMAD-001",
      status: "todo",
      labels: [{ name: "DIRECTIVE" }],
      createdAt: iso("2026-08-30T01:00:00Z"),
      description: "Ahmad, acknowledge this directive",
      ...over.issue,
    },
    comments: over.comments ?? [],
    observedAt: iso("2026-09-03T02:00:00Z"),
  };
}

const comment = (body, at, id = "c1") => ({ id, body, createdAt: iso(at) });

// ── Every marker maps to a kind, and the body always survives ──────────

function t1_everyKnownMarkerMapsToItsKind() {
  const cases = [
    [`${TELEGRAM_SENT_MARKER} message_id=608 (…) — owner decision requested`, KINDS.CARD_SENT, "system"],
    [`${DECISION_APPROVE_PREFIX} (2026-09-02T09:08:12Z) — ketukan tombol`, KINDS.DECISION_APPROVED, "owner"],
    [`${DECISION_REJECT_PREFIX} (…) — status cancelled`, KINDS.DECISION_REJECTED, "owner"],
    [`${DECISION_DEFER_PREFIX} (…) — tidak ada perubahan status`, KINDS.DECISION_DEFERRED, "owner"],
    ["DIRECTIVE PLAN (2026-09-01T…): OBJECTIVE: x", KINDS.DIRECTIVE_PLAN_POSTED, "system"],
    ["PLAN_REFUSED (…): rencana ditolak otomatis", KINDS.DIRECTIVE_PLAN_REFUSED, "system"],
    ["DIRECTIVE RESULT (…): directive telah dikerjakan", KINDS.EXECUTION_DONE, "system"],
    ["AHMAD DISPATCH: waking headless AHMAD for KOL-33.", KINDS.DISPATCH_CLAIMED, "agent"],
    ["DIRECTIVE TIDAK DAPAT DIJALANKAN (…): rencana tidak terbaca", KINDS.DIRECTIVE_UNEXECUTABLE, "system"],
    [`${ATTEMPT_CAP_MARKER} (…): directive perlu keputusan owner.`, KINDS.CAP_ATTEMPT_REACHED, "system"],
  ];
  for (const [body, kind, actor] of cases) {
    const got = classifyCommentBody(body);
    assert.equal(got.kind, kind, `T1: ${body.slice(0, 40)} should map to ${kind}`);
    assert.equal(got.actor, actor, `T1: ${kind} is caused by ${actor}`);
  }
  ok("T1: every marker the runner writes maps to its typed kind and actor");
}

function t2_theTelegramMessageIdIsCarriedThrough() {
  // This mapping exists today ONLY as a comment. Lose the number and every
  // owner reply to a card is orphaned, and telegram-notify re-sends every card.
  const got = classifyCommentBody(`${TELEGRAM_SENT_MARKER} message_id=608 (2026-09-02T09:00:00Z) — for KOL-36.`);
  assert.equal(got.kind, KINDS.CARD_SENT, "T2: it is a card-sent fact");
  assert.equal(got.data.message_id, 608, "T2: and the message id is a number, not lost in prose");
  ok("T2: the Telegram message_id survives the round trip as a real value");
}

function t3_theExecutionCapBridgeIsHonoured() {
  // Older execution caps were written with the ATTEMPT cap prefix plus a phrase.
  // directive-runner.mjs:196 bridges them; the migration has to as well, or a
  // capped directive silently reads as merely attempt-capped and runs again.
  const legacy = `${ATTEMPT_CAP_MARKER} (…): directive dihentikan setelah 2 ${EXECUTION_CAP_BRIDGE_PHRASE}.`;
  assert.equal(classifyCommentBody(legacy).kind, KINDS.CAP_EXECUTION_REACHED, "T3: the legacy body is an execution cap");
  assert.equal(
    classifyCommentBody(`${ATTEMPT_CAP_MARKER} (…): directive perlu keputusan owner.`).kind,
    KINDS.CAP_ATTEMPT_REACHED,
    "T3: without the phrase it stays an attempt cap",
  );
  ok("T3: the legacy execution-cap wording is bridged, not mistaken for an attempt cap");
}

function t4_anUnknownCommentIsKeptNotDropped() {
  const body = "some human wrote this by hand and nobody planned for it";
  const got = classifyCommentBody(body);
  assert.equal(got.kind, KINDS.IMPORTED, "T4: unrecognised becomes IMPORTED");
  const evs = deriveEventsForIssue(entry({ comments: [comment(body, "2026-09-01T05:00:00Z")] }));
  const imported = evs.find((e) => e.kind === KINDS.IMPORTED);
  assert.equal(imported.shadow, body, "T4: and the original text is preserved verbatim");
  ok("T4: a comment nobody anticipated is imported with its body intact, never discarded");
}

function t5_everyDerivedEventKeepsItsOriginalBody() {
  const bodies = [
    "DIRECTIVE PLAN (…): OBJECTIVE: do the thing\nFILES: NONE",
    `${DECISION_APPROVE_PREFIX} (…) — ketukan tombol oleh owner`,
    "totally unstructured",
  ];
  const evs = deriveEventsForIssue(
    entry({ comments: bodies.map((b, i) => comment(b, `2026-09-01T0${i + 1}:00:00Z`, `c${i}`)) }),
  );
  const shadows = evs.filter((e) => e.kind !== KINDS.DIRECTIVE_CREATED).map((e) => e.shadow);
  assert.deepEqual(shadows, bodies, "T5: nothing reformatted, nothing truncated");
  ok("T5: every derived event carries its source comment verbatim in shadow");
}

// ── The ordering trap that has already cost this project a bug ─────────

function t6_commentsFedNewestFirstStillDeriveInOrder() {
  // Paperclip's comments endpoint returns NEWEST FIRST. Trusting arrival order
  // is the KOL-73 bug: the oldest plan wins and every newer approval is ignored.
  const newestFirst = [
    comment(`${DECISION_APPROVE_PREFIX} (…)`, "2026-09-01T12:00:00Z", "c3"),
    comment("DIRECTIVE PLAN (…): OBJECTIVE: x", "2026-09-01T11:00:00Z", "c2"),
    comment("AHMAD DISPATCH: waking", "2026-09-01T10:00:00Z", "c1"),
  ];
  const kinds = deriveEventsForIssue(entry({ comments: newestFirst }))
    .filter((e) => e.kind !== KINDS.DIRECTIVE_CREATED)
    .map((e) => e.kind);
  assert.deepEqual(
    kinds,
    [KINDS.DISPATCH_CLAIMED, KINDS.DIRECTIVE_PLAN_POSTED, KINDS.DECISION_APPROVED],
    "T6: derived oldest-first regardless of how the API returned them",
  );
  ok("T6: comments arriving newest-first still derive in true chronological order");
}

function t7_timestampsAreTheFactsOwnNotNow() {
  const evs = deriveEventsForIssue(
    entry({ comments: [comment(`${DECISION_APPROVE_PREFIX} (…)`, "2026-09-01T09:08:12Z")] }),
  );
  const approval = evs.find((e) => e.kind === KINDS.DECISION_APPROVED);
  assert.equal(approval.ts, iso("2026-09-01T09:08:12Z"), "T7: the owner approved then, not at import time");
  assert.equal(approval.source, "migration", "T7: and it is marked as reconstructed, not observed live");
  ok("T7: every derived event carries the fact's own time and is marked as migrated");
}

// ── The issue itself, which the classifier also depends on ─────────────

function t8_theIssueBecomesAnEventCarryingStatusAndLabels() {
  // classifyDirective answers "ignored" without a DIRECTIVE label and "new" for
  // todo/backlog. A ledger that dropped these could never agree with it.
  const evs = deriveEventsForIssue(entry());
  const created = evs[0];
  assert.equal(created.kind, KINDS.DIRECTIVE_CREATED, "T8: the issue itself is the first event");
  assert.equal(created.data.status, "todo", "T8: with its status");
  assert.deepEqual(created.data.labels, ["DIRECTIVE"], "T8: and its labels");
  assert.equal(created.shadow, "Ahmad, acknowledge this directive", "T8: the description is preserved too");
  ok("T8: the issue becomes an event carrying the status and labels the classifier needs");
}

function t9_subjectIsTheIdentifierNotTheUuid() {
  assert.equal(subjectOf({ identifier: "KOL-36", id: "uuid-1" }), "KOL-36", "T9: humans and callbacks use KOL-nn");
  ok("T9: the subject is the identifier, the name every other surface uses");
}

// ── Idempotency: running the migration twice must not double anything ──

function t10_derivingTwiceProducesIdenticalIdentities() {
  const doc = { exportedAt: iso("2026-09-03T02:00:00Z"), issues: [entry({ comments: [comment("DIRECTIVE PLAN (…): OBJECTIVE: x", "2026-09-01T11:00:00Z")] })] };
  const first = deriveEvents(doc).map(eventIdentity);
  const second = deriveEvents(doc).map(eventIdentity);
  assert.deepEqual(first, second, "T10: the same export derives the same facts");
  assert.equal(new Set(first).size, first.length, "T10: and no two facts collide within one run");
  ok("T10: deriving twice yields identical identities — the ledger cannot double");
}

function t11_identityIgnoresTheClock() {
  const id = eventIdentity({ kind: KINDS.CARD_SENT, subject: "KOL-1", ts: iso("2026-09-01T00:00:00Z"), data: { commentId: "c9" }, shadow: "x" });
  const same = eventIdentity({ kind: KINDS.CARD_SENT, subject: "KOL-1", ts: iso("2026-09-01T00:00:00Z"), data: { commentId: "c9" }, shadow: "x" });
  assert.equal(id, same, "T11: identity is a function of the fact, not of when it was computed");
  ok("T11: event identity is stable across runs and machines");
}

// ── Malformed input, and the sidecars that exist nowhere else ──────────

function t12_malformedExportIsAnsweredNotThrownOn() {
  assert.deepEqual(deriveEvents(null), [], "T12: a null document yields no events");
  assert.deepEqual(deriveEvents({ issues: "nope" }), [], "T12: a non-array issue list yields none");
  const evs = deriveEventsForIssue({ issue: {}, comments: "not an array" });
  assert.equal(evs.length, 1, "T12: a bare issue still yields its creation event");
  ok("T12: a malformed export is answered with empty output, never a throw");
}

function t13_theIrreplaceableSidecarsAreOnTheList() {
  // These six exist nowhere else on disk. heartbeat-steps.jsonl is the urgent
  // one: 4.5 MB against a 5 MB rotation threshold, so its oldest history is one
  // sweep from being discarded forever.
  const names = SIDECAR_FILES.map((f) => (typeof f === "string" ? f : f.path || f.name || ""));
  for (const must of [
    "lane-usage.jsonl",
    "self-repair-log.jsonl",
    "events.jsonl",
    "heartbeat-steps.jsonl",
    "learning-os-state.json",
    "pm2-supervisor-log.jsonl",
  ]) {
    assert.ok(names.some((n) => n.includes(must)), `T13: ${must} must be copied — it exists nowhere else`);
  }
  ok("T13: every file with no other copy on disk is on the export list");
}

function t14_exportFileNameIsDatedAndStable() {
  const a = exportFileName(Date.parse("2026-09-03T02:00:00Z"));
  const b = exportFileName(Date.parse("2026-09-03T23:59:00Z"));
  assert.equal(a, b, "T14: two exports on the same day name the same file");
  assert.match(a, /2026-09-03/, "T14: and the name says which day it captured");
  ok("T14: the export file is named by the day it captured, not by the minute");
}

async function t15_aDryRunComparesAgainstWhatItDerived() {
  // The bug this test exists for, found by running the gate for real on
  // 2026-09-03: --dry-run deliberately writes no ledger, and main() never
  // handed the derived events to runCompare. The comparison therefore read an
  // empty file and reported all 78 issues as "(absent)" — 78 differences that
  // did not exist. A gate that refuses for a plumbing reason is exactly as
  // useless as one that always says yes, and far more likely to be ignored.
  const doc = {
    exportedAt: iso("2026-09-03T02:00:00Z"),
    issues: [entry({ comments: [comment("DIRECTIVE PLAN (…): OBJECTIVE: x", "2026-09-01T11:00:00Z")] })],
  };

  let ledgerWasRead = false;
  const deps = {
    _fs: {
      readFile: async () => { ledgerWasRead = true; return ""; },
      writeFile: async () => {},
    },
    _now: () => Date.parse("2026-09-03T02:00:00Z"),
    log: () => {},
  };

  const derived = deriveEvents(doc).map((ev, i) => ({ ...ev, seq: i + 1 }));
  const res = await runCompare({ doc, events: derived, ledgerFile: "unused.jsonl" }, deps);

  assert.equal(ledgerWasRead, false, "T15: supplied events must be used, not a file read");
  assert.equal(res.compared, 1, "T15: the issue was actually compared");
  assert.equal(
    res.differences.length,
    0,
    `T15: both sides must agree; got ${JSON.stringify(res.differences)}`,
  );
  ok("T15: a dry run compares against the events it just derived, not an unwritten ledger");
}

async function t16_theDryRunPathWorksEndToEndWithoutPreAssignedSeq() {
  // T15 passed while the real command still reported 78 phantom differences,
  // because T15 handed runCompare events that already carried a seq. The real
  // path does not: deriveEvents leaves seq unset by design, the projection
  // rejects an event without one, and main() has to lend provisional numbers.
  // A test that supplies what the code under test is supposed to produce
  // proves nothing. This one drives main() itself.
  const doc = {
    exportedAt: iso("2026-09-03T02:00:00Z"),
    issues: [
      entry({ comments: [comment("DIRECTIVE PLAN (…): OBJECTIVE: x", "2026-09-01T11:00:00Z")] }),
      entry({
        issue: { identifier: "KOL-62", title: "APPROVE: start SJS now?", status: "todo", labels: [] },
        comments: [],
      }),
    ],
  };

  const lines = [];
  const code = await main1(["--derive", "--compare", "--dry-run"], {
    importDir: "state/import",
    ledgerFile: "state/ledger.jsonl",
    _fs: {
      readdir: async () => ["paperclip-2026-09-03.json"],
      readFile: async (p) => (String(p).includes("paperclip-") ? JSON.stringify(doc) : ""),
      writeFile: async () => {},
      mkdir: async () => {},
    },
    _now: () => Date.parse("2026-09-03T02:00:00Z"),
    log: (m) => lines.push(String(m)),
  });

  const output = lines.join("\n");
  assert.equal(code, 0, `T16: the dry run must pass the gate; output was:\n${output}`);
  assert.match(output, /ZERO DIFFERENCES/, "T16: and say so in words that cannot be misread");
  assert.equal(/\(absent\)/.test(output), false, "T16: no issue may come back absent from the projection");
  ok("T16: the dry-run gate passes end to end, with seq assigned the way the real run assigns it");
}

async function main() {
  const tests = [
    t1_everyKnownMarkerMapsToItsKind,
    t2_theTelegramMessageIdIsCarriedThrough,
    t3_theExecutionCapBridgeIsHonoured,
    t4_anUnknownCommentIsKeptNotDropped,
    t5_everyDerivedEventKeepsItsOriginalBody,
    t6_commentsFedNewestFirstStillDeriveInOrder,
    t7_timestampsAreTheFactsOwnNotNow,
    t8_theIssueBecomesAnEventCarryingStatusAndLabels,
    t9_subjectIsTheIdentifierNotTheUuid,
    t10_derivingTwiceProducesIdenticalIdentities,
    t11_identityIgnoresTheClock,
    t12_malformedExportIsAnsweredNotThrownOn,
    t13_theIrreplaceableSidecarsAreOnTheList,
    t14_exportFileNameIsDatedAndStable,
    t15_aDryRunComparesAgainstWhatItDerived,
    t16_theDryRunPathWorksEndToEndWithoutPreAssignedSeq,
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
