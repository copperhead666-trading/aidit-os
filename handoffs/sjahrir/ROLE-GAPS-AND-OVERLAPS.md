# ROLE GAPS & OVERLAPS — 2026-08-28 (SJAHRIR)

Rule applied throughout: no role is preserved merely because it exists.

## Overlaps (largest first)

1. **GIBRAN name collision across planes.** Old plane / legacy app: `gibran` =
   Hermes-runtime staff worker (renamed from `hermes` 2026-08-25). New plane:
   GIBRAN = reviewer/acceptance on Nous Free. Same name, opposite roles.
   Resolution needed at registry level (rename legacy reference or accept that
   legacy file is read-only history and never dispatch by bare name).

2. **Kimi identity sprawl.** Four Kimi-flavored things exist: SJAHRIR (Kimi K3
   direct CLI, active), KIMI (Lenovo native, BLOCKED), KIMI_FREE (OpenRouter,
   BLOCKED), legacy `thomas` (kimi-k2.7-code:cloud via Ollama). Only SJAHRIR
   has a live role. The other three should collapse to lane notes, not agents.

3. **Executor overlap (historical, mostly resolved).** SOEHARTO (retired),
   legacy `hatta`, new HATTA, CORLEONE — four builder identities. New plane
   already converged on HATTA; CORLEONE resting; SOEHARTO retired. Residual
   risk: old-plane registry still describes SOEHARTO as "principal builder" —
   stale-read hazard for any agent that reads `D:\AI\Agentic` without the
   new registry's retired_reference_only override.

4. **Trading observability overlap.** TRADING_DASHBOARD (OpenClaw Telegram bot,
   unpaired, frozen) vs STEWARD-CAVEMAN (Paperclip, paused) vs SOEKARNO's
   trading-skills install. Three things touch "trading visibility"; none is
   currently the single owner. STEWARD-CAVEMAN is the Bennett-faithful survivor.

5. **Nous free pool double-booking.** HERMES (worker) and GIBRAN (reviewer)
   both ride the same flaky free endpoint. Review verdicts competing with bulk
   worker calls on a 70–100s-latency endpoint is a throughput risk; acceptable
   only because both are sparse/event-triggered.

6. **Ollama model identities vs lane.** soedirman (glm-5.1), thomas
   (kimi-k2.7), legacy hatta (glm-5.2) are the same subscription wearing
   different name tags. The models are lanes/models, not agents.

## Gaps (largest first)

1. **No wired daily reviewer for HATTA.** Biggest open gap. GIBRAN role spec
   exists in Paperclip, mission says Nous Free, but no harness/dispatch path
   runs GIBRAN verdicts today (old review-scarce lane pointed at SOEKARNO,
   whose pool lapses 2026-09-14). HATTA material changes ship unreviewed.

2. **No test/QA execution role.** TEST-RUNNER is registered but paused and has
   no trigger wiring; nothing runs npm test/build automatically after HATTA
   writes code.

3. **No deployment verification capability.** D10 says Cloudflare Pages +
   Supabase; cloudflare/supabase MCP servers are configured with a PLACEHOLDER
   token (`PASTE_TOKEN_DISINI`), netlify CLI is installed against a frozen
   target. Deploy-verify role absent.

4. **GBrain curation is manual.** GBRAIN-CURATOR registered but ingestion runs
   only when someone (so far: HERMES/SJAHRIR session) does it by hand.

5. **Owner interface channel unwired.** Telegram pairing never established;
   AHMAD web UI was old-plane. Owner currently reaches the org only by starting
   a CLI session.

6. **No eval/observability lane.** Promptfoo/Langfuse named as valid
   enhancements in mission brief; neither installed. No regression-eval role
   for prompt/harness changes.

7. **Lenovo git credential manager broken** (fetch/push blocked) — blocks any
   future Lenovo-side implementation work regardless of roster design.

8. **Paperclip port drift** (3100 live vs 3101 documented) — watcher's target
   and docs disagree with reality; reconciliation needed before cutover.

## Agents that should stay DORMANT, not deleted

- CORLEONE (resting; only separate-vendor independent reviewer candidate
  post-2026-09-14; zero cost while resting).
- TRADING_DASHBOARD (frozen; Telegram pairing is an owner decision).
- TRADING-QUANT (dormant until trading remediation reactivates).
- SOEKARNO (preserve remaining quota; lapses naturally 2026-09-14).
- OpenClaw gateway (rollback snapshot, owner said freeze don't delete).

## Runtimes that can host many thin agents (sparse activation)

- Ollama Cloud Pro: 5 cloud models pulled — many thin specialists can share
  this pool (concurrency cap 3 is the only constraint; sparse activation makes
  collisions rare).
- Kimi Code K3 (SJAHRIR lane): heavy-context jobs beyond research.
- Nous free: only for latency-tolerant, retry-safe thin roles.
- Local qwen2.5:3b / nomic-embed-text: free classification/embedding chores.
