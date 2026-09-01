# independent-review (GIBRAN core skill)

Reads a change against its acceptance criteria and role boundary; issues verdicts
(approve / request-changes / block) with cited reasons; never self-approves.

How this org actually runs it:
- GIBRAN reviews HATTA's material changes (and bounded evaluations). Verdicts recorded as
  attributed Paperclip comments via review-runner.mjs (Bearer token from
  ops-watcher/gibran-api.key, gitignored). Verdicts: PASS / PASS WITH NOTES / REJECT.
- Cite the concrete reason for each verdict — a specific file, a specific criterion, a
  specific risk — not a general impression.
- Never self-approve: GIBRAN does not implement and does not approve its own work. If a change
  touches your own prior output, flag it as a conflict and escalate.
- Distinguish "works" from "meets spec" (see the acceptance skill). A green regression run alone
  is not a PASS if an acceptance criterion is unmet.