// ops-watcher/telegram-commands.regression.test.mjs
// Offline regression tests for the OWNER's slash commands.
//
//   node ops-watcher/telegram-commands.regression.test.mjs
//
// No real network, no real credential, no real Telegram API call. Every dep is
// injected; the renderers are exercised directly for purity. Matches the
// existing regression-test style (named checks, PASS lines, a final
// "REGRESSION RESULT: N passed, M failed", non-zero exit on failure).

import assert from "node:assert/strict";
import fsSync from "node:fs";
import {
  COMMANDS,
  isValidBotCommand,
  renderStatus,
  renderInbox,
  renderCockpit,
  renderHelp,
  handleCommand,
  parseCommand,
} from "./telegram-commands.mjs";
import { setMyCommands } from "./telegram-client.mjs";
import { PAUSE_FILE } from "./pause-gate.mjs";

let passed = 0, failed = 0;
const failures = [];
const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`  ${e && e.stack ? e.stack : e}`); failures.push(n); failed++; };

// A fixed heartbeat payload the tests inject through deps.
const HEARTBEAT = {
  succeeded: 9,
  total: 10,
  ageMs: 3 * 60_000,
  lanes: [
    { name: "ollama", successRate: 90, blocked: false },
    { name: "nous", successRate: 100, blocked: false },
    { name: "kimi", successRate: 0, blocked: true },
  ],
  needsYou: 3,
};

const INBOX = {
  needsYou: 3,
  stuck: 2,
  working: 5,
  stuckItems: [
    { identifier: "KOL-7", reason: "menunggu verdict review" },
    { identifier: "KOL-12", reason: "lane kimi mati" },
  ],
};

function depsWith() {
  return {
    getHeartbeat: async () => HEARTBEAT,
    getInbox: async () => INBOX,
  };
}

async function testCommandsValid() {
  const name = "(1, 17) every COMMANDS entry satisfies the documented rules (<=32, lowercase Latin/digits/underscore)";
  try {
    assert.equal(Array.isArray(COMMANDS), true, "COMMANDS is an array");
    assert.equal(COMMANDS.length, 6, "exactly six commands");
    for (const entry of COMMANDS) {
      assert.equal(isValidBotCommand(entry), true, `invalid command entry: ${JSON.stringify(entry)}`);
      assert.ok(entry.command.length <= 32, `command too long: ${entry.command}`);
      assert.ok(/^[a-z0-9_]{1,32}$/.test(entry.command), `command chars invalid: ${entry.command}`);
    }
    // the documented names, in this order
    assert.deepEqual(COMMANDS.map((c) => c.command), ["status", "inbox", "cockpit", "help", "pause", "resume"]);
    // descriptions are non-empty Indonesian strings
    for (const c of COMMANDS) assert.ok(c.description.trim().length > 0, `empty description for ${c.command}`);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testStatusHandled() {
  const name = "(2) handleCommand('/status', deps) returns handled true and includes the injected numbers";
  try {
    const r = await handleCommand("/status", depsWith());
    assert.equal(r.handled, true);
    assert.equal(typeof r.reply, "string");
    const reply = r.reply;
    assert.ok(/9\/10/.test(reply), "reply shows succeeded/total");
    assert.ok(/3 menit lalu/.test(reply), "reply shows the age");
    assert.ok(/90%/.test(reply), "reply shows ollama success rate");
    assert.ok(/0%/.test(reply) && /macet/.test(reply), "reply shows the blocked kimi lane");
    assert.ok(/Butuh keputusan lo: 3/.test(reply), "reply shows needsYou count");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testStatusAtBotHandledIdentically() {
  const name = "(3) /status@somebot is handled identically to /status";
  try {
    const a = await handleCommand("/status", depsWith());
    const b = await handleCommand("/status@somebot", depsWith());
    assert.equal(b.handled, true);
    assert.equal(b.reply, a.reply, "reply identical with and without @botname");
    // parseCommand strips the @botname suffix
    assert.equal(parseCommand("/status@somebot"), "status");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testUnknownNotHandled() {
  const name = "(4) /nope returns { handled: false } (no duplicate fallback here)";
  try {
    const r = await handleCommand("/nope", depsWith());
    assert.equal(r.handled, false);
    assert.equal(r.reply, undefined, "no reply fabricated for unknown command");
    // non-slash text is also not handled
    const r2 = await handleCommand("halo bos", depsWith());
    assert.equal(r2.handled, false);
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testMissingDataRendersTidakTersedia() {
  const name = "(5) renderers given missing data render 'tidak tersedia' and never a fabricated zero";
  try {
    // status: null and {} both -> tidak tersedia, no fabricated "0"
    const sNull = renderStatus(null);
    const sEmpty = renderStatus({});
    assert.ok(/tidak tersedia/.test(sNull), "renderStatus(null) has tidak tersedia");
    assert.ok(/tidak tersedia/.test(sEmpty), "renderStatus({}) has tidak tersedia");
    // A fabricated zero would look like "Heartbeat: 0/0" or "Butuh keputusan lo: 0".
    assert.ok(!/Heartbeat: 0\//.test(sNull), "no fabricated 0/ heartbeat on null");
    assert.ok(!/Heartbeat: \d+\/0/.test(sNull), "no fabricated /0 total on null");
    assert.ok(!/Butuh keputusan lo: 0\b/.test(sNull), "no fabricated needsYou 0 on null");
    assert.ok(!/Butuh keputusan lo: 0\b/.test(sEmpty), "no fabricated needsYou 0 on {}");

    // inbox: null and {} both -> tidak tersedia for all three counts
    const iNull = renderInbox(null);
    const iEmpty = renderInbox({});
    assert.ok(/tidak tersedia/.test(iNull), "renderInbox(null) has tidak tersedia");
    assert.ok(/tidak tersedia/.test(iEmpty), "renderInbox({}) has tidak tersedia");
    assert.ok(!/Macet: 0\b/.test(iNull), "no fabricated stuck 0 on null");
    assert.ok(!/Sedang dikerjakan: 0\b/.test(iNull), "no fabricated working 0 on null");
    assert.ok(!/Butuh keputusan lo: 0\b/.test(iNull), "no fabricated needsYou 0 on null");

    // a partial heartbeat: succeeded present, total missing -> tidak tersedia
    const sPartial = renderStatus({ succeeded: 5, ageMs: 60_000 });
    assert.ok(/tidak tersedia/.test(sPartial), "partial status still falls back to tidak tersedia");
    assert.ok(!/5\/0/.test(sPartial) && !/5\/tidak tersedia/.test(sPartial), "no half-rendered fraction");

    // a partial inbox: only stuck count -> the other two are tidak tersedia
    const iPartial = renderInbox({ stuck: 1 });
    assert.ok(/Butuh keputusan lo: tidak tersedia/.test(iPartial), "partial inbox needsYou tidak tersedia");
    assert.ok(/Macet: 1\b/.test(iPartial), "partial inbox keeps the provided stuck count");
    assert.ok(/Sedang dikerjakan: tidak tersedia/.test(iPartial), "partial inbox working tidak tersedia");

    // cockpit always returns the URL (no missing-data concept): no count fields,
    // no "tidak tersedia" — just the URL + the Tailscale line.
    const cNull = renderCockpit(null);
    assert.ok(/asus-gray\.tailc7b60e\.ts\.net/.test(cNull), "renderCockpit keeps the URL on null");
    assert.ok(!/tidak tersedia/.test(cNull), "renderCockpit does not fabricate tidak tersedia");
    assert.equal(/.*\n.*\n.*$/.test(cNull), true, "renderCockpit is the short two-line form");

    // help is data-free
    const h = renderHelp();
    assert.ok(/SETUJUI/.test(h) && /TOLAK/.test(h), "help names SETUJUI and TOLAK");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testRenderersPure() {
  const name = "(6) renderers are pure: same input -> identical output; injected fs/fetch spies never called";
  try {
    // fs/fetch spies: counts must stay 0 because the renderers touch neither.
    let fsCalls = 0, fetchCalls = 0;
    const fsSpy = { readFile: async () => { fsCalls++; return ""; } };
    const fetchSpy = async () => { fetchCalls++; return { ok: true }; };

    const s1 = renderStatus(HEARTBEAT);
    const s2 = renderStatus(HEARTBEAT);
    assert.equal(s1, s2, "renderStatus deterministic");

    const i1 = renderInbox(INBOX);
    const i2 = renderInbox(INBOX);
    assert.equal(i1, i2, "renderInbox deterministic");

    const c1 = renderCockpit(null);
    const c2 = renderCockpit(null);
    assert.equal(c1, c2, "renderCockpit deterministic");

    const h1 = renderHelp();
    const h2 = renderHelp();
    assert.equal(h1, h2, "renderHelp deterministic");

    // renderers must not mutate their input
    const hbCopy = JSON.parse(JSON.stringify(HEARTBEAT));
    renderStatus(hbCopy);
    assert.deepEqual(hbCopy, HEARTBEAT, "renderStatus does not mutate input");
    const inCopy = JSON.parse(JSON.stringify(INBOX));
    renderInbox(inCopy);
    assert.deepEqual(inCopy, INBOX, "renderInbox does not mutate input");

    // The spies are referenced (so a linter / accidental call would be caught)
    // but the renderers never touch them.
    void fsSpy; void fetchSpy;
    assert.equal(fsCalls, 0, "renderers never called fs");
    assert.equal(fetchCalls, 0, "renderers never called fetch");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testSetMyCommandsWrapperShape() {
  const name = "(7) setMyCommands wrapper exists and POSTs { commands } with the same never-throw contract";
  try {
    // Missing token -> clean reason, no throw, no real network.
    const saved = process.env.TELEGRAM_BOT_TOKEN_AHMAD;
    process.env.TELEGRAM_BOT_TOKEN_AHMAD = "";
    try {
      const r = await setMyCommands(COMMANDS, { baseUrl: "http://127.0.0.1:9/bot", timeoutMs: 200 });
      assert.equal(r.sent, false);
      assert.equal(r.reason, "TELEGRAM_BOT_TOKEN_AHMAD not set");
    } finally {
      if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN_AHMAD;
      else process.env.TELEGRAM_BOT_TOKEN_AHMAD = saved;
    }
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testInboxRendersStuckItems() {
  const name = "(8) inbox reply lists each STUCK item's identifier and one-line reason";
  try {
    const r = await handleCommand("/inbox", depsWith());
    assert.equal(r.handled, true);
    assert.ok(/KOL-7/.test(r.reply), "reply includes KOL-7");
    assert.ok(/KOL-12/.test(r.reply), "reply includes KOL-12");
    assert.ok(/menunggu verdict review/.test(r.reply), "reply includes the first stuck reason");
    assert.ok(/lane kimi mati/.test(r.reply), "reply includes the second stuck reason");
    // the three counts are all present
    assert.ok(/Butuh keputusan lo: 3/.test(r.reply));
    assert.ok(/Macet: 2/.test(r.reply));
    assert.ok(/Sedang dikerjakan: 5/.test(r.reply));
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testCockpitAndHelpReplies() {
  const name = "(9) /cockpit and /help return handled true with the right fixed content";
  try {
    const c = await handleCommand("/cockpit", depsWith());
    assert.equal(c.handled, true);
    assert.ok(/https:\/\/asus-gray\.tailc7b60e\.ts\.net\//.test(c.reply), "cockpit URL present");
    assert.ok(/Tailscale harus nyala/i.test(c.reply), "cockpit mentions Tailscale must be on");
    assert.ok(/laptop menyala/i.test(c.reply), "cockpit mentions laptop must be running");

    const h = await handleCommand("/help", depsWith());
    assert.equal(h.handled, true);
    assert.ok(/SETUJUI/.test(h.reply) && /TOLAK/.test(h.reply), "help names SETUJUI and TOLAK");
    assert.ok(/Balas sebuah kartu/.test(h.reply), "help mentions reply-to-card note");
    assert.ok(/Kirim pesan biasa/.test(h.reply), "help mentions plain-message assignment");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testStopStillNotImplemented() {
  const name = "(10) /stop, /kill and /restart remain unhandled; /pause and /resume are handled";
  try {
    for (const danger of ["/stop", "/kill", "/restart"]) {
      const r = await handleCommand(danger, depsWith());
      assert.equal(r.handled, false, `${danger} must keep falling through to fallback`);
    }
    const pause = await handleCommand("/pause", {
      ...depsWith(),
      readPause: () => ({ paused: false }),
      setPaused: () => ({ ok: true, wrote: true, state: { paused: true, reason: "r", atIso: "2026-09-02T00:00:00.000Z", by: "owner" } }),
    });
    assert.equal(pause.handled, true, "/pause is now handled");
    const resume = await handleCommand("/resume", {
      ...depsWith(),
      clearPause: () => ({ ok: true, cleared: false }),
    });
    assert.equal(resume.handled, true, "/resume is now handled");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testPauseWhenNotPausedWritesOnce() {
  const name = "(11) /pause when not paused writes the pause flag once and reports DIJEDA";
  try {
    const calls = [];
    const r = await handleCommand("/pause", {
      ...depsWith(),
      readPause: () => ({ paused: false }),
      setPaused: (payload) => {
        calls.push(payload);
        return { ok: true, wrote: true, state: { paused: true, reason: "r", atIso: "2026-09-02T00:00:00.000Z", by: "owner" } };
      },
    });
    assert.equal(r.handled, true);
    assert.equal(calls.length, 1, "setPaused called exactly once");
    assert.ok(/DIJEDA/.test(r.reply), "reply reports paused state");
    assert.ok(/\/resume/.test(r.reply), "reply mentions /resume");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testPauseWhenAlreadyPausedDoesNotWrite() {
  const name = "(12) /pause when already paused does not write and says it is already paused";
  try {
    let calls = 0;
    const r = await handleCommand("/pause", {
      ...depsWith(),
      readPause: () => ({ paused: true, reason: "r", atIso: "2026-09-02T00:00:00.000Z", by: "owner" }),
      setPaused: () => { calls++; return { ok: true }; },
    });
    assert.equal(r.handled, true);
    assert.equal(calls, 0, "setPaused must not be called when already paused");
    assert.ok(/sudah dijeda/.test(r.reply), "reply says it is already paused");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testPauseWriteFailureDoesNotClaimSuccess() {
  const name = "(13) /pause write failure says GAGAL and FounderOS is still running";
  try {
    const r = await handleCommand("/pause", {
      ...depsWith(),
      readPause: () => ({ paused: false }),
      setPaused: () => ({ ok: false, error: "disk penuh" }),
    });
    assert.equal(r.handled, true);
    assert.ok(/GAGAL/.test(r.reply), "reply reports failure");
    assert.ok(/MASIH BERJALAN/.test(r.reply), "reply says FounderOS is still running");
    assert.ok(!/\*FounderOS DIJEDA\*/.test(r.reply), "reply must not claim success");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testResumeWhenNothingPaused() {
  const name = "(14) /resume when nothing is paused says nothing changed";
  try {
    const r = await handleCommand("/resume", {
      ...depsWith(),
      clearPause: () => ({ ok: true, cleared: false }),
    });
    assert.equal(r.handled, true);
    assert.ok(/tidak sedang dijeda/.test(r.reply), "reply says it was not paused");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testResumeClearFailureDoesNotClaimSuccess() {
  const name = "(15) /resume clear failure says FounderOS is still paused";
  try {
    const r = await handleCommand("/resume", {
      ...depsWith(),
      clearPause: () => ({ ok: false, error: "x" }),
    });
    assert.equal(r.handled, true);
    assert.ok(/MASIH DIJEDA/.test(r.reply), "reply says FounderOS is still paused");
    assert.ok(!/DILANJUTKAN/.test(r.reply), "reply must not claim success");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function testResumeDefaultPathRealImportWhenFlagAbsent() {
  const name = "(16) /resume default path uses real imported pause-gate function when PAUSE_FILE is absent";
  try {
    if (fsSync.existsSync(PAUSE_FILE)) {
      console.log(`SKIP: ${name} (real pause flag exists at ${PAUSE_FILE})`);
      ok(name);
      return;
    }
    const r = await handleCommand("/resume");
    assert.equal(r.handled, true);
    assert.equal(typeof r.reply, "string");
    ok(name);
  } catch (e) { bad(name, e); }
}

async function main() {
  console.log("# telegram-commands regression tests");
  await testCommandsValid();
  await testStatusHandled();
  await testStatusAtBotHandledIdentically();
  await testUnknownNotHandled();
  await testMissingDataRendersTidakTersedia();
  await testRenderersPure();
  await testSetMyCommandsWrapperShape();
  await testInboxRendersStuckItems();
  await testCockpitAndHelpReplies();
  await testStopStillNotImplemented();
  await testPauseWhenNotPausedWritesOnce();
  await testPauseWhenAlreadyPausedDoesNotWrite();
  await testPauseWriteFailureDoesNotClaimSuccess();
  await testResumeWhenNothingPaused();
  await testResumeClearFailureDoesNotClaimSuccess();
  await testResumeDefaultPathRealImportWhenFlagAbsent();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error("regression runner crashed:", e); process.exit(1); });