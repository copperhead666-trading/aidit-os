// ops-watcher/watcher.regression.test.mjs
// Dependency-free regression tests for canonical Paperclip endpoint discovery
// and the ECONNREFUSED-safe fetch path. No test framework — uses node:assert
// and a manual runner, matching the project's dependency-free style.
//
//   node ops-watcher/watcher.regression.test.mjs
//
// These tests spin up throwaway local http servers with node:http on ephemeral
// ports. They NEVER touch the real Paperclip instance.

import assert from "node:assert/strict";
import http from "node:http";
import { discoverPaperclipPort, httpGet, emitEvent } from "./watcher.mjs";

const FIXTURE_FINGERPRINT = "REGRESSION-FIXTURE-BACKUP-DIR-12345";
const HEALTH_PATH = "/api/health";
const IDENTITY_FIELD = "databaseBackup.backupDir";

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  console.log(`PASS: ${name}`);
  passed++;
}
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(`       ${err && err.stack ? err.stack : err}`);
  failures.push(name);
  failed++;
}

// Helper: start an http server on an ephemeral port (port 0) and return
// { port, close }. The handler is invoked per request.
function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        handler(req, res);
      } catch (err) {
        res.statusCode = 500;
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Build a config object in the on-disk file shape, pointing discovery at the
// given candidate ports and using the shared fixture fingerprint.
function makeConfig(candidatePorts, fingerprint = FIXTURE_FINGERPRINT) {
  return {
    canonical_identity: { backup_dir_fingerprint: fingerprint },
    discovery_strategy: {
      candidate_ports: candidatePorts,
      health_path: HEALTH_PATH,
      identity_field_in_health_response: IDENTITY_FIELD,
      timeout_ms_per_probe: 2000,
    },
  };
}

// Serve fake /api/health JSON with the given backupDir.
function healthHandler(backupDir) {
  return (req, res) => {
    if (req.url !== HEALTH_PATH) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      databaseBackup: { backupDir },
      status: "ok",
    }));
  };
}

// ---- Fake-fetch helpers for the retry-sweep tests ----
// discoverPaperclipPort uses the global `fetch`. For the retry tests we need
// deterministic control over which sweeps fail vs succeed, without spinning up
// (and tearing down) real servers per sweep. We temporarily override
// globalThis.fetch and restore it in a finally so the real-server tests above
// (and any later tests) are unaffected.

// A fake fetch Response shape that matches the canonical fingerprint (so the
// identity check passes and the port is returned).
function matchingFetchResponse() {
  return {
    ok: true,
    headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => ({ databaseBackup: { backupDir: FIXTURE_FINGERPRINT } }),
  };
}

// Run `fn` with globalThis.fetch replaced by `fakeFetch`, restoring the
// original afterward (even on throw).
async function withFakeFetch(fakeFetch, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

async function testCorrectInstanceWhenMultiplePortsRespond() {
  const name = "(a) correct instance when multiple ports respond";
  const wrong = await startServer(healthHandler("WRONG-BACKUP-DIR"));
  const right = await startServer(healthHandler(FIXTURE_FINGERPRINT));
  try {
    const cfg = makeConfig([wrong.port, right.port]);
    const port = await discoverPaperclipPort(cfg);
    assert.equal(port, right.port, `expected matched port ${right.port}, got ${port}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  } finally {
    await wrong.close();
    await right.close();
  }
}

async function testGracefulNoMatchNoServer() {
  const name = "(b1) graceful no-match when no server is listening";
  try {
    // 59999 is almost certainly closed; even if it isn't, discovery returns
    // null for a non-matching fingerprint, so the assertion holds either way.
    const cfg = makeConfig([59999]);
    const port = await discoverPaperclipPort(cfg);
    assert.equal(port, null, `expected null, got ${port}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function testGracefulNoMatchWrongFingerprint() {
  const name = "(b2) graceful no-match when only a wrong-fingerprint server responds";
  const wrong = await startServer(healthHandler("SOME-OTHER-DIR"));
  try {
    const cfg = makeConfig([wrong.port]);
    const port = await discoverPaperclipPort(cfg);
    assert.equal(port, null, `expected null for non-matching fingerprint, got ${port}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  } finally {
    await wrong.close();
  }
}

async function testEconnRefusedNoCrashDiscovery() {
  const name = "(c1) ECONNREFUSED no-crash (discovery resolves to null, never throws)";
  try {
    const cfg = makeConfig([59998]); // guaranteed-closed port
    const port = await discoverPaperclipPort(cfg);
    assert.equal(port, null, `discovery should resolve null on closed port, got ${port}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function testEconnRefusedNoCrashHttpGet() {
  const name = "(c2) ECONNREFUSED no-crash (httpGet returns networkError, never throws)";
  try {
    const r = await httpGet("http://127.0.0.1:59997/api/health");
    assert.equal(r.networkError, true, `expected networkError:true, got ${JSON.stringify(r)}`);
    assert.equal(r.body, null, "networkError result must have null body");
    assert.equal(r.status, 0, `expected status 0, got ${r.status}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

// ---- Retry-sweep tests (optional `opts` argument) ----
// A single-candidate-port config means exactly one fetch call per full sweep,
// so counting fetch calls == counting sweeps. The injected `sleep` records its
// calls so we can assert the retry-delay cadence precisely.

async function testRetrySucceedsOnThirdSweep() {
  const name = "(d1) attempts:3 — fails first two full sweeps, succeeds on third -> returns port; sleep called exactly twice";
  const sleepCalls = [];
  let fetchCalls = 0;
  const fakeFetch = async () => {
    fetchCalls += 1;
    if (fetchCalls <= 2) throw new Error("transient load — probe aborted");
    return matchingFetchResponse();
  };
  try {
    const cfg = makeConfig([3110]);
    const port = await withFakeFetch(fakeFetch, () =>
      discoverPaperclipPort(cfg, {
        attempts: 3,
        retryDelayMs: 1500,
        sleep: (ms) => { sleepCalls.push(ms); return Promise.resolve(); },
      }),
    );
    assert.equal(port, 3110, `expected matched port 3110, got ${port}`);
    assert.equal(fetchCalls, 3, `expected 3 fetch calls (3 sweeps), got ${fetchCalls}`);
    assert.equal(sleepCalls.length, 2, `sleep called exactly twice (between the 3 sweeps), got ${sleepCalls.length}`);
    assert.deepEqual(sleepCalls, [1500, 1500], `sleep called with retryDelayMs both times, got ${JSON.stringify(sleepCalls)}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function testRetryAllFailReturnsNull() {
  const name = "(d2) attempts:3 — always fails -> returns null; sleep called exactly twice (no sleep after final attempt)";
  const sleepCalls = [];
  let fetchCalls = 0;
  const fakeFetch = async () => {
    fetchCalls += 1;
    throw new Error("down");
  };
  try {
    const cfg = makeConfig([3110]);
    const port = await withFakeFetch(fakeFetch, () =>
      discoverPaperclipPort(cfg, {
        attempts: 3,
        retryDelayMs: 1500,
        sleep: (ms) => { sleepCalls.push(ms); return Promise.resolve(); },
      }),
    );
    assert.equal(port, null, `expected null after all attempts fail, got ${port}`);
    assert.equal(fetchCalls, 3, `expected 3 fetch calls (3 sweeps), got ${fetchCalls}`);
    assert.equal(sleepCalls.length, 2, `sleep called exactly twice, NOT three (no sleep after the final attempt), got ${sleepCalls.length}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function testRetrySuccessFirstSweepNoSleep() {
  const name = "(d3) attempts:3 — success on the first sweep -> returns port; sleep never called";
  const sleepCalls = [];
  const fakeFetch = async () => matchingFetchResponse();
  try {
    const cfg = makeConfig([3110]);
    const port = await withFakeFetch(fakeFetch, () =>
      discoverPaperclipPort(cfg, {
        attempts: 3,
        retryDelayMs: 1500,
        sleep: (ms) => { sleepCalls.push(ms); return Promise.resolve(); },
      }),
    );
    assert.equal(port, 3110, `expected matched port 3110, got ${port}`);
    assert.equal(sleepCalls.length, 0, `sleep never called on first-sweep success, got ${sleepCalls.length}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function testDefaultOneSweepNoSleep() {
  const name = "(d4) default (no options) -> exactly one full sweep, sleep never called (back-compat)";
  const sleepCalls = [];
  let fetchCalls = 0;
  const fakeFetch = async () => {
    fetchCalls += 1;
    throw new Error("down");
  };
  try {
    const cfg = makeConfig([3110]);
    // No second argument — must behave exactly as before: one sweep, no retry.
    const port = await withFakeFetch(fakeFetch, () => discoverPaperclipPort(cfg));
    assert.equal(port, null, `expected null (single failing sweep), got ${port}`);
    assert.equal(fetchCalls, 1, `exactly one fetch call / one full sweep (back-compat), got ${fetchCalls}`);
    assert.equal(sleepCalls.length, 0, `default never calls sleep (attempts=1), got ${sleepCalls.length}`);
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function testUnwrittenEventIsNotDeduped() {
  const name = "(e1) an event whose append failed is not marked seen, and is retried";
  try {
    const ev = { detector: "d1", target_role: "OPS-WATCHER", payload: { issueId: "i1" } };
    const state = { cursor: 0, seen: [], seenSet: {} };
    let fail = true;
    const written = [];
    const fakeFs = {
      appendFile: async (_file, line) => {
        if (fail) throw new Error("EACCES");
        written.push(line);
      },
    };

    const first = await emitEvent(state, ev, fakeFs, "events.test.jsonl");
    assert.equal(first, false, "a failed append is not an emitted event");
    assert.equal(state.seen.length, 0, "a failed append must not be marked seen");
    assert.equal(Object.keys(state.seenSet).length, 0, "seenSet must stay empty");

    fail = false;
    const second = await emitEvent(state, ev, fakeFs, "events.test.jsonl");
    assert.equal(second, true, "the retry emits it");
    assert.equal(written.length, 1, "exactly one line written");
    assert.equal(state.seen.length, 1, "now it is marked seen");

    const third = await emitEvent(state, ev, fakeFs, "events.test.jsonl");
    assert.equal(third, false, "a written event is still deduped");
    assert.equal(written.length, 1, "no duplicate line");
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function main() {
  console.log("# ops-watcher regression tests");
  await testCorrectInstanceWhenMultiplePortsRespond();
  await testGracefulNoMatchNoServer();
  await testGracefulNoMatchWrongFingerprint();
  await testEconnRefusedNoCrashDiscovery();
  await testEconnRefusedNoCrashHttpGet();
  await testRetrySucceedsOnThirdSweep();
  await testRetryAllFailReturnsNull();
  await testRetrySuccessFirstSweepNoSleep();
  await testDefaultOneSweepNoSleep();
  await testUnwrittenEventIsNotDeduped();

  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("regression runner crashed:", err);
  process.exit(1);
});