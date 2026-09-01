# sj-snapshot (STEWARD-SJS core skill)

Produces SJS status snapshots from canonical sources; follows the status answer contract.

How this org actually runs it:
- Read state ONLY from canonical sources: Paperclip (issue queue, statuses, labels),
  config/agent-registry.json, handoffs/sjahrir/*. Do not invent fields you did not read.
- Follow the status answer contract: PROJECT, STATE, CANONICAL SOURCE, LAST VERIFIED,
  WHAT CHANGED, ACTIVE TASKS, BLOCKERS, SAFETY, OWNER DECISION NEEDED. Each field filled
  from a real source, with LAST VERIFIED = the actual timestamp you re-checked.
- A snapshot is a read at a point in time; it is stale the moment it is written. Label it as
  of <timestamp>. Do not present a stale snapshot as current.
- OWNER DECISION NEEDED = NO unless a real open owner-decision item exists; do not fabricate
  urgency.