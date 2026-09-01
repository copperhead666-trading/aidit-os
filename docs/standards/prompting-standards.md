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
- HATTA: Ollama Cloud glm-5.2:cloud; bounded maker; has a path jail; times out hard at 8 minutes. Measured over 25 real dispatches on 2026-09-01: 68% success, 335s average — three of the failures were timeouts on packets of roughly 3 KB. Keep its packets under 2 KB and to a single file; anything larger goes to CORLEONE.
- CORLEONE: codex CLI (gpt-5.5); maker and reviewer.
- SJAHRIR: Kimi Code CLI; implementation; weak on open-ended many-file tasks, give it exact targets.
- GIBRAN: Hermes Nous free lane; review and analysis only; truncates long list-shaped output.
- SOEKARNO: Claude on the Lenovo machine, reached over Tailscale SSH.
- Retired names: GLM, soedirman, glm52, thomas, and Soeharto are retired; do not assign them work.

## Prompt Hygiene

- Prefer file paths and hashes over pasted context.
- Use durable records from `config/decision-ledger.json` and `handoffs/` with source paths; never say a record exists without a file.
- Ask reviewers for a checklist verdict, not a rewrite of the whole plan.
- Never give HATTA a packet larger than roughly 2 KB or more than one file. Measured 2026-09-01: 68% success over 25 dispatches, its failures concentrated on larger packets. CORLEONE managed 81% at 241s average over 26 dispatches in the same window, so route anything substantial there.
- For long missions, write a compact state artifact first and dispatch from that.

## Owner-Facing Standard

When Ahmad talks to the owner, it should be short, concrete, and Indonesian-first when the owner speaks Indonesian. The owner should see: what needs approval, what happens if approved, what happens if rejected, and whether the system is paused or degraded.

## Verification: exercise the real path, not only the injected one

Added 2026-09-01 after the same failure shape appeared twice in one night.

Dependency injection makes these modules testable, and every task packet asks for tests that inject
fakes. That is right, and it is not sufficient: a suite built only from injected collaborators never
runs the code production actually runs.

Two live failures, hours apart, both behind a fully green suite:

- `directive-runner.mjs` defaulted its label writer to `POST /api/issues/:id/labels`, which Paperclip
  answers **404**. The owner-escalation feature could never fire. Tests injected a working label
  function, so the default was never called.
- `heartbeat.mjs` called `isPaused()` and `readPause()` without importing them. The real pause check
  threw, the gate failed closed as designed, and every sweep halted for four minutes. Tests injected
  `checkPause`, so `checkPauseReal` was never executed.

**The rule.** Every task packet that adds or changes a dependency-injected collaborator must require
at least one test that exercises the DEFAULT, uninjected path — enough to prove it resolves, is
imported, and calls what it claims to call. Where the default genuinely reaches the network or the
filesystem, assert on the request it would make (URL, method, body shape) rather than skipping it.

**Why it matters more here than in most codebases.** These modules dispatch paid lanes, write to the
owner's issue tracker, and message the owner's phone. A default path that silently does nothing does
not look like a bug — it looks like a calm system, which is the exact failure this project keeps
finding.
