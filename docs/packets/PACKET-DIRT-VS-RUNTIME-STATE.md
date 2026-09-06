# PACKET-DIRT-VS-RUNTIME-STATE — the ledger makes every worktree permanently dirty

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

This is a consequence of a change merged tonight, not a pre-existing bug, and it
should be fixed before it bites.

`ensureLaneWorktree` now refuses a worktree that is both dirty and stale. That
refusal is correct: running a lane against old code while its uncommitted work
sits unseen is how a verdict ends up describing a system that no longer exists.

But `state/ledger.jsonl` is tracked in git AND appended to at runtime. Measured
in `lane-hatta` just now:

```
state/ledger.jsonl | 18 ++++++++++++++++++
1 file changed, 18 insertions(+)
```

Eighteen appended event lines, no source change. Every lane worktree carries this
permanently. So the moment a lane also falls behind main -- which is the ordinary
state of a worktree between syncs -- the refusal fires on dirt that is not work
and never was.

A guard that blocks ordinary operation gets switched off, and then the real
protection is gone with it.

---

## Files you may edit - no others

- `ops-watcher/lane-worktree.mjs`
- `ops-watcher/lane-worktree.regression.test.mjs`

---

## What to change

`dirtyEntryCount` must distinguish uncommitted WORK from runtime STATE.

Introduce an explicit, named list of runtime-state paths that do not count as
dirt. Start with `state/ledger.jsonl` and add only what you can show is written
by a running process rather than by a lane. Say in your report what you added and
the evidence for each.

Requirements:

- The list is explicit paths, not a pattern like "anything under state/". A
  pattern would silently excuse a future file that IS work.
- A worktree whose only modification is a runtime-state path counts as **clean**,
  and the reason string should say so rather than reporting zero silently. An
  operator reading the log should be able to tell "clean" from "dirty only in
  runtime state".
- Real work plus runtime state is still dirty, and the count is of the real work
  only.
- Untracked files still count as dirt. A lane that wrote a new file has done
  work, whatever the file is called.

Do not change the refusal rule itself, the fast-forward, the never-throw
guarantee, or the never-delete guarantee. This packet narrows what counts as
dirt; it removes no protection.

---

## Tests - required

1. Only `state/ledger.jsonl` modified: clean, and the reason names runtime state.
2. `state/ledger.jsonl` plus a real source file modified: dirty, count is 1.
3. Only real source files modified: unchanged from today.
4. An untracked file present: still dirty.
5. Clean and stale with only runtime-state dirt: fast-forwarded, not refused.
   This is the case that motivates the packet -- assert it directly.
6. Real work plus stale: still refused, both numbers still named.
7. An unanswerable git still yields the existing unknown-dirt behaviour and does
   not throw.
8. Everything already asserted in the suite still passes, W15 included: no path
   runs clean, reset, checkout --, stash or switch.

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/lane-worktree.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The lane-worktree suite is 20 passed 0 failed and must grow. run-all-tests is
86/86 and must stay there.

## Budget

Small. Write the code before writing prose about it: two of your runs tonight had
the work finished and the suite green and were still cut off at the 480s wall
while explaining.

## Deliver

1. The runtime-state list, with the evidence for each entry.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
