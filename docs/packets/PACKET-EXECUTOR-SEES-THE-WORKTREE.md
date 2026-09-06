# PACKET-EXECUTOR-SEES-THE-WORKTREE — the executor looks in the wrong tree

Role: CORLEONE. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character: the
patch tool has failed on it repeatedly and cost two runs their whole budget.

---

## Why this exists, and why it is the most important open defect

Every directive execution reports `filesChanged: 0` and
`deliveredWhatWasAsked: false`, no matter how well the lane works. Four
executions tonight, four identical no-ops. The lanes were not failing.

`ops-watcher/directive-runner.mjs` snapshots and re-stats the planned files by
the path the plan names:

```js
async function statEntry(file) {
  const st = await statFileFn(file);   // "config/ventures.json"
  ...
}
```

That resolves against the executor's own cwd, which is the main checkout. But the
lane writes in its own worktree, because every dispatcher spawns with
`cwd: workspace.path` from `ensureLaneWorktree`. `directive-runner` never calls
`ensureLaneWorktree` and has no idea where the lane ran.

Measured tonight after the fourth no-op: `git status` in
`D:/AI/worktrees/lane-corleone` showed

```
 M config/ventures.json
 M ops-watcher/merge-steward.mjs
 M ops-watcher/merge-steward.regression.test.mjs
```

KOL-81 had written a real `metrik_terakhir` entry with `nilai: null` and an
honest note explaining it could not count the numerator because the venture file
is not present in a lane worktree. That is exactly the integrity the registry
demands. It was reported as a no-op.

So `deliveredWhatWasAsked` has been structurally incapable of being true since
the executor was written, and every measurement it produced is wrong in the same
direction.

This is the same class of defect fixed this morning in `hatta-dispatch`: a path
that follows the module instead of following the workspace where the work
actually happened.

---

## Files you may edit - no others

- `ops-watcher/directive-runner.mjs`
- `ops-watcher/directive-runner.regression.test.mjs`

---

## What to change

`executeApprovedDirective` must resolve planned file paths against the workspace
the lane actually ran in, not against the executor's cwd.

- The chosen lane is already known inside `executeApprovedDirective`
  (`chosenLane`). `ensureLaneWorktree(lane)` returns `{ path, isolated, ... }`
  and never throws; its `path` is where that lane writes.
- Resolve each planned file as `path.resolve(workspacePath, file)` for the
  snapshot, the re-stat, and the restore. Those three must use the SAME base, or
  a revert will restore a file the lane never touched.
- When `ensureLaneWorktree` reports `isolated: false`, the lane ran in the shared
  root and the current behaviour is already correct; use the returned path
  either way rather than branching on the flag.
- Inject it. The suite must be able to supply a fake workspace path without
  creating a worktree.

**Do not change what the checks mean.** `verifyPassed`, `filesChanged`,
`filesPlanned` and `deliveredWhatWasAsked` keep their current definitions. The
only thing that changes is where the executor looks.

**Do not change the restore path's safety.** If a snapshot was taken from a
workspace, the restore must write back to that same workspace and nowhere else.
A revert that writes into the main checkout would be worse than the bug being
fixed.

---

## Tests - required

Everything injected. No test may create a worktree or touch a real lane tree.

1. With an injected workspace path, `statEntry` is called with paths resolved
   under that workspace, not under the repository root. Assert on the recorded
   argument.
2. A file the lane changed inside the workspace is counted in `filesChanged`.
   This is the bug: today it is 0. Drive it with an injected stat that reports a
   different size/mtime for the workspace path and an unchanged one for the root
   path, and assert the workspace answer wins.
3. `deliveredWhatWasAsked` becomes true when every planned file changed in the
   workspace. Today it cannot; pin that it can.
4. Snapshot, re-stat and restore all use the same base path. Assert the recorded
   paths are identical across the three, so a future change cannot split them.
5. A worktree that could not be resolved falls back to today's behaviour rather
   than throwing, and the outcome still reports honestly.
6. Every existing directive-runner test still passes untouched. That suite is
   141 cases and it is the safety net for this change.

---

## Verify, and paste what you actually saw

Pinned Node only. System Node v26 crashes at teardown AFTER tests pass and the
runner counts that as a failed suite. `--only` filters on the BASE FILENAME:
`--only directive-runner` works; a path with a slash silently selects zero suites
and still prints `passed`.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/directive-runner.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 now and must still be 86/86.

## Budget

Your prompt carries a stated wall and nothing unwritten survives it. If it does
not fit, land the resolution and tests 1 to 3, say plainly what is missing, and
stop. Getting `filesChanged` to be true when work happened is the whole point;
the rest can follow.

## Deliver

1. What changed, and what `filesChanged` would now report for tonight's KOL-81
   execution.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
