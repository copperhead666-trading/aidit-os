# PACKET-EXECUTOR-CONTENT-NOT-MTIME — a rewritten file is not a changed file

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

Tonight KOL-81 executed autonomously and posted:

```
DIRECTIVE RESULT (2026-09-06T16:37:27.427Z): directive telah dikerjakan dan diverifikasi.
File yang berubah:
- config/ventures.json
Perintah verifikasi: node ops-watcher/verify-file.mjs --path config/ventures.json --matches "metrik_terakhir"
Baris terakhir output verifikasi:
VERIFY OK config/ventures.json (5750 bytes)
```

Nothing was written. Measured immediately afterwards, in main and in every lane
worktree, `config/ventures.json` is 5750 bytes and the `caveman-trading-os` entry
still has no `metrik_terakhir`. Git reports the file unmodified everywhere.

This is the worst failure shape a system can have. A lane that fails says so. A
directive that reports `dikerjakan dan diverifikasi` for work that did not happen
teaches the owner to trust a signal that means nothing, and it closes the issue.

Two independent defects produced it. Both are in scope.

### Defect 1: change is measured by size and mtime, not by content

`countChangedFiles` in `ops-watcher/directive-runner.mjs`:

```js
if (b.size !== a.size || b.mtimeMs !== a.mtimeMs) changed.push(files[i]);
```

A model that reads a file and writes back byte-identical text updates the mtime
and changes nothing. That is an ordinary outcome, not an exotic one: it is what
happens whenever a lane decides the file already says what it should.

`doneResultComment` and `noOpComment` are both already correct and neither needs
changing. `noOpComment` exists precisely for this case and it should have fired.
It did not, because the measurement lied to it.

### Defect 2: the verification proves nothing about the change

`--matches "metrik_terakhir"` was satisfied by the `sjs-superapps` entry, which
has carried that key since before this directive existed. The pattern matched a
different part of the file than the one the directive was about, on a file that
had not changed.

A verify command that passes identically before and after the work is not a
verification. It cannot be fixed by choosing better patterns each time, because
the plan chooses the pattern and the plan is written by the thing being checked.

---

## Files you may edit - no others

- `ops-watcher/directive-runner.mjs`
- `ops-watcher/directive-runner.regression.test.mjs`

---

## What to change

### 1. Compare content

`statEntry` and `countChangedFiles` must compare a hash of the file's bytes.
Keep `size` if you find it useful, but size and mtime alone must never be enough
to call a file changed.

- A file that does not exist before and does after: changed.
- A file that exists before and not after: changed.
- Identical bytes, different mtime: **not** changed.
- Neither readable before nor after: not changed, and it must not throw.

A file large enough to be awkward to hash is not a concern here: the planned file
list is small and these are source files. Do not add a size cap that silently
falls back to mtime -- a silent fallback would restore the bug for exactly the
files where it matters most.

### 2. Run the verification before the work as well as after

Run the plan's verify command once before dispatching the lane, and once after.
Record both.

- Passes before AND after, with no file content changed: this is a no-op. Report
  it as one.
- Fails before, passes after: this is the real success shape.
- Passes before and after, but content DID change: still a success -- the lane
  changed something the pattern does not observe -- but say so in the result
  comment, naming that the verification did not distinguish the two states.

Do not turn "passed before" into a failure on its own. Some verifications are
idempotent by nature and a directive may legitimately be re-run. The point is to
stop treating an unchanged pass as evidence.

If running the verify command twice is not safe for some command shape you find
while implementing this, stop and say so in your report rather than working
around it.

### 3. Say which fact each claim rests on

The `done` comment must state the measured changed files, which it already does,
and it must not list a file the measurement did not find changed.

---

## Tests - required

1. Identical bytes rewritten with a new mtime: `changed` is empty and the outcome
   is the no-op comment, not the done comment.
2. Content genuinely different: `changed` names the file and the done comment is
   used.
3. File created by the lane where none existed: changed.
4. File deleted by the lane: changed.
5. A file unreadable both before and after: not changed, and nothing throws.
6. Verify passes before and after with no content change: reported as a no-op.
7. Verify fails before and passes after: reported as done.
8. Verify passes before and after but content changed: reported as done, and the
   comment says the verification did not distinguish the states.
9. The existing done, no-op and failure comment shapes are otherwise unchanged.
   `RESULT_MARKER` must still appear ONLY in the done comment -- classifyDirective
   keys on that, and a marker leaking into the no-op comment would close a
   directive that did nothing, which is this whole bug again in a new place.

---

## Verify, and paste what you actually saw

Pinned Node only. `--only` filters on the BASE FILENAME.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/directive-runner.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 and must stay there.

## Budget

You have landed six packets tonight and one of them timed out at 480s with the
work already written and the suite already green -- the wall is real, so write
the code before writing prose about it.

If the budget runs short, land defect 1 with tests 1 to 5, say plainly that the
before-and-after verification is not done, and stop. Defect 1 is the one that
turns a lie into a no-op.

## Deliver

1. What changed, and the hash you chose with one line on why.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
