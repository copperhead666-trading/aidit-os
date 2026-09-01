// ops-watcher/ahmad-context-retrieval.regression.test.mjs
// Offline regression coverage for the standalone Cognitive Core retrieval
// prototype. NO live GBrain, NO live Graphify, NO live Paperclip, NO dispatch
// wiring, NO claude/hermes spawn. runGbrain/readGraphify/getSourceInfo are all
// fixture-injected. Run with:
//   node ops-watcher/ahmad-context-retrieval.regression.test.mjs

import assert from "node:assert/strict";
import { retrieveDispatchContext } from "./ahmad-context-retrieval.mjs";

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

function issue(overrides = {}) {
  return {
    id: "iss-ctx-1",
    identifier: "KOL-61",
    status: "todo",
    labels: [{ name: "DIRECTIVE" }],
    title: "P2 Cognitive Core retrieval prototype",
    description: "Build a bounded standalone retrieval module for AHMAD.",
    ...overrides,
  };
}

const BASE_INPUT = {
  issue: issue(),
  targetRole: "CORLEONE",
  taskKind: "implementation",
  mentionedPaths: ["ops-watcher/ahmad-context-retrieval.mjs"],
  now: "2026-08-29T07:00:00.000Z",
};

const GRAPH_FIXTURE = {
  nodes: [
    {
      id: "n1",
      label: "ahmad-context-retrieval module",
      source_file: "ops-watcher/ahmad-context-retrieval.mjs",
      source_location: "retrieveDispatchContext",
      context: "Standalone context retrieval boundary",
    },
  ],
  links: [],
};

function gbrainFixture(outputs, calls = []) {
  return async ({ command, args, gbrainHome }) => {
    calls.push({ command, args, gbrainHome });
    const key = `${command} ${args.join(" ")}`.trim();
    const byExact = outputs[key];
    const byCommand = outputs[command];
    const value = byExact || byCommand || { code: 0, stdout: "", stderr: "" };
    if (value instanceof Error) throw value;
    return value;
  };
}

function deps(overrides = {}) {
  return {
    gbrainHome: "D:\\fixtures\\gbrain-home",
    timeoutMs: 100,
    runGbrain: gbrainFixture({
      query: {
        code: 0,
        stdout: "[0.9300] task-packet-standard -- Defines compact dispatch packet expectations.\n",
        stderr: "",
      },
      search: {
        code: 0,
        stdout: "[0.8800] founderos-gbrain-local-setup -- Local GBrain setup and store details.\n",
        stderr: "",
      },
      stats: { code: 0, stdout: "Pages:     18\nChunks:    34\n", stderr: "" },
      "get task-packet-standard": {
        code: 0,
        stdout: "---\ntype: note\ntitle: Task Packet Standard\ncaptured_at: '2026-08-29T06:00:00.000Z'\n---\n# Task Packet Standard\nDefines compact dispatch packet expectations.\n",
        stderr: "",
      },
      "get founderos-gbrain-local-setup": {
        code: 0,
        stdout: "---\ntype: note\ntitle: FounderOS-Aidit Local G-Brain\ncaptured_at: '2026-08-29T06:00:00.000Z'\n---\n# FounderOS-Aidit Local G-Brain\nLocal, zero-cost knowledge brain.\n",
        stderr: "",
      },
      graph: { code: 0, stdout: "[]\n", stderr: "" },
    }),
    readGraphify: async () => GRAPH_FIXTURE,
    getSourceInfo: async () => null,
    ...overrides,
  };
}

async function t1_okStatusWithEvidence() {
  const calls = [];
  const r = await retrieveDispatchContext(BASE_INPUT, deps({
    runGbrain: gbrainFixture({
      query: {
        code: 0,
        stdout: "[0.9300] task-packet-standard -- Defines compact dispatch packet expectations.\n",
        stderr: "",
      },
      search: {
        code: 0,
        stdout: "[0.8800] founderos-gbrain-local-setup -- Local GBrain setup and store details.\n",
        stderr: "",
      },
      stats: { code: 0, stdout: "Pages:     18\nChunks:    34\n", stderr: "" },
      "get task-packet-standard": {
        code: 0,
        stdout: "---\ntype: note\ntitle: Task Packet Standard\ncaptured_at: '2026-08-29T06:00:00.000Z'\n---\n# Task Packet Standard\nDefines compact dispatch packet expectations.\n",
        stderr: "",
      },
      "get founderos-gbrain-local-setup": {
        code: 0,
        stdout: "---\ntype: note\ntitle: FounderOS-Aidit Local G-Brain\ncaptured_at: '2026-08-29T06:00:00.000Z'\n---\n# FounderOS-Aidit Local G-Brain\nLocal, zero-cost knowledge brain.\n",
        stderr: "",
      },
      graph: { code: 0, stdout: "[]\n", stderr: "" },
    }, calls),
  }));
  assert.equal(r.context_bundle_version, "0.1");
  assert.equal(r.generated_at, "2026-08-29T07:00:00.000Z");
  assert.equal(r.query_summary, "pre-dispatch context for KOL-61");
  assert.equal(r.status, "ok");
  assert.ok(r.evidence.some((e) => e.source === "gbrain:task-packet-standard"));
  assert.ok(r.evidence.some((e) => e.source === "graphify:active"));
  assert.ok(calls.every((c) => ["query", "search", "stats", "get", "graph"].includes(c.command)));
  assert.ok(calls.every((c) => c.gbrainHome === "D:\\fixtures\\gbrain-home"));
  ok("T1: clean ok status with bounded GBrain + Graphify evidence returned");
}

async function t2_emptyWhenNothingRelevantFound() {
  const r = await retrieveDispatchContext(BASE_INPUT, deps({
    runGbrain: gbrainFixture({
      query: { code: 0, stdout: "", stderr: "" },
      search: { code: 0, stdout: "", stderr: "" },
      stats: { code: 0, stdout: "Pages:     18\n", stderr: "" },
    }),
    readGraphify: async () => ({ nodes: [], links: [] }),
  }));
  assert.equal(r.status, "empty");
  assert.deepEqual(r.evidence, []);
  assert.deepEqual(r.conflicts, []);
  ok("T2: empty status when no GBrain or Graphify fixture returns relevant evidence");
}

async function t3_degradedWhenReadCallFails() {
  const r = await retrieveDispatchContext(BASE_INPUT, deps({
    runGbrain: gbrainFixture({
      query: new Error("fixture gbrain unavailable"),
      search: { code: 0, stdout: "", stderr: "" },
      stats: { code: 0, stdout: "Pages:     18\n", stderr: "" },
    }),
    readGraphify: async () => ({ nodes: [], links: [] }),
  }));
  assert.equal(r.status, "degraded");
  assert.ok(r.excluded_hits.some((h) => /gbrain:query/.test(h.source)));
  assert.ok(r.excluded_hits.some((h) => /fixture gbrain unavailable/.test(h.reason)));
  ok("T3: degraded status when an injected GBrain call fails");
}

async function t4_conflictedWhenFixtureSourcesDisagree() {
  const r = await retrieveDispatchContext(BASE_INPUT, deps({
    runGbrain: gbrainFixture({
      query: {
        code: 0,
        stdout: "[0.9900] fos-14-history -- Older scope assertion.\n",
        stderr: "",
      },
      search: { code: 0, stdout: "", stderr: "" },
      stats: { code: 0, stdout: "Pages:     18\n", stderr: "" },
      "get fos-14-history": {
        code: 0,
        stdout: "---\ntitle: FOS-14 Historical Scope\ncaptured_at: '2026-08-28T00:00:00.000Z'\n---\ntopic: FOS-14 index scope\nstatus: only smoke-test notes\n",
        stderr: "",
      },
      graph: { code: 0, stdout: "[]", stderr: "" },
    }),
    readGraphify: async () => ({ nodes: [], links: [] }),
    canonicalClaims: [{
      topic: "FOS-14 index scope",
      field: "status",
      value: "18 pages indexed",
      evidence: "gbrain stats/list show 18 pages",
    }],
  }));
  assert.equal(r.status, "conflicted");
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].topic, "FOS-14 index scope");
  assert.ok(/only smoke-test notes/.test(r.conflicts[0].older_evidence));
  assert.ok(/18 pages indexed/.test(r.conflicts[0].current_evidence));
  ok("T4: conflicted status surfaces disagreement instead of silently resolving it");
}

async function t5_staleWarningWhenGbrainOlderThanSource() {
  const r = await retrieveDispatchContext(BASE_INPUT, deps({
    runGbrain: gbrainFixture({
      query: {
        code: 0,
        stdout: "[0.9700] agent-registry -- Registry capture.\n",
        stderr: "",
      },
      search: { code: 0, stdout: "", stderr: "" },
      stats: { code: 0, stdout: "Pages:     18\n", stderr: "" },
      "get agent-registry": {
        code: 0,
        stdout: "---\ntype: concept\ntitle: Agent Registry\ncaptured_at: '2026-08-28T00:00:00.000Z'\n---\nlast_updated_at: 2026-08-28\n",
        stderr: "",
      },
      graph: { code: 0, stdout: "[]", stderr: "" },
    }),
    readGraphify: async () => ({ nodes: [], links: [] }),
    getSourceInfo: async (relPath) => ({
      path: relPath,
      lastUpdatedAt: "2026-08-29T00:00:00.000Z",
      mtimeIso: "2026-08-29T00:00:00.000Z",
      claims: [],
    }),
  }));
  assert.equal(r.status, "ok");
  assert.equal(r.stale_warnings.length, 1);
  assert.equal(r.stale_warnings[0].source, "gbrain:agent-registry");
  assert.ok(/2026-08-28/.test(r.stale_warnings[0].warning));
  assert.ok(/2026-08-29/.test(r.stale_warnings[0].warning));
  assert.ok(r.evidence.find((e) => e.source === "gbrain:agent-registry").freshness === "stale");
  ok("T5: stale_warnings entry appears when GBrain page timestamp is older than current source timestamp");
}

async function t6_timeoutReturnsWithinBound() {
  const start = Date.now();
  const r = await retrieveDispatchContext(BASE_INPUT, deps({
    timeoutMs: 30,
    runGbrain: async () => new Promise(() => {}),
    readGraphify: async () => ({ nodes: [], links: [] }),
  }));
  const elapsed = Date.now() - start;
  assert.equal(r.status, "degraded");
  assert.ok(elapsed < 500, `retrieval should return quickly after timeout, got ${elapsed}ms`);
  assert.ok(r.excluded_hits.some((h) => /timed out/.test(h.reason)));
  ok("T6: stuck injected command runner times out and retrieveDispatchContext returns within the bound");
}

async function main() {
  const tests = [
    t1_okStatusWithEvidence,
    t2_emptyWhenNothingRelevantFound,
    t3_degradedWhenReadCallFails,
    t4_conflictedWhenFixtureSourcesDisagree,
    t5_staleWarningWhenGbrainOlderThanSource,
    t6_timeoutReturnsWithinBound,
  ];
  for (const t of tests) await t();
  console.log(`\nahmad-context-retrieval.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();

