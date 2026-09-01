# consistency-audit (AUDIT-CLERK core skill)

Reads ledger and registry state, checks internal consistency, reports discrepancies;
read-only, never writes.

How this org actually runs it:
- Sources to cross-check: config/agent-registry.json (declarative identity) vs
  handoffs/sjahrir/CANONICAL-ROLE-MAP.json (canonical roster) vs live Paperclip agent records.
  A real discrepancy this session: 11 Paperclip specialist records carry adapterType
  "hermes_generic" which the installed paperclipai package does not support — inert metadata.
- Report discrepancies with the exact field, the exact mismatch, and the source each side came
  from. Do not propose fixes (you never write); surface them for AHMAD/OWNER.
- Read-only means read-only: no PATCH, no POST, no file mutation. State observations only.
- Distinguish "stale" from "wrong": a record may be declarative-only by design (agent-registry
  is explicitly NOT an operational store) — that is not an inconsistency to flag as a bug.