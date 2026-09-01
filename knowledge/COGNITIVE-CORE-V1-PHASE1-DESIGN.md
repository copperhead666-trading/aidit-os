# Cognitive Core V1 - Phase 1 Design

Status: investigation and design only. No live dispatch wiring was changed.

Date: 2026-08-29
Actor: CORLEONE, dispatched by AHMAD
Scope: first two parts of the FOS-14 macro mission only: inventory real GBrain state and define context-graph semantics. The later "wire retrieval into Ahmad dispatch" step is intentionally not implemented here.

## Executive Summary

The local `gbrain` install is real and usable, but the current store is not yet reliable enough to feed AHMAD's live dispatch path without a wrapper and an ingestion contract.

Ground truth from live commands:

- `gbrain --help` reports `gbrain 0.47.3.0 -- personal knowledge brain`.
- The CLI repeatedly reports an upgrade is available: `0.47.3.0 -> 0.47.4.0`.
- The workspace store is PGLite at `D:\AI\Active FounderOS-Aidit\knowledge\store\.gbrain\brain.pglite`, selected by `GBRAIN_HOME=D:\AI\Active FounderOS-Aidit\knowledge\store`.
- `gbrain stats` reports 18 pages, 34 chunks, 34 embedded chunks, 0 links, 6 tags, 0 timeline entries.
- `gbrain list` shows 16 `note` pages and 2 `concept` pages. This contradicts the older "only 2 notes indexed" understanding. The source tree still has only two visible markdown note files under `knowledge/store/notes/`, but the DB already contains additional captured/imported pages.
- `gbrain search` and `gbrain query` return ranked snippets with numeric scores and page slugs. They do not return a rich provenance/conflict/staleness object by default.
- `gbrain graph task-packet-standard --depth 2` returns the node but no links. GBrain's internal link graph is currently empty.
- `gbrain doctor --json --fast` exits unhealthy with score 65 because skill resolver/reflex pieces are not fully installed/running, even though search/query over the store works.
- The indexed `agent-registry` page is stale: `gbrain get agent-registry` still says `last_updated_at: 2026-08-28`, while `config/agent-registry.json` on disk says `last_updated_at: 2026-08-29`.

Design implication: use GBrain as the semantic retrieval engine, Graphify as the structural graph lens, and Paperclip/config files as canonical truth. Do not let raw GBrain results become authority by themselves.

## Commands Run

All live GBrain commands were run with:

```bat
set GBRAIN_HOME=D:\AI\Active FounderOS-Aidit\knowledge\store
```

Commands used:

- `gbrain --help`
- `gbrain engine status --json`
- `gbrain doctor --json --fast`
- `gbrain stats`
- `gbrain list --limit 20`
- `gbrain list --type concept --limit 20`
- `gbrain list --type note --limit 30`
- `gbrain sources list`
- `gbrain search cognitive core ahmad dispatch`
- `gbrain query "What is the current gbrain setup for FounderOS-Aidit?" --no-expand`
- `gbrain query "What should Ahmad know before dispatching Hatta or Sjahrir?" --no-expand`
- `gbrain search "Paperclip route bug watcher issue_count"`
- `gbrain query "Paperclip route bug watcher issue_count"`
- `gbrain get founderos-gbrain-local-setup`
- `gbrain get task-packet-standard`
- `gbrain get agent-registry`
- `gbrain get canonical-decision-ledger`
- `gbrain tags founderos-gbrain-local-setup`
- `gbrain link-sources`
- `gbrain graph task-packet-standard --depth 2`
- `gbrain compile-context --target codex --budget 1200 --check`

Other read-only inspection:

- `graphify-out/active/GRAPH_REPORT.md`
- `graphify-out/legacy/GRAPH_REPORT.md`
- `graphify-out/active/graph.json`
- `graphify-out/legacy/graph.json`
- `ops-watcher/ahmad-dispatch.mjs`
- `ops-watcher/watcher.mjs`
- `ops-watcher/paperclip-write-client.mjs`
- `config/agent-registry.json`
- `handoffs/ahmad/AHMAD-SESSION-HANDOFF-2026-08-28.md`
- `handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json`
- `skills/*.md`
- A read-only live Paperclip issue metadata query through `listIssues`, returning 48 issues.

No regression suites were run.

## GBrain Schema And Capability Inventory

### Real CLI surface

`gbrain --help` exposes these major command groups:

- Setup and health: `init`, `engine status`, `db-repair`, `migrate`, `upgrade`, `check-update`, `doctor`, `integrations`.
- Pages: `get`, `put`, `delete`, `list`.
- Search: `search`, `query`, `ask`.
- Import/export: `import`, `sync`, `export`.
- Files: `files list`, `files upload`, `files upload-raw`, `files signed-url`, `files sync`, `files verify`.
- Embeddings: `embed`.
- Links and graph traversal: `link`, `unlink`, `link-sources`, `backlinks`, `graph`, `graph-query`.
- Tags and timeline: `tags`, `tag`, `untag`, `timeline`, `timeline-add`.
- Extraction/tools: `extract`, `publish`, `check-backlinks`, `lint`, `backfill`, `orphans`, `salience`, `anomalies`, `transcripts`, `dream`, `compile-context`, `check-resolvable`, `report`.
- Brain features: `capture`, `brainstorm`, `lsd`, `think`.
- Sources: `sources list/add/remove/archive/restore/...`, `sync --all`, `sync --source`.
- Code indexing: `code-def`, `code-refs`, `code-callers`, `code-callees`, `query --lang`, `query --symbol-kind`, `reconcile-links`, `reindex-code`, `reindex-search-vector`, `sync --strategy code`.
- Jobs/admin/MCP: `jobs ...`, `stats`, `health`, `history`, `revert`, `features`, `autopilot`, `config`, `protocol`, `storage status`, `serve`, `connect`, `auth`, `watch`, `call`, `version`, `--tools-json`.

This means GBrain can support pages, tags, typed links, source registration, code indexing, context compilation, and MCP serving in principle. The current store only uses a small subset of that surface.

### Engine and store

`gbrain engine status --json` reports:

- `effective_engine: pglite`
- `config_file_engine: pglite`
- `db_url_source: config-file-path`
- `database_path: D:\AI\Active FounderOS-Aidit\knowledge\store\.gbrain\brain.pglite`
- `pglite_lock.held: false`
- `thin_client: false`

This matches `knowledge/GBRAIN.md`: local PGLite, no Docker, no external server, local Ollama `nomic-embed-text` embeddings, no API keys/cost.

### Health

`gbrain doctor --json --fast` returned exit code 1 with:

- `status: unhealthy`
- `health_score: 65`
- `brain_checks_score: 100`
- `resolver_health: fail`, because no `skills/RESOLVER.md` or `AGENTS.md` routing table with triggers exists for GBrain's skill resolver.
- `retrieval_reflex_health: warn`, because no `gbrain serve` IPC socket is present and the retrieval-reflex policy skill is not installed.
- `skill_currency: warn`, because many built-in GBrain skillpack skills are available but not synced.
- `npm_squat: ok`, confirming `gbrain` on PATH is the real binary at `/c/Users/ASUS/.bun/bin/gbrain`.
- `connection: warn`, because fast mode skipped deeper DB checks.

This is not a failure of semantic search, but it is a warning against pretending the full reflex/skill integration is already active.

### Current page inventory

`gbrain stats`:

```text
Pages:     18
Chunks:    34
Embedded:  34
Links:     0
Tags:      6
Timeline:  0

By type:
  note: 16
  concept: 2
```

`gbrain list --type concept`:

- `agent-registry`
- `canonical-decision-ledger`

`gbrain list --type note`:

- `migration-status`
- `legacy-migration-map`
- `ahmad-delta-phase1`
- `paperclip-migration-map`
- `shared-tools`
- `runtime-and-workflow`
- `permission-model`
- `aidit-principles`
- `orchestration-readiness`
- `bennett-org-proposal`
- `task-packet-standard`
- `gbrain-status`
- `hatta-harness`
- `hatta-role`
- `aidit-project-overview`
- `founderos-gbrain-local-setup`

`gbrain sources list`:

```text
SOURCES
-------
  default               federated         18 pages  never synced
```

The "never synced" source status matters: the current pages appear capture/import based, not a clean source-bound incremental sync from the workspace.

### Existing visible notes

The two visible markdown notes under `knowledge/store/notes/` are plain markdown with YAML frontmatter:

```yaml
---
title: Aidit Project Overview
type: note
tags: [aidit, overview]
---
```

and:

```yaml
---
title: FounderOS-Aidit Local G-Brain
type: note
tags: [gbrain, setup, local, ollama]
---
```

`gbrain get founderos-gbrain-local-setup` returns the same page as markdown, but normalizes tags into a YAML list. `gbrain tags founderos-gbrain-local-setup` returns:

```text
gbrain, local, ollama, setup
```

`gbrain get task-packet-standard` shows a captured page with:

```yaml
---
type: note
title: Task Packet Standard
captured_at: '2026-08-28T06:06:30.540Z'
captured_via: capture-cli
---
```

So a stored note is effectively markdown content plus frontmatter. Some stored pages have useful capture metadata; some do not expose source file path through `search/query` output.

### Real search/query behavior

Observed output shape:

```text
[0.9189] founderos-gbrain-local-setup -- # FounderOS-Aidit Local G-Brain

This is the local, zero-cost knowledge brain for the **Active Found
```

So the default CLI result shape is:

- numeric score,
- slug,
- short content snippet.

It does not include source path, source line, indexed timestamp, source hash, canonical priority, conflict status, or freshness status.

Query examples:

- `gbrain query "What is the current gbrain setup for FounderOS-Aidit?" --no-expand` ranked `founderos-gbrain-local-setup`, `aidit-project-overview`, and `gbrain-status` at the top.
- `gbrain query "What should Ahmad know before dispatching Hatta or Sjahrir?" --no-expand` ranked `hatta-role`, `hatta-harness`, `orchestration-readiness`, `permission-model`, and `bennett-org-proposal`.
- `gbrain search "Paperclip route bug watcher issue_count"` and `gbrain query "Paperclip route bug watcher issue_count"` returned the same top five in this run: `paperclip-migration-map`, `runtime-and-workflow`, `shared-tools`, `ahmad-delta-phase1`, and `migration-status`.

The results are useful but not sufficient for safe dispatch context by themselves.

### Links and graph

`gbrain link-sources` returns `[]`.

`gbrain graph task-packet-standard --depth 2` returns:

```json
[
  {
    "slug": "task-packet-standard",
    "title": "Task Packet Standard",
    "type": "note",
    "depth": 0,
    "links": []
  }
]
```

So GBrain's own graph layer is currently unused. The future Cognitive Core can either:

- import Graphify-derived edges into GBrain via `gbrain link`, using `--link-type` and `--link-source graphify-active`, or
- keep Graphify as a separate structural sidecar and have the retrieval wrapper merge semantic hits with graph neighbors.

For Phase 2, the second approach is safer because it avoids mutating the GBrain graph before the semantics are settled.

### Deterministic context compiler

`gbrain compile-context --target codex --budget 1200 --check` returned:

```text
compile-context: STALE - a recompile would change D:\AI\Active FounderOS-Aidit\AGENTS.md
```

This was not run without `--check`. It indicates GBrain has a deterministic context compilation feature, but this workspace has not adopted it into the active AHMAD dispatch path.

## Graphify Inventory

Graphify is not a semantic retriever. It is a structural graph extractor over files/code/docs.

Active graph:

- Report: `graphify-out/active/GRAPH_REPORT.md`
- JSON: `graphify-out/active/graph.json`
- Corpus: 18 files, about 131,198 words.
- Graph: 265 nodes, 808 edges, 20 communities.
- Extraction: 100% extracted, 0% inferred, 0% ambiguous.
- JSON shape: `directed`, `multigraph`, `graph`, `nodes`, `links`, `hyperedges`.
- Node fields include `label`, `file_type`, `source_file`, `source_location`, `_origin`, `id`, `community`, `community_name`, `norm_label`.
- Link fields include `relation`, `context`, `confidence`, `source_file`, `source_location`, `weight`, `_origin`, `source`, `target`, `confidence_score`.

Active graph hubs include:

- SQL tables from Paperclip backup/restore files such as `"public"."companies"`, `"public"."agents"`, `"public"."issues"`, `"public"."tool_connections"`.
- Runtime/code files such as `hatta/harness.mjs`.
- Current handoff docs such as `BENNETT-FAITHFUL ORG PROPOSAL`, `ORCHESTRATION READINESS`, `PAPERCLIP MIGRATION MAP`, `DELTA CHECKPOINT`, `G-Brain Status`.

Legacy graph:

- Report: `graphify-out/legacy/GRAPH_REPORT.md`
- JSON: `graphify-out/legacy/graph.json`
- Corpus: 764 files, about 474,568 words.
- Graph: 3975 nodes, 7895 edges, 328 communities.
- Built from commit `0f57c21d`.
- Current workspace `git rev-parse HEAD` failed because this checkout has no valid HEAD yet, so the legacy graph cannot be treated as current-code evidence without direct file verification.

Composition view:

- GBrain answers "which prior notes are semantically relevant to this dispatch?"
- Graphify answers "which files/symbols/tables/docs are structurally adjacent to this topic?"
- Paperclip/config answer "what is current operational truth?"
- The Cognitive Core should be a wrapper that reconciles these, not a replacement for any one of them.

## What Should Be Indexed

### 1. Current control truth

Candidate files:

- `config/agent-registry.json`
- `config/decision-ledger.json`
- `config/paperclip-endpoint.json`
- `handoffs/sjahrir/CANONICAL-ROLE-MAP.json`
- `handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json`
- `handoffs/ahmad/AHMAD-SESSION-HANDOFF-2026-08-28.md`
- `handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md`, with high-stakes caution.

Current form:

- JSON and markdown are ingestible as text.
- Raw JSON is useful, but too dense for retrieval unless chunked/summarized by logical unit.

Recommendation:

- Index first, but through normalized per-topic notes rather than only raw whole-file pages.
- For `agent-registry.json`, split by top-level section and major agent/phase.
- For `decision-ledger.json`, split by decision record, preserving `id`, `status`, `effective_from`, `effective_to`, `supersedes`, `superseded_by`, `confidence`, and provenance.
- For `MASTER-CANONICAL-BACKLOG.json`, split by item id.

Value: highest.
Noise: medium if raw, low if transformed.
Reason: this is what enforces "current truth outranks history."

### 2. Skills directory

Current inventory:

- 27 files in `skills/`.
- 24 markdown skill files.
- 3 JavaScript helper/test files: `resolve-skills.mjs`, `preview-skills.mjs`, `resolve-skills.regression.test.mjs`.

Current form:

- The 24 skill markdown files are already compact, readable, and mostly one skill per file.
- They can be ingested as-is.
- The JS files are better left to Graphify/code search unless the task is specifically about skill resolver implementation.

Value: high.
Noise: low.
Recommendation:

- Index all 24 markdown skill files early.
- Add or derive frontmatter: `type: skill`, `role`, `skill_name`, `source_path`, `last_indexed_at`.
- Do not dump all skills into every task packet. Retrieval should return only role core skills plus task-matched skills.

### 3. Handoffs directory

Current inventory:

- 36 files in `handoffs/`.
- Mix of markdown, JSON, JavaScript helper, SQL dump, and gzipped SQL.
- Largest files include `config/agent-registry.json`, historical backlog handoff, Paperclip roster snapshots, master backlog JSON, decision ledger, recovered specs, and skill bootstrap docs.

Current form:

- Markdown is ingestible as-is.
- JSON should be split by logical object.
- SQL dumps and gzipped SQL should not be ingested raw for dispatch retrieval. They should be summarized as schema/entity maps or left to Graphify.
- Historical handoffs must be marked historical/superseded when appropriate.

Value: high.
Noise: high if raw.
Recommendation:

- Index current/curated handoffs first:
  - AHMAD latest handoff/current-truth blocks.
  - SJAHRIR canonical backlog and role map.
  - Hermes migration status/maps only as historical evidence.
- Add explicit `source_status`: `current`, `current-but-point-in-time`, `historical`, `superseded`, `proposal`.
- Never let an older handoff override a newer config/Paperclip read.

### 4. Paperclip issue history

Live read-only issue metadata query:

- Canonical Paperclip port: 3110.
- Total issues: 48.
- Status counts: 14 `done`, 1 `in_review`, 6 `todo`, 1 `in_progress`, 15 `backlog`, 11 `cancelled`.
- Common labels include `DONE_VERIFIED` (10), `MIGRATED_PENDING_REVALIDATION` (8), `DIRECTIVE` (2), `OWNER_REQUIRED` (2), `ESCALATED_TO_AHMAD` (1).

Current form:

- Not already in a GBrain-ingestible export.
- `ops-watcher/paperclip-write-client.mjs` has `listIssues`, `postComment`, `patchIssue`, label helpers, and comments endpoints. It can support a future read-only exporter, but no current Paperclip-to-GBrain sync/export mechanism exists.
- `ops-watcher/watcher.mjs` reads issue state for deterministic monitoring and checks only file existence/mtime for GBrain/Graphify. It does not index Paperclip into GBrain.

Value: very high.
Noise: very high if all comments/raw bodies are ingested.
Recommendation:

- Build a future read-only exporter that emits normalized markdown notes under a dedicated staging directory before GBrain import.
- Start with:
  - active `DIRECTIVE`, `OWNER_REQUIRED`, `REVIEW_REQUIRED`, `NEEDS_REWORK`, `in_progress`, and `in_review` issues,
  - `DONE_VERIFIED` issues with final verdict and acceptance summary,
  - incidents with duplicate dispatch/review or owner-path reliability lessons.
- Exclude or downrank throwaway selftests, cancelled probes, and Paperclip demo seed tasks unless they are cited by a current incident.
- Include comments only if they are verdicts, dispatch markers, owner decisions, or final closeout evidence.

### 5. Graphify output

Current form:

- `GRAPH_REPORT.md` is ingestible as a high-level structural summary.
- `graph.json` should not be ingested wholesale as prose. It is better used programmatically by a retrieval wrapper.

Value: medium-high.
Noise: high if raw JSON.
Recommendation:

- Index the active `GRAPH_REPORT.md` summary.
- Keep `graph.json` as a structural sidecar.
- Future wrapper can use Graphify to expand from a retrieved file to adjacent symbols/tables/docs.
- Do not treat legacy graph output as current truth unless the referenced source file still exists and is re-read.

### 6. Ops-watcher code and logs

Current form:

- Code is better served by Graphify and direct file reads.
- `ops-watcher/events.jsonl` is append-only and currently noisy heartbeat data.

Value: medium for code, high for incident summaries.
Noise: high for raw logs.
Recommendation:

- Do not bulk-index `ops-watcher/*.mjs` into GBrain yet.
- Do index curated operational runbooks and incident summaries, especially those explaining why a guard exists.
- Keep raw event logs out of GBrain except rolling summaries.

## Context-Graph Semantics

The Cognitive Core should produce a compact evidence bundle, not a giant context dump.

### Core entities

Use these conceptual objects even if the first implementation is just markdown/JSON:

```json
{
  "Source": {
    "source_id": "config/agent-registry.json",
    "source_system": "filesystem|paperclip|gbrain|graphify",
    "source_path": "config/agent-registry.json",
    "source_kind": "canonical_config|operational_issue|handoff|skill|graph_report|historical",
    "canonical_rank": 90,
    "last_observed_at": "2026-08-29T00:00:00+07:00",
    "content_hash": "sha256..."
  },
  "EvidenceUnit": {
    "id": "agent-registry:p0_stabilization_soak_2026-08-29",
    "claim": "short factual claim",
    "source_id": "config/agent-registry.json",
    "pointer": "config/agent-registry.json:<line-or-json-pointer>",
    "observed_at": "2026-08-29T00:00:00+07:00",
    "indexed_at": "2026-08-29T00:00:00+07:00",
    "effective_from": "2026-08-29",
    "effective_to": null,
    "confidence": "HIGH",
    "freshness": "current|stale|unknown",
    "conflict_status": "none|conflicts_with_current|superseded_by"
  },
  "Edge": {
    "from": "HATTA",
    "to": "hatta/harness.mjs",
    "relation": "owns|implements|reviews|mentions|calls|depends_on|supersedes|conflicts_with",
    "source": "graphify-active|manual|gbrain-link|paperclip",
    "confidence": "EXTRACTED|HIGH|MEDIUM|LOW"
  }
}
```

### Source precedence

The retrieval layer must rank authority separately from semantic similarity.

Recommended precedence:

1. Live Paperclip current state for active operational issues, labels, comments, review state, and owner queue.
2. Current control files in this workspace, especially `config/agent-registry.json`, `config/decision-ledger.json`, `config/paperclip-endpoint.json`, and current role/backlog JSON.
3. Current AHMAD handoff and current SJAHRIR canonical artifacts.
4. GBrain indexed pages whose source hash/timestamp matches the current source.
5. Graphify active structural graph, as navigation/evidence pointer support.
6. Historical handoffs and migration reports.
7. Graphify legacy graph and legacy app references, only as historical pointers.

Rule: semantic relevance can put a historical hit on the candidate list, but it cannot outrank current truth unless the current source is absent and the bundle clearly says the evidence is historical.

### Query trigger

Future retrieval should trigger only at high-leverage points:

- Before AHMAD builds a task packet for a `DIRECTIVE` issue assigned to AHMAD.
- Before AHMAD dispatches a worker packet to HATTA, SJAHRIR, CORLEONE, GIBRAN, or a thin specialist.
- Before owner-facing status answers that depend on prior decisions or current operational state.
- Before high-risk domain work such as trading, legal, health, finance, credentials, or destructive cleanup.

Do not trigger retrieval on every heartbeat sweep. `ops-watcher/watcher.mjs` should remain deterministic and cheap.

### Query input

A retrieval query should be structured, not just free text:

```json
{
  "trigger": "ahmad-dispatch-prep",
  "issue": {
    "id": "paperclip-uuid",
    "identifier": "KOL-xx",
    "title": "issue title",
    "description_excerpt": "bounded excerpt",
    "status": "todo",
    "labels": ["DIRECTIVE"]
  },
  "target_role": "AHMAD|HATTA|SJAHRIR|CORLEONE|GIBRAN",
  "task_kind": "implementation|research|review|stabilization|owner-decision|status",
  "mentioned_paths": ["ops-watcher/ahmad-dispatch.mjs"],
  "hard_constraints": ["do not mutate dispatch path", "design only"],
  "budget": {
    "max_evidence_units": 7,
    "max_context_chars": 6000
  }
}
```

The query text sent to GBrain should be derived from title, description, labels, role, paths, and task kind. If paths are present, direct file reads and Graphify adjacency should be considered alongside semantic search.

### Retrieval process

Recommended future flow:

1. Build a query object from the Paperclip issue or worker packet draft.
2. Run `gbrain query` and `gbrain search` with explicit `GBRAIN_HOME`.
3. Normalize hits into candidate evidence with slug, score, snippet, and page body from `gbrain get` only for top candidates.
4. Expand structurally through Graphify active graph when a hit references a file/symbol/table.
5. Re-read canonical sources directly when a hit points to config/Paperclip/handoff current truth.
6. Check freshness:
   - compare indexed/captured date with source file date/hash where available,
   - compare GBrain page content against current source for known canonical files,
   - mark stale if mismatch is found.
7. Check conflicts:
   - same entity with different status/value,
   - historical artifact contradicting current control file,
   - GBrain page older than current file,
   - legacy graph or historical handoff asserting an active status superseded by current registry.
8. Select a bounded bundle with only useful evidence and explicit exclusions.

### Return shape

The future hook should return a compact `ContextBundle`:

```json
{
  "context_bundle_version": "0.1",
  "generated_at": "2026-08-29T00:00:00+07:00",
  "query_summary": "pre-dispatch context for KOL-xx",
  "status": "ok|empty|degraded|conflicted",
  "evidence": [
    {
      "title": "Task Packet Standard",
      "source": "gbrain:task-packet-standard",
      "canonical_pointer": "gbrain get task-packet-standard",
      "why_relevant": "Defines compact dispatch packet expectations.",
      "freshness": "unknown",
      "confidence": "MEDIUM",
      "excerpt": "bounded excerpt only"
    }
  ],
  "canonical_pointers": [
    "config/agent-registry.json:p0_stabilization_soak_2026-08-29",
    "ops-watcher/ahmad-dispatch.mjs:buildTaskPacket"
  ],
  "stale_warnings": [
    {
      "source": "gbrain:agent-registry",
      "warning": "Indexed page says last_updated_at 2026-08-28, source file says 2026-08-29."
    }
  ],
  "conflicts": [
    {
      "topic": "FOS-14 index scope",
      "older_evidence": "MASTER-CANONICAL-BACKLOG says only smoke-test notes exist.",
      "current_evidence": "gbrain stats/list show 18 pages."
    }
  ],
  "excluded_hits": [
    {
      "source": "graphify-out/legacy",
      "reason": "legacy graph is historical and current HEAD cannot be compared"
    }
  ]
}
```

Rules:

- Return pointers and brief excerpts, not full documents.
- Include `empty` when nothing relevant is found.
- Include `degraded` when GBrain/Graphify/Paperclip is unavailable.
- Include `conflicted` when useful hits exist but disagree.
- Never silently resolve conflicts.
- Never allow retrieved context to override explicit user/task constraints.

### Future integration point

The natural future hook is in `ops-watcher/ahmad-dispatch.mjs`, but no code should be changed until AHMAD reviews this design.

Current flow:

- `runAhmadDispatchOnce()` acquires the sweep lock.
- It lists Paperclip issues.
- It filters for `DIRECTIVE`, assigned to `AHMAD_AGENT_ID`, non-terminal, not `OWNER_REQUIRED`.
- It checks comments for an existing `AHMAD DISPATCH` marker.
- It posts the marker.
- It calls `buildTaskPacket(it)`.
- It spawns headless AHMAD with the packet.

Future hook placement:

- Add a read-only retrieval step after the duplicate-marker check and before `buildTaskPacket`.
- Prefer `buildTaskPacket(it, contextBundle)` rather than having `buildTaskPacket` call external commands itself.
- Retrieval should be dependency-injected for tests, just like HTTP/spawn/lock dependencies already are.
- Retrieval failure should not crash the sweep. It should produce a `CONTEXT_RETRIEVAL: unavailable/degraded` block unless the task is explicitly high-risk and the policy says fail-closed.
- The hook must be time-bounded. A stuck retrieval call must not block the whole heartbeat lane indefinitely.
- The marker/spawn commit semantics need AHMAD review: retrieval before marker avoids marking an issue as dispatched when context prep fails; retrieval after marker preserves current "marker before spawn" duplicate-safety behavior but can create a marked issue if retrieval hangs. My recommendation is retrieval before marker, with a bounded timeout and explicit degraded packet fallback.

Possible future module boundary:

```text
ops-watcher/ahmad-context-retrieval.mjs
  retrieveDispatchContext({ issue, targetRole, taskKind, mentionedPaths, now })
  -> ContextBundle
```

Hard constraints for that module:

- read-only toward Paperclip, GBrain, Graphify, and filesystem;
- explicit `GBRAIN_HOME`;
- no calls to `gbrain put`, `import`, `sync`, `embed`, `link`, or other mutations;
- no writes to `config/agent-registry.json`;
- no live dispatch/spawn behavior inside retrieval;
- testable with injected command runner and fixture outputs.

## Measurement

The P2 goal includes measurable reduction in AHMAD re-reading/context use. Suggested metrics:

- `retrieval_candidates_total`
- `selected_evidence_total`
- `context_chars_injected`
- `stale_warning_total`
- `conflict_total`
- `excluded_hit_total`
- `canonical_reread_total`
- `dispatch_packet_chars_before_retrieval`
- `dispatch_packet_chars_after_retrieval`
- `manual_file_reads_avoided_estimate`

Measure success by:

- fewer repeated full-file reads by AHMAD before routine dispatches,
- task packets carrying smaller pointer-rich context,
- fewer stale-context incidents,
- zero cases where historical GBrain evidence silently overrides current Paperclip/config truth.

## Gaps And Risks

- GBrain search/query output does not currently expose enough provenance for safe orchestration.
- The GBrain store already contains stale `agent-registry` content relative to the current file.
- GBrain's own link graph is empty.
- GBrain sources show `default federated 18 pages never synced`, so there is no clean incremental source-of-truth sync yet.
- GBrain doctor is unhealthy for resolver/reflex integration.
- There is no existing Paperclip-to-GBrain issue export/sync mechanism.
- Graphify legacy is large and useful, but historical. Current checkout has no valid Git HEAD, so its `built_at_commit` cannot be compared to a current commit.
- Raw ingestion of handoffs, issue comments, SQL dumps, or event logs would create noise and stale-authority risk.
- High-stakes recovered domains (health/legal/trading/finance) require stricter provenance and owner-gated activation.

## Recommended Next Steps

1. Re-ingest or refresh current canonical control truth first, especially `config/agent-registry.json`, because the indexed page is already stale.
2. Index the 24 markdown skill files as `type: skill` with source path metadata.
3. Create normalized per-record GBrain notes for decision ledger and backlog items.
4. Create a read-only Paperclip issue exporter to markdown, but ingest only curated issue summaries at first.
5. Keep Graphify as a structural sidecar in Phase 2; do not import all edges into GBrain until link semantics are reviewed.
6. Prototype the future retrieval wrapper outside `ahmad-dispatch.mjs` first, with fixture outputs and no live spawning.
7. Only after AHMAD review, wire a bounded read-only retrieval hook into dispatch packet construction.

## Non-Actions In This Phase

- Did not modify `ops-watcher/*.mjs`.
- Did not modify `config/agent-registry.json`.
- Did not run regression suites.
- Did not run GBrain write commands such as `put`, `import`, `sync`, `embed`, or `link`.
- Did not alter Paperclip state.
- Did not wire retrieval into AHMAD's live dispatch path.
