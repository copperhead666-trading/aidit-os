// Offline regression tests for ops-watcher/venture-planner.mjs.
// No real Paperclip, no git, no graphify, no lane execution. Every actuator is
// injected; this file and venture-planner.mjs are the only files in the module.
//
//   node ops-watcher/venture-planner.regression.test.mjs

import assert from "node:assert/strict";
import { writeFile, unlink, access } from "node:fs/promises";
import {
  DIRECTIVE_LABEL_COLOR,
  PAPERCLIP_DISCOVERY_OPTS,
  PLANNER_EVENT_KIND,
  buildDirectiveIssue,
  fingerprintIndicatesDirtyRepo,
  lockPathForVenture,
  markerForProposal,
  proposalKeyFor,
  runVenturePlannerOnce,
} from "./venture-planner.mjs";

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

function venture(over = {}) {
  return {
    id: "sjs-superapps",
    status: "active",
    repoPath: "ventures/sjs-superapps",
    tujuan: "Ship the next owner-visible dashboard increment",
    tujuan_sumber: "docs/roadmap.md",
    metrik: "Checked backlog items, out of 136",
    metrik_sumber: "control/tasks/feature-backlog.md",
    hardStops: [],
    taskClasses: ["frontend-design"],
    owner_decision_required: [],
    ...over,
  };
}

function specialist(over = {}) {
  return {
    taskClass: "frontend-design",
    specialists: ["design-ui-designer"],
    section: [
      "SPECIALIST VOICE (taskClass: frontend-design) - judge this work tightly:",
      "",
      "## UI Designer",
      "Keep interaction details crisp.",
    ].join("\n"),
    hardStops: ["Do not invent a new design system"],
    requiredStandards: ["docs/standards/frontend-standards.md"],
    requiredSkills: ["frontend-layout"],
    compactContextRule: "Use the packet section verbatim.",
    preferredMaker: "codex",
    preferredReviewer: "reviewer",
    ...over,
  };
}

function deps(over = {}) {
  const calls = {
    readAll: 0,
    activeVentures: 0,
    ownerDecisionRequiredFor: [],
    hardStopsFor: [],
    repoFingerprint: [],
    resolveSpecialistsForPacket: [],
    discoverPaperclipPort: [],
    listIssues: [],
    ensureLabel: [],
    httpPost: [],
    append: [],
    execute: 0,
  };
  const d = {
    calls,
    companyId: "C",
    readAll: async () => { calls.readAll++; return { events: [] }; },
    activeVentures: async () => { calls.activeVentures++; return [venture()]; },
    ownerDecisionRequiredFor: async (id) => { calls.ownerDecisionRequiredFor.push(id); return []; },
    hardStopsFor: async (id) => { calls.hardStopsFor.push(id); return []; },
    hasStatedMetric: (v) => Boolean(String(v.metrik || "").trim()),
    repoFingerprint: async (arg) => { calls.repoFingerprint.push(arg); return "head:abc clean"; },
    resolveSpecialistsForPacket: async (text) => { calls.resolveSpecialistsForPacket.push(text); return specialist(); },
    discoverPaperclipPort: async (injected, opts) => {
      calls.discoverPaperclipPort.push({ injected, opts });
      return 3456;
    },
    listIssues: async (...args) => { calls.listIssues.push(args); return { issues: [] }; },
    ensureLabel: async (...args) => { calls.ensureLabel.push(args); return { id: "lbl-directive", created: false }; },
    httpPost: async (...args) => {
      calls.httpPost.push(args);
      return { status: 201, networkError: false, body: { id: "iss-1", identifier: "KOL-101" } };
    },
    append: async (...args) => { calls.append.push(args); return { seq: 1 }; },
    execute: async () => { calls.execute++; throw new Error("planner must not execute"); },
    log: () => {},
    ...over,
  };
  return d;
}

async function t(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    bad(name, e);
  }
}

async function removeLock(venture) {
  try {
    await unlink(lockPathForVenture(venture));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function lockExists(venture) {
  try {
    await access(lockPathForVenture(venture));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

await t("T1: READ PREVIOUS - a prior planner ledger event is audit only, not a duplicate decider", async () => {
  const v = venture();
  const key = proposalKeyFor(v, "head:abc clean");
  let readAllCalled = 0;
  const d = deps({
    activeVentures: async () => [v],
    readAll: async () => {
      readAllCalled++;
      return { events: [{ kind: PLANNER_EVENT_KIND, data: { proposalKey: key } }] };
    },
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, true, "Paperclip, not the ledger, decides whether a proposal is already open");
  assert.equal(readAllCalled, 0, "planner does not read the ledger to suppress proposals");
  assert.equal(d.calls.httpPost.length, 1, "no open Paperclip duplicate means a DIRECTIVE may be written");
  assert.equal(d.calls.append.length, 1, "ledger remains an append-only audit sink after the write");
});

await t("T2: stated metric gate - ventures without an owner-stated metric are skipped before network work", async () => {
  const d = deps({ activeVentures: async () => [venture({ metrik: "   " })] });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, false);
  assert.equal(result.skipped[0].reason, "missing-stated-metric");
  assert.equal(d.calls.discoverPaperclipPort.length, 0, "no Paperclip discovery for unplannable venture");
  assert.equal(d.calls.repoFingerprint.length, 0, "no fingerprint work when metric is missing");
});

await t("T3: owner decision gate - unresolved owner questions block proposal creation", async () => {
  const d = deps({
    activeVentures: async () => [venture({ owner_decision_required: ["choose launch surface"] })],
    ownerDecisionRequiredFor: async () => ["confirm metric denominator"],
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, false);
  assert.equal(result.skipped[0].reason, "owner-decision-required");
  assert.deepEqual(result.skipped[0].ownerDecisions, ["choose launch surface", "confirm metric denominator"]);
  assert.equal(d.calls.httpPost.length, 0);
});

await t("T4: one issue per sweep - two fresh ventures still produce only the first directive", async () => {
  const d = deps({
    activeVentures: async () => [
      venture({ id: "sjs-superapps", repoPath: "ventures/sjs-superapps" }),
      venture({ id: "caveman-trading-os", repoPath: "ventures/caveman-trading-os" }),
    ],
    repoFingerprint: async ({ venture: v }) => `head:${v.id}`,
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, true);
  assert.equal(result.ventureId, "sjs-superapps");
  assert.equal(d.calls.httpPost.length, 1, "planner emits exactly one issue per run");
  assert.equal(d.calls.append.length, 1, "only the emitted issue is recorded");
});

await t("T5: Paperclip duplicate gate - an existing open DIRECTIVE for the venture blocks a new one", async () => {
  const v = venture();
  const key = proposalKeyFor(v, "head:abc clean");
  const d = deps({
    activeVentures: async () => [v],
    listIssues: async (...args) => {
      d.calls.listIssues.push(args);
      return {
        issues: [{
          id: "iss-open",
          identifier: "KOL-88",
          status: "todo",
          title: "DIRECTIVE: existing",
          description: `${markerForProposal(key)}\nVENTURE_ID: ${v.id}`,
          labels: [{ name: "DIRECTIVE" }],
        }],
      };
    },
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, false);
  assert.equal(result.reason, "open-paperclip-directive-exists");
  assert.equal(d.calls.ensureLabel.length, 0, "no label write is needed for a duplicate");
  assert.equal(d.calls.httpPost.length, 0);
});

await t("T6: directive body carries hard stops and the budget-capped specialist section verbatim", async () => {
  const packet = specialist({ section: "BUDGET CAPPED SECTION\nDo not paste the persona file." });
  const issue = buildDirectiveIssue({
    venture: venture({ hardStops: ["Do not touch billing"] }),
    fingerprint: "head:abc clean",
    proposalKey: "venture:sjs-superapps:test",
    hardStops: ["Do not touch billing", "No package installs"],
    specialistPacket: packet,
  });

  assert.match(issue.title, /^DIRECTIVE:/);
  assert.match(issue.description, /HARD STOPS:\n- Do not touch billing\n- No package installs/);
  assert.ok(issue.description.includes("BUDGET CAPPED SECTION\nDo not paste the persona file."), "section is included verbatim");
  assert.equal(issue.description.includes("10-18 KB"), false, "the planner does not paste persona-file warning text or persona bodies");
  assert.match(issue.description, /The only execution pipeline is ops-watcher\/directive-runner\.mjs/);
});

await t("T7: Paperclip discovery uses the resilient retry contract, labels DIRECTIVE, appends ledger, and never executes", async () => {
  const d = deps();

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, true);
  assert.deepEqual(d.calls.discoverPaperclipPort, [{ injected: null, opts: PAPERCLIP_DISCOVERY_OPTS }]);
  assert.deepEqual(d.calls.ensureLabel[0], ["http://127.0.0.1:3456", "C", "DIRECTIVE", DIRECTIVE_LABEL_COLOR]);
  assert.equal(d.calls.httpPost[0][0], "http://127.0.0.1:3456/api/companies/C/issues");
  assert.equal(d.calls.httpPost[0][1].labels[0], "DIRECTIVE");
  assert.deepEqual(d.calls.httpPost[0][1].labelIds, ["lbl-directive"]);
  assert.equal(d.calls.append[0][0].kind, PLANNER_EVENT_KIND);
  assert.equal(d.calls.append[0][0].data.label, "DIRECTIVE");
  assert.equal(d.calls.execute, 0, "planner has no execution path");
});

await t("T8: goal gate - ventures without an owner-sourced goal are skipped before network work", async () => {
  const d = deps({
    activeVentures: async () => [
      venture({ id: "missing-goal", tujuan: "   ", tujuan_sumber: "docs/source.md" }),
      venture({ id: "missing-goal-source", tujuan_sumber: "   " }),
    ],
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, false);
  assert.deepEqual(result.skipped.map((s) => s.reason), ["missing-stated-goal", "missing-stated-goal"]);
  assert.equal(d.calls.repoFingerprint.length, 0, "no fingerprint work when goal/source is not grounded");
  assert.equal(d.calls.discoverPaperclipPort.length, 0, "no Paperclip work for ungrounded venture goals");
});

await t("T9: registry boundary - inactive ventures and ventures without repo paths are not planned", async () => {
  const d = deps({
    activeVentures: async () => [
      venture({ id: "paused", status: "paused" }),
      venture({ id: "missing-repo", repoPath: "   " }),
    ],
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, false);
  assert.deepEqual(result.skipped.map((s) => s.reason), ["inactive-venture", "missing-repo-path"]);
  assert.equal(d.calls.repoFingerprint.length, 0);
  assert.equal(d.calls.httpPost.length, 0);
});

await t("T10: metric source gate - a metric without a source is not treated as owner-stated", async () => {
  const d = deps({ activeVentures: async () => [venture({ metrik_sumber: "   " })] });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, false);
  assert.equal(result.skipped[0].reason, "missing-stated-metric-source");
  assert.equal(d.calls.repoFingerprint.length, 0, "no repo work when metric provenance is missing");
  assert.equal(d.calls.httpPost.length, 0);
});

await t("T11: specialist matrix hard stops are rendered as hard stops, not only routing flavor", async () => {
  const d = deps({
    resolveSpecialistsForPacket: async (text) => {
      d.calls.resolveSpecialistsForPacket.push(text);
      return specialist({ hardStops: ["Do not invent a new design system"] });
    },
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.created, true);
  const description = d.calls.httpPost[0][1].description;
  assert.match(description, /HARD STOPS:\n- Do not invent a new design system/);
});

await t("T12: Paperclip duplicate inspection fails closed before writing", async () => {
  const d = deps({
    listIssues: async (...args) => {
      d.calls.listIssues.push(args);
      throw new Error("Paperclip unavailable");
    },
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.ok, false);
  assert.equal(result.created, false);
  assert.equal(result.reason, "paperclip-list-failed");
  assert.equal(d.calls.ensureLabel.length, 0);
  assert.equal(d.calls.httpPost.length, 0);
  assert.equal(d.calls.append.length, 0);
});

await t("T13: label setup must produce an id before the DIRECTIVE is posted", async () => {
  const d = deps({
    ensureLabel: async (...args) => {
      d.calls.ensureLabel.push(args);
      return { created: true };
    },
  });

  const result = await runVenturePlannerOnce(d);

  assert.equal(result.ok, false);
  assert.equal(result.created, false);
  assert.equal(result.reason, "paperclip-label-missing");
  assert.equal(d.calls.httpPost.length, 0);
  assert.equal(d.calls.append.length, 0);
});

await t("T14: per-venture lock - a locked venture is skipped without blocking a healthy one", async () => {
  const locked = venture({ id: "locked-venture", repoPath: "ventures/locked" });
  const healthy = venture({ id: "healthy-venture", repoPath: "ventures/healthy" });
  await removeLock(locked);
  await removeLock(healthy);
  await writeFile(lockPathForVenture(locked), "already running\n");
  const d = deps({
    activeVentures: async () => [locked, healthy],
    repoFingerprint: async ({ venture: v }) => {
      d.calls.repoFingerprint.push(v.id);
      return `head:${v.id} clean`;
    },
  });

  try {
    const result = await runVenturePlannerOnce(d);

    assert.equal(result.created, true);
    assert.equal(result.ventureId, "healthy-venture");
    assert.deepEqual(result.skipped.map((s) => s.reason), ["venture-lock-held"]);
    assert.deepEqual(d.calls.repoFingerprint, ["healthy-venture"], "locked venture is not fingerprinted");
    assert.equal(await lockExists(healthy), false, "healthy venture lock is released after success");
  } finally {
    await removeLock(locked);
    await removeLock(healthy);
  }
});

await t("T15: dirty repo guard - a dirty fingerprint skips the venture before routing or Paperclip writes", async () => {
  const dirty = venture({ id: "dirty-venture", repoPath: "ventures/dirty" });
  const d = deps({
    activeVentures: async () => [dirty],
    repoFingerprint: async () => "abc123\n M src/app.js",
  });

  try {
    assert.equal(fingerprintIndicatesDirtyRepo("abc123\n?? new-file.js"), true);
    assert.equal(fingerprintIndicatesDirtyRepo("head:abc clean"), false);

    const result = await runVenturePlannerOnce(d);

    assert.equal(result.created, false);
    assert.equal(result.reason, "no-new-venture-directive");
    assert.equal(result.skipped[0].reason, "dirty-repo");
    assert.equal(d.calls.resolveSpecialistsForPacket.length, 0, "no specialist routing for a dirty repo");
    assert.equal(d.calls.discoverPaperclipPort.length, 0, "no Paperclip work for a dirty repo");
    assert.equal(await lockExists(dirty), false, "dirty venture lock is released after skip");
  } finally {
    await removeLock(dirty);
  }
});

await t("T16: lock cleanup - returned failures and internal throws do not leak venture locks", async () => {
  const failedList = venture({ id: "list-fails" });
  const appendThrows = venture({ id: "append-throws" });
  await removeLock(failedList);
  await removeLock(appendThrows);

  const listFailureDeps = deps({
    activeVentures: async () => [failedList],
    listIssues: async (...args) => {
      listFailureDeps.calls.listIssues.push(args);
      throw new Error("Paperclip unavailable");
    },
  });
  const listResult = await runVenturePlannerOnce(listFailureDeps);
  assert.equal(listResult.ok, false);
  assert.equal(listResult.reason, "paperclip-list-failed");
  assert.equal(await lockExists(failedList), false, "lock is released after returned failure");

  const throwDeps = deps({
    activeVentures: async () => [appendThrows],
    append: async (...args) => {
      throwDeps.calls.append.push(args);
      throw new Error("ledger unavailable");
    },
  });
  await assert.rejects(() => runVenturePlannerOnce(throwDeps), /ledger unavailable/);
  assert.equal(await lockExists(appendThrows), false, "lock is released after thrown error");
});

console.log("");
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
process.exit(0);
