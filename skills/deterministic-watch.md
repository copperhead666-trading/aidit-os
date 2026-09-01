# deterministic-watch (OPS-WATCHER core skill)

Runs deterministic detectors only; no LLM calls, no inference; reports detector output verbatim.

How this org actually runs it:
- ops-watcher/watcher.mjs is the real deterministic watcher. It reads Paperclip issue state via
  the CORRECT routes (/api/companies/{id}/issues, not bare /issues) and emits deterministic
  events to ops-watcher/events.jsonl. A prior route bug made issue_count silently always 0 —
  deterministic detectors must hit the real canonical routes, not a wrong endpoint.
- No LLM, no inference, no "the issue probably means…". Report the literal detector output.
- The security-audit.mjs detector scans for unmanaged secrets and self-cleanliness; it reports
  findings, it does not fix them. Deterministic = reproducible from the same input.
- If a detector finds nothing, report "no findings" — do not pad with speculative concerns.