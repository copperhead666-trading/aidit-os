# PACKET-ADOPT-B-KNOWLEDGE — what Bennett already wrote for the brain

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

## Your area: knowledge, memory, the graph

Read upstream:

```
vendor/founderos-demo/lib/knowledge-graph.ts
vendor/founderos-demo/lib/memory-core.ts
vendor/founderos-demo/lib/memory-search.ts
vendor/founderos-demo/lib/brain.ts
vendor/founderos-demo/lib/brain-docs.ts
vendor/founderos-demo/lib/brain-graph.ts
vendor/founderos-demo/lib/graph-lens.ts
vendor/founderos-demo/lib/agent-wiki.ts
```

Compare against ours:

```
ops-watcher/gbrain.mjs
ops-watcher/gbrain-curator.mjs
ops-watcher/graphify-refresh.mjs
ops-watcher/graphify-analyst.mjs
knowledge/store/notes/          (list it; read two or three notes, not all)
```

Read upstream properly and SKIM ours -- our header comments say what each module
is for. Depth on upstream, breadth on ours.

One fact you should have before you start, because it shapes the comparison:
gbrain indexes `knowledge/store/notes/*.md` only. It indexes documents, not code.
A question about the codebase does not reach it. Whether upstream has the same
split, or indexes code too, is one of the more useful things this report can
settle.

## The one file you may write

`docs/adoption/B-knowledge.md`. Create it. Nothing else.

## What the report must contain

Four sections, in this order. Be concrete: name files, functions, line numbers.

1. **ADOPT** -- things upstream does that we do not, worth taking. Upstream file
   and symbol, what it does, which of our files would host it, what it replaces
   or adds. An empty ADOPT section is a real finding, not a failure.

2. **CONVERGE** -- things both sides do, where upstream's shape is better or
   simply different. Upstream is TypeScript on Next.js with SQLite; we are plain
   ESM `.mjs` over a file store. A good idea welded to SQLite or to React is not
   automatically adoptable -- say when that is the case, and say what the idea
   would cost to lift out.

3. **KEEP** -- things we do that upstream does not, that must survive any
   integration. In particular: our rule that gbrain is canonical for business
   documents while ruflo memory holds only operational traces, and that a
   canonical document is never mirrored into memory. If upstream blurs that, say
   so; it was an owner decision, not an accident.

4. **CONFLICT** -- places where adopting upstream would break something of ours
   that exists for a reason. Do not leave this empty because it is easier.

## Rules

- Quote what you actually read. Do not describe a file you did not open.
- If a file named above does not exist, say so and move on. Do not guess.
- Do not edit `vendor/founderos-demo/`.
- Do not edit any Aidit OS source file in this run.

## Budget

You have a hard wall. Write the report as you go rather than reading everything
first and writing at the end -- lanes lost finished work to that wall this week.
A report covering five upstream files well beats a survey of eight.

## Deliver

The report file, plus in your final message: the three most important lines of
it, and anything in this packet that turned out to be wrong.
