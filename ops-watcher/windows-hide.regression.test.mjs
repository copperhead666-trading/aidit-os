// ops-watcher/windows-hide.regression.test.mjs
// H1 — nothing Aidit OS runs may put a window on the owner's screen.
//
//   node ops-watcher/windows-hide.regression.test.mjs
//
// === WHY THIS TEST EXISTS ===
// The rule was already written down and it was still broken:
// lane-worktree.mjs ran `execFileSync("git", args, { cwd, encoding, maxBuffer })`
// on EVERY lane dispatch with no windowsHide, and the owner saw terminal flashes
// on the Lenovo.
//
// A rule that lives only in a document decays. The argv lesson decayed exactly
// this way. So the check is a test: T1 walks every first-party spawn CALL SITE
// and fails on the first one that omits windowsHide — including one added
// tomorrow in a file that sets windowsHide three functions up.
//
// T2-T7 test the scanner itself, because a scanner that quietly stops finding
// call sites would make T1 pass forever while the rule rots.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditRepo,
  offenders,
  findSpawnCallSites,
  spawnAliases,
  blankNonCode,
  ALLOWED_WITHOUT_WINDOWS_HIDE,
  REPO_ROOT,
} from "./windows-hide.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(String(e && e.stack ? e.stack : e).split("\n").map((l) => "       " + l).join("\n"));
  failed++;
};
async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

await t("T1 every first-party spawn call site passes windowsHide", async () => {
  const sites = await auditRepo();
  // A scanner that finds nothing would pass vacuously. It found 69 sites after
  // .claude was added on purpose; the floor guards against the scan silently breaking.
  assert.ok(sites.length >= 69, `expected the scan to find the repository's call sites, found ${sites.length}`);
  const bad = offenders(sites);
  const report = bad.map((s) => `  ${s.file}:${s.line}  ${s.callee}(${s.snippet})`).join("\n");
  assert.equal(
    bad.length, 0,
    `these call sites start a process without windowsHide, so each can flash a console window on the owner's screen:\n${report}\n` +
    "Add `windowsHide: true` to the options of the call itself. If a call genuinely cannot, add it to " +
    "ALLOWED_WITHOUT_WINDOWS_HIDE in ops-watcher/windows-hide.mjs WITH A REASON.",
  );
});

await t("T2 the check actually fails when a call site omits windowsHide", () => {
  const src = `import { execFileSync } from "node:child_process";
    export function head() {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ".", encoding: "utf8" });
    }`;
  const sites = findSpawnCallSites(src, { file: "synthetic.mjs" });
  assert.equal(sites.length, 1);
  assert.equal(sites[0].hasWindowsHide, false);
  assert.equal(offenders(sites).length, 1, "a missing windowsHide must be reported, or T1 proves nothing");
});

await t("T2b .claude helper call sites without windowsHide are reported", () => {
  const src = `const { spawnSync } = require("node:child_process");
    module.exports = function hook() {
      return spawnSync("node", ["helper.cjs"], { stdio: "ignore" });
    };`;
  const sites = findSpawnCallSites(src, { file: ".claude/helpers/synthetic.cjs" });
  assert.equal(sites.length, 1);
  assert.equal(sites[0].hasWindowsHide, false);
  assert.equal(offenders(sites).length, 1, "a missing windowsHide in .claude/helpers must be reported");
});

await t("T3 windowsHide on the call itself is what counts, not elsewhere in the file", () => {
  // The exact shape H1 calls out: one call sets it, the call three functions
  // down does not. The file-level view would call this clean.
  const src = `import { execFileSync, spawn } from "node:child_process";
    export function safe() {
      return execFileSync("git", ["status"], { cwd: ".", windowsHide: true });
    }
    export function forgotten() {
      return spawn("node", ["x.mjs"], { cwd: "." });
    }`;
  const sites = findSpawnCallSites(src, { file: "synthetic.mjs" });
  assert.equal(sites.length, 2);
  assert.equal(sites.find((s) => s.callee === "execFileSync").hasWindowsHide, true);
  assert.equal(sites.find((s) => s.callee === "spawn").hasWindowsHide, false);
});

await t("T4 an injected exec seam is still a call site", () => {
  // lane-worktree's shape: the callee is a parameter defaulting to execFileSync.
  const src = `import { execFileSync } from "node:child_process";
    function git(args, { cwd = ".", _exec = execFileSync } = {}) {
      return String(_exec("git", args, { cwd, encoding: "utf8" }));
    }`;
  const aliases = spawnAliases(src);
  assert.equal(aliases.has("_exec"), true, "a seam defaulting to execFileSync reaches child_process");
  const sites = findSpawnCallSites(src, { file: "synthetic.mjs" });
  assert.equal(sites.some((s) => s.callee === "_exec" && s.hasWindowsHide === false), true);
});

await t("T5 options held in a constant, or spread from one, count as passing", () => {
  const src = `import { spawn, spawnSync } from "node:child_process";
    const SPAWN_OPTS = { cwd: ".", windowsHide: true, shell: false };
    export const a = () => spawn("node", ["a.mjs"], SPAWN_OPTS);
    export const b = () => spawnSync("node", ["b.mjs"], { ...SPAWN_OPTS, timeout: 10 });`;
  const sites = findSpawnCallSites(src, { file: "synthetic.mjs" });
  assert.equal(sites.length, 2);
  assert.equal(sites.every((s) => s.hasWindowsHide), true, "a shared options object still hides the window");
});

await t("T6 a comment, a string, or RegExp.exec is not a spawn call site", () => {
  const src = `import { execFileSync } from "node:child_process";
    // execFileSync("git", ["status"], { cwd: "." })  <- a comment, not a call
    const note = 'spawn("node", ["x"], {})';
    const m = /a(b)/.exec(note);
    const parts = note.slice(0, 3);
    export const real = () => execFileSync("git", ["status"], { cwd: ".", windowsHide: true });`;
  const sites = findSpawnCallSites(src, { file: "synthetic.mjs" });
  assert.equal(sites.length, 1, `only the real call counts, found ${sites.map((s) => s.callee).join(", ")}`);
  assert.equal(sites[0].callee, "execFileSync");
  assert.equal(sites[0].hasWindowsHide, true);
  // blankNonCode must not move any offset: line numbers in the report depend on it.
  assert.equal(blankNonCode(src).length, src.length);
  assert.equal(blankNonCode(src).split("\n").length, src.split("\n").length);
});

await t("T7 lane-worktree's git call passes windowsHide (the H1 regression)", async () => {
  const file = path.join(__dirname, "lane-worktree.mjs");
  const sites = findSpawnCallSites(await fs.readFile(file, "utf8"), { file: "ops-watcher/lane-worktree.mjs" });
  assert.ok(sites.length >= 1, "lane-worktree still runs git");
  for (const s of sites) {
    assert.equal(s.hasWindowsHide, true, `lane-worktree.mjs:${s.line} runs a process without windowsHide`);
  }
});

await t("T8 every allowlist entry names a call site that still exists", async () => {
  const keys = Object.keys(ALLOWED_WITHOUT_WINDOWS_HIDE);
  if (!keys.length) return; // nothing exempt today, which is the state we want
  const sites = await auditRepo();
  for (const key of keys) {
    const [file, callee] = key.split(":");
    assert.equal(
      sites.some((s) => s.file === file && s.callee === callee), true,
      `${key} is exempted but no such call site exists any more — remove the exemption`,
    );
    assert.ok(String(ALLOWED_WITHOUT_WINDOWS_HIDE[key]).trim().length > 0, `${key} is exempted without a reason`);
  }
  assert.ok(REPO_ROOT);
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
