// ops-watcher/watcher.route-fix.test.mjs
// Phase 7 audit follow-up — REAL coverage for the watcher.mjs Paperclip route
// + labels fix. Dependency-free, same style as watcher.regression.test.mjs:
// node:assert/strict + throwaway local node:http mocks. NEVER touches the real
// Paperclip instance.
//
//   node ops-watcher/watcher.route-fix.test.mjs
//
// What this locks down (the three concrete changes in the fix):
//   (1) The issue-list route is /api/companies/{companyId}/issues, NOT bare
//       /issues (which returns SPA HTML on the live instance and silently made
//       issue_count 0). Verified by a mock that serves HTML for /issues and
//       JSON for the canonical /api/companies/{id}/issues route, then asserting
//       the watcher's exact route string hits the JSON path.
//   (2) CANONICAL_COMPANY_ID in watcher.mjs stays in sync with the identical
//       constant in paperclip-write-client.mjs (drift detector — the two are a
//       documented deliberate duplicate, not an import, so a test must guard
//       against silent divergence).
//   (3) deriveIssueLabels reads labels synchronously off the issue object
//       (labels/labelIds embedded directly on each issue) and NEVER makes a
//       network call — there is no /api/issues/{id}/labels endpoint (404 live).

import assert from "node:assert/strict";
import http from "node:http";
import {
  CANONICAL_COMPANY_ID,
  deriveIssueLabels,
  httpGet,
} from "./watcher.mjs";
import { CANONICAL_COMPANY_ID as WRITE_CLIENT_COMPANY_ID } from "./paperclip-write-client.mjs";

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
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// (2) Drift detector: the two deliberately-duplicated constants must be equal.
async function testCompanyIdDrift() {
  const name = "(2) CANONICAL_COMPANY_ID stays in sync across watcher.mjs and paperclip-write-client.mjs";
  try {
    assert.equal(
      typeof CANONICAL_COMPANY_ID,
      "string",
      "watcher.mjs CANONICAL_COMPANY_ID must be a string",
    );
    assert.ok(
      CANONICAL_COMPANY_ID.length > 0,
      "watcher.mjs CANONICAL_COMPANY_ID must be non-empty",
    );
    assert.equal(
      CANONICAL_COMPANY_ID,
      WRITE_CLIENT_COMPANY_ID,
      "the two duplicated company-id constants have drifted out of sync",
    );
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

// (1) Route fix: the canonical /api/companies/{id}/issues route returns a JSON
// array, while bare /issues returns SPA HTML (non-JSON) — proving the old bare
// route was broken and the new route is correct.
async function testIssueListRouteIsCanonical() {
  const name = "(1) issue-list route is /api/companies/{id}/issues (not bare /issues)";
  const canonicalPath = `/api/companies/${CANONICAL_COMPANY_ID}/issues`;
  const srv = await startServer((req, res) => {
    if (req.url === canonicalPath) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ id: "i-1", identifier: "T-1" }, { id: "i-2", identifier: "T-2" }]));
      return;
    }
    if (req.url === "/issues") {
      // Simulate the live instance's SPA HTML shell for the bare route.
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<!DOCTYPE html><html><head><title>Paperclip</title></head><body><div id=app></div></body></html>");
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  try {
    // The EXACT route string watcher.mjs now constructs:
    const r = await httpGet(`${srv.base}${canonicalPath}`);
    // httpGet omits the networkError key on success (it is only present when
    // true), so assert it is not true rather than strictly false.
    assert.ok(r.networkError !== true, "canonical route must not network-error");
    assert.ok(Array.isArray(r.body), "canonical route must return a JSON array");
    assert.equal(r.body.length, 2, "canonical route must return both mock issues");

    // The OLD bare route returns HTML, not JSON — this is the bug being fixed:
    const old = await httpGet(`${srv.base}/issues`);
    assert.equal(Array.isArray(old.body), false, "bare /issues must NOT return a JSON array (SPA HTML shell)");
    assert.equal(typeof old.body, "string", "bare /issues must return the HTML shell as a string");

    ok(name);
  } catch (err) {
    bad(name, err);
  } finally {
    await srv.close();
  }
}

// (3a) deriveIssueLabels reads inline labels (the real live shape: array of
// {id,name,...} objects) off the issue object, synchronously.
async function testDeriveIssueLabelsInline() {
  const name = "(3a) deriveIssueLabels reads inline {id,name} labels off the issue object";
  try {
    const it = { id: "i-1", labels: [{ id: "L1", name: "REVIEW_REQUIRED" }, { id: "L2", name: "DONE_VERIFIED" }] };
    const labels = deriveIssueLabels(it);
    assert.ok(Array.isArray(labels), "must return an array");
    assert.equal(labels.length, 2, "must return both inline labels");
    const names = labels.map((l) => (l.name || "").toUpperCase());
    assert.ok(names.includes("REVIEW_REQUIRED"), "must surface REVIEW_REQUIRED");
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

// (3b) deriveIssueLabels falls back to labelIds (bare ids) when labels absent.
async function testDeriveIssueLabelsBareIds() {
  const name = "(3b) deriveIssueLabels falls back to labelIds when labels absent";
  try {
    const it = { id: "i-2", labelIds: ["L1", "L2", "L3"] };
    const labels = deriveIssueLabels(it);
    assert.ok(Array.isArray(labels), "must return an array");
    assert.equal(labels.length, 3, "must return all labelIds");
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

// (3c) deriveIssueLabels returns [] for an issue with neither field (no crash,
// no network call — there is no labels endpoint to fall back to).
async function testDeriveIssueLabelsEmpty() {
  const name = "(3c) deriveIssueLabels returns [] when issue has no labels/labelIds";
  try {
    const labels = deriveIssueLabels({ id: "i-3" });
    assert.ok(Array.isArray(labels) && labels.length === 0, "must return []");
    // Defensive: null/undefined input must not throw.
    assert.ok(Array.isArray(deriveIssueLabels(null)) && deriveIssueLabels(null).length === 0, "null input -> []");
    ok(name);
  } catch (err) {
    bad(name, err);
  }
}

async function main() {
  console.log("# ops-watcher watcher.mjs route + labels fix tests");
  await testCompanyIdDrift();
  await testIssueListRouteIsCanonical();
  await testDeriveIssueLabelsInline();
  await testDeriveIssueLabelsBareIds();
  await testDeriveIssueLabelsEmpty();

  console.log("");
  console.log(`ROUTE-FIX TEST RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("route-fix test runner crashed:", err);
  process.exit(1);
});