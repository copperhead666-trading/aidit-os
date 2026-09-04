// ops-watcher/graphify-refresh.regression.test.mjs
// Offline regression coverage for graphify refresh and promotion. NO real
// graphify, NO real filesystem writes, NO real git: every actuator is injected.
// Run with:
//   node ops-watcher/graphify-refresh.regression.test.mjs

import assert from "node:assert/strict";
import {
  ACTIVE_GRAPH,
  BUILD_TIMEOUT_MS,
  BUILT_GRAPH,
  MIN_REFRESH_INTERVAL_MS,
  STATE_FILE,
  refreshOnce,
  repoFingerprint,
  shouldRefresh,
} from "./graphify-refresh.mjs";

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

const NOW = Date.parse("2026-09-04T01:00:00.000Z");
const ACTIVE = "mem:/graphify-out/active/graph.json";
const BUILT = "mem:/graphify-out/graph.json";
const STATE = "mem:/ops-watcher/graphify-refresh-state.json";
const TMP = `${ACTIVE}.incoming`;
const INTERVAL = 1000;

function graph(nodes) {
  return JSON.stringify({ nodes: Array.from({ length: nodes }, (_, i) => ({ id: `n${i}` })), links: [] });
}

function state(fingerprint, nodes = 1) {
  return JSON.stringify({ fingerprint, refreshedAt: new Date(NOW - 10_000).toISOString(), nodes });
}

function fakeFs(over = {}) {
  const files = new Map(Object.entries(over.files || {}));
  const mtimes = new Map(Object.entries(over.mtimes || {}));
  const calls = [];
  const fail = over.fail || {};

  const api = {
    calls,
    files,
    async stat(file) {
      calls.push({ op: "stat", file });
      if (fail.stat) throw fail.stat;
      if (!files.has(file) && !mtimes.has(file)) throw new Error(`ENOENT: ${file}`);
      return { mtimeMs: mtimes.has(file) ? mtimes.get(file) : NOW };
    },
    async readFile(file, encoding) {
      calls.push({ op: "readFile", file, encoding });
      if (fail.readFile && (fail.readFile === true || fail.readFile === file)) throw new Error(`read failed: ${file}`);
      if (!files.has(file)) throw new Error(`ENOENT: ${file}`);
      return files.get(file);
    },
    async copyFile(from, to) {
      calls.push({ op: "copyFile", from, to });
      if (fail.copyFile) throw fail.copyFile;
      if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
      files.set(to, files.get(from));
    },
    async rename(from, to) {
      calls.push({ op: "rename", from, to });
      if (fail.rename) throw fail.rename;
      if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
      files.set(to, files.get(from));
      files.delete(from);
    },
    async writeFile(file, content, encoding) {
      calls.push({ op: "writeFile", file, content, encoding });
      if (fail.writeFile) throw fail.writeFile;
      files.set(file, content);
    },
    async unlink(file) {
      calls.push({ op: "unlink", file });
      if (fail.unlink) throw fail.unlink;
      files.delete(file);
    },
  };
  return api;
}

function spawnHarness(results = [{ status: 0, stdout: "", stderr: "" }]) {
  const calls = [];
  const queue = Array.isArray(results) ? [...results] : [results];
  const spawnSync = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (queue.length === 0) throw new Error(`unexpected spawn: ${cmd}`);
    return queue.shift();
  };
  return { calls, spawnSync };
}

function gitSpawn({ head = "abc123", status = "" } = {}) {
  const calls = [];
  const spawnSync = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    assert.equal(cmd, "git", "fake git spawn only receives git");
    if (args.join(" ") === "rev-parse HEAD") return { status: 0, stdout: `${head}\n`, stderr: "" };
    if (args.join(" ") === "status --porcelain") return { status: 0, stdout: status, stderr: "" };
    throw new Error(`unexpected git args: ${args.join(" ")}`);
  };
  return { calls, spawnSync };
}

function deps(fs, over = {}) {
  return {
    _fs: fs,
    now: () => NOW,
    log: () => {},
    activeGraph: ACTIVE,
    builtGraph: BUILT,
    stateFile: STATE,
    minIntervalMs: INTERVAL,
    timeoutMs: 777,
    ...over,
  };
}

function opNames(fs) {
  return fs.calls.map((c) => c.op);
}

function opSlice(fs, names) {
  return fs.calls.filter((c) => names.includes(c.op));
}

async function t1_shouldRefreshNoGraphOnDisk() {
  const fs = fakeFs();
  const h = spawnHarness();

  const result = await shouldRefresh(deps(fs, { spawnSync: h.spawnSync, fingerprint: "ignored" }));

  assert.equal(result.refresh, true, "T1: missing active graph forces refresh");
  assert.match(result.reason, /no graph/i, "T1: reason names missing graph");
  assert.equal(h.calls.length, 0, "T1: missing graph does not need git");
  ok("T1: no graph on disk forces refresh and names the reason");
}

async function t2_shouldRefreshYoungGraphBeatsFingerprintMove() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(2), [STATE]: state("old") },
    mtimes: { [ACTIVE]: NOW - 100 },
  });
  const h = spawnHarness();

  const result = await shouldRefresh(deps(fs, { spawnSync: h.spawnSync, fingerprint: "new" }));

  assert.equal(result.refresh, false, "T2: young graph skips refresh");
  assert.match(result.reason, /under the interval/i, "T2: reason names interval");
  assert.equal(result.ageMs, 100, "T2: age is surfaced");
  assert.equal(h.calls.length, 0, "T2: young graph skips repo fingerprint work");
  ok("T2: younger-than-interval graph skips even when the fingerprint moved");
}

async function t3_shouldRefreshOldGraphUnchangedRepoIsNotStale() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(2), [STATE]: state("same") },
    mtimes: { [ACTIVE]: NOW - 5000 },
  });

  const result = await shouldRefresh(deps(fs, { fingerprint: "same" }));

  assert.equal(result.refresh, false, "T3: unchanged repo skips refresh");
  assert.match(result.reason, /repo unchanged/i, "T3: reason names unchanged repo");
  assert.equal(/stale/i.test(result.reason), false, "T3: unchanged repo is not called stale");
  assert.equal(result.fingerprint, "same", "T3: fingerprint is surfaced");
  ok("T3: old graph with unchanged repo skips without calling it stale");
}

async function t4_shouldRefreshOldGraphMovedRepo() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(2), [STATE]: state("old") },
    mtimes: { [ACTIVE]: NOW - 5000 },
  });

  const result = await shouldRefresh(deps(fs, { fingerprint: "new" }));

  assert.equal(result.refresh, true, "T4: old graph and moved repo refresh");
  assert.match(result.reason, /repo moved/i, "T4: reason names moved repo");
  assert.equal(result.fingerprint, "new", "T4: current fingerprint is surfaced");
  ok("T4: old graph with moved repo refreshes");
}

async function t5_refreshOnceForceSkipsDecisionAndRebuilds() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(1), [BUILT]: graph(3) },
    fail: { stat: new Error("decision stat should not run") },
  });
  const h = spawnHarness({ status: 0, stdout: "built", stderr: "" });

  const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, force: true, fingerprint: "force-fp" }));

  assert.equal(result.ok, true, "T5: forced refresh succeeds");
  assert.equal(result.refreshed, true, "T5: forced refresh rebuilds");
  assert.equal(result.nodes, 3, "T5: forced refresh promotes the rebuilt graph");
  assert.equal(opNames(fs).includes("stat"), false, "T5: force skips the shouldRefresh stat decision");
  assert.deepEqual(h.calls.map((c) => [c.cmd, c.args]), [["graphify", ["update", ".", "--no-cluster"]]], "T5: graphify update is spawned once");
  ok("T5: force:true skips the decision and rebuilds");
}

async function t6_buildFailuresNeverPromote() {
  for (const [label, spawnResult, expected] of [
    ["non-zero", { status: 7, stdout: "", stderr: "bad" }, /exit 7/],
    ["error-object", { status: null, stdout: "", stderr: "", error: new Error("spawn failed") }, /spawn failed/],
  ]) {
    const fs = fakeFs({
      files: { [ACTIVE]: graph(9), [STATE]: state("old") },
      mtimes: { [ACTIVE]: NOW - 5000 },
    });
    const h = spawnHarness(spawnResult);

    const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, fingerprint: `moved-${label}` }));

    assert.equal(result.ok, false, `T6 ${label}: result is red`);
    assert.equal(result.refreshed, false, `T6 ${label}: result is not refreshed`);
    assert.match(result.reason, expected, `T6 ${label}: reason surfaces build failure`);
    assert.equal(opNames(fs).includes("copyFile"), false, `T6 ${label}: active graph is not copied over`);
    assert.equal(opNames(fs).includes("rename"), false, `T6 ${label}: active graph is not renamed over`);
  }
  ok("T6: build exit failure and spawn error never promote");
}

async function t7_successfulBuildWithUnusableGraphIsNotPromoted() {
  for (const [label, builtContent] of [
    ["unreadable", "{not json"],
    ["empty-nodes", JSON.stringify({ nodes: [], links: [] })],
  ]) {
    const fs = fakeFs({
      files: { [ACTIVE]: graph(4), [BUILT]: builtContent, [STATE]: state("old") },
      mtimes: { [ACTIVE]: NOW - 5000 },
    });
    const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });

    const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, fingerprint: `moved-${label}` }));

    assert.equal(result.ok, false, `T7 ${label}: result is red`);
    assert.equal(result.refreshed, false, `T7 ${label}: result is not refreshed`);
    assert.equal(result.reason, "rebuilt graph unusable", `T7 ${label}: reason names unusable graph`);
    assert.equal(opNames(fs).includes("copyFile"), false, `T7 ${label}: unusable graph is not copied`);
    assert.equal(opNames(fs).includes("rename"), false, `T7 ${label}: unusable graph is not renamed`);
  }
  ok("T7: unreadable and empty rebuilt graphs are not promoted");
}

async function t8_happyPathPromotesByCopyThenRenameAndWritesState() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(2), [BUILT]: graph(5), [STATE]: state("old") },
    mtimes: { [ACTIVE]: NOW - 5000 },
  });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });

  const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, fingerprint: "fresh-fp" }));

  assert.equal(result.ok, true, "T8: happy path is green");
  assert.equal(result.refreshed, true, "T8: happy path reports refreshed");
  assert.equal(result.nodes, 5, "T8: node count comes from the rebuilt graph");
  assert.equal(result.priorNodes, 2, "T8: prior node count comes from the active graph");
  assert.deepEqual(
    opSlice(fs, ["copyFile", "rename"]).map((c) => c.op),
    ["copyFile", "rename"],
    "T8: promotion is copyFile then rename",
  );
  assert.deepEqual(fs.calls.find((c) => c.op === "copyFile"), { op: "copyFile", from: BUILT, to: TMP }, "T8: copy writes the incoming temp path");
  assert.deepEqual(fs.calls.find((c) => c.op === "rename"), { op: "rename", from: TMP, to: ACTIVE }, "T8: rename promotes the incoming temp path");
  const write = fs.calls.find((c) => c.op === "writeFile" && c.file === STATE);
  assert.ok(write, "T8: state file is written");
  assert.equal(write.encoding, "utf8", "T8: state file is written as utf8");
  const written = JSON.parse(write.content);
  assert.equal(written.fingerprint, "fresh-fp", "T8: state records the fingerprint");
  assert.equal(written.nodes, 5, "T8: state records the node count");
  assert.equal(fs.files.get(ACTIVE), graph(5), "T8: active graph receives the built graph after rename");
  ok("T8: happy path copyFiles to .incoming, renames, and records state");
}

async function t9_promotionFailureCleansIncomingFile() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(2), [BUILT]: graph(5), [STATE]: state("old") },
    mtimes: { [ACTIVE]: NOW - 5000 },
    fail: { rename: new Error("rename denied") },
  });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });

  const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, fingerprint: "fresh-fp" }));

  assert.equal(result.ok, false, "T9: promotion failure is red");
  assert.equal(result.refreshed, false, "T9: promotion failure is not refreshed");
  assert.equal(result.reason, "promotion-failed", "T9: promotion failure reason is returned");
  assert.deepEqual(opSlice(fs, ["copyFile", "rename", "unlink"]).map((c) => c.op), ["copyFile", "rename", "unlink"], "T9: failed promotion cleans temp after failed rename");
  assert.equal(fs.files.has(TMP), false, "T9: incoming temp is removed");
  assert.equal(fs.files.get(ACTIVE), graph(2), "T9: existing active graph remains in place");
  ok("T9: rename failure returns red and cleans the incoming temp file");
}

async function t10_stateWriteFailureDoesNotFailRun() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(1), [BUILT]: graph(4), [STATE]: state("old") },
    mtimes: { [ACTIVE]: NOW - 5000 },
    fail: { writeFile: new Error("state disk full") },
  });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });

  const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, fingerprint: "fresh-fp" }));

  assert.equal(result.ok, true, "T10: state write failure still returns green");
  assert.equal(result.refreshed, true, "T10: graph is still refreshed");
  assert.deepEqual(opSlice(fs, ["copyFile", "rename", "writeFile"]).map((c) => c.op), ["copyFile", "rename", "writeFile"], "T10: state write happens after promotion");
  assert.equal(fs.files.get(ACTIVE), graph(4), "T10: active graph is promoted despite state write failure");
  ok("T10: state-file write failure does not fail a correct promotion");
}

async function t11_repoFingerprintIncludesPorcelainStatus() {
  const clean = gitSpawn({ head: "same-head", status: "" });
  const dirty = gitSpawn({ head: "same-head", status: " M ops-watcher/graphify-refresh.mjs\n?? scratch.txt\n" });

  const cleanFp = repoFingerprint({ spawnSync: clean.spawnSync });
  const dirtyFp = repoFingerprint({ spawnSync: dirty.spawnSync });

  assert.notEqual(cleanFp, dirtyFp, "T11: porcelain changes move the fingerprint even with the same HEAD");
  assert.equal(cleanFp.startsWith("same-head:"), true, "T11: HEAD is included");
  assert.equal(dirtyFp.startsWith("same-head:"), true, "T11: identical HEAD remains visible");
  assert.deepEqual(clean.calls.map((c) => c.args), [["rev-parse", "HEAD"], ["status", "--porcelain"]], "T11: clean fingerprint reads HEAD then status");
  assert.deepEqual(dirty.calls.map((c) => c.args), [["rev-parse", "HEAD"], ["status", "--porcelain"]], "T11: dirty fingerprint reads HEAD then status");
  for (const call of [...clean.calls, ...dirty.calls]) {
    assert.equal(call.options.shell, false, "T11: git spawn uses shell:false");
    assert.equal(call.options.windowsHide, true, "T11: git spawn hides Windows consoles");
  }
  ok("T11: repoFingerprint changes when porcelain status changes under the same HEAD");
}

async function main() {
  assert.ok(BUILT_GRAPH, "exported BUILT_GRAPH exists");
  assert.ok(ACTIVE_GRAPH, "exported ACTIVE_GRAPH exists");
  assert.ok(STATE_FILE, "exported STATE_FILE exists");
  assert.equal(typeof MIN_REFRESH_INTERVAL_MS, "number", "exported MIN_REFRESH_INTERVAL_MS is numeric");
  assert.equal(typeof BUILD_TIMEOUT_MS, "number", "exported BUILD_TIMEOUT_MS is numeric");

  const tests = [
    t1_shouldRefreshNoGraphOnDisk,
    t2_shouldRefreshYoungGraphBeatsFingerprintMove,
    t3_shouldRefreshOldGraphUnchangedRepoIsNotStale,
    t4_shouldRefreshOldGraphMovedRepo,
    t5_refreshOnceForceSkipsDecisionAndRebuilds,
    t6_buildFailuresNeverPromote,
    t7_successfulBuildWithUnusableGraphIsNotPromoted,
    t8_happyPathPromotesByCopyThenRenameAndWritesState,
    t9_promotionFailureCleansIncomingFile,
    t10_stateWriteFailureDoesNotFailRun,
    t11_repoFingerprintIncludesPorcelainStatus,
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
