// ops-watcher/reconcile.regression.test.mjs
// Offline regression coverage for the read-only reconciliation probe. NO network,
// NO Paperclip, NO real ledger, NO writes: every input is a literal object and
// the clock is injected. Run with:
//   node ops-watcher/reconcile.regression.test.mjs

import assert from "node:assert/strict";
import { reconcileOnce } from "./reconcile.mjs";
import { KINDS } from "./ledger-schema.mjs";

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
const iso = (s) => new Date(s).toISOString();

function issue(over = {}) {
  return {
    id: "uuid-1",
    identifier: "KOL-1",
    title: "ordinary directive",
    status: "todo",
    labels: [],
    labelIds: [],
    createdAt: iso("2026-09-03T01:00:00Z"),
    comments: [],
    ...over,
  };
}

function comment(body, at, id = "c1") {
  return { id, body, createdAt: iso(at) };
}

function event(over = {}) {
  return {
    seq: 1,
    ts: iso("2026-09-03T01:00:00Z"),
    kind: KINDS.DIRECTIVE_CREATED,
    subject: "KOL-1",
    actor: "system",
    source: "migration",
    data: {
      title: "ordinary directive",
      status: "todo",
      labels: ["DIRECTIVE", "OWNER_REQUIRED"],
    },
    shadow: null,
    ...over,
  };
}

function checkNamed(result, name) {
  const found = result.checks.find((check) => check.name === name);
  assert.ok(found, `missing check ${name}`);
  return found;
}

async function runWith({ events = [], issues = [], extraDeps = {} } = {}) {
  return reconcileOnce({
    _readLedger: async () => events,
    _fetchIssues: async () => issues,
    _now: now,
    ...extraDeps,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// -- The three checks all agree ------------------------------------------------

async function t1_allThreeChecksPass() {
  const issues = [
    issue({ labels: [{ name: "DIRECTIVE" }, { name: "OWNER_REQUIRED" }] }),
  ];
  const events = [event()];

  const result = await runWith({ events, issues });

  assert.equal(result.ok, true, "T1: reconcileOnce reports success");
  assert.equal(result.differences, 0, "T1: no check is different");
  assert.deepEqual(result.checks.map((check) => check.ok), [true, true, true], "T1: all checks pass");
  ok("T1: all three reconcile checks pass offline");
}

// -- The owner surface covers the card + digest split -------------------------

async function t2_ownerSurfaceCoversCardsAndDigest() {
  const issues = [
    issue({ identifier: "KOL-29", title: "OWNER DIRECTIVE: labelled", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-30", title: "OWNER DIRECTIVE: another labelled", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-67", title: "OWNER DIRECTIVE: escalated", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ identifier: "KOL-50", title: "P4 DECISION NEEDED: Health OS" }),
    issue({ identifier: "KOL-51", title: "P4 DECISION NEEDED: Health OS storage" }),
    issue({ identifier: "KOL-52", title: "P4 DECISION NEEDED: Lawyer Copilot" }),
    issue({ identifier: "KOL-53", title: "P4 DECISION NEEDED: Civil Law" }),
    issue({ identifier: "KOL-54", title: "DECISION: runtime shape" }),
    issue({ identifier: "KOL-55", title: "DECISION NEEDED: agent roster" }),
    issue({ identifier: "KOL-56", title: "FYI/DECISION: KPI rules" }),
    issue({ identifier: "KOL-57", title: "APPROVE: start learning lane?" }),
    issue({ identifier: "KOL-58", title: "APPROVE: migrate ledger?" }),
    issue({ identifier: "KOL-59", title: "DECISION: cockpit threshold" }),
    issue({ identifier: "KOL-60", title: "OWNER DIRECTIVE: oke" }),
    issue({ identifier: "KOL-62", title: "APPROVE: start real work on SJS SuperApps now?" }),
    issue({ identifier: "KOL-63", title: "APPROVE: start real work on Trading OS now?" }),
    issue({ identifier: "KOL-72", title: "DECISION: Caveman route" }),
  ];

  const result = await runWith({ issues });
  const ownerSurface = checkNamed(result, "owner-surface");
  const detail = ownerSurface.detail.join("; ");

  assert.equal(result.ok, true, "T2: the suite result is green");
  assert.equal(result.differences, 0, "T2: no check differs");
  assert.equal(ownerSurface.ok, true, "T2: owner-surface passes when every waiting issue reaches one surface");
  assert.equal(ownerSurface.expected, 17, "T2: expected carries the needsOwner count");
  assert.equal(ownerSurface.actual, 17, "T2: actual carries the card plus digest count");
  assert.match(detail, /split: 3 card, 14 digest/, "T2: detail reports the split");
  assert.doesNotMatch(detail, /waiting-but-on-no-surface/, "T2: no waiting issue is silent");
  assert.equal(checkNamed(result, "projection-vs-parser").ok, true, "T2: projection-vs-parser stays green");
  assert.equal(checkNamed(result, "fold-determinism").ok, true, "T2: fold-determinism stays green");
  ok("T2: owner-surface passes when the 3 card and 14 digest surfaces cover all waiting issues");
}

// -- The folded ledger and parser disagreement is loud -------------------------

// The honest failing case, and it is not contrived: an issue with no identifier
// is counted as waiting on the owner, and can reach NO surface at all. buildDigest
// skips it because there is nothing to name it by, and telegram-notify already
// logs that it has to skip such an issue too — a UUID does not fit in a Telegram
// callback. So it waits forever, silently, which is precisely the failure this
// whole check exists to make loud.
async function t2b_waitingWithNoIdentifierReachesNoSurface() {
  const issues = [
    issue({ id: "uuid-a", identifier: "KOL-1", title: "APPROVE: reachable", labels: [{ name: "OWNER_REQUIRED" }] }),
    issue({ id: "uuid-b", identifier: null, title: "APPROVE: unreachable", labels: [{ name: "OWNER_REQUIRED" }] }),
  ];

  const result = await runWith({ issues });
  const ownerSurface = checkNamed(result, "owner-surface");
  const detail = ownerSurface.detail.join("; ");

  assert.equal(result.ok, false, "T2b: the probe reports a difference");
  assert.equal(ownerSurface.ok, false, "T2b: owner-surface is the failed check");
  assert.equal(ownerSurface.expected, 2, "T2b: two issues are waiting");
  assert.equal(ownerSurface.actual, 1, "T2b: only one of them reaches a surface");
  assert.match(detail, /waiting-but-on-no-surface/, "T2b: the detail names the failure mode");
  assert.equal(checkNamed(result, "projection-vs-parser").ok, true, "T2b: the other checks stay green");
  assert.equal(checkNamed(result, "fold-determinism").ok, true, "T2b: the other checks stay green");
  ok("T2b: an issue with no identifier is waiting and reaches no surface");
}

async function t3_projectionVsParserFailsAlone() {
  const issues = [
    issue({
      identifier: "KOL-20",
      title: "ordinary directive",
      labels: [{ name: "DIRECTIVE" }],
      comments: [],
    }),
  ];
  const events = [
    event({
      seq: 1,
      subject: "KOL-20",
      data: { title: "ordinary directive", status: "todo", labels: ["DIRECTIVE"] },
    }),
    event({
      seq: 2,
      ts: iso("2026-09-03T01:05:00Z"),
      kind: KINDS.DIRECTIVE_PLAN_POSTED,
      subject: "KOL-20",
      data: {},
      shadow: "DIRECTIVE PLAN (2026-09-03T01:05:00Z): OBJECTIVE: x",
    }),
    event({
      seq: 3,
      ts: iso("2026-09-03T01:06:00Z"),
      kind: KINDS.DECISION_APPROVED,
      subject: "KOL-20",
      actor: "owner",
      source: "telegram",
      data: {},
      shadow: "OWNER MENYETUJUI via Telegram (2026-09-03T01:06:00Z)",
    }),
  ];

  const result = await runWith({ events, issues });
  const projection = checkNamed(result, "projection-vs-parser");
  const detail = projection.detail.join("; ");

  assert.equal(result.ok, false, "T3: the suite result is red");
  assert.equal(result.differences, 1, "T3: exactly one check differs");
  assert.equal(checkNamed(result, "owner-surface").ok, true, "T3: owner-surface stays green");
  assert.equal(projection.ok, false, "T3: projection-vs-parser is the failed check");
  assert.match(detail, /KOL-20/, "T3: detail names the issue");
  assert.match(detail, /fold=/, "T3: detail names the folded state");
  assert.match(detail, /parser=/, "T3: detail names the parser state");
  assert.equal(checkNamed(result, "fold-determinism").ok, true, "T3: fold-determinism stays green");
  ok("T3: projection-vs-parser fails alone and prints fold/parser detail");
}

// -- Fold determinism has no injected project seam -----------------------------

async function t4_foldDeterminismCannotBeForcedThroughDeps() {
  let fakeProjectCalls = 0;
  const issues = [
    issue({ labels: [{ name: "DIRECTIVE" }, { name: "OWNER_REQUIRED" }] }),
  ];
  const events = [event()];

  const result = await runWith({
    events,
    issues,
    extraDeps: {
      _project: () => {
        fakeProjectCalls++;
        return { directives: [{ subject: "KOL-1", nonce: fakeProjectCalls }] };
      },
    },
  });

  assert.equal(fakeProjectCalls, 0, "T4: reconcileOnce exposes no _project seam");
  assert.equal(result.ok, true, "T4: the real project() remains order-independent for this fixture");
  assert.equal(checkNamed(result, "fold-determinism").ok, true, "T4: fold-determinism stays green without a seam");
  ok("T4: fold-determinism cannot be forced red through injected deps");
}

// -- Setup failures are reported by every check --------------------------------

async function t5_readLedgerFailureReportsEveryCheck() {
  const result = await reconcileOnce({
    _readLedger: async () => { throw new Error("ledger unavailable for test"); },
    _fetchIssues: async () => { throw new Error("must not be reached"); },
    _now: now,
  });

  assert.equal(result.ok, false, "T5: setup failure is a red result");
  assert.equal(result.differences, 3, "T5: every check reports the setup problem");
  assert.deepEqual(
    result.checks.map((check) => check.name),
    ["owner-surface", "projection-vs-parser", "fold-determinism"],
    "T5: all checks are present",
  );
  for (const check of result.checks) {
    assert.equal(check.ok, false, `T5: ${check.name} is red`);
    assert.equal(check.expected, "inputs readable", `T5: ${check.name} expected names setup`);
    assert.equal(check.actual, "setup-error", `T5: ${check.name} actual names setup error`);
    assert.match(check.detail.join("; "), /ledger unavailable for test/, `T5: ${check.name} carries the thrown error`);
  }
  ok("T5: a ledger setup failure reports on all three checks without crashing");
}

// -- A probe must not behave like an actuator ----------------------------------

async function t6_probeDoesNotMutateOrWrite() {
  let writes = 0;
  const trap = async () => {
    writes++;
    throw new Error("write seam must not be called");
  };
  const issues = deepFreeze([
    issue({
      identifier: "KOL-77",
      labels: [{ name: "DIRECTIVE" }, { name: "OWNER_REQUIRED" }],
      comments: [
        comment("human note", "2026-09-03T01:30:00Z"),
      ],
    }),
  ]);
  const events = deepFreeze([event({ subject: "KOL-77" })]);
  const beforeIssues = JSON.stringify(issues);
  const beforeEvents = JSON.stringify(events);

  const result = await reconcileOnce({
    _readLedger: async () => events,
    _fetchIssues: async () => issues,
    _now: now,
    postComment: trap,
    patchIssue: trap,
    httpPost: trap,
    httpPatch: trap,
  });

  assert.equal(result.ok, true, "T6: frozen read-only inputs still reconcile");
  assert.equal(writes, 0, "T6: no actuator seam is called");
  assert.equal(JSON.stringify(issues), beforeIssues, "T6: issues are not mutated");
  assert.equal(JSON.stringify(events), beforeEvents, "T6: events are not mutated");
  assert.equal(Object.isFrozen(issues[0]), true, "T6: the issue fixture stayed frozen");
  ok("T6: reconcileOnce is a read-only probe, not an actuator");
}

async function main() {
  const tests = [
    t1_allThreeChecksPass,
    t2_ownerSurfaceCoversCardsAndDigest,
    t2b_waitingWithNoIdentifierReachesNoSurface,
    t3_projectionVsParserFailsAlone,
    t4_foldDeterminismCannotBeForcedThroughDeps,
    t5_readLedgerFailureReportsEveryCheck,
    t6_probeDoesNotMutateOrWrite,
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
