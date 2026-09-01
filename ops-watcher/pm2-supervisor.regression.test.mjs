// ops-watcher/pm2-supervisor.regression.test.mjs
// Offline regression coverage for the out-of-PM2 supervisor (FOS-11).
// NO real pm2, NO real network, NO real fs writes, NO real alerts.
// Fully injected. House style: node:assert/strict, local counter, no deps.
//
//   node ops-watcher/pm2-supervisor.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import {
  EXPECTED_PROCESSES,
  RESURRECT_COOLDOWN_MS,
  readPm2State,
  diagnose,
  resurrect,
  runSupervisorOnce,
  resolvePm2Entry,
} from "./pm2-supervisor.mjs";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

const NOW = 2_000_000_000;

// ---- fixtures ----
// Raw jlist shape (as pm2 actually emits): name/pid at top level, status in pm2_env.
const HEALTHY_JLIST = [
  { name: "heartbeat", pid: 111, pm2_env: { status: "online", restart_time: 2 } },
  { name: "paperclip", pid: 222, pm2_env: { status: "online", restart_time: 1 } },
  { name: "telegram-listener", pid: 333, pm2_env: { status: "online", restart_time: 0 } },
];
// heartbeat gone — critical (missing).
const MISSING_JLIST = [
  { name: "paperclip", pid: 222, pm2_env: { status: "online", restart_time: 1 } },
  { name: "telegram-listener", pid: 333, pm2_env: { status: "online", restart_time: 0 } },
];
// heartbeat present but stopped — critical (not online).
const STOPPED_JLIST = [
  { name: "heartbeat", pid: 0, pm2_env: { status: "stopped", restart_time: 3 } },
  { name: "paperclip", pid: 222, pm2_env: { status: "online", restart_time: 1 } },
  { name: "telegram-listener", pid: 333, pm2_env: { status: "online", restart_time: 0 } },
];

function jlistResult(arr) {
  return { ok: true, stdout: JSON.stringify(arr), stderr: "" };
}

// ---- fake injected filesystem for resolvePm2Entry ----
// files: { path -> string content | true }. `true` means "exists but has no
// readable content" (used for accessSync-only candidates like the JS entry).
function fakeFs(files = {}) {
  return {
    accessSync(p) {
      if (Object.prototype.hasOwnProperty.call(files, p)) return;
      const e = new Error(`ENOENT: ${p}`); e.code = "ENOENT"; throw e;
    },
    readFileSync(p) {
      const v = files[p];
      if (v !== undefined && v !== true) return v;
      const e = new Error(`ENOENT: ${p}`); e.code = "ENOENT"; throw e;
    },
  };
}

// ---- injectable runCommand helpers ----
// Canned runCommand returning a fixed result for every call.
function cannedRunCommand(result) {
  const calls = [];
  const runCommand = async (cmd, args) => {
    calls.push({ cmd, args: [...(args || [])] });
    return result;
  };
  return { runCommand, calls };
}

// Sequential runCommand returning results in order; cycles the last if exhausted.
function seqRunCommand(results) {
  let i = 0;
  const calls = [];
  const runCommand = async (cmd, args) => {
    calls.push({ cmd, args: [...(args || [])] });
    const r = results[i];
    if (i < results.length - 1) i += 1;
    return r;
  };
  return { runCommand, calls, reset() { i = 0; calls.length = 0; } };
}

// Fake resolveEntry returning a valid entry.
function fakeResolveEntry(entry = "C:\\fake\\pm2\\bin\\pm2") {
  return () => ({ ok: true, entry });
}

// Fake state store for runSupervisorOnce.
function makeDeps(overrides = {}) {
  const evidenceLines = [];
  const alertCalls = [];
  let state = JSON.parse(JSON.stringify(overrides.initialState || {}));
  const deps = {
    runCommand: overrides.runCommand || (async () => jlistResult(HEALTHY_JLIST)),
    resolveEntry: overrides.resolveEntry || fakeResolveEntry(),
    discoverPort: overrides.discoverPort || (async () => 3110),
    readState: async () => JSON.parse(JSON.stringify(state)),
    writeState: async (st) => { state = JSON.parse(JSON.stringify(st)); },
    appendEvidence: async (line) => { evidenceLines.push(line); },
    postAlert: async (msg) => { alertCalls.push(msg); return { pid: 7 }; },
    log: () => {},
    now: overrides.now || (() => NOW),
    sleep: overrides.sleep || (async () => {}),
  };
  return { deps, evidenceLines, alertCalls, getState: () => state };
}

// =====================================================================
// P1: resolvePm2Entry finds the APPDATA path when injected fs says it exists
// =====================================================================
async function testResolveAppData() {
  const name = "P1 resolvePm2Entry finds the APPDATA path when injected fs says it exists";
  try {
    const appdata = "C:\\Users\\ASUS\\AppData\\Roaming";
    const entry = path.join(appdata, "npm", "node_modules", "pm2", "bin", "pm2");
    const _fs = fakeFs({ [entry]: true });
    const r = resolvePm2Entry({ platform: "win32", env: { APPDATA: appdata, PATH: "" }, _fs });
    assert.equal(r.ok, true);
    assert.equal(r.entry, entry);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P2: resolvePm2Entry falls back to a PATH-dir node_modules/pm2/bin/pm2
// =====================================================================
async function testResolvePathDir() {
  const name = "P2 resolvePm2Entry falls back to a PATH-dir node_modules/pm2/bin/pm2";
  try {
    const dir = "C:\\some\\npm-global";
    const entry = path.join(dir, "node_modules", "pm2", "bin", "pm2");
    // APPDATA set to a non-existing dir so step 1 misses, step 2 hits.
    const _fs = fakeFs({ [entry]: true });
    const r = resolvePm2Entry({ platform: "win32", env: { APPDATA: "C:\\nonexistent", PATH: dir }, _fs });
    assert.equal(r.ok, true);
    assert.equal(r.entry, entry);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P3: resolvePm2Entry follows a pm2.cmd forwarder one level and extracts entry
// =====================================================================
async function testResolveForwarder() {
  const name = "P3 resolvePm2Entry follows a pm2.cmd forwarder one level and extracts the entry";
  try {
    const nvmDir = "C:\\nvm4w\\nodejs";
    const npmDir = "C:\\Users\\ASUS\\AppData\\Roaming\\npm";
    const forwarderPath = path.join(nvmDir, "pm2.cmd");
    const realShimPath = path.join(npmDir, "pm2.cmd");
    const realEntry = path.join(npmDir, "node_modules", "pm2", "bin", "pm2");
    const _fs = fakeFs({
      [forwarderPath]: `@echo off\r\n"${realShimPath}" %*\r\n`,
      [realShimPath]: `@SETLOCAL\r\n... & "%_prog%"  "%dp0%\\node_modules\\pm2\\bin\\pm2" %*\r\n`,
      [realEntry]: true,
    });
    // APPDATA non-existing so step 1 misses; PATH only has the forwarder dir
    // so step 2 misses; step 3 follows the forwarder.
    const r = resolvePm2Entry({ platform: "win32", env: { APPDATA: "C:\\nonexistent", PATH: nvmDir }, _fs });
    assert.equal(r.ok, true);
    assert.equal(r.entry, realEntry);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P4: resolvePm2Entry returns { ok:false, error } when nothing matches — no throw
// =====================================================================
async function testResolveNothing() {
  const name = "P4 resolvePm2Entry returns { ok:false, error } when nothing matches and does not throw";
  try {
    const _fs = fakeFs({});
    const r = resolvePm2Entry({ platform: "win32", env: { APPDATA: "C:\\x", PATH: "C:\\a;C:\\b" }, _fs });
    assert.equal(r.ok, false);
    assert.ok(typeof r.error === "string" && r.error.length > 0);
    assert.equal(r.unknown, undefined);
    assert.equal(r.reachable, undefined);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P5: readPm2State with a runner returning valid jlist JSON -> parsed, reachable:true
// =====================================================================
async function testReadStateValid() {
  const name = "P5 readPm2State valid jlist JSON -> parsed processes, reachable:true";
  try {
    const r = await readPm2State({
      resolveEntry: fakeResolveEntry(),
      runCommand: async () => jlistResult(HEALTHY_JLIST),
    });
    assert.equal(r.reachable, true);
    assert.equal(r.unknown, undefined);
    assert.equal(r.processes.length, 3);
    assert.deepEqual(r.processes.map((p) => p.name), EXPECTED_PROCESSES);
    assert.equal(r.processes[0].status, "online");
    assert.equal(r.processes[0].pid, 111);
    assert.equal(r.processes[0].restarts, 2);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P6: readPm2State with an ENOENT runner -> { unknown:true } and NOT reachable:false
// =====================================================================
async function testReadStateEnoent() {
  const name = "P6 readPm2State ENOENT runner -> { unknown:true } and NOT reachable:false";
  try {
    const r = await readPm2State({
      resolveEntry: fakeResolveEntry(),
      runCommand: async () => ({ ok: false, stdout: "", stderr: "", error: "ENOENT" }),
    });
    assert.equal(r.unknown, true);
    assert.notEqual(r.reachable, false);
    assert.deepEqual(r.processes, []);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P7: readPm2State with garbage stdout -> { unknown:true }
// =====================================================================
async function testReadStateGarbage() {
  const name = "P7 readPm2State garbage stdout -> { unknown:true }";
  try {
    const r = await readPm2State({
      resolveEntry: fakeResolveEntry(),
      runCommand: async () => ({ ok: true, stdout: "not json{{{", stderr: "" }),
    });
    assert.equal(r.unknown, true);
    assert.deepEqual(r.processes, []);
    assert.ok(r.error, "garbage -> error present");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P8: diagnose truth table (healthy / daemon-down / stopped / port-null / unknown)
// =====================================================================
async function testDiagnose() {
  const name = "P8 diagnose: healthy / daemon-down-critical / stopped-critical / port-null-warning / unknown";
  try {
    // 1. three online + port 3110 -> healthy
    const d1 = diagnose({ reachable: true, processes: HEALTHY_JLIST }, 3110);
    assert.equal(d1.healthy, true);
    assert.equal(d1.severity, null);
    assert.deepEqual(d1.missing, []);
    assert.deepEqual(d1.notOnline, []);

    // 2. daemon down (reachable:false) -> critical, all missing
    const d2 = diagnose({ reachable: false, processes: [] }, 3110);
    assert.equal(d2.healthy, false);
    assert.equal(d2.severity, "critical");
    assert.deepEqual(d2.missing, EXPECTED_PROCESSES);

    // 3. one process stopped -> critical, names the stopped process
    const d3 = diagnose({ reachable: true, processes: STOPPED_JLIST }, 3110);
    assert.equal(d3.severity, "critical");
    assert.ok(d3.notOnline.includes("heartbeat"));
    assert.ok(d3.reasons.some((r) => r.includes("heartbeat")));

    // 4. all online but port null -> warning
    const d4 = diagnose({ reachable: true, processes: HEALTHY_JLIST }, null);
    assert.equal(d4.healthy, false);
    assert.equal(d4.severity, "warning");
    assert.deepEqual(d4.missing, []);
    assert.deepEqual(d4.notOnline, []);
    assert.ok(d4.reasons.length > 0);

    // 5. unknown -> severity "unknown"
    const d5 = diagnose({ unknown: true, processes: [] }, 3110);
    assert.equal(d5.healthy, false);
    assert.equal(d5.severity, "unknown");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P9: runSupervisorOnce healthy -> no resurrect, no alert, one evidence line
// =====================================================================
async function testSupervisorHealthy() {
  const name = "P9 runSupervisorOnce healthy -> no resurrect, no alert, one evidence line";
  try {
    const { runCommand, calls } = seqRunCommand([jlistResult(HEALTHY_JLIST)]);
    const { deps, evidenceLines, alertCalls } = makeDeps({ runCommand });
    const r = await runSupervisorOnce(deps);
    assert.equal(r.outcome, "healthy");
    assert.equal(alertCalls.length, 0);
    assert.equal(evidenceLines.length, 1);
    const ev = JSON.parse(evidenceLines[0]);
    assert.equal(ev.outcome, "healthy");
    // No resurrect/save calls: only one jlist call.
    assert.equal(calls.filter((c) => c.args[1] === "jlist").length, 1);
    assert.equal(calls.filter((c) => c.args[1] === "resurrect").length, 0);
    assert.equal(calls.filter((c) => c.args[1] === "save").length, 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P10: critical outside cooldown -> resurrect once; recovered on re-read -> no alert
// =====================================================================
async function testSupervisorCriticalRecovered() {
  const name = "P10 runSupervisorOnce critical outside cooldown -> resurrect once; recovered; NO alert";
  try {
    const { runCommand, calls } = seqRunCommand([
      jlistResult(MISSING_JLIST),                          // initial read: critical (heartbeat missing)
      { ok: true, stdout: "resurrected", stderr: "" },    // pm2 resurrect
      { ok: true, stdout: "saved", stderr: "" },           // pm2 save
      jlistResult(HEALTHY_JLIST),                          // re-read: recovered
    ]);
    const { deps, evidenceLines, alertCalls } = makeDeps({ runCommand, initialState: { lastResurrectAt: 0 } });
    const r = await runSupervisorOnce(deps);
    assert.equal(r.outcome, "recovered");
    assert.equal(alertCalls.length, 0);
    assert.equal(evidenceLines.length, 1);
    const resurrectCalls = calls.filter((c) => c.args[1] === "resurrect");
    const saveCalls = calls.filter((c) => c.args[1] === "save");
    assert.equal(resurrectCalls.length, 1);
    assert.equal(saveCalls.length, 1);
    // order: resurrect before save
    const idxRes = calls.findIndex((c) => c.args[1] === "resurrect");
    const idxSave = calls.findIndex((c) => c.args[1] === "save");
    assert.ok(idxRes < idxSave);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P11: critical, still broken after resurrect -> outcome unrecovered, one Indonesian alert
// =====================================================================
async function testSupervisorCriticalUnrecovered() {
  const name = "P11 runSupervisorOnce critical still broken after resurrect -> unrecovered, exactly ONE Indonesian alert";
  try {
    const { runCommand, calls } = seqRunCommand([
      jlistResult(MISSING_JLIST),                          // initial read: critical
      { ok: true, stdout: "resurrected", stderr: "" },    // pm2 resurrect
      { ok: true, stdout: "saved", stderr: "" },           // pm2 save
      jlistResult(MISSING_JLIST),                          // re-read: still critical
    ]);
    const { deps, evidenceLines, alertCalls } = makeDeps({ runCommand, initialState: { lastResurrectAt: 0 } });
    const r = await runSupervisorOnce(deps);
    assert.equal(r.outcome, "unrecovered");
    assert.equal(alertCalls.length, 1);
    assert.ok(/PERINGATAN/.test(alertCalls[0]), "alert has Indonesian PERINGATAN header");
    assert.ok(/tidak/.test(alertCalls[0]), "alert body is Indonesian");
    assert.equal(evidenceLines.length, 1);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P12: critical inside RESURRECT_COOLDOWN_MS -> resurrect NOT called
// =====================================================================
async function testSupervisorCriticalInsideCooldown() {
  const name = "P12 runSupervisorOnce critical inside RESURRECT_COOLDOWN_MS -> resurrect NOT called";
  try {
    const { runCommand, calls } = seqRunCommand([jlistResult(MISSING_JLIST)]);
    const { deps, evidenceLines, alertCalls } = makeDeps({
      runCommand,
      initialState: { lastResurrectAt: NOW - 5000 },  // 5s ago, well under cooldown
    });
    const r = await runSupervisorOnce(deps);
    assert.equal(r.outcome, "cooldown");
    assert.equal(alertCalls.length, 0);
    assert.equal(evidenceLines.length, 1);
    assert.equal(calls.filter((c) => c.args[1] === "jlist").length, 1);
    assert.equal(calls.filter((c) => c.args[1] === "resurrect").length, 0);
    assert.equal(calls.filter((c) => c.args[1] === "save").length, 0);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P13: unknown state -> resurrect NEVER called
// =====================================================================
async function testSupervisorUnknownNoResurrect() {
  const name = "P13 runSupervisorOnce unknown state -> resurrect NEVER called";
  try {
    // runCommand returns ENOENT for jlist -> readPm2State unknown -> diagnose unknown.
    const { runCommand, calls } = seqRunCommand([
      { ok: false, stdout: "", stderr: "", error: "ENOENT" },
    ]);
    const { deps, evidenceLines, alertCalls } = makeDeps({ runCommand, initialState: { lastResurrectAt: 0 } });
    const r = await runSupervisorOnce(deps);
    assert.equal(r.outcome, "unknown");
    assert.equal(calls.filter((c) => c.args[1] === "resurrect").length, 0);
    assert.equal(calls.filter((c) => c.args[1] === "save").length, 0);
    assert.equal(evidenceLines.length, 1);
    // At most one alert (cooldown-limited). lastResurrectAt is 0 so alert cooldown
    // starts at 0 -> first alert eligible. We allow 0 or 1 alert here; the key
    // invariant is NO resurrect.
    assert.ok(alertCalls.length <= 1);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// P14: resurrect issues exactly `pm2 resurrect` then `pm2 save`, in that order
// =====================================================================
async function testResurrectOnlyResurrectThenSave() {
  const name = "P14 resurrect issues exactly pm2 resurrect then pm2 save, in that order, and nothing else";
  try {
    const { runCommand, calls } = cannedRunCommand({ ok: true, stdout: "", stderr: "" });
    const entry = "C:\\fake\\pm2\\bin\\pm2";
    await resurrect({ runCommand, resolveEntry: fakeResolveEntry(entry) });
    assert.equal(calls.length, 2, "exactly two commands, nothing else");
    assert.equal(calls[0].args[0], entry);
    assert.equal(calls[0].args[1], "resurrect");
    assert.equal(calls[1].args[0], entry);
    assert.equal(calls[1].args[1], "save");
    ok(name);
  } catch (err) { bad(name, err); }
}

// ---- main ----
async function main() {
  console.log("# ops-watcher pm2-supervisor regression tests");
  const tests = [
    testResolveAppData,
    testResolvePathDir,
    testResolveForwarder,
    testResolveNothing,
    testReadStateValid,
    testReadStateEnoent,
    testReadStateGarbage,
    testDiagnose,
    testSupervisorHealthy,
    testSupervisorCriticalRecovered,
    testSupervisorCriticalUnrecovered,
    testSupervisorCriticalInsideCooldown,
    testSupervisorUnknownNoResurrect,
    testResurrectOnlyResurrectThenSave,
  ];
  for (const t of tests) {
    try { await t(); }
    catch (err) { bad(t.name, err); }
  }
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => { console.error("pm2-supervisor regression runner crashed:", err); process.exit(1); });