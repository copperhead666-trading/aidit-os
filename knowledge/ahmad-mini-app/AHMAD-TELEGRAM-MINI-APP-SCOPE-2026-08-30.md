# AHMAD Telegram Mini App — Scope & Architecture

**Status:** SCOPE + ARCHITECTURE drafted, 2026-08-30. No implementation started. Explicitly gated behind P6 (cloud/zero-laptop) per the OWNER's own priority: "scope & design now, build when P6 opens."

**OWNER's own framing (2026-08-30, paraphrased from Indonesian):** the current Telegram decision-card system and Claude Artifact links are both acceptable stopgaps, but neither is the real answer. Claude Artifacts are a capability of AHMAD's *engineering session* (this Claude Code CLI session) — temporary, tied to AHMAD being actively worked on. The OWNER wants AHMAD itself to be a **permanent** personal assistant that does not require this session's ongoing presence to function day to day. The visual/approval UI should reflect that: professional, not "kuno" (outdated), and maintained as part of AHMAD's own permanent infrastructure — not something the OWNER depends on AHMAD's *builder* to keep alive.

---

## 1. Why a Telegram Mini App (live-verified 2026-08-30)

Real, current (2026) capability confirmed via web search: Telegram Mini Apps are full HTML/CSS/JS web apps that render **directly inside Telegram's own chat interface** — no separate app to open, no context-switch away from the channel the OWNER already treats as their command center. They support custom dashboards, persistent per-user local storage (up to 5MB via `DeviceStorage`), secure storage for sensitive data, and full UI/UX control (React/Vue/vanilla, developer's choice) via Telegram's WebApp SDK, which also provides cryptographically-verifiable Telegram user identity to the backend (`initData`) — a stronger, more standard auth boundary than the current `chatId === OWNER_CHAT_ID` string comparison already used throughout `ops-watcher/telegram-*.mjs`.

This directly answers the OWNER's requirement: the Mini App becomes part of `@ahmadsuperbot`'s own permanent infrastructure (registered once via BotFather's `/setwebapp`), not a capability tied to any particular engineering session.

## 2. The real constraint (why this waits for P6)

Telegram requires Mini Apps to be served from an **HTTPS-hosted, always-on URL** (Vercel/Netlify/AWS-class hosting, verified via live search) — it cannot point at "whenever the ASUS laptop happens to be on." This is not a small detail: it means real cloud hosting is a hard prerequisite, not an optional nice-to-have. This is squarely P6 (cloud/zero-laptop) territory, which the OWNER has explicitly deferred to later in this same session. Building the Mini App itself before P6 is open would mean either (a) standing up ad hoc cloud hosting just for this one feature, contradicting the "P6 is a deliberate, later decision" framing, or (b) building against a URL that goes dark whenever the laptop sleeps, defeating the entire "permanent" premise the OWNER is asking for. Neither is acceptable, so this stays scope-only until P6 is opened.

**Useful discovery for when P6 does open:** historical FounderOS work (per `handoffs/ahmad/AHMAD-SESSION-HANDOFF-2026-08-28.md` and earlier backlog docs, FOS-03 "zero-laptop control plane") records that "a dedicated FounderOS Supabase project and shadow cloud path were then built/tested to an Alpha-level scope" — real prior cloud groundwork may already exist and could reduce how much of this needs to be built from zero once P6 is unblocked. Worth re-investigating that Supabase project's actual current state as a first step when P6 starts, rather than assuming a blank slate.

## 3. Proposed architecture (proposal only — every concrete choice below is for OWNER/AHMAD confirmation when P6 opens, not a final decision)

```
Telegram client (OWNER's phone/laptop)
        |
        v
[Mini App frontend -- HTML/CSS/JS, hosted on HTTPS cloud infra]
   - Unified inbox: all pending OWNER_REQUIRED decisions in one view
     (replacing today's one-message-per-card Telegram flow)
   - Each decision renders its FULL context inline -- including embedded
     visual content (KPI mockups, widget designs) directly, not as an
     out-of-band link the OWNER has to tap away to see
   - Dynamic option rendering (reuses the same decision_options metadata
     shape being built into telegram-notify.mjs right now -- binary
     APPROVE/REJECT and multi-choice A/B/C both render natively as proper
     UI controls, not forced into a text-button template)
   - A general cockpit/status view (reuses cockpit-status.mjs's existing
     data: queue health, lane health, review status, observability)
        |
        v  (Telegram WebApp SDK initData -- cryptographic identity proof)
[Backend API layer -- new, thin, hosted alongside the frontend]
   - Verifies initData against the bot token (real Telegram-provided
     auth, stronger than today's plain chatId string match)
   - Proxies to Paperclip's existing REST API for issue/comment read+write
     (reuses ops-watcher/paperclip-write-client.mjs's patterns/conventions
     directly -- this layer should not reinvent Paperclip access, just
     expose a Mini-App-shaped view of the same canonical operations)
        |
        v
[Paperclip -- canonical operational state, unchanged]
```

Why this shape: Paperclip stays the single canonical operational-truth store (no new parallel state), the Mini App is purely a richer VIEW/INTERACTION layer on top of what already exists, and the dynamic-options work landing in `telegram-notify.mjs`/`telegram-listener.mjs` right now is directly reusable (the same `decision_options` metadata shape both channels would read).

## 4. What stays as the interim bridge until P6

- Telegram's existing button-based decision cards (with the dynamic multi-choice options now being added) remain the real, working approval channel.
- Visual content (KPI mockups, widget designs) gets delivered via a Claude Artifact link in the interim — acceptable as a stopgap specifically because it is infrequent, not the OWNER's primary daily interaction, and does not block anything real from happening in the meantime.

## 5. Open questions for when P6 opens (not decided now)

- Exact hosting choice (Vercel/Netlify/a VPS/reusing the existing FounderOS Supabase project) — a real, if smaller, decision once cloud is unblocked.
- Whether the Mini App becomes AHMAD's *primary* daily interface (superseding plain-text Telegram messages for routine notifications too) or stays scoped to decisions/visual review specifically, with routine chat staying as plain messages.
- Whether/how the SJS SuperApps or Caveman Trading OS ventures might eventually get their own views inside the same Mini App, or stay entirely separate.

## 6. Confidence note

Telegram Mini App capabilities and hosting requirements above came from live web search performed 2026-08-30, not training-data recall. Architecture is AHMAD's own synthesis/proposal, explicitly not final — gated behind the OWNER opening P6.
