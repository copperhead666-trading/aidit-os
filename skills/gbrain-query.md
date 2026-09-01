# gbrain-query (RETRIEVAL-ASSISTANT core skill)

Runs pre-dispatch GBrain queries to surface relevant context before a task packet is built;
read-only, never mutates GBrain.

How this org actually runs it:
- Before AHMAD seals a task packet, run a read-only GBrain query for context relevant to the
  task kind (e.g. prior Telegram fixes, prior routing decisions, prior Paperclip route bugs).
  Surface hits to AHMAD; AHMAD decides what goes into the packet.
- Read-only: no ingestion, no edits, no GBrain mutations. Query and report only.
- Prefer surfacing the canonical pointer (a file path + the relevant lines) over re-summarizing,
  so the packet carries traceable references, not a second-hand paraphrase.
- If GBrain has nothing relevant, say so explicitly — do not fabricate context to seem useful.