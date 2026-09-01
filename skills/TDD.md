# TDD (HATTA core skill)

Red-green-refactor discipline: write a failing test first, implement to pass, then refactor.

How this org ACTUALLY runs tests in THIS workspace (corrected — there is no package.json, no
npm test, no npm run typecheck, and no :memory: DB anywhere here; verified this session):
- Tests are plain Node files named `*.regression.test.mjs`, run directly as
  `node path/to/file.regression.test.mjs`. No npm, no test runner config, no package scripts.
- They use `node:assert/strict` only (no jest/mocha/vitest), with `node:http` mock servers for
  any network dependency (Paperclip / Telegram are mocked on 127.0.0.1 loopback). See
  ops-watcher/heartbeat.regression.test.mjs / telegram.regression.test.mjs as the reference shape.
- Each file prints `PASS: <name>`/`FAIL: <name>` lines and a final
  `REGRESSION RESULT: N passed, M failed`; exit code 0 only when failed === 0.
- Red-green-refactor: write the failing assertion in that style, implement until `node` exits 0,
  then refactor without changing behavior. Add a regression guard for every fixed bug.