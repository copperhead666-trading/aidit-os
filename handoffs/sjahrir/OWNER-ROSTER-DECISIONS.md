# OWNER ROSTER DECISIONS — decision template for Aidit (2026-08-28, SJAHRIR)

Nothing below has been applied. Each item is a genuine owner decision.
Mark APPROVE / REJECT / MODIFY per row. SJAHRIR recommendations are marked
(rec) and are advisory only.

## D-1. Registry admission

| # | Question | Options | Rec |
|---|---|---|---|
| D-1.1 | Add SJAHRIR to `config/agent-registry.json` as heavy-context research/synthesis agent on Kimi K3 lane? | add / don't add | add |

## D-2. Reviewer wiring (closes the biggest gap)

| # | Question | Options | Rec |
|---|---|---|---|
| D-2.1 | Confirm GIBRAN = Nous Free for daily review, superseding RUNTIME-AND-WORKFLOW.md's review-scarce lane (Lenovo Claude)? | confirm Nous Free / keep Lenovo Claude until lapse / other | confirm Nous Free for daily; keep Lenovo Claude only for safety-critical until 2026-09-14 |
| D-2.2 | Authorize building a thin GIBRAN verdict runner (Hermes CLI one-shot that reads REVIEW_REQUIRED issues and posts VERDICT comments)? | authorize / defer | authorize |

## D-3. Identity consolidation

| # | Question | Options | Rec |
|---|---|---|---|
| D-3.1 | Retire KIMI (Lenovo, blocked) and KIMI_FREE (OpenRouter, no key) as registry entries? | retire both / keep as parked notes | retire both (SJAHRIR covers Kimi) |
| D-3.2 | Demote HERMES from named agent to lane name (L4 "hermes lane" serving many thin roles)? | demote to lane / keep as agent | demote to lane |
| D-3.3 | Resolve GIBRAN name collision with legacy `gibran` (Hermes staff worker)? | legacy file stays read-only history (no action) / rename legacy reference | no action — legacy file is read-only reference |

## D-4. Dormant/resting confirmations

| # | Question | Options | Rec |
|---|---|---|---|
| D-4.1 | CORLEONE stays RESTING (no activation, no spend) until explicitly needed? | confirm / other | confirm |
| D-4.2 | SOEKARNO quota preserved; no dispatches except gated safety reviews until natural lapse 2026-09-14? | confirm / other | confirm |
| D-4.3 | TRADING_DASHBOARD + OpenClaw gateway remain frozen (not deleted)? | confirm / delete | confirm frozen |

## D-5. Capability unlocks (each needs owner action, no agent can do these)

| # | Question | Options | Rec |
|---|---|---|---|
| D-5.1 | Log in Gemini CLI (free tier) to open a design/multimodal lane? | login / skip | optional — only if design-asset need arises |
| D-5.2 | Create real Supabase access token (replaces `PASTE_TOKEN_DISINI` placeholder) to enable DEPLOY-VERIFY? | create / skip | defer until first deploy |
| D-5.3 | Fix Lenovo git credential manager (blocks any Lenovo-side implementation)? | fix / skip | fix before any Lenovo work resumes |
| D-5.4 | Reconcile Paperclip canonical port (3100 live vs 3101 documented) and dispose/keep stray instance? | decide | decide before operational cutover (was blocker B1) |
| D-5.5 | Telegram owner-interface channel: wire it or drop it? | wire / drop / defer | defer (not blocking roster) |

## D-6. Budget guardrail

| # | Question | Options | Rec |
|---|---|---|---|
| D-6.1 | Reaffirm USD 60–70/mo ceiling with current lane set (Claude Pro ASUS + Ollama Cloud Pro + ChatGPT Plus resting + Kimi Code + free tiers)? | reaffirm / adjust | reaffirm |

---
Decision authority: Aidit only. Agents implement after explicit approval.
