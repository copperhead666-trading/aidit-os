// ops-watcher/gbrain-curator.regression.test.mjs
// Offline regression coverage for the local G-Brain curator.

import assert from "node:assert/strict";
import path from "node:path";
import { runGbrainCuratorOnce, BACKOFF_MS } from "./gbrain-curator.mjs";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed += 1; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name);
  failed += 1;
}

function makeErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function makeDeps(overrides = {}) {
  return {
    noteFiles: ["knowledge/store/notes/a.md", "knowledge/store/notes/b.md"],
    statFile: async (file) => {
      if (file.endsWith("a.md")) return { mtimeMs: 1000 };
      if (file.endsWith("b.md")) return { mtimeMs: 2000 };
      throw makeErr("ENOENT", file);
    },
    buildIndex: async () => ({ files: 2, chunks: 4, embedded: 4, reused: 0 }),
    stateFile: "/state.json",
    readState: async () => ({ ok: true, value: {} }),
    writeState: async () => ({ ok: true }),
    log: () => {},
    now: () => 1700000000000,
    ...overrides,
  };
}

async function testStaleNotesBuildIndexAndPersistMtimes() {
  const name = "stale notes -> local index build and mtime state persisted";
  const calls = [];
  let written = null;
  try {
    const result = await runGbrainCuratorOnce(makeDeps({
      buildIndex: async (opts) => {
        calls.push(opts);
        return { files: 2, chunks: 5, embedded: 5, reused: 0 };
      },
      writeState: async (file, obj) => {
        written = { file, obj };
        return { ok: true };
      },
    }));
    assert.equal(calls.length, 1, "buildIndex called once for the sweep");
    assert.equal(calls[0].noteFiles.length, 2, "full note set is handed to the indexer");
    assert.equal(result.results.filter((r) => r.outcome === "indexed").length, 2, "both stale notes marked indexed");
    assert.ok(written, "state persisted after indexing");
    assert.equal(written.obj.noteMtimes["knowledge/store/notes/a.md"], 1000);
    assert.equal(written.obj.noteMtimes["knowledge/store/notes/b.md"], 2000);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testUpToDateSkipsIndexAndStateWrite() {
  const name = "up-to-date notes -> no index build and no state write";
  let buildCalled = false;
  let writeCalled = false;
  try {
    const result = await runGbrainCuratorOnce(makeDeps({
      readState: async () => ({
        ok: true,
        value: {
          noteMtimes: {
            "knowledge/store/notes/a.md": 1000,
            "knowledge/store/notes/b.md": 2000,
          },
        },
      }),
      buildIndex: async () => {
        buildCalled = true;
        return { files: 2, chunks: 4, embedded: 0, reused: 4 };
      },
      writeState: async () => {
        writeCalled = true;
        return { ok: true };
      },
    }));
    assert.equal(buildCalled, false, "freshness gate skipped buildIndex");
    assert.equal(writeCalled, false, "clean no-op sweep does not rewrite state");
    assert.equal(result.results.filter((r) => r.outcome === "up-to-date").length, 2);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testBuildFailureIsBestEffortAndBackoffable() {
  const name = "index build failure -> failed results and backoff state";
  let written = null;
  try {
    const result = await runGbrainCuratorOnce(makeDeps({
      buildIndex: async () => { throw new Error("embedder down"); },
      writeState: async (_file, obj) => {
        written = obj;
        return { ok: true };
      },
    }));
    assert.equal(result.results.filter((r) => r.outcome === "failed").length, 2, "all stale notes reported failed");
    assert.equal(written.__indexFailure.count, 1, "failure count starts at 1");
    assert.match(result.results[0].reason, /embedder down/);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testActiveBackoffSkipsBuild() {
  const name = "active failure backoff -> skipped-backoff and no build";
  let buildCalled = false;
  try {
    const signature = [
      "knowledge/store/notes/a.md:1000",
      "knowledge/store/notes/b.md:2000",
    ].sort().join("|");
    const result = await runGbrainCuratorOnce(makeDeps({
      readState: async () => ({
        ok: true,
        value: {
          __indexFailure: {
            count: 3,
            lastAttemptMs: 1700000000000 - 1000,
            signature,
          },
        },
      }),
      buildIndex: async () => {
        buildCalled = true;
        return { files: 2, chunks: 4, embedded: 4, reused: 0 };
      },
    }));
    assert.equal(buildCalled, false, "active backoff suppresses build");
    assert.equal(result.results.filter((r) => r.outcome === "skipped-backoff").length, 2);
    assert.ok(BACKOFF_MS > 0, "backoff duration exported");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testMissingNoteDoesNotAbortRemainingNotes() {
  const name = "missing note -> skipped-missing and remaining notes still index";
  try {
    const result = await runGbrainCuratorOnce(makeDeps({
      noteFiles: ["knowledge/store/notes/a.md", "knowledge/store/notes/missing.md"],
      statFile: async (file) => {
        if (file.endsWith("missing.md")) throw makeErr("ENOENT", "missing");
        return { mtimeMs: 1000 };
      },
      buildIndex: async (opts) => {
        assert.equal(opts.noteFiles.length, 1, "missing note excluded from index input");
        assert.equal(path.basename(opts.noteFiles[0]), "a.md");
        return { files: 1, chunks: 2, embedded: 2, reused: 0 };
      },
    }));
    assert.equal(result.results.some((r) => r.outcome === "skipped-missing"), true);
    assert.equal(result.results.some((r) => r.outcome === "indexed"), true);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher gbrain-curator regression tests");
  await testStaleNotesBuildIndexAndPersistMtimes();
  await testUpToDateSkipsIndexAndStateWrite();
  await testBuildFailureIsBestEffortAndBackoffable();
  await testActiveBackoffSkipsBuild();
  await testMissingNoteDoesNotAbortRemainingNotes();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("gbrain-curator regression runner crashed:", err);
  process.exit(1);
});
