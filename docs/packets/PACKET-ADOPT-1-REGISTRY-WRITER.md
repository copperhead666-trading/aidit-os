# PACKET-ADOPT-1-REGISTRY-WRITER — the registry's rules are prose; make them a writer

Role: lane executor. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this is the first thing adopted, of everything the three surveys found

The three adoption surveys are in `docs/adoption/`. Read `C-state.md` before you
start; it is short and it names the line numbers this packet rests on.

What they found, in one paragraph: upstream's ledger is a bank-statement table
and ours is an event log, so there is nothing to adopt there. Upstream's ventures
are a UI lens with no status and no owner gates, so adopting that shape would
delete routing authority. Upstream's brain generates nested docs our indexer
cannot see. The genuinely adoptable thing is smaller and it appears in survey C
as a pattern rather than a file: **upstream binds writes to a schema at the
repository boundary** -- `vendor/founderos-demo/lib/schemas.ts:84-92` defines the
shape, `vendor/founderos-demo/lib/db.ts:484-495` parses on the way in, and every
write goes through that one object.

We have the opposite. `config/ventures.json` states four rules about itself, in
its own `rules` array:

- `tujuan` is QUOTED from a source, never summarised into an agent's own words.
- `metrik` stays null until the owner states one.
- `hardStops` are boundaries somebody already wrote down, each with its source.
- `owner_decision_required` lists what is always the owner's.

Every one of those is enforced by prose. Nothing checks them. A lane edits the
JSON by hand and the rules are advice.

This week has been one long demonstration of what that costs. A guard that only
speaks is a log line: the executor measured change by mtime and reported work
that never happened; the dirty-and-stale refusal was honoured by nobody until it
was made to return a field callers act on; three separate name-matching rules
were too coarse in different directions. The registry rules are the same shape of
thing, still unenforced.

So: adopt the pattern upstream actually has, on the file whose rules we actually
wrote down.

---

## Files you may create or edit - no others

- `ops-watcher/ventures-registry.mjs` (new)
- `ops-watcher/ventures-registry.regression.test.mjs` (new)

Do NOT edit `config/ventures.json` itself in this run. Do NOT edit any other
module to call this yet. A writer with no caller is not dead weight here -- the
next packet wires it -- but a half-wired one is worse than none.

Do not edit anything under `vendor/`.

---

## What to build

A module that owns reads and writes of `config/ventures.json`, and refuses
writes that break the file's own rules.

### 1. Read

Export a read that parses the file and returns the ventures. If the JSON is
malformed, return an error result rather than throwing -- this file is read on
paths that must not crash.

### 2. Validate

Export a validate function taking a venture object and returning what is wrong
with it, as a list, not a boolean. Callers need to tell the owner which rule
failed.

The rules, taken from the file's own `rules` array and from the shapes already
in it:

- `id` is a non-empty string.
- `status` is present.
- `tujuan` requires a non-empty `tujuan_sumber`. A goal with no source is exactly
  what rule one forbids.
- `metrik` may be null. If `metrik` is a non-empty string then `metrik_sumber`
  must be non-empty too.
- `metrik_terakhir`, when present, must be an object with `nilai`, `dari`,
  `pada`, `sumber`. `nilai` may be `null` -- that is a measurement result, not a
  missing field, and the caveman-trading-os entry written tonight is the worked
  example. `sumber` must be non-empty: a number with no source is the invented
  metric the rule forbids.
- `nilai` must be `null` or a number. A numeric string is not a number; say so
  rather than coercing.
- Every entry in `hardStops`, if present, must carry its source. Look at how the
  existing entries express that before deciding what "carry" means -- read the
  file, do not assume a field name.

### 3. Write

Export a write that validates before writing and returns an error result instead
of writing when validation fails. Never write a partially valid file.

Preserve what you did not change: key order, the `rules` array, `schema_version`,
`purpose`, and any field on a venture this module does not know about. A writer
that silently drops an unrecognised field is a data loss bug, and this registry
has fields that were added by hand.

Write atomically -- write beside the file and rename -- so a crash mid-write
cannot leave the registry truncated. `ops-watcher/ledger.mjs` already solves this
problem for the ledger; read how it does it and follow that rather than inventing
a second approach.

---

## Tests - required

1. Reading the real `config/ventures.json` returns both ventures and no error.
   This is the one test that touches the real file, and it is read-only.
2. Malformed JSON returns an error result and does not throw.
3. A venture with `tujuan` and no `tujuan_sumber` fails validation, and the
   message names the rule.
4. `metrik: null` passes. A non-empty `metrik` with no `metrik_sumber` fails.
5. `metrik_terakhir` with `nilai: null` and a source PASSES -- assert this
   explicitly, it is the shape written tonight and a naive "required number"
   check would reject it.
6. `metrik_terakhir` with a number and no `sumber` fails.
7. `nilai: "22"` fails. Not coerced, not accepted.
8. A write that fails validation leaves the file byte-identical. Compare content,
   not mtime -- mtime comparison is exactly the bug that made a directive report
   work it never did.
9. A successful write preserves an unrecognised field that was present before.
10. Validation returns a LIST of problems: an entry breaking two rules reports
    both, not just the first.

Drive the filesystem through injected dependencies for everything except test 1.
The suite must not write to the real registry.

---

## Verify, and paste what you actually saw

Pinned Node only.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/ventures-registry.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

`run-all-tests.mjs` discovers `*.regression.test.mjs` in `ops-watcher/`, so your
new file joins the suite: it is 86/86 today and must become 87/87, all passing.
If it does not pick your file up, say so -- that is a finding about the runner,
not something to work around.

## Budget

One new module and its tests. If it runs short, land read and validate with
tests 1 to 7, say plainly that the write side is not done, and stop. Validation
alone is already worth having: it lets the next thing that touches this file be
checked.

## Deliver

1. The validation rules as you implemented them, and any rule in this packet you
   could not express against the real file's shape.
2. The ten cases above with the result you measured.
3. The exact test output, pasted, including the new suite count.
4. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
