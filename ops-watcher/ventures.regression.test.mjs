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

async function t1_realRegistryHasTwoActiveVenturesWithUnstatedMetrics() {
  const deps = await realDeps();
  const ventures = await readVentures(deps);
  const active = await activeVentures(deps);

  assert.equal(ventures.length, 2, "T1: real registry has exactly two ventures");
  assert.equal(active.length, 2, "T1: both real ventures are active");
  for (const venture of ventures) {
    assert.equal(venture.metrik, null, `T1: ${venture.id} keeps metrik null until the owner states one`);
    assert.equal(hasStatedMetric(venture), false, `T1: ${venture.id} null metrik is not a stated metric`);
  }
  ok("T1: real registry has two active ventures and both keep metrics unstated");
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
    t1_realRegistryHasTwoActiveVenturesWithUnstatedMetrics,
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
