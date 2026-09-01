---
title: FounderOS-Aidit Local G-Brain
type: note
tags: [gbrain, setup, local, ollama]
---

# FounderOS-Aidit Local G-Brain

This is the local, zero-cost knowledge brain for the **Active FounderOS-Aidit** project.

- Engine: PGLite (embedded Postgres via WASM), no Docker, no external server.
- Embeddings: Ollama, model `nomic-embed-text`, 768 dimensions, fully local — no paid API key.
- Reranking: disabled (no Voyage/ZeroEntropy key configured; ZeroEntropy is explicitly out of scope for this project).
- Store location: D:\AI\Active FounderOS-Aidit\knowledge\store\.gbrain\brain.pglite
- Scope: set via the GBRAIN_HOME environment variable pointing at this folder, so it does not touch the user's separate personal gbrain brain at ~/.gbrain.
