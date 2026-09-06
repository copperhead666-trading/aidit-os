# PACKET-LEDGER-EXECUTION-DONE — one name for finished, not two

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## This corrects a mistake in the previous packet, not in your work

The last packet told you to add a completion kind to the schema. You did, and you
stopped at the boundary it drew and reported where the fold lives. That was
right.

The packet itself was wrong. It never checked whether a completion kind already
existed. One does:

```
ops-watcher/ledger-schema.mjs:53    EXECUTION_DONE: "execution.done"
ops-watcher/projections.mjs:353     case KINDS.EXECUTION_DONE: acc.executionsDone++
ops-watcher/projections.mjs:439     if (status === "done" || acc.executionsDone > 0)
                                      -> state "done", reason "result marker present"
```

So the fold has been able to reach `done` all along, through `execution.done`.
Its reason string even says "result marker present" -- the author expected that
marker to arrive as this kind. **Nothing has ever emitted it.**

`directive.completed`, added on the previous packet, is a second name for the
same fact. Two names for one state is how a projection and a parser drift apart,
which is the very thing reconcile exists to catch.

---

## Files you may edit - no others

- `ops-watcher/ledger-schema.mjs`
- `ops-watcher/ledger-writer.mjs`
- `ops-watcher/ledger-writer.regression.test.mjs`

`ops-watcher/projections.mjs` needs no change and must not be touched. That is
the point of this correction: the fold was already right.

---

## What to change

1. `ledger-writer.mjs` emits `KINDS.EXECUTION_DONE` for a `RESULT_MARKER`
   comment, instead of `KINDS.DIRECTIVE_COMPLETED`. Everything else about the
   emission stays as you built it -- the imported marker, the idempotency, the
   DIRECTIVE-label check, the skip on malformed bodies.

2. Remove `DIRECTIVE_COMPLETED` from `ledger-schema.mjs`. It was added on a
   wrong instruction and nothing else references it. If you find that something
   does reference it, stop and report that instead of leaving both.

3. Update the tests you wrote so they assert `execution.done`. Keep every case;
   only the expected kind changes.

Check the schema's own terminal-kind set at `ledger-schema.mjs:183`
(`new Set([KINDS.EXECUTION_DONE, KINDS.DECISION_REJECTED])`) and say in your
report whether emitting this kind now makes that set behave differently than it
did before. Do not change it; just say what you found.

---

## Tests - required

1. A `DIRECTIVE RESULT` comment yields exactly one `execution.done` event.
2. Running the writer twice does not emit it twice.
3. An issue without the DIRECTIVE label produces no such event.
4. The fold reports `done` for an issue whose events include `execution.done`.
   Use the real `foldDirectives` from `ops-watcher/projections.mjs` -- importing
   it to test is fine; editing it is not.
5. A directive with `plan_posted` but no completion is still NOT `done`.
6. `directive.completed` no longer appears anywhere in the codebase.
7. Everything previously emitted is unchanged.

---

## Verify, and paste what you actually saw

Pinned Node only. `--only` filters on the BASE FILENAME.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/ledger-writer.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

Suite is 86/86 and must stay there.

**The suite passing is still not the proof.** Run:

```
node ops-watcher/ledger-writer.mjs --once
node ops-watcher/reconcile.mjs --once
```

and paste the `projection-vs-parser` line. It currently reads FAIL with
`KOL-93: fold=approved parser=done`. If your change is right it reads OK. If it
does not, say so plainly.

## Budget

Small: one kind swapped, one removed, tests renamed. You have landed four packets
tonight.

## Deliver

1. The `projection-vs-parser` line after your change.
2. The exact test output, pasted.
3. What you found about the terminal-kind set at ledger-schema.mjs:183.

Do not commit. Do not push.
