# PACKET-HONOUR-THE-REFUSAL — the guard speaks and nobody listens

Role: SJAHRIR (kimi quota permitting; otherwise CORLEONE). Implement and test.
**Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

This is a defect in a packet I wrote earlier tonight, not in the work any lane
did on it. The return shape was specified; that callers must obey it was not.

`ensureLaneWorktree` now refuses a worktree that is both dirty and stale. Asked
about CORLEONE at 19:30 it answered exactly right:

```
isolated: false
dirty: 2   behind: 40
reason: existing worktree is dirty (2 uncommitted entries) and stale (40 commits
        behind origin/main); refusing to run a lane against old code
        (checked out on "lane/hands", not "lane/corleone")
```

CORLEONE had already run against that worktree six minutes earlier and the
monitor recorded `LANE OK`.

Every dispatcher does the same thing with the flag:

```js
// corleone-dispatch.mjs:331
if (!workspace.isolated) process.stderr.write(`corleone-dispatch: ${workspace.reason}\n`);
// sjahrir-dispatch.mjs:182
if (!workspace.isolated) process.stderr.write(`sjahrir-dispatch: ${workspace.reason}\n`);
```

It logs, and it proceeds. That was correct under the OLD contract, and the
comment above each line says so: `isolated:false` used to mean only "I fell back
to the shared repository root", which is degraded but usable, and refusing there
would have stopped work for no safety gain.

The same flag now carries a second, incompatible meaning: "I am refusing, do not
run". One boolean, two meanings, and the callers only implement the older one.

**A refusal nobody honours is not a refusal.** It is a log line, and this whole
night has been about the difference.

---

## Files you may edit - no others

- `ops-watcher/lane-worktree.mjs`
- `ops-watcher/lane-worktree.regression.test.mjs`
- `ops-watcher/corleone-dispatch.mjs`
- `ops-watcher/sjahrir-dispatch.mjs`
- `ops-watcher/hatta-dispatch.mjs`
- the matching `*.regression.test.mjs` for each dispatcher you change

Check `ops-watcher/directive-runner.mjs` too: it imports `ensureLaneWorktree`.
If it consults the result at all, it belongs in this list; if it does not, say so
in your report and change nothing there.

---

## What to change

### 1. Separate the two meanings

`isolated: false` must stop meaning two things. Add a distinct field that says
the caller must not run -- name it plainly, `usable: false` or `refused: true`,
and write one line saying why the existing flag could not carry it.

Keep `isolated` meaning exactly what it has always meant: whether the path handed
back is a lane's own worktree or the shared root. Existing callers that only read
`isolated` must keep behaving as they do today for the fallback case. That case is
NOT a refusal and must not become one: falling back to the shared root is how a
lane still gets work done when a worktree cannot be made.

Only the dirty-and-stale case is a refusal.

### 2. Make the dispatchers stop

Each dispatcher, on a refusal, must not spawn the lane. It exits with the reason
on stderr, as a lane failure with a stated cause -- the same shape a lane timeout
already produces, so the monitor and `lane-usage.jsonl` see a failure rather than
silence. Find how each dispatcher reports a pre-spawn failure today and follow
it; do not invent a new shape per file.

A refusal must never look like `LANE OK`.

### 3. Do not add an override

There is no flag to force a run past a refusal. If one existed it would be used,
and then the guard would be decorative again. If a worktree is dirty and stale a
human syncs it; that is a thirty-second job and it is the right one.

---

## Tests - required

In `lane-worktree.regression.test.mjs`:
1. Dirty and stale: the new refusal field is set, and `isolated` is whatever it
   is today for that path -- assert both explicitly so the two meanings cannot
   drift back together.
2. Fallback to the shared root (worktree cannot be made): `isolated:false` and
   the refusal field NOT set. This is the case that must keep working.
3. Clean and current, and dirty but current: no refusal.

For each dispatcher you change:
4. Given a refusing `ensureLaneWorktree`, the lane process is never spawned.
   Assert on the spawn dependency, not on log text.
5. Given a fallback (`isolated:false`, no refusal), the lane IS spawned, exactly
   as today.
6. The refusal is reported as a failure with its reason, not as success.

7. Every existing test in every file you touch still passes. The ops-watcher
   suite is 86/86 and must stay there.

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/lane-worktree.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/corleone-dispatch.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/sjahrir-dispatch.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/hatta-dispatch.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

## Budget

Five files is more than one packet usually carries, and the reason is that a
half-applied version is worse than none: a refusal honoured by two dispatchers
and ignored by the third teaches that the guard is unreliable.

If the budget runs short, land part 1 and ONE dispatcher, say plainly which
dispatchers are still ignoring the refusal, and stop. Naming them is what makes
the gap safe to leave overnight.

## Deliver

1. The new field's name and the one-line reason `isolated` could not carry it.
2. Which dispatchers now honour the refusal and which do not yet.
3. Whether `directive-runner.mjs` consults the result at all.
4. The exact test output, pasted.

Do not commit. Do not push.
