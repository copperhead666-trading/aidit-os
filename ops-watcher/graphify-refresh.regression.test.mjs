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
  CONTENT_CHECK_SAMPLE,
  MIN_REFRESH_INTERVAL_MS,
  STATE_FILE,
  VENTURE_REFRESH_MIN_INTERVAL_MS,
  contentCheckCandidates,
  refreshVentureGraphsIfStale,
  refreshVentureGraph,
  ventureGraphPath,
  ventureGraphStampPath,
  refreshOnce,
  repoFingerprint,
  shouldRefresh,
  verifyGraphContent,
} from "./graphify-refresh.mjs";
import { graphFreshnessForAnchors } from "./directive-runner.mjs";

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

function parentDir(file) {
  const ix = file.lastIndexOf("/");
  return ix === -1 ? "." : file.slice(0, ix);
}

// The fixture tree the fake graphs describe. refreshOnce now reads the working
// tree back to confirm the promoted graph matches it, so a graph that points at
// nothing is correctly refused — which means the fixtures have to point at
// something real, exactly as the production graph does.
const SRC_REL = "src/fixture.mjs";
const SRC_ABS = "mem:/src/fixture.mjs";
const SRC_ROOT = "mem:";
const SRC_TEXT = [
  "import path from 'node:path';",
  "const HEADER = 1;",
  "",
  "export function shallowSymbol() { return HEADER; }",
  "",
  "export function deepSymbol() { return path; }",
].join("\n");
const DEEP_LINE = 6; // deepSymbol sits on line 6 of SRC_TEXT.

function graph(nodes) {
  const list = Array.from({ length: nodes }, (_, i) => ({ id: `n${i}` }));
  // The DEEPEST located symbol is the one the content check samples, so the
  // fixture has to carry one. Everything above it is filler, as in a real graph.
  list[list.length - 1] = {
    id: `n${nodes - 1}`,
    label: "deepSymbol()",
    source_file: SRC_REL,
    source_location: `L${DEEP_LINE}`,
  };
  return JSON.stringify({ nodes: list, links: [] });
}

function state(fingerprint, nodes = 1) {
  return JSON.stringify({ fingerprint, refreshedAt: new Date(NOW - 10_000).toISOString(), nodes });
}

function fakeFs(over = {}) {
  const files = new Map(Object.entries({ [SRC_ABS]: SRC_TEXT, ...(over.files || {}) }));
  const mtimes = new Map(Object.entries(over.mtimes || {}));
  const dirs = new Set(over.dirs || []);
  for (const file of files.keys()) dirs.add(parentDir(file));
  const calls = [];
  const fail = over.fail || {};

  const api = {
    calls,
    dirs,
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
    async mkdir(file, options) {
      calls.push({ op: "mkdir", file, options });
      if (fail.mkdir) throw fail.mkdir;
      dirs.add(file);
    },
    async copyFile(from, to) {
      calls.push({ op: "copyFile", from, to });
      if (fail.copyFile) throw fail.copyFile;
      if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
      if (!dirs.has(parentDir(to))) throw new Error(`ENOENT: no such file or directory, copyfile '${from}' -> '${to}'`);
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
      if (fail.writeFile && (fail.writeFile === true || fail.writeFile === file)) throw fail.writeFile;
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
    sourceRoot: SRC_ROOT,
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
  assert.deepEqual(opSlice(fs, ["copyFile", "rename", "writeFile"]).map((c) => c.op), ["copyFile", "rename", "writeFile", "writeFile"], "T10: stamp and state writes both happen after promotion");
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

async function t12_freshClonePromotionCreatesMissingActiveDirectory() {
  const fs = fakeFs({
    files: { [BUILT]: graph(5) },
  });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });

  const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, fingerprint: "fresh-clone-fp" }));

  assert.equal(result.ok, true, "T12: fresh clone promotion succeeds");
  assert.equal(result.refreshed, true, "T12: fresh clone reports refreshed");
  assert.equal(result.nodes, 5, "T12: fresh clone promotes the rebuilt graph");
  assert.equal(result.priorNodes, 0, "T12: missing prior active graph counts as zero prior nodes");
  assert.deepEqual(
    opSlice(fs, ["mkdir", "copyFile", "rename"]).map((c) => c.op),
    ["mkdir", "copyFile", "rename"],
    "T12: promotion creates the active directory before copyFile and rename",
  );
  assert.deepEqual(fs.calls.find((c) => c.op === "mkdir"), { op: "mkdir", file: parentDir(ACTIVE), options: { recursive: true } }, "T12: mkdir targets active graph parent recursively");
  assert.equal(fs.files.get(ACTIVE), graph(5), "T12: active graph receives the built graph after directory creation");
  ok("T12: fresh clone promotion creates graphify-out/active before copying incoming graph");
}

async function t13_successfulPromotionStampsActiveGraphWithCommitOnly() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(2), [BUILT]: graph(5), [STATE]: state("old") },
    mtimes: { [ACTIVE]: NOW - 5000 },
  });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });
  const STAMP = `${ACTIVE}.commit.stamp`;

  const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, fingerprint: "abc123:87:12" }));

  assert.equal(result.ok, true, "T13: stamped promotion is green");
  assert.equal(result.refreshed, true, "T13: stamped promotion reports refreshed");
  const stamp = fs.calls.find((c) => c.op === "writeFile" && c.file === STAMP);
  assert.ok(stamp, "T13: stamp file is written next to the active graph");
  assert.equal(stamp.content, "abc123", "T13: stamp holds the commit only, not the dirty marker");
  assert.equal(stamp.encoding, "utf8", "T13: stamp is written as utf8");
  const order = opSlice(fs, ["rename", "writeFile"]).map((c) => c.op);
  assert.deepEqual(order, ["rename", "writeFile", "writeFile"], "T13: promotion lands before the stamp, stamp before state");
  ok("T13: promotion stamps the active graph with the bare commit after the rename");
}

async function t14_stampWriteFailureDoesNotFailPromotion() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(2), [BUILT]: graph(5), [STATE]: state("old") },
    mtimes: { [ACTIVE]: NOW - 5000 },
    fail: { writeFile: `${ACTIVE}.commit.stamp` },
  });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });
  const logs = [];

  const result = await refreshOnce(deps(fs, { spawnSync: h.spawnSync, fingerprint: "abc123:0:0", log: (m) => logs.push(m) }));

  assert.equal(result.ok, true, "T14: stamp write failure still returns green");
  assert.equal(result.refreshed, true, "T14: graph is still refreshed");
  assert.equal(fs.files.get(ACTIVE), graph(5), "T14: active graph is promoted despite stamp write failure");
  const stateWrite = fs.calls.find((c) => c.op === "writeFile" && c.file === STATE);
  assert.ok(stateWrite, "T14: state file is still written after the stamp failure");
  assert.ok(logs.some((m) => /stamp write failed/i.test(m)), "T14: the stamp failure is logged");
  ok("T14: stamp-file write failure is logged and does not fail a correct promotion");
}

// =====================================================================
// THE STAMP MUST NAME THE COMMIT THE BUILD SAW, AND THE CONTENT MUST BE
// CHECKED AGAINST THE TREE.
//
// Measured at f22349d with the stamp matching HEAD, the tree clean, and the
// guard reporting FRESH:
//
//     symbol                        graph   actual   off by
//     buildExecutionPrompt()        L1716   L1858     +142
//     graphFreshnessForAnchors()    L1610   L1693      +83
//     activeGraphAnchorsForFiles()  L1641   L1724      +83
//
// The old guard compared the STAMP against HEAD and never the CONTENT against
// the file, so all three existing stamp mutations (make it stale, remove it,
// treat it as fresh) stayed green while every anchor the system emitted was
// wrong. T15 is the mutation none of them could see: the build finishes, a
// commit lands, and the graph must NOT be certified.
// =====================================================================

async function t15_commitLandingDuringTheBuildIsNotStampedAsFresh() {
  const fs = fakeFs({
    files: { [ACTIVE]: graph(2), [BUILT]: graph(6), [STATE]: state("old") },
    mtimes: { [ACTIVE]: NOW - 5000 },
  });
  const STAMP = `${ACTIVE}.commit.stamp`;

  // HEAD moves WHILE graphify runs — the ~87s rebuild measured on this repo is
  // longer than the 100s between two real commits on 2026-09-04.
  let head = "buildstart";
  const spawnSync = (cmd, args) => {
    if (cmd === "git") {
      if (args.join(" ") === "rev-parse HEAD") return { status: 0, stdout: `${head}\n`, stderr: "" };
      if (args.join(" ") === "status --porcelain") return { status: 0, stdout: "", stderr: "" };
      throw new Error(`unexpected git args: ${args.join(" ")}`);
    }
    assert.equal(cmd, "graphify", "T15: only git and graphify are spawned");
    head = "committed-during-build";
    return { status: 0, stdout: "ok", stderr: "" };
  };

  const result = await refreshOnce(deps(fs, { spawnSync, force: true }));

  assert.equal(result.ok, true, "T15: the build itself succeeded");
  assert.equal(result.refreshed, true, "T15: the graph is still promoted — it is the best available");

  const stamp = fs.files.get(STAMP);
  assert.equal(stamp, "buildstart", "T15: the stamp names the commit the build STARTED at, not the one that landed during it");
  assert.notEqual(stamp, head, "T15: the stamp must not name a commit the graph never saw");

  // End to end: this is the consumer that decides whether anchors are emitted.
  const freshness = graphFreshnessForAnchors({
    readText: () => stamp,
    stampFile: STAMP,
    repoCommit: head,
  });
  assert.equal(freshness.fresh, false, "T15: the anchor guard must REFUSE — anchors are not emitted");
  assert.match(freshness.reason, /buildstart/, "T15: the refusal names the graph's commit");

  // And the next sweep must try again rather than calling the repo unchanged.
  const stateWrite = fs.calls.find((c) => c.op === "writeFile" && c.file === STATE);
  assert.ok(stateWrite, "T15: state is recorded");
  assert.equal(
    JSON.parse(stateWrite.content).fingerprint.startsWith("buildstart:"),
    true,
    "T15: state records the PRE-build fingerprint so the moved repo triggers the next rebuild",
  );
  ok("T15: a commit landing during the build is stamped as the old commit and the anchor guard refuses");
}

async function t16_contentCheckSamplesTheDeepestSymbolPerFile() {
  const g = {
    nodes: [
      { label: "topConst", source_file: "a.mjs", source_location: "L2" },
      { label: "deepFn()", source_file: "a.mjs", source_location: "L400" },
      { label: "midFn()", source_file: "a.mjs", source_location: "L90" },
      { label: "otherDeep()", source_file: "b.mjs", source_location: "L50" },
      { label: "a.mjs", source_file: "a.mjs", source_location: "L1" },
      { label: "obj.member", source_file: "a.mjs", source_location: "L410" },
      { label: "noLocation", source_file: "a.mjs" },
    ],
  };

  const picked = contentCheckCandidates(g);

  assert.deepEqual(
    picked.map((c) => `${c.file}:${c.line}:${c.label}`),
    ["a.mjs:400:deepFn", "b.mjs:50:otherDeep"],
    "T16: one candidate per file, the deepest, deepest file first, () stripped",
  );
  assert.equal(picked.some((c) => c.label.includes(".")), false, "T16: member expressions are not line-anchorable and are excluded");
  assert.equal(contentCheckCandidates(g, 1).length, 1, "T16: the sample honours its limit");
  assert.equal(contentCheckCandidates({ nodes: [] }).length, 0, "T16: an empty graph yields no candidates");
  assert.equal(typeof CONTENT_CHECK_SAMPLE, "number", "T16: the sample size is exported");
  ok("T16: the content check samples the deepest symbol per file, where drift accumulates");
}

async function t17_contentCheckDistinguishesDriftFromExtractorGaps() {
  const text = ["const a = 1;", "", "export function deepSymbol() {}"].join("\n");
  const readFile = async (file) => {
    if (file === "mem:/src/fixture.mjs") return text;
    throw new Error(`ENOENT: ${file}`);
  };
  const node = (line, label = "deepSymbol()") => ({
    nodes: [{ label, source_file: SRC_REL, source_location: `L${line}` }],
  });
  const run = (graphObj) => verifyGraphContent(graphObj, { _fs: { readFile }, sourceRoot: SRC_ROOT });

  const right = await run(node(3));
  assert.equal(right.verified, true, "T17: a symbol on its stated line verifies");
  assert.equal(right.checked, 1, "T17: it counts as checked");

  const drifted = await run(node(1));
  assert.equal(drifted.verified, false, "T17: a symbol that moved is DRIFT and is refused");
  assert.deepEqual(drifted.mismatches, ["src/fixture.mjs:1 deepSymbol"], "T17: the mismatch names file, line and symbol");

  const pastEnd = await run(node(999));
  assert.equal(pastEnd.verified, false, "T17: a line beyond the end of the file is refused");
  assert.match(pastEnd.mismatches[0], /file has 3 lines/, "T17: the mismatch says how long the file actually is");

  // An extractor that names something absent from the file is a GAP, not drift.
  // Counting it against the graph would refuse every fresh build.
  const absent = await run(node(3, "symbolTheExtractorInvented()"));
  assert.equal(absent.checked, 0, "T17: a symbol that appears nowhere in the file is skipped, not counted");
  assert.equal(absent.skipped, 1, "T17: and it is reported as skipped");
  assert.equal(absent.verified, false, "T17: with nothing checked there is no evidence, so it is not certified");
  assert.match(absent.reason, /no locatable symbols/i, "T17: the reason says there was nothing to check");

  const missingFile = await verifyGraphContent(node(3), { _fs: { readFile }, sourceRoot: "mem:/elsewhere" });
  assert.equal(missingFile.verified, false, "T17: an unreadable source file leaves nothing checked");
  assert.equal(missingFile.skipped, 1, "T17: the unreadable file is skipped");
  ok("T17: the content check separates real drift from extractor gaps and never certifies on zero evidence");
}

async function t18_aGraphThatFailsTheContentCheckLosesItsStamp() {
  const STAMP = `${ACTIVE}.commit.stamp`;
  const fs = fakeFs({
    // A stamp from an EARLIER run is already sitting there. Merely skipping the
    // write would leave it certifying this new graph.
    files: { [ACTIVE]: graph(2), [BUILT]: graph(4), [STATE]: state("old"), [STAMP]: "earlier-commit" },
    mtimes: { [ACTIVE]: NOW - 5000 },
  });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });
  const logs = [];

  const result = await refreshOnce(deps(fs, {
    spawnSync: h.spawnSync,
    fingerprint: "newhead:0:0",
    log: (m) => logs.push(m),
    // The promoted graph does not describe the tree.
    verifyContent: async () => ({ verified: false, checked: 3, skipped: 0, mismatches: ["src/fixture.mjs:6 deepSymbol"], reason: "1/3 sampled symbols are not where the graph says" }),
  }));

  assert.equal(result.ok, false, "T18: a graph that fails the content check is a failed refresh");
  assert.equal(result.refreshed, false, "T18: it is not reported as refreshed");
  assert.match(result.reason, /content-check-failed/, "T18: the reason names the content check");
  assert.equal(fs.files.has(STAMP), false, "T18: the stale stamp is REMOVED, not merely left unwritten");
  assert.equal(fs.calls.some((c) => c.op === "unlink" && c.file === STAMP), true, "T18: removal is explicit");
  const stateWrite = fs.calls.find((c) => c.op === "writeFile" && c.file === STATE);
  assert.equal(stateWrite, undefined, "T18: state is NOT advanced, so the next sweep rebuilds instead of calling the repo unchanged");
  assert.ok(logs.some((m) => /content check/i.test(m)), "T18: the failure is logged");
  assert.ok(logs.some((m) => /src\/fixture\.mjs:6/.test(m)), "T18: the specific mismatch is logged");
  ok("T18: a graph failing the content check loses its stamp and does not advance state");
}

// =====================================================================
// N5. A venture graph is stamped with the VENTURE repository's commit, and a
// DIRTY venture gets no graph at all. Line numbers in an uncommitted file are
// guaranteed by nothing.
// =====================================================================

const VENTURE = { id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" };
const V_GRAPH = "mem:/graphify-out/ventures/caveman-trading-os/graph.json";
const V_BUILT = "mem:/venture/graphify-out/graph.json";
const V_STAMP = `${V_GRAPH}.commit.stamp`;

function ventureDeps(fs, over = {}) {
  return {
    _fs: fs,
    log: () => {},
    venturePath: "mem:/venture",
    ventureGraph: V_GRAPH,
    builtVentureGraph: V_BUILT,
    sourceRoot: "mem:/venture",
    now: () => NOW,
    ...over,
  };
}

async function t19_ventureGraphIsStampedWithTheVenturesOwnCommit() {
  const fs = fakeFs({ files: { [V_BUILT]: graph(7), [SRC_ABS]: SRC_TEXT, "mem:/venture/src/fixture.mjs": SRC_TEXT } });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });

  const result = await refreshVentureGraph(VENTURE, ventureDeps(fs, {
    spawnSync: h.spawnSync,
    ventureCommitState: () => ({ head: "ventureHEADcommit", dirty: false, dirtyFiles: 0 }),
  }));

  assert.equal(result.ok, true, `venture graph promoted: ${result.reason || ""}`);
  assert.equal(result.refreshed, true);
  assert.equal(result.nodes, 7);
  assert.equal(fs.files.get(V_STAMP), "ventureHEADcommit", "T19: stamped with the VENTURE's HEAD, not this repository's");
  assert.equal(fs.files.get(V_GRAPH), graph(7), "T19: the built graph is promoted into Aidit OS");
  // graphify is pointed at the venture, and the build lands beside the venture
  // root — measured behaviour, it ignores cwd.
  assert.deepEqual(h.calls[0].args, ["update", "mem:/venture", "--no-cluster"]);
  ok("T19: a venture graph is stamped with the venture repository's own commit");
}

async function t20_dirtyVentureRefusesAndRemovesAnyStamp() {
  const fs = fakeFs({ files: { [V_BUILT]: graph(7), [V_GRAPH]: graph(3), [V_STAMP]: "an-earlier-commit" } });
  const h = spawnHarness([]); // graphify must never be spawned.
  const logs = [];

  const result = await refreshVentureGraph(VENTURE, ventureDeps(fs, {
    spawnSync: h.spawnSync,
    log: (m) => logs.push(m),
    ventureCommitState: () => ({ head: "c74b6e9", dirty: true, dirtyFiles: 5 }),
  }));

  assert.equal(result.ok, false, "T20: a dirty venture produces no graph");
  assert.equal(result.refreshed, false);
  assert.match(result.reason, /venture-dirty: 5 uncommitted file\(s\)/);
  assert.equal(h.calls.length, 0, "T20: the build is not even attempted — no CPU spent on a graph that cannot be trusted");
  assert.equal(fs.files.has(V_STAMP), false, "T20: an earlier stamp is REMOVED, not left certifying the old graph");
  assert.ok(logs.some((m) => /DIRTY \(5 file\(s\)\)/.test(m)), "T20: the refusal says how many files made it dirty");
  ok("T20: a dirty venture refuses a graph and loses any stamp it had");
}

async function t21_ventureGraphMustAlsoPassTheContentCheck() {
  const fs = fakeFs({ files: { [V_BUILT]: graph(7), [V_STAMP]: "an-earlier-commit" } });
  const h = spawnHarness({ status: 0, stdout: "ok", stderr: "" });

  const result = await refreshVentureGraph(VENTURE, ventureDeps(fs, {
    spawnSync: h.spawnSync,
    ventureCommitState: () => ({ head: "ventureHEAD", dirty: false, dirtyFiles: 0 }),
    verifyContent: async () => ({ verified: false, checked: 4, skipped: 0, mismatches: ["src/a.py:10 thing"], reason: "1/4 sampled symbols are not where the graph says" }),
  }));

  assert.equal(result.ok, false, "T21: evidence before the claim, for a venture graph too");
  assert.match(result.reason, /content-check-failed/);
  assert.equal(fs.files.has(V_STAMP), false, "T21: and the stamp is removed");
  ok("T21: a venture graph that does not describe its tree is not stamped either");
}

async function t22_ventureGitUnreadableIsNotTreatedAsClean() {
  const fs = fakeFs({ files: { [V_BUILT]: graph(7) } });
  const h = spawnHarness([]);

  const result = await refreshVentureGraph(VENTURE, ventureDeps(fs, {
    spawnSync: h.spawnSync,
    ventureCommitState: () => null,
  }));

  assert.equal(result.ok, false, "T22: unreadable git state builds nothing");
  assert.equal(result.reason, "venture-git-unreadable");
  assert.equal(h.calls.length, 0);
  ok("T22: a venture whose git state cannot be read is never assumed clean");
}

async function t23_contentCheckSamplesOnlyIdentifierShapedLabels() {
  // graphify emits nodes whose label IS a docstring. Measured on the
  // caveman-trading-os graph: identifier-shaped labels scored 300/300 on the
  // exact line, prose labels 90/300. Sampling the second kind would refuse
  // every fresh venture graph. This repository has no Python, so the
  // distinction only appeared once a graph was built over a venture.
  const g = {
    nodes: [
      { label: "realSymbol", source_file: "a.py", source_location: "L400" },
      { label: "Return the secret. Raises at startup if absent.", source_file: "b.py", source_location: "L500" },
      { label: ".__init__()", source_file: "c.py", source_location: "L600" },
      { label: "another_symbol", source_file: "d.py", source_location: "L300" },
    ],
  };
  const picked = contentCheckCandidates(g).map((c) => c.label);
  assert.deepEqual(picked, ["realSymbol", "another_symbol"], "only identifier-shaped labels are sampled");
  assert.equal(picked.some((l) => l.includes(" ")), false, "a docstring is never treated as a symbol");
  assert.equal(picked.some((l) => l.startsWith(".")), false, "a member expression is never treated as a symbol");
  ok("T23: the content check samples identifier-shaped labels only, so python docstrings do not fail a fresh graph");
}

function sweepDeps(fs, over = {}) {
  return {
    _fs: fs,
    now: () => NOW,
    log: () => {},
    stateFile: STATE,
    activeVentures: async () => [VENTURE],
    ventureCommitState: () => ({ head: "ventureHEAD", dirty: false, dirtyFiles: 0 }),
    ventureGraphPath: () => V_GRAPH,
    ventureGraphStampPath: () => V_STAMP,
    refreshVentureGraph: async () => ({ ok: true, refreshed: true, id: VENTURE.id, head: "ventureHEAD" }),
    minIntervalMs: INTERVAL,
    ...over,
  };
}

async function t24_freshVentureGraphIsSkippedWithoutBuild() {
  const fs = fakeFs({ files: { [V_GRAPH]: graph(3), [V_STAMP]: "ventureHEAD" } });
  let builds = 0;

  const result = await refreshVentureGraphsIfStale(sweepDeps(fs, {
    refreshVentureGraph: async () => { builds++; return { ok: true, refreshed: true }; },
  }));

  assert.equal(result.checked, 1, "T24: one active venture is checked");
  assert.equal(result.rebuilt, 0, "T24: matching stamp skips rebuild");
  assert.equal(builds, 0, "T24: no build is attempted when stamp equals HEAD");
  assert.deepEqual(result.errors, [], "T24: fresh skip is not an error");
  assert.match(result.skipped[0].reason, /already matches HEAD/);
  ok("T24: a venture whose graph stamp equals HEAD is skipped without building");
}

async function t25_movedVentureHeadTriggersRebuild() {
  const fs = fakeFs({ files: { [V_GRAPH]: graph(3), [V_STAMP]: "oldHEAD" } });
  let builds = 0;

  const result = await refreshVentureGraphsIfStale(sweepDeps(fs, {
    refreshVentureGraph: async () => { builds++; return { ok: true, refreshed: true, id: VENTURE.id }; },
  }));

  assert.equal(result.rebuilt, 1, "T25: stale stamped graph is rebuilt");
  assert.equal(builds, 1, "T25: one build is attempted");
  assert.equal(result.errors.length, 0, "T25: successful rebuild has no errors");
  const stateWrite = fs.calls.find((c) => c.op === "writeFile" && c.file === STATE);
  assert.ok(stateWrite, "T25: rebuild attempt is recorded in state");
  assert.equal(JSON.parse(stateWrite.content).ventureRefresh[VENTURE.id].lastHead, "ventureHEAD");
  ok("T25: a venture whose HEAD moved past its graph stamp is rebuilt");
}

async function t26_missingGraphOrStampTriggersRebuild() {
  for (const [label, files] of [
    ["missing graph", { [V_STAMP]: "ventureHEAD" }],
    ["missing stamp", { [V_GRAPH]: graph(3) }],
  ]) {
    const fs = fakeFs({ files });
    let builds = 0;

    const result = await refreshVentureGraphsIfStale(sweepDeps(fs, {
      refreshVentureGraph: async () => { builds++; return { ok: true, refreshed: true, id: VENTURE.id }; },
    }));

    assert.equal(result.rebuilt, 1, `T26 ${label}: stale venture is rebuilt`);
    assert.equal(builds, 1, `T26 ${label}: one build is attempted`);
    assert.equal(result.errors.length, 0, `T26 ${label}: successful rebuild has no errors`);
  }
  ok("T26: a missing venture graph or missing venture graph stamp triggers a rebuild");
}

async function t27_dirtyVentureIsSkippedBeforeBuild() {
  const fs = fakeFs({ files: { [V_GRAPH]: graph(3), [V_STAMP]: "oldHEAD" } });
  let builds = 0;

  const result = await refreshVentureGraphsIfStale(sweepDeps(fs, {
    ventureCommitState: () => ({ head: "ventureHEAD", dirty: true, dirtyFiles: 2 }),
    refreshVentureGraph: async () => { builds++; return { ok: true, refreshed: true }; },
  }));

  assert.equal(result.rebuilt, 0, "T27: dirty venture is not rebuilt");
  assert.equal(builds, 0, "T27: dirty venture skips before refreshVentureGraph can refuse");
  assert.match(result.skipped[0].reason, /venture-dirty: 2 uncommitted file\(s\)/);
  assert.equal(fs.calls.some((c) => c.op === "writeFile" && c.file === STATE), false, "T27: dirty skip is not recorded as a rebuild attempt");
  ok("T27: a dirty venture is skipped with a reason and no build attempt");
}

async function t28_onlyOneStaleVentureIsRebuiltPerSweep() {
  const a = { id: "alpha", status: "active", repoPath: "ventures/alpha" };
  const b = { id: "beta", status: "active", repoPath: "ventures/beta" };
  const fs = fakeFs({
    files: {
      "mem:/graphify-out/ventures/alpha/graph.json": graph(3),
      "mem:/graphify-out/ventures/alpha/graph.json.commit.stamp": "old",
      "mem:/graphify-out/ventures/beta/graph.json": graph(3),
      "mem:/graphify-out/ventures/beta/graph.json.commit.stamp": "old",
    },
  });
  const built = [];

  const result = await refreshVentureGraphsIfStale(sweepDeps(fs, {
    activeVentures: async () => [a, b],
    ventureCommitState: (_path) => ({ head: _path.includes("alpha") ? "alphaHEAD" : "betaHEAD", dirty: false, dirtyFiles: 0 }),
    ventureGraphPath: (id) => `mem:/graphify-out/ventures/${id}/graph.json`,
    ventureGraphStampPath: (id) => `mem:/graphify-out/ventures/${id}/graph.json.commit.stamp`,
    refreshVentureGraph: async (venture) => { built.push(venture.id); return { ok: true, refreshed: true, id: venture.id }; },
  }));

  assert.deepEqual(built, ["alpha"], "T28: exactly the first stale venture is built");
  assert.equal(result.checked, 2, "T28: both active ventures are considered");
  assert.equal(result.rebuilt, 1, "T28: only one rebuild is reported");
  assert.match(result.skipped.find((s) => s.id === "beta").reason, /already rebuilt this sweep/);
  ok("T28: with two stale ventures, exactly one is rebuilt in a sweep");
}

async function t29_minimumIntervalPreventsRepeatedAttempts() {
  let now = NOW;
  const fs = fakeFs({ files: { [V_GRAPH]: graph(3), [V_STAMP]: "oldHEAD" } });
  let builds = 0;
  const run = () => refreshVentureGraphsIfStale(sweepDeps(fs, {
    now: () => now,
    refreshVentureGraph: async () => { builds++; return { ok: false, refreshed: false, reason: "build-failed: exit 7" }; },
  }));

  const first = await run();
  now += INTERVAL - 1;
  const second = await run();

  assert.equal(first.rebuilt, 0, "T29: failed first build is not reported as rebuilt");
  assert.equal(first.errors.length, 1, "T29: failed first build is reported");
  assert.equal(builds, 1, "T29: first sweep attempts the stale venture");
  assert.equal(second.rebuilt, 0, "T29: second sweep does not rebuild");
  assert.equal(builds, 1, "T29: interval suppresses a second attempt");
  assert.match(second.skipped[0].reason, /refresh interval/);
  ok("T29: inside the venture refresh interval, a second sweep attempts nothing");
}

async function t30_throwingVentureRefreshIsReportedNotPropagated() {
  const fs = fakeFs({ files: { [V_GRAPH]: graph(3), [V_STAMP]: "oldHEAD" } });

  const result = await refreshVentureGraphsIfStale(sweepDeps(fs, {
    refreshVentureGraph: async () => { throw new Error("graphify exploded"); },
  }));

  assert.equal(result.rebuilt, 0, "T30: a thrown refresh is not reported as rebuilt");
  assert.equal(result.errors.length, 1, "T30: thrown refresh is captured in errors");
  assert.equal(result.errors[0].id, VENTURE.id, "T30: error is attributed to the venture");
  assert.match(result.errors[0].reason, /graphify exploded/);
  const stateWrite = fs.calls.find((c) => c.op === "writeFile" && c.file === STATE);
  assert.ok(stateWrite, "T30: thrown attempt is still recorded for interval throttling");
  ok("T30: a throwing refreshVentureGraph is reported in errors and does not propagate");
}

async function main() {
  assert.ok(BUILT_GRAPH, "exported BUILT_GRAPH exists");
  assert.ok(ACTIVE_GRAPH, "exported ACTIVE_GRAPH exists");
  assert.ok(STATE_FILE, "exported STATE_FILE exists");
  assert.equal(typeof MIN_REFRESH_INTERVAL_MS, "number", "exported MIN_REFRESH_INTERVAL_MS is numeric");
  assert.equal(typeof VENTURE_REFRESH_MIN_INTERVAL_MS, "number", "exported VENTURE_REFRESH_MIN_INTERVAL_MS is numeric");
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
    t12_freshClonePromotionCreatesMissingActiveDirectory,
    t13_successfulPromotionStampsActiveGraphWithCommitOnly,
    t14_stampWriteFailureDoesNotFailPromotion,
    t15_commitLandingDuringTheBuildIsNotStampedAsFresh,
    t16_contentCheckSamplesTheDeepestSymbolPerFile,
    t17_contentCheckDistinguishesDriftFromExtractorGaps,
    t18_aGraphThatFailsTheContentCheckLosesItsStamp,
    t19_ventureGraphIsStampedWithTheVenturesOwnCommit,
    t20_dirtyVentureRefusesAndRemovesAnyStamp,
    t21_ventureGraphMustAlsoPassTheContentCheck,
    t22_ventureGitUnreadableIsNotTreatedAsClean,
    t23_contentCheckSamplesOnlyIdentifierShapedLabels,
    t24_freshVentureGraphIsSkippedWithoutBuild,
    t25_movedVentureHeadTriggersRebuild,
    t26_missingGraphOrStampTriggersRebuild,
    t27_dirtyVentureIsSkippedBeforeBuild,
    t28_onlyOneStaleVentureIsRebuiltPerSweep,
    t29_minimumIntervalPreventsRepeatedAttempts,
    t30_throwingVentureRefreshIsReportedNotPropagated,
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
