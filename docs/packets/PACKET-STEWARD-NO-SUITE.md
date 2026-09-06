# PACKET-STEWARD-NO-SUITE — the steward stops running a whole test suite every five minutes

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character: the
patch tool has failed on it repeatedly and cost two runs their whole budget.

---

## Why this exists

`merge-steward` joined the heartbeat at 18:14 on 2026-09-06. It runs the FULL
test suite inside every lane worktree that passed its four cheap checks, and
`run-all-tests.mjs` spawns one process per test file -- about 86 of them, in a
burst, per qualifying worktree, every five minutes.

Measured on the owner's machine with all lanes idle, over 60 seconds:

```
  80x  conhost.exe created
  64x  node.exe spawned by node.exe
       node --check D:\AI\worktrees\lane-w2\ops-watcher\...
       node D:\AI\worktrees\lane-sjahrir\ops-watcher\watcher.regression.test.mjs
```

Sweeps went from 31s median to 171s. And it gets worse as lanes get cleaner:
each newly-qualifying worktree adds another full suite.

This is duplicated work. The heartbeat already runs `test-runner` as its own
step. The steward's job on the sweep is the cheap structural verdict; paying for
a second full suite per worktree buys nothing the pipeline did not already have.

---

## Files you may edit - no others

- `ops-watcher/merge-steward.mjs`
- `ops-watcher/merge-steward.regression.test.mjs`
- `ops-watcher/heartbeat.mjs`
- `ops-watcher/heartbeat.regression.test.mjs`

---

## What to change

### 1. A flag that skips the expensive check

`merge-steward.mjs` already parses `--once` and `--json` in `parseArgs`. Add
`--no-suite`.

When it is given, the `suite` check is not run and is reported as **skipped**,
not as passed. A verdict that silently drops a check it never ran is the exact
failure this module was written to avoid: unknown must never look like clean.

Choose an honest shape for that. `verdict: "clean"` must NOT be returned for a
worktree whose suite was never run. Something like `verdict: "unverified"` with
the four cheap checks listed and the suite marked skipped is what is wanted --
the reader must be able to tell "checked and good" from "cheaply checked, suite
not run".

Without the flag, behaviour is exactly as it is today. That is asserted.

### 2. The heartbeat uses the flag

In `ops-watcher/heartbeat.mjs`, the last STEPS entry is:

```js
  { name: "merge-steward",     argv: ["ops-watcher/merge-steward.mjs", "--once"] },
```

Add `--no-suite` to that argv. Nothing else in the step list changes.

---

## Tests - required

1. `parseArgs` recognises `--no-suite`, and its absence leaves today's default.
2. With the flag, the injected suite runner is NEVER called. Assert on the
   injected dependency, not on output text.
3. With the flag, a worktree that passes all four cheap checks is NOT reported
   as `clean`, and its suite check is present and marked skipped.
4. Without the flag, the suite still runs and a passing worktree is still
   `clean`. Today's behaviour must be provably unchanged.
5. A worktree blocked by a cheap check is still `blocked` either way, and the
   suite is not run in either case -- it never was, when an earlier check failed.
6. The real exported heartbeat `STEPS` still ends with `merge-steward`, and its
   argv is now exactly `["ops-watcher/merge-steward.mjs", "--once", "--no-suite"]`.
   The existing H13 test asserts the old argv; update it, do not delete it.

---

## Verify, and paste what you actually saw

Pinned Node only. System Node v26 crashes at teardown AFTER tests pass and the
runner counts that as a failed suite. `--only` filters on the BASE FILENAME, so
`--only merge-steward` works and a path containing a slash silently selects zero
suites while still printing `passed`.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/merge-steward.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/heartbeat.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 now and must still be 86/86.

## Budget

Your prompt carries a stated wall and nothing unwritten survives it. This is one
flag, one argv entry, and six assertions. If it does not fit, land the flag and
tests 1 to 4, say plainly that the heartbeat argv is not updated, and stop.

## Deliver

1. What changed, and what a reader now sees for a worktree whose suite was not
   run.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
