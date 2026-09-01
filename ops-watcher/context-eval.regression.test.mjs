// ops-watcher/context-eval.regression.test.mjs
// Offline regression coverage for the context-retrieval evaluation harness.
// NO live GBrain, NO live retrieval, NO real Graphify, NO Paperclip. Every
// case uses fully injected fixtures. House style: node:assert/strict, local
// counter, final REGRESSION RESULT line, no node:test, no dependencies.
//
//   node ops-watcher/context-eval.regression.test.mjs

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreBundle, evaluateCase, runEval } from "./context-eval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS_FILE = path.join(__dirname, "context-eval-questions.json");

let pass = 0;
let fail = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };
const bad = (label, err) => { fail += 1; console.error(`FAIL ${label}: ${err && err.message ? err.message : err}`); };

// ---- helpers ----
function caseDef(overrides = {}) {
  return {
    id: "t01",
    question: "test question",
    issue: { identifier: "KOL-T", title: "test", description: "test desc" },
    targetRole: "HATTA",
    taskKind: "implementation",
    must_include_any: ["ops-watcher/heartbeat.mjs"],
    must_not_include: ["config/decision-ledger.json"],
    ...overrides,
  };
}

function bundle(evidence = [], extra = {}) {
  return {
    context_bundle_version: "0.1",
    generated_at: "2026-09-01T00:00:00.000Z",
    query_summary: "pre-dispatch context for KOL-T",
    status: "ok",
    evidence,
    canonical_pointers: evidence.map((e) => e.canonical_pointer).filter(Boolean),
    stale_warnings: [],
    conflicts: [],
    excluded_hits: [],
    ...extra,
  };
}

function ev(source, canonicalPointer, extra = {}) {
  return {
    title: extra.title || "evidence",
    source,
    canonical_pointer: canonicalPointer,
    why_relevant: "test",
    freshness: "current",
    confidence: "HIGH",
    excerpt: extra.excerpt || "test excerpt",
    ...extra,
  };
}

// ---- Test 1: scoreBundle counts a hit when one expected source is present ----
async function t1_hitWhenExpectedPresent() {
  const cd = caseDef();
  const b = bundle([
    ev("gbrain:heartbeat-steps", "ops-watcher/heartbeat.mjs:L60"),
  ]);
  const s = scoreBundle(cd, b);
  assert.equal(s.id, "t01");
  assert.equal(s.hit, true, "hit must be true when an expected source appears in evidence");
  assert.equal(s.matchedSources.length, 1);
  assert.ok(s.matchedSources.includes("ops-watcher/heartbeat.mjs"));
  assert.equal(s.missedExpected.length, 0);
  ok("T1: scoreBundle counts a hit when one expected source is present");
}

// ---- Test 2: scoreBundle no hit when none of the expected sources are present ----
async function t2_noHitWhenNonePresent() {
  const cd = caseDef();
  const b = bundle([
    ev("gbrain:unrelated", "handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"),
  ]);
  const s = scoreBundle(cd, b);
  assert.equal(s.hit, false, "hit must be false when no expected source appears");
  assert.equal(s.matchedSources.length, 0);
  assert.equal(s.missedExpected.length, 1);
  assert.ok(s.missedExpected.includes("ops-watcher/heartbeat.mjs"));
  ok("T2: scoreBundle records no hit and lists missedExpected when none present");
}

// ---- Test 3: scoreBundle flags a false positive from must_not_include ----
async function t3_falsePositiveFromMustNotInclude() {
  const cd = caseDef();
  // The bundle surfaces BOTH the expected source AND the must_not_include path.
  const b = bundle([
    ev("gbrain:heartbeat-steps", "ops-watcher/heartbeat.mjs:L60"),
    ev("gbrain:decision-ledger", "config/decision-ledger.json"),
  ]);
  const s = scoreBundle(cd, b);
  assert.equal(s.hit, true, "hit is still true (expected source present)");
  assert.equal(s.falsePositive, true, "falsePositive must be true when a must_not_include entry appears");
  assert.ok(s.falsePositiveHits && s.falsePositiveHits.includes("config/decision-ledger.json"));
  ok("T3: scoreBundle flags a false positive from must_not_include");
}

// ---- Test 4: scoreBundle reports excludedHits count + status from the real bundle fields (was the degraded test) ----
async function t4_excludedHitsAndStatusFromRealFields() {
  const cd = caseDef();
  const b = bundle([
    ev("gbrain:heartbeat-steps", "ops-watcher/heartbeat.mjs:L60"),
  ], {
    status: "degraded",
    excluded_hits: [
      { source: "gbrain:query", reason: "timed out after 5000ms" },
      { source: "graphify:active", reason: "bounded evidence cap reached" },
    ],
  });
  const s = scoreBundle(cd, b);
  assert.equal(s.excludedHits, 2, "excludedHits must count the bundle's excluded_hits array");
  assert.equal(s.status, "degraded", "status must reflect the bundle's own status value");
  assert.equal(s.degradedSources, undefined, "the invented degradedSources field must be gone");
  ok("T4: scoreBundle reports excludedHits count and status from the real bundle fields");
}

// ---- Test 5: out-of-scope case scores correctly when bundle returns no evidence ----
async function t5_outOfScopeEmptyBundle() {
  const cd = caseDef({
    id: "q12",
    must_include_any: [],
    must_not_include: ["ops-watcher/heartbeat.mjs", "config/agent-registry.json"],
  });
  // The bundle returns NO evidence (the correct answer for an out-of-scope question).
  const b = bundle([], { status: "empty" });
  const s = scoreBundle(cd, b);
  assert.equal(s.hit, false, "hit must be false — no expected sources to match, and none present");
  assert.equal(s.falsePositive, false, "must NOT be a false positive — no must_not_include entries appear in the empty bundle");
  assert.equal(s.unitsReturned, 0);
  assert.equal(s.matchedSources.length, 0);
  assert.equal(s.missedExpected.length, 0);
  ok("T5: out-of-scope case scores hit=false and NOT a false positive when bundle returns no evidence");
}

// ---- Test 5b: out-of-scope case IS a false positive when retrieval surfaces unrelated files ----
async function t5b_outOfScopeFalsePositiveWhenUnrelatedSurfaced() {
  const cd = caseDef({
    id: "q12",
    must_include_any: [],
    must_not_include: ["ops-watcher/heartbeat.mjs"],
  });
  const b = bundle([
    ev("graphify:active", "ops-watcher/heartbeat.mjs:L60"),
  ]);
  const s = scoreBundle(cd, b);
  assert.equal(s.hit, false, "hit stays false (no expected sources)");
  assert.equal(s.falsePositive, true, "falsePositive must be true — heartbeat.mjs appeared for an unrelated question");
  ok("T5b: out-of-scope case flags false positive when retrieval surfaces a must_not_include file");
}

// ---- Test 6: runEval aggregates hits/hitRate/avgUnits across injected cases and never throws when one retrieval rejects ----
async function t6_runEvalAggregatesAndSurvivesRejection() {
  const cases = [
    caseDef({ id: "c1", must_include_any: ["ops-watcher/heartbeat.mjs"] }),
    caseDef({ id: "c2", must_include_any: ["ops-watcher/lane-guard.mjs"], must_not_include: [] }),
    caseDef({ id: "c3", must_include_any: ["ops-watcher/self-repair.mjs"], must_not_include: [] }),
  ];

  // retrieveContext returns a different bundle per case id; c2's retrieval REJECTS.
  const retrieveContext = async (input) => {
    const ident = input.issue.identifier;
    if (ident === "KOL-T") {
      // c1
      return bundle([ev("gbrain:hb", "ops-watcher/heartbeat.mjs:L1")]);
    }
    if (ident === "KOL-T2") {
      throw new Error("injected retrieval rejected for c2");
    }
    // c3 — returns unrelated evidence (a miss, not an error)
    return bundle([ev("gbrain:unrelated", "handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json")]);
  };

  // We need distinct issue identifiers so the mock can branch. Override cases.
  const casesWithIds = [
    { ...cases[0], issue: { identifier: "KOL-T", title: "c1", description: "d" } },
    { ...cases[1], issue: { identifier: "KOL-T2", title: "c2", description: "d" } },
    { ...cases[2], issue: { identifier: "KOL-T3", title: "c3", description: "d" } },
  ];

  const result = await runEval({ cases: casesWithIds, retrieveContext });

  assert.equal(result.total, 3);
  assert.equal(result.hits, 1, "only c1 should be a hit (c2 errored, c3 missed)");
  assert.equal(result.hitRate, round2(1 / 3));
  assert.equal(result.errors, 1, "c2's rejection must be recorded as an error, not crash the run");
  assert.equal(result.degradedRuns, undefined, "degradedRuns must be removed from the aggregate");
  assert.ok(result.statusCounts, "aggregate must report a statusCounts map");
  assert.equal(result.statusCounts.error, 1, "the errored case counts as status=error");
  // The errored case is still in the results.
  const c2Result = result.cases.find((c) => c.id === "c2");
  assert.ok(c2Result, "c2 must appear in results despite rejection");
  assert.ok(c2Result.error, "c2 must carry an error string");
  assert.equal(c2Result.score.hit, false);
  assert.deepEqual(c2Result.score.sourceKinds, [], "errored case has no source kinds");
  // avgUnits: c1 has 1 unit, c2 has 0 (errored), c3 has 1 unit -> 2/3
  assert.equal(result.avgUnits, round2(2 / 3));
  ok("T6: runEval aggregates hits/hitRate/avgUnits and never throws when one case's retrieval rejects");
}

// ---- Test 7: the question file parses, has 12 cases, unique ids, and every case has non-empty must_include_any except the out-of-scope one ----
async function t7_questionFileShape() {
  const raw = await fs.readFile(QUESTIONS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.schema_version, "1.0.0");
  assert.ok(Array.isArray(parsed.cases), "cases must be an array");
  assert.equal(parsed.cases.length, 12, "must have exactly 12 cases");

  const ids = parsed.cases.map((c) => c.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "all case ids must be unique");

  for (const c of parsed.cases) {
    assert.ok(c.id, "every case must have an id");
    assert.ok(c.question, "every case must have a question");
    assert.ok(c.issue && c.issue.identifier, "every case must have an issue.identifier");
    assert.ok(c.targetRole, "every case must have a targetRole");
    assert.ok(c.taskKind, "every case must have a taskKind");
    assert.ok(Array.isArray(c.must_include_any), "every case must have a must_include_any array");
    assert.ok(Array.isArray(c.must_not_include), "every case must have a must_not_include array");
    assert.ok(c.rationale, "every case must have a rationale");
  }

  // The out-of-scope case (q12) is the ONLY one with an empty must_include_any.
  const emptyMustInclude = parsed.cases.filter((c) => c.must_include_any.length === 0);
  assert.equal(emptyMustInclude.length, 1, "exactly one case must have empty must_include_any (the out-of-scope case)");
  assert.equal(emptyMustInclude[0].id, "q12", "the out-of-scope case must be q12");

  // Every non-out-of-scope case has non-empty must_include_any with real entries.
  for (const c of parsed.cases) {
    if (c.id === "q12") continue;
    assert.ok(c.must_include_any.length > 0, `case ${c.id} must have non-empty must_include_any`);
    for (const entry of c.must_include_any) {
      assert.ok(typeof entry === "string" && entry.length > 0, `case ${c.id} must_include_any entries must be non-empty strings`);
    }
  }

  ok("T7: question file parses, has 12 cases, unique ids, and only q12 has empty must_include_any");
}

// ---- Test 8: evaluateCase returns a score and latency even when retrieval returns an empty bundle ----
async function t8_evaluateCaseEmptyBundle() {
  const cd = caseDef({ id: "q12", must_include_any: [], must_not_include: ["ops-watcher/heartbeat.mjs"] });
  const retrieveContext = async () => bundle([], { status: "empty" });
  const r = await evaluateCase(cd, { retrieveContext, now: () => 1000 });
  assert.equal(r.id, "q12");
  assert.equal(r.error, null);
  assert.equal(r.score.hit, false);
  assert.equal(r.score.falsePositive, false);
  assert.equal(r.score.status, "empty");
  assert.deepEqual(r.score.sourceKinds, []);
  assert.ok(Number.isFinite(r.latencyMs));
  ok("T8: evaluateCase returns a score and latency for an empty (out-of-scope) bundle");
}

// ---- Test 9: a graphify:active:<node_id> label + source_file matches a repo-path ground truth ----
async function t9_labelAndSourceFileMatch() {
  const cd = caseDef({ must_include_any: ["ops-watcher/heartbeat.mjs"], must_not_include: [] });
  // The unit's label is a graphify node id; the file identity is carried in
  // source_file. Both are part of the haystack.
  const b = bundle([
    ev("graphify:active:heartbeat_steps", "graphify-out/active/graph.json:heartbeat_steps", {
      source_file: "ops-watcher/heartbeat.mjs",
    }),
  ]);
  const s = scoreBundle(cd, b);
  assert.equal(s.hit, true, "a unit carrying source_file ops-watcher/heartbeat.mjs must match ground truth");
  assert.ok(s.matchedSources.includes("ops-watcher/heartbeat.mjs"));
  assert.deepEqual(s.sourceKinds, ["graphify"]);
  ok("T9: graphify:active:heartbeat_steps label + source_file ops-watcher/heartbeat.mjs matches ground truth");
}

// ---- Test 10: basename matching — ground truth path matches a unit carrying only the basename ----
async function t10_basenameMatch() {
  const cd = caseDef({ must_include_any: ["ops-watcher/lane-guard.mjs"], must_not_include: [] });
  // The unit carries only the basename in its canonical pointer.
  const b = bundle([
    ev("graphify:active", "lane-guard.mjs:L30"),
  ]);
  const s = scoreBundle(cd, b);
  assert.equal(s.hit, true, "basename lane-guard.mjs must match ground truth ops-watcher/lane-guard.mjs");
  assert.ok(s.matchedSources.includes("ops-watcher/lane-guard.mjs"));
  ok("T10: basename matching — ground truth ops-watcher/lane-guard.mjs matches a unit carrying only lane-guard.mjs");
}

// ---- Test 11: backslash paths normalise to forward slashes before matching ----
async function t11_backslashNormalisation() {
  const cd = caseDef({ must_include_any: ["ops-watcher/heartbeat.mjs"], must_not_include: [] });
  const b = bundle([
    ev("graphify:active", "ops-watcher\\heartbeat.mjs:L60"),
  ]);
  const s = scoreBundle(cd, b);
  assert.equal(s.hit, true, "backslash paths must normalise to forward slashes before matching");
  ok("T11: backslash paths normalise — ops-watcher\\heartbeat.mjs matches ground truth");
}

// ---- Test 12: must_not_include still triggers a false positive on the enriched haystack ----
async function t12_mustNotIncludeOnEnrichedHaystack() {
  const cd = caseDef({
    must_include_any: ["ops-watcher/heartbeat.mjs"],
    must_not_include: ["ops-watcher/lane-guard.mjs"],
  });
  // The forbidden file is carried in source_file with a backslash path on the
  // second unit — the enriched haystack + normalisation must still catch it.
  const b = bundle([
    ev("graphify:active:heartbeat_steps", "ops-watcher/heartbeat.mjs:L60", { source_file: "ops-watcher/heartbeat.mjs" }),
    ev("graphify:active", "ops-watcher/lane-guard.mjs:L30", { source_file: "ops-watcher\\lane-guard.mjs" }),
  ]);
  const s = scoreBundle(cd, b);
  assert.equal(s.hit, true, "expected source is present");
  assert.equal(s.falsePositive, true, "must_not_include must trigger on the enriched haystack");
  assert.ok(s.falsePositiveHits.includes("ops-watcher/lane-guard.mjs"));
  ok("T12: must_not_include still triggers a false positive on the enriched haystack");
}

// ---- Test 13: sourceKinds de-duplicates and sorts the source-label prefixes ----
async function t13_sourceKindsDedupSort() {
  const cd = caseDef({ must_include_any: [], must_not_include: [] });
  const b = bundle([
    ev("graphify:active:heartbeat_steps", "ops-watcher/heartbeat.mjs:L60"),
    ev("graphify:active", "ops-watcher/lane-guard.mjs:L30"),
    ev("gbrain:search", "config/agent-registry.json"),
    ev("gbrain:agent-registry", "config/agent-registry.json"),
  ]);
  const s = scoreBundle(cd, b);
  assert.deepEqual(s.sourceKinds, ["gbrain", "graphify"], "sourceKinds must be the sorted unique set of prefixes before the first colon");
  ok("T13: sourceKinds de-duplicates and sorts the source-label prefixes");
}

// ---- Test 14: staleWarnings / conflicts / excludedHits are read from the real bundle field names ----
async function t14_realHealthFields() {
  const cd = caseDef({ must_include_any: [], must_not_include: [] });
  const b = bundle([], {
    status: "conflicted",
    stale_warnings: [
      { source: "gbrain:agent-registry", warning: "indexed page older than source" },
      { source: "gbrain:canonical-role-map", warning: "indexed page older than source" },
    ],
    conflicts: [
      { topic: "x", older_evidence: "a says value 1", current_evidence: "b says value 2" },
    ],
    excluded_hits: [
      { source: "gbrain:query", reason: "timed out after 5000ms" },
    ],
  });
  const s = scoreBundle(cd, b);
  assert.equal(s.staleWarnings, 2, "staleWarnings must count the bundle's stale_warnings array");
  assert.equal(s.conflicts, 1, "conflicts must count the bundle's conflicts array");
  assert.equal(s.excludedHits, 1, "excludedHits must count the bundle's excluded_hits array");
  assert.equal(s.status, "conflicted", "status must reflect the bundle's own status value");
  ok("T14: staleWarnings/conflicts/excludedHits are read from the real bundle field names");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---- runner ----
async function main() {
  const tests = [
    t1_hitWhenExpectedPresent,
    t2_noHitWhenNonePresent,
    t3_falsePositiveFromMustNotInclude,
    t4_excludedHitsAndStatusFromRealFields,
    t5_outOfScopeEmptyBundle,
    t5b_outOfScopeFalsePositiveWhenUnrelatedSurfaced,
    t6_runEvalAggregatesAndSurvivesRejection,
    t7_questionFileShape,
    t8_evaluateCaseEmptyBundle,
    t9_labelAndSourceFileMatch,
    t10_basenameMatch,
    t11_backslashNormalisation,
    t12_mustNotIncludeOnEnrichedHaystack,
    t13_sourceKindsDedupSort,
    t14_realHealthFields,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (err) {
      bad(t.name, err);
    }
  }
  console.log(`\nREGRESSION RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main();