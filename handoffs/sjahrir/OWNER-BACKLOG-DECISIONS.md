# OWNER BACKLOG DECISIONS — FounderOS-Aidit

> Owner decisions that directly shape the canonical backlog.  
> Sources: user instruction in this mission; `config/agent-registry.json`; `handoffs/ahmad/AHMAD-SESSION-HANDOFF-2026-08-28.md`; `config/decision-ledger.json`.

## Decisions from this reconciliation mission

1. **Canonical backlog reconciliation = APPROVED.**
   - SJAHRIR authorized to reconcile 46 historical items against current truth.
   - No implementation of backlog items authorized.

2. **Strategic sequence after reconciliation = APPROVED.**
   - Cognitive Core → Owner UX → Domain Modules.
   - Reflected in macro roadmap A–G in `MASTER-CANONICAL-BACKLOG.md`.

3. **Cloud / zero-laptop work = DEFERRED.**
   - Do not activate cloud-first control plane, Supabase canonical state, cloud Telegram ingress, cloud scheduler, cloud execution runtime, edge workers, shadow validation, or live cutover until Ahmad-FounderOS is proven stable.
   - Preserve as backlog (FOS-03/04/05/06/07/08/09/10).
   - This overrides historical ACTIVE/BACKLOG/FUTURE statuses in the recovery document.

4. **Post-stability ASUS+Lenovo cleanup = APPROVED IN PRINCIPLE, OWNER-GATED.**
   - Deletion of legacy `D:\Agentic` (FOS-24) and broader AI/FounderOS filesystem cleanup (FOS-25) approved conceptually.
   - Actual deletion remains OWNER-gated and only after stability/dependency proof.
   - No destructive action authorized now.

## Pre-existing owner decisions affecting backlog

| ID | Source | Decision | Backlog impact |
|---|---|---|---|
| D-1.1 | agent-registry.json | SJAHRIR admitted as implementation lane | FOS-19/AGENT-02 safe to route to SJAHRIR |
| D-3.1 | agent-registry.json | KIMI (Lenovo native) and KIMI_FREE (OpenRouter) RETIRED | No Lenovo-native Kimi lane in active roster |
| D-3.2 | agent-registry.json | HERMES demoted to lane name | HERMES = Nous Free worker lane, not standing agent |
| D-3.3 | agent-registry.json | legacy gibran → LEGACY-GIBRAN alias | No action on legacy file |
| D-4.1 | agent-registry.json | CORLEONE resting | CORLEONE not on critical path; later approved for hardening closeout only |
| D-4.2 | agent-registry.json | SOEKARNO scarce emergency fallback, lapses 2026-09-14 | Do not spend SOEKARNO quota |
| D-4.3 | agent-registry.json | TRADING_DASHBOARD + OpenClaw gateway remain FROZEN | TRD-01 Robot Trading/TradingOS stays KEEP_BACKLOG |
| D-5.4 | agent-registry.json | Paperclip repinned to canonical port 3110 | HIST-02 DONE; operational company of record |
| D-6.1 | agent-registry.json | Budget ceiling USD 80/mo | New cloud/provider spend requires OWNER approval |
| D10 | decision-ledger.json | Deployment: Cloudflare Pages + Supabase; Netlify frozen | Relevant to FOS-04 when cloud resumes |
| D11 | decision-ledger.json | Roadmap tier order: 1 → 3 → 2 → 4 | Informs venture/module prioritization |
| D20 | decision-ledger.json | Buku Toko is legacy-but-live, not target architecture | Informs PROD-03/SJS module inventory |
| D25 | decision-ledger.json | Legacy Rp4.5M receivable / Rp8.5M payable not current fact | Informs financial module data reconciliation |

## Owner-gated items requiring explicit future approval

The following items are kept in backlog specifically because they require owner authority gates. They are **not** OWNER_DECISION-classified in the reconciliation because the owner has already set the policy (defer / gate); they await activation, not a new decision.

- **FOS-03/04/05/06/07/08/09/10** — cloud/zero-laptop cluster: activation deferred until stability, then owner go/no-go on cost, secrets, cutover.
- **FOS-10** — live production cutover + zero-laptop acceptance: explicit owner go/no-go.
- **FOS-24** — legacy `D:\Agentic` decommission: explicit owner approval required for any deletion.
- **FOS-25** — post-stability AI/FounderOS filesystem cleanup: explicit owner approval required for any deletion.
- **TRD-01** — Robot Trading/TradingOS: unfreeze requires owner decision (currently frozen per D-4.3).
- **TRD-02 / BUS-01** — Caveman / SJS domain activation: gated by Phase 8 stability; owner ungate required.

## No unresolved OWNER_DECISION classifications

After applying the above owner policies, none of the 46 items remain blocked on an *unmade* owner decision. All are either:
- DONE/ACTIVE with clear next steps,
- KEEP_BACKLOG awaiting stability/activation per already-stated owner policy,
- SUPERSEDED by current architecture,
- NEEDS_RECOVERY pending scope recovery from owner or legacy sources.
