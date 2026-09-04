// ops-watcher/repo-hygiene.regression.test.mjs
// Guards against a class of artifact that has reached origin/main SEVEN times.
//
//   node ops-watcher/repo-hygiene.regression.test.mjs
//
// === WHY THIS TEST EXISTS ===
// Zero-byte files keep appearing in the tree with names that are obviously shell
// fragments rather than filenames: "0", "0)", "{", "a.name", "a.name).sort()",
// "x.name).join('", "Date.now()", "ctl.abort()", "(x.createdAt",
// "JSON.stringify(e).includes('KOL-33'))", "CLI_FIELD_MAX", "r.timedOut".
//
// They are created by a shell REDIRECT, not by any tool in this repository. A
// command like
//     node -e "const f = xs.map(x => x.name)"
// run through a shell that sees the `>` of the arrow as a redirection operator
// creates a file named after the token that followed it. The content is empty
// because nothing was written to the redirect.
//
// FIVE separate "remove zero-byte shell artifact" commits were made in a single
// day, and the eighth artifact appeared in the very commit that added the
// seventh to .gitignore. Naming them there CANNOT work: every occurrence has a
// new name, because the name is whatever token the shell mis-parsed that time.
//
// So this test does not chase names. It asserts the INVARIANT: a tracked file in
// this repository is never zero bytes, unless it is on the allowlist below with
// a reason. That catches the next one whatever it ends up being called.
//
// This lives in ops-watcher/ because ops-watcher/run-all-tests.mjs reads that
// directory only, with no recursion — and run-all-tests is the gate everything
// passes through.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(String(e && e.stack ? e.stack : e).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(n); failed++;
};

// Files that are DELIBERATELY empty. Each needs a reason, because "it was empty
// already" is how the next artifact gets grandfathered in.
export const ALLOWED_EMPTY_FILES = Object.freeze({
  "hatta/.harness-empty-gitconfig":
    "Intentionally empty. The harness points git at this file to neutralise the " +
    "user's global gitconfig inside its sandbox; content would defeat the purpose.",
});

/**
 * Every tracked file that is zero bytes on disk. Pure apart from the git call,
 * which is injected so the test can exercise the checker itself.
 */
export function findEmptyTrackedFiles({ root = REPO_ROOT, listFiles, statSize } = {}) {
  const list = listFiles || (() =>
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean));
  const size = statSize || ((rel) => {
    try {
      const st = fs.statSync(path.join(root, rel));
      return st.isFile() ? st.size : null;
    } catch {
      return null; // deleted from the worktree but still in the index — not our concern
    }
  });
  const empty = [];
  for (const rel of list()) {
    if (size(rel) === 0) empty.push(rel);
  }
  return empty.sort();
}

async function testNoZeroByteTrackedFiles() {
  const name = "Z1 no tracked file is zero bytes (except the documented allowlist)";
  try {
    const empty = findEmptyTrackedFiles();
    const offenders = empty.filter((f) => !(f in ALLOWED_EMPTY_FILES));
    assert.deepEqual(
      offenders,
      [],
      `zero-byte tracked file(s) found: ${JSON.stringify(offenders)}\n` +
        "       These are shell-redirect artifacts, not source. Remove them with\n" +
        "       `git rm --cached <file>` and delete them from the worktree.\n" +
        "       If one is deliberately empty, add it to ALLOWED_EMPTY_FILES with a reason.",
    );
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testAllowlistEntriesStillExist() {
  const name = "Z2 every allowlist entry still exists and is still empty";
  try {
    // An allowlist that outlives its files is how an exception quietly becomes a
    // licence to ignore the rule.
    for (const [rel, reason] of Object.entries(ALLOWED_EMPTY_FILES)) {
      assert.ok(reason && reason.length > 20, `${rel} has a real reason, not a placeholder`);
      const full = path.join(REPO_ROOT, rel);
      assert.ok(fs.existsSync(full), `${rel} is allowlisted but does not exist — drop the entry`);
      assert.equal(fs.statSync(full).size, 0, `${rel} is allowlisted as empty but has content — drop the entry`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testCheckerActuallyDetects() {
  const name = "Z3 the checker detects a zero-byte file (it can fail, not just pass)";
  try {
    // A guard that has never been shown to fire is not a guard. Inject a fake
    // listing rather than writing junk into the real tree.
    const found = findEmptyTrackedFiles({
      listFiles: () => ["ops-watcher/real.mjs", "a.name).sort()", "r.timedOut"],
      statSize: (rel) => (rel === "ops-watcher/real.mjs" ? 1234 : 0),
    });
    assert.deepEqual(found, ["a.name).sort()", "r.timedOut"], "both artifacts detected, real file ignored");
    ok(name);
  } catch (err) { bad(name, err); }
}

async function testMissingFileIsNotReported() {
  const name = "Z4 a file in the index but absent from the worktree is not reported";
  try {
    // Mid-rebase or mid-checkout states must not turn this into a false alarm
    // that people learn to skip.
    const found = findEmptyTrackedFiles({
      listFiles: () => ["gone.mjs"],
      statSize: () => null,
    });
    assert.deepEqual(found, []);
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher repo-hygiene regression tests");
  await testNoZeroByteTrackedFiles();
  await testAllowlistEntriesStillExist();
  await testCheckerActuallyDetects();
  await testMissingFileIsNotReported();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}
main().catch((err) => { console.error("repo-hygiene regression runner crashed:", err); process.exit(1); });
