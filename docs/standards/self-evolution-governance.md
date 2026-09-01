# Ahmad Self-Evolution Governance

Status: active standard. Written 2026-08-24 in the legacy repo, migrated 2026-09-01.

## Principle

Ahmad can be educated, but education is not uncontrolled self-modification. Ahmad may observe, propose, and record improvements. Owner-approved agents may implement them later through normal review gates.

## Allowed

- Write observations to durable backlog/learning docs.
- Propose prompt, policy, tool, or workflow changes with success criteria.
- Run small evals against known memory/archive facts when workers are paused-safe.
- Ask for owner approval when a learning changes authority, cost, data access, or external behavior.

## Not Allowed

- Ahmad edits its own prompt, code, scheduler, auth, quota, or tool permissions autonomously.
- Ahmad promotes a worker role or model lane without owner-approved policy.
- Ahmad treats one successful task as proof that a general policy is safe.
- Ahmad activates scheduled workers, shell execution, deploy, billing, or credentials.

## Learning Loop

1. Capture: record repeated failure, owner preference, or project pattern in `config/decision-ledger.json`, `handoffs/`, or a scoped project doc.
2. Propose: create a small change packet with success criteria and rollback path.
3. Review: HATTA or SOEKARNO reviews strategy; CORLEONE reviews implementation; GIBRAN does short analysis only.
4. Promote: only after tests and owner-visible evidence.
5. Re-evaluate: add or update a small eval so the same issue is not rediscovered from scratch.

## Where this binds today

### ops-watcher/self-repair-actuator.mjs

`ops-watcher/self-repair-actuator.mjs` is the self-repair actuation layer: it builds bounded repair packets, snapshots and restores scoped files, attempts repair through configured lanes, verifies the scoped suite and then the full suite, rolls back on red verification, records repair evidence, and can send a cooldown-bound owner alert through injectable alerting. Its CLI supports `--drill [--dry] [--lane <corleone|hatta>]` by corrupting a canary, exercising `attemptRepair`, and then using an outer restore to prove the canary returns to its original state.

### ops-watcher/directive-runner.mjs

`ops-watcher/directive-runner.mjs` classifies Paperclip `DIRECTIVE` issues, generates bounded approval plans, validates parsed plans, posts plan or refusal comments, and sends the owner a Telegram decision card through injectable delivery. On approved directives it executes at most one per sweep by revalidating scope, snapshotting listed files, dispatching implementation to a guarded lane, running the plan verify command and the full suite, restoring on failed verification, and reporting done, no-op, or failure outcomes.
