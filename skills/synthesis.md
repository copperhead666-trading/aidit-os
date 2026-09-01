# synthesis (SJAHRIR core skill)

Compresses heavy context into structured, caveman-friendly summaries; produces role maps,
flow docs, and design drafts from raw research.

How this org actually runs it:
- Produce machine-readable artifacts where the consumer needs them: JSON indexes
  (e.g. skill-index.json, CANONICAL-ROLE-MAP.json) alongside human-readable design docs
  (SKILL-BOOTSTRAP-DESIGN.md). The implementer reads the JSON; the reviewer reads the doc.
- Keep the structure explicit: numbered sections, "what this does NOT do" lists, status blocks.
  Caveman-friendly means scannable, not dumbed down.
- Cross-check derived mappings against their source (e.g. thin-specialist core skill derived
  from the role map's `boundary` field) and note any gap or inconsistency in a dedicated section.
- Flag un-read dependencies honestly (e.g. "ACTIVATION-AND-REVIEW-FLOW.md not re-read this
  session") so the implementer knows what still needs verification.