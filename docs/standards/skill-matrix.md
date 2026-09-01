# FounderOS Skill Matrix

Status: active standard. Written 2026-08-24 in the legacy repo, migrated 2026-09-01.

The machine-readable source for this repo is `config/skill-matrix.json`.

## Rule

Every Ahmad dispatch must pick a task class before choosing a worker. The task class decides required skills, standards, compact context, maker/reviewer preference, and hard stops. If a task does not fit a class, Ahmad must ask or create a new class proposal instead of improvising.

Only the current roster may be assigned in this matrix: AHMAD, HATTA, CORLEONE, SJAHRIR, GIBRAN, and SOEKARNO. GIBRAN is review/analysis only and must never be a preferred maker.

Required standards must point to standards that exist in this repo. This matrix uses:

- `docs/standards/design-quality-standard.md`
- `docs/standards/prompting-standards.md`
- `docs/standards/self-evolution-governance.md`
- `docs/standards/project-layer-standard.md`

## Matrix

| Task class | Required skills | Required standards | Maker | Reviewer | Compact context | Hard stops |
| --- | --- | --- | --- | --- | --- | --- |
| frontend-design | `ui-ux-pro-max`, `impeccable` | `docs/standards/design-quality-standard.md`, `docs/standards/project-layer-standard.md` | CORLEONE | HATTA | Include target route/component paths, viewport risks, and only affected project layers. | do not install Framer Motion unless motion is used |
| backend-api | `agent-dev-backend-api`, `verification-quality` | `docs/standards/project-layer-standard.md`, `docs/standards/prompting-standards.md` | HATTA | CORLEONE | Include route/service/schema paths, API contract, and targeted tests. | no credential write; no public deploy; no billing mutation |
| database-storage | `agentdb-memory-patterns`, `verification-quality` | `docs/standards/project-layer-standard.md` | HATTA | CORLEONE | Include schema/table names, migration behavior, compatibility expectations, and rollback evidence. | no DROP TABLE or destructive migration without owner approval; preserve existing SQLite rows |
| agent-dispatch | `agent-orchestrator-task`, `agent-sandbox`, `verification-quality` | `docs/standards/prompting-standards.md`, `docs/standards/self-evolution-governance.md` | HATTA | CORLEONE | Use a compact dispatch packet; include authority, mutation, mission, urgency, and hard stops. | no scheduled worker resume; no unaudited or unallowlisted GLM shell exposure; no permanent role expansion |
| repo-analysis | `graphify`, `agent-code-analyzer` | `docs/standards/prompting-standards.md`, `docs/standards/project-layer-standard.md` | SJAHRIR | GIBRAN | Prefer graphify-out/README.md, graph.json, and exact file paths over broad repo dumps. | no automatic Graphify run from dashboard; no paid semantic extraction without owner approval |
| cleanup-archive | `verification-quality`, `agent-sandbox` | `docs/standards/project-layer-standard.md`, `docs/standards/self-evolution-governance.md` | HATTA | GIBRAN | Include target path, classification, dry-run/evidence path, archive path, and verification method. | archive before delete; never delete private files; never touch active repo without registry evidence |
| trading-safety | `anthropic-skills:caveman`, `agent-trading-predictor`, `verification-quality` | `docs/standards/project-layer-standard.md`, `docs/standards/self-evolution-governance.md` | HATTA | SOEKARNO | Include Caveman control files, risk gate, broker boundary, and no-live-trading mutation statement. | no live broker mutation; no weakened risk gate; no credential exposure |
| infra-network | `agent-security-manager`, `agent-ops-cicd-github` | `docs/standards/project-layer-standard.md`, `docs/standards/self-evolution-governance.md` | CORLEONE | HATTA | Start with read-only inventory: device, access path, config backup status, owner impact, and rollback. | no router config write without backup; no firewall/NAT/VPN mutation without owner approval; no credential readout |
| owner-communication | `internal-comms`, `verification-quality` | `docs/standards/prompting-standards.md` | AHMAD | GIBRAN | Owner-facing output must be short, Indonesian-first, and show approve/reject/edit impact. | no scattered approval prompts; batch login/credential actions |

## Global Hard Stops

- No task may skip its relevant standard just because the prompt is short.
- No cleanup task may delete without archive evidence and explicit safety classification.
- No infra/network task may mutate router/firewall/VPN config without a backup and owner approval.
- No trading task may weaken risk gates or touch live broker paths without the Caveman control process.
- No design task may produce generic/template UI without checking the design quality gate.

## Implementation

Consumers must read `config/skill-matrix.json` instead of parsing this document. Tests or manual checks should prove every task class has at least one required skill, one standard, one hard stop, and maker/reviewer values drawn only from the current roster.
