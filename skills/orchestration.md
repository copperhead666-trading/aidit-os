# orchestration (AHMAD core skill)

Coordinates multi-agent dispatch, task lifecycle, and state tracking across running workers.

How this org actually runs it:
- AHMAD writes a plain-text task packet (the prompt file) and hands it to a harness/CLI
  (Claude Code CLI, hermes, or Kimi Code CLI). There is NO formal task-packet-standard.md
  in this workspace — a packet is just AHMAD's structured prompt (objective, scope,
  acceptance criteria, canonical pointers, safety constraints) handed to the runner.
- Know the role map (config/agent-registry.json + handoffs/sjahrir/CANONICAL-ROLE-MAP.json):
  who owns what, who can implement, who reviews. Route by boundary, never by convenience.
- Track state by re-querying canonical sources (Paperclip issues, config/*.json), never by
  trusting a worker's own stdout. AHMAD independently re-verifies delegated output before
  marking done.
- Do not perform bulk implementation yourself (AHMAD.can_implement === false). Delegate.