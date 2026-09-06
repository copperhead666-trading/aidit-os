# PACKET-LANE-BASE-REVISION — a lane must not run against a tree from last week

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

Measured on this machine tonight, across every lane worktree:

```
lane-corleone     branch=lane/hands              behind_main=10    dirty=2
lane-corleone-vp  branch=lane/corleone-measure   behind_main=80    dirty=0
lane-harness      branch=lane/harness-history    behind_main=151   dirty=0
lane-hatta        branch=lane/p0-probe           behind_main=13    dirty=6
lane-sjahrir      branch=lane/p0-selfrepair      behind_main=1     dirty=3
lane-w2           branch=lane/w2-corleone-dispatch behind_main=140 dirty=1
```

A HATTA dispatch that ran against `lane-hatta` in that state reported
`"model":"glm-5.3:cloud"`. The tier table that puts HATTA on `glm-5.1:cloud` had
been merged to main hours earlier. The lane was executing a copy of
`hatta/harness.mjs` from thirteen commits ago, and reported success.

That is the failure this packet is about: **a lane can run, pass, and report,
against a system that no longer exists.** Every verdict it produces is about a
phantom, and nothing in the current code says so.

Two separate defects produce it.

### Defect 1: the returned branch is not checked

`ensureLaneWorktree` computes `branch = branchNameFor(lane)` and, on the reuse
path, returns that value without ever asking what the worktree is actually
checked out on. For HATTA it returned `lane/hatta` while the checkout sat on
`lane/p0-probe`. The caller is handed a name that is simply false.

The collision has a cause worth knowing: the branches `lane/hatta`,
`lane/sjahrir` and `lane/corleone` were held by a second set of worktrees nested
at `D:/AI/worktrees/worktrees/`, created under a different Windows account
(`CodexSandboxOffline`). Git will not check out a branch that is already checked
out in another worktree, so the real lane worktrees were put on unrelated
branches instead, and the mismatch has been live ever since.

### Defect 2: staleness is never measured

The reuse path measures dirt and reports it. That check exists, its comment is
right, and the refusal to delete a lane's uncommitted work must stay exactly as
it is.

But dirt and staleness are different problems. Dirt is work that exists and must
not be destroyed. Staleness is a base revision that is wrong, and updating it
usually touches no uncommitted file at all. Nothing measures it today.

---

## Files you may edit - no others

- `ops-watcher/lane-worktree.mjs`
- `ops-watcher/lane-worktree.regression.test.mjs`

---

## What to change

`ensureLaneWorktree` keeps its current contract: **it never throws**, and it
**never deletes an uncommitted file**. Both are load-bearing. Everything below
adds information and one refusal; it removes no guarantee.

### 1. Report the base revision

Add to the returned object:

- `head` -- the commit the worktree is actually on.
- `checkedOutBranch` -- what it is really on, which may differ from `branch`.
- `behind` -- how many commits `origin/main` is ahead of it.

`behind` must be `null`, not `0`, when it cannot be determined. A number that
means "I could not tell" is how this class of bug survives, and this module was
written to end that class of bug.

### 2. Fast-forward when it is safe

When the worktree is clean (`dirty === 0`) and `behind > 0`, fast-forward it to
`origin/main` before returning. Fast-forward only. If it is not a fast-forward,
do not force it and do not merge: report and let rule 3 decide.

Report what happened in `reason`, with the numbers in it.

### 3. Refuse instead of running against a phantom

When the worktree is dirty AND stale, `ensureLaneWorktree` must NOT hand back a
usable workspace. Return `isolated: false` with a `reason` naming both numbers,
the same shape it already uses for its other refusals, so the dispatcher declines
rather than running old code.

Do not clean it. Do not stash. The uncommitted work is the only copy and the
existing comment says why. Refusing is the correct outcome: it makes a human
look, which is what the situation deserves.

Choose the threshold deliberately and write your reasoning in the code comment.
`behind > 0` with dirt is defensible; so is a small tolerance. What is not
defensible is silence.

### 4. Say when the branch is not the branch

When `checkedOutBranch` differs from `branch`, that must appear in `reason`
whatever else happens. Do not switch branches to fix it -- a checkout would
discard or carry uncommitted work across branches, and that is exactly the
destruction this module refuses to do.

---

## Tests - required

The suite must not touch a real worktree. `ensureLaneWorktree` already takes
`_exec` and `_fs`; drive everything through them.

1. Clean and 5 behind: fast-forwarded, `behind` reported, `isolated: true`.
2. Clean and current: no fast-forward attempted, `behind: 0`.
3. Dirty and current: reused as today, `isolated: true`, dirt still reported.
   This is the existing behaviour and it must not regress.
4. Dirty and behind: `isolated: false`, and `reason` contains both the dirt count
   and the behind count.
5. `checkedOutBranch` differs from `branch`: reported in `reason`, and no
   checkout or branch switch is executed. Assert on the commands `_exec` received.
6. The rev-list that computes `behind` fails: `behind` is `null`, the function
   still returns, and it still does not throw.
7. A newly created worktree reports `behind: 0` and `created: true`.
8. Nothing in this module ever deletes a file. Assert no destructive git verb
   (`clean`, `reset`, `checkout --`, `stash`) is passed to `_exec` on any path.

---

## Verify, and paste what you actually saw

Pinned Node only. `--only` filters on the BASE FILENAME.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/lane-worktree.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 and must stay there.

## Budget

If the budget runs short, land rules 1 and 2 with tests 1, 2, 6 and 7, say
plainly that the refusal is not done, and stop. Measuring staleness is worth more
than acting on it: a number in a log lets a human catch this, silence does not.

## Deliver

1. The returned object's new fields, and the threshold you chose in rule 3 with
   your reasoning.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
