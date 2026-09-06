# PACKET-MERGE-STEWARD-S2 — put the steward on the heartbeat

Role: HATTA. Small, tested edit. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`) in everything you write. Do not type the
em-dash character.

---

## Why this exists

`ops-watcher/merge-steward.mjs` landed today. It verifies each lane worktree's
diff and reports idle / clean / blocked / unknown without merging anything. It
works, and it only runs when a person types the command - which is exactly the
dependency it was built to remove.

This packet puts it on the heartbeat, where it runs every sweep under PM2 whether
or not a session exists.

---

## Files you may edit - no others

- `ops-watcher/heartbeat.mjs`
- `ops-watcher/heartbeat.regression.test.mjs`

Do not touch `merge-steward.mjs`, any dispatcher, or any other file.

---

## What to change

### 1. Export the step list

In `ops-watcher/heartbeat.mjs`, line 197 currently reads:

```js
const STEPS = [
```

Change it to:

```js
export const STEPS = [
```

That single word is the whole reason a test can prove anything here. Right now
the regression suite keeps its OWN copy of the step list as a fixture, so it
asserts against a list it wrote itself: the real pipeline could lose a step and
every test would still pass. Exporting it lets the suite check the thing that
actually runs.

### 2. Add the step, last

The list ends with:

```js
  { name: "directive-runner",  argv: ["ops-watcher/directive-runner.mjs", "--once"] },
];
```

Add one entry after `directive-runner`, keeping the existing column alignment:

```js
  { name: "merge-steward",     argv: ["ops-watcher/merge-steward.mjs", "--once"] },
];
```

LAST, on purpose. It reports on what the other steps have produced, so it must
observe the sweep rather than run in the middle of it.

---

## Tests - required

In `ops-watcher/heartbeat.regression.test.mjs`, import the REAL `STEPS` from
`./heartbeat.mjs` (the file's own local `STEPS` fixture stays exactly as it is -
do not delete or modify it, the existing tests drive the sweep with it).

Add tests that assert, against the REAL exported list:

1. It contains a step named `merge-steward`, and that step's argv is
   `["ops-watcher/merge-steward.mjs", "--once"]`.
2. `merge-steward` is the LAST entry.
3. Every step name in the real list is unique.
4. Every step's argv[0] is a path under `ops-watcher/` ending in `.mjs`. The
   list's own comment says it is a hand-maintained safe pipeline that a stray
   file must never sneak into; this is that sentence as a check.

Do not assert a specific total number of steps. A test that says "19" has to be
edited every time the pipeline grows, and a test everyone edits by reflex stops
being a test.

---

## One thing to know, and NOT to fix here

A full `merge-steward --once` sweep measured 85 seconds across the eleven lane
worktrees on this machine. The heartbeat's per-step cap is 600000 ms, so that
fits with room to spare.

It fits today because every worktree is currently blocked by a cheap check before
the expensive one: `merge-steward` runs the full test suite only for a worktree
that passed the other four checks. If several worktrees ever become clean at
once, each adds roughly another 90 seconds and the step could approach that cap.

That is real, and it is NOT this packet's job. Do not add a cap, a flag, or a
timeout to `merge-steward.mjs`. Just be aware the number is not permanent.

---

## Verify, and paste what you actually saw

Use the pinned Node. System Node v26 crashes at teardown AFTER tests pass and the
runner counts that as a failed suite.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/heartbeat.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The full suite is 86/86 before your change and must still be 86/86 after.

## Budget

Your prompt carries a stated wall and nothing you have not written to disk
survives it. This is one exported word, one list entry, and four assertions.
It should take you minutes, not the whole budget. If you find yourself past half
the budget still reading, stop reading and write.

## Deliver

1. What changed, in two or three sentences.
2. The exact test output for both commands, pasted, not summarised.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
