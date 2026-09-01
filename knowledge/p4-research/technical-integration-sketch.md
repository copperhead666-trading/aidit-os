# P4 Technical Integration Sketch: Health OS and Learning OS

Status: PROPOSAL ONLY. This is research for OWNER/AHMAD to accept, modify, or reject. It does not decide storage schema, learning algorithm, Health OS dashboard design, GBrain write policy, OSS donor selection, or any other item left NOT YET DECIDED in `handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md` and pending OWNER decision via KOL-50 through KOL-53.

This sketch is grounded in the current FounderOS-Aidit conventions:

- `config/decision-ledger.json` stores canonical owner decisions as structured JSON with status, provenance, confidence, temporal fields, and explicit supersession.
- `config/agent-registry.json` is declarative identity/runtime truth, and explicitly says operational state, queues, heartbeats, budgets, and run history should not become a competing writer there.
- Paperclip is the current operational work item store for issues, labels, comments, statuses, and agent-attributed verdicts. `config/paperclip-endpoint.json` is the canonical discovery reference for the local instance.
- `ops-watcher/ahmad-context-retrieval.mjs` defines the current Cognitive Core ContextBundle pattern: bounded, read-only GBrain/Graphify retrieval, canonical source reread where needed, stale/conflict reporting, and no mutation.
- `ops-watcher/heartbeat.mjs` is a single-sweep runner. Periodicity comes from PM2/Task Scheduler/daemon wrappers, not from unbounded loops inside the sweep.

## 1. Where Daily Check-ins and Sessions Could Live

These are options, not a pick.

### Option A: Paperclip issues/comments/labels as the operational journal

Health OS could create or update a daily issue such as a morning check-in item. Learning OS could create daily or per-session issues and append session comments. Labels could represent coarse workflow states such as waiting for check-in, session due, completed, needs OWNER input, or review required.

Pros:

- Fits the current operational-writer boundary: Paperclip already owns live task state, labels, statuses, comments, and issue history.
- Good for human-visible workflows and OWNER interaction. Telegram decisions already flow through Paperclip state instead of a separate queue.
- Existing helpers already support `listIssues`, labels, `postComment`, and `patchIssue`, with crash-proof return objects.
- Easy to route unresolved decisions back to OWNER using `OWNER_REQUIRED` rather than silently filling gaps.
- Comments provide an audit trail without inventing a new event log.

Cons:

- A daily health check-in or learning session is more record-like than task-like. Encoding every datapoint as issue text/comments could become noisy and hard to query.
- Paperclip comments are not a final analytics schema. Trend charts, spaced-review scheduling, and daily health history would need either export/normalization or a later dedicated store.
- Sensitive health entries may deserve stricter privacy/redaction rules than general project issues. That policy is not decided here.
- Paperclip issue model is good for workflow, but not necessarily for high-volume personal telemetry.

Best fit if OWNER wants maximum operational continuity and low new infrastructure first, especially for prompts, due items, review gates, and owner-visible state.

### Option B: New structured JSON state under `config/`

A future file could hold module-level canonical configuration or approved high-level state, following the `decision-ledger.json` style: schema version, explicit scope, provenance, timestamps, confidence/decision status, and no ambiguous authority. This sketch deliberately does not propose final field names.

Pros:

- Matches existing structured canonical-state style for decisions and registries.
- Good for stable, low-churn configuration: enabled modules, owner-approved anchors, dependency pointers, policy toggles, or accepted module boundaries.
- Easy to diff, review, and keep under source control.
- Can explicitly record unresolved gaps without letting an implementer decide them.

Cons:

- `agent-registry.json` itself warns against placing live operational state, queues, heartbeats, budgets, or run history into config. Daily health check-ins and learning sessions look more like operational records than static config.
- Frequent personal data writes to tracked JSON could be noisy and privacy-risky.
- JSON alone does not provide comments, workflow transitions, or owner interaction affordances.

Best fit for owner-approved module configuration and decision records, not as the primary daily event store unless OWNER explicitly chooses that model.

### Option C: GBrain-indexed knowledge pages

Daily summaries, session reflections, or curated learning outputs could become markdown pages or captured pages in the local GBrain store, later retrievable by Cognitive Core. This should be treated as an indexed knowledge layer, not raw authority.

Pros:

- Aligns with Learning OS's decided requirement to use shared Cognitive Core / knowledge infrastructure rather than a second brain.
- Useful for semantic recall: "what weak areas kept recurring?", "what did I learn about KUHPerdata last week?", or "what schedule factors correlated with low focus?"
- Existing retrieval wrapper can surface GBrain evidence as a ContextBundle with canonical pointers, stale warnings, and conflicts.
- Paperclip issue exporter already demonstrates a curated issue-to-markdown path under `knowledge/paperclip-issues/`, without dumping full comment threads.

Cons:

- Current Cognitive Core design explicitly says raw GBrain search/query output is not authoritative by itself and may be stale.
- Exact write policy for Learning OS to GBrain is NOT YET DECIDED. The spec explicitly leaves automatic promotion criteria, contradiction handling, and durable-memory policy open.
- Health data may be sensitive; what gets indexed, summarized, redacted, or excluded is an OWNER decision.
- GBrain is better at retrieval than canonical transaction storage.

Best fit for curated summaries and durable learning artifacts after a write/promotion policy is approved.

### Option D: Combination model

A likely future shape is a layered model:

- Paperclip for operational workflow: prompts, due sessions, owner-required blockers, review gates, and completion trail.
- `config/` for owner-approved configuration and canonical policy decisions only.
- GBrain/knowledge pages for curated summaries and retrieval-friendly artifacts, generated from Paperclip/config sources under an explicit ingestion policy.

Pros:

- Respects each existing subsystem's current strength.
- Avoids making `config` a live journal while still preserving canonical decisions.
- Lets Health OS / Learning OS plug into Cognitive Core without building a second memory brain.

Cons:

- Requires clear source-of-truth rules to avoid double-writes and drift.
- Requires explicit ingestion/redaction policy before personal health/learning records are indexed.
- More moving parts than the simplest Paperclip-only prototype.

This combination is a proposal only. OWNER/AHMAD still need to decide the actual storage model.

## 2. Cognitive Core Alignment

The existing pattern to preserve is `retrieveDispatchContext()` returning a bounded ContextBundle, not a module inventing its own retrieval stack. Health OS and Learning OS should treat Cognitive Core as shared context retrieval plus canonical source checking, not as a second scheduler, health database, or learning algorithm.

### Reusing `retrieveDispatchContext()`

One proposal is that Health OS / Learning OS runners call `retrieveDispatchContext()` before composing a check-in or session packet, similar in spirit to `ahmad-dispatch.mjs` Step 7. They would pass a synthetic issue-like object or real Paperclip issue, plus a module-specific `taskKind`, and include relevant paths if known.

Pros:

- Reuses the current ContextBundle contract: `status`, `evidence`, `canonical_pointers`, `stale_warnings`, `conflicts`, `excluded_hits`.
- Preserves the rule that retrieved context is supplementary, not authoritative over OWNER input or current canonical files.
- Keeps retrieval bounded, read-only, and testable through dependency injection.
- Gives daily modules access to the same canonical sources as AHMAD without duplicating GBrain/Graphify logic.

Cons:

- The current function is named for dispatch context and defaults are shaped around an issue/task packet. Morning check-ins and daily learning sessions are proactive loops, not always OWNER directive dispatches.
- It may need a thin adapter so a scheduled module can ask for "today's health planning context" or "today's learning session context" without pretending every run is a normal directive issue.
- It should not trigger retrieval on every heartbeat sweep just because the sweep runs. Retrieval should happen only when a module has a real prompt/session/check-in to prepare.

### Thin module-specific context wrapper

Another proposal is to keep `retrieveDispatchContext()` as the lower-level function, then add a small wrapper later, such as `retrieveHealthContext()` or `retrieveLearningContext()`, that only maps module concepts into the existing ContextBundle inputs.

Pros:

- Better names for the domain loops without forking retrieval logic.
- Can enforce module-specific caps, redaction, and source filters after OWNER decides them.
- Gives room for different query text while retaining the same ContextBundle output.

Cons:

- Adds another layer to maintain.
- Easy to accidentally smuggle product decisions into the wrapper if its input/output fields are over-designed too early.

Safe integration rule: whatever wrapper exists should return the same ContextBundle shape or a strict superset with the original bundle embedded. It should not create a competing "health brain" or "learning brain."

## 3. Daemon/Heartbeat vs Event-Driven OWNER Interaction

Again, this is tradeoff analysis only.

### Periodic process following heartbeat style

A future `health-os` or `learning-os` sweep could be added as one safe, bounded `--once` script and later invoked by the existing heartbeat-daemon/PM2/Task Scheduler pattern. The script itself should not contain an unbounded loop. It should do one pass, write no false success claims, respect `OWNER_REQUIRED`, and exit.

Pros:

- Fits the existing ops-watcher style: deterministic one-shot sweep plus external scheduler.
- Morning check-in and daily learning sessions are naturally time-based.
- Recovery is straightforward: if an event is missed, the next sweep can reconcile Paperclip state.
- Existing heartbeat already runs ordered steps and survives individual step failures.

Cons:

- A health/learning prompt can become annoying if automatic timing is wrong.
- Requires schedule/quiet-hours/anchor decisions that may overlap with still-open product decisions.
- More background processes increase operational surface area and PM2/stale-process risk, so STEWARD-style checks may need to include them.
- A daily module should not run retrieval or LLM-heavy work every five minutes by default.

### Event-driven from OWNER interaction

Health OS and Learning OS could start from explicit Telegram commands or replies, such as a morning check-in command, "start learning session", or replying to a decision card. Paperclip would record the resulting issue/comment trail.

Pros:

- Lowest risk of unwanted prompts and accidental automation.
- Keeps OWNER in control while the product shape is still unsettled.
- Uses the already-proven Telegram -> Paperclip -> heartbeat/dispatch path.
- Avoids scheduling policy decisions until OWNER has accepted the module behavior.

Cons:

- Easy to miss daily routines if OWNER does not initiate them.
- Less useful for proactive adaptation of calendar/workload unless a periodic reconciler eventually exists.
- Manual triggers alone may not satisfy the intended "morning after waking" adaptation loop.

### Hybrid

A cautious proposal is event-driven first for early trials, then add a bounded daily `--once` sweep only after OWNER accepts prompt timing and state boundaries. The periodic job could merely create or surface the day's Paperclip item, while actual sensitive content collection stays OWNER-driven.

This hybrid is not a decision. It is a migration path option.

## 4. Possible Future File Sketch

Naming/location only, no implementation implied.

### Minimal ops-watcher scripts

- `ops-watcher/health-os.mjs`: one-shot Health OS sweep. Candidate responsibilities: detect whether a morning check-in prompt is due, retrieve bounded context, create/update a Paperclip operational item, and stop. Exact data fields undecided.
- `ops-watcher/learning-os.mjs`: one-shot Learning OS sweep. Candidate responsibilities: detect whether a learning session is due, retrieve bounded context, create/update a Paperclip operational item, and stop. Exact scheduling algorithm undecided.
- `ops-watcher/health-os.regression.test.mjs`: offline tests with mocked Paperclip, time, and retrieval dependencies.
- `ops-watcher/learning-os.regression.test.mjs`: offline tests with mocked Paperclip, time, and retrieval dependencies.

### Shared helper, only if duplication appears

- `ops-watcher/domain-loop-context.mjs`: optional thin adapter over `retrieveDispatchContext()` for proactive domain loops. This should exist only if both Health OS and Learning OS need the same mapping/caps.
- `ops-watcher/domain-loop-paperclip.mjs`: optional helper for common issue/comment/label operations if module scripts would otherwise duplicate Paperclip workflow code. It should reuse `paperclip-write-client.mjs`, not reimplement HTTP routes.

### Config proposals, only after OWNER accepts the boundary

- `config/health-os.json`: possible owner-approved module policy/config, not daily records.
- `config/learning-os.json`: possible owner-approved module policy/config, not session history.
- `config/domain-modules.json`: possible shared module registry if Health/Learning/Lawyer/Civil Law need one canonical declarative index. This is only a proposal; adding another config registry may be unnecessary.

### Knowledge/GBrain artifacts

- `knowledge/health-os/`: possible curated summaries or design docs, not raw private telemetry unless OWNER approves.
- `knowledge/learning-os/`: possible curated session outputs, subject maps, and review summaries after GBrain write policy is decided.
- `knowledge/paperclip-issues/`: existing export target can continue to represent finalized Paperclip work items for retrieval, but it should not become an unbounded dump of daily personal data.

### Heartbeat integration, if approved later

If a periodic path is accepted, `ops-watcher/heartbeat.mjs` could eventually add one or two new literal steps, following the current explicit list style rather than scanning a directory:

- `node ops-watcher/health-os.mjs --once`
- `node ops-watcher/learning-os.mjs --once`

That would be an implementation decision for a later OWNER-approved build, especially because prompt timing, quiet hours, and data boundaries are still product decisions.

## Non-Decisions Preserved

This report intentionally does not decide:

- Health OS storage schema or database.
- Health OS dashboard/cards/KPIs.
- Which health inputs are stored, summarized, redacted, or indexed.
- Learning OS scheduling algorithm.
- Learning OS curriculum, quotas, daily UI, or universal session template.
- Learning OS -> GBrain promotion/write policy.
- Whether Civil Law Mastery artifacts feed Lawyer Copilot, remain private, or use a controlled combination.
- Any OSS donor implementation.

The safest technical principle is: integrate through existing FounderOS boundaries first. Paperclip handles operational workflow, `config` holds explicit owner-approved canonical/declarative state, GBrain/Graphify provide retrieval through the existing read-only ContextBundle wrapper, and heartbeat-style automation remains bounded, one-shot, externally scheduled, and OWNER-gated.
