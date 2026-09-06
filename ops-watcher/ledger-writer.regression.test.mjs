// ops-watcher/ledger-writer.regression.test.mjs
// Offline regression coverage for the Paperclip -> ledger writer. NO real
// Paperclip, NO real ledger, NO disk writes. Run with:
//   node ops-watcher/ledger-writer.regression.test.mjs

import assert from "node:assert/strict";

import { KINDS } from "./ledger-schema.mjs";
import {
  TELEGRAM_SENT_MARKER,
  commentsOldestFirst,
  eventIdentity,
  runLedgerWriterOnce,
} from "./ledger-writer.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const ok = (name) => { console.log(`PASS: ${name}`); passed += 1; };
const bad = (name, err) => {
  console.log(`FAIL: ${name}`);
  if (err) console.log(`  ${err && err.stack ? err.stack : err}`);
  failures.push(name);
  failed += 1;
};

const COMPANY_ID = "company-1";

function issue(overrides = {}) {
  return {
    id: "iss-1",
    identifier: "KOL-1",
    title: "OWNER DIRECTIVE: ship it",
    description: "do the work",
    status: "todo",
    labels: [{ name: "DIRECTIVE" }],
    createdAt: "2026-09-03T01:00:00.000Z",
    updatedAt: "2026-09-03T01:10:00.000Z",
    ...overrides,
  };
}

function comment(id, body, createdAt) {
  return { id, body, createdAt };
}

function event(overrides = {}) {
  return {
    seq: 1,
    kind: KINDS.DIRECTIVE_CREATED,
    subject: "KOL-1",
    actor: "system",
    source: "migration",
    data: { issueId: "iss-1", identifier: "KOL-1", labels: ["DIRECTIVE"], status: "todo" },
    ts: "2026-09-03T01:00:00.000Z",
    shadow: null,
    ...overrides,
  };
}

function foldFrom(events) {
  const out = new Map();
  for (const ev of events) {
    const rec = out.get(ev.subject) || { status: "", labels: [] };
    if (ev.kind === KINDS.DIRECTIVE_CREATED) {
      rec.status = ev.data?.status || rec.status;
      rec.labels = ev.data?.labels || rec.labels;
    }
    if (ev.kind === KINDS.ISSUE_STATUS_CHANGED) rec.status = ev.data?.status || rec.status;
    if (ev.kind === KINDS.ISSUE_LABEL_CHANGED) rec.labels = ev.data?.labels || [];
    out.set(ev.subject, rec);
  }
  return out;
}

function harness({ entries, ledger = [], extraDeps = {} }) {
  const appendedBatches = [];
  return {
    ledger,
    appendedBatches,
    deps: {
      base: "http://paperclip.test",
      companyId: COMPANY_ID,
      readAll: async () => ledger,
      appendMany: async (events) => {
        appendedBatches.push(events);
        for (const ev of events) {
          ledger.push({ ...ev, seq: ledger.length + 1 });
        }
        return events;
      },
      foldDirectives: (events) => foldFrom(events),
      resolvePaperclipToken: async () => null,
      listIssues: async () => ({ issues: entries }),
      httpGet: async () => ({ body: [] }),
      ...extraDeps,
    },
  };
}

async function t1_sweepThenSweepAgainAppendsZeroSecondTime() {
  const entries = [{
    issue: issue(),
    comments: [
      comment("c-unknown", "OWNER SELECTED: ambiguous option", "2026-09-03T01:03:00.000Z"),
      comment("c-approved", "OWNER MENYETUJUI via Telegram (2026-09-03T01:02:00.000Z) - tap", "2026-09-03T01:02:00.000Z"),
      comment("c-card", "[TELEGRAM SENT] message_id=42 (2026-09-03T01:01:00.000Z)", "2026-09-03T01:01:00.000Z"),
    ],
  }];
  const h = harness({ entries });

  const first = await runLedgerWriterOnce(h.deps);
  const second = await runLedgerWriterOnce(h.deps);

  assert.equal(first.appended, 3, "first sweep appends directive, card, approval");
  assert.equal(second.appended, 0, "second sweep appends exactly zero");
  assert.equal(second.alreadyPresent, 3, "second sweep recognizes all stable identities");
  assert.equal(second.unclassified, 1, "unknown comment is reported, not appended");
  assert.deepEqual(
    h.appendedBatches[0].map((ev) => ev.kind),
    [KINDS.DIRECTIVE_CREATED, KINDS.CARD_SENT, KINDS.DECISION_APPROVED],
    "events append in board chronology",
  );
  assert.ok(h.appendedBatches[0].every((ev) => ev.data.ledgerWriterIdentity), "every event carries a stable identity");
  ok("T1: sweep is idempotent and proves second append count is zero");
}

async function t2_neverUsesCurrentTimeForBoardFacts() {
  const entries = [{
    issue: issue({
      createdAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-09-03T10:00:00.000Z",
      status: "done",
      labels: [],
    }),
    comments: [
      comment("c-reject", "OWNER MENOLAK via Telegram (2026-09-03T09:00:00.000Z) - tap", "2026-09-03T09:00:01.000Z"),
    ],
  }];
  const ledger = [event({ data: { issueId: "iss-1", identifier: "KOL-1", labels: ["DIRECTIVE"], status: "todo" } })];
  const h = harness({ entries, ledger });

  const result = await runLedgerWriterOnce(h.deps);
  const appended = h.appendedBatches[0];

  assert.equal(result.appended, 3, "status, labels, and rejection are appended");
  assert.deepEqual(
    appended.map((ev) => [ev.kind, ev.ts]),
    [
      [KINDS.DECISION_REJECTED, "2026-09-03T09:00:01.000Z"],
      [KINDS.ISSUE_LABEL_CHANGED, "2026-09-03T10:00:00.000Z"],
      [KINDS.ISSUE_STATUS_CHANGED, "2026-09-03T10:00:00.000Z"],
    ],
    "each timestamp comes from the board fact itself",
  );
  ok("T2: derived events use board timestamps, never the sweep clock");
}

function t3_commentsOldestFirstSortsNewestFirstEndpointPayload() {
  const input = [
    comment("new", "newest", "2026-09-03T01:03:00.000Z"),
    comment("old", "oldest", "2026-09-03T01:01:00.000Z"),
    comment("mid", "middle", "2026-09-03T01:02:00.000Z"),
  ];
  assert.deepEqual(commentsOldestFirst(input).map((c) => c.id), ["old", "mid", "new"]);
  assert.deepEqual(input.map((c) => c.id), ["new", "old", "mid"], "sort does not mutate the input");
  ok("T3: comments endpoint newest-first order is explicitly corrected");
}

async function t4_unknownCommentShapesAreReportedNotGuessed() {
  const entries = [{
    issue: issue({ labels: [] }),
    comments: [
      comment("c-weird", "OWNER MAYBE APPROVED? this is not a real marker", "2026-09-03T01:01:00.000Z"),
    ],
  }];
  const h = harness({ entries });

  const result = await runLedgerWriterOnce(h.deps);

  assert.equal(result.appended, 0, "unknown comment does not append nearest-match kind");
  assert.equal(result.unclassified, 1);
  assert.equal(result.unclassifiedDetails[0].commentId, "c-weird");
  assert.match(result.unclassifiedDetails[0].reason, /known ledger kind/);
  ok("T4: unknown comment shapes are returned as unclassified");
}

async function t5_failuresReturnReasonStringsAndDoNotThrow() {
  const result = await runLedgerWriterOnce({
    base: "http://paperclip.test",
    readAll: async () => { throw new Error("boom read"); },
    appendMany: async () => { throw new Error("must not append"); },
    foldDirectives: () => new Map(),
    resolvePaperclipToken: async () => null,
    listIssues: async () => ({ issues: [] }),
    httpGet: async () => ({ body: [] }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.appended, 0);
  assert.match(result.errors.join("\n"), /ledger read failed: boom read/);
  ok("T5: sweep returns failure reasons instead of throwing");
}

async function t6_legacyCommentIdsDedupeWithoutLedgerWriterIdentity() {
  const entries = [{
    issue: issue(),
    comments: [
      comment("c-card", "[TELEGRAM SENT] message_id=7 (2026-09-03T01:01:00.000Z)", "2026-09-03T01:01:00.000Z"),
      comment("c-ok", "OWNER APPROVED via Telegram (2026-09-03T01:02:00.000Z) - old wording", "2026-09-03T01:02:00.000Z"),
    ],
  }];
  const ledger = [
    event(),
    event({
      seq: 2,
      kind: KINDS.CARD_SENT,
      data: { marker: TELEGRAM_SENT_MARKER, commentId: "c-card", issueId: "iss-1" },
      ts: "2026-09-03T01:01:00.000Z",
    }),
    event({
      seq: 3,
      kind: KINDS.DECISION_APPROVED,
      actor: "owner",
      data: { marker: "OWNER APPROVED via Telegram", commentId: "c-ok", issueId: "iss-1" },
      ts: "2026-09-03T01:02:00.000Z",
    }),
  ];
  const h = harness({ entries, ledger });

  const result = await runLedgerWriterOnce(h.deps);

  assert.equal(result.derived, 3);
  assert.equal(result.alreadyPresent, 3);
  assert.equal(result.appended, 0);
  ok("T6: legacy migrated commentId facts dedupe without writer-owned identity");
}

async function t7_statusAndLabelDriftAreWrittenFromIssueUpdatedAt() {
  const entries = [{
    issue: issue({ status: "cancelled", labels: [{ name: "OWNER_REJECTED" }], updatedAt: "2026-09-03T04:00:00.000Z" }),
    comments: [],
  }];
  const ledger = [
    event({
      data: { issueId: "iss-1", identifier: "KOL-1", labels: ["DIRECTIVE", "OWNER_REQUIRED"], status: "todo" },
    }),
  ];
  const h = harness({ entries, ledger });

  const result = await runLedgerWriterOnce(h.deps);
  const appended = h.appendedBatches[0];

  assert.equal(result.appended, 2);
  assert.deepEqual(appended.map((ev) => ev.kind).sort(), [KINDS.ISSUE_LABEL_CHANGED, KINDS.ISSUE_STATUS_CHANGED].sort());
  assert.ok(appended.every((ev) => ev.ts === "2026-09-03T04:00:00.000Z"), "issue updatedAt is the timestamp");
  assert.deepEqual(appended.find((ev) => ev.kind === KINDS.ISSUE_LABEL_CHANGED).data.labels, ["OWNER_REJECTED"]);
  assert.equal(appended.find((ev) => ev.kind === KINDS.ISSUE_STATUS_CHANGED).data.status, "cancelled");
  ok("T7: current issue status/label drift is appended from board facts");
}

async function t8_fetchesCommentsWhenListIssuesDoesNotEmbedThem() {
  const flat = issue({ id: "iss-fetch", identifier: "KOL-9" });
  const h = harness({
    entries: [flat],
    extraDeps: {
      listIssues: async () => ({ issues: [flat] }),
      httpGet: async (url) => {
        assert.match(url, /\/api\/issues\/iss-fetch\/comments$/);
        return { body: [comment("c-fetch", "[TELEGRAM SENT] message_id=9", "2026-09-03T01:01:00.000Z")] };
      },
    },
  });

  const result = await runLedgerWriterOnce(h.deps);

  assert.equal(result.appended, 2, "directive.created plus fetched card.sent");
  assert.equal(h.appendedBatches[0][1].data.commentId, "c-fetch");
  ok("T8: missing embedded comments are fetched from Paperclip comments endpoint");
}

async function t9_discoveryUsesTheMeasuredRetryContract() {
  let call = null;
  const result = await runLedgerWriterOnce({
    readAll: async () => [],
    appendMany: async () => [],
    foldDirectives: () => new Map(),
    resolvePaperclipToken: async () => null,
    discoverPaperclipPort: async (injected, opts) => {
      call = { injected, opts };
      return 3110;
    },
    listIssues: async () => ({ issues: [] }),
    httpGet: async () => ({ body: [] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(call, { injected: null, opts: { attempts: 3, retryDelayMs: 1500 } });
  ok("T9: Paperclip discovery uses attempts=3 and retryDelayMs=1500");
}

async function t10_eventIdentityDoesNotDependOnSeq() {
  const a = event({ kind: KINDS.CARD_SENT, data: { commentId: "c1", issueId: "iss-1" }, seq: 10 });
  const b = event({ kind: KINDS.CARD_SENT, data: { commentId: "c1", issueId: "iss-1" }, seq: 99 });
  assert.equal(eventIdentity(a), eventIdentity(b));
  ok("T10: event identity ignores seq");
}

async function t11_authRequiredListResultIsAnErrorNotAnEmptyBoard() {
  const h = harness({
    entries: [],
    extraDeps: {
      listIssues: async () => ({ issues: [], networkError: false, authRequired: true }),
    },
  });

  const result = await runLedgerWriterOnce(h.deps);

  assert.equal(result.ok, false);
  assert.equal(result.appended, 0);
  assert.match(result.errors.join("\n"), /issues list auth required/);
  assert.equal(h.appendedBatches.length, 0, "auth failure must not be treated as a clean empty board");
  ok("T11: list authRequired is reported as an error before empty issues");
}

async function t12_networkErrorListResultIsAnErrorNotAnEmptyBoard() {
  const h = harness({
    entries: [],
    extraDeps: {
      listIssues: async () => ({ issues: [], networkError: true, networkErrorMessage: "ECONNREFUSED" }),
    },
  });

  const result = await runLedgerWriterOnce(h.deps);

  assert.equal(result.ok, false);
  assert.equal(result.appended, 0);
  assert.match(result.errors.join("\n"), /issues list network error: ECONNREFUSED/);
  assert.equal(h.appendedBatches.length, 0, "network failure must not be treated as a clean empty board");
  ok("T12: list networkError is reported as an error before empty issues");
}

async function t13_legitimateEmptyIssueListStillSucceeds() {
  const h = harness({
    entries: [],
    extraDeps: {
      listIssues: async () => ({ issues: [], networkError: false, authRequired: false }),
    },
  });

  const result = await runLedgerWriterOnce(h.deps);

  assert.equal(result.ok, true);
  assert.equal(result.derived, 0);
  assert.equal(result.appended, 0);
  assert.deepEqual(result.errors, []);
  ok("T13: legitimate empty issue list remains a successful empty board");
}

async function t14_legacyListResultShapesStillReadIssues() {
  const shapes = [
    { name: "bare array", value: [{ issue: issue({ id: "iss-array", identifier: "KOL-ARRAY" }), comments: [] }] },
    { name: "issues property", value: { issues: [{ issue: issue({ id: "iss-issues", identifier: "KOL-ISSUES" }), comments: [] }] } },
    { name: "body property", value: { body: [{ issue: issue({ id: "iss-body", identifier: "KOL-BODY" }), comments: [] }] } },
  ];

  for (const shape of shapes) {
    const h = harness({
      entries: [],
      extraDeps: {
        listIssues: async () => shape.value,
      },
    });

    const result = await runLedgerWriterOnce(h.deps);

    assert.equal(result.ok, true, `${shape.name} should remain accepted`);
    assert.equal(result.derived, 1, `${shape.name} should expose one issue`);
    assert.equal(result.appended, 1, `${shape.name} should append the derived directive`);
    assert.equal(h.appendedBatches[0][0].kind, KINDS.DIRECTIVE_CREATED);
  }
  ok("T14: legacy list result shapes still read issues");
}

async function main() {
  console.log("# ledger-writer regression tests");
  const tests = [
    t1_sweepThenSweepAgainAppendsZeroSecondTime,
    t2_neverUsesCurrentTimeForBoardFacts,
    t3_commentsOldestFirstSortsNewestFirstEndpointPayload,
    t4_unknownCommentShapesAreReportedNotGuessed,
    t5_failuresReturnReasonStringsAndDoNotThrow,
    t6_legacyCommentIdsDedupeWithoutLedgerWriterIdentity,
    t7_statusAndLabelDriftAreWrittenFromIssueUpdatedAt,
    t8_fetchesCommentsWhenListIssuesDoesNotEmbedThem,
    t9_discoveryUsesTheMeasuredRetryContract,
    t10_eventIdentityDoesNotDependOnSeq,
    t11_authRequiredListResultIsAnErrorNotAnEmptyBoard,
    t12_networkErrorListResultIsAnErrorNotAnEmptyBoard,
    t13_legitimateEmptyIssueListStillSucceeds,
    t14_legacyListResultShapesStillReadIssues,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      bad(test.name, err);
    }
  }

  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const name of failures) console.log(`  FAILED: ${name}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("regression runner crashed:", err);
  process.exit(1);
});
