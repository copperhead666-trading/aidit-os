// Regression tests for ops-watcher/canary-step.mjs. Fully offline: no file IO,
// no dependencies. These assertions are what a self-repair drill relies on to
// detect an injected logic fault, so they are kept exact.
//
//   node ops-watcher/canary-step.regression.test.mjs

import assert from "node:assert/strict";
import { canaryAdd, canaryLabel } from "./canary-step.mjs";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

// =====================================================================
// C1: canaryAdd exact arithmetic
// =====================================================================
async function testCanaryAddTwoPlusTwo() {
  const name = "C1 canaryAdd(2,2) === 4";
  try {
    assert.equal(canaryAdd(2, 2), 4);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// C2: canaryAdd sign handling
// =====================================================================
async function testCanaryAddNegativeOnePlusOne() {
  const name = "C2 canaryAdd(-1,1) === 0";
  try {
    assert.equal(canaryAdd(-1, 1), 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// C3: canaryLabel contains the step name
// =====================================================================
async function testCanaryLabelContainsStepName() {
  const name = "C3 canaryLabel() contains 'canary-step'";
  try {
    const label = canaryLabel();
    assert.equal(typeof label, "string");
    assert.ok(label.includes("canary-step"), `expected '${label}' to include 'canary-step'`);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher canary-step regression tests");
  await testCanaryAddTwoPlusTwo();
  await testCanaryAddNegativeOnePlusOne();
  await testCanaryLabelContainsStepName();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("canary-step regression runner crashed:", err); process.exit(1); });