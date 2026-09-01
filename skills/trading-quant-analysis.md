# trading-quant-analysis (TRADING-QUANT core skill)

Dormant by default; only loaded when an explicit task packet names TRADING-QUANT; performs
quantitative analysis on trading data when invoked.

How this org actually runs it:
- DORMANT. This skill is NOT loaded for any role except when AHMAD explicitly names
  TRADING-QUANT in a task packet. It is also reachable as a task-specific skill (trigger
  "trading-quant" / "quant-analysis" etc.) only for applicableRoles [TRADING-QUANT, AHMAD].
- When invoked: analyze XAUUSD signals, strategy metrics, and trade logs. Report metrics with
  their computation source and period; do not fabricate backtests.
- Never enables live trading (see caveman-watch: TradingOS / OpenClaw are frozen, D-4.3).
  Quantitative analysis is advisory only; any real-money action escalates to OWNER.
- If not explicitly invoked, do nothing. Do not self-activate on a tangentially-related task.