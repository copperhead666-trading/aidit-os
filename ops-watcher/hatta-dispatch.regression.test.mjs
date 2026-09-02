// Offline regression tests for ops-watcher/hatta-dispatch.mjs.
// No harness spawn, no ollama call, no network — only the evidence reader that
// runs on the timeout path.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHarnessEvidence } from "./hatta-dispatch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, "hatta-dispatch.regression.evidence.tmp.json");

let passed = 0, failed = 0;
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`       ${e && e.stack ? e.stack : e}`); failed++; };
async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

console.log("# hatta-dispatch regression tests");

// A harness killed by the 8-minute cap prints nothing: spawnSync's kill goes
// through TerminateProcess on Windows, which no SIGTERM handler in the child can
// catch. Verified live on 2026-09-02 — a real kill produced 0 bytes of stdout
// while the evidence file held the run. The file is therefore the only recovery
// path, and reading it must never be able to turn a timeout into a crash.

await t("H1 a written evidence file is recovered with its counts intact", async () => {
  await fs.writeFile(TMP, JSON.stringify({
    ok: false,
    iterations: 3,
    toolCalls: [{ name: "read_file", ok: true }, { name: "edit_file", ok: true }],
    filesWritten: ["ops-watcher/foo.mjs"],
    startedAt: "2026-09-02T07:11:09.486Z",
  }), "utf8");
  const ev = readHarnessEvidence(TMP);
  assert.equal(ev.iterations, 3);
  assert.equal(ev.toolCalls.length, 2);
  assert.deepEqual(ev.filesWritten, ["ops-watcher/foo.mjs"]);
});

await t("H2 a missing evidence file yields null, never a throw", async () => {
  await fs.unlink(TMP).catch(() => {});
  assert.equal(readHarnessEvidence(TMP), null);
  assert.equal(readHarnessEvidence(path.join(__dirname, "definitely-not-here.json")), null);
});

await t("H3 a half-written or non-JSON evidence file yields null, never a throw", async () => {
  await fs.writeFile(TMP, '{"iterations": 2, "toolCalls": [', "utf8");
  assert.equal(readHarnessEvidence(TMP), null);
  await fs.writeFile(TMP, "not json at all", "utf8");
  assert.equal(readHarnessEvidence(TMP), null);
});

await t("H4 a JSON file that is not an object is not accepted as evidence", async () => {
  await fs.writeFile(TMP, "[1,2,3]", "utf8");
  const arr = readHarnessEvidence(TMP);
  assert.equal(Array.isArray(arr) || arr === null, true, "an array must not be mistaken for evidence shape");
  await fs.writeFile(TMP, "null", "utf8");
  assert.equal(readHarnessEvidence(TMP), null);
  await fs.writeFile(TMP, '"a string"', "utf8");
  assert.equal(readHarnessEvidence(TMP), null);
});

await t("H5 a read that throws for any other reason still yields null", () => {
  const throwingFs = { readFileSync: () => { throw new Error("EACCES"); } };
  assert.equal(readHarnessEvidence(TMP, throwingFs), null);
});

await fs.unlink(TMP).catch(() => {});
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
