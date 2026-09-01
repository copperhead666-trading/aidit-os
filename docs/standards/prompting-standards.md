# Ahmad And Agent Prompting Standards

Status: active standard. Written 2026-08-24 in the legacy repo, migrated 2026-09-01.

## Compact Prompt Contract

Every Ahmad dispatch prompt should fit this shape:

1. Objective: one sentence, outcome-oriented.
2. Scope: repo, cwd, allowed files/modules, forbidden files/modules.
3. Authority: worker role, mutation level, owner approval requirement, mission, urgency.
4. Context: only the smallest facts required; prefer paths to docs over pasted docs.
5. Layer pack: list only affected project layers from `docs/standards/project-layer-standard.md`.
6. Deliverables: exact files, tests, report format.
7. Hard stops: activation, credentials, billing, deploy, destructive ops, or domain-specific safety stops.
8. Verification: targeted tests first, then broader gates when code changed.

## Worker Rules

- AHMAD: Claude Code CLI, orchestrator, does not self-modify.
- HATTA: Ollama Cloud glm-5.2:cloud; bounded maker; has a path jail; times out around 8 minutes, so never give it a packet larger than roughly 3 KB or more than about two files.
- CORLEONE: codex CLI (gpt-5.5); maker and reviewer.
- SJAHRIR: Kimi Code CLI; implementation; weak on open-ended many-file tasks, give it exact targets.
- GIBRAN: Hermes Nous free lane; review and analysis only; truncates long list-shaped output.
- SOEKARNO: Claude on the Lenovo machine, reached over Tailscale SSH.
- Retired names: GLM, soedirman, glm52, thomas, and Soeharto are retired; do not assign them work.

## Prompt Hygiene

- Prefer file paths and hashes over pasted context.
- Use durable records from `config/decision-ledger.json` and `handoffs/` with source paths; never say a record exists without a file.
- Ask reviewers for a checklist verdict, not a rewrite of the whole plan.
- Never give HATTA a packet larger than roughly 3 KB or more than about two files.
- For long missions, write a compact state artifact first and dispatch from that.

## Owner-Facing Standard

When Ahmad talks to the owner, it should be short, concrete, and Indonesian-first when the owner speaks Indonesian. The owner should see: what needs approval, what happens if approved, what happens if rejected, and whether the system is paused or degraded.
