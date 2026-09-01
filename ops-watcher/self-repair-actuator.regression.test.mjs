// Regression tests for ops-watcher/self-repair-actuator.mjs (part 1).
// Fully offline: all file IO is injected through a fake fs, so no real file
// (including the .self-repair-backups directory) is ever created.
//
//   node ops-watcher/self-repair-actuator.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKUP_DIR,
  buildRepairPacket,
  snapshotFiles,
  restoreFiles,
} from "./self-repair-actuator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

// ---------------------------------------------------------------------
// Fake, injectable fs. A Map keyed by path holds file contents as Buffers.
// mkdir is a no-op that records the directory was requested.
// ---------------------------------------------------------------------
function makeFakeFs(seed = new Map()) {
  const store = new Map();
  for (const [k, v] of seed.entries()) {
    store.set(k, Buffer.isBuffer(v) ? v : Buffer.from(v));
  }
  const mkdirs = [];
  const reads = [];
  const writes = [];
  const api = {
    mkdir: async (p, opts) => { mkdirs.push(String(p)); return undefined; },
    readFile: async (p) => {
      const key = String(p);
      reads.push(key);
      if (!store.has(key)) {
        const err = new Error(`ENOENT: ${key}`);
        err.code = "ENOENT";
        throw err;
      }
      return Buffer.from(store.get(key));
    },
    writeFile: async (p, data) => {
      const key = String(p);
      writes.push(key);
      store.set(key, Buffer.isBuffer(data) ? data : Buffer.from(data));
      return undefined;
    },
  };
  return { api, mkdirs, reads, writes, store };
}

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

// =====================================================================
// A1: buildRepairPacket content, length, and determinism
// =====================================================================
async function testBuildRepairPacket() {
  const name = "A1 buildRepairPacket includes step name, files, command, hard stop, <600 words, deterministic";
  try {
    const fault = {
      name: "gbrain-curator",
      records: [
        { name: "gbrain-curator", excerpt: "ReferenceError: x is not defined" },
        { name: "gbrain-curator", excerpt: "ReferenceError: x is not defined" },
        { name: "gbrain-curator", excerpt: "TypeError: cannot read 'y' of undefined at ops-watcher/gbrain-curator.mjs:42:7" },
      ],
    };
    const scope = {
      stepName: "gbrain-curator",
      files: [
        path.join(__dirname, "gbrain-curator.mjs"),
        path.join(__dirname, "gbrain-curator.regression.test.mjs"),
      ],
      suite: path.join(__dirname, "gbrain-curator.regression.test.mjs"),
    };
    const evidence = [{ type: "fault", name: "gbrain-curator" }, { type: "fault", name: "gbrain-curator" }];

    const packet = buildRepairPacket(fault, scope, evidence);

    // step name present
    assert.ok(packet.includes("gbrain-curator"), "packet must name the failing step");

    // both repo-relative file paths present
    const rel1 = path.relative(REPO_ROOT, scope.files[0]).split(path.sep).join("/");
    const rel2 = path.relative(REPO_ROOT, scope.files[1]).split(path.sep).join("/");
    assert.ok(packet.includes(rel1), `packet must include repo-relative path ${rel1}`);
    assert.ok(packet.includes(rel2), `packet must include repo-relative path ${rel2}`);

    // exact run-all-tests --only command with suite basename
    const expectedCommand = "node ops-watcher/run-all-tests.mjs --only gbrain-curator.regression.test.mjs";
    assert.ok(packet.includes(expectedCommand), `packet must include exact command: ${expectedCommand}`);

    // newest excerpt present
    assert.ok(packet.includes("TypeError: cannot read 'y' of undefined"), "packet must include the newest error excerpt");

    // hard stop about not weakening assertions
    assert.ok(/do not weaken.*assertion/i.test(packet), "packet must forbid weakening assertions");

    // under 600 words
    assert.ok(wordCount(packet) < 600, `packet must be under 600 words (got ${wordCount(packet)})`);

    // deterministic across two calls with identical inputs
    const packet2 = buildRepairPacket(fault, scope, evidence);
    assert.equal(packet2, packet, "buildRepairPacket must be deterministic");

    // no machine-specific absolute prefix leaks into the packet
    assert.ok(!packet.includes(__dirname), "packet must not contain the absolute __dirname prefix");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// A2: snapshotFiles returns one entry per file with correct byte counts
// =====================================================================
async function testSnapshotFilesByteCounts() {
  const name = "A2 snapshotFiles returns one entry per file with right byte counts";
  try {
    const fileA = path.join(__dirname, "alpha.mjs");
    const fileB = path.join(__dirname, "beta.test.mjs");
    const contentA = "export const x = 1;\n";
    const contentB = "import assert from 'node:assert/strict';\n";
    const { api, writes } = makeFakeFs(new Map([
      [fileA, contentA],
      [fileB, contentB],
    ]));

    const files = [fileA, fileB];
    const snap = await snapshotFiles(files, {
      dir: BACKUP_DIR,
      now: () => 1700000000000,
      _fs: api,
    });

    assert.equal(snap.ok, true);
    assert.ok(snap.dir.endsWith(path.join("1700000000000")), `stamp dir should end with timestamp, got ${snap.dir}`);
    assert.equal(snap.entries.length, 2);
    assert.equal(snap.entries[0].file, fileA);
    assert.equal(snap.entries[0].bytes, Buffer.byteLength(contentA));
    assert.equal(snap.entries[1].file, fileB);
    assert.equal(snap.entries[1].bytes, Buffer.byteLength(contentB));
    // two backup writes happened
    assert.equal(writes.length, 2);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// A3: snapshotFiles on a failing read returns { ok: false } and never throws
// =====================================================================
async function testSnapshotFilesFailureNeverThrows() {
  const name = "A3 snapshotFiles with failing read returns ok:false and never throws";
  try {
    const missing = path.join(__dirname, "does-not-exist.mjs");
    const okFile = path.join(__dirname, "present.mjs");
    const { api } = makeFakeFs(new Map([
      [okFile, "here\n"],
    ]));

    // Calling directly inside this try block already proves "never throws":
    // any thrown rejection would be caught by the outer catch and fail the
    // test. We additionally record a sentinel to assert the call resolved
    // rather than rejected.
    let snap;
    let threw = false;
    try {
      snap = await snapshotFiles([okFile, missing], {
        dir: BACKUP_DIR,
        now: () => 1700000000001,
        _fs: api,
      });
    } catch (err) {
      threw = true;
      throw err;
    }
    assert.equal(threw, false, "snapshotFiles must not throw on a failing read");
    assert.ok(snap, "snapshotFiles must return a result object");
    assert.equal(snap.ok, false);
    assert.ok(snap.error, "a failed snapshot must carry an error");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// A4: restoreFiles writes every backup back to its original path with exact bytes
// =====================================================================
async function testRestoreFilesWritesExactBytes() {
  const name = "A4 restoreFiles writes every backup back to original path with exact bytes";
  try {
    const fileA = path.join(__dirname, "alpha.mjs");
    const fileB = path.join(__dirname, "beta.test.mjs");
    const contentA = "FIRST ORIGINAL CONTENT alpha\n";
    const contentB = "SECOND ORIGINAL CONTENT beta\n";
    const { api, store } = makeFakeFs(new Map([
      [fileA, contentA],
      [fileB, contentB],
    ]));

    const files = [fileA, fileB];
    const snap = await snapshotFiles(files, {
      dir: BACKUP_DIR,
      now: () => 1700000000002,
      _fs: api,
    });
    assert.equal(snap.ok, true);

    // Simulate a drill mutating the originals (corrupt them).
    await api.writeFile(fileA, Buffer.from("MUTATED alpha\n"));
    await api.writeFile(fileB, Buffer.from("MUTATED beta\n"));
    assert.equal(store.get(fileA).toString(), "MUTATED alpha\n");

    // Restore from snapshot.
    const res = await restoreFiles(snap, { _fs: api });
    assert.equal(res.ok, true);
    assert.equal(res.restored, 2);

    // Exact original bytes must now be back over the originals.
    assert.equal(store.get(fileA).toString(), contentA);
    assert.equal(store.get(fileB).toString(), contentB);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// A5: restoreFiles on a failed snapshot restores nothing
// =====================================================================
async function testRestoreFilesFailedSnapshotRestoresNothing() {
  const name = "A5 restoreFiles on a failed snapshot restores nothing";
  try {
    const fileA = path.join(__dirname, "alpha.mjs");
    const { api, writes, reads } = makeFakeFs(new Map([[fileA, "original\n"]]));

    const failedSnap = { ok: false, error: new Error("read failed") };
    const res = await restoreFiles(failedSnap, { _fs: api });
    assert.equal(res.ok, false);
    assert.equal(res.restored, 0);
    // no writeFile and no readFile should have been attempted on restore
    assert.equal(writes.length, 0, "failed snapshot must not trigger writes");
    assert.equal(reads.length, 0, "failed snapshot must not trigger reads");

    // also confirm the original content was left untouched
    assert.equal((await api.readFile(fileA)).toString(), "original\n");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher self-repair-actuator (part 1) regression tests");
  await testBuildRepairPacket();
  await testSnapshotFilesByteCounts();
  await testSnapshotFilesFailureNeverThrows();
  await testRestoreFilesWritesExactBytes();
  await testRestoreFilesFailedSnapshotRestoresNothing();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("self-repair-actuator regression runner crashed:", err); process.exit(1); });