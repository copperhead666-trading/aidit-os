// ops-watcher/graphify-analyst.regression.test.mjs
// Offline regression coverage for GRAPHIFY-ANALYST. NO real kimi process is
// invoked — the spawn is never reached in these tests (either the graph is
// missing -> exit 1, or the pure functions are tested directly with injected
// values). Uses node:assert/strict only.
//
//   node ops-watcher/graphify-analyst.regression.test.mjs

import assert from "node:assert/strict";
import { computeStaleness, buildPrompt } from "./graphify-analyst.mjs";

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

// ---- T1: Graph older than newest source file by >1h -> staleness detected ----
async function t1_stalenessDetectedWhenGraphOlderThan1h() {
  const graphMtime = 1_000_000_000_000; // some old time
  const newestSourceMtime = graphMtime + 2 * 60 * 60 * 1000; // 2 hours newer
  const result = computeStaleness(graphMtime, newestSourceMtime);
  assert.equal(result.stale, true, "T1: graph 2h older than newest source -> stale=true");
  assert.ok(result.ageMs > result.thresholdMs, "T1: ageMs exceeds thresholdMs");
  assert.equal(result.thresholdMs, 60 * 60 * 1000, "T1: threshold is 1 hour");
  ok("T1: graph older than newest source by >1h -> staleness=true");
}

// ---- T2: Graph newer than (or within 1h of) newest source -> no staleness ----
async function t2_noStalenessWhenGraphRecent() {
  const graphMtime = 1_000_000_000_000;
  const newestSourceMtime = graphMtime + 30 * 60 * 1000; // 30 min newer (within 1h)
  const result = computeStaleness(graphMtime, newestSourceMtime);
  assert.equal(result.stale, false, "T2: graph 30min older than newest source -> stale=false");
  ok("T2: graph within 1h of newest source -> staleness=false");
}

// ---- T2b: Graph newer than newest source -> not stale ----
async function t2b_noStalenessWhenGraphNewerThanSource() {
  const graphMtime = 1_000_000_000_000;
  const newestSourceMtime = graphMtime - 1000; // source is older than graph
  const result = computeStaleness(graphMtime, newestSourceMtime);
  assert.equal(result.stale, false, "T2b: graph newer than source -> stale=false");
  ok("T2b: graph newer than newest source -> staleness=false");
}

// ---- T3: Staleness note included in built prompt when graph is stale ----
async function t3_stalenessNoteIncludedInPrompt() {
  const question = "What calls runCommandTool?";
  const graphContent = '{"nodes": [], "links": []}';
  const stalenessDate = "2026-08-28T10:00:00.000Z";
  const prompt = buildPrompt(question, graphContent, stalenessDate);
  assert.ok(prompt.includes("GRAPHIFY-ANALYST"), "T3: prompt identifies as GRAPHIFY-ANALYST");
  assert.ok(prompt.includes("NOTE: this graph was last built on 2026-08-28T10:00:00.000Z"), "T3: staleness disclosure includes the date");
  assert.ok(prompt.includes("may not reflect files changed more recently"), "T3: staleness warning text included");
  assert.ok(prompt.includes(question), "T3: question included in prompt");
  assert.ok(prompt.includes(graphContent), "T3: graph content included in prompt");
  ok("T3: stale graph -> staleness note included in built prompt");
}

// ---- T4: No staleness note when stalenessNote is null ----
async function t4_noStalenessNoteWhenNull() {
  const question = "What depends on X?";
  const graphContent = '{"nodes": [], "links": []}';
  const prompt = buildPrompt(question, graphContent, null);
  assert.ok(prompt.includes("GRAPHIFY-ANALYST"), "T4: prompt identifies as GRAPHIFY-ANALYST");
  assert.ok(!prompt.includes("NOTE: this graph was last built"), "T4: no staleness note when stalenessNote is null");
  assert.ok(prompt.includes(question), "T4: question included");
  ok("T4: no staleness note when stalenessNote is null");
}

// ---- T5: computeStaleness with non-finite inputs -> stale=false, ageMs=NaN ----
async function t5_computeStalenessNonFinite() {
  const result = computeStaleness(NaN, 1_000_000_000_000);
  assert.equal(result.stale, false, "T5: NaN graph mtime -> stale=false");
  assert.ok(Number.isNaN(result.ageMs), "T5: NaN graph mtime -> ageMs=NaN");
  const result2 = computeStaleness(1_000_000_000_000, NaN);
  assert.equal(result2.stale, false, "T5b: NaN source mtime -> stale=false");
  ok("T5: non-finite inputs -> stale=false, ageMs=NaN");
}

// ---- T6: buildPrompt includes all required structural-instruction elements ----
async function t6_buildPromptStructuralInstructions() {
  const prompt = buildPrompt("test question", "graph data", null);
  assert.ok(prompt.includes("structural/multi-hop code-relationship"), "T6: structural/multi-hop framing present");
  assert.ok(prompt.includes("source_file/source_location"), "T6: source_file/source_location guidance present");
  assert.ok(prompt.includes("community groupings"), "T6: community groupings guidance present");
  assert.ok(prompt.includes("If the graph does not contain enough information"), "T6: explicit 'say so' instruction present");
  ok("T6: buildPrompt includes all required structural-instruction elements");
}

// ---- T7: Boundary case — exactly 1 hour is NOT stale (ageMs must be > threshold) ----
async function t7_boundaryExactly1hNotStale() {
  const graphMtime = 1_000_000_000_000;
  const newestSourceMtime = graphMtime + 60 * 60 * 1000; // exactly 1h
  const result = computeStaleness(graphMtime, newestSourceMtime);
  assert.equal(result.stale, false, "T7: exactly 1h -> not stale (must be > threshold, not >=)");
  ok("T7: exactly 1 hour boundary -> not stale (> threshold required)");
}

async function main() {
  const tests = [
    t1_stalenessDetectedWhenGraphOlderThan1h,
    t2_noStalenessWhenGraphRecent,
    t2b_noStalenessWhenGraphNewerThanSource,
    t3_stalenessNoteIncludedInPrompt,
    t4_noStalenessNoteWhenNull,
    t5_computeStalenessNonFinite,
    t6_buildPromptStructuralInstructions,
    t7_boundaryExactly1hNotStale,
  ];
  for (const t of tests) await t();
  console.log(`\ngraphify-analyst.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();