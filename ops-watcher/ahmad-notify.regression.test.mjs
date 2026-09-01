// ops-watcher/ahmad-notify.regression.test.mjs
// Offline regression coverage for the AHMAD completion-notify wrapper. NO real
// Telegram network call — sendMessageFn is injected. Run with:
//   node ops-watcher/ahmad-notify.regression.test.mjs

import assert from "node:assert/strict";
import { runNotify } from "./ahmad-notify.mjs";

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };

async function t1_sendsTrimmedTextAsIs() {
  let seen = null;
  const r = await runNotify("  AHMAD finished KOL-100.  ", {
    sendMessageFn: async (text, opts) => { seen = { text, opts }; return { sent: true, ok: true, result: { message_id: 7 } }; },
  });
  assert.equal(seen.text, "AHMAD finished KOL-100.", "T1: message text trimmed before sending");
  assert.equal(r.sent, true, "T1: reports sent=true");
  assert.equal(r.result.message_id, 7, "T1: surfaces the real message_id");
  ok("T1: sends trimmed free-form text via injected sendMessageFn");
}

async function t2_emptyMessageNeverCallsSendMessage() {
  let called = false;
  const r = await runNotify("   ", { sendMessageFn: async () => { called = true; return { sent: true }; } });
  assert.equal(called, false, "T2: sendMessageFn must not be invoked for an empty/whitespace-only message");
  assert.equal(r.sent, false, "T2: reports sent=false");
  assert.equal(r.reason, "empty message", "T2: reason explains why nothing was sent");
  ok("T2: empty/whitespace-only text is a clean no-op, never a network call");
}

async function t3_sendFailurePropagatesCleanly() {
  const r = await runNotify("hello owner", {
    sendMessageFn: async () => ({ sent: false, networkError: true, networkErrorMessage: "ECONNRESET" }),
  });
  assert.equal(r.sent, false, "T3: a send failure is reported, not thrown");
  assert.equal(r.networkError, true, "T3: networkError flag passed through");
  ok("T3: a sendMessageFn failure is surfaced cleanly, never throws");
}

async function main() {
  const tests = [t1_sendsTrimmedTextAsIs, t2_emptyMessageNeverCallsSendMessage, t3_sendFailurePropagatesCleanly];
  for (const t of tests) await t();
  console.log(`\nahmad-notify.regression.test.mjs: ${pass}/${tests.length} passed`);
  if (pass !== tests.length) process.exitCode = 1;
}

main();
