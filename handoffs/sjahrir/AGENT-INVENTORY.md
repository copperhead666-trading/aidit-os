# AGENT INVENTORY — Cross-Machine (ASUS + Lenovo)

Compiled by SJAHRIR (Kimi K3 direct CLI) 2026-08-28. READ-ONLY survey — no
credentials changed, no Paperclip operational state written, no agent woken,
no SOEKARNO quota spent (Lenovo checks were binary-presence / login-status /
file reads only, no LLM completions).

Status labels: ACTIVE / DORMANT / RESTING / BLOCKED / RETIRED / INSTALLED-ONLY.

---

## 1. Active plane — `D:\AI\Active FounderOS-Aidit` (declarative registry + handoffs)

### AHMAD — ACTIVE
- Machine: asus-control. Role: logical orchestrator (owner-facing, delegate-don't-do).
- Runtime: Claude Code CLI (`claude`, ~/.local/bin/claude); provider Anthropic; runtime-swappable by design (runbook exists: `hatta/workspace/runbook/AHMAD-RUNTIME-SWAP-RUNBOOK.md`).
- Auth: Claude Pro subscription OAuth, account pusatberasmurah@gmail.com. PROVEN.
- Quota pool: Anthropic Claude Pro (ASUS) — historically SHARED with SOEHARTO (double-spend risk documented in old-plane topology audit).
- Skills/tools: orchestration, delegation, review; `can_implement=false`.
- Strengths: highest-quality reasoning lane; owner trust; full tool surface.
- Evidence: `config/agent-registry.json` (AHMAD block), `.claude/settings.json`.

### HATTA — ACTIVE (verified 2026-08-28)
- Machine: asus-control. Role: primary technical executor.
- Runtime: Ollama Cloud via local daemon `ollama.exe` :11434; primary model `glm-5.2:cloud`. Alternates on same account: `kimi-k2.7-code:cloud`, `glm-5.1:cloud`, `gpt-oss:20b-cloud`, and (newly pulled, seen in `ollama list` 2026-08-28) `kimi-k3:cloud`.
- Auth: Ollama Cloud Pro, ed25519 keypair ~/.ollama/id_ed25519. PROVEN (3-way quota-independence evidence vs AHMAD: PID, auth artifact, netstat).
- Quota pool: Ollama Cloud Pro — separate from Anthropic and OpenAI. Known 3-concurrent-model cap (legacy notes).
- Tools: `hatta/harness.mjs` — read_file/write_file/list_directory/run_command (allowlist git,node,npm,bun,rg,dir,type,echo; shell:false; 30s; path-escape guard; localhost-only endpoint guard).
- Strengths: cheap bulk implementation, verified end-to-end, hardened harness.
- Gap: no independent reviewer wired yet for material changes.
- Evidence: `hatta/ROLE.md`, `hatta/HARNESS.md`, `hatta/harness.mjs`, `hatta/proof-of-life.md`, registry HATTA block.

### SJAHRIR — ACTIVE (this session)
- Machine: asus-control. Role: heavy-context research, synthesis, org-design prep.
- Runtime: Kimi Code CLI direct (`~/.kimi-code/bin/kimi`), provider Moonshot managed:kimi-code, model `k3` (also configured: `k3-256k`, `kimi-for-coding` K2.7, highspeed variant). OAuth file storage `~/.kimi-code/credentials`.
- Auth: PROVEN by this live session. Quota pool: independent Kimi Code subscription — separate from AHMAD and HATTA (per mission brief).
- Strengths: 256k context, strong long-doc synthesis, cheap relative to Claude.
- Note: NOT yet in `config/agent-registry.json` — registry addition is an OWNER/registry decision, not made here.
- Evidence: `~/.kimi-code/config.toml`, this session.

### GIBRAN — DORMANT-DEFINED (role live, lane unresolved)
- Machine: asus-control (Paperclip agent). Role: reviewer/acceptance for HATTA material changes; must be a distinct Paperclip agent id; records VERDICT: comments.
- Runtime per CURRENT owner decision (mission brief): **Nous Free**.
- Conflict flagged: `handoffs/hermes-kimi/RUNTIME-AND-WORKFLOW.md` still maps the `review-scarce` lane to Claude Code on Lenovo via SSH (SOEKARNO's pool). Mission statement supersedes — GIBRAN = Nous Free. The lane-map doc needs an update when OWNER confirms.
- Quota pool: Nous Portal free tier — SHARED endpoint with HERMES (same provider, flaky, 70–100s latency pattern).
- Tools: none beyond verdict recording (by design).
- Evidence: `.paperclip/.../agents/gibran/AGENTS.md`, SHARED-TOOLS.md (agent id ce433688), RUNTIME-AND-WORKFLOW.md.

### OPS-WATCHER — ACTIVE (deterministic service, not an LLM agent)
- `ops-watcher/watcher.mjs` — read-only detector loop, no LLM calls. Last heartbeat event present in `ops-watcher/events.jsonl` (paperclip_reachable, ollama_reachable, gbrain_exists all true at last sweep).
- Routes events to logical lanes: AHMAD, ESCALATION-SEC, GIBRAN, OPS-WATCHER.

### Paperclip built-in agents (kolega corp, company a7011f31)
- CEO agent (cdea95bd-…) — Paperclip-native lead agent; currently in session-limit error state (resets on Ahmad's next run; cosmetic).
- Summarizer (49e32f0f-…) — built-in status summarizer, cheap lane, heartbeat-driven.
- Reflection Coach (fcae00e6-…) — built-in coaching/proposal agent, gated mutations.
- Status: INSTALLED-ONLY for FounderOS purposes (platform furniture, not roster).

### Paperclip-registered thin specialists — DORMANT (status=paused, Phase B)
AUDIT-CLERK, ESCALATION-SEC, TEST-RUNNER, MIGRATION-SURVEYOR, GRAPHIFY-ANALYST,
GBRAIN-CURATOR, RETRIEVAL-ASSISTANT, OPS-WATCHER(role), PAPERCLIP-OPERATOR,
STEWARD-SJS, STEWARD-CAVEMAN, TRADING-QUANT.
- All are definitions only (sparse activation); no warm processes. Evidence: MIGRATION-STATUS.md Phase B.

---

## 2. Old plane — `D:\AI\Agentic` (registry STALE 2026-08-22; machine-inventory value only)

### SOEHARTO — RETIRED (owner decision 2026-08-28)
- Was: principal builder, Claude Code CLI on ASUS, shared AHMAD's quota pool. Do not reactivate/rename. Reference only.

### SOEKARNO — RESTING/PRESERVE (scarce)
- Machine: lenovo-trading (DESKTOP-00NH05I, reachable via SSH alias today).
- Runtime: Claude Code CLI on Lenovo (`D:\Development\npm-global\claude`); creds file present (`~/.claude/.credentials.json` — existence checked, never opened).
- Quota pool: separate Claude Pro (adityainofficial@gmail.com) — **lapses 2026-09-14, will not be renewed** (owner decision 2026-08-22). Limited remaining quota — preserve per mission.
- Skills: 67 trading/quant/DeFi skills (agiprolabs) installed on Lenovo; Lenovo `~/.claude/skills` also has design/brand/ui-ux/impeccable/spec family (18 dirs).
- Role today: mandatory independent reviewer for Caveman risk-adjacent code until 2026-09-14. No new default work.

### CORLEONE — RESTING (do not activate — mission constraint)
- Machine: lenovo-trading. Runtime: codex-cli 0.149.0 (`D:\Development\npm-global\codex`).
- Auth: ChatGPT login — **re-verified live today** via `codex login status` over SSH → "Logged in using ChatGPT" (read-only check, zero model quota).
- Quota pool: ChatGPT Plus (pusatberasmurah@gmail.com). Never had a successful end-to-end task dispatch — auth-only proven.
- ALSO: a second Codex CLI 0.149.0 install exists on ASUS (npm global) and was used once (2026-08-28) to bootstrap HATTA's harness. Same ChatGPT account — one pool, two machines.

### HERMES — ACTIVE-AS-RUNTIME (free worker lane)
- Machine: asus-control. Runtime: Hermes CLI one-shot (`hermes -z`), model upstage/solar-pro4:free, Nous Portal OAuth.
- Quota pool: Nous free tier — flaky (documented APIConnectionError pattern, retries absorb it). Gateway frozen by owner instruction; CLI path only.
- Note: mission brief defines GIBRAN = Nous Free too → GIBRAN and HERMES share the same free pool. Thin agents on this lane must tolerate latency/flakiness.

### KIMI (Lenovo native) — BLOCKED
- kimi-code-cli 0.38.0 on Lenovo; device-code login rejected by backend (requires paid Moonshot membership). Owner declined paid sub. Dead end unless policy changes.

### KIMI_FREE — BLOCKED (auth never created)
- OpenRouter `moonshotai/kimi-k2.6:free`, 50 calls/day, text-only HTTP dispatch. Needs `OPENROUTER_API_KEY` (owner action). Unused free pool.

### TRADING_DASHBOARD — DORMANT (OpenClaw agent)
- OpenClaw-native agent `trading`, Telegram bot @SJSejahtera_BOT, claude-opus-4-6 on shared ASUS Claude pool. Telegram pairing never established. Gateway frozen. Overlaps STEWARD-CAVEMAN conceptually.

### OpenClaw `main` agent — INSTALLED-ONLY
- Default agent slot in `~/.openclaw/openclaw.json`; no FounderOS role. Gateway frozen.

---

## 3. Legacy app dispatch registry — `D:\FounderOS-Aidit De Maestros\app\lib\dispatch` (read-only reference)

7 workers in `registry.ts`: soeharto, **soedirman** (GLM-5.1:cloud), hatta (GLM-5.2:cloud), corleone, **gibran** (⚠ = Hermes runtime — name collision with new-plane GIBRAN reviewer), soekarno, **thomas** (Kimi k2.7-code:cloud).
- `venture-roles.ts` (2026-08-25): hatta = Kepala Project for BOTH ventures; soedirman/thomas/gibran = staff; soeharto/soekarno/corleone resting.
- Unique names not carried forward: SOEDIRMAN, THOMAS (both just Ollama Cloud model bindings — no independent identity value; the models remain available under HATTA's account).

---

## 4. Runtimes installed with NO logical agent attached

| Runtime | Machine | Auth state | Notes |
|---|---|---|---|
| Gemini CLI 0.56.0 | ASUS (nvm4w) | NEVER logged in | Free tier only per owner instruction; unused multimodal/design lane |
| Ollama (daemon) | Lenovo (D:\Ollama) | daemon responds, `ollama list` EMPTY (0 models) | Idle capacity on Lenovo; could host local models |
| qwen2.5:3b (local) | ASUS Ollama | local, free | Pulled 11 days ago; no assigned role |
| nomic-embed-text (local) | ASUS Ollama | local, free | In use by GBrain embeddings |
| netlify CLI | ASUS npm global | unknown | Deployment FROZEN to Netlify per decision D10 — tool has no valid role |
| supabase CLI | ASUS npm global | MCP configured w/ placeholder token | Backend per D10; CLI present, token not set |
| mcp-telegram | ASUS npm global | unknown | Old Telegram plumbing; channel wiring pending owner |
| OpenClaw gateway | ASUS | configured, frozen | Kept as rollback snapshot per owner |

---

## 5. Paperclip / Kolega Corp state (read-only observation)

- Company: "kolega corp" (a7011f31-…), active, DB paperclip_founderos_aidit @ :5433.
- Agents on disk: CEO, GIBRAN, Summarizer, Reflection Coach; 12 Phase-B specialists registered paused (per MIGRATION-STATUS).
- **Port drift flagged**: docs variously say canonical = 3101 (AHMAD-DELTA-PHASE1), 3102 (readiness), config.json requests 3100. Live today: **3100 answers /api/health (v2026.817.0)**; 3101/3102 do not respond. OPS-WATCHER targets 3101 and reported reachable at its last sweep. Needs owner/agent reconciliation — not modified here.
- Backups: enabled, 60min/30d retention; restore test PASSED 2026-08-28.
- Stray bare instance previously noted on :3100 with 0 companies (owner blocker B1).

## 6. GBrain / Graphify

- GBrain 0.47.3.0 real install, local nomic-embed-text embeddings, store `knowledge/store/.gbrain/brain.pglite`; ~17 corpus pages ingested; semantic retrieval verified. No API keys needed.
- Graphify: active graph 265 nodes/20 communities; legacy graph 3975 nodes/7895 edges/328 communities. Used for this inventory's legacy lookups.

## 7. Skills surfaces

- ASUS `~/.claude/skills`: ~600 skills (caveman family, trading, superpowers, design, marketing, compliance, etc.) — available to Claude-lane agents.
- Lenovo `~/.claude/skills`: 18 curated dirs (design/brand/ui-ux/impeccable/spec/graphify/review family) + 67 agiprolabs trading skills (plugin).
- Paperclip skill catalog: reflection-coach, summarize-status (built-ins).
- HATTA harness: 4 tools (see §1 HATTA).
