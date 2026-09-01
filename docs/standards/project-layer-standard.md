# FounderOS Project Layer Standard

Status: active standard. Written 2026-08-24 in the legacy repo, migrated 2026-09-01.

The machine-readable source for this repo is `config/project-layers.json`.

## Rule

Every project packet must answer the 13 layers below before implementation begins. If a layer is not needed yet, mark it `deferred` with a reason. Do not leave it invisible.

| Layer | Owner question | FounderOS status | Evidence / next gap |
| --- | --- | --- | --- |
| Frontend layer | Can the owner/operator use it without reading code? | partial | No Next.js/TS/build frontend was found in this repo; owner-facing surface is Telegram (`docs/standards/design-quality-standard.md`, `ops-watcher/telegram-notify.mjs`, `ops-watcher/telegram-listener.mjs`). |
| API and backend logic | Are workflows behind typed server logic? | partial | Backend orchestration exists as Node `.mjs` workers around Paperclip and Telegram, not as a typed app API (`ops-watcher/heartbeat.mjs`, `ops-watcher/directive-runner.mjs`, `ops-watcher/ahmad-dispatch.mjs`). |
| Database and storage | Is durable state separated from artifacts? | implemented | Paperclip/local database identity, declarative `config/*.json`, and operational JSON/JSONL files are separated (`config/paperclip-endpoint.json`, `config/agent-registry.json`, `ops-watcher/heartbeat.mjs`, `ops-watcher/lane-usage.mjs`). |
| Authentication and authorization | Who can access it and what can they do? | partial | Telegram owner gating and HATTA path/command authority exist; web login/Mini App auth is not implemented yet (`ops-watcher/telegram-client.mjs`, `ops-watcher/telegram-listener.mjs`, `hatta/harness.mjs`, `knowledge/ahmad-mini-app/AHMAD-TELEGRAM-MINI-APP-SCOPE-2026-08-30.md`). |
| Hosting and deployment | How does it run and get promoted? | partial | Local PM2 hosting/supervision exists; production/cloud promotion is deferred (`ops-watcher/ecosystem.config.cjs`, `ops-watcher/pm2-supervisor.mjs`, `scripts/pm2-supervisor-run.cmd`). |
| Cloud compute | Which work is local, and which work may use cloud capacity? | partial | Lane routing covers local/cloud/free lanes and cooldowns; zero-laptop/cloud migration is not implemented (`ops-watcher/routing.mjs`, `config/agent-registry.json`). |
| CI/CD and version control | Can changes be verified and promoted predictably? | partial | Local regression and promotion gates exist; no `.github` CI directory was found (`docs/standards/self-evolution-governance.md`, `ops-watcher/run-all-tests.mjs`). |
| Role-level security | Does each AI have scope and mutation limits? | implemented | HATTA workspace jail, command policy, secret/package mutation guards, and registry role authority are implemented (`hatta/harness.mjs`, `hatta/harness.security.test.mjs`, `config/agent-registry.json`). |
| Rate limiting | Can runaway/costly work stop before quota damage? | partial | Lane-level quota/cooldown guards exist; general HTTP edge rate limiting is not present (`ops-watcher/lane-guard.mjs`, `ops-watcher/routing.mjs`). |
| Cache and CDN | What is cached, and what must stay live? | deferred | Deferred because this repo has no deployed frontend/CDN path; the richer Telegram Mini App requires HTTPS always-on cloud hosting and waits for P6 (`knowledge/ahmad-mini-app/AHMAD-TELEGRAM-MINI-APP-SCOPE-2026-08-30.md`, `handoffs/ahmad/NEXT-SESSION-PROMPT-2026-08-31.md`). |
| Load balancer and scaling | How does it handle more agents, machines, or users? | deferred | Deferred because current scaling is local PM2 supervision plus lane routing/queue discipline; multi-host/cloud scaling remains P6/future work (`ops-watcher/pm2-supervisor.mjs`, `ops-watcher/routing.mjs`, `config/agent-registry.json`). |
| Error and tracking | Are failures diagnosable from durable evidence? | implemented | `ops-watcher/heartbeat-steps.jsonl` and `ops-watcher/lane-usage.jsonl` are present and populated; writers and failure paths are in `ops-watcher/heartbeat.mjs`, `ops-watcher/lane-usage.mjs`, and `ops-watcher/telegram-listener.mjs`. |
| Availability and recovery | What happens when model/machine/DB/owner is unavailable? | partial | PM2 supervision, heartbeat step logging, bounded self-repair, and actuator snapshots exist; cloud/zero-laptop recovery remains deferred (`ops-watcher/pm2-supervisor.mjs`, `ops-watcher/self-repair.mjs`, `ops-watcher/self-repair-actuator.mjs`). |

## Per-Project Application

- FounderOS: `config/project-layers.json` is the machine-readable source for this repo; this document is the prose standard.
- SJS SuperApps: before Ahmad dispatches SJS work, the task packet must map the work to these layers, especially ERP auth, role security, DB/storage, deployment, and error tracking.
- Caveman Trading OS: every broker/execution/risk task must map to these layers with extra emphasis on authZ, rate limits, error tracking, availability/recovery, and no unapproved live trading mutation.
- Future projects: use this layer pack as the initial checklist before maker dispatch.

## Dispatch Requirement

A maker prompt must include only the relevant layer subset, not the whole document. A reviewer prompt must check whether omitted layers were consciously deferred, not forgotten.
