// Offline regression tests for ops-watcher/write-delivery.mjs.
// No node:test, no dependencies, no network, no real Paperclip write.

import assert from "node:assert/strict";
import { judgeWrite, deliverWrite } from "./write-delivery.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`       ${e && e.stack ? e.stack : e}`); failures.push(n); failed++; };
async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

console.log("# write-delivery regression tests");

await t("V1 a 2xx write counts as written", () => {
  assert.equal(judgeWrite({ status: 201, body: { id: "c1" } }).ok, true);
  assert.equal(judgeWrite({ status: 200, body: {} }).reason, null);
});

await t("V2 the 401 shape that used to read as success is a failure", () => {
  // writeRequest returns exactly this for 401/403: networkError is FALSE, so
  // every caller testing only `r.networkError` counted it as a stored write.
  const v = judgeWrite({ status: 401, body: null, authRequired: true, networkError: false });
  assert.equal(v.ok, false);
  assert.match(v.reason, /auth required/);
  assert.match(v.reason, /401/);
});

await t("V3 a non-2xx status is a failure and names the status", () => {
  const v = judgeWrite({ status: 500, body: "boom", networkError: false });
  assert.equal(v.ok, false);
  assert.match(v.reason, /status 500/);
  assert.equal(judgeWrite({ status: 404, body: null, networkError: false }).ok, false);
  assert.equal(judgeWrite({ status: 302, body: null, networkError: false }).ok, false);
});

await t("V4 a fetch-level failure is a failure and carries the cause", () => {
  const v = judgeWrite({ status: 0, networkError: true, networkErrorMessage: "ECONNREFUSED" });
  assert.equal(v.ok, false);
  assert.match(v.reason, /ECONNREFUSED/);
});

await t("V5 a network error wins over a 2xx-looking status", () => {
  const v = judgeWrite({ status: 200, networkError: true, networkErrorMessage: "response parse failed" });
  assert.equal(v.ok, false);
  assert.match(v.reason, /parse failed/);
});

await t("V6 the domain-helper shapes are judged by their entity", () => {
  // postComment / patchIssue report their outcome through the returned entity.
  assert.equal(judgeWrite({ comment: null }).ok, false);
  assert.equal(judgeWrite({ comment: { id: "c1" } }).ok, true);
  assert.equal(judgeWrite({ issue: null }).ok, false);
  assert.equal(judgeWrite({ issue: { id: "i1" } }).ok, true);
});

await t("V7 nothing, and a non-object, are not evidence of a write", () => {
  assert.equal(judgeWrite(undefined).ok, false);
  assert.equal(judgeWrite(null).ok, false);
  assert.equal(judgeWrite("created").ok, false);
  assert.match(judgeWrite(undefined).reason, /returned nothing/);
});

await t("V8 deliverWrite turns a throw into the same verdict shape", async () => {
  const v = await deliverWrite(() => { throw new Error("socket hang up"); });
  assert.equal(v.ok, false);
  assert.match(v.reason, /socket hang up/);
});

await t("V9 deliverWrite judges an async writer's result and runs it once", async () => {
  let calls = 0;
  const good = await deliverWrite(async () => { calls++; return { status: 201, body: {} }; });
  assert.equal(good.ok, true);
  assert.equal(calls, 1);
  const bad401 = await deliverWrite(async () => ({ status: 403, authRequired: true, networkError: false }));
  assert.equal(bad401.ok, false);
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
