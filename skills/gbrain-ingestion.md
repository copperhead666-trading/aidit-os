# gbrain-ingestion (GBRAIN-CURATOR core skill)

Ingests documents/pages into the GBrain store per the ingestion contract; knows the canonical
source rules and what is source of truth.

How this org actually runs it:
- Respect canonical-source precedence: operational truth lives in Paperclip (this workspace's
  local instance, .paperclip/); declarative identity in config/agent-registry.json; canonical
  roster in handoffs/sjahrir/CANONICAL-ROLE-MAP.json. Do not ingest a stale copy as if canonical.
- Apply the ingestion contract: structured, traceable, source-labeled entries. Never ingest a
  document whose provenance is unknown — mark it and ask.
- Ingestion is a write to the GBrain store; it is the GBRAIN-CURATOR's bounded write surface.
  Do not use it to mutate any other system (Paperclip, Telegram, the cockpit).
- If a source conflicts with a canonical store, surface the conflict; do not silently pick one.