// ops-watcher/lane-usage.regression.test.mjs
// Regression tests for ops-watcher/lane-usage.mjs — the best-effort usage/budget
// tracking helper. All tests inject a temp file path (DI seam) so the real
// lane-usage.jsonl is never touched. No network, no real dispatch, no external
// deps. Uses node:assert/strict only.
//
//   node ops-watcher/lane-usage.regression.test.mjs
//
// Covers:
//   (U1) logLaneUsage appends a valid JSON line to a temp file.
//   (U2) Multiple calls append multiple lines (NDJSON, not overwriting).
//   (U3) A write failure (unwritable/invalid path) does not throw — the function
//        resolves normally even on failure.
//   (U4) Malformed existing content in the target file doesn't matter — the
//        function only appends, never reads.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logLaneUsage } from "./lane-usage.mjs";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

async function makeTempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lane-usage-test-"));
  return path.join(dir, "test-usage.jsonl");
}

// =====================================================================
// U1: logLaneUsage appends a valid JSON line to a temp file
// =====================================================================
async function testAppendsValidJsonLine() {
  const name = "U1 logLaneUsage appends a valid JSON line to a temp file";
  const file = await makeTempFile();
  try {
    await logLaneUsage({ lane: "sjahrir", promptLength: 42, ok: true, exitCode: 0, durationMs: 150, file });
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 1, "exactly one line appended");
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.lane, "sjahrir");
    assert.equal(obj.promptLength, 42);
    assert.equal(obj.ok, true);
    assert.equal(obj.exitCode, 0);
    assert.equal(obj.durationMs, 150);
    assert.ok(typeof obj.ts === "string" && obj.ts.length > 0, "ts is a non-empty ISO string");
    // ts should be a valid ISO-8601 timestamp
    const parsed = Date.parse(obj.ts);
    assert.ok(Number.isFinite(parsed), "ts parses as a valid date");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// U2: Multiple calls append multiple lines (NDJSON, not overwriting)
// =====================================================================
async function testMultipleCallsAppend() {
  const name = "U2 multiple calls append multiple lines (NDJSON, not overwriting)";
  const file = await makeTempFile();
  try {
    await logLaneUsage({ lane: "corleone", promptLength: 10, ok: true, exitCode: 0, durationMs: 50, file });
    await logLaneUsage({ lane: "corleone", promptLength: 20, ok: false, exitCode: 1, durationMs: 75, file });
    await logLaneUsage({ lane: "hatta-flash", promptLength: 5, ok: true, exitCode: 0, durationMs: 30, file });
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 3, "three lines appended (not overwritten)");
    const objs = lines.map((l) => JSON.parse(l));
    assert.equal(objs[0].lane, "corleone");
    assert.equal(objs[0].ok, true);
    assert.equal(objs[1].lane, "corleone");
    assert.equal(objs[1].ok, false);
    assert.equal(objs[2].lane, "hatta-flash");
    assert.equal(objs[2].ok, true);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// U3: A write failure (unwritable/invalid path) does not throw
// =====================================================================
async function testWriteFailureDoesNotThrow() {
  const name = "U3 write failure (invalid/unwritable path) does not throw";
  try {
    // Use a path inside a nonexistent directory with a bad name that can't be
    // created. On all platforms, writing to a path whose parent directory does
    // not exist fails with ENOENT.
    const badFile = path.join(os.tmpdir(), "lane-usage-test-nonexistent-dir-xyz", "sub", "usage.jsonl");
    // This must NOT throw — it should resolve cleanly (silent no-op).
    await logLaneUsage({ lane: "sjahrir", promptLength: 1, ok: false, exitCode: 1, durationMs: 5, file: badFile });
    // If we got here without throwing, the test passes.
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// U4: Malformed existing content in the target file doesn't matter
// (append-only; the function never reads the file, only appends)
// =====================================================================
async function testMalformedExistingContentIgnored() {
  const name = "U4 malformed existing content in target file doesn't matter (append-only)";
  const file = await makeTempFile();
  try {
    // Pre-write garbage lines into the file.
    await fs.writeFile(file, "this is not json\n{broken json\n\n", "utf8");
    // Append a valid entry — must succeed and NOT be affected by the garbage.
    await logLaneUsage({ lane: "hatta-flash", promptLength: 3, ok: true, exitCode: 0, durationMs: 12, file });
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n");
    // The last non-empty line should be our valid JSON entry.
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const last = nonEmpty[nonEmpty.length - 1];
    const obj = JSON.parse(last);
    assert.equal(obj.lane, "hatta-flash");
    assert.equal(obj.ok, true);
    assert.equal(obj.durationMs, 12);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// U5 (bonus): extra metadata is included when provided
// =====================================================================
async function testExtraMetadataIncluded() {
  const name = "U5 extra metadata is included in the record when provided";
  const file = await makeTempFile();
  try {
    await logLaneUsage({ lane: "sjahrir", promptLength: 1, ok: true, exitCode: 0, durationMs: 1, extra: { model: "flash" }, file });
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const obj = JSON.parse(lines[0]);
    assert.deepEqual(obj.extra, { model: "flash" });
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// U6 (bonus): null/undefined optional fields are stored as null, not omitted
// (except extra which is only present if provided)
// =====================================================================
async function testNullFieldsStored() {
  const name = "U6 null optional fields are stored as null in the record";
  const file = await makeTempFile();
  try {
    await logLaneUsage({ lane: "corleone", file });
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.lane, "corleone");
    assert.equal(obj.promptLength, null, "missing promptLength -> null");
    assert.equal(obj.ok, false, "missing ok -> false (ok === true check)");
    assert.equal(obj.exitCode, null, "missing exitCode -> null");
    assert.equal(obj.durationMs, null, "missing durationMs -> null");
    assert.ok(!("extra" in obj), "extra key absent when not provided");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher lane-usage regression tests");
  await testAppendsValidJsonLine();
  await testMultipleCallsAppend();
  await testWriteFailureDoesNotThrow();
  await testMalformedExistingContentIgnored();
  await testExtraMetadataIncluded();
  await testNullFieldsStored();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("lane-usage regression runner crashed:", err); process.exit(1); });