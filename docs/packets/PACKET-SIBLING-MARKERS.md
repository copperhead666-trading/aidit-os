# PACKET-SIBLING-MARKERS — the same accident, twice more, and one of them is permanent

Role: HATTA. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

Two conditions in one function, both the same shape as the one you already
fixed. Read the file once, make the edits, run the suite.

---

## Why this exists

You found these yourself on the last packet and reported them without changing
them, which was right. This packet is the decision that follows.

`classifyDirective` in `ops-watcher/directive-runner.mjs` still has two marker
tests that match anywhere in a comment body:

```
line 445   cmts.some((c) => bodyOf(c).includes(REFUSED_MARKER))   -> state "rejected"
line 465   cmts.some((c) => bodyOf(c).includes(DISPATCH_MARKER))  -> feeds "stalled"
```

The done marker had the identical shape until it was anchored an hour ago,
because a retraction that quoted a report re-closed the issue it was retracting.

`REFUSED_MARKER` is the more serious of the two. **`rejected` is terminal** --
it is returned before the attempt counter is even consulted, so a directive
classified that way stays rejected regardless of anything that happens
afterwards. A comment that merely quotes a refusal, in a summary, a handover
note, or a correction, would bury the directive permanently and there would be
no obvious way to bring it back.

---

## Files you may edit - no others

- `ops-watcher/directive-runner.mjs`
- `ops-watcher/directive-runner.regression.test.mjs`

Only those two conditions inside `classifyDirective`. Do not touch the
`RESULT_MARKER` condition you already anchored, the comment builders, or the
`includes` checks that PARSE a comment rather than classify an issue -- the ones
around lines 242-245, 313, 316, 393 and 1018. Those read a body that is already
known to be of that kind; they are a different job.

---

## What to change

Both conditions match only when the trimmed body STARTS with the marker, exactly
as you did for `RESULT_MARKER`.

Before you change `DISPATCH_MARKER`, check where its comment is produced and
confirm the marker really does open the body. If it does not -- if something
writes a dispatch marker mid-body on purpose -- then anchoring it would break a
real path. In that case leave `DISPATCH_MARKER` alone, fix only `REFUSED_MARKER`,
and say what you found. Do not guess: find the writer.

`REFUSED_MARKER` you can check the same way. `PLAN_REFUSED` comments are built in
this same file.

---

## Tests - required

Must classify as `rejected`:
1. A comment whose trimmed body starts with the refusal marker.
2. The same behind a leading newline and spaces.

Must NOT classify as `rejected`:
3. A comment that quotes the refusal marker in the middle of a longer body --
   write it as a realistic handover note or correction that reproduces an earlier
   refusal under a heading, not as a one-word string. This is the case that would
   otherwise bury a directive forever.

For `DISPATCH_MARKER`, only if you confirmed it is safe to anchor:
4. A body starting with the dispatch marker still behaves as it does today.
5. A body quoting it mid-text no longer does.

6. Every case already asserted in `directive-runner.regression.test.mjs` still
   passes. It is 205 passed 0 failed and must grow, not shrink. If an existing
   test relied on a mid-body marker, that is a real finding: say so and leave it
   failing rather than editing the test to agree with you.

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/directive-runner.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

run-all-tests is 86/86 and must stay there.

## Deliver

1. The two conditions as you wrote them, or one plus the reason the other was
   left alone.
2. Where `DISPATCH_MARKER` comments are written, and whether the marker opens the
   body there.
3. The cases above with the classification you measured.
4. The exact test output, pasted.

Do not commit. Do not push.
