// Regression tests for ops-watcher/self-repair-actuator.mjs.
// Fully offline: all file IO is injected through a fake fs, so no real file
// (including the .self-repair-backups directory) is ever created. No real
// spawn, no real fs, no real lane, no real suite run, no real Telegram.
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
  attemptRepair,
  escalate,
  resetCanaryStepBookkeeping,
  evaluateDrillChecks,
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
    mkdir: async (p) => { mkdirs.push(String(p)); return undefined; },
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

// A recording spy. `fn` is optional; its return value is what the spy returns.
function spy(fn) {
  function s(...args) {
    s.calls.push(args);
    return fn ? fn(...args) : undefined;
  }
  s.calls = [];
  return s;
}

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

const T = 1700000000000;
const canaryFault = {
  name: "canary-step",
  kind: "test-red",
  records: [{ name: "canary-step", excerpt: "AssertionError: canaryAdd(2,2) returned 5, expected 4" }],
};
const denyFault = {
  name: "steward",
  kind: "crash",
  records: [{ name: "steward", excerpt: "Error: boom" }],
};

// ---------------------------------------------------------------------
// makeAttemptDeps — builds a fully-injected deps object for attemptRepair plus
// handle to every spy. No real fs, no real spawn, no real lane, no real suite.
// cfg controls branch behaviour:
//   state         : initial state object written to the fake state file
//   guard         : return value of the guardLane spy
//   baselineOk    : scoped suite result on the FIRST runSuite call (baseline)
//   scopedAfterOk : scoped suite result on the SECOND runSuite call (after dispatch)
//   fullOk        : full suite result from runAllTests (no --only)
//   snapshot      : return value of the snapshotFiles spy (default ok snapshot)
//   dispatch      : return value of the dispatchRepair spy
// ---------------------------------------------------------------------
function makeAttemptDeps(cfg = {}) {
  const now = cfg.now || (() => T);
  const stateFile = cfg.stateFile || "/fake/self-repair-state.json";
  const store = new Map();
  store.set(stateFile, Buffer.from(JSON.stringify(cfg.state || {})));

  const readFile = async (p) => {
    const key = String(p);
    if (!store.has(key)) {
      const err = new Error(`ENOENT: ${key}`);
      err.code = "ENOENT";
      throw err;
    }
    const raw = store.get(key);
    return Buffer.isBuffer(raw) ? Buffer.from(raw) : Buffer.from(String(raw));
  };
  const writeFile = async (p, data) => {
    store.set(String(p), Buffer.isBuffer(data) ? data : Buffer.from(data));
    return undefined;
  };

  let suiteCall = 0;
  const runSuiteSpy = spy(() => {
    const isFirst = suiteCall === 0;
    suiteCall++;
    const okv = isFirst ? !!cfg.baselineOk : !!cfg.scopedAfterOk;
    return { ok: okv, summary: { ok: okv, total: 1, failed: okv ? 0 : 1 } };
  });
  const runAllTestsSpy = spy(() => ({ ok: !!cfg.fullOk, total: 1, failed: cfg.fullOk ? 0 : 1 }));
  const guardSpy = spy(() => cfg.guard || { skip: false, reason: null, remainingMs: 0, laneKey: "codex" });
  const recordSpy = spy(() => ({ recorded: true }));
  const dispatchSpy = spy(() => cfg.dispatch || { ok: true, stdout: "", stderr: "" });

  const snapshotObj = cfg.snapshot || { ok: true, entries: [{ file: "canary-step.mjs", backup: "/bk/canary-step.mjs", bytes: 64 }] };
  const snapshotSpy = spy(() => snapshotObj);
  const restoreSpy = spy(() => ({ ok: true, restored: 1 }));
  const appendSpy = spy();
  // Sentinels: attemptRepair must never invoke git/pm2/telegram. They only
  // record; if any branch calls them, the per-branch assert catches it.
  const gitSpy = spy();
  const pm2Spy = spy();
  const tgSpy = spy();

  const deps = {
    now,
    stateFile,
    readFile,
    writeFile,
    appendFile: appendSpy,
    runSuite: runSuiteSpy,
    runAllTests: runAllTestsSpy,
    guardLane: guardSpy,
    recordOutcome: recordSpy,
    dispatchRepair: dispatchSpy,
    snapshotFiles: snapshotSpy,
    restoreFiles: restoreSpy,
    git: gitSpy,
    pm2: pm2Spy,
    telegram: tgSpy,
  };

  return {
    deps, store, stateFile, snapshotObj,
    spies: { runSuiteSpy, runAllTestsSpy, guardSpy, recordSpy, dispatchSpy, snapshotSpy, restoreSpy, appendSpy, gitSpy, pm2Spy, tgSpy },
  };
}

// Assert the three external-effect sentinels were never touched.
function assertNoExternalEffects(name, spies) {
  assert.equal(spies.gitSpy.calls.length, 0, `${name}: git spy must not be called`);
  assert.equal(spies.pm2Spy.calls.length, 0, `${name}: pm2 spy must not be called`);
  assert.equal(spies.tgSpy.calls.length, 0, `${name}: telegram spy must not be called`);
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

    assert.ok(packet.includes("gbrain-curator"), "packet must name the failing step");

    const rel1 = path.relative(REPO_ROOT, scope.files[0]).split(path.sep).join("/");
    const rel2 = path.relative(REPO_ROOT, scope.files[1]).split(path.sep).join("/");
    assert.ok(packet.includes(rel1), `packet must include repo-relative path ${rel1}`);
    assert.ok(packet.includes(rel2), `packet must include repo-relative path ${rel2}`);

    const expectedCommand = "node ops-watcher/run-all-tests.mjs --only gbrain-curator.regression.test.mjs";
    assert.ok(packet.includes(expectedCommand), `packet must include exact command: ${expectedCommand}`);

    assert.ok(packet.includes("TypeError: cannot read 'y' of undefined"), "packet must include the newest error excerpt");
    assert.ok(/do not weaken.*assertion/i.test(packet), "packet must forbid weakening assertions");
    assert.ok(wordCount(packet) < 600, `packet must be under 600 words (got ${wordCount(packet)})`);

    const packet2 = buildRepairPacket(fault, scope, evidence);
    assert.equal(packet2, packet, "buildRepairPacket must be deterministic");
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
    const { api } = makeFakeFs(new Map([[okFile, "here\n"]]));

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

    await api.writeFile(fileA, Buffer.from("MUTATED alpha\n"));
    await api.writeFile(fileB, Buffer.from("MUTATED beta\n"));
    assert.equal(store.get(fileA).toString(), "MUTATED alpha\n");

    const res = await restoreFiles(snap, { _fs: api });
    assert.equal(res.ok, true);
    assert.equal(res.restored, 2);

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
    assert.equal(writes.length, 0, "failed snapshot must not trigger writes");
    assert.equal(reads.length, 0, "failed snapshot must not trigger reads");
    assert.equal((await api.readFile(fileA)).toString(), "original\n");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B1: deny-listed step -> refused:envelope, no snapshot, no dispatch
// =====================================================================
async function testRefusedEnvelope() {
  const name = "B1 deny-listed step -> refused:envelope, no snapshot, no dispatch";
  try {
    const { deps, spies } = makeAttemptDeps({});
    const res = await attemptRepair(denyFault, deps);
    assert.equal(res.outcome, "refused");
    assert.equal(res.reason, "envelope");
    assert.equal(spies.snapshotSpy.calls.length, 0, "snapshot must not run for refused step");
    assert.equal(spies.dispatchSpy.calls.length, 0, "dispatch must not run for refused step");
    assert.equal(spies.guardSpy.calls.length, 0, "guard must not run for refused step");
    assertNoExternalEffects(name, spies);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B2: cooldown active -> skipped:cooldown, no dispatch
// =====================================================================
async function testSkippedCooldown() {
  const name = "B2 cooldown active -> skipped:cooldown, no dispatch";
  try {
    const { deps, spies } = makeAttemptDeps({
      state: { attempts: { "canary-step": { lastAttemptMs: T } } },
      now: () => T,
    });
    const res = await attemptRepair(canaryFault, deps);
    assert.equal(res.outcome, "skipped");
    assert.equal(res.reason, "cooldown");
    assert.equal(spies.dispatchSpy.calls.length, 0, "dispatch must not run during cooldown");
    assert.equal(spies.snapshotSpy.calls.length, 0, "snapshot must not run during cooldown");
    assert.equal(spies.guardSpy.calls.length, 0, "guard must not run during cooldown");
    assertNoExternalEffects(name, spies);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B3: lane guard reports skip -> skipped:lane-quota, no snapshot, no dispatch
// =====================================================================
async function testSkippedLaneQuota() {
  const name = "B3 lane guard skip -> skipped:lane-quota, no snapshot, no dispatch";
  try {
    const { deps, spies } = makeAttemptDeps({
      guard: { skip: true, reason: "quota", remainingMs: 3600000, laneKey: "codex" },
    });
    const res = await attemptRepair(canaryFault, deps);
    assert.equal(res.outcome, "skipped");
    assert.equal(res.reason, "lane-quota");
    assert.equal(spies.snapshotSpy.calls.length, 0, "snapshot must not run when lane skips");
    assert.equal(spies.dispatchSpy.calls.length, 0, "dispatch must not run when lane skips");
    assert.equal(spies.guardSpy.calls.length, 1, "guard must be consulted exactly once");
    assertNoExternalEffects(name, spies);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B4: baseline scoped suite already green -> not-reproducible, no dispatch, no snapshot
// =====================================================================
async function testNotReproducible() {
  const name = "B4 baseline scoped suite green -> not-reproducible, no dispatch, no snapshot";
  try {
    const { deps, spies } = makeAttemptDeps({ baselineOk: true });
    const res = await attemptRepair(canaryFault, deps);
    assert.equal(res.outcome, "not-reproducible");
    assert.equal(res.dispatch, undefined);
    assert.equal(spies.dispatchSpy.calls.length, 0, "dispatch must not run when baseline is green");
    assert.equal(spies.snapshotSpy.calls.length, 0, "snapshot must not run when baseline is green");
    assertNoExternalEffects(name, spies);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B5: snapshot failure -> aborted:snapshot-failed, no dispatch
// =====================================================================
async function testAbortedSnapshotFailed() {
  const name = "B5 snapshot failure -> aborted:snapshot-failed, no dispatch";
  try {
    const { deps, spies } = makeAttemptDeps({
      baselineOk: false,
      snapshot: { ok: false, error: new Error("read failed") },
    });
    const res = await attemptRepair(canaryFault, deps);
    assert.equal(res.outcome, "aborted");
    assert.equal(res.reason, "snapshot-failed");
    assert.equal(spies.snapshotSpy.calls.length, 1, "snapshot must be attempted once");
    assert.equal(spies.dispatchSpy.calls.length, 0, "dispatch must not run when snapshot fails");
    assertNoExternalEffects(name, spies);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B6: happy path -> repaired, restoreFiles NOT called, exactly one evidence entry
// =====================================================================
async function testRepairedHappyPath() {
  const name = "B6 happy path -> repaired, restoreFiles NOT called, one evidence entry";
  try {
    const { deps, spies } = makeAttemptDeps({
      baselineOk: false,
      scopedAfterOk: true,
      fullOk: true,
      dispatch: { ok: true, stdout: "fixed", stderr: "" },
    });
    const res = await attemptRepair(canaryFault, deps);
    assert.equal(res.outcome, "repaired");
    assert.equal(spies.restoreSpy.calls.length, 0, "restoreFiles must NOT be called on the happy path");
    assert.equal(spies.dispatchSpy.calls.length, 1, "dispatch must run exactly once");
    assert.equal(spies.recordSpy.calls.length, 1, "lane outcome must be recorded once");
    assert.equal(spies.appendSpy.calls.length, 1, "exactly one evidence entry must be appended");
    assertNoExternalEffects(name, spies);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B7: scoped suite still red after dispatch -> reverted:scoped-suite-red, restoreFiles called with the snapshot
// =====================================================================
async function testRevertedScopedSuiteRed() {
  const name = "B7 scoped still red after dispatch -> reverted:scoped-suite-red, restoreFiles called with snapshot";
  try {
    const { deps, spies, snapshotObj } = makeAttemptDeps({
      baselineOk: false,
      scopedAfterOk: false,
    });
    const res = await attemptRepair(canaryFault, deps);
    assert.equal(res.outcome, "reverted");
    assert.equal(res.reason, "scoped-suite-red");
    assert.equal(spies.restoreSpy.calls.length, 1, "restoreFiles must be called once on scoped-suite-red");
    assert.equal(spies.restoreSpy.calls[0][0], snapshotObj, "restoreFiles must receive the snapshot object");
    assert.equal(spies.dispatchSpy.calls.length, 1, "dispatch must have run before the rollback");
    assert.equal(spies.appendSpy.calls.length, 1, "exactly one evidence entry must be appended");
    assertNoExternalEffects(name, spies);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B8: scoped green but FULL suite red -> reverted:full-suite-red, restoreFiles called
// =====================================================================
async function testRevertedFullSuiteRed() {
  const name = "B8 scoped green but full red -> reverted:full-suite-red, restoreFiles called";
  try {
    const { deps, spies, snapshotObj } = makeAttemptDeps({
      baselineOk: false,
      scopedAfterOk: true,
      fullOk: false,
    });
    const res = await attemptRepair(canaryFault, deps);
    assert.equal(res.outcome, "reverted");
    assert.equal(res.reason, "full-suite-red");
    assert.equal(spies.restoreSpy.calls.length, 1, "restoreFiles must be called once on full-suite-red");
    assert.equal(spies.restoreSpy.calls[0][0], snapshotObj, "restoreFiles must receive the snapshot object");
    assert.equal(spies.runAllTestsSpy.calls.length, 1, "full suite must be run exactly once");
    assertNoExternalEffects(name, spies);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B9: in every branch above, git/pm2/telegram spies are never called
// =====================================================================
async function testNoExternalEffectsAcrossBranches() {
  const name = "B9 across all branches git/pm2/telegram spies are never called";
  try {
    const branches = [
      { label: "refused", fault: denyFault, cfg: {} },
      { label: "cooldown", fault: canaryFault, cfg: { state: { attempts: { "canary-step": { lastAttemptMs: T } } }, now: () => T } },
      { label: "lane-quota", fault: canaryFault, cfg: { guard: { skip: true, reason: "quota", remainingMs: 0, laneKey: "codex" } } },
      { label: "not-reproducible", fault: canaryFault, cfg: { baselineOk: true } },
      { label: "snapshot-failed", fault: canaryFault, cfg: { baselineOk: false, snapshot: { ok: false, error: new Error("e") } } },
      { label: "repaired", fault: canaryFault, cfg: { baselineOk: false, scopedAfterOk: true, fullOk: true } },
      { label: "scoped-suite-red", fault: canaryFault, cfg: { baselineOk: false, scopedAfterOk: false } },
      { label: "full-suite-red", fault: canaryFault, cfg: { baselineOk: false, scopedAfterOk: true, fullOk: false } },
    ];
    for (const b of branches) {
      const { deps, spies } = makeAttemptDeps(b.cfg);
      await attemptRepair(b.fault, deps);
      assert.equal(spies.gitSpy.calls.length, 0, `${b.label}: git spy must not be called`);
      assert.equal(spies.pm2Spy.calls.length, 0, `${b.label}: pm2 spy must not be called`);
      assert.equal(spies.tgSpy.calls.length, 0, `${b.label}: telegram spy must not be called`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B10: escalate posts once then respects its 24h per-step cooldown
// =====================================================================
async function testEscalateFailedAlertKeepsRetrying() {
  const name = "B10b escalate with a failed postAlert reports alerted=false and does not start the cooldown";
  try {
    // defaultPostAlert catches its own spawn failure and returns { pid: null,
    // error } rather than throwing, so the `try { postAlert(m) } catch {}` this
    // replaced caught nothing and returned alerted:true regardless. Stamping
    // lastAlertedMs then suppressed the retry for the whole 24h window, so one
    // undelivered escalation silenced the step entirely.
    const stateFile = "/fake/escalate-fail-state.json";
    const store = new Map();
    const readFile = async (p) => {
      const key = String(p);
      if (!store.has(key)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return Buffer.from(store.get(key));
    };
    const writeFile = async (p, data) => { store.set(String(p), Buffer.isBuffer(data) ? data : Buffer.from(data)); };
    const failing = spy(() => ({ pid: null, error: "spawn ENOENT" }));
    const working = spy(() => ({ pid: 321 }));
    const fault = { name: "gbrain-curator", kind: "crash" };

    const r1 = await escalate(fault, [], { stateFile, readFile, writeFile, postAlert: failing, now: () => T });
    assert.equal(r1.alerted, false, "a failed spawn is not an alert");
    assert.match(String(r1.reason), /ENOENT/, "the reason names the spawn failure");
    assert.equal(failing.calls.length, 1);

    // One minute later, well inside the 24h window: because the first attempt
    // was never delivered, there is no cooldown to respect and it must retry.
    const r2 = await escalate(fault, [], { stateFile, readFile, writeFile, postAlert: working, now: () => T + 60 * 1000 });
    assert.equal(r2.alerted, true, "the next sweep retries an undelivered escalation");
    assert.equal(r2.pid, 321, "the delivered attempt carries its pid");
    assert.equal(working.calls.length, 1);

    // And now the cooldown does apply.
    const r3 = await escalate(fault, [], { stateFile, readFile, writeFile, postAlert: working, now: () => T + 2 * 60 * 1000 });
    assert.equal(r3.alerted, false, "a delivered escalation still starts the cooldown");
    assert.equal(r3.reason, "cooldown");
    assert.equal(working.calls.length, 1, "no second call inside the window");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testEscalateCooldown() {
  const name = "B10 escalate posts once then respects 24h per-step cooldown";
  try {
    const stateFile = "/fake/escalate-state.json";
    const store = new Map([[stateFile, Buffer.from(JSON.stringify({}))]]);
    const readFile = async (p) => {
      const key = String(p);
      if (!store.has(key)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return Buffer.from(store.get(key));
    };
    const writeFile = async (p, data) => { store.set(String(p), Buffer.isBuffer(data) ? data : Buffer.from(data)); };
    const postAlertSpy = spy(() => ({ pid: 123 }));

    const fault = { name: "gbrain-curator", kind: "crash" };
    const baseDeps = { stateFile, readFile, writeFile, postAlert: postAlertSpy };

    const r1 = await escalate(fault, [], { ...baseDeps, now: () => T });
    assert.equal(r1.alerted, true, "first escalate must post");
    assert.equal(postAlertSpy.calls.length, 1, "postAlert must be called exactly once on first escalate");

    // Second call only 1 hour later — inside the 24h window.
    const r2 = await escalate(fault, [], { ...baseDeps, now: () => T + 60 * 60 * 1000 });
    assert.equal(r2.alerted, false, "second escalate inside the window must not post");
    assert.equal(r2.reason, "cooldown", "second escalate must report cooldown");
    assert.equal(postAlertSpy.calls.length, 1, "postAlert must still have been called only once");

    // A DIFFERENT step has its own cooldown bookkeeping and must still post.
    const r3 = await escalate({ name: "canary-step", kind: "test-red" }, [], { ...baseDeps, now: () => T + 60 * 60 * 1000 });
    assert.equal(r3.alerted, true, "a different step must not be cooled down by the first");
    assert.equal(postAlertSpy.calls.length, 2, "postAlert must be called for the different step");

    // 25h later the original step is off cooldown and posts again.
    const r4 = await escalate(fault, [], { ...baseDeps, now: () => T + 25 * 60 * 60 * 1000 });
    assert.equal(r4.alerted, true, "after 24h the original step must post again");
    assert.equal(postAlertSpy.calls.length, 3, "postAlert must be called again after the window expires");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B11: resetCanaryStepBookkeeping removes only the canary-step attempt entry
// =====================================================================
async function testResetCanaryStepBookkeeping() {
  const name = "B11 resetCanaryStepBookkeeping removes only canary-step attempt entry";
  try {
    const stateFile = "/fake/drill-state.json";
    const initial = {
      attempts: {
        "canary-step": { lastAttemptMs: T },
        "gbrain-curator": { lastAttemptMs: T - 1000 },
      },
      escalations: {
        "canary-step": { lastAlertedMs: T - 2000 },
        "gbrain-curator": { lastAlertedMs: T - 3000 },
      },
      faults: {
        "canary-step": { firstSeenMs: T - 9999, name: "canary-step", kind: "test-red" },
      },
    };
    const store = new Map([[stateFile, Buffer.from(JSON.stringify(initial))]]);
    const readFile = async (p) => {
      const key = String(p);
      if (!store.has(key)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return Buffer.from(store.get(key));
    };
    const writeFile = async (p, data) => { store.set(String(p), Buffer.isBuffer(data) ? data : Buffer.from(data)); };

    const res = await resetCanaryStepBookkeeping({ readFile, writeFile, stateFile });
    assert.equal(res.cleared, true, "should report cleared when canary-step was present");

    const after = JSON.parse(store.get(stateFile).toString());
    assert.equal(after.attempts["canary-step"], undefined, "canary-step attempt entry must be removed");
    assert.ok(after.attempts["gbrain-curator"], "other steps' attempt entries must be untouched");
    assert.equal(after.attempts["gbrain-curator"].lastAttemptMs, T - 1000, "other step attempt value preserved");
    assert.ok(after.escalations["canary-step"], "canary-step escalation bookkeeping must be left untouched");
    assert.ok(after.escalations["gbrain-curator"], "other escalations must be untouched");
    assert.ok(after.faults["canary-step"], "faults bookkeeping must be untouched");

    // Idempotent: a second call on a state without canary-step reports cleared:false.
    const res2 = await resetCanaryStepBookkeeping({ readFile, writeFile, stateFile });
    assert.equal(res2.cleared, false, "second call with no canary-step entry reports cleared:false");
    const after2 = JSON.parse(store.get(stateFile).toString());
    assert.equal(after2.attempts["gbrain-curator"].lastAttemptMs, T - 1000, "state unchanged on no-op call");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// B12: evaluateDrillChecks — the dry-drill criteria evaluator
// Passes only when all five conditions hold; flipping any single input to its
// failing value produces a failure naming the corresponding check.
// =====================================================================
async function testEvaluateDrillChecks() {
  const name = "B12 evaluateDrillChecks passes only when all five hold and names the failed check";
  try {
    const good = {
      baselineRed: true,
      outcome: "reverted:scoped-suite-red",
      rollbackByAttempt: true,
      matchesCorrupted: true,
      matchesOriginal: true,
      finalSuiteGreen: true,
    };

    const all = evaluateDrillChecks(good);
    assert.equal(all.ok, true, "all-true inputs must pass");
    assert.equal(all.failedCheck, null, "no failed check when every condition holds");
    assert.ok(Array.isArray(all.checks), "checks must be an array");
    assert.equal(all.checks.length, 5, "exactly five checks must be reported, in order");
    assert.equal(all.checks[0].name, "baseline suite red", "check 1 name");
    assert.equal(all.checks[1].name, "attempt outcome reverted:scoped-suite-red", "check 2 name");
    assert.equal(all.checks[2].name, "rollback by attemptRepair", "check 3 name");
    assert.equal(all.checks[3].name, "canary byte-identical to corrupted content after attemptRepair", "check 4 name");
    assert.equal(all.checks[4].name, "canary byte-identical to original and suite green after outer restore", "check 5 name");
    assert.ok(all.checks.every((c) => c.pass === true), "every check must pass on all-true inputs");

    // Flipping any single input to a failing value must fail and name the
    // corresponding check. matchesOriginal and finalSuiteGreen both feed
    // check 5, so each flip must name check 5.
    const flips = [
      { key: "baselineRed", val: false, expect: "baseline suite red" },
      { key: "outcome", val: "repaired", expect: "attempt outcome reverted:scoped-suite-red" },
      { key: "rollbackByAttempt", val: false, expect: "rollback by attemptRepair" },
      { key: "matchesCorrupted", val: false, expect: "canary byte-identical to corrupted content after attemptRepair" },
      { key: "matchesOriginal", val: false, expect: "canary byte-identical to original and suite green after outer restore" },
      { key: "finalSuiteGreen", val: false, expect: "canary byte-identical to original and suite green after outer restore" },
    ];
    for (const f of flips) {
      const r = evaluateDrillChecks({ ...good, [f.key]: f.val });
      assert.equal(r.ok, false, `flipping ${f.key} must make the verdict fail`);
      assert.equal(r.failedCheck, f.expect, `flipping ${f.key} must name check "${f.expect}" (got "${r.failedCheck}")`);
    }

    // Missing inputs (undefined) are treated as falsy and must also fail.
    const empty = evaluateDrillChecks({});
    assert.equal(empty.ok, false, "all-undefined inputs must fail");
    assert.equal(empty.failedCheck, "baseline suite red", "first failing check on empty input is check 1");

    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher self-repair-actuator regression tests");
  await testBuildRepairPacket();
  await testSnapshotFilesByteCounts();
  await testSnapshotFilesFailureNeverThrows();
  await testRestoreFilesWritesExactBytes();
  await testRestoreFilesFailedSnapshotRestoresNothing();
  await testRefusedEnvelope();
  await testSkippedCooldown();
  await testSkippedLaneQuota();
  await testNotReproducible();
  await testAbortedSnapshotFailed();
  await testRepairedHappyPath();
  await testRevertedScopedSuiteRed();
  await testRevertedFullSuiteRed();
  await testNoExternalEffectsAcrossBranches();
  await testEscalateCooldown();
  await testEscalateFailedAlertKeepsRetrying();
  await testResetCanaryStepBookkeeping();
  await testEvaluateDrillChecks();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("self-repair-actuator regression runner crashed:", err); process.exit(1); });