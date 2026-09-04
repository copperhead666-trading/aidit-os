#!/usr/bin/env node
// scripts/install-git-hooks.mjs
// Installs this repository's git hooks into .git/hooks.
//
//   node scripts/install-git-hooks.mjs
//
// .git/hooks is not tracked by git, so a hook only exists on a machine where
// somebody installed it. That is why the same rule is ALSO asserted by
// ops-watcher/repo-hygiene.regression.test.mjs, which travels with the clone and
// runs in run-all-tests. The hook is the cheap early stop; the test is the one
// that cannot be skipped by forgetting to run this.
//
// Works in a git worktree too: .git there is a FILE pointing at the real
// directory, and the hooks live in the shared common dir.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function hooksDir() {
  // --git-common-dir resolves to the SHARED .git for a worktree, which is where
  // hooks actually live. --git-dir would give the worktree's private directory,
  // and a hook installed there never runs.
  const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  return path.resolve(REPO_ROOT, out, "hooks");
}

const dir = hooksDir();
fs.mkdirSync(dir, { recursive: true });

const target = path.join(dir, "pre-commit");
const guard = path.join(REPO_ROOT, "scripts", "guard-staged-artifacts.mjs");

// A POSIX sh wrapper: git runs hooks through sh on Windows too (Git for Windows
// ships one), so this is portable without a .cmd variant.
// The guard is skipped when the script is not present. Hooks live in the SHARED
// .git, so this one file also runs for every worktree — including worktrees
// sitting on a commit from before the guard existed, where `node <missing file>`
// would abort the commit with MODULE_NOT_FOUND. A hygiene guard must never be
// the reason an unrelated commit cannot be made; the regression test still holds
// the line wherever the script does exist.
const rel = path.relative(REPO_ROOT, guard).split(path.sep).join("/");
const body = `#!/bin/sh
# Installed by scripts/install-git-hooks.mjs — edit that, not this.
if [ -f ${JSON.stringify(rel)} ]; then
  exec node ${JSON.stringify(rel)} "$@"
fi
exit 0
`;

fs.writeFileSync(target, body, "utf8");
try {
  fs.chmodSync(target, 0o755);
} catch {
  // Windows does not need the mode bit and may refuse it. Not fatal.
}

process.stdout.write(`installed pre-commit hook -> ${target}\n`);
