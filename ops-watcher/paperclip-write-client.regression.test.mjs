// ops-watcher/paperclip-write-client.regression.test.mjs
// Offline regression tests for the crash-proof write primitives + domain helpers.
// Pattern matches watcher.regression.test.mjs: node:assert, local node:http mock
// servers, no real Paperclip, no network beyond loopback.
//
//   node ops-watcher/paperclip-write-client.regression.test.mjs

import assert from "node:assert/strict";
import http from "node:http";
import {
  httpPost, httpPatch, ensureLabel, listLabels, postComment, patchIssue,
} from "./paperclip-write-client.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`       ${e && e.stack ? e.stack : e}`); failures.push(n); failed++; };

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => { try { handler(req, res); } catch (e) { res.statusCode = 500; res.end(); } });
    server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => new Promise((r) => server.close(() => r())) }));
  });
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : null); } catch { resolve(null); } });
  });
}

// In-memory mock Paperclip: labels + issues + comments keyed by url path.
function mockPaperclip() {
  const labels = [
    { id: "lbl-review", name: "REVIEW_REQUIRED", color: "#ef4444" },
  ];
  const comments = { "iss-1": [] };
  let nextLabelId = 100;
  return {
    handler: async (req, res) => {
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      const send = (code, body) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };

      if (req.method === "GET" && p === "/api/companies/C/labels") return send(200, labels);
      if (req.method === "POST" && p === "/api/companies/C/labels") {
        const b = await readJsonBody(req);
        if (labels.some((l) => l.name.toUpperCase() === String(b.name).toUpperCase())) return send(201, labels.find((l) => l.name.toUpperCase() === String(b.name).toUpperCase()));
        const made = { id: `lbl-${nextLabelId++}`, name: b.name, color: b.color };
        labels.push(made); return send(201, made);
      }
      if (req.method === "POST" && p === "/api/issues/iss-1/comments") {
        const b = await readJsonBody(req);
        const c = { id: `c${nextLabelId++}`, body: b.body, authorType: "user", authorUserId: "local-board", authorAgentId: null, presentation: b.presentation || null, metadata: b.metadata || null };
        comments["iss-1"].push(c); return send(201, c);
      }
      if (req.method === "GET" && p === "/api/issues/iss-1/comments") return send(200, comments["iss-1"]);
      if (req.method === "PATCH" && p === "/api/issues/iss-1") {
        const b = await readJsonBody(req);
        return send(200, { id: "iss-1", status: b.status || "in_review", labelIds: b.labelIds || [], title: "mock", description: "d" });
      }
      if (req.method === "DELETE" && p === "/api/issues/iss-1") return send(200, { ok: true });
      send(404, { error: "not found mock" });
    },
    labels, comments,
  };
}

async function testHttpPostHappy() {
  const name = "(a) httpPost happy path returns 201 body";
  const m = mockPaperclip();
  const s = await startServer(m.handler);
  try {
    const r = await httpPost(`http://127.0.0.1:${s.port}/api/issues/iss-1/comments`, { body: "hi" });
    assert.equal(r.status, 201);
    assert.equal(r.body.body, "hi");
    assert.equal(r.networkError, false);
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testHttpPostEconnRefusedNoCrash() {
  const name = "(b) httpPost ECONNREFUSED -> networkError, never throws";
  try {
    const r = await httpPost("http://127.0.0.1:59996/api/x", { body: { a: 1 } });
    assert.equal(r.networkError, true);
    assert.equal(r.status, 0);
    assert.equal(r.body, null);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testHttpPatchEconnRefusedNoCrash() {
  const name = "(c) httpPatch ECONNREFUSED -> networkError, never throws";
  try {
    const r = await httpPatch("http://127.0.0.1:59995/api/x", { status: "done" });
    assert.equal(r.networkError, true);
    assert.equal(r.status, 0);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testEnsureLabelCreatesThenIdempotent() {
  const name = "(d) ensureLabel creates a missing label then is idempotent";
  const m = mockPaperclip();
  const s = await startServer(m.handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const r1 = await ensureLabel(base, "C", "TEST_REQUIRED", "#3b82f6");
    assert.equal(r1.created, true);
    assert.ok(r1.id, "created label has id");
    const r2 = await ensureLabel(base, "C", "TEST_REQUIRED", "#3b82f6");
    assert.equal(r2.created, false);
    assert.equal(r2.id, r1.id, "idempotent returns same id");
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testPostCommentAndPatchIssue() {
  const name = "(e) postComment + patchIssue against mock round-trip";
  const m = mockPaperclip();
  const s = await startServer(m.handler);
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const c = await postComment(base, "iss-1", "TEST RESULT: PASS", { presentation: { kind: "message", tone: "success", title: "x" }, metadata: { version: 1, sections: [] } });
    assert.equal(c.comment.body, "TEST RESULT: PASS");
    assert.equal(c.comment.authorType, "user");
    const p = await patchIssue(base, "iss-1", { status: "done", labelIds: ["lbl-done"] });
    assert.equal(p.issue.status, "done");
    assert.deepEqual(p.issue.labelIds, ["lbl-done"]);
    ok(name);
  } catch (e) { bad(name, e); } finally { await s.close(); }
}

async function testListLabelsNetworkErrorNoCrash() {
  const name = "(f) listLabels on closed port -> empty labels, no throw";
  try {
    const r = await listLabels("http://127.0.0.1:59994", "C");
    assert.equal(r.networkError, true);
    assert.deepEqual(r.labels, []);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function main() {
  console.log("# paperclip-write-client regression tests");
  await testHttpPostHappy();
  await testHttpPostEconnRefusedNoCrash();
  await testHttpPatchEconnRefusedNoCrash();
  await testEnsureLabelCreatesThenIdempotent();
  await testPostCommentAndPatchIssue();
  await testListLabelsNetworkErrorNoCrash();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error("regression runner crashed:", e); process.exit(1); });