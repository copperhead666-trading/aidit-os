# ASUS Adoption Shortlist

> **Correction by the integration owner, 2026-09-05.** The inventory this
> analysis was given (`LENOVO-SKILLS.txt`, 37 names) listed only
> `~/.claude/skills`. It missed the **110 skills the Lenovo already gets from
> plugins**, so seven of the ten entries below were never actually missing:
> `dispatching-parallel-agents`, `using-git-worktrees`, `systematic-debugging`,
> `test-driven-development`, `requesting-code-review`, `receiving-code-review`
> and `telegram` are all present here today. That was my staging error, not the
> lane's reasoning.
>
> Counting plugins, the ASUS holds **720 skills the Lenovo does not have**, and
> the genuine gap inside the shortlist is **three**: `ruflo`,
> `monitoring-observability`, `python-pro`.
>
> **Adopted so far: none.** The owner's rule is "only what is proven to have an
> impact", and none of the three has been proven yet. Each has a named trigger
> instead:
>
> - `python-pro` — adopt when the first venture directive actually edits Python
>   in `caveman-trading-os` and the lane's output shows it needed the idiom help.
> - `monitoring-observability` — adopt when D1/D2 work starts rendering
>   `lane-usage.jsonl` and the existing modules prove insufficient.
> - `ruflo` — the ruflo MCP server and its CLAUDE.md contract are already wired
>   here; adopt the skill only if a session shows the contract alone is not
>   enough.
>
> The archive keeps every one of the 720 retrievable, so nothing is lost by
> waiting for the trigger rather than paying the discovery tax now.

## 1. ADOPT - the short list

- `ruflo` - serves Aidit OS's actual coordination loop: Paperclip issues, lane routing, memory, hooks, and the CLAUDE.md requirement to route complex work through the smallest capable topology.
- `dispatching-parallel-agents` - serves the backlog handover's explicit "orchestrate this" instruction, especially the file-disjoint W2/W3/W4/W9/W5b parallel dispatch plan.
- `using-git-worktrees` - serves the one-writer-per-file rule and the existing `lane-worktree.mjs` workflow for isolated lane execution.
- `systematic-debugging` - serves the current defect class: stale graph stamps, missing sweep locks, self-SSH, Telegram callback failure modes, and other issues where the repo warns not to trust reports without reproduction.
- `test-driven-development` - serves the regression-suite culture in `ops-watcher/`, including W1, W2, W3, W4, W5, W8, and W9, where every fix needs a focused regression before code changes are trusted.
- `requesting-code-review` - serves the GIBRAN review lane and the standing rule that implementation reports are not enough; review is a separate gate before work is accepted.
- `receiving-code-review` - serves the repeated pattern where reviewer feedback must be checked against code and tests rather than accepted performatively.
- `telegram` - serves the owner escalation surface: Telegram cards, callback actions, DETAIL behavior, reply capture, and the rule that Telegram remains a bell while Cockpit holds the richer decision surface.
- `monitoring-observability` - serves D1/D2 and the PM2-supervised runtime: lane usage, wasted run time, heartbeat evidence, watcher health, and cost per landed change.
- `python-pro` - serves the active `caveman-trading-os` venture, where Aidit OS must inspect Python symbols, avoid docstring anchors, and keep Phase 1 trading-safety boundaries intact.

## 2. REJECT - the categories, not the names

- Marketing, sales, growth, SEO, CRO, brand, deck, social, and agency skills do not serve Aidit OS's operational backlog, escalation path, lane dispatch, tests, graph, or ventures.
- UI-generation and design-system families are mostly irrelevant here because the immediate Cockpit work is queue/action behavior, not a broad visual rebuild, and the Lenovo already has design-oriented skills when needed.
- Cloud, Kubernetes, Terraform, AWS, Azure, GCP, Cloudflare, deployment, and release families are not justified because the measured runtime is local Lenovo PM2, Paperclip, Telegram, worktrees, and gitignored venture repos, not a cloud migration.
- Language/framework specialists unrelated to this repo's Node `.mjs` ops code or the Python trading venture add discovery tax without named work to serve.
- Product, strategy, executive-advisor, HR, finance, legal, medical, research, and meeting-processing skills do not map to the current Aidit OS implementation sequence.
- Database, data-science, ML, embeddings, RAG, and vector-search skills are rejected unless a future task names them; today `graphify` and gbrain already cover the knowledge-graph need.
- Browser automation and Playwright skills are rejected for now because the named backlog is mostly Node services and Telegram/Paperclip contracts; adopt later only if Cockpit browser E2E work becomes the bottleneck.
- Duplicate orchestration, swarm, agent, memory, and review families are rejected in favor of the few selected skills above; copying families wholesale would recreate the ASUS bloat.
- Skills that shadow Lenovo skills, such as generic audit/build/review/refactor/spec/design variants, are rejected because the Lenovo already has active versions in use.
- Credential, secrets, payments, brokerage, and account-management skills are rejected unless a future owner-authorized task explicitly needs them; this packet does not authorize touching credentials, real money, subscriptions, or external accounts.

## 3. CONFLICTS

- `audit` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `build` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `cavecrew` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `caveman` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `caveman-commit` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `caveman-compress` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `caveman-help` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `caveman-review` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `caveman-stats` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `code-review` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `deploy-check` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `graphify` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `impeccable` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `refactor` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `review` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `session-start` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `spec` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.
- `ui-ux-pro-max` - exists on both machines; copying the ASUS version would overwrite the Lenovo's version, and the Lenovo's is the one in use today. Do not copy unless the ASUS version is inspected and proven better.

## 4. COST

The shortlist proposes adding 10 skills. At roughly 100 discovery tokens per skill, that is about 1,000 extra tokens per session.

That is acceptable only because each entry maps to named Aidit OS work. It is also the ceiling: adding the rest of the plausible orchestration, review, testing, monitoring, security, Node, Python, graph, and browser families would quickly turn into dozens of skills and thousands of permanent discovery tokens per session. Do not expand this list without a specific backlog item that the Lenovo cannot already handle.
