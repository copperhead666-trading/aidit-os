# RUNTIME / CAPACITY MAP — ASUS + Lenovo (2026-08-28, SJAHRIR)

Runtime lanes are independent of logical role identity (RUNTIME-AND-WORKFLOW.md
adapter model). One lane can serve many thin agents; one role can be re-bound
across lanes per task packet.

## Lane table

| # | Lane | Provider / account | Machine | Runtime binary | Auth state (evidence) | Quota pool | Known limits | Current roles |
|---|---|---|---|---|---|---|---|---|
| L1 | conductor | Anthropic Claude Pro, pusatberasmurah@gmail.com | ASUS | Claude Code CLI | PROVEN (subscription OAuth; live session) | Claude Pro ASUS | weekly/session caps, headless % not observable | AHMAD |
| L2 | technical | Ollama Cloud Pro | ASUS (daemon :11434) | ollama.exe → ollama.com | PROVEN (ed25519 keypair exists; live glm-5.2 completion 2026-08-28; netstat to ollama.com) | Ollama Cloud Pro | 3-concurrent-model cap (legacy notes) | HATTA (+ legacy soedirman/thomas models) |
| L2 models | — | — | — | — | `glm-5.2:cloud`, `glm-5.1:cloud`, `kimi-k2.7-code:cloud`, `gpt-oss:20b-cloud`, `kimi-k3:cloud` (all pulled); local: `nomic-embed-text` (GBrain), `qwen2.5:3b` (idle) | same pool | — | — |
| L3 | heavy-context | Moonshot / Kimi Code (managed:kimi-code) | ASUS | kimi CLI | PROVEN (this SJAHRIR session; OAuth file store) | Kimi Code subscription | unknown hard cap; K3 256k ctx | SJAHRIR |
| L4 | free-worker | Nous Portal free, solar-pro4:free | ASUS | hermes CLI (`-z` one-shot) | PROVEN 2026-08-21 (flaky: APIConnectionError self-heals on retry, ~70–100s latency) | Nous free tier | intermittent errors; slow | HERMES; GIBRAN per current decision |
| L5 | review-scarce | Anthropic Claude Pro, adityainofficial@gmail.com | Lenovo | Claude Code CLI | PROVEN 2026-08-18 (SSH transport completion); creds file present today | Claude Pro Lenovo — **LAPSES 2026-09-14, not renewed** | scarce; preserve | SOEKARNO (gated reviews only) |
| L6 | resting-openai | ChatGPT Plus, pusatberasmurah@gmail.com | Lenovo (+ install on ASUS) | codex-cli 0.149.0 | AUTH re-verified live 2026-08-28 (`codex login status` via SSH, read-only) | ChatGPT Plus | never e2e-dispatched; unknown practical throughput | CORLEONE (resting) |
| L7 | blocked-kimi-native | Moonshot paid | Lenovo | kimi-code-cli 0.38.0 | BLOCKED (membership rejected 2026-08-22) | none | needs paid membership | KIMI (dead end) |
| L8 | blocked-openrouter | OpenRouter free | ASUS (HTTP) | curl via dispatch-worker.js | BLOCKED (no OPENROUTER_API_KEY) | would be 50 calls/day free | text-only, no tools | KIMI_FREE |
| L9 | unused-google | Google free tier | ASUS | gemini CLI 0.56.0 | NEVER logged in | free tier (per owner: "gratisan") | requires owner OAuth login | none |
| L10 | lenovo-local | local Ollama | Lenovo | D:\Ollama\ollama.exe | daemon up; 0 models pulled | free/local | Lenovo 10GB RAM — small models only | none |
| L11 | local-embed | local Ollama | ASUS | nomic-embed-text | working (GBrain verified) | free/local | — | GBrain embeddings |

## Non-LLM operational services

| Service | Where | State |
|---|---|---|
| Paperclip server | ASUS :3100 live today (config drift vs docs saying 3101) | RUNNING; backups on; restore test passed |
| OPS-WATCHER | ASUS `ops-watcher/watcher.mjs` | ACTIVE (heartbeat events present) |
| GBrain | ASUS `knowledge/store/.gbrain` | ACTIVE, verified semantic search |
| Graphify | ASUS `graphify-out/{active,legacy}` | STATIC outputs, current as of 2026-08-28 |
| OpenClaw gateway | ASUS | FROZEN (rollback snapshot) |
| SSH transport ASUS→Lenovo | `lenovo-trading` alias | PROVEN today (hostname check + binary presence) |

## Quota pool isolation matrix

| Pool | $$/mo | Shared by | Isolation verified |
|---|---|---|---|
| Claude Pro ASUS | ~20 | AHMAD only now (SOEHARTO retired removed the double-spend) | yes (2026-08-28 evidence) |
| Ollama Cloud Pro | (in $60–70 ceiling) | HATTA + all :cloud models | yes |
| Kimi Code (SJAHRIR) | separate | SJAHRIR | asserted by mission; this session live |
| Nous free | 0 | HERMES + GIBRAN | n/a (free) |
| Claude Pro Lenovo | ~0 after 2026-09-14 | SOEKARNO | lapsing by decision |
| ChatGPT Plus | ~20 | CORLEONE (resting) | auth verified, spend = 0 while resting |

Fixed-subscription policy: no PAYG anywhere; USD 60–70/mo hard ceiling.
