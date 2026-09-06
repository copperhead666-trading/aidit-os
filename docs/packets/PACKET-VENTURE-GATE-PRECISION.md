# PACKET-VENTURE-GATE-PRECISION — the fence keeps its boundary and loses its false match

Role: CORLEONE. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character: the
patch tool has failed on it repeatedly and cost two runs their whole budget.

---

## Read this first, because it decides what you may not do

This file changes a SAFETY GATE. The boundary it guards is the owner's, recorded
in `knowledge/store/notes/`: any write to a venture repository is his decision,
never an agent's. **That boundary does not move in this packet.** A plan that
genuinely asks to commit, push, rebase or reset must still be refused, and if
your change makes the gate accept one, the change is wrong no matter how clean it
looks.

What is wrong is the gate's PRECISION, not its policy.

---

## Why this exists

KOL-92 was a directive to fix a false positive. It was refused before the owner
ever saw it, by a different false positive:

```
Alasan: rencana gagal validasi aman directive-runner tahap 1 (file-scope-out-of-scope)
Pelanggaran: plan asks for a git write: "Memperbaiki false positive deteksi
secret-shaped-literals pada git SHA di merge-steward ..." -- no commit to or push
from a venture repository
```

The pattern in `ops-watcher/venture-gate.mjs` line 307 is:

```js
const GIT_WRITE_VERBS = /\bgit\b[^\n]*\b(push|commit|merge|rebase|reset|cherry-pick|tag|am|apply|revert)\b/i;
```

The plan said `git SHA di merge-steward`. A hyphen is a non-word character, so
the `merge` inside the module name `merge-steward` is bounded on both sides and
matches. The gate concluded the plan wanted a venture write. The directive
touched no venture at all.

This is structural now, not a one-off. `merge-steward` is a permanent heartbeat
step, so any plan naming it on a line that also carries the word `git` is
refused. And a `PLAN_REFUSED` comment is terminal: the issue is classified
`rejected` forever and never re-planned, whatever the attempt counter says. So
each false match permanently kills a directive.

---

## Files you may edit - no others

- `ops-watcher/venture-gate.mjs`
- `ops-watcher/venture-gate.regression.test.mjs`

Do not touch `directive-runner.mjs`, `merge-steward.mjs`, or any other file.

---

## What to change

Make the match require the verb to be an actual command word rather than a
fragment of a hyphenated identifier. The intent is: catch `git commit`,
`git push --force`, `git merge main`, `git reset --hard`, and the same verbs
separated from `git` by flags or words on one line. Do not catch `merge-steward`,
`cherry-pick-helper`, `apply-patch.mjs`, or any other hyphenated name.

How you express that is yours. A verb that is immediately preceded or followed by
a hyphen is the distinguishing feature, and JavaScript supports lookbehind. Do
not solve it by deleting verbs from the list.

Keep `compareVentureGitPosition` exactly as it is. The header already says why:
that is the check which actually holds, because it does not depend on the plan
saying what it will do. This pattern is only the cheap pre-flight.

---

## Tests - required

These are the point of the packet. Write the refusals first.

**MUST STILL REFUSE** (each its own assertion):
1. `git commit -m "x"` inside a step.
2. `git push origin main`.
3. `git merge main` in a plan objective.
4. `git reset --hard HEAD~1`.
5. `jalankan git rebase lalu git push` -- Indonesian prose around the verbs.
6. `git -C ventures/caveman-trading-os commit` -- flags between `git` and verb.
7. A verb reached through several words: `git ... then commit the result`, on one
   line, must still be caught. State in a comment which of these you kept
   deliberately, since widening the gap between `git` and the verb is what makes
   the pattern loose.

**MUST NO LONGER REFUSE**:
8. The exact KOL-92 sentence: `Memperbaiki false positive deteksi
   secret-shaped-literals pada git SHA di merge-steward sambil mempertahankan
   deteksi kredensial`.
9. `perbarui ops-watcher/merge-steward.mjs dan jalankan git status`. `status` is
   not a write verb, and the module name must not create one.
10. `baca git log lalu perbaiki apply-patch-helper.mjs`.
11. A plan with no `git` word at all and a hyphenated name containing `reset`,
    for example `reset-guard.mjs`.

**SHAPE, unchanged**:
12. `checkPlanForVentureGitWrites` still returns `{ ok, violations }`, still
    reads `plan.steps`, `plan.verify` and `plan.objective`, still never throws on
    a null, undefined, numeric or array plan, and a refusal message still names
    what was matched.

---

## Verify, and paste what you actually saw

Pinned Node only. System Node v26 crashes at teardown AFTER tests pass and the
runner counts that as a failed suite. Note that `--only` filters on the BASE
FILENAME: `--only venture-gate` works, and a path containing a slash silently
selects zero suites while still printing `passed`.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/venture-gate.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 now and must still be 86/86.

## Budget

Your prompt carries a stated wall and nothing unwritten survives it. This is one
regular expression and a table of assertions. If it does not fit, land the
pattern with the refusal tests 1 to 7 and the KOL-92 sentence, and say plainly
what is missing. The refusals matter more than the acceptances: a gate that stops
refusing is a worse outcome than a gate that still over-refuses.

## Deliver

1. The pattern you settled on and, in one sentence, why it cannot be widened by
   accident.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push. Do not edit a file outside the two listed.
