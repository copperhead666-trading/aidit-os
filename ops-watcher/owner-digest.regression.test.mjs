// ops-watcher/owner-digest.regression.test.mjs
// Offline regression tests for the daily OWNER digest. NO real Telegram, NO real
// digest state file: every maybeSendDigest case injects both a fake state store
// and a fake sendMessage implementation. Run with:
//   node ops-watcher/owner-digest.regression.test.mjs

import assert from "node:assert/strict";
import { dayKey, maybeSendDigest, runNotifyOnce } from "./telegram-notify.mjs";

let passed = 0;
let failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => {
  console.log(`FAIL: ${n}`);
  if (e) console.log(`  ${e && e.stack ? e.stack : e}`);
  failures.push(n);
  failed++;
};

const DAY = "2026-09-03";
const NOW = Date.parse(`${DAY}T08:00:00+07:00`);
const TOMORROW = Date.parse("2026-09-04T08:00:00+07:00");

function daysAgo(n) {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
}

function issue(over = {}) {
  return {
    id: "iss-1",
    identifier: "KOL-1",
    title: "ordinary",
    status: "todo",
    labels: [],
    labelIds: [],
    createdAt: daysAgo(1),
    comments: [],
    ...over,
  };
}

function waitingIssues() {
  return [
    issue({
      id: "iss-card",
      identifier: "KOL-29",
      title: "OWNER DIRECTIVE: card",
      labels: [{ name: "OWNER_REQUIRED" }],
      createdAt: daysAgo(5),
    }),
    issue({
      id: "iss-digest-1",
      identifier: "KOL-50",
      title: "P4 DECISION NEEDED: Health OS",
      createdAt: daysAgo(3),
    }),
    issue({
      id: "iss-digest-2",
      identifier: "KOL-62",
      title: "APPROVE: start real work on SJS SuperApps now?",
      createdAt: daysAgo(2),
    }),
  ];
}

function fakeState(initial = {}) {
  let current = JSON.parse(JSON.stringify(initial));
  const calls = { read: 0, write: [] };
  return {
    calls,
    store: {
      async read() {
        calls.read++;
        return JSON.parse(JSON.stringify(current));
      },
      async write(next) {
        const snapshot = JSON.parse(JSON.stringify(next));
        calls.write.push(snapshot);
        current = snapshot;
      },
    },
  };
}

function forbiddenState() {
  const calls = { read: 0, write: [] };
  return {
    calls,
    store: {
      async read() {
        calls.read++;
        throw new Error("real digest store must not be used in this test");
      },
      async write(next) {
        calls.write.push(next);
        throw new Error("real digest store must not be written in this test");
      },
    },
  };
}

function fakeSend({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    sendMessage: async (text, opts = {}) => {
      calls.push({ text, opts });
      if (fail) return { sent: false, reason: "simulated send failure" };
      return { sent: true, result: { message_id: 777 } };
    },
  };
}

async function t1_dayKeyUsesLocalCalendar() {
  const state = forbiddenState();
  const sender = fakeSend();
  assert.equal(dayKey(Date.parse("2026-09-03T00:05:00+07:00")), "2026-09-03", "T1: local day formats as YYYY-MM-DD");
  assert.equal(
    dayKey(Date.parse("2026-09-03T00:05:00+07:00")),
    dayKey(Date.parse("2026-09-03T23:55:00+07:00")),
    "T1: two timestamps on the same local day share a key",
  );
  assert.equal(state.calls.read, 0, "T1: dayKey does not read digest state");
  assert.equal(state.calls.write.length, 0, "T1: dayKey does not write digest state");
  assert.equal(sender.calls.length, 0, "T1: dayKey does not send Telegram");
  ok("T1: dayKey returns the local calendar YYYY-MM-DD");
}

async function t2_firstRunSendsAndMarksDay() {
  const state = fakeState();
  const sender = fakeSend();
  const r = await maybeSendDigest({
    issues: waitingIssues(),
    now: () => NOW,
    state: state.store,
    sendMessage: sender.sendMessage,
    cockpitUrl: "https://cockpit.example.invalid/",
  });

  assert.equal(r.outcome, "sent", "T2: first run sends");
  assert.equal(r.day, DAY, "T2: returns the local day");
  assert.equal(r.total, 3, "T2: total waiting count");
  assert.equal(r.cards, 1, "T2: card count");
  assert.equal(r.digest, 2, "T2: digest count");
  assert.equal(r.message_id, 777, "T2: returns the Telegram message id");
  assert.equal(sender.calls.length, 1, "T2: sends exactly once");
  assert.match(sender.calls[0].text, /^3 nunggu keputusan lo\./, "T2: sends the rendered digest");
  assert.match(sender.calls[0].text, /cockpit\.example\.invalid/, "T2: includes cockpit link when supplied");
  assert.deepEqual(state.calls.write, [{ lastSentDay: DAY }], "T2: writes lastSentDay");
  ok("T2: first digest run sends once and marks the day");
}

async function t3_secondRunSameDaySendsNothing() {
  const state = fakeState({ lastSentDay: DAY });
  const sender = fakeSend();
  const r = await maybeSendDigest({
    issues: waitingIssues(),
    now: () => NOW,
    state: state.store,
    sendMessage: sender.sendMessage,
  });

  assert.equal(r.outcome, "already-sent-today", "T3: same day is skipped");
  assert.equal(r.day, DAY, "T3: returns the skipped day");
  assert.equal(sender.calls.length, 0, "T3: fake send was never called");
  assert.equal(state.calls.write.length, 0, "T3: store is not written again");
  ok("T3: second digest run on the same day sends nothing");
}

async function t4_newDayAfterPreviousSendSendsAgain() {
  const state = fakeState({ lastSentDay: DAY });
  const sender = fakeSend();
  const r = await maybeSendDigest({
    issues: waitingIssues(),
    now: () => TOMORROW,
    state: state.store,
    sendMessage: sender.sendMessage,
  });

  assert.equal(r.outcome, "sent", "T4: a new day sends again");
  assert.equal(r.day, "2026-09-04", "T4: returns the new day");
  assert.equal(sender.calls.length, 1, "T4: sends exactly once on the new day");
  assert.deepEqual(state.calls.write, [{ lastSentDay: "2026-09-04" }], "T4: writes the new lastSentDay");
  ok("T4: a new day after a previous digest sends again");
}

async function t5_nothingWaitingMarksDayWithoutSending() {
  const state = fakeState();
  const sender = fakeSend();
  const r = await maybeSendDigest({
    issues: [issue({ identifier: "KOL-99", title: "ordinary work" })],
    now: () => NOW,
    state: state.store,
    sendMessage: sender.sendMessage,
  });

  assert.equal(r.outcome, "nothing-waiting", "T5: nothing waiting is silent");
  assert.equal(r.total, 0, "T5: total is zero");
  assert.equal(sender.calls.length, 0, "T5: no Telegram send for silence");
  assert.deepEqual(state.calls.write, [{ lastSentDay: DAY }], "T5: still marks the day");
  ok("T5: no waiting issues marks the day without sending");
}

async function t6_sendFailureDoesNotMarkDay() {
  const state = fakeState();
  const sender = fakeSend({ fail: true });
  const r = await maybeSendDigest({
    issues: waitingIssues(),
    now: () => NOW,
    state: state.store,
    sendMessage: sender.sendMessage,
  });

  assert.equal(r.outcome, "send-failed", "T6: failure is reported");
  assert.equal(r.day, DAY, "T6: returns the attempted day");
  assert.equal(r.total, 3, "T6: total still reports the waiting count");
  assert.match(r.reason, /simulated send failure/, "T6: carries the send failure reason");
  assert.equal(sender.calls.length, 1, "T6: send was attempted once");
  assert.equal(state.calls.write.length, 0, "T6: lastSentDay is NOT written after failure");
  ok("T6: send failure does not mark the day, so the next sweep can retry");
}

async function t7_runNotifyOnceDigestIsOptIn() {
  const state = forbiddenState();
  const sender = fakeSend();
  const r = await runNotifyOnce({
    base: "http://paperclip.example.invalid",
    tokenStatusFn: () => ({ present: true, length: 10 }),
    ensureLabel: async () => ({ id: "lbl-owner-required" }),
    httpGet: async () => ({ networkError: false, status: 200, body: [] }),
    postComment: async () => {
      throw new Error("no card marker should be posted");
    },
    sendMessage: sender.sendMessage,
    state: state.store,
    log: () => {},
  });

  assert.equal(r.error, undefined, "T7: notify setup succeeds");
  assert.deepEqual(r.results, [], "T7: no card sends on an empty board");
  assert.equal(r.digest.outcome, "not-requested", "T7: digest is not run unless requested");
  assert.equal(sender.calls.length, 0, "T7: sendMessage was never called");
  assert.equal(state.calls.read, 0, "T7: fake digest store was never read");
  assert.equal(state.calls.write.length, 0, "T7: fake digest store was never written");
  ok("T7: runNotifyOnce does not run the digest unless asked");
}

async function main() {
  const tests = [
    t1_dayKeyUsesLocalCalendar,
    t2_firstRunSendsAndMarksDay,
    t3_secondRunSameDaySendsNothing,
    t4_newDayAfterPreviousSendSendsAgain,
    t5_nothingWaitingMarksDayWithoutSending,
    t6_sendFailureDoesNotMarkDay,
    t7_runNotifyOnceDigestIsOptIn,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (e) {
      bad(t.name, e);
    }
  }
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("regression runner crashed:", e);
  process.exit(1);
});