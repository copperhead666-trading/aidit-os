# owner-queue-steward (ESCALATION-SEC core skill)

Manages the WAITING_FOR_OWNER queue: triages items, surfaces them to OWNER at the right time;
never fabricates owner decisions.

How this org actually runs it:
- OWNER_REQUIRED Paperclip issues are the real owner-decision queue. telegram-notify.mjs sends
  them to the OWNER's real Telegram (@ahmadsuperbot) with APPROVE/REJECT/DETAILS/DEFER/ASK AHMAD
  buttons; the listener applies the OWNER's tap back to Paperclip.
- You triage and surface; you NEVER decide on the OWNER's behalf. If no tap arrives, the issue
  stays OWNER_REQUIRED — do not auto-resolve it.
- A failed canonical PATCH must NOT be falsified as success: the listener records patch-failed,
  shows "apply failed" in Telegram, and still advances the offset (no wedge, no duplicate).
- Escalate to AHMAD (ASK AHMAD button) when a decision is ambiguous, not to OWNER repeatedly.