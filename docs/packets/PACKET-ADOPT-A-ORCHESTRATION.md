# PACKET-ADOPT-A-ORCHESTRATION — what Bennett already wrote that we rebuilt

Role: lane executor. **READ ONLY except for the one report file named below.**
Do not commit. Do not push. Do not edit any Aidit OS source file.

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

Aidit OS has been measured against Bennett's six-layer agent stack for weeks.
The benchmark document was never in this repository -- it was transcribed from a
web page into a packet -- and every layer was then built from that description
instead of adopted from the code the description came from. That code is now
vendored at `vendor/founderos-demo/` (MIT, upstream commit d5e565e).

Your job is not to integrate anything yet. It is to say, precisely and with file
names, what upstream already solves that we rebuilt, and where the two designs
genuinely disagree.

## Your area: orchestration, agents, scheduling

Read upstream:

```
vendor/founderos-demo/lib/agents/conductor.ts
vendor/founderos-demo/lib/agents/runtime.ts
vendor/founderos-demo/lib/agents/real.ts
vendor/founderos-demo/lib/agents/activity.ts
vendor/founderos-demo/lib/hierarchy.ts
vendor/founderos-demo/lib/cron.ts
vendor/founderos-demo/AGENTS.md
vendor/founderos-demo/CLAUDE.md
```

Compare against ours:

```
ops-watcher/ahmad-dispatch.mjs
ops-watcher/routing.mjs
ops-watcher/specialists.mjs
ops-watcher/lane-worktree.mjs
ops-watcher/heartbeat.mjs
ops-watcher/directive-runner.mjs   (skim: it is large, read its header comment)
```

You will not finish reading all of that at full depth. Read the upstream files
properly and SKIM ours -- our header comments are long and say what each module
is for. Depth on upstream, breadth on ours.

## The one file you may write

`docs/adoption/A-orchestration.md`. Create it. Nothing else.

## What the report must contain

Four sections, in this order. Be concrete: name files, functions, line numbers.

1. **ADOPT** -- things upstream does that we do not, worth taking. For each: the
   upstream file and symbol, what it does, which of our files would host it, and
   what it would replace or add. If nothing qualifies, say so plainly; an empty
   ADOPT section is a real finding, not a failure.

2. **CONVERGE** -- things both sides do, where upstream's shape is better or
   simply different. For each: how each side does it, and which you would keep
   and why. Note that upstream is TypeScript on Next.js with SQLite, and we are
   plain ESM `.mjs` with a Paperclip REST board. A good idea that arrives welded
   to Next.js is not automatically adoptable; say when that is the case.

3. **KEEP** -- things we do that upstream does not, that must survive any
   integration. Our lane worktree isolation, the dirty-and-stale refusal, the
   content-hash change detection and the marker anchoring were all built this
   week to fix real failures. If upstream has no equivalent, that is worth
   knowing before anyone "adopts" over the top of it.

4. **CONFLICT** -- places where adopting upstream would break something of ours
   that exists for a reason. This section protects the work; do not leave it
   empty just because it is easier.

## Rules

- Quote what you actually read. Do not describe a file you did not open.
- If a file named above does not exist, say so and move on. Do not guess.
- Do not edit `vendor/founderos-demo/` -- it is a reference point, and a diff
  against upstream has to stay readable.
- Do not edit any Aidit OS source file in this run.

## Budget

You have a hard wall. Write the report as you go rather than reading everything
first and writing at the end -- two lanes lost finished work to that wall this
week. A report covering five upstream files well beats a survey of eight.

## Deliver

The report file, plus in your final message: the three most important lines of
it, and anything in this packet that turned out to be wrong.
