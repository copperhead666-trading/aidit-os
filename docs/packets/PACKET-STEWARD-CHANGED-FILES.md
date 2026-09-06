# PACKET-STEWARD-CHANGED-FILES — the steward counts files the lane never touched

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

`merge-steward` spawns one `node --check` per changed `.mjs` file, per worktree,
every heartbeat sweep. Measured on the owner's machine tonight:

```
lane-w4          94 changed .mjs
lane-w3          94 changed .mjs
lane-w2          94 changed .mjs
lane-harness     94 changed .mjs
lane-corleone-vp 61 changed .mjs
lane-sjahrir      4
lane-corleone     4
lane-hatta        2
                ---
                447 node --check spawns per sweep
```

About five process spawns per second for 85 seconds, which is what the owner sees
as terminal windows flashing: 80 `conhost.exe` created per minute while every
lane sat idle.

**441 of those 447 are spent on worktrees the lane never wrote.** The first five
are abandoned branches. Their file list is computed against `origin/main`, so
every file main has changed since they were left behind is counted as theirs.
`lane-w2` reports `aheadOfMain: 0, uncommitted: 1, changedFiles: 145` -- one real
uncommitted file, and 144 that main moved underneath it.

The steward is meant to review what a lane DID. Diffing a stale checkout against
a moved main answers a different question nobody asked.

---

## Files you may edit - no others

- `ops-watcher/merge-steward.mjs`
- `ops-watcher/merge-steward.regression.test.mjs`

---

## What to change

In `gatherFacts`, the changed-file list must describe what this worktree
contributed, not how far main has moved. That is:

- the files it has uncommitted right now, plus
- the files in its commits that are ahead of `origin/main`.

When `aheadOfMain` is 0, the answer is exactly the uncommitted files. Nothing
else. A stale branch with one dirty file has one changed file.

`aheadOfMain` itself is already computed correctly with
`rev-list --count origin/main..HEAD`; keep it. Only the FILE LIST changes.

Use git rather than arithmetic on two lists: `diff --name-only` against the
worktree's own `HEAD` gives the uncommitted set, and `diff --name-only
origin/main...HEAD` (three dots, the merge base) gives what the branch added
without counting what main did. Untracked files must still appear -- a lane that
adds a new module and no test must still be caught by
`tests-accompany-behaviour`, and `git status --porcelain` is where untracked
files live.

Every git call keeps `-c safe.directory=<cwd>` and `windowsHide: true`, exactly
as the module does today. A worktree owned by the sandbox user must still be
answerable, and nothing here may put a window on the owner's screen.

---

## Tests - required

Inject the exec. No test may touch a real worktree.

1. `aheadOfMain: 0` with two uncommitted files yields exactly those two, never a
   list drawn from `origin/main`.
2. `aheadOfMain: 0` with NO uncommitted files stays `idle`, and no syntax check
   is attempted. Assert the injected exec was never asked to run `node --check`.
3. A branch ahead by two commits reports the union of its own commits' files and
   its uncommitted files, with no duplicates.
4. An untracked new file appears in the list, so `tests-accompany-behaviour` can
   still see a new module that arrived without a test.
5. The three-dot form is used for the ahead-of-main comparison. Assert on the
   recorded git arguments: a two-dot `origin/main..HEAD` for the file list is the
   bug being fixed and must not come back.
6. Every git invocation still begins with `-c safe.directory=` and still passes
   `windowsHide: true`.
7. A git call that fails still yields `unknown` with a reason, never `clean`.

---

## Verify, and paste what you actually saw

Pinned Node only. `--only` filters on the BASE FILENAME: `--only merge-steward`
works; a path containing a slash silently selects zero suites and still prints
`passed`.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/merge-steward.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 now and must still be 86/86.

Then, if you can, run the real thing and paste the timing:

```
node ops-watcher/merge-steward.mjs --once --no-suite
```

It takes about 85 seconds today. The point of this change is that it should not.

## Budget

Your prompt carries a stated wall and nothing unwritten survives it. You have
landed two packets tonight, both this shape. If it does not fit, land the file
list and tests 1 to 3, say plainly what is missing, and stop.

## Deliver

1. What changed, and what `lane-w2` now reports.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
