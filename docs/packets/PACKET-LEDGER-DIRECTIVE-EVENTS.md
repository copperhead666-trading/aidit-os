# PACKET-LEDGER-DIRECTIVE-EVENTS — the ledger never learned that a plan was posted

Role: CORLEONE. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character: the
patch tool has failed on it repeatedly and cost two runs their whole budget.

---

## Why this exists

`reconcile --once` fails, and it will keep failing forever without this change:

```
reconcile projection-vs-parser: FAIL expected=0 actual=2
detail=KOL-92: fold=new parser=rejected; KOL-93: fold=new parser=awaiting-approval
```

`projectionVsParserCheck` compares two views of every DIRECTIVE issue. The parser
reads the board's comments. The fold replays the ledger. They disagree because
the ledger has no idea a plan was ever posted or refused.

`ops-watcher/ledger-schema.mjs` already defines the kinds:

```
DIRECTIVE_PLAN_POSTED:       "directive.plan_posted"
DIRECTIVE_PLAN_REFUSED:      "directive.plan_refused"
DIRECTIVE_PLAN_PARSE_FAILED: "directive.plan_parse_failed"
```

and `foldDirectives` already consumes them. But `ops-watcher/ledger-writer.mjs`
emits only `directive.created`, `card.sent`, `issue.status_changed`, and the four
owner-decision kinds. Nothing ever writes the plan kinds, so the fold sees a
directive created and never moved, and reports `new` forever.

This was invisible until 2026-09-06 because no directive had ever reached
`awaiting-approval` before. The first successful use of the loop exposed it.

Left alone, the heartbeat stays at 18/19 permanently and the reconcile alarm
becomes noise -- which reconcile.mjs's own comments say is worse than no check.

---

## Files you may edit - no others

- `ops-watcher/ledger-writer.mjs`
- `ops-watcher/ledger-writer.regression.test.mjs`

Do not touch `ledger-schema.mjs`, `reconcile.mjs`, `directive-runner.mjs`, or the
fold. The kinds and the fold are already correct; only the writer is missing.

---

## What to change

`ledger-writer.mjs` already has exactly the right shape for this, at line 45:

```js
const DECISION_MARKERS = Object.freeze([
  { prefix: "OWNER MENYETUJUI via Telegram", kind: KINDS.DECISION_APPROVED },
  ...
]);
```

Follow that pattern. A directive comment's body decides the kind:

| comment body starts with | kind |
|---|---|
| `PLAN_REFUSED` | `KINDS.DIRECTIVE_PLAN_REFUSED` |
| `DIRECTIVE PLAN APPROVED` | leave alone, the owner-decision markers already cover approval |
| `DIRECTIVE PLAN REJECTED` | leave alone, same reason |
| `DIRECTIVE PLAN` | `KINDS.DIRECTIVE_PLAN_POSTED` |

**ORDER MATTERS AND IS THE ONE TRAP HERE.** `DIRECTIVE PLAN APPROVED` and
`DIRECTIVE PLAN REJECTED` both start with `DIRECTIVE PLAN`. A naive prefix table
would classify an approval as a plan posting. Match the longer, more specific
prefixes first, or exclude them explicitly. The markers are exported from
`directive-runner.mjs` as `PLAN_MARKER`, `APPROVED_MARKER`, `REJECTED_MARKER` and
`REFUSED_MARKER`; import them rather than retyping the strings, so a change there
cannot silently desynchronise this.

Emit the event with the same shape the existing emissions use: the issue id, the
identifier, the comment's timestamp, and whatever the surrounding code already
attaches for idempotency. Study how `card.sent` and the decision kinds build
their identity and match it -- an event that is re-emitted on every sweep would
be worse than the missing one.

Everything else about the writer stays as it is. It must remain crash-proof, and
a comment it cannot parse must be skipped rather than fatal.

---

## Tests - required

1. A comment body starting `DIRECTIVE PLAN (2026-09-06T11:16:12.894Z):` yields
   one `directive.plan_posted` event for that issue.
2. A comment body starting `PLAN_REFUSED (2026-09-06T11:18:15.603Z):` yields one
   `directive.plan_refused` event.
3. `DIRECTIVE PLAN APPROVED` and `DIRECTIVE PLAN REJECTED` do **not** produce a
   `directive.plan_posted` event. Assert this explicitly. It is the trap.
4. Running the writer twice over the same comments does not emit the event twice.
5. An issue with no DIRECTIVE label produces neither kind.
6. A malformed or empty comment body is skipped and does not throw.
7. The events already emitted -- `directive.created`, `card.sent`,
   `issue.status_changed`, and the four owner-decision kinds -- are unchanged.
   The existing suite covers most of this; make sure it still passes untouched.

---

## Verify, and paste what you actually saw

Pinned Node only. System Node v26 crashes at teardown AFTER tests pass and the
runner counts that as a failed suite. Note also that `--only` filters on the
BASE FILENAME, so `--only ledger-writer` works and a path with a slash silently
selects zero suites and still prints `passed`.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/ledger-writer.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 now and must still be 86/86.

## Budget

Your prompt carries a stated wall and nothing unwritten survives it. This is a
marker table plus its tests. If it does not fit, land the writer change and its
tests for cases 1 to 3 and say plainly what is missing.

## Deliver

1. What changed, in two or three sentences.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push. Do not edit a file outside the two listed.
