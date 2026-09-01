# DELTA CHECKPOINT — Migration Phase 1 (HERMES/Kimi, 2026-08-28)

## ACCEPTANCE EVIDENCE
1. Canonical Paperclip instance = 127.0.0.1:3101 (PID 17824, -d D:\AI\Active
   FounderOS-Aidit\.paperclip). Instance 3100 is a leftover bare `paperclipai run`
   (0 companies, idle postgres on :54329) — NOT destroyed, flagged only.
   3102 in readiness report was port drift, no discrepancy remains.
2. Kolega Corp ownership CONFIRMED: company id a7011f31-... name "kolega corp",
   status active, in DB paperclip_founderos_aidit on :5433. Contains Ahmad (ceo).
3. Restore test PASSED: fresh backup (paperclip-20260828-130227.sql.gz) restored
   to isolated DB paperclip_restore_test — exit 0, COMMIT, 168 tables,
   counts companies/agents/issues = 1/3/1, identical to live. Test DB left intact
   as evidence; drop when approved.
4. GBrain populated (10 pages incl. canonical-decision-ledger, agent-registry,
   aidit-principles, permission-model, task-packet-standard, hatta-role/harness,
   org proposal, readiness). Semantic query verified (e.g. D26 cash decision
   retrieved top-ranked).
5. GIBRAN review path LIVE: Paperclip agent ce433688 (role reviewer, active)
   + AGENTS.md spec. HATTA cannot self-approve by registry + Paperclip split.
6. Legacy queue STAGED INACTIVE: 8 issues (KOL-LEGACY-*) origin_kind=migration,
   status=backlog, labeled MIGRATED_PENDING_REVALIDATION. Original JSONs untouched.

## NEXT MISSIONS
- M1: Ahmad runtime-swap runbook (agent-level, cheap lane).
- M2: OPS-WATCHER probes incl. backup-restore cron evidence.
- M3: Phase 2 prep (status snapshot refresh, SJS/Caveman).
- M4: Ahmad ceo-agent session-limit error on instance 3101 — resolve when
  Ahmad's Claude quota window allows; not blocking this migration.

## OWNER BLOCKERS (Aidit)
- B1: Authorize disposal of stray instance 3100 (or repurpose).
- B2: Revalidate KOL-LEGACY-* queue (pick which become real work).
Nothing else. All Phase-1 work executed by HERMES lane; Ahmad untouched.
