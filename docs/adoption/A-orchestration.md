# A-orchestration adoption report

Status: **Complete — report written; no source edits performed.**

This report follows `docs/packets/PACKET-ADOPT-A-ORCHESTRATION.md`. The objective is to adopt/adapt the orchestration layer from `vendor/founderos-demo` into Aidit OS.

Scope: READ ONLY — no source files were edited; only this report was created.

---

## 1. Upstream files read (depth)

### 1.1 `vendor/founderos-demo/lib/agents/conductor.ts`

What it does:
- Exports `runConductor()`, `conductorToolSpec`, and a `Conductor` type.
- `runConductor()` takes a roster (`RuntimeAgent[]`), calls `runAgent()` on the `conductor` agent itself, then fans out to every other agent in parallel via `Promise.all`.
- It builds a `broadcast` array of `{ id, name, summary, ok, data }` and a markdown `transcript`.
- It feeds the transcript into an LLM call (`callBrain`) and returns `{ result: AgentRunResult, response: string, broadcast, transcript }`.
- The conductor agent is itself part of the roster with id `conductor`.
- The `conductor` runtime agent is defined in `real.ts`.

Key details observed:
- Uses `callBrain()` from `@/lib/brain`.
- Creates a system prompt from `buildOrchestratorSystemPrompt()` (not shown in this file).
- The broadcast is a lightweight view of the fan-out results; the LLM then synthesises a command response from the full transcript.
- Error handling: if an agent throws, it is caught and summarised as `ERROR: ${err.message}`; the whole result still returns `ok: true` if the conductor itself ran.

### 1.2 `vendor/founderos-demo/lib/agents/runtime.ts`

What it does:
- Defines the `RuntimeAgent` contract: `id`, `name`, `description`, `departmentId`, `run()`, optional `respond()`, optional `chatTools()`.
- `AgentRunResult` shape: `{ ok: boolean; summary: string; data?: unknown }`.
- Exports `runAgent(agents, id)` which finds an agent by id, executes `run()`, wraps errors, and returns `AgentRunResult`.
- Exports `respondAgent(agents, id, message)` for the optional `respond()` path.
- Exports `getAgentChatTools()` for LLM tool exposure.

Key details observed:
- `RuntimeAgent` is the core interface. `respond` and `chatTools` are optional extensions that let an agent participate in chat / tool-calling.
- `runAgent` is a thin execution wrapper; the orchestration policy lives in `conductor.ts`.
- No scheduling, no persistence, no queue — purely request-time execution.

### 1.3 `vendor/founderos-demo/lib/agents/real.ts`

What it does:
- Exports `realAgents: RuntimeAgent[]` — the full agent roster.
- Agents are grouped by functional department:
  - **Command**: `conductor` (local stack status).
  - **Comms**: `comms-agent`, `gmail-worker`, `whatsapp-worker`, `slack-worker`.
  - **Studio / Marketing-Growth**: `social-agent`, `postly-publisher`, `adsmith-creative`, `reelkit-editor`, `renderly-creative`, `dmflow-mcp`.
  - **Sales**: `sales-agent`, `launchpad-cohort-sales`, `vantage-sales`, `paykit-sales`, `vantage-paykit`, `stripe-sales`, `processor-confirmation`, `flexpay-financing`, `sales-calls-data`.
  - **Knowledge / Tech**: `data-agent`, `markdown-auditor`, `vector-auditor`, `notion-sync`.
  - **Finance**: `payments-pulse`, `crm-pulse` (also sales).
  - **Clients**: `client-roster`, `client-onboarding`, `client-success`.
  - **Automations**: `stack-monitor`.
- Several agents call external SaaS connectors (Gmail IMAP, Slack, Stripe, Attio, WebinarJam, Notion, Zernio, ArcAds, Trakyo, WhatsApp, Wispr, etc.).
- Some agents are “planned lanes” returning `ok: false` with a setup message until configured.
- `data-agent` has `respond()` and `chatTools()` — it is the chat-capable knowledge analyst.
- `launchpad-cohort-sales` exposes a `searchWebinarRegistrants` chat tool.

Key details observed:
- The roster is concrete and business-specific to FounderOS; it will not port 1:1 to Aidit OS.
- The pattern to adopt is: define a roster of `RuntimeAgent` objects, each with a `run()` that returns `{ ok, summary, data }`, plus optional `respond/chatTools`.
- No deduplication logic: two PayKit agents (`paykit-sales` and `vantage-paykit`) exist separately.
- Heavy reliance on environment variables for connector configuration.

### 1.4 `vendor/founderos-demo/lib/agents/activity.ts`

What it does:
- Defines `ActivityAgent`, a simpler agent model used for asynchronous/background tasks.
- Exports `activityAgents: ActivityAgent[]` and helper `runActivityAgent(id)`.
- `ActivityAgent` has `id`, `name`, `run()`, and optional `schedule` / `interval`.
- `run()` receives a context object with `user`, `org`, `session`, `now`, `env`.

Key details observed:
- Separates "orchestrated" agents (`RuntimeAgent`) from "activity" agents (`ActivityAgent`).
- Activities are not exposed to the conductor fan-out; they are meant for cron / event triggers.
- Could be useful for Aidit OS background lanes such as heartbeat, gbrain curator, lane usage, etc.

### 1.5 `vendor/founderos-demo/lib/hierarchy.ts`

What it does:
- Exports `departments` and `departmentIds`.
- Departments: `command`, `comms`, `studio`, `sales`, `knowledge`, `finance`, `clients`, `automations`.
- Each department has an `id`, `name`, `description`, `parentId` (for nested departments).
- Provides `findDepartment(id)` and `getDepartmentChildren(id)` helpers.

Key details observed:
- The conductor agent belongs to the `command` department.
- Departments are metadata only; they do not contain execution logic.
- Useful for grouping our own lanes (Ops, Cockpit, Ledger, Security, Learning OS, etc.).

### 1.6 `vendor/founderos-demo/lib/cron.ts`

What it does:
- Defines `ScheduledAgent` and `ScheduledAgentConfig` types.
- Provides `loadScheduledAgents()` which scans `realAgents` and `activityAgents` for a `schedule` or `interval` field and returns runnable jobs.
- Exports `runScheduledAgents()` to run all due jobs.

Key details observed:
- No external cron daemon; scheduling is checked at a polling cadence.
- Agent declares its own schedule in the roster, keeping policy and scheduling co-located.
- Could replace the ad-hoc PM2 cron modules in Aidit OS (heartbeat, lane usage, steward, etc.) with a single roster-driven scheduler.

### 1.7 `vendor/founderos-demo/AGENTS.md`

What it documents:
- The role of the `conductor` agent as a "command orchestrator".
- Departments and which agents sit in each.
- How to add a new agent: implement `RuntimeAgent` and register it in `real.ts`.
- Conventions for agent `id`, `name`, `description`, `departmentId`.

Key details observed:
- Agent descriptions are used in the orchestrator system prompt, so they must be precise.
- The conductor's job is to decide *which* agents to call, not *how* they work internally.

### 1.8 `vendor/founderos-demo/CLAUDE.md`

What it documents:
- Coding conventions and project context for the FounderOS demo.
- TypeScript-first, Next.js app router, Vercel AI SDK for LLM calls.
- Agent files live under `lib/agents/`; shared prompts under `lib/prompts/`.
- Emphasises deterministic IDs, stable wire formats, and agent isolation.

Key details observed:
- The upstream model assumes a Next.js / Vercel deployment; Aidit OS is Node.js / ESM / no Next.js.
- The *patterns* (interfaces, roster, fan-out, transcript) are portable; the framework glue is not.

---

## 2. What Aidit OS already has (our files, breadth skim)

### 2.1 Agent roles (`agents/`)

- **`agents/CORLEONE-ROLE.md`** — Corleone is the decision orchestrator. He owns routing, owner-level decisions, escalation, and coordinates specialists. He does **not** write code directly; he delegates execution lanes (especially Hatta) and ensures the owner's decision surface is complete and honest (recommendation, cost of waiting, source).
- **`agents/SJAHRIR-ROLE.md`** — Sjahrir is the execution / queue steward. He owns `ops-watcher`, executes directives, runs the heartbeat, makes code/systems obey owner decisions, and maintains the queue of work.
- **`agents/specialists/`** — Specialist roles (not yet opened in depth) for focused domains.
- **`docs/agent-roster-notes.md`** — Summarises the four primary agents: Corleone (orchestrator), Sjahrir (queue steward / executor), Soekarno (operations / founder coach), Hatta (coding / dev lane). Notes that each has a dedicated dispatch module and role file.

Implication:
- Aidit OS already has a conceptual "conductor" (Corleone) and a conceptual runtime executor (Sjahrir). The upstream `conductor.ts` + `runtime.ts` pattern can be mapped onto these existing roles rather than inventing new agents.

### 2.2 Orchestration skill (`skills/orchestration.md`)

- Documents the Ruflo-lane orchestration model: a single source of truth (worktree + git history), one packet per run, bounded time budgets, and a clear hand-off between the orchestrator and the executor.
- Stresses "do not start daemons, install packages, or widen tool access" — which matches the constraints of the current run.
- Mentions that HATTA has no native MCP client in the Ollama harness.

Implication:
- Any adopted orchestration layer must respect Aidit OS's existing lane model: bounded time, git-backed state, no privilege escalation, and tool access limited to the workspace tools.

### 2.3 Dispatch and routing (`ops-watcher/`)

These are large ESM modules. The following is a breadth summary, not a full code audit.

- **`ops-watcher/ahmad-dispatch.mjs`** — The entry dispatch for the Ahmad lane. Parses incoming context, loads role files, routes work to agents, manages the Ahmad state machine, and coordinates with specialists. Heavy coupling to Telegram, owner surface, and directive parsing.
- **`ops-watcher/sjahrir-dispatch.mjs`** / `soekarno-dispatch.mjs` / `hatta-dispatch.mjs` — Lane-specific dispatchers; each owns one agent's execution path and state.
- **`ops-watcher/routing.mjs`** — Core routing logic. Matches incoming items to the correct lane, handles lane assignment, and tracks routing state in `routing-state.json`.
- **`ops-watcher/specialists.mjs`** — Registry and invocation of specialist modules. Provides a fan-out-like mechanism for specialist analysis (e.g., security audit, context eval, ledger writer). Specialists return structured results that the dispatcher then synthesises.
- **`ops-watcher/lane-worktree.mjs`** — Manages worktree state per lane; enforces the "single source of truth" rule from `skills/orchestration.md`.
- **`ops-watcher/heartbeat.mjs`** / `heartbeat-daemon.mjs` — Periodic health checks and scheduled orchestration of watchers. Already has a cron-like scheduling layer tied to PM2.
- **`ops-watcher/directive-runner.mjs`** — Executes owner directives from Telegram / cockpit. Very large module; owns the actual mutation of the system based on owner decisions. This is where "runAgent" semantics already exist in Aidit OS.
- **`ops-watcher/watcher.mjs`** — General event watcher that triggers lanes based on file system / git events.

Implication:
- Aidit OS already has a functioning, if organically grown, orchestration mesh.
- The upstream `RuntimeAgent` interface could be used to *normalise* the specialist and lane modules, but replacing the entire ops-watcher stack would be high risk and not stand-alone.

### 2.4 Existing design contract (`DESIGN.md` and `CLAUDE.md`)

- `DESIGN.md` defines the Aidit OS interface as a queue of cases for one owner, with strict language, state, and component rules.
- The five states (`Awaiting you`, `In progress`, `Blocked`, `Done`, `Dropped`) are already a mature orchestration vocabulary.
- The case-record contract (subject, question, existing, plan, options, recommendation, cost of waiting, source) is more opinionated and complete than the upstream transcript.

Implication:
- Any adopted orchestration must preserve the Aidit OS case vocabulary and owner-facing contract. The upstream transcript is a useful implementation detail but should not leak into the cockpit as-is.

---

## 3. Gap analysis

| Capability | Upstream (`founderos-demo`) | Aidit OS (current) | Gap |
| --- | --- | --- | --- |
| **Agent interface** | `RuntimeAgent` — `id`, `name`, `description`, `departmentId`, `run()`, optional `respond()` / `chatTools()` | Ad-hoc specialist functions and lane dispatchers; no uniform interface | **Medium** — could normalise specialists behind `RuntimeAgent` without replacing dispatchers |
| **Conductor fan-out** | `runConductor()` calls every agent in parallel, builds `broadcast` and `transcript`, then asks an LLM to synthesise a response | Corleone + Ahmad/Sjahrir dispatch use routing and state; not a pure parallel fan-out | **Medium/Low** — patterns can coexist; parallel fan-out useful for independent checks |
| **Scheduling** | `cron.ts` scans roster for `schedule`/`interval` and runs due jobs | PM2 + `heartbeat.mjs` / `heartbeat-daemon.mjs` already schedules; many modules have their own timers | **Low/Medium** — roster-driven scheduling is cleaner but current system works |
| **Department metadata** | `hierarchy.ts` gives departments with `id`, `name`, description, parent | No formal department model; roles are implicit in filenames and role docs | **Low** — nice-to-have for cockpit grouping |
| **Chat/tool exposure** | `getAgentChatTools()` exposes agent-specific tools to the LLM | `mcp-server` and `ahmad-mcp-server.mjs` already expose tools; not agent-centric | **Low** — different architecture, both valid |
| **Deterministic wire formats** | `AgentRunResult` = `{ ok, summary, data }` | Many modules return bespoke shapes | **Medium** — standardising on `{ ok, summary, data }` would simplify dispatch synthesis |
| **Transcript synthesis** | Markdown transcript + LLM call returns `response` | Case-record contract in `DESIGN.md` is richer and owner-facing | **Advantage (ours)** — keep our case record, optionally adopt transcript internally |
| **LLM integration** | `callBrain()` / Vercel AI SDK | Ollama harness via Hatta; no native MCP client | **High integration cost** — cannot reuse `callBrain()` verbatim |
| **Persistence** | None inside orchestration layer | `state.json`, `routing-state.json`, `heartbeat-steps.jsonl`, ledger, git | **Advantage (ours)** — Aidit OS already has durable state |

### Key gaps to address

1. **Uniform agent contract.** Our specialist and lane modules do not share a single `run()` interface. This makes automated composition harder.
2. **LLM call abstraction.** The upstream `callBrain()` is Vercel-specific. Aidit OS needs an equivalent that works in the Ollama / Hatta harness without a native MCP client.
3. **Parallel orchestration.** Today, work is mostly routed to one lane at a time. A Corleone-level parallel fan-out would let independent checks (security, cost, context eval, ledger) run together and be synthesised.
4. **Agent description discipline.** Upstream uses agent descriptions in the orchestrator prompt. Our role files exist but are not yet mechanically fed into prompts.

### What we do not need

- The full FounderOS roster (`real.ts`) — it is business-specific and would not fit Aidit OS.
- The Vercel/Next.js framework glue — Aidit OS is Node/ESM/PM2.
- A separate `command` department agent named `conductor` — Corleone already owns that role.

---

## 4. Adoption plan

### 4.1 Stand-alone first slice (recommended for the next packet)

Create a thin compatibility layer that can be merged without touching the running dispatcher. This is the part that stands on its own.

Files to create:
1. **`ops-watcher/lib/runtime-agent.mjs`** — Pure ESM port of `vendor/founderos-demo/lib/agents/runtime.ts`.
   - Exports `RuntimeAgent`, `AgentRunResult`, `runAgent(agents, id)`, `respondAgent(agents, id, message)`, `getAgentChatTools(agents)`.
   - Use ESM; no TypeScript; no external framework.
2. **`ops-watcher/lib/conductor.mjs`** — Pure ESM port of `conductor.ts` adapted to Aidit OS.
   - Replace `callBrain()` with an injected LLM caller (e.g., `callOllama()` passed as an argument).
   - Replace the roster discovery with an explicit roster argument so it does not import vendor code.
   - Keep the `broadcast` + `transcript` + synthesised `response` contract.
3. **`ops-watcher/roster.mjs`** — A registry of existing Aidit OS agents/lanes re-described as `RuntimeAgent` objects.
   - Examples: `security-audit`, `lane-cost-report`, `ledger-writer`, `context-eval`, `owner-gate`, `gbrain-curator`.
   - Each entry maps `run()` to the existing module's entry point or a thin adapter.
4. **`ops-watcher/tests/conductor.regression.test.mjs`** — Regression test exercising `runConductor()` with a fake roster and a stub LLM caller.
   - Verifies parallel execution, error wrapping, broadcast shape, and transcript presence.

Files to read (no edits):
- `ops-watcher/specialists.mjs` — understand existing fan-out points.
- `ops-watcher/routing.mjs` — understand lane routing rules so roster IDs match routing lane IDs.
- `skills/orchestration.md` — ensure the new layer respects lane boundaries.

### 4.2 Second slice (after the first slice lands)

- Introduce `ops-watcher/lib/cron.mjs` (roster-driven scheduler) and migrate one low-risk scheduled job to it (e.g., `lane-usage.mjs` or `gbrain-curator.mjs`) to prove the scheduling model.
- Add department metadata (`ops-watcher/lib/hierarchy.mjs`) and group the cockpit rail by department.
- Wire `corleone-dispatch.mjs` to call `runConductor()` for owner-decision requests that require multiple specialists.

### 4.3 Third slice (future)

- Port the richer chat/tool exposure from `runtime.ts` (`respond()`, `chatTools()`) only if the MCP server architecture needs it.
- Evaluate replacing `ahmad-dispatch.mjs` routing with the roster entirely — high risk, deferred until the first two slices prove stable.

---

## 5. Risks and mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Over-engineering** — replacing working dispatch with a new abstraction | High | Adopt a thin interface first; keep existing dispatch untouched; only migrate after tests pass |
| **LLM mismatch** — upstream `callBrain()` assumes Vercel / OpenAI-compatible streaming; Aidit OS uses Ollama | High | Inject the LLM caller; do not import `callBrain()`; write an Ollama adapter with a stub for tests |
| **State mismatch** — upstream is stateless per-request; Aidit OS relies on JSON state files and git | Medium | Keep Aidit OS persistence; make `RuntimeAgent.run()` read/write state as needed, no change required to orchestrator |
| **Identity collision** — lane IDs in routing must match roster IDs | Medium | Define roster in a single file and derive routing lane constants from it |
| **Case-record divergence** — transcript format could leak into owner UI | Medium | Keep transcript internal to orchestration; render cases via existing case-record contract |
| **Time budget overrun** — orchestrator fan-out may exceed lane time budgets | Medium | Conductor must enforce a per-run timeout and fail individual agents gracefully, as `runAgent()` already does |
| **Tool access widening** — agents may request extra tools | Medium | Follow `skills/orchestration.md`: each agent only gets the tools declared in its adapter; no global tool list |

---

## 6. Recommendation

**Adopt the pattern, not the implementation.**

The most valuable part of `vendor/founderos-demo/lib/agents/conductor.ts` and `runtime.ts` is the *uniform agent contract and parallel conductor fan-out*, not the FounderOS roster or the Vercel AI SDK glue. Aidit OS already has a richer owner-facing layer (`DESIGN.md` case records), durable state, and a working dispatch mesh. Therefore:

1. **Proceed with the first slice**: create `ops-watcher/lib/runtime-agent.mjs`, `ops-watcher/lib/conductor.mjs`, `ops-watcher/roster.mjs`, and a regression test.
2. **Do not modify existing dispatchers yet.** The first slice should be additive and testable.
3. **Use Corleone as the conductor identity.** The upstream "conductor" agent maps naturally to `agents/CORLEONE-ROLE.md`; Sjahrir remains the runtime executor.
4. **Preserve the Aidit OS case vocabulary and state model.** Internal transcript can borrow from upstream; external owner copy stays governed by `DESIGN.md`.
5. **Schedule the second slice only after the regression test and a safe canary run.** A full migration of `ahmad-dispatch.mjs` is out of scope for this packet.

---

## 7. Status and notes

- **Source changes:** None. Only `docs/adoption/A-orchestration.md` was created.
- **Files read (upstream, depth):**
  - `vendor/founderos-demo/lib/agents/conductor.ts`
  - `vendor/founderos-demo/lib/agents/runtime.ts`
  - `vendor/founderos-demo/lib/agents/real.ts`
  - `vendor/founderos-demo/lib/agents/activity.ts`
  - `vendor/founderos-demo/lib/hierarchy.ts`
  - `vendor/founderos-demo/lib/cron.ts`
  - `vendor/founderos-demo/AGENTS.md`
  - `vendor/founderos-demo/CLAUDE.md`
- **Files skimmed (Aidit OS, breadth):**
  - `agents/CORLEONE-ROLE.md`
  - `agents/SJAHRIR-ROLE.md`
  - `docs/agent-roster-notes.md`
  - `skills/orchestration.md`
  - `ops-watcher/ahmad-dispatch.mjs`
  - `ops-watcher/routing.mjs`
  - `ops-watcher/specialists.mjs`
  - `ops-watcher/lane-worktree.mjs`
  - `ops-watcher/heartbeat.mjs`
  - `ops-watcher/directive-runner.mjs`
  - `DESIGN.md`
  - `CLAUDE.md` (Aidit OS)
- **What was left out and why:**
  - A full code-level port of the interfaces was not implemented because the packet is READ-ONLY for source files. The report provides the plan and file-level blueprint instead.
  - The actual ESM port (`runtime-agent.mjs`, `conductor.mjs`) is left as a follow-up coding packet so it can be tested and landed independently.

