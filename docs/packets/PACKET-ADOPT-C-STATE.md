# PACKET-ADOPT-C-STATE — what Bennett already wrote for state, ledger and ventures

Role: lane executor. **READ ONLY except for the one report file named below.**
Do not commit. Do not push. Do not edit any Aidit OS source file.

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

Aidit OS was built from a description of the six-layer agent stack rather than
from the code the description came from. That code is now vendored at
`vendor/founderos-demo/` (MIT, upstream commit d5e565e).

Your job is not to integrate anything yet. It is to say, precisely and with file
names, what upstream already solves that we rebuilt, and where the two designs
genuinely disagree.

## Your area: state, the event ledger, the venture registry

Read upstream:

```
vendor/founderos-demo/lib/ledger.ts
vendor/founderos-demo/lib/ventures.ts
vendor/founderos-demo/lib/schemas.ts
vendor/founderos-demo/lib/db.ts
vendor/founderos-demo/lib/data.ts
vendor/founderos-demo/lib/operating-metrics.ts
```

Compare against ours:

```
ops-watcher/ledger.mjs
ops-watcher/ledger-schema.mjs
ops-watcher/ledger-writer.mjs
ops-watcher/projections.mjs
ops-watcher/reconcile.mjs
config/ventures.json
```

Read upstream properly and SKIM ours. Depth on upstream, breadth on ours.

Two facts you should have before you start, because they shape the comparison:

- Our ledger is an append-only JSONL event log with a single writer and a
  projection folded from it. `reconcile.mjs` exists to catch the projection and
  the parser disagreeing. Whether upstream has anything answering that question
  at all is one of the more useful things this report can settle.
- `config/ventures.json` carries a rule of its own: a metric is QUOTED from a
  source and never chosen by an agent, and it stays null until the owner states
  one. Check whether upstream's venture model has any equivalent discipline, or
  whether numbers are simply written.

## The one file you may write

`docs/adoption/C-state.md`. Create it. Nothing else.

## What the report must contain

Four sections, in this order. Be concrete: name files, functions, line numbers.

1. **ADOPT** -- things upstream does that we do not, worth taking. Upstream file
   and symbol, what it does, which of our files would host it, what it replaces
   or adds. An empty ADOPT section is a real finding, not a failure.

2. **CONVERGE** -- things both sides do, where upstream's shape is better or
   simply different. Upstream is TypeScript on Next.js over SQLite; we are plain
   ESM `.mjs` over JSONL plus a Paperclip REST board. Say when a good idea is
   welded to SQLite, and what lifting it out would cost.

3. **KEEP** -- things we do that upstream does not, that must survive any
   integration. The single-writer ledger, the fold, reconcile, and the
   quoted-metric rule are all deliberate. If upstream has no equivalent, that is
   worth knowing before anyone adopts over the top of it.

4. **CONFLICT** -- places where adopting upstream would break something of ours
   that exists for a reason. Do not leave this empty because it is easier.

## Rules

- Quote what you actually read. Do not describe a file you did not open.
- If a file named above does not exist, say so and move on. Do not guess.
- Do not edit `vendor/founderos-demo/`.
- Do not edit any Aidit OS source file in this run.

## Budget

You have a hard wall. Write the report as you go rather than reading everything
first and writing at the end. A report covering four upstream files well beats a
survey of six.

## Deliver

The report file, plus in your final message: the three most important lines of
it, and anything in this packet that turned out to be wrong.
