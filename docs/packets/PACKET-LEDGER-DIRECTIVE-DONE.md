# PACKET-LEDGER-DIRECTIVE-DONE — the ledger has no word for a directive that finished

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

`reconcile --once` fails:

```
projection-vs-parser: FAIL expected=0 actual=1
detail=KOL-93: fold=approved parser=done
```

`classifyDirective` calls a directive `done` when a comment carries
`RESULT_MARKER` ("DIRECTIVE RESULT") or the issue status is done. The ledger fold
has no way to reach that state, because **`ops-watcher/ledger-schema.mjs` defines
no directive-completion kind at all**:

```
DIRECTIVE_CREATED, DIRECTIVE_PLAN_POSTED, DIRECTIVE_PLAN_REFUSED,
DIRECTIVE_PLAN_PARSE_FAILED, DIRECTIVE_UNEXECUTABLE
```

Created, planned, refused, unexecutable -- and nothing for finished.

This is not a cosmetic gap and it is not caused by the one issue that exposed it.
The whole point of the directive loop is that a directive completes. **The first
genuinely successful execution will turn reconcile red and keep it red**, exactly
as the plan-transition gap did earlier tonight until it was closed. A check that
always fails is noise, which reconcile.mjs's own comments call worse than no
check.

Earlier tonight `directive.plan_posted` and `directive.plan_refused` were added
to `ledger-writer.mjs` for the same reason. This is the missing third case, and
it is the one that matters most because it is the success path.

---

## Files you may edit - no others

- `ops-watcher/ledger-schema.mjs`
- `ops-watcher/ledger-writer.mjs`
- `ops-watcher/ledger-writer.regression.test.mjs`

Do not touch `reconcile.mjs`, `directive-runner.mjs`, or the fold's own module
unless the fold lives inside one of the files above -- find where `foldDirectives`
is defined before assuming. If it is elsewhere, stop and say so rather than
editing a file this packet does not list.

---

## What to change

### 1. Name the state

Add a completion kind to `ledger-schema.mjs` alongside the existing directive
kinds. Follow the naming already there: the kinds read as facts that happened
(`directive.plan_posted`), never as instructions. `directive.completed` or
`directive.done` both fit; pick one and be consistent.

The schema file's own header explains why the kinds live in one module rather
than being invented per caller. Respect that: one name, one place.

### 2. Emit it

`ledger-writer.mjs` already carries two marker tables -- `DECISION_MARKERS` for
the owner's Telegram taps, and the directive-plan table added earlier tonight.
Add the completion marker the same way.

The marker is `RESULT_MARKER`, exported from `ops-watcher/directive-runner.mjs`
as the string `"DIRECTIVE RESULT"`. **Import it rather than retyping it**, for
the same reason the plan markers are imported: a change there must not silently
desynchronise this.

Watch the same ordering trap that the plan markers hit: check longer, more
specific prefixes before shorter ones if any overlap exists. Verify whether one
does before assuming it does not.

Idempotency matters as much as emission. Running the writer twice over the same
comments must not produce the event twice; the existing directive-plan handling
already solves this and is the pattern to follow.

### 3. Make the fold reach `done`

Emitting an event nobody folds changes nothing. Find where the directive fold
maps kinds to states and make the completion kind produce the same state the
parser produces (`done`). If the fold is not in the files this packet lists, stop
and report where it is.

---

## Tests - required

1. A comment body starting `DIRECTIVE RESULT` yields exactly one completion
   event for that issue.
2. Running the writer twice over the same comments does not emit it twice.
3. An issue without the DIRECTIVE label produces no completion event.
4. The fold reports `done` for an issue whose events include the completion kind.
5. A directive with plan_posted but no completion is still NOT `done`.
6. The events already emitted -- created, plan_posted, plan_refused, card.sent,
   issue.status_changed and the four owner-decision kinds -- are unchanged.
7. A malformed or empty comment body is skipped and does not throw.

---

## Verify, and paste what you actually saw

Pinned Node only. `--only` filters on the BASE FILENAME.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/ledger-writer.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 and must stay there.

**A passing suite is not the proof here.** The proof is that reconcile goes
green. After the suite passes, run:

```
node ops-watcher/ledger-writer.mjs --once
node ops-watcher/reconcile.mjs --once
```

and paste the `projection-vs-parser` line. It currently reads FAIL with
`KOL-93: fold=approved parser=done`. If it still fails after your change, say so
plainly rather than reporting the green suite as success -- that distinction is
the entire lesson of tonight.

## Budget

Your prompt carries a stated wall and nothing unwritten survives it. You have
landed three packets tonight. If it does not fit, land the kind and the emission
with tests 1 to 3, say plainly that the fold mapping is not done, and stop.

## Deliver

1. What changed, and the `projection-vs-parser` line after your change.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong -- including where the
   fold actually lives if it is not where this packet assumed.

Do not commit. Do not push.
