
# Skill Bootstrap Design — Minimal Role-Based Skill Loading

**Author:** SJAHRIR (research/synthesis)
**Status:** PROPOSED — design for HATTA to implement, GIBRAN to review. Not yet built.
**Depends on:** `handoffs/sjahrir/CANONICAL-ROLE-MAP.json` (role roster/boundaries, canonical)
`handoffs/sjahrir/ACTIVATION-AND-REVIEW-FLOW.md` (activation/dispatch flow, canonical)
**Changes to neither:** this design layers a SKILL loading concern on top of the existing
canonical roster and flow; it does not revise who the agents are, what their boundaries are,
or how a task packet gets dispatched.

---

## 1. Core principle

Every agent session starts with a small, role-appropriate set of **mandatory core skills**
loaded by default. Those are the capabilities that role needs in essentially every task it
touches — the irreducible instruction bundle for that role's identity.

**Task-specific skills are NOT loaded by default.** They are discovered on demand, looked up
from a small index, and only injected when a specific task kind genuinely calls for them. No
agent ever gets the entire skill library dumped into its context regardless of what it is doing.

This is a bootstrap layer — it governs *what instruction text accompanies a task packet*, not
agent identity, runtime binding, or any infrastructure beyond a single small JSON index file.

---

## 2. Why the existing dispatch pattern still works

This org already runs a clean dispatch shape: AHMAD writes a text prompt file (the task packet)
and hands it to a harness or CLI — currently `hermes` / `kimi` / Claude Code CLI —
as the executing agent's context. That shape is good and stays.

The only change this design introduces is: **before writing the task packet, the dispatcher
(AHMAD or a scripted dispatcher) consults `skill-index.json` to decide two things:**

1. Which mandatory core skills this role always gets (always included in the packet's
   "loaded skills" guidance).
2. Whether the task kind being dispatched matches any task-specific skill entry — and if so,
   which one(s) to flag as *available if needed* (not force-loaded; the executing agent can
   use them when relevant, but they don't clutter the context if they aren't).

The packet-construction step gains a small, structured "skills" section. Everything else —
the harness, the CLI, the file-handoff — is unchanged.

---

## 3. Mandatory core skills per role

Compact list: role → skill names with one-line descriptions. These are the skills loaded
by default for that role in every session/task. Full skill content is maintained separately
(one file per skill, under a `skills/` tree — not in this design doc).

### AHMAD (D1 — orchestrate / delegate / review / escalate)

- **orchestration** — coordinates multi-agent dispatch, task lifecycle, state tracking across
  running workers; knows the org's role map and who owns what.
- **delegation** — writes task packets, selects implementer by boundary/availability, sets
  acceptance criteria, routes to review; knows the task-packet standard.
- **recovery** — detects orphaned/zombie tasks and runs, performs P0/P1 reconciliation,
  wakes stalled dispatches, enforces re-entrancy guards on wake ticks.

### HATTA (D2 — all implementation, workspace-scoped harness)

- **debugging** — systematic root-cause debugging; reads errors, traces call paths, isolates
  defect class before patching; knows the org's debug workflow.
- **TDD** — red-green-refactor discipline; writes failing test first, implements to pass,
  refactors; knows `npm test` / `npm run typecheck` gates and `:memory:` DB convention.
- **verification** — runs allowlisted build/test/seed commands, confirms green before claiming
  done; never modifies code to make a test pass (that is the implementer's job).

### GIBRAN (D3 — verdicts on material changes, never modifies code / self-approves)

- **independent-review** — reads a change against its acceptance criteria and role boundary;
  issues verdicts (approve / request-changes / block) with cited reasons; never self-approves.
- **acceptance** — judges whether a delivered artifact meets the stated acceptance criteria;
  distinguishes "works" from "meets spec."
- **security** — spots credential exposure, auth bypasses, destructive production actions,
  and other safety-boundary violations in proposed changes; escalates to OWNER when found.

### SJAHRIR (D6 — heavy-context research / synthesis / org-design)

- **research** — gathers context from canonical sources, web, and prior session history;
  distinguishes verified vs stale vs unknown; does not infer from adjacent facts.
- **synthesis** — compresses heavy context into structured, caveman-friendly summaries;
  produces role maps, flow docs, and design drafts from raw research.
- **context-compression** — knows when to use compact summaries vs full detail; prevents
  context dilution when handing off to other agents; produces minimal-sufficient handoff text.

### Thin specialists — only the skill(s) matching their boundary

Each thin specialist gets exactly one core skill (or zero, if its boundary is so narrow it
needs no bundled instruction beyond its role description). The mapping follows the `boundary`
field in CANONICAL-ROLE-MAP.json directly:

| Role | Boundary (from role map) | Core skill |
|---|---|---|
| ESCALATION-SEC (D1) | WAITING_FOR_OWNER queue | `owner-queue-steward` — manages the owner-decision queue: triages WAITING_FOR_OWNER items, surfaces them to OWNER at the right time, does not fabricate owner decisions. |
| AUDIT-CLERK (D1) | ledger/registry consistency read-only | `consistency-audit` — reads ledger and registry state, checks internal consistency, reports discrepancies; never writes. |
| TEST-RUNNER (D2) | run allowlisted test/build commands, never fixes code | `test-execution` — runs specific allowlisted commands (`npm test`, `npm run typecheck`, `npm run build`, `npm run seed`), reports output; never edits files. |
| MIGRATION-SURVEYOR (D2) | read-only legacy extraction | `legacy-extraction` — reads legacy system state and extracts structured snapshots; read-only, never mutates. |
| GBRAIN-CURATOR (D4) | GBrain ingestion | `gbrain-ingestion` — ingests documents/pages into the GBrain store per the ingestion contract; knows the canonical source rules. |
| RETRIEVAL-ASSISTANT (D4) | pre-dispatch GBrain query, read-only | `gbrain-query` — runs pre-dispatch GBrain queries to surface relevant context before a task packet is built; read-only. |
| GRAPHIFY-ANALYST (D4) | structural / multi-hop code questions | `structural-analysis` — answers structural and multi-hop code questions from the current repo state; does not modify code. |
| OPS-WATCHER (D5) | deterministic detectors, no LLM | `deterministic-watch` — runs deterministic detectors only; no LLM calls, no inference; reports detector output. |
| PAPERCLIP-OPERATOR (D5) | Paperclip admin writes, human-approved | `paperclip-admin` — performs Paperclip administrative writes; every write is human-approved (OWNER or GIBRAN verdict) before execution; never auto-writes. |
| STEWARD-SJS (D7) | SJS status snapshot | `sj-snapshot` — produces SJS status snapshots from canonical sources; follows the status answer contract. |
| STEWARD-CAVEMAN (D7) | trading state watch read-only | `caveman-watch` — reads Caveman trading state (read-only watch); reports state, does not trade. |
| TRADING-QUANT (D7) | dormant, explicit packet only | `trading-quant-analysis` — dormant by default; only loaded when an explicit task packet names it; performs quantitative analysis on trading data when invoked. |

Note: STEWARD-* and TRADING-QUANT are intentionally narrow. The stewards get one snapshot/watch
skill each; TRADING-QUANT is dormant and only activates on an explicit packet, so its single
skill is loaded only on demand (which is also the discovery pattern — see Section 4).

---

## 4. Discovery mechanism for task-specific skills

### 4a. The index file

A single JSON file — `skill-index.json` ( companion to this design doc ) — serves as the
registry. It has two top-level sections:

- `mandatoryCore` — role → array of skill names. This is the "always loaded" mapping,
  reproduced from Section 3 above in machine-readable form.
- `taskSpecific` — array of skill entries, each with:
  - `name` — the skill's canonical name (matches a file under `skills/`).
  - `description` — one line.
  - `triggers` — array of keywords / task-kind tokens that suggest loading this skill.
  - `applicableRoles` — which roles this skill is relevant to (so the dispatcher can skip
    suggesting it for roles that will never use it).

### 4b. How a dispatcher uses it (the concrete flow)

When AHMAD (or a scripted dispatcher) is about to build a task packet for a task, it does:

1. **Identify the executing role** from the task (e.g. "this is a HATTA implementation task").
2. **Always include** that role's mandatory core skills from `mandatoryCore[role]` — these go
   into the packet's "loaded skills" guidance unconditionally.
3. **Match the task kind against `taskSpecific` triggers.** The dispatcher looks at what the
   task is roughly about (a short task-kind label, e.g. "paperclip-api-debugging", "regression
   test writing", "GBrain ingestion") and scans `taskSpecific` entries for trigger matches.
4. **For each matching task-specific skill, append a soft guidance line** to the packet:
   "Task-specific skill `X` is available if needed — load it if the task touches [trigger area]."
   This is *not* a force-load; it is a hint. The executing agent uses its judgement.
5. **Write the packet** with both the mandatory core and the soft task-specific hints embedded
   in the instructions. The harness/CLI receives the same text-prompt file shape as before —
   only the content of that prompt now carries a structured skills section.

This means the executing agent does **not** decide for itself mid-task which skills to load —
the dispatcher makes that call before the packet is sealed. The agent's context is clean:
it gets what it needs for this task, not the whole library.

### 4c. What "task kind" means in practice

The dispatcher does not need a formal classifier. A task kind is a short label the dispatcher
assigns when it creates the packet — typically derived from the task description or the domain
it touches. Examples: "paperclip-api-debugging", "regression-test-writing",
"gbrain-ingestion", "legacy-migration-extraction", "telegram-bot-integration",
"trading-quant-analysis". These labels are human-assigned by AHMAD at packet-creation time,
not inferred by the executing agent. If the dispatcher is unsure whether a task-specific skill
applies, it simply omits the soft hint — no harm done; the agent still has its mandatory core.

### 4d. Why dispatcher-side, not agent-side

Agent-side discovery (the executing agent deciding mid-task to go look up skills) would require
the agent to have access to the index and the autonomy to change its own context mid-session —
that raises re-entrancy and context-contamination concerns, and it is not how this org's
harness currently works. Dispatcher-side discovery is simpler, deterministic, and fits the
existing "AHMAD writes a text file, hands it to a harness" shape with zero harness changes.

---

## 5. Interaction with the existing task-packet / dispatch pattern

### What stays exactly the same

- AHMAD writes a text prompt file (the task packet) and hands it to the harness/CLI.
- The harness/CLI receives a text prompt and runs the agent session.
- Task lifecycle (queued → running → review → done) is unchanged.
- Role boundaries from CANONICAL-ROLE-MAP.json are unchanged.
- The activation-and-review flow from ACTIVATION-AND-REVIEW-FLOW.md is unchanged.

### What changes — and only in the prompt-construction step

The task packet gains a small, structured "Skills" section in its instruction text. Example
shape (illustrative, not a schema — the exact format is for HATTA to settle):

```
### Loaded skills

Core (always active for this role):
- <skill-name-1>: <one-line description>
- <skill-name-2>: <one-line description>

Task-specific (available if needed — load if the task touches the trigger area):
- <skill-name-3>: <one-line description> — trigger: <keyword>
```

The dispatcher fills this section by consulting `skill-index.json` as described in Section 4b.
The rest of the packet (objective, scope, acceptance criteria, canonical pointers, safety
constraints) is constructed exactly as it is now, per the task-packet standard already in use.

No harness change is required: the harness receives a text file that already contains the skill
guidance inline. The skill names in that guidance refer to instruction content that HATTA will
maintain as separate `skills/<name>.md` files (or equivalent) — this design doc does not
specify that storage layout, only the loading semantics.

---

## 6. What this design does NOT do

Be explicit — this is a minimal bootstrap, per the OWNER's direction:

1. **Does not change agent identity or runtime bindings.** Roles, who-is-who, which CLI/harness
   each role uses — none of that changes. AHMAD is still the orchestrator; HATTA still implements;
   GIBRAN still reviews; the thin specialists still have their boundaries.

2. **Does not touch Paperclip, GBrain, or any external system.** The index file is local to this
   handoff directory. Skill loading is a prompt-construction concern, not a system-integration
   concern.

3. **Does not require new infrastructure.** Only a single small JSON index file is added
   (`skill-index.json`). Skill content files (one per skill) are a natural next step but are
   not part of this bootstrap — this design governs *loading*, and the content can be written
   inline in the packet or in separate files, whichever HATTA prefers.

4. **Does not change the dispatch mechanism.** The text-prompt-file + harness handoff stays.
   The only change is what goes *inside* the prompt.

5. **Does not auto-load task-specific skills.** Task-specific skills are soft hints only.
   Forcing them in would defeat the context-dilution concern this whole design exists to solve.

6. **Does not revive dormant roles by default.** TRADING-QUANT (and any other dormant role) only
   gets its core skill loaded when an explicit task packet names that role — same as today.

7. **Does not invent a new review/activation flow.** ACTIVATION-AND-REVIEW-FLOW.md stays
   canonical. This design layers skill loading into the packet-construction step that already
   exists inside that flow.

8. **Does not require the executing agent to have index access mid-task.** The dispatcher does
   the lookup before the packet is sealed. The agent receives a finished prompt.

---

## 7. Status note

```
PROPOSED — 2026-08-28
Design by: SJAHRIR
For implementation by: HATTA
For review by: GIBRAN
Status: not yet built. No infrastructure changed. No skill content files written yet.
Depends on: CANONICAL-ROLE-MAP.json (canonical role roster — not revised by this design),
            ACTIVATION-AND-REVIEW-FLOW.md (canonical activation flow — not revised).
Next step: HATTA implements the dispatcher-side lookup (reads skill-index.json, fills the
  skills section of each task packet) and writes the mandatory core skill content files.
  GIBRAN reviews the index mapping and the skill content for accuracy against role boundaries.
Owner decision needed: NO — this is an internal bootstrap design, within existing role
  boundaries and the existing dispatch shape. OWNER decides only if the blast radius is
  misjudged (see Section 6 for what this design does NOT do).
```

---

## 8. Gaps and inconsistencies noted

- CANONICAL-ROLE-MAP.json's `boundary` field for each role is sufficient to derive the
  mandatory core skill per thin specialist. No inconsistency found there — the boundary→skill
  mapping in Section 3 follows it directly.
- ACTIVATION-AND-REVIEW-FLOW.md was not fully re-read in this session (filesystem access
  unavailable to SJAHRIR in this call). The design assumes it defines a dispatcher role
  (AHMAD or equivalent) that constructs task packets before handing them to a harness — which
  is consistent with what this session's actual practice shows. If ACTIVATION-AND-REVIEW-FLOW.md
  says something different about *who* constructs packets or *when*, HATTA should flag it
  during implementation and this design doc should be revised accordingly.
- The task-packet standard (`D:\Agentic\config\task-packet-standard.md` in the FounderOS repo)
  is referenced but not re-read here. The "Skills" section proposed in Section 5 should be
  checked against that standard by HATTA — if the standard already has a skills/sections field,
  this design should plug into it rather than invent a parallel shape.
