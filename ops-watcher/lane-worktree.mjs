// ops-watcher/lane-worktree.mjs
// One isolated git worktree per writing lane.
//
// === WHY THIS EXISTS, AND WHY A COMMENT WAS NOT ENOUGH ===
// CLAUDE.md has said "never allow two writers in one worktree; give each writing
// agent an isolated worktree and explicit file ownership" since it was written.
// It was never built. As of 2026-09-04, `grep -rn worktree` across ops-watcher/
// and scripts/ returned exactly ONE line, and it was a comment. All three
// dispatchers ran with `cwd: REPO_ROOT`:
//
//   corleone-dispatch.mjs:115   cwd: REPO_ROOT
//   sjahrir-dispatch.mjs:141    cwd: REPO_ROOT
//   hatta-dispatch.mjs:142      cwd: REPO_ROOT
//
// So every lane wrote into the same tree at the same time. Two deliberately
// broken commits shipped on 2026-09-04 because a commit landed in the middle of
// another lane's mutation-check — the file changed under the check, the check
// passed, and the wrong thing was committed. That is not a hypothetical race; it
// is the recorded cause of two bad commits.
//
// A rule that lives only in a document is a rule nobody enforces. This module is
// the enforcement.
//
// === WHAT IT DOES NOT DO ===
// It does not decide WHICH files a lane may touch — that is the packet's job.
// It gives each lane a tree of its own so that two lanes writing at once cannot
// corrupt each other's verification, and so the integration owner (this session)
// stays the only writer of main.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

// Worktrees live OUTSIDE the repository. Nesting them inside would put one
// checkout under another, where every `git status` in the parent reports the
// child's contents and `ventures/`-style ignore rules start mattering for
// reasons nobody intended.
export const WORKTREE_ROOT = path.resolve(REPO_ROOT, "..", "worktrees");

/** Directory a given lane owns. One lane, one tree, always the same one. */
export function worktreePathFor(lane, { root = WORKTREE_ROOT } = {}) {
  const safe = String(lane || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!safe) throw new Error("worktreePathFor: lane name is required");
  return path.join(root, `lane-${safe}`);
}

/** Branch a given lane commits on. Never main; that is the integration owner's. */
export function branchNameFor(lane) {
  const safe = String(lane || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!safe) throw new Error("branchNameFor: lane name is required");
  return `lane/${safe}`;
}

function git(args, { cwd = REPO_ROOT, _exec = execFileSync } = {}) {
  return String(_exec("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true })).trim();
}

/**
 * The worktree for `lane`, creating it if absent. Returns
 * { path, branch, created, reason }.
 *
 * NEVER THROWS. A dispatcher that cannot get an isolated tree must still be able
 * to run — degrading to the shared repo root is worse than isolation but far
 * better than a lane that refuses to start, and the caller is told which it got
 * so the fallback is visible in the log rather than silent.
 */
export function ensureLaneWorktree(lane, deps = {}) {
  const _exec = deps._exec || execFileSync;
  const _fs = deps._fs || fs;
  const root = deps.root || WORKTREE_ROOT;
  const repoRoot = deps.repoRoot || REPO_ROOT;

  let target;
  let branch;
  try {
    target = worktreePathFor(lane, { root });
    branch = branchNameFor(lane);
  } catch (err) {
    return { path: repoRoot, branch: null, created: false, isolated: false, reason: `bad lane name: ${err.message}` };
  }

  try {
    if (_fs.existsSync(path.join(target, ".git"))) {
      return { path: target, branch, created: false, isolated: true, reason: "existing worktree reused" };
    }
    _fs.mkdirSync(root, { recursive: true });

    // -B so a re-run after the directory was deleted by hand still works: the
    // branch may survive its worktree, and `git worktree add -b` on an existing
    // branch fails outright.
    git(["worktree", "add", "-B", branch, target, "HEAD"], { cwd: repoRoot, _exec });
    return { path: target, branch, created: true, isolated: true, reason: "worktree created" };
  } catch (err) {
    // Fall back to the shared root, and SAY SO. A silent fallback here would
    // recreate the exact bug this module exists to prevent, with a module in
    // place that everyone assumes is protecting them.
    return {
      path: repoRoot,
      branch: null,
      created: false,
      isolated: false,
      reason: `worktree unavailable, falling back to the shared repo root: ${err && err.message ? err.message : err}`,
    };
  }
}

/**
 * Lanes currently holding a worktree, as git itself reports them. Read-only.
 * Returns [] rather than throwing when git cannot answer.
 */
export function listLaneWorktrees(deps = {}) {
  const _exec = deps._exec || execFileSync;
  try {
    const out = git(["worktree", "list", "--porcelain"], { cwd: deps.repoRoot || REPO_ROOT, _exec });
    const trees = [];
    let current = null;
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        current = { path: line.slice("worktree ".length).trim(), branch: null };
        trees.push(current);
      } else if (line.startsWith("branch ") && current) {
        current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      }
    }
    return trees;
  } catch {
    return [];
  }
}
