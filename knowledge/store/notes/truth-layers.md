---
title: Truth Layers
type: note
tags: [truth, gbrain, ruflo, kol-83]
---

# Truth Layers

## Dari bagian "Which layer is the truth about WHAT" (disetujui owner 2026-09-05, KOL-88)

- **git / GitHub**: "git / GitHub is the truth about the CODE and its history. What the system actually is, and what changed, is settled by the repository and its suite."
- **Paperclip**: "Paperclip is the truth about the CURRENT OPERATIONAL STATE: which issue is live, what is waiting on the owner, what a lane is working on right now."
- **gbrain**: "gbrain is the truth about the BUSINESS DOCUMENTS: the backlog, the ledger, handoffs, specs, anything an agent must be able to quote back to the owner."
- Aturan konflik: "On conflict, live Paperclip state outranks historical notes; but neither of them overrules the repository about what the code does. Never call any one of the three \"the source of truth\" without saying the truth about what."

## Dari bagian "Which index owns what"

- **gbrain**: "gbrain is canonical for FounderOS documents: the backlog, decision ledger, handoffs, specs, and anything an agent must be able to quote back to the owner."
- **ruflo memory**: "ruflo memory is for what gbrain does not do: cross-session hook patterns, dispatch outcomes, lane behaviour, and other operational traces that are useful to recall but are not canonical statements about the business."

## Batas yang tertulis

- "Two indexes both claiming to be the source of truth is worse than one."
- "Never mirror a canonical document into ruflo memory. Recall it from gbrain."

## Sumber

- `CLAUDE.md` - dibaca 2026-09-05
