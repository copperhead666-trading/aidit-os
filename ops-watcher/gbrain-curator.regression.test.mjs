// ops-watcher/gbrain-curator.regression.test.mjs
// Offline regression coverage for the GBrain curator. NO real `gbrain` CLI call
// is made — runCapture is fully injected. NO real repo files are stat'd —
// statFile is fully injected. Run with:
//   node ops-watcher/gbrain-curator.regression.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runGbrainCuratorOnce as runGbrainCuratorOnceReal,
  runCaptureReal,
  CAPTURE_TIMEOUT_MS,
  BACKOFF_MS,
  GBRAIN_LOCK_FILE,
  PROJECTION_MAX_BYTES,
  SOURCE_PROJECTIONS,
  projectAgentRegistry,
  projectDecisionLedger,
  readGbrainLockHolder,
  defaultReadState,
  defaultWriteState,
} from "./gbrain-curator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function runGbrainCuratorOnce(deps = {}) {
  return runGbrainCuratorOnceReal({ sourceProjections: new Map(), ...deps });
}

function repoPath(rel) {
  return path.resolve(ROOT, rel);
}

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

const SOURCES = new Map([
  ["agent-registry", "config/agent-registry.json"],
  ["canonical-decision-ledger", "config/decision-ledger.json"],
  ["paperclip-endpoint", "config/paperclip-endpoint.json"],
  ["master-canonical-backlog", "handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"],
  ["canonical-role-map", "handoffs/sjahrir/CANONICAL-ROLE-MAP.json"],
]);

function makeErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function makeFakeStat(table) {
  return async (file) => {
    const entry = table.get(file);
    if (!entry) throw makeErr("ENOENT", `ENOENT: ${file}`);
    return { mtimeMs: entry.mtimeMs };
  };
}

function captureCalls() {
  const calls = [];
  const runCapture = async (sourceFile, slug) => {
    calls.push({ sourceFile, slug });
    return { ok: true, slug };
  };
  return { calls, runCapture };
}

function makeLogCapture() {
  const lines = [];
  const log = (m) => { lines.push(String(m)); };
  return { lines, log };
}

function makeDeps(overrides = {}) {
  const deps = {
    sources: SOURCES,
    statFile: async () => { throw makeErr("ENOENT", "unexpected stat"); },
    runCapture: async () => ({ ok: true }),
    stateFile: "/state.json",
    readState: async () => ({ ok: true, value: {} }),
    writeState: async () => ({ ok: true }),
    readGbrainLockHolder: async () => null,
    lockFile: GBRAIN_LOCK_FILE,
    log: () => {},
    now: () => 1700000000000,
    ...overrides,
  };
  return deps;
}

function makeFakeProcess({ pid = 1234, onKill = () => {} } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = pid;
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    onKill(signal, child);
    return true;
  };
  return child;
}

// ---- T1: newer mtime -> captured and state updated ----
async function t1_newerMtimeGetsCaptured() {
  const name = "T1 newer mtime -> captured and state updated";
  const state = { "agent-registry": 1000 };
  const statTable = new Map([
    [repoPath("config/agent-registry.json"), { mtimeMs: 2000 }],
    [repoPath("config/decision-ledger.json"), { mtimeMs: 2000 }],
    [repoPath("config/paperclip-endpoint.json"), { mtimeMs: 2000 }],
    [repoPath("handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"), { mtimeMs: 2000 }],
    [repoPath("handoffs/sjahrir/CANONICAL-ROLE-MAP.json"), { mtimeMs: 2000 }],
  ]);
  const { calls, runCapture } = captureCalls();
  let written = null;
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: state }),
      writeState: async (file, obj) => { written = { file, obj }; return { ok: true }; },
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    const res = r.results.find((x) => x.slug === "agent-registry");
    assert.ok(res, "result for agent-registry present");
    assert.equal(res.outcome, "ingested", "newer mtime -> ingested");
    assert.equal(calls.length, 5, "all 5 sources captured");
    assert.ok(calls.some((c) => c.slug === "agent-registry" && c.sourceFile === repoPath("config/agent-registry.json")), "agent-registry captured with right file");
    assert.ok(written, "state was written");
    assert.equal(written.obj["agent-registry"], 2000, "state updated to new mtime");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T2: matching mtime -> skipped, runCapture NOT called ----
async function t2_matchingMtimeSkipped() {
  const name = "T2 matching mtime -> skipped, runCapture not called";
  const state = { "agent-registry": 3000 };
  const statTable = new Map([
    [repoPath("config/agent-registry.json"), { mtimeMs: 3000 }],
  ]);
  const { calls, runCapture } = captureCalls();
  let written = null;
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: state }),
      writeState: async (file, obj) => { written = { file, obj }; return { ok: true }; },
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    const res = r.results.find((x) => x.slug === "agent-registry");
    assert.equal(res.outcome, "up-to-date", "exact mtime -> up-to-date");
    assert.equal(calls.filter((c) => c.slug === "agent-registry").length, 0, "runCapture not called for up-to-date source");
    // State already clean, no ingests, so no write needed.
    assert.equal(written, null, "state not rewritten when nothing changed");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T3: no prior state -> captured ----
async function t3_noPriorStateCaptured() {
  const name = "T3 no prior state -> captured";
  const state = {};
  const statTable = new Map([
    [repoPath("config/agent-registry.json"), { mtimeMs: 4000 }],
  ]);
  const { calls, runCapture } = captureCalls();
  let written = null;
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: state }),
      writeState: async (file, obj) => { written = { file, obj }; return { ok: true }; },
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    const res = r.results.find((x) => x.slug === "agent-registry");
    assert.equal(res.outcome, "ingested", "no prior state -> ingested");
    assert.ok(calls.some((c) => c.slug === "agent-registry"), "capture called for first-run source");
    assert.ok(written, "state written on first run");
    assert.equal(written.obj["agent-registry"], 4000, "state records first mtime");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T4: missing source file -> skipped-missing, does not crash, others processed ----
async function t4_missingSourceSkippedAndOthersProcessed() {
  const name = "T4 missing source file -> skipped-missing, others still processed";
  const state = {};
  const statTable = new Map([
    // agent-registry intentionally missing
    [repoPath("config/decision-ledger.json"), { mtimeMs: 5000 }],
    [repoPath("config/paperclip-endpoint.json"), { mtimeMs: 5000 }],
    [repoPath("handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"), { mtimeMs: 5000 }],
    [repoPath("handoffs/sjahrir/CANONICAL-ROLE-MAP.json"), { mtimeMs: 5000 }],
  ]);
  const { calls, runCapture } = captureCalls();
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: state }),
      writeState: async () => ({ ok: true }),
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    const missing = r.results.find((x) => x.slug === "agent-registry");
    assert.equal(missing.outcome, "skipped-missing", "missing file outcome");
    assert.ok(missing.reason && missing.reason.includes("not found"), "missing reason mentions not found");
    const others = r.results.filter((x) => x.slug !== "agent-registry");
    assert.equal(others.length, 4, "other 4 results present");
    for (const o of others) assert.equal(o.outcome, "ingested", `${o.slug} still ingested`);
    assert.equal(calls.length, 4, "only 4 captures attempted");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T5: runCapture failure for one source -> failed, state not updated, others proceed ----
async function t5_captureFailureIsolated() {
  const name = "T5 capture failure -> failed for that source, others proceed";
  const state = {};
  const statTable = new Map([
    [repoPath("config/agent-registry.json"), { mtimeMs: 6000 }],
    [repoPath("config/decision-ledger.json"), { mtimeMs: 6000 }],
    [repoPath("config/paperclip-endpoint.json"), { mtimeMs: 6000 }],
    [repoPath("handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"), { mtimeMs: 6000 }],
    [repoPath("handoffs/sjahrir/CANONICAL-ROLE-MAP.json"), { mtimeMs: 6000 }],
  ]);
  const calls = [];
  const runCapture = async (sourceFile, slug) => {
    calls.push({ sourceFile, slug });
    if (slug === "canonical-decision-ledger") return { ok: false, slug, error: "simulated capture failure" };
    return { ok: true, slug };
  };
  let written = null;
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: state }),
      writeState: async (file, obj) => { written = { file, obj }; return { ok: true }; },
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    const failed = r.results.find((x) => x.slug === "canonical-decision-ledger");
    assert.equal(failed.outcome, "failed", "failed source outcome");
    assert.ok(failed.reason && failed.reason.includes("simulated capture failure"), "failure reason preserved");
    assert.equal(written.obj["canonical-decision-ledger"], undefined, "state NOT updated for failed source");
    const succeeded = r.results.filter((x) => x.slug !== "canonical-decision-ledger" && x.outcome === "ingested");
    assert.equal(succeeded.length, 4, "other 4 sources ingested");
    assert.equal(calls.length, 5, "all 5 capture attempts made");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T6: corrupt (non-ENOENT) state read -> WARN log, all sources treated as needing ingestion ----
async function t6_corruptStateReadWarns() {
  const name = "T6 corrupt state read -> WARN log, all sources ingested";
  const statTable = new Map([
    [repoPath("config/agent-registry.json"), { mtimeMs: 7000 }],
    [repoPath("config/decision-ledger.json"), { mtimeMs: 7000 }],
    [repoPath("config/paperclip-endpoint.json"), { mtimeMs: 7000 }],
    [repoPath("handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"), { mtimeMs: 7000 }],
    [repoPath("handoffs/sjahrir/CANONICAL-ROLE-MAP.json"), { mtimeMs: 7000 }],
  ]);
  const { calls, runCapture } = captureCalls();
  const { lines, log } = makeLogCapture();
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: false, code: "EACCES", message: "permission denied" }),
      writeState: async () => ({ ok: true }),
      log,
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    assert.ok(lines.some((l) => /WARN.*state file read failed.*EACCES/.test(l)), "WARN log line for corrupt read");
    assert.equal(calls.length, 5, "all sources captured after reset");
    for (const res of r.results) assert.equal(res.outcome, "ingested", `${res.slug} ingested after reset`);
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T7: state-file write failure -> ERROR log, run still completes ----
async function t7_stateWriteFailureErrors() {
  const name = "T7 state write failure -> ERROR log, run completes with results";
  const statTable = new Map([
    [repoPath("config/agent-registry.json"), { mtimeMs: 8000 }],
    [repoPath("config/decision-ledger.json"), { mtimeMs: 8000 }],
    [repoPath("config/paperclip-endpoint.json"), { mtimeMs: 8000 }],
    [repoPath("handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"), { mtimeMs: 8000 }],
    [repoPath("handoffs/sjahrir/CANONICAL-ROLE-MAP.json"), { mtimeMs: 8000 }],
  ]);
  const { calls, runCapture } = captureCalls();
  const { lines, log } = makeLogCapture();
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async () => ({ ok: false, code: "ENOSPC", message: "no space left" }),
      log,
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    assert.ok(lines.some((l) => /ERROR.*persisting state FAILED.*ENOSPC/.test(l)), "ERROR log line for write failure");
    assert.equal(r.persistError, "ENOSPC", "persistError returned");
    assert.equal(calls.length, 5, "all captures attempted despite write failure");
    assert.equal(r.results.filter((x) => x.outcome === "ingested").length, 5, "all results ingested");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T8: ENOENT state read stays silent (first run) ----
async function t8_enoentStateReadSilent() {
  const name = "T8 ENOENT state read -> silent, run proceeds normally";
  const statTable = new Map([
    [repoPath("config/agent-registry.json"), { mtimeMs: 9000 }],
    [repoPath("config/decision-ledger.json"), { mtimeMs: 9000 }],
    [repoPath("config/paperclip-endpoint.json"), { mtimeMs: 9000 }],
    [repoPath("handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"), { mtimeMs: 9000 }],
    [repoPath("handoffs/sjahrir/CANONICAL-ROLE-MAP.json"), { mtimeMs: 9000 }],
  ]);
  const { calls, runCapture } = captureCalls();
  const { lines, log } = makeLogCapture();
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: false, code: "ENOENT", message: "no such file" }),
      writeState: async () => ({ ok: true }),
      log,
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    assert.ok(!lines.some((l) => /WARN.*state file read failed/.test(l)), "no WARN for ENOENT");
    assert.equal(calls.length, 5, "captures proceed on first run");
    assert.equal(r.results.filter((x) => x.outcome === "ingested").length, 5, "all ingested");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function t9_win32TimeoutUsesTaskkillTreeKill() {
  const name = "T9 win32 timeout -> taskkill tree kill by pid";
  const gbrainChild = makeFakeProcess({ pid: 4242 });
  const spawnCalls = [];
  const spawnFn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    if (cmd === "gbrain") return gbrainChild;
    if (cmd === "taskkill") {
      setImmediate(() => gbrainChild.emit("close", null));
      return makeFakeProcess({ pid: 9000 });
    }
    throw new Error(`unexpected command: ${cmd}`);
  };
  try {
    const r = await runCaptureReal("C:\\fake-source.json", "agent-registry", {
      timeoutMs: 1,
      platform: "win32",
      spawnFn,
    });
    const taskkill = spawnCalls.find((c) => c.cmd === "taskkill");
    assert.equal(spawnCalls[0].cmd, "gbrain", "initial capture still spawns gbrain");
    assert.ok(taskkill, "taskkill invoked on win32 timeout");
    assert.deepEqual(taskkill.args, ["/pid", "4242", "/t", "/f"], "taskkill targets the gbrain shim pid and tree");
    assert.equal(taskkill.opts.windowsHide, true, "taskkill is hidden on Windows");
    assert.deepEqual(gbrainChild.killCalls, [], "plain SIGTERM not used when taskkill succeeds");
    assert.equal(r.ok, false, "timeout resolves as failed capture");
    assert.match(r.error, /timed out after 1ms/, "timeout error includes configured deadline");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T10: non-win32 timeout keeps plain SIGTERM and does not call taskkill ----
async function t10_nonWin32TimeoutUsesSigtermOnly() {
  const name = "T10 non-win32 timeout -> SIGTERM only";
  let gbrainChild;
  gbrainChild = makeFakeProcess({
    pid: 5151,
    onKill: () => setImmediate(() => gbrainChild.emit("close", null)),
  });
  const spawnCalls = [];
  const spawnFn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    if (cmd === "gbrain") return gbrainChild;
    if (cmd === "taskkill") return makeFakeProcess({ pid: 9001 });
    throw new Error(`unexpected command: ${cmd}`);
  };
  try {
    const r = await runCaptureReal("/tmp/fake-source.json", "agent-registry", {
      timeoutMs: 1,
      platform: "linux",
      spawnFn,
    });
    assert.deepEqual(gbrainChild.killCalls, ["SIGTERM"], "plain SIGTERM used on non-win32 timeout");
    assert.equal(spawnCalls.some((c) => c.cmd === "taskkill"), false, "taskkill not invoked on non-win32");
    assert.equal(r.ok, false, "timeout resolves as failed capture");
    assert.match(r.error, /timed out after 1ms/, "timeout error includes configured deadline");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T11: default capture timeout accommodates multi-minute captures ----
async function t11_defaultTimeoutAtLeastFiveMinutes() {
  const name = "T11 default capture timeout >= 300000ms";
  try {
    assert.ok(CAPTURE_TIMEOUT_MS >= 300000, `CAPTURE_TIMEOUT_MS was ${CAPTURE_TIMEOUT_MS}`);
    ok(name);
  } catch (err) { bad(name, err); }
}
function makeFullStatTable(mtimeMs) {
  return new Map([
    [repoPath("config/agent-registry.json"), { mtimeMs }],
    [repoPath("config/decision-ledger.json"), { mtimeMs }],
    [repoPath("config/paperclip-endpoint.json"), { mtimeMs }],
    [repoPath("handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"), { mtimeMs }],
    [repoPath("handoffs/sjahrir/CANONICAL-ROLE-MAP.json"), { mtimeMs }],
  ]);
}

// ---- T12: live lock holder -> all sources skipped-locked, no capture, no write ----
async function t12_liveLockHolderSkipsAllSources() {
  const name = "T12 live lock holder -> skipped-locked for all sources";
  const statTable = makeFullStatTable(12000);
  let writeCalled = false;
  const runCapture = async () => {
    throw new Error("runCapture should not be called while lock is live");
  };
  try {
    const r = await runGbrainCuratorOnce({
      sources: SOURCES,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async () => { writeCalled = true; return { ok: true }; },
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder: async () => ({ pid: 111, command: "gbrain capture" }),
    });
    assert.equal(r.results.length, SOURCES.size, "all sources have results");
    for (const res of r.results) assert.equal(res.outcome, "skipped-locked", `${res.slug} skipped-locked`);
    assert.equal(writeCalled, false, "state not written when only lock skips occur");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T13: stale lock file -> real lock reader returns null and capture proceeds ----
async function t13_staleLockAllowsCapture() {
  const name = "T13 stale lock -> capture proceeds normally";
  const slug = "agent-registry";
  const sources = new Map([[slug, "config/agent-registry.json"]]);
  const statTable = new Map([[repoPath("config/agent-registry.json"), { mtimeMs: 13000 }]]);
  const { calls, runCapture } = captureCalls();
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async () => ({ ok: true }),
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder,
      lockFile: "/fake-lock",
      readFileSync: () => JSON.stringify({ pid: 4242, command: "x" }),
      isPidAlive: () => false,
    });
    assert.equal(r.results[0].outcome, "ingested", "stale lock -> ingested");
    assert.equal(calls.length, 1, "capture was called once");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T14: missing lock file -> real lock reader returns null and capture proceeds ----
async function t14_missingLockFileAllowsCapture() {
  const name = "T14 missing lock file -> capture proceeds normally";
  const slug = "agent-registry";
  const sources = new Map([[slug, "config/agent-registry.json"]]);
  const statTable = new Map([[repoPath("config/agent-registry.json"), { mtimeMs: 14000 }]]);
  const { calls, runCapture } = captureCalls();
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async () => ({ ok: true }),
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder,
      lockFile: "/fake-lock",
      readFileSync: () => { throw makeErr("ENOENT", "missing lock"); },
      isPidAlive: () => true,
    });
    assert.equal(r.results[0].outcome, "ingested", "missing lock -> ingested");
    assert.equal(calls.length, 1, "capture was called once");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T15: malformed lock file -> real lock reader returns null and capture proceeds ----
async function t15_malformedLockFileAllowsCapture() {
  const name = "T15 malformed lock file -> capture proceeds normally";
  const slug = "agent-registry";
  const sources = new Map([[slug, "config/agent-registry.json"]]);
  const statTable = new Map([[repoPath("config/agent-registry.json"), { mtimeMs: 15000 }]]);
  const { calls, runCapture } = captureCalls();
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async () => ({ ok: true }),
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder,
      lockFile: "/fake-lock",
      readFileSync: () => "not json{",
      isPidAlive: () => true,
    });
    assert.equal(r.results[0].outcome, "ingested", "malformed lock -> ingested");
    assert.equal(calls.length, 1, "capture was called once");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T16: capture failure -> failure bookkeeping is written ----
async function t16_failureBookkeepingWritten() {
  const name = "T16 failure bookkeeping -> writeState records first failure";
  const slug = "agent-registry";
  const nowMs = 1700000000000;
  const mtimeMs = 16000;
  const sources = new Map([[slug, "config/agent-registry.json"]]);
  const statTable = new Map([[repoPath("config/agent-registry.json"), { mtimeMs }]]);
  let written = null;
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture: async () => ({ ok: false, slug, error: "boom" }),
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async (file, obj) => { written = { file, obj }; return { ok: true }; },
      log: () => {},
      now: () => nowMs,
      readGbrainLockHolder: async () => null,
    });
    assert.equal(r.results[0].outcome, "failed", "failed capture outcome");
    assert.ok(written, "state written when only failure counter changes");
    assert.equal(written.obj[slug], undefined, "successful mtime not recorded for failed source");
    assert.equal(written.obj.__failures[slug].count, 1, "failure count starts at 1");
    assert.equal(written.obj.__failures[slug].lastAttemptMs, nowMs, "failure records attempt time");
    assert.equal(written.obj.__failures[slug].mtimeMs, mtimeMs, "failure records source mtime");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T17: active backoff -> skipped-backoff, no capture ----
async function t17_activeBackoffSkipsCapture() {
  const name = "T17 active backoff -> skipped-backoff and no capture";
  const slug = "agent-registry";
  const nowMs = 1700000000000;
  const mtimeMs = 17000;
  const sources = new Map([[slug, "config/agent-registry.json"]]);
  const statTable = new Map([[repoPath("config/agent-registry.json"), { mtimeMs }]]);
  let writeCalled = false;
  const state = { __failures: { [slug]: { count: 3, lastAttemptMs: nowMs - 60000, mtimeMs } } };
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture: async () => { throw new Error("runCapture should not be called during active backoff"); },
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: state }),
      writeState: async () => { writeCalled = true; return { ok: true }; },
      log: () => {},
      now: () => nowMs,
      readGbrainLockHolder: async () => null,
    });
    assert.equal(r.results[0].outcome, "skipped-backoff", "active backoff outcome");
    assert.equal(writeCalled, false, "state not written when backoff skip changes nothing");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T18: mtime change clears backoff; success clears failure, failure restarts count ----
async function t18_backoffClearedByMtimeChange() {
  const name = "T18 backoff cleared by mtime change -> capture runs and failure count resets";
  const slug = "agent-registry";
  const nowMs = 1700000000000;
  const oldMtimeMs = 18000;
  const newMtimeMs = 18001;
  const sources = new Map([[slug, "config/agent-registry.json"]]);
  const statTable = new Map([[repoPath("config/agent-registry.json"), { mtimeMs: newMtimeMs }]]);
  try {
    const successCalls = [];
    let successWritten = null;
    const successState = { __failures: { [slug]: { count: 3, lastAttemptMs: nowMs - 60000, mtimeMs: oldMtimeMs } } };
    const success = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture: async (sourceFile, captureSlug) => {
        successCalls.push({ sourceFile, slug: captureSlug });
        return { ok: true, slug: captureSlug };
      },
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: successState }),
      writeState: async (file, obj) => { successWritten = { file, obj }; return { ok: true }; },
      log: () => {},
      now: () => nowMs,
      readGbrainLockHolder: async () => null,
    });
    assert.equal(success.results[0].outcome, "ingested", "mtime change success outcome");
    assert.equal(successCalls.length, 1, "success variant captured once");
    assert.ok(successWritten, "success variant writes state");
    assert.equal(Object.prototype.hasOwnProperty.call(successWritten.obj.__failures || {}, slug), false, "success clears pre-existing failure entry");

    const failureCalls = [];
    let failureWritten = null;
    const failureState = { __failures: { [slug]: { count: 3, lastAttemptMs: nowMs - 60000, mtimeMs: oldMtimeMs } } };
    const failure = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture: async (sourceFile, captureSlug) => {
        failureCalls.push({ sourceFile, slug: captureSlug });
        return { ok: false, slug: captureSlug, error: "boom" };
      },
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: failureState }),
      writeState: async (file, obj) => { failureWritten = { file, obj }; return { ok: true }; },
      log: () => {},
      now: () => nowMs,
      readGbrainLockHolder: async () => null,
    });
    assert.equal(failure.results[0].outcome, "failed", "mtime change failure outcome");
    assert.equal(failureCalls.length, 1, "failure variant captured once");
    assert.ok(failureWritten, "failure variant writes state");
    assert.equal(failureWritten.obj.__failures[slug].count, 1, "failure count restarts at 1 after mtime change");
    assert.equal(failureWritten.obj.__failures[slug].mtimeMs, newMtimeMs, "failure records new mtime");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T19: expired backoff -> capture proceeds ----
async function t19_expiredBackoffAllowsCapture() {
  const name = "T19 expired backoff -> capture proceeds";
  const slug = "agent-registry";
  const nowMs = 1700000000000;
  const mtimeMs = 19000;
  const sources = new Map([[slug, "config/agent-registry.json"]]);
  const statTable = new Map([[repoPath("config/agent-registry.json"), { mtimeMs }]]);
  const { calls, runCapture } = captureCalls();
  const state = { __failures: { [slug]: { count: 3, lastAttemptMs: nowMs - (BACKOFF_MS + 1000), mtimeMs } } };
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: state }),
      writeState: async () => ({ ok: true }),
      log: () => {},
      now: () => nowMs,
      readGbrainLockHolder: async () => null,
    });
    assert.equal(r.results[0].outcome, "ingested", "expired backoff outcome");
    assert.equal(calls.length, 1, "capture was called after backoff expired");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T20: flat legacy state remains compatible and __failures is not a source slug ----
async function t20_flatLegacyStateCompatible() {
  const name = "T20 flat legacy state -> up-to-date and no __failures result";
  const slug = "paperclip-endpoint";
  const mtimeMs = 20000;
  const sources = new Map([[slug, "config/paperclip-endpoint.json"]]);
  const statTable = new Map([[repoPath("config/paperclip-endpoint.json"), { mtimeMs }]]);
  const { calls, runCapture } = captureCalls();
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      statFile: makeFakeStat(statTable),
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: { [slug]: mtimeMs } }),
      writeState: async () => ({ ok: true }),
      log: () => {},
      now: () => 1700000000000,
      readGbrainLockHolder: async () => null,
    });
    assert.equal(r.results[0].slug, slug, "paperclip endpoint result present");
    assert.equal(r.results[0].outcome, "up-to-date", "flat mtime state remains up-to-date");
    assert.equal(r.results.some((res) => res.slug === "__failures"), false, "__failures never appears as a source result");
    assert.equal(calls.length, 0, "up-to-date legacy source is not captured");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T21: projectAgentRegistry keeps metadata/roster and drops narrative blocks ----
async function t21_projectAgentRegistryDropsNarrative() {
  const name = "T21 projectAgentRegistry -> keeps metadata and drops narrative blocks";
  try {
    const projected = JSON.parse(projectAgentRegistry(JSON.stringify({
      schema_version: "1.0",
      workspace: "FounderOS",
      agents: [{ slug: "alpha", role: "test" }],
      phase1_x: { narrative: true },
      p0_y: { narrative: true },
    })));
    assert.deepEqual(Object.keys(projected), ["projection_note", "source_path", "schema_version", "workspace", "agents"], "projected keys preserve required order");
    assert.equal(projected.source_path, "config/agent-registry.json", "source path is fixed");
    assert.equal(projected.schema_version, "1.0", "schema_version copied");
    assert.equal(projected.workspace, "FounderOS", "workspace copied");
    assert.deepEqual(projected.agents, [{ slug: "alpha", role: "test" }], "agents copied");
    assert.equal(Object.prototype.hasOwnProperty.call(projected, "phase1_x"), false, "phase narrative dropped");
    assert.equal(Object.prototype.hasOwnProperty.call(projected, "p0_y"), false, "p0 narrative dropped");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T22: projectAgentRegistry omits absent keys without undefined values ----
async function t22_projectAgentRegistryOmitsAbsentKeys() {
  const name = "T22 projectAgentRegistry -> omits absent keys";
  try {
    const text = projectAgentRegistry(JSON.stringify({ workspace: "FounderOS" }));
    const projected = JSON.parse(text);
    assert.deepEqual(Object.keys(projected), ["projection_note", "source_path", "workspace"], "only present optional keys are emitted");
    assert.equal(text.includes("undefined"), false, "JSON text never contains undefined");
    for (const value of Object.values(projected)) assert.notEqual(value, undefined, "no top-level undefined values");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T23: projected slug captures temp path and records source mtime ----
async function t23_projectedSlugUsesTempPathAndSourceMtime() {
  const name = "T23 projected slug -> temp capture path and source mtime state";
  const slug = "agent-registry";
  const mtimeMs = 23000;
  const sources = new Map([[slug, "config/agent-registry.json"]]);
  const raw = JSON.stringify({ schema_version: "1.0", workspace: "FounderOS", agents: [{ slug: "alpha" }], phase1_x: true });
  const sourceFile = repoPath("config/agent-registry.json");
  const tempFile = path.join(ROOT, "tmp-agent-registry-projection.json");
  const calls = [];
  let writtenTemp = null;
  let writtenState = null;
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      sourceProjections: SOURCE_PROJECTIONS,
      statFile: makeFakeStat(new Map([[sourceFile, { mtimeMs }]])),
      readSource: async (file) => {
        assert.equal(file, sourceFile, "projection reads the source file path");
        return raw;
      },
      writeTemp: async (captureSlug, projectedText) => {
        writtenTemp = { captureSlug, projectedText };
        return tempFile;
      },
      runCapture: async (captureFile, captureSlug) => {
        calls.push({ sourceFile: captureFile, slug: captureSlug });
        return { ok: true, slug: captureSlug };
      },
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async (file, obj) => { writtenState = { file, obj }; return { ok: true }; },
      readGbrainLockHolder: async () => null,
      log: () => {},
      now: () => 1700000000000,
    });
    assert.equal(r.results[0].outcome, "ingested", "projected source ingested");
    assert.deepEqual(calls, [{ sourceFile: tempFile, slug }], "capture receives temp file path and slug");
    assert.notEqual(calls[0].sourceFile, sourceFile, "capture path is not the original source path");
    assert.equal(writtenTemp.captureSlug, slug, "writeTemp receives slug");
    assert.deepEqual(JSON.parse(writtenTemp.projectedText).agents, [{ slug: "alpha" }], "writeTemp receives projected string");
    assert.equal(writtenState.obj[slug], mtimeMs, "state records source mtime");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T24: non-projected slug captures real source path ----
async function t24_nonProjectedSlugUsesRealSourcePath() {
  const name = "T24 non-projected slug -> real source path";
  const slug = "paperclip-endpoint";
  const sourceFile = repoPath("config/paperclip-endpoint.json");
  const { calls, runCapture } = captureCalls();
  try {
    const r = await runGbrainCuratorOnce({
      sources: new Map([[slug, "config/paperclip-endpoint.json"]]),
      sourceProjections: SOURCE_PROJECTIONS,
      statFile: makeFakeStat(new Map([[sourceFile, { mtimeMs: 24000 }]])),
      readSource: async () => { throw new Error("readSource should not run for non-projected slugs"); },
      writeTemp: async () => { throw new Error("writeTemp should not run for non-projected slugs"); },
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async () => ({ ok: true }),
      readGbrainLockHolder: async () => null,
      log: () => {},
      now: () => 1700000000000,
    });
    assert.equal(r.results[0].outcome, "ingested", "non-projected source ingested");
    assert.deepEqual(calls, [{ sourceFile, slug }], "capture receives original source path");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T25: projection larger than PROJECTION_MAX_BYTES fails before capture ----
async function t25_projectionTooLargeFailsBeforeCapture() {
  const name = "T25 oversized projection -> failed before capture and backoff count increments";
  const slug = "agent-registry";
  const sourceFile = repoPath("config/agent-registry.json");
  let writtenState = null;
  let captureCalled = false;
  try {
    const r = await runGbrainCuratorOnce({
      sources: new Map([[slug, "config/agent-registry.json"]]),
      sourceProjections: SOURCE_PROJECTIONS,
      statFile: makeFakeStat(new Map([[sourceFile, { mtimeMs: 25000 }]])),
      readSource: async () => JSON.stringify({ agents: [{ slug: "huge", body: "x".repeat(PROJECTION_MAX_BYTES) }] }),
      writeTemp: async () => { throw new Error("writeTemp should not run for oversized projections"); },
      runCapture: async () => { captureCalled = true; return { ok: true, slug }; },
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async (file, obj) => { writtenState = { file, obj }; return { ok: true }; },
      readGbrainLockHolder: async () => null,
      log: () => {},
      now: () => 1700000000000,
    });
    assert.equal(r.results[0].outcome, "failed", "oversized projection is a normal failure");
    assert.match(r.results[0].reason, /projection still too large/, "reason mentions oversized projection");
    assert.equal(captureCalled, false, "runCapture not called");
    assert.equal(writtenState.obj.__failures[slug].count, 1, "failure count starts at 1");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T26: readSource failure does not stop remaining sources ----
async function t26_readSourceThrowStillProcessesRemainingSources() {
  const name = "T26 readSource throw -> failed and remaining sources processed";
  const sources = new Map([
    ["agent-registry", "config/agent-registry.json"],
    ["paperclip-endpoint", "config/paperclip-endpoint.json"],
  ]);
  const agentSource = repoPath("config/agent-registry.json");
  const paperclipSource = repoPath("config/paperclip-endpoint.json");
  const { calls, runCapture } = captureCalls();
  try {
    const r = await runGbrainCuratorOnce({
      sources,
      sourceProjections: SOURCE_PROJECTIONS,
      statFile: makeFakeStat(new Map([
        [agentSource, { mtimeMs: 26000 }],
        [paperclipSource, { mtimeMs: 26000 }],
      ])),
      readSource: async () => { throw new Error("simulated read failure"); },
      writeTemp: async () => { throw new Error("writeTemp should not run when readSource fails"); },
      runCapture,
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async () => ({ ok: true }),
      readGbrainLockHolder: async () => null,
      log: () => {},
      now: () => 1700000000000,
    });
    const failed = r.results.find((res) => res.slug === "agent-registry");
    const ingested = r.results.find((res) => res.slug === "paperclip-endpoint");
    assert.equal(failed.outcome, "failed", "projected slug failed");
    assert.match(failed.reason, /simulated read failure/, "readSource error message preserved");
    assert.equal(ingested.outcome, "ingested", "remaining source still processed");
    assert.deepEqual(calls, [{ sourceFile: paperclipSource, slug: "paperclip-endpoint" }], "only remaining source captured");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T27: invalid JSON projection failure does not crash ----
async function t27_invalidJsonProjectionFailsWithoutCrash() {
  const name = "T27 invalid JSON projection -> failed without crash";
  const slug = "agent-registry";
  const sourceFile = repoPath("config/agent-registry.json");
  let captureCalled = false;
  try {
    const r = await runGbrainCuratorOnce({
      sources: new Map([[slug, "config/agent-registry.json"]]),
      sourceProjections: SOURCE_PROJECTIONS,
      statFile: makeFakeStat(new Map([[sourceFile, { mtimeMs: 27000 }]])),
      readSource: async () => "{not valid json",
      writeTemp: async () => { throw new Error("writeTemp should not run for invalid JSON"); },
      runCapture: async () => { captureCalled = true; return { ok: true, slug }; },
      stateFile: "/state.json",
      readState: async () => ({ ok: true, value: {} }),
      writeState: async () => ({ ok: true }),
      readGbrainLockHolder: async () => null,
      log: () => {},
      now: () => 1700000000000,
    });
    assert.equal(r.results[0].outcome, "failed", "invalid JSON becomes normal failure");
    assert.equal(captureCalled, false, "capture not called after projection parse failure");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T28: projectDecisionLedger on the real ledger -> valid JSON, all 39 ids, materially smaller ----
async function t28_projectDecisionLedgerRealFile() {
  const name = "T28 projectDecisionLedger on real decision-ledger.json -> valid JSON, all 39 ids, materially smaller";
  try {
    const ledgerPath = repoPath("config/decision-ledger.json");
    const rawText = readFileSync(ledgerPath, "utf8");
    const rawBytes = Buffer.byteLength(rawText, "utf8");
    const source = JSON.parse(rawText);
    const projectedText = projectDecisionLedger(rawText);
    const projectedBytes = Buffer.byteLength(projectedText, "utf8");
    // Must be valid JSON.
    const projected = JSON.parse(projectedText);
    // Keep top-level scope and merged_legacy_ledger_at verbatim.
    assert.equal(projected.scope, source.scope, "top-level scope preserved verbatim");
    assert.equal(projected.merged_legacy_ledger_at, source.merged_legacy_ledger_at, "merged_legacy_ledger_at preserved verbatim");
    // Drop the migration bookkeeping at the top level.
    assert.equal(Object.prototype.hasOwnProperty.call(projected, "imported_from"), false, "top-level imported_from migration bookkeeping dropped");
    // All 39 record ids kept, no extras, no duplicates lost.
    const rawIds = source.records.map((r) => r.id).sort();
    const projectedIds = projected.records.map((r) => r.id).sort();
    assert.equal(projected.records.length, 39, "exactly 39 records in projection");
    assert.deepEqual(projectedIds, rawIds, "all record ids preserved and matched");
    // Per-record keep list is exactly id/type/status/domain/statement/canonical.
    for (const rec of projected.records) {
      assert.deepEqual(
        Object.keys(rec).sort(),
        ["canonical", "domain", "id", "statement", "status", "type"],
        `record ${rec.id} keeps only the six allowed fields`,
      );
    }
    // Materially smaller — assert a real byte reduction, and under the cap.
    assert.ok(projectedBytes < rawBytes, `projection must be smaller than raw (raw=${rawBytes}, projected=${projectedBytes})`);
    assert.ok(projectedBytes <= PROJECTION_MAX_BYTES, `projection must fit under PROJECTION_MAX_BYTES (projected=${projectedBytes}, cap=${PROJECTION_MAX_BYTES})`);
    // A material reduction, not a rounding artifact: at least 25% smaller.
    assert.ok(projectedBytes <= rawBytes * 0.75, `projection must be materially smaller — at least 25% reduction (raw=${rawBytes}, projected=${projectedBytes})`);
    console.log(`       [byte sizes] decision-ledger.json before=${rawBytes} after=${projectedBytes} (reduction=${rawBytes - projectedBytes} bytes, ${Math.round((1 - projectedBytes / rawBytes) * 100)}%)`);
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T29: every statement in the projection is byte-identical to its input ----
async function t29_projectDecisionLedgerStatementsVerbatim() {
  const name = "T29 projectDecisionLedger -> every statement is byte-identical to its input";
  try {
    const ledgerPath = repoPath("config/decision-ledger.json");
    const rawText = readFileSync(ledgerPath, "utf8");
    const source = JSON.parse(rawText);
    const projected = JSON.parse(projectDecisionLedger(rawText));
    const byId = new Map(projected.records.map((r) => [r.id, r]));
    assert.equal(byId.size, source.records.length, "one projected record per source record");
    for (const rec of source.records) {
      const out = byId.get(rec.id);
      assert.ok(out, `projected record present for ${rec.id}`);
      // The statement string value must be exactly equal — never reworded, summarised, or trimmed.
      assert.equal(out.statement, rec.statement, `statement for ${rec.id} must be byte-identical (verbatim)`);
      assert.equal(typeof out.statement, typeof rec.statement, `statement type for ${rec.id} preserved`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T30: malformed input comes back unchanged and nothing throws ----
async function t30_projectDecisionLedgerMalformedUnchanged() {
  const name = "T30 projectDecisionLedger -> malformed input returned unchanged, nothing throws";
  try {
    const malformed = "{not valid json,,,";
    let result;
    assert.doesNotThrow(() => { result = projectDecisionLedger(malformed); }, "projection must not throw on malformed input");
    assert.equal(result, malformed, "malformed input returned unchanged (same string, same identity)");
    // Also confirm a non-JSON string that happens to be valid text is returned as-is.
    const text = "definitely not json at all";
    let result2;
    assert.doesNotThrow(() => { result2 = projectDecisionLedger(text); }, "projection must not throw on plain text");
    assert.equal(result2, text, "plain text returned unchanged");
    // And a truncated/empty-ish payload.
    let result3;
    assert.doesNotThrow(() => { result3 = projectDecisionLedger(""); }, "projection must not throw on empty string");
    assert.equal(result3, "", "empty string returned unchanged");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- T31: SOURCE_PROJECTIONS has an entry for canonical-decision-ledger ----
async function t31_sourceProjectionsHasDecisionLedger() {
  const name = "T31 SOURCE_PROJECTIONS -> has canonical-decision-ledger entry pointing at the projection fn";
  try {
    assert.ok(SOURCE_PROJECTIONS instanceof Map, "SOURCE_PROJECTIONS is a Map");
    assert.ok(SOURCE_PROJECTIONS.has("canonical-decision-ledger"), "canonical-decision-ledger is registered");
    const fn = SOURCE_PROJECTIONS.get("canonical-decision-ledger");
    assert.equal(typeof fn, "function", "registered value is a function");
    assert.equal(fn, projectDecisionLedger, "registered function is projectDecisionLedger itself");
    // agent-registry projection must still be present and unchanged.
    assert.ok(SOURCE_PROJECTIONS.has("agent-registry"), "agent-registry projection still registered");
    assert.equal(SOURCE_PROJECTIONS.get("agent-registry"), projectAgentRegistry, "agent-registry projection unchanged");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher gbrain-curator regression tests");
  await t1_newerMtimeGetsCaptured();
  await t2_matchingMtimeSkipped();
  await t3_noPriorStateCaptured();
  await t4_missingSourceSkippedAndOthersProcessed();
  await t5_captureFailureIsolated();
  await t6_corruptStateReadWarns();
  await t7_stateWriteFailureErrors();
  await t8_enoentStateReadSilent();
  await t9_win32TimeoutUsesTaskkillTreeKill();
  await t10_nonWin32TimeoutUsesSigtermOnly();
  await t11_defaultTimeoutAtLeastFiveMinutes();
  await t12_liveLockHolderSkipsAllSources();
  await t13_staleLockAllowsCapture();
  await t14_missingLockFileAllowsCapture();
  await t15_malformedLockFileAllowsCapture();
  await t16_failureBookkeepingWritten();
  await t17_activeBackoffSkipsCapture();
  await t18_backoffClearedByMtimeChange();
  await t19_expiredBackoffAllowsCapture();
  await t20_flatLegacyStateCompatible();
  await t21_projectAgentRegistryDropsNarrative();
  await t22_projectAgentRegistryOmitsAbsentKeys();
  await t23_projectedSlugUsesTempPathAndSourceMtime();
  await t24_nonProjectedSlugUsesRealSourcePath();
  await t25_projectionTooLargeFailsBeforeCapture();
  await t26_readSourceThrowStillProcessesRemainingSources();
  await t27_invalidJsonProjectionFailsWithoutCrash();
  await t28_projectDecisionLedgerRealFile();
  await t29_projectDecisionLedgerStatementsVerbatim();
  await t30_projectDecisionLedgerMalformedUnchanged();
  await t31_sourceProjectionsHasDecisionLedger();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("gbrain-curator regression runner crashed:", err); process.exit(1); });