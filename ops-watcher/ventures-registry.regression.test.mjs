// ops-watcher/ventures-registry.regression.test.mjs
// Regression coverage for the validating venture-registry writer. Only T1 reads
// the real registry; all writes use an injected in-memory filesystem.
// Run with:
//   node ops-watcher/ventures-registry.regression.test.mjs

import assert from "node:assert/strict";

import {
  DEFAULT_VENTURES_FILE,
  readVenturesRegistry,
  validateVenture,
  writeVenturesRegistry,
} from "./ventures-registry.mjs";

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

const FILE = "mem:/config/ventures.json";

function enoent(p) {
  const err = new Error(`ENOENT: ${p}`);
  err.code = "ENOENT";
  return err;
}

function memfs(initial = {}) {
  const files = new Map(Object.entries(initial));
  const calls = [];
  return {
    files,
    calls,
    async mkdir() {},
    async readFile(p) {
      calls.push({ op: "readFile", file: p });
      if (!files.has(p)) throw enoent(p);
      return files.get(p);
    },
    async writeFile(p, data) {
      calls.push({ op: "writeFile", file: p, data: String(data) });
      files.set(p, String(data));
    },
    async rename(from, to) {
      calls.push({ op: "rename", from, to });
      if (!files.has(from)) throw enoent(from);
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

function registry(ventures, over = {}) {
  return JSON.stringify({
    schema_version: "test",
    purpose: "test registry",
    rules: ["tujuan quoted", "metric sourced", "hard stops sourced"],
    ventures,
    ...over,
  }, null, 2) + "\n";
}

function validVenture(over = {}) {
  return {
    id: "venture-a",
    status: "active",
    tujuan: "Quoted goal",
    tujuan_sumber: "README.md, line 1",
    metrik: null,
    hardStops: ["No live money (README.md)."],
    ...over,
  };
}

async function t1_realRegistryReadsBothVenturesWithoutError() {
  const result = await readVenturesRegistry({ file: DEFAULT_VENTURES_FILE });
  assert.equal(result.ok, true, `T1: real registry must read, got ${result.reason}`);
  assert.equal(result.ventures.length, 2, "T1: real registry returns both ventures");
  assert.deepEqual(result.ventures.map((v) => v.id).sort(), ["caveman-trading-os", "sjs-superapps"]);
  ok("T1: reading the real registry returns both ventures and no error");
}

async function t2_malformedJsonReturnsErrorResultAndDoesNotThrow() {
  const result = await readVenturesRegistry({ _fs: memfs({ [FILE]: "{ nope" }), file: FILE });
  assert.equal(result.ok, false);
  assert.deepEqual(result.ventures, []);
  assert.match(result.reason, /malformed JSON/);
  ok("T2: malformed JSON returns an error result and does not throw");
}

function t3_tujuanWithoutSourceFailsAndNamesRule() {
  const problems = validateVenture(validVenture({ tujuan: "Goal", tujuan_sumber: "" }));
  assert.ok(problems.some((problem) => /tujuan rule/.test(problem)), "T3: failure names the tujuan rule");
  ok("T3: tujuan with no tujuan_sumber fails validation and names the rule");
}

function t4_nullMetricPassesButNonEmptyMetricNeedsSource() {
  assert.deepEqual(validateVenture(validVenture({ metrik: null, metrik_sumber: undefined })), []);
  const problems = validateVenture(validVenture({ metrik: "Checked tasks", metrik_sumber: "" }));
  assert.ok(problems.some((problem) => /metrik rule/.test(problem)), "T4: non-empty metric needs source");
  ok("T4: metrik null passes; non-empty metrik without metrik_sumber fails");
}

function t5_lastMetricWithNullValueAndSourcePasses() {
  const problems = validateVenture(validVenture({
    metrik: "Done workstreams out of 9",
    metrik_sumber: "docs/planning/phase-1-workstreams.md",
    metrik_terakhir: {
      nilai: null,
      dari: 9,
      pada: "2026-09-07",
      sumber: "ventures/caveman-trading-os/docs/planning/phase-1-workstreams.md",
    },
  }));
  assert.deepEqual(problems, []);
  ok("T5: metrik_terakhir with nilai null and a source passes");
}

function t6_lastMetricWithNumberAndNoSourceFails() {
  const problems = validateVenture(validVenture({
    metrik_terakhir: { nilai: 22, dari: 136, pada: "2026-09-04", sumber: "" },
  }));
  assert.ok(problems.some((problem) => /metrik_terakhir\.sumber/.test(problem)));
  ok("T6: metrik_terakhir with a number and no sumber fails");
}

function t7_numericStringValueFailsWithoutCoercion() {
  const problems = validateVenture(validVenture({
    metrik_terakhir: { nilai: "22", dari: 136, pada: "2026-09-04", sumber: "owner statement" },
  }));
  assert.ok(problems.some((problem) => /numeric strings are not coerced/.test(problem)));
  ok("T7: nilai as a numeric string fails and is not coerced");
}

async function t8_failedWriteLeavesFileByteIdentical() {
  const before = registry([validVenture()]);
  const fs = memfs({ [FILE]: before });
  const result = await writeVenturesRegistry([validVenture({ tujuan: "Goal", tujuan_sumber: "" })], {
    _fs: fs,
    file: FILE,
    tmpSuffix: "t8",
  });
  assert.equal(result.ok, false);
  assert.equal(fs.files.get(FILE), before, "T8: content is byte-identical after rejected write");
  assert.equal(fs.calls.some((call) => call.op === "writeFile"), false, "T8: rejected write never writes a temp file");
  ok("T8: a validation-failed write leaves the file byte-identical");
}

async function t9_successfulWritePreservesUnrecognizedField() {
  const beforeVenture = validVenture({ hand_written_field: { keep: true } });
  const fs = memfs({ [FILE]: registry([beforeVenture], { surveyed_at: "2026-09-04" }) });
  const nextVenture = { ...beforeVenture, status: "paused" };
  const result = await writeVenturesRegistry([nextVenture], { _fs: fs, file: FILE, tmpSuffix: "t9" });
  assert.equal(result.ok, true, `T9: write must succeed, got ${result.reason}`);
  const after = JSON.parse(fs.files.get(FILE));
  assert.deepEqual(after.ventures[0].hand_written_field, { keep: true });
  assert.equal(after.schema_version, "test", "T9: schema_version is preserved");
  assert.equal(after.purpose, "test registry", "T9: purpose is preserved");
  assert.deepEqual(after.rules, ["tujuan quoted", "metric sourced", "hard stops sourced"], "T9: rules are preserved");
  assert.equal(after.surveyed_at, "2026-09-04", "T9: other top-level fields are preserved");
  assert.deepEqual(
    fs.calls.filter((call) => call.op === "writeFile" || call.op === "rename").map((call) => call.op),
    ["writeFile", "rename"],
    "T9: write is beside-and-rename",
  );
  ok("T9: successful write preserves an unrecognized venture field and top-level registry fields");
}

function t10_validationReturnsAllProblems() {
  const problems = validateVenture(validVenture({
    tujuan: "Goal",
    tujuan_sumber: "",
    metrik: "Checked tasks",
    metrik_sumber: "",
  }));
  assert.equal(problems.length, 2, "T10: two broken rules produce two problems");
  assert.ok(problems.some((problem) => /tujuan/.test(problem)));
  assert.ok(problems.some((problem) => /metrik/.test(problem)));
  ok("T10: validation returns a list with every problem, not just the first");
}

async function main() {
  const tests = [
    t1_realRegistryReadsBothVenturesWithoutError,
    t2_malformedJsonReturnsErrorResultAndDoesNotThrow,
    t3_tujuanWithoutSourceFailsAndNamesRule,
    t4_nullMetricPassesButNonEmptyMetricNeedsSource,
    t5_lastMetricWithNullValueAndSourcePasses,
    t6_lastMetricWithNumberAndNoSourceFails,
    t7_numericStringValueFailsWithoutCoercion,
    t8_failedWriteLeavesFileByteIdentical,
    t9_successfulWritePreservesUnrecognizedField,
    t10_validationReturnsAllProblems,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      bad(test.name, err);
    }
  }

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
