# DIRECTIVE-KOL-81 — count what the source actually records, and say so when it records nothing

Role: lane executor. Implement. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists, and why it failed before

`config/ventures.json` gives `caveman-trading-os` the metric:

> Phase-1 workstreams meeting their Definition of Done, out of 9

`metrik_terakhir` is absent for this venture. `sjs-superapps` has one and this
venture does not, so the registry cannot answer its own question.

This directive was attempted twice on 2026-09-04 and failed both times with
`plan is too short`. The cause was not the lane. Paperclip truncates an issue
description at 1200 characters, and this issue's description was cut mid-word at
`--path confi`, so the verification command the lane was told to run never
arrived. The specification now lives in this file, and the issue description
points here.

---

## The source, in full

`ventures/caveman-trading-os/docs/planning/phase-1-workstreams.md` is a nine-row
markdown table with the columns `Priority | Workstream | Dependency | Definition
of done`.

Read it yourself. Do not take this summary as the source.

---

## What to write

Add `metrik_terakhir` to the `caveman-trading-os` entry in
`config/ventures.json`, matching the shape already used by `sjs-superapps`:

```json
"metrik_terakhir": { "nilai": ..., "dari": 9, "pada": "...", "sumber": "..." }
```

**The count must be quoted from the document, never chosen.** This is the
registry's own first rule, in `config/ventures.json` under `rules`: a metric an
agent picked would make the owner's system optimise for something he never asked
for.

So read the table and answer one question honestly: **does it record, for any
workstream, that its Definition of Done has been met?** A Definition of Done is
a criterion. Recording that a criterion is satisfied is a different fact, and a
table may state the first without ever stating the second.

- If the document does record completion for some rows, `nilai` is that count,
  and `sumber` names the column or marker you read it from.
- If it records completion for none of them, `nilai` is `null`, not `0`. Zero
  asserts a measurement was made and came out empty. `null` says the source does
  not carry the fact. Those are different claims and only one of them is true.

Either way, add a `catatan` field to `metrik_terakhir` stating in one or two
sentences what the document does and does not record, and what would have to
exist in it for the numerator to become countable. Write it in Bahasa Indonesia,
matching the surrounding entries.

`pada` is today's date. `sumber` names the file path you read.

## Do not

- Do not edit `metrik`, `metrik_status`, `metrik_sumber` or `metrik_catatan`.
  They are the owner's statement and are not yours to revise.
- Do not touch the `sjs-superapps` entry.
- Do not write anything inside `ventures/`. That repository is read-only to every
  lane: no commit, no push, no file written there.
- Do not edit any file other than `config/ventures.json`.

## Verify

```
node ops-watcher/verify-file.mjs --path config/ventures.json --matches "metrik_terakhir"
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The JSON must still parse. The suite is 86/86 and must stay there.

## Deliver

1. The exact `metrik_terakhir` object you wrote.
2. The sentence from the source document that justifies your `nilai`, quoted --
   or, if `nilai` is null, a plain statement that no such sentence exists.
3. The verification output, pasted.

Do not commit. Do not push.
