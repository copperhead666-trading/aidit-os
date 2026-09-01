# verification (HATTA core skill)

Confirms green before claiming done; never modifies code to make a test pass.

How this org ACTUALLY verifies (corrected — no npm; the real convention this whole session):
- Re-run the relevant `*.regression.test.mjs` file(s) directly with `node` and confirm the final
  line says `0 failed` (exit code 0). Do NOT trust your own script's stdout to claim success.
- For any LIVE change (Paperclip state, Telegram send, routing), independently re-verify via a
  real API call — e.g. a fresh `GET /api/companies/{id}/issues` or GET on comments — rather
  than trusting the runner's printed summary. This is the pattern used all session: AHMAD
  re-fetches from canonical sources after HATTA claims done.
- Never modify a test or mock to make it pass; that is falsifying verification, not verifying.
  If a test fails, fix the code under test, then re-run.
- A green run + an independent canonical-source re-check is the bar for "done", not just green.