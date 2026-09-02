// ops-watcher/telegram-client.mjs
// Tiny, crash-proof Telegram Bot API client for the OWNER control plane.
//
// SECURITY CONTRACT (non-negotiable):
//   - The bot token is read fresh from process.env.TELEGRAM_BOT_TOKEN_AHMAD on
//     EVERY call. It is NEVER printed, logged, echoed, written to a file, or
//     copied anywhere. It is consumed only inside a URL passed directly to
//     fetch() against the official Telegram Bot API (or, in tests, a mock base).
//   - If the token env var is unset, every call returns a clean
//     { sent:false, reason:'TELEGRAM_BOT_TOKEN_AHMAD not set' } instead of
//     crashing or leaking.
//   - Any value that could conceivably reach a log/return/error message is run
//     through redact(), which strips token-shaped substrings
//     (<digits>:<30-64 alnum/_-> and the /bot<TOKEN>/ path segment) just in case
//     a Telegram error body ever echoes back part of the request URL.
//   - tokenStatus() reports ONLY { present: bool, length: number } — never the
//     value — so callers can prove the credential is wired without exposing it.
//
// Crash-proofing matches the rest of ops-watcher: a network-level failure
// (ECONNREFUSED, DNS, timeout, abort, malformed JSON) is reported as a clean
// { sent:false, networkError:true, networkErrorMessage } result, never thrown.
//
// Exports:
//   sendMessage(text, { buttons, timeoutMs, baseUrl })
//   answerCallbackQuery(callbackQueryId, text, { timeoutMs, baseUrl })
//   editMessageText(messageId, newText, { buttons, timeoutMs, baseUrl })
//   getUpdates(offset, { timeoutMs, baseUrl })
//   setMyCommands(commands, { timeoutMs, baseUrl })
//   setChatMenuButton(menuButton, { timeoutMs, baseUrl })
//   getMyCommands({ timeoutMs, baseUrl })  |  getChatMenuButton({ timeoutMs, baseUrl })
//   escapeMarkdown(text)
//   tokenStatus()
//
// `baseUrl` is a TEST SEAM only: it defaults to the real Telegram API base
// "https://api.telegram.org/bot" and the production CLIs never override it.
// Tests pass a local mock base so no real network or real credential is used.
//
//   node ops-watcher/telegram-client.mjs --selftest   # offline smoke vs local mock

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OWNER's Telegram chat id — an identifier, not a secret (same as the legacy
// build hardcoded it). The bot @ahmadsuperbot already has the OWNER as a contact.
export const OWNER_CHAT_ID = "8987077084";

// Real Telegram Bot API base. The token is appended immediately after "/bot".
const TG_BASE = "https://api.telegram.org/bot";

function getToken() {
  const t = process.env.TELEGRAM_BOT_TOKEN_AHMAD;
  return t && t.length ? t : null;
}

// Strip any token-shaped substring before it can reach a log/return/error line.
// Telegram bot tokens look like "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
// (8-12 digits, colon, then ~35 chars of [A-Za-z0-9_-]; we accept 30-64 to be
// safe across token-length variance). Also strips the /bot<TOKEN>/ path form.
export function redact(s) {
  if (s == null) return s;
  let str = String(s);
  str = str.replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,64}\b/g, "[REDACTED_TOKEN]");
  str = str.replace(/\/bot\d{8,12}:[A-Za-z0-9_-]{30,64}\//g, "/bot[REDACTED]/");
  return str;
}

// Lives beside sendMessage/editMessageText because this module owns Telegram's
// legacy parse_mode choice, so callers can escape against the parser in use.
export function escapeMarkdown(text) {
  return String(text ?? "").replace(/([\\_*`\[])/g, "\\$1");
}

// Core request. Never throws.
async function tgFetch(method, payload, { timeoutMs = 20000, baseUrl = TG_BASE } = {}) {
  const token = getToken();
  if (!token) return { sent: false, ok: false, reason: "TELEGRAM_BOT_TOKEN_AHMAD not set" };
  const url = `${baseUrl}${token}/${method}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const cause =
      (err && err.cause && err.cause.code) ||
      (err && err.cause && err.cause.message);
    return {
      sent: false, ok: false, status: 0,
      networkError: true,
      networkErrorMessage: redact(cause || (err && err.message) || "fetch failed"),
    };
  }
  clearTimeout(timer);
  let body = null;
  const ct = res.headers.get("content-type") || "";
  try {
    body = ct.includes("json") ? await res.json() : await res.text();
  } catch (err) {
    return {
      sent: false, ok: false, status: res.status,
      networkError: true,
      networkErrorMessage: redact((err && err.message) || "response parse failed"),
    };
  }
  // Defensive: if Telegram ever echoes part of the URL/token in an error
  // description, redact it before exposing.
  if (body && typeof body === "object" && typeof body.description === "string") {
    body = { ...body, description: redact(body.description) };
  }
  if (!res.ok || !(body && body.ok === true)) {
    return {
      sent: false, ok: false, status: res.status,
      networkError: false,
      error: redact(typeof body === "string" ? body : JSON.stringify(body)).slice(0, 500),
    };
  }
  return { sent: true, ok: true, status: res.status, result: body.result };
}

// Send a Markdown message to the OWNER. `buttons` is an inline_keyboard array
// (array of rows, each row an array of { text, callback_data }).
export async function sendMessage(text, { buttons, timeoutMs, baseUrl } = {}) {
  const payload = { chat_id: OWNER_CHAT_ID, text, parse_mode: "Markdown" };
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  return tgFetch("sendMessage", payload, { timeoutMs, baseUrl });
}

// Answer a callback query (shows a small toast to the OWNER who tapped a button).
export async function answerCallbackQuery(callbackQueryId, text, { timeoutMs, baseUrl } = {}) {
  return tgFetch(
    "answerCallbackQuery",
    { callback_query_id: callbackQueryId, text: text || "" },
    { timeoutMs, baseUrl },
  );
}

// Edit an existing OWNER message (used to clear buttons + show resolved state
// after a decision, so the same button cannot be tapped twice).
export async function editMessageText(messageId, newText, { buttons, timeoutMs, baseUrl, removeKeyboard = false } = {}) {
  const payload = {
    chat_id: OWNER_CHAT_ID,
    message_id: messageId,
    text: newText,
    parse_mode: "Markdown",
  };
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  else if (removeKeyboard) payload.reply_markup = { inline_keyboard: [] };
  return tgFetch("editMessageText", payload, { timeoutMs, baseUrl });
}

// Long-poll for updates. `offset` is the last processed update_id + 1 (Telegram
// confirms all updates with id < offset once they are returned with an offset).
// `timeoutMs` bounds the whole fetch; the Telegram long-poll `timeout` param is
// derived from it. Returns { ok, updates:[], ... }.
export async function getUpdates(offset, { timeoutMs = 25000, baseUrl } = {}) {
  const longPollSec = Math.max(0, Math.floor((timeoutMs - 5000) / 1000));
  const payload = { timeout: longPollSec, allowed_updates: ["callback_query", "message"] };
  if (offset != null) payload.offset = offset;
  const r = await tgFetch("getUpdates", payload, { timeoutMs: timeoutMs + 8000, baseUrl });
  if (r.sent) return { ok: true, updates: Array.isArray(r.result) ? r.result : [] };
  return { ok: false, updates: [], ...r };
}

// Register the bot's command menu (the slash menu Telegram shows the OWNER).
// `commands` is an array of BotCommand objects { command, description } as
// documented for setMyCommands. Same never-throw contract as every other
// wrapper: a network/parse failure is reported as { sent:false, ... }, never
// thrown. No real call is made by this module on its own — a caller must invoke
// this explicitly (wiring comes separately).
export async function setMyCommands(commands, { timeoutMs, baseUrl } = {}) {
  return tgFetch("setMyCommands", { commands }, { timeoutMs, baseUrl });
}

// Register the chat menu button (the button left of the input box). Used to
// hang the Mini App off the OWNER's chat. Scoped to OWNER_CHAT_ID on purpose:
// the default (chat_id omitted) applies to every private chat with the bot, so
// anyone who found the bot would be handed a cockpit button. Same never-throw
// contract as every other wrapper. `menuButton` is a MenuButton object, e.g.
// { type: "web_app", text: "Cockpit", web_app: { url } } — Telegram requires
// that url to be https.
export async function setChatMenuButton(menuButton, { timeoutMs, baseUrl } = {}) {
  return tgFetch(
    "setChatMenuButton",
    { chat_id: OWNER_CHAT_ID, menu_button: menuButton },
    { timeoutMs, baseUrl },
  );
}

// Read back what is actually registered on the live bot. Read-only: used to
// verify a setMyCommands/setChatMenuButton apply landed, instead of trusting
// the apply's own return value.
export async function getMyCommands({ timeoutMs, baseUrl } = {}) {
  return tgFetch("getMyCommands", {}, { timeoutMs, baseUrl });
}

export async function getChatMenuButton({ timeoutMs, baseUrl } = {}) {
  return tgFetch("getChatMenuButton", { chat_id: OWNER_CHAT_ID }, { timeoutMs, baseUrl });
}

// Introspection for logs/reports — NEVER the token value.
export function tokenStatus() {
  const t = getToken();
  return { present: !!t, length: t ? t.length : 0 };
}

// ---- Offline selftest (local mock Telegram API, fake token via env) ----
async function runSelftest() {
  let passed = 0, failed = 0;
  const ok = (n) => { console.log(`PASS: ${n}`); passed++; };
  const bad = (n, e) => { console.log(`FAIL: ${n}`); if (e) console.log(`  ${e && e.stack ? e.stack : e}`); failed++; };
  const assert = (await import("node:assert/strict")).default;

  // Fake token injected via env — NO real credential, NO real network.
  // (Override any real token that may be present in the environment so the
  // selftest never touches a real credential.)
  const prev = process.env.TELEGRAM_BOT_TOKEN_AHMAD;
  const FAKE = "999999999:AAAtest_fake_token_for_selftest_only_xx";
  process.env.TELEGRAM_BOT_TOKEN_AHMAD = FAKE;

  const received = [];
  const server = http.createServer((req, res) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      let body = null;
      try { body = JSON.parse(buf || "{}"); } catch { /* ignore */ }
      received.push({ method: req.method, url: req.url, body });
      res.setHeader("content-type", "application/json");
      if (req.url.endsWith("/sendMessage")) {
        return res.end(JSON.stringify({ ok: true, result: { message_id: 42, date: 1, chat: { id: 8987077084 }, text: body.text } }));
      }
      if (req.url.endsWith("/answerCallbackQuery")) {
        return res.end(JSON.stringify({ ok: true, result: true }));
      }
      if (req.url.endsWith("/editMessageText")) {
        return res.end(JSON.stringify({ ok: true, result: { message_id: body.message_id, edit_date: 2 } }));
      }
      if (req.url.endsWith("/getUpdates")) {
        return res.end(JSON.stringify({ ok: true, result: [] }));
      }
      if (req.url.endsWith("/setMyCommands") || req.url.endsWith("/setChatMenuButton")) {
        return res.end(JSON.stringify({ ok: true, result: true }));
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, description: "unknown method" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/bot`;

  try {
    // (a) token present + sendMessage happy path
    const s = await sendMessage("hello *owner*", { buttons: [[{ text: "APPROVE", callback_data: "a:KOL-1" }]], baseUrl, timeoutMs: 3000 });
    assert.equal(s.sent, true);
    assert.equal(s.result.message_id, 42);
    ok("(a) sendMessage happy path returns message_id");

    // (b) token redaction: the mock sees the token in the URL (API contract), but
    // redact() must strip it from anything we expose.
    assert.equal(redact(`err for ${FAKE}/x`), "err for [REDACTED_TOKEN]/x");
    ok("(b) redact() strips token-shaped substrings");

    // (c) tokenStatus never leaks value
    const ts = tokenStatus();
    assert.equal(ts.present, true);
    assert.equal(typeof ts.length, "number");
    assert.ok(!JSON.stringify(ts).includes(FAKE));
    ok("(c) tokenStatus reports present/length only, no value");

    // (d) answerCallbackQuery + editMessageText happy
    const ac = await answerCallbackQuery("cbq-1", "approved", { baseUrl, timeoutMs: 3000 });
    assert.equal(ac.sent, true);
    const ed = await editMessageText(42, "*resolved*", { baseUrl, timeoutMs: 3000 });
    assert.equal(ed.sent, true);
    ok("(d) answerCallbackQuery + editMessageText happy paths");

    // (e) getUpdates returns array
    const gu = await getUpdates(undefined, { timeoutMs: 3000, baseUrl });
    assert.equal(gu.ok, true);
    assert.deepEqual(gu.updates, []);
    ok("(e) getUpdates returns empty array");

    // (f) missing token -> clean reason, no crash
    process.env.TELEGRAM_BOT_TOKEN_AHMAD = "";
    const s2 = await sendMessage("x", { baseUrl, timeoutMs: 3000 });
    assert.equal(s2.sent, false);
    assert.equal(s2.reason, "TELEGRAM_BOT_TOKEN_AHMAD not set");
    ok("(f) missing token -> clean reason, no crash");

    // (g) network error (closed port) -> networkError, no throw, no token leak
    process.env.TELEGRAM_BOT_TOKEN_AHMAD = FAKE;
    const s3 = await sendMessage("x", { baseUrl: "http://127.0.0.1:59987/bot", timeoutMs: 1500 });
    assert.equal(s3.sent, false);
    assert.equal(s3.networkError, true);
    assert.ok(!JSON.stringify(s3).includes(FAKE));
    ok("(g) network error -> networkError, no token leak");

    // (h) menu registration wrappers: both reach the API with the documented
    // payload shape. setChatMenuButton must carry chat_id so the button is
    // scoped to the OWNER instead of every private chat with the bot.
    received.length = 0;
    const cmds = await setMyCommands([{ command: "status", description: "x" }], { baseUrl, timeoutMs: 3000 });
    assert.equal(cmds.sent, true);
    const btn = await setChatMenuButton(
      { type: "web_app", text: "Cockpit", web_app: { url: "https://example.invalid/" } },
      { baseUrl, timeoutMs: 3000 },
    );
    assert.equal(btn.sent, true);
    const cmdCall = received.find((r) => r.url.endsWith("/setMyCommands"));
    const btnCall = received.find((r) => r.url.endsWith("/setChatMenuButton"));
    assert.equal(cmdCall.body.commands[0].command, "status");
    assert.equal(btnCall.body.chat_id, OWNER_CHAT_ID);
    assert.equal(btnCall.body.menu_button.type, "web_app");
    ok("(h) setMyCommands + setChatMenuButton send documented payloads, button scoped to OWNER");
  } catch (e) {
    bad("selftest", e);
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_BOT_TOKEN_AHMAD;
    else process.env.TELEGRAM_BOT_TOKEN_AHMAD = prev;
    await new Promise((r) => server.close(() => r()));
  }

  console.log("");
  console.log(`TELEGRAM-CLIENT SELFTEST RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  const arg = process.argv[2];
  if (arg === "--selftest") runSelftest();
}