# PACKET-ADOPT-E-ROSTER — the roster, the skills and the SOPs nobody surveyed

Role: HATTA. **READ ONLY except for the one report file named below.**
Do not commit. Do not push. Do not edit any Aidit OS source file.

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists, and why it is a correction

Three surveys ran against the vendored upstream and none opened the roster, the
skills catalogue or the SOP playbooks. On the strength of one survey the
integrator told the owner upstream was "a business dashboard, not an agentic
system". The owner rejected that and he was right: what went unread was a
531-line agent roster, a 202-line skills catalogue, 751 lines of SOP playbooks
and forty-two API routes including `agents/[id]/run` and `agents/broadcast`.

Survey A already read `conductor.ts`, `runtime.ts` and `activity.ts`, and found a
uniform `RuntimeAgent` contract returning `{ ok, summary, data }`. It did NOT
read `real.ts`, which is where the actual agents live, and it dismissed that file
in one line as "business-specific". Check whether that dismissal holds.

## Read upstream — these four, properly

```
vendor/founderos-demo/lib/agents/real.ts
vendor/founderos-demo/lib/skills-catalog.ts
vendor/founderos-demo/lib/sop-playbooks.ts
vendor/founderos-demo/lib/agents/runtime.ts
```

`real.ts` and `sop-playbooks.ts` are long. Read the SHAPE of them at depth --
how an agent is declared, what a `run()` actually does, how a playbook is
structured and what it is for -- and sample the individual entries rather than
reading all of them. The question is not what Bennett's marketing agent does. It
is how the system says what an agent IS and what it KNOWS.

## Compare against ours

```
ops-watcher/specialists.mjs
agents/specialists/            (list it; read two files, not twenty)
```

You have a hard ceiling of forty tool calls. Six files is the budget. Write the
report as you go: on the last survey of this shape you spent all forty calls and
wrote nothing, which is why that one was re-routed.

## The one file you may write

`docs/adoption/E-roster.md`. Create it. Nothing else.

## What the report must contain

Four NAMED sections -- **ADOPT**, **CONVERGE**, **KEEP**, **CONFLICT** -- with a
file and a line number on both sides of every claim. Use the names. The last
report you wrote used its own structure and the KEEP question it was meant to
force went unanswered.

1. **ADOPT** -- what upstream has that we do not. The specific question worth
   settling: our specialists are markdown files loaded into a prompt when a task
   class matches, and nothing more. Upstream's agents are objects with a `run()`
   that does work. Is upstream's SOP playbook a prompt, a data structure, or
   executable steps? That difference decides whether our specialist design is a
   simpler version of the same idea or a different thing wearing the same word.

2. **CONVERGE** -- how each side declares what an agent is and what it knows.
   Ours: `TASK_CLASS_KEYWORDS` to `TASK_CLASS_SPECIALISTS` to a markdown file.
   Upstream: a roster entry with an id, a department and a `run()`. Which shape
   answers "what can this agent do" better, and why.

3. **KEEP** -- what we do that upstream does not. Two candidates to test rather
   than assume: our specialists cost nothing until a task class matches, whereas
   a roster loaded at startup pays for every agent every time; and our lanes are
   separate processes with their own worktrees, whereas upstream's agents are
   functions in one process. Say whether upstream has any equivalent isolation.

4. **CONFLICT** -- what adopting upstream's roster would break. Survey A already
   noted that CORLEONE holds the conductor role here and upstream declares a
   conductor agent of its own. Check whether the roster assumes a single process,
   a database, or a live LLM call at declaration time.

## Rules

- Quote what you actually read. Do not describe a file you did not open.
- If `real.ts` turns out to be genuinely business-specific and survey A was
  right, say so plainly. A confirmed dismissal is a real finding.
- Do not edit anything under `vendor/`.
- Do not edit any Aidit OS source file in this run.

## Deliver

The report, plus in your final message: whether our specialist design is the same
idea as upstream's SOPs or a different one, and anything in this packet that
turned out to be wrong.
