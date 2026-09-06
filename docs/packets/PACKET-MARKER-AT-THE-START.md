# PACKET-MARKER-AT-THE-START — quoting a report should not re-file it

Role: HATTA. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

One condition, one function. Read the file once, make the edit, run the suite.

---

## Why this exists

`classifyDirective` in `ops-watcher/directive-runner.mjs` decides a directive is
finished like this:

```js
if (status === "done" || cmts.some((c) => bodyOf(c).includes(RESULT_MARKER))) {
```

`includes`, anywhere in the body. So a comment that merely QUOTES a result
closes the directive.

This is not hypothetical. Last night a directive posted a result claiming work
that had not happened. The retraction comment quoted the false report verbatim so
nothing would be lost -- and the quote carried the marker, so the retraction
itself re-closed the issue it was retracting. The text had to be mangled to
`D-I-R-E-C-T-I-V-E R-E-S-U-L-T` to make the correction stick, which is a silly
thing to have to do and will not occur to the next person.

Every comment this system generates puts its marker FIRST:
`doneResultComment` starts with `RESULT_MARKER`, `noOpComment` starts with
`DIRECTIVE NO-OP`, `failureComment` with `DIRECTIVE GAGAL`. Anchoring the check
to the start therefore loses nothing real and removes the whole class of accident.

---

## Files you may edit - no others

- `ops-watcher/directive-runner.mjs`
- `ops-watcher/directive-runner.regression.test.mjs`

Only the `RESULT_MARKER` condition inside `classifyDirective`. Do not touch the
comment builders, the plan markers, the decision markers, or `REFUSED_MARKER`.

---

## What to change

The done test matches only when the trimmed comment body STARTS with
`RESULT_MARKER`. Trim leading whitespace first: a comment stored with a leading
newline is still a report.

Leave `status === "done"` exactly as it is. That branch is independent.

Search the file for other `includes(` checks on a marker and say in your report
which ones you found and whether the same accident is possible there. **Do not
change them in this packet** -- naming them is the deliverable, fixing them is a
separate decision.

---

## Tests - required

Must classify as `done`:
1. A comment whose body starts with `DIRECTIVE RESULT`.
2. The same with a leading newline and spaces before it.
3. An issue with `status: "done"` and no result comment at all.

Must NOT classify as `done`:
4. A comment that quotes the marker in the middle of a longer body -- for example
   a retraction that reproduces the original report under a heading. This is the
   case the packet exists for; write it as a realistic retraction, not as a
   one-word string.
5. A comment mentioning the words in prose without it being a report.

6. Every case already asserted in `directive-runner.regression.test.mjs` still
   passes. It is 204 passed 0 failed today and must grow, not shrink. If any
   existing test relied on a mid-body marker, that is a real finding: say so and
   leave it failing rather than editing the test to agree with you.

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/directive-runner.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

run-all-tests is 86/86 and must stay there.

## Deliver

1. The condition as you wrote it.
2. The five cases above, each with the classification you measured.
3. The other `includes(` marker checks you found, and whether the same accident
   is possible there.
4. The exact test output, pasted.

Do not commit. Do not push.
