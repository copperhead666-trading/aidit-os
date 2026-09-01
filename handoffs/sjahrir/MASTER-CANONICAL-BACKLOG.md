# MASTER CANONICAL BACKLOG — FounderOS-Aidit

> Reconciled from `handoffs/historical/FOUNDEROS-HISTORICAL-BACKLOG-HANDOFF.md` (46 items).  
> Rule: **current verified FounderOS state overrides historical/stale reports.**  
> No backlog item was implemented during this reconciliation.

## Reconciliation summary

| Classification | Count |
|---|---|
| DONE | 6 |
| ACTIVE | 9 |
| KEEP_BACKLOG | 25 |
| SUPERSEDED | 2 |
| NEEDS_RECOVERY | 4 |
| OWNER_DECISION | 0 |
| DROP_RECOMMENDED | 0 |
| **Total** | **46** |

## Macro sequence (non-activating)

Per owner strategic direction after reconciliation:

1. **A — Current stability/soak** (resolve live residual conflicts, verify false-DONE disposition, close routing audit)
2. **B — Cognitive Core** (FOS-14 / FOS-15)
3. **C — Owner UX / cockpit** (FOS-12 / FOS-13)
4. **D — Personal/professional modules** (PROD-04/05/06/07/08 after recovery)
5. **E — Ventures/domain activation** (TRD-02, BUS-01 after ungate)
6. **F — Cloud/zero-laptop** (FOS-03/04/05/06/07/08/09/10 — later, only after stability)
7. **G — Post-stability cleanup** (FOS-24/25 — last, owner-gated)

## Highest-value KEEP_BACKLOG items

- **FOS-14 — Cognitive Core / Context Graph / relevant context retrieval**  
  Unlocks every downstream module; local gbrain already working.
- **FOS-15 — Memory provenance, contradiction, drift and causal learning**  
  Required for trustworthy autonomous operation.
- **PROD-08 — Work / Life / Personal operating modules**  
  Protects human time; central to FounderOS value proposition.
- **PROD-03 — Business / venture management modules**  
  Command-center surface for SJS, Caveman, and future ventures.
- **TRD-02 — Caveman Trading OS**  
  Real venture; resume after domain-activation ungate.
- **BUS-01 — SJS SuperApps**  
  Real venture; resume after domain-activation ungate.
- **FOS-12 — Telegram Decision Card / escalation UX**  
  Reduces owner interruption load.

## NEEDS_RECOVERY items

Scope insufficient in current evidence; do not invent architecture.

- **PROD-04 — Health OS / health-life execution**
- **PROD-05 — Learning OS**
- **PROD-06 — Lawyer Copilot**
- **PROD-07 — Civil Law Mastery**

## Biggest stale conflicts found

1. **Cloud/zero-laptop cluster (FOS-03 → FOS-10):** historical ACTIVE/BACKLOG/FUTURE statuses are overridden by owner decision #3 — cloud/zero-laptop work is **DEFERRED** until Ahmad-FounderOS is stable.
2. **FOS-11 Telegram reliability:** AHMAD handoff lists two live residual issues (rapid-repeat comment dedupe; Task Scheduler restart gap), while the closeout update claims PASS for both. Real soak needed to resolve.
3. **FOS-21 false-DONE integrity:** historical ledger listed 3 stale false-DONE rows needing owner-approved correction; current registry shows zero blockers, but disposition of those rows is unverified.
4. **TRD-02 Caveman / BUS-01 SJS:** historical ACTIVE status is overridden by AHMAD handoff gating Phase 8 domain activation until P7/stability conditions are met.

---

# Reconciled items

| ID | Name | Category | Class | Evidence summary | Stale claim overridden | Remaining work | Deps | Ahmad-safe |
|---|---|---|---|---|---|---|---|---|
| FOS-01 | FounderOS as the single canonical operating system | FounderOS Core | ACTIVE | Consolidation target is `D:\AI\Active FounderOS-Aidit`; agent-registry.json points here. | Old root `D:\FounderOS-Aidit De Maestros\app` superseded. | Path/tooling updates as new root becomes truth. | FOS-18, AGENT-02 | yes |
| FOS-02 | Ahmad as single logical orchestrator | FounderOS Core | ACTIVE | agent-registry.json defines AHMAD role; roster decisions confirm. | Older Soeharto-lead roster retired. | Routing compliance, delegation audit, escalation UX. | FOS-19, FOS-22, FOS-12 | yes |
| FOS-03 | FounderOS cloud-first / zero-laptop control plane | FounderOS Cloud | KEEP_BACKLOG | Owner decision #3: **DEFERRED** until stable. | Historical ACTIVE status. | Preserve backlog; no activation until owner approves. | FOS-04–FOS-10 | yes |
| FOS-04 | Supabase as canonical Ahmad operational state | FounderOS Cloud | KEEP_BACKLOG | Cloud deferred. Current state is Paperclip local Postgres + SQLite legacy. | Historical ACTIVE / Alpha shadow tables. | Re-evaluate after stability. | FOS-03, FOS-09 | yes |
| FOS-05 | Cloud Telegram owner ingress | FounderOS Cloud | KEEP_BACKLOG | Cloud deferred. Local long-poll daemon live. | Historical ACTIVE / imminent webhook switch. | Preserve design; no setWebhook without owner. | FOS-03, FOS-04, FOS-06 | yes |
| FOS-06 | Cloud scheduler and reconciliation | FounderOS Cloud | KEEP_BACKLOG | Cloud deferred. Local heartbeat daemon + Task Scheduler proven. | Historical ACTIVE cloud cron. | Activate only after cutover gate. | FOS-03, FOS-04, FOS-07 | yes |
| FOS-07 | Dedicated cloud Ahmad execution runtime | FounderOS Cloud | KEEP_BACKLOG | Cloud deferred; no paid runtime provisioned. | Historical BACKLOG / agreed direction. | Provider/cost/secret decisions owner-gated. | FOS-03, FOS-04, FOS-06 | yes |
| FOS-08 | Optional edge workers + WAITING_FOR_EDGE semantics | FounderOS Cloud | KEEP_BACKLOG | Cloud deferred; edge semantics not built. | Historical BACKLOG. | Capability declarations, heartbeat, waiting/retry after cloud. | FOS-03, FOS-07, FOS-19, FOS-22 | yes |
| FOS-09 | Shadow/parallel validation + Owner Action Pack | FounderOS Cloud | KEEP_BACKLOG | Cloud deferred. Local validation suites pass. | Historical ACTIVE shadow pipe. | Consolidate Owner Action Pack when cloud resumes. | FOS-03, FOS-04–FOS-08 | yes |
| FOS-10 | Live production cutover + zero-laptop acceptance | FounderOS Cloud | KEEP_BACKLOG | Cloud deferred; plan exists, not executed. | Historical FUTURE / eventual cutover. | Readiness, owner go/no-go, live switch, laptops-off acceptance. | FOS-03, FOS-09 | yes |
| FOS-11 | Telegram no-response / owner-path reliability | Owner UX | ACTIVE | Daemon live-verified; closeout claims PASS, but handoff still notes rapid-repeat dedupe and Task Scheduler restart gaps. | Bridge disabled by design is stale; now always-on. | Real soak to resolve conflict; watchdog/docs for scheduler gap. | FOS-16, FOS-17 | yes |
| FOS-12 | Telegram Decision Card / escalation UX | Owner UX | KEEP_BACKLOG | Design agreed; no module found. | None. | Schema, callbacks, note capture, audit, tests. | FOS-02, FOS-13, Paperclip | yes |
| FOS-13 | Omnichannel Ahmad | Owner UX | KEEP_BACKLOG | Principle agreed; only Telegram exists. | None. | Channel abstraction, identity mapping, shared context. | FOS-03, FOS-14, FOS-12 | yes |
| FOS-14 | Cognitive Core / Context Graph / relevant context retrieval | Cognitive & Memory | KEEP_BACKLOG | Owner sequence #2. Local gbrain works, but no Context Graph in dispatch. | None. | Graph semantics, retrieval/ranking, provenance, integration. | FOS-01, FOS-23, GBRAIN | yes |
| FOS-15 | Memory provenance, contradiction, drift and causal learning | Cognitive & Memory | KEEP_BACKLOG | Principles agreed; no canonical modules found. | None. | Encode update policies, confidence gating, causal loops. | FOS-14 | yes |
| FOS-16 | Hatta governed tool access | Agent Workforce | DONE | Harness hardened; 52/0 security tests; 23/0 adversarial probe; secrets clean. | Phase-7 9/9 claim was incomplete; now remediated. | Maintenance only. | — | yes |
| FOS-17 | Hatta interactive CLI + multiline UX | Agent Workforce | ACTIVE | CLI exists; proof-of-life verified; multiline UX status uncertain. | Core done. | Verify/reliable multiline paste; re-run smoke tests. | FOS-16, FOS-18 | yes |
| FOS-18 | Hatta canonical root and context precedence | Agent Workforce | DONE | Root fixed to `D:\AI\Active FounderOS-Aidit`; no drift to `D:\Agentic`. | Drift to `D:\Agentic` fixed. | Maintain policy. | FOS-01 | yes |
| FOS-19 | Multi-agent delegation / workforce orchestration | Agent Workforce | ACTIVE | Registry canonicalized; role map exists; review-runner dispatches GIBRAN. | Older roster retired/resting. | Routing compliance, dynamic availability, delegation audit. | FOS-22, AGENT-01 | yes |
| FOS-20 | Delta-only Prompting Style Contract | Agent Workforce | DONE | Skills system built; delta-only contract encoded. | Historical ACTIVE. | Ongoing compliance evaluation. | AGENT-02 | yes |
| FOS-21 | False-DONE integrity / quality-gate closure semantics | Orchestration Reliability | ACTIVE | Patches landed; tests pass; registry shows zero blockers. **Conflict:** 3 stale rows needing owner correction historically listed, disposition unverified. | Live acceptance pending. | Verify stale-row disposition; run fresh DONE proving cycle if needed. | FOS-22, Paperclip | yes |
| FOS-22 | Capability-aware dispatch routing (remove staff[0] hardcoding) | Orchestration Reliability | ACTIVE | routing.mjs resolves lanes from role map, real-exercised. Need to confirm no staff[0] remains in canonical paths. | Historical BACKLOG bug. | Audit canonical dispatch for staff[0]; add regression test. | FOS-19, role map | yes |
| FOS-23 | Historical backlog recovery / master ledger | Historical Recovery | ACTIVE | This reconciliation is the current mission. | Pass-1 ~50 candidates superseded. | Finish artifacts; owner review; integrate with Cognitive Core. | FOS-01, FOS-18 | yes |
| FOS-24 | Legacy `D:\Agentic` decommission | Historical Recovery | KEEP_BACKLOG | Owner decision #4: approved in principle, deletion OWNER-gated. | Historical FUTURE. | Recovery, dependency checks, archive, owner approval, staged deletion. | FOS-10, FOS-23, FOS-25 | yes |
| FOS-25 | Post-stability AI/FounderOS filesystem cleanup | Historical Recovery | KEEP_BACKLOG | Owner decision #4: approved in principle, owner-gated deletion. | Historical FUTURE. | Inventory, dependency map, archive plan, staged deletion. | FOS-10, FOS-23, FOS-24 | yes |
| FOS-26 | FounderOS product/capability roadmap FINAL | FounderOS Core | ACTIVE | This mission derives macro roadmap A-G. | Historical FUTURE. | Owner review; dependency clustering; final approval. | FOS-10, FOS-14, FOS-23 | yes |
| PROD-01 | AI Employees / Agentic Foundry / AI Solution Factory | Products & Ventures | KEEP_BACKLOG | Concept exists; internal workforce direction only. | None. | Recover use cases, packaging, boundaries, business model. | FOS-02, FOS-19, PROD-03 | yes |
| PROD-02 | Autonomous-company operating model | Products & Ventures | KEEP_BACKLOG | Patterns implemented; formal model not finalized. | None. | KPI/reporting, multi-venture scheduling, staffing economics. | FOS-02, FOS-12, FOS-19, PROD-03 | yes |
| PROD-03 | Business / venture management modules | Products & Ventures | KEEP_BACKLOG | Paperclip live; SJS/Caveman referenced. Real vs demo modules not inventoried. | Claim of many existing modules/connectors unverified. | Inventory real modules; connect data; venture templates. | FOS-01, FOS-23, Paperclip | yes |
| PROD-04 | Health OS / health-life execution | Personal OS Modules | NEEDS_RECOVERY | Placement/guardrails explicit; no current canonical docs/modules. | Recoverable scope implied; not visible. | Recover domains, routines, data sources, dashboards from owner/legacy. | FOS-14, FOS-15 | yes |
| PROD-05 | Learning OS | Personal OS Modules | NEEDS_RECOVERY | Principle explicit; no curriculum/progress/interface. | Details mostly missing. | Recover curriculum, progress model, memory integration. | FOS-14, FOS-15 | yes |
| PROD-06 | Lawyer Copilot | Personal OS Modules | NEEDS_RECOVERY | Guardrail explicit; no jurisdiction/use cases/workflows. | Use cases not recovered. | Recover jurisdiction, sources, document workflows, citations. | FOS-14 | yes |
| PROD-07 | Civil Law Mastery | Personal OS Modules | NEEDS_RECOVERY | Named only; no curriculum/jurisdiction/sources. | Only name recoverable. | Recover jurisdiction/curriculum, objectives, source corpus. | PROD-05, PROD-06, FOS-14 | yes |
| PROD-08 | Work / Life / Personal operating modules | Personal OS Modules | KEEP_BACKLOG | Principles explicit; no canonical modules/interfaces. | Module details incomplete. | Recover exact modules/workflows and balanced planning UI. | FOS-14, FOS-15, PROD-04/05 | yes |
| TRD-01 | Robot Trading / TradingOS | Trading | KEEP_BACKLOG | Owner decision D-4.3: TRADING_DASHBOARD + OpenClaw **FROZEN**. | Active architecture work assumed. | Recover details only if owner unfreezes. | TRD-02, infrastructure | yes |
| TRD-02 | Caveman Trading OS | Trading | KEEP_BACKLOG | Phase 8 domain activation GATED by AHMAD handoff. | Historical ACTIVE venture status. | Recover roadmap; resume after owner ungates. | FOS-21, FOS-22, FOS-10 | yes |
| BUS-01 | SJS SuperApps | Business Venture | KEEP_BACKLOG | Phase 8 domain activation GATED; decisions in decision-ledger.json. | Historical ACTIVE venture status. | Recover backlog/roadmap; fix stale state after ungate. | FOS-21, FOS-22, decision-ledger | yes |
| VOICE-01 | Jason voice assistant / Siri-Jarvis quality target | Voice & Embodiment | KEEP_BACKLOG | No Jason code/docs found in canonical repo. | Historical PAUSED status. | Recover repo/state if any; decide persona vs Ahmad voice. | FOS-13, FOS-08, hardware | yes |
| VOICE-02 | Embodied / voice / mobile owner interface | Voice & Embodiment | KEEP_BACKLOG | Concept only; no implementation. | None. | Persona/surface, mobile stack, wake/listen, privacy, latency. | FOS-13, VOICE-01 | yes |
| INFRA-01 | Agentic workstation topology / hardware plan | Infrastructure | SUPERSEDED | Cloud-first direction; laptops optional edge workers. | Two-laptop topology no longer drives architecture. | Preserve as historical reference. | FOS-03, FOS-08 | yes |
| INFRA-02 | Cloud/edge worker transport and capability model | Infrastructure | KEEP_BACKLOG | Cloud deferred; no secure remote transport built. | None. | Transport/auth, heartbeat, edge-offline semantics after cloud. | FOS-03, FOS-07, FOS-08, FOS-19 | yes |
| INFRA-03 | Credential/security/owner-authority framework | Infrastructure | DONE | Harness hardened; security audit passes; secrets clean; owner gates applied. | Historical ACTIVE status. | Maintenance; formal rotation/revocation as future improvement. | — | yes |
| HIST-01 | Legacy 2026-09-14 Agentic worker-ownership cutover | Historical / Superseded | SUPERSEDED | Legacy plan tied to Claude subscription; not current architecture. | Historical SUPERSEDED status. | Preserve lessons only. | FOS-23 | yes |
| HIST-02 | Paperclip / external-Postgres migration pattern | Historical / Foundation | DONE | Paperclip live on local Postgres :3110, company 'kolega corp'. | Subset migration is now full operational company of record. | Maintenance; reuse lessons if Supabase resumes. | — | yes |
| AGENT-01 | Qwen agent formalization | Agent Workforce | KEEP_BACKLOG | Qwen installed locally but no formal FounderOS role. | None. | Inventory model, evaluate, assign role or non-use. | FOS-19, role map | yes |
| AGENT-02 | Session/account-swap bootstrap and continuation handoffs | Agent Workforce | DONE | Handoff protocol exists; skills support targeted bootstrap. | Historical ACTIVE. | Maintain; update paths on root changes. | FOS-20, FOS-01 | yes |
