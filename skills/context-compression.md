# context-compression (SJAHRIR core skill)

Knows when to use compact summaries vs full detail; prevents context dilution on handoff;
produces minimal-sufficient handoff text.

How this org actually runs it:
- The whole skill-bootstrap design exists because dumping the entire skill library into every
  agent's context dilutes it. Apply the same principle to handoffs: give the next agent what it
  needs for THIS task, not everything.
- A task packet should carry: objective, scope, acceptance criteria, canonical pointers, safety
  constraints, and a scoped "Loaded skills" section (core for the role + only the matching
  task-specific hints). Nothing else.
- Prefer a one-line description + a pointer to the full file over inlining the whole file.
- When you are unsure a task-specific skill applies, omit it — the agent still has its core.
  No harm from omission; real harm from context dilution.