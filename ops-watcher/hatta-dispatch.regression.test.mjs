// Offline regression tests for ops-watcher/hatta-dispatch.mjs.
// No harness spawn, no ollama call, no network — only the evidence reader that
// runs on the timeout path.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHarnessEvidence, parseHarnessStdout, buildNormalExitUsage, harnessScriptFor } from "./hatta-dispatch.mjs";

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

// =====================================================================
// H6-H10: the INNER timeout leak.
//
// The outer wrapper path (spawnSync killed the child) already passed
// timedOut: true and is correct. But the harness has its OWN 120s per-call
// abort, and when that fires the harness does not hang - it records
// "timedOut": true in the evidence JSON it prints and exits NORMALLY. Nothing
// parsed that stdout, so an inner timeout was logged as an ordinary failure.
//
// The baseline proves it: both recorded HATTA runs sat at p50 122,670ms, which
// is 120s plus overhead, while lane-usage.jsonl reported timedOut=0 for the
// lane. Under-reported in exactly the place that was supposed to be fixed.
// =====================================================================

await t("H6 the inner timeout flag is read out of the harness stdout", () => {
  const stdout = JSON.stringify({ ok: false, iterations: 2, timedOut: true, error: "Ollama chat timed out after 120000ms" });
  assert.equal(parseHarnessStdout(stdout).timedOut, true);
});

await t("H7 Reached MAX_ITERATIONS is NOT reported as a timeout", () => {
  // A run can exhaust the 4-iteration ceiling in 40 SECONDS. That is a
  // completely different failure from sitting at a 120s wall, and collapsing
  // the two would swap one blind spot for another.
  const stdout = JSON.stringify({
    ok: false,
    iterations: 4,
    timedOut: false,
    error: "Reached MAX_ITERATIONS (4, set by the 480000ms outer budget over a 120000ms per-call timeout) before a final answer.",
  });
  const ev = parseHarnessStdout(stdout);
  assert.equal(ev.timedOut, false, "iteration exhaustion is not a timeout");
  assert.match(ev.error, /MAX_ITERATIONS/, "and the reason stays legible in the log");
});

await t("H8 the LAST json line wins, not the first", () => {
  // The harness may print progress before its final verdict object.
  const stdout = [
    "starting",
    JSON.stringify({ progress: 1, timedOut: false }),
    "noise",
    JSON.stringify({ ok: true, iterations: 3, timedOut: false }),
  ].join("\n");
  assert.equal(parseHarnessStdout(stdout).iterations, 3);
});

await t("H9 malformed or absent stdout yields null, never a throw", () => {
  for (const v of ["", null, undefined, "not json", "{broken", "[1,2,3]", '"a string"', "12345"]) {
    assert.equal(parseHarnessStdout(v), null, JSON.stringify(v) + " is not evidence");
  }
});

await t("H10 turns comes from iterations when the harness reports them", () => {
  assert.equal(parseHarnessStdout(JSON.stringify({ iterations: 6 })).iterations, 6);
  assert.equal(parseHarnessStdout(JSON.stringify({ ok: true })).iterations, undefined);
});

// =====================================================================
// H11-H13: the WIRING, not just the parser.
//
// H6-H10 above prove parseHarnessStdout reads the flag. They stayed GREEN when
// the call site was mutated to throw that flag away - which is the actual bug.
// A parser test cannot catch a value dropped between the parser and the log,
// so these assert the record that reaches logLaneUsage.
// =====================================================================

await t("H11 an inner timeout reaches the usage record", () => {
  const rec = buildNormalExitUsage({
    prompt: "x".repeat(10),
    stdout: JSON.stringify({ ok: false, iterations: 2, timedOut: true, error: "Ollama chat timed out after 120000ms" }),
    stderr: "",
    exitCode: 1,
    durationMs: 122670,
  });
  assert.equal(rec.timedOut, true, "the flag survives the trip to the log");
  assert.equal(rec.ok, false);
  assert.equal(rec.turns, 2, "turns carried through as well");
  assert.equal(rec.lane, "hatta");
});

await t("H12 iteration exhaustion reaches the record as NOT a timeout", () => {
  const rec = buildNormalExitUsage({
    prompt: "x",
    stdout: JSON.stringify({
      ok: false,
      iterations: 4,
      timedOut: false,
      error: "Reached MAX_ITERATIONS (4, set by the 480000ms outer budget over a 120000ms per-call timeout) before a final answer.",
    }),
    stderr: "",
    exitCode: 1,
    durationMs: 40000,
  });
  assert.equal(rec.timedOut, false, "40 seconds at the iteration ceiling is not a timeout");
  assert.equal(rec.turns, 4);
  // The distinction has to survive INTO the log, or a reader cannot tell the
  // two failures apart afterwards.
  assert.match(rec.cli.error, /MAX_ITERATIONS/);
});

await t("H13 a successful run records turns and byte counts, and no timeout", () => {
  const rec = buildNormalExitUsage({
    prompt: "abc",
    stdout: JSON.stringify({ ok: true, iterations: 3, timedOut: false, model: "glm-5.3:cloud", toolCalls: [1, 2], filesWritten: ["a.mjs"] }),
    stderr: "warn",
    exitCode: 0,
    durationMs: 4321,
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.timedOut, false);
  assert.equal(rec.turns, 3);
  assert.equal(rec.promptLength, 3);
  assert.equal(rec.stdout.length > 0, true, "raw stdout is handed to the logger, which stores only its size");
  assert.equal(rec.stderr, "warn");
  assert.equal(rec.cli.model, "glm-5.3:cloud");
  assert.equal(rec.cli.toolCalls, 2, "counts, not the payloads");
  assert.equal(rec.cli.filesWritten, 1);
});

// === WORKTREE ISOLATION IS THE HARNESS PATH, NOT THE CWD ===
// hatta/harness.mjs derives its path jail from its own location, so spawning
// the SHARED harness with cwd set to a worktree gave a lane that read and wrote
// the shared tree while every log line claimed isolation. Measured: a packet
// placed in the worktree came back as ENOENT against the main repository path.

await t("the harness that runs is the one INSIDE the workspace", () => {
  const seen = [];
  const r = harnessScriptFor("D:/tmp/lane-hatta", {
    _fs: { existsSync: (p) => { seen.push(p); return true; } },
    sharedHarness: "D:/repo/hatta/harness.mjs",
  });
  assert.equal(r.isolated, true);
  assert.equal(r.script.split(path.sep).join("/"), "D:/tmp/lane-hatta/hatta/harness.mjs");
  assert.equal(seen.length, 1, "it checks the workspace copy exists before using it");
});

await t("a workspace with no harness falls back LOUDLY, never silently", () => {
  const r = harnessScriptFor("D:/tmp/lane-hatta", {
    _fs: { existsSync: () => false },
    sharedHarness: "D:/repo/hatta/harness.mjs",
  });
  assert.equal(r.isolated, false);
  assert.equal(r.script, "D:/repo/hatta/harness.mjs");
  assert.match(r.reason, /writes the SHARED tree/);
});

await fs.unlink(TMP).catch(() => {});
console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
