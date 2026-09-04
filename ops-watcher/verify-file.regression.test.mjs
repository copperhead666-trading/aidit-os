// ops-watcher/verify-file.regression.test.mjs
//
// This file had NO dedicated suite. Its only coverage was one case borrowed by
// directive-runner's tests, and that case asserted the very behaviour that
// turned out to be the bug: "ventures/x.txt" refused unconditionally.
//
// verify-file.mjs is the LAST gate a venture directive passes. A fence here
// stops the work after a lane has already done it, which is the most expensive
// place to stop anything.
//
// Run with:
//   node ops-watcher/verify-file.regression.test.mjs

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRepoPath, parseArgs, verifyFile } from "./verify-file.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${e && e.stack ? e.stack : e}`);
    failures.push(name);
    failed++;
  }
}

// The registry these tests state for themselves. Never the live one: this file
// must not change meaning when the owner edits config/ventures.json.
const REGISTRY = [
  { id: "caveman-trading-os", status: "active", repoPath: "ventures/caveman-trading-os" },
  { id: "parked-venture", status: "parked", repoPath: "ventures/parked-venture" },
];
const registryLookup = async (repoRelPath) => {
  const wanted = String(repoRelPath || "").replace(/\\/g, "/");
  return REGISTRY.find((v) => wanted === v.repoPath || wanted.startsWith(`${v.repoPath}/`)) || null;
};
const closed = { ventureForPath: async () => null };
const open = { ventureForPath: registryLookup };

await t("parseArgs requires a path and exactly one matcher", () => {
  assert.equal(parseArgs(["--path", "a.txt"]).ok, false, "no matcher is refused");
  assert.equal(parseArgs(["--contains", "x"]).ok, false, "no path is refused");
  assert.equal(parseArgs(["--path", "a.txt", "--contains", "x", "--matches", "y"]).ok, false, "both matchers is refused");
  assert.equal(parseArgs(["--path", "a.txt", "--contains", "x"]).ok, true);
  assert.equal(parseArgs(["--path", "a.txt", "--bogus", "x"]).ok, false, "an unknown argument is refused");
});

await t("the ordinary refusals are unchanged", async () => {
  assert.equal((await normalizeRepoPath("", closed)).reason, "path is empty");
  assert.equal((await normalizeRepoPath("C:\\x\\y.txt", closed)).reason, "absolute path refused");
  assert.equal((await normalizeRepoPath("/etc/passwd", closed)).reason, "absolute path refused");
  assert.equal((await normalizeRepoPath("../outside.txt", closed)).reason, "path escapes repository");
  assert.equal((await normalizeRepoPath(".env.local", closed)).reason, "env file refused");
  assert.equal((await normalizeRepoPath("ops-watcher/heartbeat.mjs", closed)).reason, "hard-deny operational file refused");
  assert.equal((await normalizeRepoPath("docs/plan.md", closed)).ok, true, "an ordinary repo file still passes");
});

// =====================================================================
// THE FOURTH FENCE. verify-file denied `ventures` unconditionally, so a venture
// directive passed validatePlanScope, dispatched to a lane, and only then
// failed its own VERIFY with "denied directory refused". Measured live before
// the fix, on the file tonight's first directive reads.
// =====================================================================

await t("ventures: an ACTIVE venture path is allowed", async () => {
  const r = await normalizeRepoPath("ventures/caveman-trading-os/docs/planning/phase-1-workstreams.md", open);
  assert.equal(r.ok, true, `an active venture must verify, got: ${r.reason}`);
  assert.equal(r.path, "ventures/caveman-trading-os/docs/planning/phase-1-workstreams.md");
  assert.equal((await normalizeRepoPath("ventures/caveman-trading-os", open)).ok, true, "the venture root itself too");
});

await t("ventures: unknown and inactive are refused, and say WHICH", async () => {
  const unknown = await normalizeRepoPath("ventures/never-registered/x.md", open);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "unknown venture — no venture in config/ventures.json owns this path");

  const parked = await normalizeRepoPath("ventures/parked-venture/x.md", open);
  assert.equal(parked.ok, false);
  assert.equal(parked.reason, "venture parked-venture is not active (status: parked)");

  const bare = await normalizeRepoPath("ventures", open);
  assert.equal(bare.ok, false, "ventures/ itself belongs to no venture");
  assert.match(bare.reason, /unknown venture/);

  // The wording is deliberately identical to directive-runner's, so a refusal
  // reads the same wherever in the pipeline it came from.
  assert.equal(/denied directory/.test(unknown.reason), false, "not the generic message");
  assert.equal(/denied directory/.test(parked.reason), false, "not the generic message");
});

await t("ventures: with no active venture the fence is fully closed", async () => {
  const r = await normalizeRepoPath("ventures/caveman-trading-os/README.md", closed);
  assert.equal(r.ok, false, "an empty registry refuses every venture path");
  assert.match(r.reason, /unknown venture/);
});

await t("denied directories are matched at ANY depth, not only the head", async () => {
  // The head-only test let a venture's own git directory through. A venture is
  // a second repository; this is the first thing a lane reaching in would find.
  for (const p of [
    "ventures/caveman-trading-os/.git/config",
    "ventures/caveman-trading-os/node_modules/x/index.js",
    "ventures/caveman-trading-os/graphify-out/graph.json",
    "docs/node_modules/x.js",
    "a/b/.paperclip/board.json",
  ]) {
    const r = await normalizeRepoPath(p, open);
    assert.equal(r.ok, false, `${p} must be refused`);
    assert.equal(r.reason, "denied directory refused", `${p} refused as a denied directory`);
  }
  // And an env file inside an allowed venture is still an env file.
  const env = await normalizeRepoPath("ventures/caveman-trading-os/.env.local", open);
  assert.equal(env.ok, false);
  assert.equal(env.reason, "env file refused");
});

await t("verifyFile reports match, no match, and missing file", async () => {
  const readFile = async (abs) => {
    if (String(abs).replace(/\\/g, "/").endsWith("docs/plan.md")) return "hello WORLD\nsecond line\n";
    const err = new Error("nope");
    err.code = "ENOENT";
    throw err;
  };
  const deps = { ...closed, readFile, repoRoot: REPO_ROOT };

  assert.equal((await verifyFile({ path: "docs/plan.md", contains: "WORLD" }, deps)).ok, true);
  assert.equal((await verifyFile({ path: "docs/plan.md", contains: "absent" }, deps)).ok, false);
  assert.equal((await verifyFile({ path: "docs/plan.md", matches: "^hello" }, deps)).ok, true);
  assert.equal((await verifyFile({ path: "docs/plan.md", matches: "^nope" }, deps)).ok, false);

  const missing = await verifyFile({ path: "docs/gone.md", contains: "x" }, deps);
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /missing or unreadable/);

  const bad = await verifyFile({ path: "docs/plan.md", matches: "([" }, deps);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /invalid regex/);
});

await t("verifyFile carries the venture verdict through, it does not just normalise", async () => {
  // The gate has to REACH verifyFile. Testing normalizeRepoPath alone would
  // stay green if verifyFile stopped awaiting it.
  const readFile = async () => "Phase 1 Workstreams table";
  const allowed = await verifyFile(
    { path: "ventures/caveman-trading-os/docs/planning/phase-1-workstreams.md", contains: "Workstreams" },
    { ...open, readFile, repoRoot: REPO_ROOT },
  );
  assert.equal(allowed.ok, true, `an active venture path must reach the file read, got: ${allowed.reason}`);

  const refused = await verifyFile(
    { path: "ventures/parked-venture/x.md", contains: "Workstreams" },
    { ...open, readFile, repoRoot: REPO_ROOT },
  );
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /not active/, "the venture verdict, not a read error");
});

await t("the real repository still refuses what it always refused", async () => {
  // No injection: the live registry, the live file. This is the command the
  // first venture directive will actually run.
  const real = await verifyFile({
    path: "ventures/caveman-trading-os/docs/planning/phase-1-workstreams.md",
    contains: "Workstreams",
  });
  assert.equal(real.ok, true, `the live registry must allow the active venture, got: ${real.reason}`);

  const gitDir = await verifyFile({ path: "ventures/caveman-trading-os/.git/config", contains: "core" });
  assert.equal(gitDir.ok, false);
  assert.equal(gitDir.reason, "denied directory refused");
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(1);
}
process.exit(0);
