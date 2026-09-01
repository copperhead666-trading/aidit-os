# research (SJAHRIR core skill)

Gathers context from canonical sources, web, and prior session history; distinguishes
verified vs stale vs unknown; does not infer from adjacent facts.

How this org actually runs it:
- Canonical sources in THIS workspace: config/agent-registry.json, handoffs/sjahrir/*.json/.md,
  ops-watcher/*.mjs (real implemented behavior), .paperclip/ runtime state. Read-only reference
  access to D:\AI\Agentic and the legacy app is for migration lookups only — never writes there.
- Mark every claim's provenance: VERIFIED (re-read this session), STALE (prior session, not
  re-checked), UNKNOWN (no source found). Do not promote "adjacent fact" to "verified".
- If filesystem access is unavailable (as in SJAHRIR's design-session call), say so explicitly
  and flag assumptions for the implementer to check — do not assert unverified filesystem facts.
- SJAHRIR does no production writes outside handoffs/. Output is research/synthesis only.