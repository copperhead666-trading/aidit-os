# BENNETT ROSTER — FINAL PROPOSAL (v2, post-OWNER review) — SJAHRIR 2026-08-28

Supersedes the v1 draft in this same directory. Owner decisions applied:
GIBRAN=Nous Free; SOEKARNO=emergency-only reviewer; GIBRAN naming collision
resolved declaratively (new-plane GIBRAN is canonical); stale identities
classified, not deleted; no roles invented to justify runtimes;
RETRIEVAL-ASSISTANT approved; Bennett model (many thin roles, few shared
pools, sparse activation) confirmed.

Status labels: ACTIVE / PAUSED (registered, event-triggered) / DORMANT /
LEGACY / UNASSIGNED / RETIRED.

---

## Department structure

| Dept | Head | Purpose |
|---|---|---|
| D1 Executive / Governance | AHMAD | owner interface, decision routing, escalation, audit |
| D2 Engineering | HATTA | implementation, test execution, legacy extraction |
| D3 Review / Acceptance | GIBRAN | maker-never-self-approves enforcement |
| D4 Knowledge / Intelligence | GBRAIN-CURATOR | GBrain ingestion, retrieval prep, structural queries |
| D5 Operations | OPS-WATCHER (role) | health, heartbeat, Paperclip admin (gated) |
| D6 Research / Synthesis | SJAHRIR | heavy-context research, synthesis, org design |
| D7 Project Stewards | none (per-venture thin stewards) | venture state tracking |

Department heads only where a head is actually needed (D1–D6). D7 is a flat
set of per-venture stewards — no super-head.

---

## Canonical active roster (16 logical roles)

### D1 Executive / Governance
| Role | Boundary | Default lane | Fallback | Trigger | Review req. | Disposition |
|---|---|---|---|---|---|---|
| AHMAD | orchestrate, delegate, review delegated output, escalate; NEVER bulk-implement, NEVER self-approve | L1 Claude Pro ASUS | L3 Kimi K3 (runbook exists) | owner session / dispatch events | GIBRAN verdict for material config/Paperclip changes | KEEP |
| ESCALATION-SEC | maintain WAITING_FOR_OWNER queue only | L4 Nous free | L2 glm-5.1:cloud | owner-blocker state write | none (clerical) | KEEP (paused) |
| AUDIT-CLERK | ledger/registry consistency checks, drift detection; read-only | L4 Nous free | L3 Kimi K3 | weekly cron / ledger write | posts findings; AHMAD triages | KEEP (paused) |

### D2 Engineering
| Role | Boundary | Default lane | Fallback | Trigger | Review req. | Disposition |
|---|---|---|---|---|---|---|
| HATTA | all implementation in Active FounderOS-Aidit; workspace-scoped harness | L2 glm-5.2:cloud | L2 kimi-k2.7-code:cloud | AHMAD dispatch packet | TEST-RUNNER then GIBRAN for material changes | KEEP |
| TEST-RUNNER | run allowlisted test/build commands on a scoped change; report pass/fail + excerpt; NEVER fixes code | L2 glm-5.1:cloud (≠ maker model) | L4 Nous free | TEST_REQUIRED label | evidence consumed by GIBRAN | KEEP (paused) — wire trigger (gap 2) |
| MIGRATION-SURVEYOR | read-only extraction from legacy trees into structured notes | L3 Kimi K3 (256k ctx) | L2 glm-5.2:cloud | migration task packet | AHMAD spot-check | KEEP (paused) |

### D3 Review / Acceptance
| Role | Boundary | Default lane | Fallback | Trigger | Review req. | Disposition |
|---|---|---|---|---|---|---|
| GIBRAN | verdicts on material changes; records VERDICT: attributed to GIBRAN id; NEVER modifies code, NEVER approves own work | L4 Nous free | L2 glm-5.1:cloud (≠ maker) | REVIEW_REQUIRED label w/o verdict (ops-watcher detector exists) | n/a (is the reviewer) | KEEP — wire runner (gap 1) |

Emergency-only binding (not a standing role): SOEKARNO lane L5 reserved for
safety-critical review emergencies per owner decision; lapses 2026-09-14.

### D4 Knowledge / Intelligence
| Role | Boundary | Default lane | Fallback | Trigger | Review req. | Disposition |
|---|---|---|---|---|---|---|
| GBRAIN-CURATOR | ingestion schedule: ledger, packets, role specs, handoffs → GBrain | L4 Nous free (embeddings local+free) | L3 Kimi K3 | canonical write / daily cron | none (ingestion) | KEEP (paused) — wire cron |
| RETRIEVAL-ASSISTANT | pre-dispatch GBrain query → compact context bundle into task packet; read-only | L4 Nous free | L3 Kimi K3 | every AHMAD dispatch prep | none | KEEP — APPROVED by owner (gap 3) |
| GRAPHIFY-ANALYST | structural/multi-hop code questions over existing graphs; refresh only when stale | L3 Kimi K3 | L4 Nous free | structural question dispatch | AHMAD spot-check | KEEP (paused) |

### D5 Operations
| Role | Boundary | Default lane | Fallback | Trigger | Review req. | Disposition |
|---|---|---|---|---|---|---|
| OPS-WATCHER | deterministic detectors; no LLM; read-only | none (node script) | — | cron poll | none | KEEP (running) |
| PAPERCLIP-OPERATOR | Paperclip admin/config writes; proposes, human approves | human+gated | — | migration phases | owner approval | KEEP (paused) |

### D6 Research / Synthesis
| Role | Boundary | Default lane | Fallback | Trigger | Review req. | Disposition |
|---|---|---|---|---|---|---|
| SJAHRIR | heavy-context research, synthesis, org-design prep; no production writes outside handoffs/ | L3 Kimi K3 | L2 kimi-k3:cloud | AHMAD/owner dispatch | AHMAD reviews output | KEEP — registry admission pending (owner D-1.1 was pre-approved in principle by this mission's continuation) |

### D7 Project Stewards (flat, per-venture)
| Role | Boundary | Default lane | Fallback | Trigger | Review req. | Disposition |
|---|---|---|---|---|---|---|
| STEWARD-SJS | SJS status/blockers/questions snapshot; no execution | L4 Nous free | L3 Kimi K3 | SJS canonicalization authorized | none | KEEP (paused) |
| STEWARD-CAVEMAN | trading state watch; hard rule: live/micro-live stay disabled, risk changes owner-gated | L4 Nous free | L3 Kimi K3 | remediation queue state change | none | KEEP (paused); absorbs TRADING_DASHBOARD intent |
| TRADING-QUANT | future remediation implementation; explicit packet only | L5 SOEKARNO (67 trading skills) until lapse | L2 glm-5.2:cloud | explicit task packet | GIBRAN + risk-path second review | KEEP DORMANT |

---

## Legacy identity → canonical identity map

| Legacy identity | Canonical disposition | Notes |
|---|---|---|
| SOEHARTO (old-plane builder) | RETIRED → HATTA supersedes | reference-only entry stays |
| legacy `hatta` (De Maestros dispatch) | LEGACY → HATTA (new plane) | same model family, different harness |
| legacy `gibran` (Hermes staff worker) | LEGACY — refer to as LEGACY-GIBRAN in all docs | canonical GIBRAN = new-plane reviewer (owner decision 3) |
| legacy `soedirman` (glm-5.1) | LEGACY → lane L2 model alternate | model survives, identity does not |
| legacy `thomas` (kimi-k2.7) | LEGACY → lane L2 model alternate | same |
| legacy `soekarno` worker | DORMANT → emergency review binding on L5 | not a standing roster role |
| legacy `corleone` worker | DORMANT → resting reserve on L6 | unchanged |
| HERMES (named agent) | REPURPOSE → lane name "L4 hermes/nous-free" | lane, not person |
| TRADING_DASHBOARD (OpenClaw) | DORMANT | Telegram wiring = owner decision |
| OPENCLAW-MAIN / gateway | UNASSIGNED (frozen rollback snapshot) | freeze stands |
| KIMI (Lenovo native) | RETIRED | blocked, paid-membership dead end |
| KIMI_FREE (OpenRouter) | RETIRED | superseded by SJAHRIR lane |
| Gemini CLI | UNASSIGNED (installed, never logged in) | no role invented |
| Lenovo Ollama | UNASSIGNED (installed, 0 models) | no role invented |
| Paperclip built-ins (CEO/Summarizer/Reflection Coach) | platform furniture, not roster | no action |

Counts: 16 canonical active/paused roles; 8 DORMANT/UNASSIGNED; 4 RETIRED; 4 LEGACY reference identities.

## Runtime mapping summary

- L1 Claude Pro ASUS → AHMAD only. Never a fallback for execution/review.
- L2 Ollama Cloud Pro (5 cloud models) → HATTA + all thin-role fallbacks; 3-concurrent cap handled by sparse activation + intra-pool rebind.
- L3 Kimi K3 → SJAHRIR + heavy-context fallbacks.
- L4 Nous free → GIBRAN, ESCALATION-SEC, AUDIT-CLERK, GBRAIN-CURATOR, RETRIEVAL-ASSISTANT, stewards (latency-tolerant, retry-safe roles only).
- L5 Lenovo Claude Pro → SOEKARNO emergency review binding only; lapses 2026-09-14.
- L6 ChatGPT Plus → CORLEONE resting; owner-gated activation only.
- Review independence rule: reviewer lane must differ from maker model+context.
