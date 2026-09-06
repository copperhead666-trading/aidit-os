// ops-watcher/ruflo-lane-context.regression.test.mjs
// Regression coverage for the lane prelude: what a lane is allowed to do, and
// how long it has to do it.
//
//   node ops-watcher/ruflo-lane-context.regression.test.mjs
//
// Two failures this suite exists to keep out.
//
// 1. A PRELUDE NOBODY APPLIES. The HATTA entry was written on 2026-09-06 and
//    verified as "narrows HATTA's authority" — but withRufloLanePrelude was
//    only ever called from sjahrir-dispatch and review-runner, so HATTA never
//    received a word of it and CORLEONE had no entry at all. This repository
//    has shipped that shape before (config/skill-matrix.json was read by the
//    cockpit and by nothing else for weeks). Config that no code path reaches
//    is documentation wearing a config's clothes.
//
// 2. A BUDGET NOBODY STATES. Of 77 recorded lane runs, 43% of wall-clock was
//    wasted and 16% ended in a timeout, and the ten longest runs all ended at
//    exactly 480.0 seconds — the spawn timeout to the millisecond. Every lane
//    planned as if time were unbounded because nothing ever told it otherwise.
//
// Nothing here spawns a lane or touches the network.

import assert from "node:assert/strict";
import {
  buildLaneBudgetLines,
  buildRufloLanePrelude,
  withRufloLanePrelude,
  mergeRufloLaneEnv,
  rufloLaneEnv,
  RUFLO_LANE_ENV,
} from "./ruflo-lane-context.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(String(e && e.stack ? e.stack : e).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(n); failed++;
};
function t(name, fn) {
  try { fn(); ok(name); } catch (err) { bad(name, err); }
}

// ---- R1: every dispatched lane has its own entry, not the generic fallback ----
// The generic text is a safety net for an unknown lane name, never the thing a
// real lane should be receiving.
t("R1 every lane this system dispatches has a prelude of its own", () => {
  const generic = buildRufloLanePrelude("a-lane-that-does-not-exist");
  for (const lane of ["hatta", "sjahrir", "gibran", "corleone", "soekarno"]) {
    const prelude = buildRufloLanePrelude(lane);
    assert.notEqual(prelude, generic, `${lane} falls through to the generic prelude`);
    assert.match(prelude, /^\[RUFLO LANE CONTEXT\]\n/, `${lane} prelude is not delimited`);
    assert.match(prelude, /\[\/RUFLO LANE CONTEXT\]$/, `${lane} prelude is not closed`);
  }
});

// ---- R2: preludes narrow authority, they never widen it ----
t("R2 every prelude forbids daemons, installs and wider tool access", () => {
  for (const lane of ["hatta", "sjahrir", "gibran", "corleone", "soekarno"]) {
    const prelude = buildRufloLanePrelude(lane).toLowerCase();
    assert.match(prelude, /(do not|never)[^.]*daemons/,
      `${lane} prelude does not forbid starting daemons`);
  }
  assert.match(buildRufloLanePrelude("gibran"), /review-only/i, "GIBRAN must be told it is review-only");
  assert.match(buildRufloLanePrelude("soekarno"), /read-only/i, "SOEKARNO must be told it is read-only");
  assert.match(buildRufloLanePrelude("hatta"), /no native MCP client/i, "HATTA must be told it has no native MCP");
});

// ---- R3: a stated budget reaches the lane, in seconds ----
t("R3 a budget is stated in seconds, with a point at which to stop exploring", () => {
  const lines = buildLaneBudgetLines(480000);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /480 seconds/, "the wall is stated in seconds");
  assert.match(lines[2], /240 seconds/, "half the budget is stated, not left to arithmetic");
  const prelude = buildRufloLanePrelude("corleone", { budgetMs: 480000 });
  assert.match(prelude, /480 seconds/);
  // The restraint lines must survive the addition of the budget lines.
  assert.match(prelude, /do not start daemons/i);
});

// ---- R4: an unknown budget produces silence, never an invented number ----
// A lane told it has ten minutes when it has eight plans past the wall with
// more confidence than one told nothing at all.
t("R4 an unknown or nonsensical budget adds no lines at all", () => {
  for (const value of [undefined, null, 0, -1, Number.NaN, "soon", {}]) {
    assert.deepEqual(buildLaneBudgetLines(value), [], `budget ${String(value)} invented a number`);
  }
  const prelude = buildRufloLanePrelude("hatta");
  assert.ok(!/seconds/.test(prelude), "a prelude with no budget must not mention seconds");
});

// ---- R5: withRufloLanePrelude prepends once, and never twice ----
t("R5 the prelude is prepended once and is idempotent", () => {
  const once = withRufloLanePrelude("hatta", "do the thing", { budgetMs: 450000 });
  assert.match(once, /^\[RUFLO LANE CONTEXT\]/);
  assert.ok(once.endsWith("do the thing"), "the packet body must survive intact");
  assert.match(once, /450 seconds/);
  const twice = withRufloLanePrelude("hatta", once, { budgetMs: 450000 });
  assert.equal(twice, once, "a second wrap must be a no-op");
  assert.equal((twice.match(/\[RUFLO LANE CONTEXT\]/g) || []).length, 1);
});

// ---- R6: a null or non-string prompt does not crash a dispatch ----
t("R6 a missing prompt yields a prelude, not a throw", () => {
  for (const value of [undefined, null, 0]) {
    const out = withRufloLanePrelude("sjahrir", value);
    assert.match(out, /^\[RUFLO LANE CONTEXT\]/);
  }
});

// ---- R7: env merge never overrides what the caller already set ----
t("R7 lane env fills gaps and overrides nothing", () => {
  const merged = mergeRufloLaneEnv({ CLAUDE_FLOW_MCP_TOOLS: "memory", PATH: "/x" });
  assert.equal(merged.CLAUDE_FLOW_MCP_TOOLS, "memory", "an explicit value was overwritten");
  assert.equal(merged.PATH, "/x");
  assert.equal(merged.CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS, "1");
  // The exported table is frozen, so a caller cannot mutate every future lane.
  assert.throws(() => { RUFLO_LANE_ENV.CLAUDE_FLOW_MCP_TOOLS = "everything"; });
  const copy = rufloLaneEnv();
  copy.CLAUDE_FLOW_MCP_TOOLS = "everything";
  assert.equal(RUFLO_LANE_ENV.CLAUDE_FLOW_MCP_TOOLS, "memory,hooks,swarm,agent");
});

console.log("");
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
process.exit(0);
