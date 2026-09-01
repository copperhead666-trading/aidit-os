# Activation and Review Flow — PROPOSED

**Status:** PROPOSED — pending owner sign-off via OWNER-ROSTER-DECISIONS.md. Not yet live.

---

## HATTA -> TEST-RUNNER -> GIBRAN flow

This is the proposed end-to-end sequence for material changes in Active FounderOS-Aidit. Today's reality differs — see the delta note at the end.

### Step-by-step (proposed)

1. **AHMAD dispatches a task packet to HATTA.** Trigger: AHMAD dispatch packet. Lane: L1 Claude Pro ASUS (AHMAD only). HATTA receives the packet on L2 glm-5.2:cloud.

2. **HATTA implements the change** within the workspace-scoped harness. No review at this point — HATTA is the maker.

3. **HATTA labels the change with `TEST_REQUIRED`** once code is written. This label is the trigger for TEST-RUNNER.

4. **TEST-RUNNER executes** the allowlisted test/build commands (`npm test`, `npm run build`, etc.) on the scoped change. It reports pass/fail + excerpt. TEST-RUNNER NEVER fixes code. Trigger: `TEST_REQUIRED` label. Lane: L2 glm-5.1:cloud (explicitly not a maker model). Evidence produced is consumed by GIBRAN.

5. **If tests pass**, HATTA labels the change with `REVIEW_REQUIRED` (no verdict yet). This label is the trigger for GIBRAN.

6. **GIBRAN issues a verdict.** GIBRAN reads the material change, records `VERDICT:` attributed to the GIBRAN id. GIBRAN NEVER modifies code and NEVER approves its own work. Trigger: `REVIEW_REQUIRED` label without an existing verdict (ops-watcher detector exists for this). Lane: L4 Nous free. Fallback: L2 glm-5.1:cloud (not maker model).

7. **AHMAD reviews GIBRAN's verdict.** If PASS: change is accepted. If REJECT/REVISE: HATTA revises and the loop restarts at step 3 (re-test, re-review).

8. **Review independence rule:** GIBRAN's lane (L4 Nous free) must differ from HATTA's maker model+context (L2 glm-5.2:cloud). This is satisfied by design.

### Delta between proposed flow and today's reality

- **Gap 1 (GIBRAN runner not wired):** As of 2026-08-28, GIBRAN dispatch *works* in practice — AHMAD has manually invoked GIBRAN via `hermes -z "..." --provider nous -m "upstage/solar-pro4:free"` for at least two real reviews (ops-watcher fix verdict PASS; HATTA runtime A/B verdict KEEP CURRENT). But there is **no automatic trigger/runner**. GIBRAN is still manually invoked by AHMAD per task. The proposed flow above assumes a wired runner that reads `REVIEW_REQUIRED` issues and posts `VERDICT` comments automatically. That runner does not exist yet — it is the subject of OWNER-ROSTER-DECISIONS D-2.2 (rec: authorize).

- **Gap 2 (TEST-RUNNER trigger not wired):** TEST-RUNNER is registered but **paused with no trigger wiring**. Nothing runs `npm test`/`npm run build` automatically after HATTA writes code. In today's reality, step 4 above does not happen automatically — there is no detector listening for the `TEST_REQUIRED` label. TEST-RUNNER requires wiring before the flow is complete.

**Net:** The full HATTA → TEST-RUNNER → GIBRAN sequence cannot run end-to-end today. HATTA material changes ship with partial coverage at best (manual GIBRAN reviews happen, but no automatic test execution and no automatic review trigger).

---

## RETRIEVAL-ASSISTANT pre-dispatch flow

This flow runs before AHMAD dispatches any task packet to an executor (HATTA or otherwise). RETRIEVAL-ASSISTANT is read-only and was APPROVED by the owner (gap 3 closed).

### Step-by-step (proposed)

1. **AHMAD prepares to dispatch.** AHMAD has decided to send a task packet to an executor (e.g., HATTA). Before writing the packet, AHMAD invokes RETRIEVAL-ASSISTANT.

2. **RETRIEVAL-ASSISTANT queries GBrain.** Trigger: every AHMAD dispatch prep. Lane: L4 Nous free. Fallback: L3 Kimi K3. RETRIEVAL-ASSISTANT performs a pre-dispatch GBrain query — it retrieves relevant context (ledger entries, prior packets, role specs, handoff notes, canonical state) related to the dispatch topic.

3. **RETRIEVAL-ASSISTANT returns a compact context bundle.** The bundle is a condensed, structured summary of the GBrain retrieval — not the raw graph. It is sized to fit into a task packet without overwhelming the executor's context window. Read-only: RETRIEVAL-ASSISTANT does not write to production state.

4. **AHMAD incorporates the bundle into the task packet.** AHMAD uses the compact context as a foundation for the dispatch packet, reducing the need for the executor to re-derive context from scratch.

5. **AHMAD dispatches the packet to the executor.** With the RETRIEVAL-ASSISTANT bundle included, the packet goes to HATTA (or whichever role is the target).

6. **No review required for RETRIEVAL-ASSISTANT itself.** The role is retrieval-only; it does not produce material changes. No GIBRAN verdict is needed for the retrieval step.

---

## Runtime fallback/collision handling

This section defines the concrete rules for lane exhaustion and unavailability. Each role's fallback_lane is taken from the canonical roster above.

### Concurrency cap handling

- **L2 Ollama Cloud Pro has a 3-concurrent-model cap.** When all three slots are occupied and a role whose default lane is L2 needs to run, the system selects that role's `fallback_lane` instead of queuing or failing.

- **Mechanism: sparse activation + intra-pool rebind.** Because most roles are sparse (not all active simultaneously), the 3-concurrent cap is normally sufficient. When it is not, the rebind logic switches the role to its fallback lane for that execution only.

- **Examples from the roster:**
  - HATTA (default L2 glm-5.2:cloud) → falls back to L2 kimi-k2.7-code:cloud
  - TEST-RUNNER (default L2 glm-5.1:cloud) → falls back to L4 Nous free
  - MIGRATION-SURVEYOR (default L3 Kimi K3) → falls back to L2 glm-5.2:cloud
  - STEWARD-SJS / STEWARD-CAVEMAN (default L4 Nous free) → fall back to L3 Kimi K3
  - TRADING-QUANT (default L5 SOEKARNO) → falls back to L2 glm-5.2:cloud

### Default lane unavailable

- If a role's default lane is unavailable (e.g., the cloud model endpoint is down, the local model is not loaded, the runtime is not reachable), the role uses its `fallback_lane` for that execution.
- If both the default lane and the fallback lane are unavailable, the execution is **deferred** and AHMAD is notified. No role invents a new lane not listed in its spec.

### GIBRAN-specific constraint

- GIBRAN's fallback lane (L2 glm-5.1:cloud) is explicitly marked "not maker" in the roster. This preserves the review-independence rule even when GIBRAN falls back: the fallback model must still differ from HATTA's maker model (L2 glm-5.2:cloud).
- SOEKARNO (L5) is NOT a fallback for GIBRAN. SOEKARNO is reserved for safety-critical review emergencies only and lapses 2026-09-14.

### Lane-to-role summary (for reference)

| Lane | Roles using it as default | Notes |
|---|---|---|
| L1 Claude Pro ASUS | AHMAD only | Never a fallback for execution/review |
| L2 Ollama Cloud Pro (5 cloud models) | HATTA, TEST-RUNNER, MIGRATION-SURVEYOR (fallback), TRADING-QUANT (fallback) | 3-concurrent cap; sparse activation + intra-pool rebind |
| L3 Kimi K3 | SJAHRIR, MIGRATION-SURVEYOR, GRAPHIFY-ANALYST, RETRIEVAL-ASSISTANT (fallback), ESCALATION-SEC (fallback), AUDIT-CLERK (fallback), GBRAIN-CURATOR (fallback), STEWARD-SJS (fallback), STEWARD-CAVEMAN (fallback) | Heavy-context roles |
| L4 Nous free | GIBRAN, ESCALATION-SEC, AUDIT-CLERK, GBRAIN-CURATOR, RETRIEVAL-ASSISTANT, STEWARD-SJS, STEWARD-CAVEMAN, TEST-RUNNER (fallback), GRAPHIFY-ANALYST (fallback) | Latency-tolerant, retry-safe roles only |
| L5 Lenovo Claude Pro | SOEKARNO emergency review binding only | Lapses 2026-09-14; not a fallback for any standing role |
| L6 ChatGPT Plus | CORLEONE resting reserve | Owner-gated activation only |

---

## Final disposition summary

Grouped by status label. Restates the disposition column from the canonical roster — not a redesign.

### ACTIVE (running now)

| Role | Department | Notes |
|---|---|---|
| AHMAD | D1 Executive / Governance | Owner interface; L1 Claude Pro ASUS |
| HATTA | D2 Engineering | All implementation; L2 glm-5.2:cloud |
| GIBRAN | D3 Review / Acceptance | Reviewer; L4 Nous free; manual dispatch works, auto-runner not wired (gap 1) |
| RETRIEVAL-ASSISTANT | D4 Knowledge / Intelligence | Pre-dispatch GBrain query; L4 Nous free; owner-approved (gap 3) |
| OPS-WATCHER | D5 Operations | Deterministic detectors; node script; running |
| SJAHRIR | D6 Research / Synthesis | Research/synthesis; L3 Kimi K3; registry admission pending (D-1.1 pre-approved in principle) |

### PAUSED (registered, not yet wired/active)

| Role | Department | Gap / Note |
|---|---|---|
| ESCALATION-SEC | D1 Executive / Governance | Clerical; L4 Nous free |
| AUDIT-CLERK | D1 Executive / Governance | Ledger consistency; L4 Nous free |
| TEST-RUNNER | D2 Engineering | Gap 2: no trigger wiring; L2 glm-5.1:cloud |
| MIGRATION-SURVEYOR | D2 Engineering | L3 Kimi K3 |
| GBRAIN-CURATOR | D4 Knowledge / Intelligence | Gap: cron not wired; L4 Nous free |
| GRAPHIFY-ANALYST | D4 Knowledge / Intelligence | L3 Kimi K3 |
| PAPERCLIP-OPERATOR | D5 Operations | Human+gated; owner approval required |
| STEWARD-SJS | D7 Project Stewards | L4 Nous free |
| STEWARD-CAVEMAN | D7 Project Stewards | L4 Nous free; absorbs TRADING_DASHBOARD intent |

### DORMANT (exists, not active, may be activated later)

| Role | Department | Notes |
|---|---|---|
| TRADING-QUANT | D7 Project Stewards | L5 SOEKARNO until lapse; explicit packet only; GIBRAN + risk-path second review required |

### UNASSIGNED (present in environment, no role invented)

| Identity | Notes |
|---|---|
| OPENCLAW-MAIN / gateway | Frozen rollback snapshot; freeze stands |
| Gemini CLI | Installed, never logged in; no role invented |
| Lenovo Ollama | Installed, 0 models; no role invented |

### RETIRED (removed from active consideration)

| Identity | Notes |
|---|---|
| SOEHARTO (old-plane builder) | RETIRED; HATTA supersedes; reference-only entry stays |
| KIMI (Lenovo native) | RETIRED; blocked, paid-membership dead end |
| KIMI_FREE (OpenRouter) | RETIRED; superseded by SJAHRIR lane |

### LEGACY (reference-only; use designated alias in docs)

| Legacy Identity | Canonical Reference |
|---|---|
| legacy hatta (De Maestros dispatch) | LEGACY → HATTA (new plane); same model family, different harness |
| legacy gibran (Hermes staff worker) | LEGACY-GIBRAN in all docs; canonical GIBRAN = new-plane reviewer |
| legacy soedirman (glm-5.1) | LEGACY → lane L2 model alternate; model survives, identity does not |
| legacy thomas (kimi-k2.7) | LEGACY → lane L2 model alternate |

### Counts

- 16 canonical active/paused roles
- 1 DORMANT role (TRADING-QUANT)
- 3 RETIRED identities
- 4 LEGACY reference identities
- 3 UNASSIGNED identities
- 1 platform-furniture entry (Paperclip built-ins — not roster)

**Total roles/identities tracked: 27**
