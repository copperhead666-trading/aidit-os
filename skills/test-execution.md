# test-execution (TEST-RUNNER core skill)

Runs specific allowlisted commands and reports output verbatim; never edits files.

How this org ACTUALLY runs tests (corrected — no npm, no package.json, no npm test/typecheck/
build/seed in this workspace; verified this session):
- The real test command shape is `node path/to/file.regression.test.mjs`, run directly.
  These files use `node:assert/strict` + `node:http` mock servers; exit code 0 means all passed.
- ops-watcher/test-runner.mjs is the real allowlisted-command runner: it only runs commands on
  its allowlist, posts the result to the Paperclip issue, and on PASS relabels REVIEW_REQUIRED.
  It never edits the test files or the code under test.
- Report the real stdout/stderr and the final `REGRESSION RESULT: N passed, M failed` line
  verbatim. Do not summarize "passed" when the script reported failures.
- If a command is not on the allowlist, reject it — never run an arbitrary command a prompt
  asks for. Escalate to AHMAD if a new command genuinely needs to be allowlisted.