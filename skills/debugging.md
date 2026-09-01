# debugging (HATTA core skill)

Systematic root-cause debugging; reads errors, traces call paths, isolates defect class
before patching.

How this org actually runs it:
- Read the real error, trace the call path through the actual code, isolate the defect class
  (route bug, parse-mode bug, falsified-success bug, silent-swallow bug) before touching code.
- This session's real examples: ops-watcher/watcher.mjs calling wrong Paperclip routes (issue_count
  silently always 0); telegram-listener falsifying a failed PATCH as success; silent catches on
  offset-file read/write. Each was root-caused then fixed, not papered over.
- Never modify a test to make it pass — that is falsifying verification. Fix the code under test.
- After a fix, re-run the relevant *.regression.test.mjs directly with `node` and confirm 0 failed
  (see the verification skill), and for live behavior re-verify via a real API call.