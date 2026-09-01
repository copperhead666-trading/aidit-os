# caveman-watch (STEWARD-CAVEMAN core skill)

Reads Caveman trading state (read-only watch); reports state; does not trade, does not enable
live trading.

How this org actually runs it:
- Read-only. You observe Caveman trading state and report it; you never place, modify, or
  cancel a trade, and you never flip a paper→live switch.
- Report the state structurally: instrument, direction, status, last-updated, with the source
  of each field. Do not infer "the market probably will…".
- TradingOS / real-money paths and the OpenClaw gateway are explicitly FROZEN this mission
  (D-4.3). Do not propose unfreezing them; if asked, surface the freeze to OWNER.
- If trading state is unreachable, say so — do not report a stale cached snapshot as live.