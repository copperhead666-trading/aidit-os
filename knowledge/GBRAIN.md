# G-Brain Status

**Superseded 2026-08-28** — see history below. Current state: a real, official
`garrytan/gbrain` install IS running for this workspace, with real local
Ollama embeddings, verified end to end.

## Current state (2026-08-28)

- CLI: `gbrain` 0.47.3.0, installed via `bun install -g github:garrytan/gbrain`
  (the real GitHub project — NOT the unrelated npm package of the same name;
  official guidance is explicitly not to `npm install -g gbrain`).
- Embedding: `ollama:nomic-embed-text` (768 dimensions), pulled locally via
  `ollama pull nomic-embed-text`. Fully local, no API key, no cost.
- Store: `D:\AI\Active FounderOS-Aidit\knowledge\store\.gbrain\brain.pglite`
  (PGLite — embedded Postgres via WASM, no Docker), scoped to this project via
  a session-only `GBRAIN_HOME` env var (not persisted globally, so it doesn't
  redirect other gbrain usage on this machine).
- Reranker: disabled — no `VOYAGE_API_KEY`. **ZeroEntropy was never
  configured and is not used.** `gbrain doctor`'s `ze_embedding_health` check
  explicitly confirms the configured embedding model is not ZeroEntropy.
- Verified end to end, not just "doctor passed": two real markdown notes were
  imported, embedded, and both `gbrain search` and `gbrain query` correctly
  ranked the semantically relevant note first. Real vector/semantic
  retrieval works today over this store.

## What changed from the original assessment

The paragraphs below this line are the **original, now-outdated** assessment
written before installation, kept for provenance rather than deleted:

> No real `gbrain` CLI binary exists on this machine or as an installed
> npm/pip package. The legacy app's `lib/connectors/gbrain.ts` expects an
> external `gbrain` binary through `GBRAIN_BIN`, but that binary was never
> actually built or shipped — the connector is a stub/interface only. Per
> that file's own comments, the intended production embedding path is
> ZeroEntropy + Supabase, and that credential was not present. Until it
> existed, retrieval was grep/keyword-only.

That was accurate at the time (before `garrytan/gbrain` was installed), but a
graphify pass over this knowledge store on 2026-08-28 flagged it as
contradicting the newer `knowledge/store/notes/*.md` install-verification
notes — correctly caught documentation drift, not a real system
inconsistency. This file is now the up-to-date source; the legacy app's
`gbrain.ts` stub and its ZeroEntropy/Supabase aspiration remain historical
reference only, unrelated to the real local install described above.

Do not create fake API keys, tokens, or credentials for G-Brain, ZeroEntropy,
Supabase, or any related service — none are needed for the current, real,
local-Ollama-embedding setup.
