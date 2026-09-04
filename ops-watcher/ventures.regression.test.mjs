// ops-watcher/ventures.regression.test.mjs
// Offline regression coverage for the venture registry reader. NO cockpit,
// NO directory inference, NO real writes: module reads are served by injected fs.
// Run with:
//   node ops-watcher/ventures.regression.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activeVentures,
  hardStopsFor,
  hasStatedMetric,
  ownerDecisionRequiredFor,
  readVentures,
  ventureById,
  ventureForPath,
} from "./ventures.mjs";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REAL_VENTURES_FILE = path.join(ROOT, "config", "ventures.json");
const MEM_FILE = "mem:/config/ventures.json";

function fakeFs(over = {}) {
  const files = new Map(Object.entries(over.files || {}));
  const fail = over.fail || {};
  const calls = [];
  return {
    calls,
    async readFile(file, encoding) {
      calls.push({ op: "readFile", file, encoding });
      if (fail.readFile) throw fail.readFile;
      if (!files.has(file)) throw new Error(`ENOENT: ${file}`);
      return files.get(file);
    },
  };
}

function depsFor(raw, over = {}) {
  return {
    _fs: fakeFs({ files: { [MEM_FILE]: raw }, ...(over.fs || {}) }),
    file: MEM_FILE,
    ...over.deps,
  };
}

async function realDeps() {
  const raw = await fs.readFile(REAL_VENTURES_FILE, "utf8");
  return depsFor(raw);
}

function registry(ventures) {
  return JSON.stringify({ schema_version: "test", ventures });
}

// The owner stated both metrics on 2026-09-04 (KOL-78), so this case was
// UPDATED, not deleted: it still guards the same rule, which was never "metrik
// must be null" but "metrik must never hold a number an agent invented". Now
// that the owner has spoken, the honest assertion is that each venture carries
// the metric HE stated, with the source he pointed at. Deleting the case would
// have removed the only check that a future agent cannot quietly rewrite these.
const OWNER_STATED_METRICS = {
  "sjs-superapps": {
    metrik: "Checked items in control/tasks/feature-backlog.md, out of 136",
    sumber: "control/tasks/feature-backlog.md",
  },
  "caveman-trading-os": {
    metrik: "Phase-1 workstreams meeting their Definition of Done, out of 9",
    sumber: "docs/planning/phase-1-workstreams.md",
  },
};

async function t1_realRegistryHasTwoActiveVenturesWithOwnerStatedMetrics() {
  const deps = await realDeps();
  const ventures = await readVentures(deps);
  const active = await activeVentures(deps);

  assert.equal(ventures.length, 2, "T1: real registry has exactly two ventures");
  assert.equal(active.length, 2, "T1: both real ventures are active");
  for (const venture of ventures) {
    const expected = OWNER_STATED_METRICS[venture.id];
    assert.ok(expected, `T1: ${venture.id} is a venture this case knows the owner-stated metric for`);
    assert.equal(venture.metrik, expected.metrik, `T1: ${venture.id} carries the metric the owner stated, word for word`);
    assert.equal(hasStatedMetric(venture), true, `T1: ${venture.id} now counts as having a stated metric`);
    // The marker the registry carried while the metric was unstated must be gone.
    // Leaving it behind would let the cockpit and the planner disagree about
    // whether the owner has answered.
    assert.ok(
      !String(venture.metrik_status || "").includes("BELUM DINYATAKAN PEMILIK"),
      `T1: ${venture.id} no longer carries the BELUM DINYATAKAN PEMILIK marker`,
    );
    // A metric without the file it is counted from is a number with no way to
    // check it — the same failure mode tujuan_sumber exists to prevent.
    assert.ok(
      String(venture.metrik_sumber || "").includes(expected.sumber),
      `T1: ${venture.id} metric names the file it is counted from`,
    );
  }
  ok("T1: real registry has two active ventures, both carrying the owner-stated metric and its source");
}

async function t2_realRegistryGoalsAlwaysCarrySources() {
  const ventures = await readVentures(await realDeps());
  for (const venture of ventures) {
    assert.ok(String(venture.tujuan || "").trim(), `T2: ${venture.id} has a non-empty tujuan`);
    assert.ok(String(venture.tujuan_sumber || "").trim(), `T2: ${venture.id} has a non-empty tujuan_sumber`);
  }
  ok("T2: every real venture goal carries its source");
}

async function t3_badRegistryInputsDegradeToEmptyArrays() {
  const cases = [
    ["missing file", { _fs: fakeFs(), file: MEM_FILE }],
    ["unreadable file", { _fs: fakeFs({ files: { [MEM_FILE]: registry([]) }, fail: { readFile: new Error("EACCES") } }), file: MEM_FILE }],
    ["malformed JSON", depsFor("{nope")],
    ["top-level array", depsFor("[]")],
  ];
  for (const [label, deps] of cases) {
    assert.deepEqual(await readVentures(deps), [], `T3: ${label} yields []`);
  }
  ok("T3: missing, unreadable, malformed, and non-object registries degrade to []");
}

async function t4_inactiveVenturesAreExcludedButStillAddressable() {
  const ventures = [
    { id: "live", status: "active", repoPath: "ventures/live" },
    { id: "paused-one", status: "paused", repoPath: "ventures/paused-one" },
    { id: "dormant-one", status: "dormant", repoPath: "ventures/dormant-one" },
  ];
  const deps = depsFor(registry(ventures));

  assert.deepEqual((await activeVentures(deps)).map((v) => v.id), ["live"], "T4: only active ventures are active");
  assert.equal((await ventureById("paused-one", deps))?.status, "paused", "T4: paused venture is still found by id");
  assert.equal((await ventureById("dormant-one", deps))?.status, "dormant", "T4: dormant venture is still found by id");
  ok("T4: paused and dormant ventures are excluded from activeVentures but still findable");
}

async function t5_ventureForPathMatchesOnlyOnDirectoryBoundary() {
  const deps = await realDeps();
  const caveman = await ventureForPath("ventures/caveman-trading-os/src/x.mjs", deps);
  const unrelated = await ventureForPath("knowledge/caveman-trading-os/src/x.mjs", deps);
  const partial = await ventureForPath("ventures/caveman-trading-os-old/x", deps);

  assert.equal(caveman?.id, "caveman-trading-os", "T5: caveman repo path maps to caveman venture");
  assert.equal(unrelated, null, "T5: unrelated path maps to null");
  assert.equal(partial, null, "T5: partial directory-name prefix does not match");
  ok("T5: ventureForPath maps by repoPath with a real directory boundary");
}

async function t6_unknownConstraintLookupsReturnEmptyArrays() {
  const deps = await realDeps();
  assert.deepEqual(await hardStopsFor("unknown-venture", deps), [], "T6: unknown hard stops are []");
  assert.deepEqual(await ownerDecisionRequiredFor("unknown-venture", deps), [], "T6: unknown owner decisions are []");
  ok("T6: unknown constraint lookups return [], never null or undefined");
}

async function t7_hasStatedMetricOnlyTrustsNonBlankMetrik() {
  for (const metrik of [null, undefined, "", "   "]) {
    assert.equal(hasStatedMetric({ metrik }), false, `T7: ${String(metrik)} is not a stated metric`);
  }
  assert.equal(hasStatedMetric({ metrik: "Monthly qualified owner decisions" }), true, "T7: a real metric string is stated");
  assert.equal(hasStatedMetric({ metrik: null, metrik_status: "BELUM DINYATAKAN PEMILIK" }), false, "T7: metrik_status text is not a fallback metric");
  ok("T7: hasStatedMetric is false for empty values and true for a real string");
}

async function main() {
  const tests = [
    t1_realRegistryHasTwoActiveVenturesWithOwnerStatedMetrics,
    t2_realRegistryGoalsAlwaysCarrySources,
    t3_badRegistryInputsDegradeToEmptyArrays,
    t4_inactiveVenturesAreExcludedButStillAddressable,
    t5_ventureForPathMatchesOnlyOnDirectoryBoundary,
    t6_unknownConstraintLookupsReturnEmptyArrays,
    t7_hasStatedMetricOnlyTrustsNonBlankMetrik,
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
