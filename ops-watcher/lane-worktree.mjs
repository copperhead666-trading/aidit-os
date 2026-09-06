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

function safeSegment(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function sourceRepoDirectoryName(sourceRepo) {
  const raw = String(sourceRepo || "").split(/[\\/]+/).filter(Boolean).pop();
  const safe = safeSegment(raw);
  if (!safe) throw new Error("worktreePathFor: sourceRepo directory name is required");
  return safe;
}

/** Directory a given lane owns. One lane, one tree, always the same one. */
export function worktreePathFor(lane, { root = WORKTREE_ROOT, sourceRepo } = {}) {
  const safe = safeSegment(lane);
  if (!safe) throw new Error("worktreePathFor: lane name is required");
  if (sourceRepo) return path.join(root, sourceRepoDirectoryName(sourceRepo), `lane-${safe}`);
  return path.join(root, `lane-${safe}`);
}

/** Branch a given lane commits on. Never main; that is the integration owner's. */
export function branchNameFor(lane) {
  const safe = safeSegment(lane);
  if (!safe) throw new Error("branchNameFor: lane name is required");
  return `lane/${safe}`;
}

function git(args, { cwd = REPO_ROOT, _exec = execFileSync } = {}) {
  const safeCwd = path.resolve(cwd);
  const gitArgs = ["-c", `safe.directory=${safeCwd}`, ...args];
  return String(_exec("git", gitArgs, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true })).trim();
}

/**
 * Runtime-state paths: tracked files that a RUNNING PROCESS appends to, not
 * work a lane did. Their presence in `git status` must not count as dirt:
 * `state/ledger.jsonl` is tracked in git AND appended to by ops-watcher/ledger.mjs
 * ("the single writer for the FounderOS event ledger") at runtime, so every
 * lane worktree carries it permanently dirty — and a permanently dirty tree
 * that also falls behind main gets refused by the staleness guard on dirt
 * that is not work and never was. That is how the guard gets switched off.
 *
 * EXPLICIT PATHS ONLY, never a pattern like "anything under state/": a
 * pattern would silently excuse a future file under state/ that IS work.
 * Every entry here must be a file shown to be written by a running process
 * rather than by a lane. Untracked files never match this list: a lane that
 * wrote a new file has done work, whatever the file is called.
 */
export const RUNTIME_STATE_PATHS = ["state/ledger.jsonl"];

function porcelainEntryPath(line) {
  // The shared git() helper trims the WHOLE output, which strips the leading
  // space of the first porcelain line (" M path" -> "M path"), so positions
  // are not reliable. Porcelain is always XY<space>PATH; capture PATH with a
  // regex instead of fixed offsets.
  const m = /^.. (.*)$/.exec(line);
  let p = m ? m[1] : line;
  // Renames look like "R  old -> new"; the entry names the NEW path.
  const arrow = p.indexOf(" -> ");
  if (arrow !== -1) p = p.slice(arrow + 4);
  return p.replace(/^"|"$/g, "").replace(/\\/g, "/");
}

function isRuntimeStatePath(relPath) {
  return RUNTIME_STATE_PATHS.includes(relPath);
}

/**
 * How many uncommitted entries a worktree is carrying, as `git status
 * --porcelain` counts them, SPLIT into work and runtime state. Returns
 * { work: null, runtimeState: null } — not zeros — when git cannot answer, so
 * "no dirt" and "could not look" stay different facts.
 *
 * `work` is the count of real uncommitted work: tracked modifications to
 * anything, and ALL untracked files (a new file is work whatever it is
 * called). `runtimeState` is how many of the entries were tracked
 * modifications to a RUNTIME_STATE_PATHS entry only — dirt that is not work.
 * A tree whose only entries are runtime state reports work 0 and is treated
 * as clean, but the reason string says so rather than reporting zero silently.
 */
export function dirtyEntryCount(cwd, { _exec = execFileSync } = {}) {
  try {
    const out = git(["status", "--porcelain"], { cwd, _exec });
    if (!out) return { work: 0, runtimeState: 0 };
    let work = 0;
    let runtimeState = 0;
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const pathPart = porcelainEntryPath(line);
      if (!line.startsWith("??") && isRuntimeStatePath(pathPart)) {
        runtimeState++;
      } else {
        work++;
      }
    }
    return { work, runtimeState };
  } catch {
    return { work: null, runtimeState: null };
  }
}

/**
 * The commit a worktree is actually on, or null when git cannot answer.
 */
export function headCommit(cwd, { _exec = execFileSync } = {}) {
  try {
    return git(["rev-parse", "HEAD"], { cwd, _exec }) || null;
  } catch {
    return null;
  }
}

/**
 * The branch a worktree is really checked out on, or null when git cannot
 * answer or HEAD is detached. This can differ from branchNameFor(lane):
 * branches held by another worktree cannot be checked out here, so git puts
 * the tree on whatever is left.
 */
export function checkedOutBranchName(cwd, { _exec = execFileSync } = {}) {
  try {
    const out = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd, _exec });
    if (!out || out === "HEAD") return null;
    return out;
  } catch {
    return null;
  }
}

/**
 * How many commits origin/main is ahead of the worktree's HEAD. Returns null
 * — not 0 — when git cannot answer, because "in sync" and "could not look"
 * must stay different facts. A number meaning "I could not tell" is how the
 * stale-lane bug this module exists to end survives.
 */
export function behindCount(cwd, { _exec = execFileSync } = {}) {
  try {
    const out = git(["rev-list", "--count", "HEAD..origin/main"], { cwd, _exec });
    const n = Number.parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * The worktree for `lane`, creating it if absent. Returns
 * { path, branch, created, dirty, head, checkedOutBranch, behind, reason }.
 * `dirty` is the number of uncommitted WORK entries in a REUSED worktree —
 * runtime-state-only changes (RUNTIME_STATE_PATHS, e.g. state/ledger.jsonl)
 * do not count (0 when clean, null when git could not be asked), and 0 for
 * one just created.
 * `head` is the commit the tree is actually on, `checkedOutBranch` what it is
 * really checked out on (which may differ from `branch`), and `behind` how
 * many commits origin/main is ahead of it (null when it cannot be measured).
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
  const sourceRepo = path.resolve(deps.sourceRepo || deps.repoRoot || REPO_ROOT);

  let target;
  let branch;
  try {
    target = worktreePathFor(lane, { root, sourceRepo: deps.sourceRepo });
    branch = branchNameFor(lane);
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const isSourceRepoError = message.includes("sourceRepo directory name is required");
    const reason = isSourceRepoError ? `bad sourceRepo: ${message}` : `bad lane name: ${message}`;
    const fallbackPath = isSourceRepoError ? path.resolve(deps.repoRoot || REPO_ROOT) : sourceRepo;
    return { path: fallbackPath, branch: null, created: false, isolated: false, dirty: null, head: null, checkedOutBranch: null, behind: null, reason };
  }

  try {
    if (_fs.existsSync(path.join(target, ".git"))) {
      // A reused worktree is not necessarily a clean one. A lane that timed out
      // mid-edit leaves its files behind, and the next dispatch of the SAME lane
      // starts on top of them — its diff then contains work nobody asked it to
      // do. Measured on 2026-09-05: five of nine lane worktrees were dirty, one
      // of them holding six files from a CORLEONE run that hit its 480s cap.
      //
      // Nothing is cleaned here on purpose: those leftovers are the only copy of
      // work a lane already did, and deleting them to make a status line tidy is
      // how real work disappears. The dirt is REPORTED instead, so the caller
      // decides, and so it is visible in the log rather than inherited silently.
      const dirt = dirtyEntryCount(target, { _exec });
      const dirty = dirt.work;
      const runtimeStateOnly = dirt.runtimeState;
      const head = headCommit(target, { _exec });
      const checkedOutBranch = checkedOutBranchName(target, { _exec });
      const behind = behindCount(target, { _exec });

      // Staleness refusal threshold: behind > 0, with no tolerance. Any positive
      // number means origin/main holds commits this tree has never executed,
      // which is exactly the phantom-run failure this packet exists to end; a
      // "small tolerance" would only reintroduce silence with a number attached.
      // And because this module never cleans, stashes, or resets, a dirty stale
      // tree has no safe update path at all — running it would guarantee old
      // code. behind === null never triggers the refusal: an unknown number is
      // reported as unknown, not guessed.
      const stale = typeof behind === "number" && behind > 0;
      const notes = [];
      if (checkedOutBranch && checkedOutBranch !== branch) {
        // Never "fix" this by checking out the lane branch: a checkout would
        // discard or carry uncommitted work across branches, which is exactly
        // the destruction this module refuses to do. Report it, always, and
        // let a human look.
        notes.push(`checked out on "${checkedOutBranch}", not "${branch}"`);
      }
      const noteSuffix = notes.length ? ` (${notes.join("; ")})` : "";
      // Dirt that is only runtime state (e.g. state/ledger.jsonl appended by a
      // running process) is not work: the tree counts as clean, but the reason
      // says so out loud so "clean" and "dirty only in runtime state" stay
      // distinguishable in the log.
      const runtimeSuffix = runtimeStateOnly > 0
        ? `; runtime-state change${runtimeStateOnly === 1 ? "" : "s"} present (${RUNTIME_STATE_PATHS.join(", ")}), not counted as work`
        : "";

      if (dirty === 0 && stale) {
        try {
          // Fast-forward only, and only on a clean tree, so no uncommitted file
          // can be touched. --ff-only refuses to invent a merge commit: if the
          // lane branch diverged, git fails and the tree is left untouched.
          git(["merge", "--ff-only", "origin/main"], { cwd: target, _exec });
        } catch {
          return {
            path: target,
            branch,
            created: false,
            isolated: true,
            dirty,
            head,
            checkedOutBranch,
            behind,
            reason: `existing worktree reused; ${behind} commits behind origin/main but not fast-forwardable, left as-is${noteSuffix}${runtimeSuffix}`,
          };
        }
        return {
          path: target,
          branch,
          created: false,
          isolated: true,
          dirty,
          head,
          checkedOutBranch,
          behind,
          reason: `existing worktree reused; fast-forwarded ${behind} commit${behind === 1 ? "" : "s"} to origin/main${noteSuffix}${runtimeSuffix}`,
        };
      }

      if (dirty > 0 && stale) {
        // Dirty AND stale: do not clean it, do not stash it — the uncommitted
        // work is the only copy, same rule as above. Do not run either: the
        // lane would execute a base revision that no longer exists. Refuse, so
        // a human looks, which is what the situation deserves.
        return {
          path: target,
          branch,
          created: false,
          isolated: false,
          dirty,
          head,
          checkedOutBranch,
          behind,
          reason: `existing worktree is dirty (${dirty} uncommitted entr${dirty === 1 ? "y" : "ies"}) and stale (${behind} commits behind origin/main); refusing to run a lane against old code${noteSuffix}`,
        };
      }

      return {
        path: target,
        branch,
        created: false,
        isolated: true,
        dirty,
        head,
        checkedOutBranch,
        behind,
        reason: dirty > 0
          ? `existing worktree reused, and it is NOT clean: ${dirty} uncommitted entr${dirty === 1 ? "y" : "ies"} left by an earlier run${noteSuffix}`
          : `existing worktree reused${runtimeSuffix}${noteSuffix}`,
      };
    }
    _fs.mkdirSync(root, { recursive: true });

    // -B so a re-run after the directory was deleted by hand still works: the
    // branch may survive its worktree, and `git worktree add -b` on an existing
    // branch fails outright.
    git(["worktree", "add", "-B", branch, target, "HEAD"], { cwd: sourceRepo, _exec });
    return { path: target, branch, created: true, isolated: true, dirty: 0, head: null, checkedOutBranch: branch, behind: 0, reason: "worktree created" };
  } catch (err) {
    // Fall back to the source repo, and SAY SO. A silent fallback here would
    // recreate the exact bug this module exists to prevent, with a module in
    // place that everyone assumes is protecting them.
    return {
      path: sourceRepo,
      branch: null,
      created: false,
      isolated: false,
      dirty: null,
      head: null,
      checkedOutBranch: null,
      behind: null,
      reason: `worktree unavailable, falling back to the source repo: ${err && err.message ? err.message : err}`,
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
