// Offline regression tests for ops-watcher/alert-delivery.mjs.
// No node:test, no dependencies, no spawning, no real Telegram send.

import assert from "node:assert/strict";
import { judgeAlertDelivery, deliverAlert } from "./alert-delivery.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`       ${e && e.stack ? e.stack : e}`); failures.push(n); failed++; };
async function t(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e); }
}

console.log("# alert-delivery regression tests");

await t("A1 a spawn result with a pid counts as delivered", () => {
  const v = judgeAlertDelivery({ pid: 4242 });
  assert.equal(v.delivered, true);
  assert.equal(v.pid, 4242);
  assert.equal(v.reason, null);
});

await t("A2 defaultPostAlert's failure shape is not delivered", () => {
  // Both senders in this repo report a failed spawn like this, without throwing.
  const v = judgeAlertDelivery({ pid: null, error: "spawn ENOENT" });
  assert.equal(v.delivered, false);
  assert.match(v.reason, /ENOENT/);
});

await t("A3 an error field wins even when a pid or a truthy sent is present", () => {
  assert.equal(judgeAlertDelivery({ pid: 10, error: "boom" }).delivered, false);
  assert.equal(judgeAlertDelivery({ sent: true, error: "boom" }).delivered, false);
});

await t("A4 telegram-client's refusal shape is not delivered, and carries its reason", () => {
  // sendMessage returns exactly this when the token is missing.
  const v = judgeAlertDelivery({ sent: false, ok: false, reason: "TELEGRAM_BOT_TOKEN_AHMAD not set" });
  assert.equal(v.delivered, false);
  assert.equal(v.reason, "TELEGRAM_BOT_TOKEN_AHMAD not set");
});

await t("A5 telegram-client's success shape is delivered", () => {
  const v = judgeAlertDelivery({ sent: true, ok: true, status: 200, result: {} });
  assert.equal(v.delivered, true);
});

await t("A6 a missing pid is not delivered even without an error field", () => {
  assert.equal(judgeAlertDelivery({ pid: null }).delivered, false);
  assert.equal(judgeAlertDelivery({ pid: undefined }).delivered, false);
  assert.match(judgeAlertDelivery({ pid: null }).reason, /no pid/);
});

await t("A7 nothing, undefined, and a non-object are never delivered", () => {
  // A stub written as `async () => {}` resolves to undefined. Treating that as
  // success is how an unread result becomes a false confirmation.
  assert.equal(judgeAlertDelivery(undefined).delivered, false);
  assert.equal(judgeAlertDelivery(null).delivered, false);
  assert.equal(judgeAlertDelivery("sent").delivered, false);
  assert.equal(judgeAlertDelivery(true).delivered, false);
});

await t("A8 an unrecognised object shape is not evidence of delivery", () => {
  const v = judgeAlertDelivery({ status: 200 });
  assert.equal(v.delivered, false);
  assert.match(v.reason, /unrecognised/);
});

await t("A9 deliverAlert converts a throw into the same verdict shape", async () => {
  const v = await deliverAlert(() => { throw new Error("spawn failed"); });
  assert.equal(v.delivered, false);
  assert.equal(v.reason, "spawn failed");
});

await t("A10 deliverAlert handles a rejected promise, not just a sync throw", async () => {
  const v = await deliverAlert(async () => { throw new Error("async boom"); });
  assert.equal(v.delivered, false);
  assert.equal(v.reason, "async boom");
});

await t("A11 deliverAlert accepts a synchronous sender", async () => {
  const v = await deliverAlert(() => ({ pid: 7 }));
  assert.equal(v.delivered, true);
  assert.equal(v.pid, 7);
});

await t("A12 deliverAlert calls the sender exactly once", async () => {
  let calls = 0;
  await deliverAlert(() => { calls++; return { pid: 1 }; });
  assert.equal(calls, 1);
});

console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
