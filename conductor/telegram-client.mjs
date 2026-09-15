// Carried from Aidit OS v4 ops-watcher/telegram-client.mjs (same contract).
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
//   sendPhoto(photoPathOrBuffer, caption, { buttons, timeoutMs, baseUrl, filename })
//   sendDocument(filePathOrBuffer, caption, { buttons, timeoutMs, baseUrl, filename })
//   sendVoice(oggPath, caption, { buttons, timeoutMs, baseUrl, filename })
//   getFile(fileId, { timeoutMs, baseUrl })
//   downloadFile(filePath, destPath, { timeoutMs, fileBaseUrl })
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
import { promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkOwnerText, rewriteHint } from "../ops/voice/owner-lexicon-gate.mjs";

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
async function tgFetch(method, payload, { timeoutMs = 20000, baseUrl = TG_BASE, fetch: customFetch } = {}) {
  const fetchFn = customFetch || fetch;
  const token = getToken();
  if (!token && !customFetch) return { sent: false, ok: false, reason: "TELEGRAM_BOT_TOKEN_AHMAD not set" };
  const effectiveToken = token || "TEST_TOKEN";
  const url = `${baseUrl}${effectiveToken}/${method}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, {
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

function isMarkdownEntityParseFailure(result) {
  return Boolean(
    result &&
    result.status === 400 &&
    typeof result.error === "string" &&
    /can(?:\x27)?t parse entities/i.test(result.error),
  );
}

async function tgFetchWithMarkdownFallback(method, payload, opts) {
  const first = await tgFetch(method, payload, opts);
  if (!isMarkdownEntityParseFailure(first)) return first;

  console.log(`[telegram-client] ${method} Markdown parse entities failed; retrying without parse_mode`);
  const plainPayload = { ...payload };
  delete plainPayload.parse_mode;
  const second = await tgFetch(method, plainPayload, opts);
  return { ...second, parseModeFallback: true };
}

// Default path for the lexicon reject log.
const DEFAULT_REJECTS_FILE = path.resolve(__dirname, "..", "state", "lexicon-rejects.jsonl");

// Append a reject entry to the JSONL file. Never throws.
async function appendReject(entry, rejectsFile) {
  try {
    const dir = path.dirname(rejectsFile);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.appendFile(rejectsFile, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    // Best-effort; never block a send on a log failure.
  }
}

// Check text through the lexicon gate. If rejected, try ONE automatic
// rewrite using each hit's approved owner-facing phrasing (`say`) before
// giving up -- found live 2026-09-15: a real document-ingest Ask (jargon
// like "provenance-aware", status codes, MT5 terms from the source doc)
// was silently dropped (sendError, never reached Telegram) because nothing
// upstream sanitizes model-authored text before it hits this gate. Only
// chat.mjs's own chatReply had a fallback; Ask/Report/Alert had none.
// Returns: null (text passes as-is, proceed) | { rewritten } (proceed with
// this text instead) | rejection object (stop, log already written).
async function lexiconGate(text, opts) {
  if (opts.allowTechnical) return null; // bypass gate
  const lexOpt = opts.lexicon ? { lexicon: opts.lexicon } : undefined;
  const { ok, hits } = checkOwnerText(text, lexOpt);
  if (ok) return null;
  let rewritten = text;
  for (const h of hits) if (h.match) rewritten = rewritten.split(h.match).join(h.say);
  const retry = checkOwnerText(rewritten, lexOpt);
  if (retry.ok) return { rewritten };
  const hint = rewriteHint(hits);
  const rejectsFile = opts.rejectsFile || DEFAULT_REJECTS_FILE;
  await appendReject({ ts: new Date().toISOString(), text, hits, hint, rewriteAttempted: rewritten !== text, rewriteStillRejected: retry.hits.map((h) => h.token) }, rejectsFile);
  return { sent: false, ok: false, lexiconRejected: true, hits, hint };
}

// Send a Markdown message to the OWNER. `buttons` is an inline_keyboard array
// (array of rows, each row an array of { text, callback_data }).
// If `allowTechnical` is falsy, the text is checked against the lexicon gate;
// rejected messages are NOT sent and are logged to `rejectsFile`.
export async function sendMessage(text, { buttons, timeoutMs, baseUrl, allowTechnical, fetch: customFetch, rejectsFile, lexicon } = {}) {
  const gateResult = await lexiconGate(text, { allowTechnical, rejectsFile, lexicon });
  if (gateResult && !gateResult.rewritten) return gateResult;
  const payload = { chat_id: OWNER_CHAT_ID, text: gateResult?.rewritten || text, parse_mode: "Markdown" };
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  return tgFetchWithMarkdownFallback("sendMessage", payload, { timeoutMs, baseUrl, fetch: customFetch });
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
export async function editMessageText(messageId, newText, { buttons, timeoutMs, baseUrl, removeKeyboard = false, allowTechnical, fetch: customFetch, rejectsFile, lexicon } = {}) {
  const gateResult = await lexiconGate(newText, { allowTechnical, rejectsFile, lexicon });
  if (gateResult && !gateResult.rewritten) return gateResult;
  const payload = {
    chat_id: OWNER_CHAT_ID,
    message_id: messageId,
    text: gateResult?.rewritten || newText,
    parse_mode: "Markdown",
  };
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  else if (removeKeyboard) payload.reply_markup = { inline_keyboard: [] };
  return tgFetchWithMarkdownFallback("editMessageText", payload, { timeoutMs, baseUrl, fetch: customFetch });
}

export async function deleteMessage(messageId, { timeoutMs, baseUrl, fetch: customFetch } = {}) {
  return tgFetch("deleteMessage", { chat_id: OWNER_CHAT_ID, message_id: messageId }, { timeoutMs, baseUrl, fetch: customFetch });
}

// Photo cards (department deliverables) carry their text as a CAPTION; Telegram
// rejects editMessageText on them, so the listener edits the caption instead.
// sendVoice captions go through the same lexicon gate.
export async function editMessageCaption(messageId, newCaption, { buttons, timeoutMs, baseUrl, removeKeyboard = false, allowTechnical, fetch: customFetch, rejectsFile, lexicon } = {}) {
  const gateResult = await lexiconGate(String(newCaption || ""), { allowTechnical, rejectsFile, lexicon });
  if (gateResult && !gateResult.rewritten) return gateResult;
  const payload = { chat_id: OWNER_CHAT_ID, message_id: messageId, caption: (gateResult?.rewritten || String(newCaption || "")).slice(0, 1024), parse_mode: "Markdown" };
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  else if (removeKeyboard) payload.reply_markup = { inline_keyboard: [] };
  return tgFetchWithMarkdownFallback("editMessageCaption", payload, { timeoutMs, baseUrl, fetch: customFetch });
}

// ---- multipart uploads (sendPhoto / sendDocument) ----
// Telegram takes file uploads as multipart/form-data, not JSON, so these go
// through a sibling of tgFetch that sends a FormData body. Same token rule,
// same never-throw contract, same result shape and redact() as sendMessage.
// tgFetch itself is untouched: every existing caller and test depends on it.
export const CAPTION_MAX = 1024;
const CAPTION_TRUNCATED_NOTICE = "\n… [keterangan dipotong]";

// Telegram rejects captions over 1024 chars outright; cut and say so instead.
// multipart/form-data turns every LF into CRLF on the wire, so a newline is
// budgeted as two characters or a 1024-char caption arrives as 1030.
const wireLength = (str) => str.length + (str.split("\n").length - 1);
export function truncateCaption(caption, max = CAPTION_MAX) {
  const s = String(caption ?? "");
  if (wireLength(s) <= max) return { caption: s, truncated: false };
  let head = s.slice(0, max - CAPTION_TRUNCATED_NOTICE.length);
  while (head.length && wireLength(head + CAPTION_TRUNCATED_NOTICE) > max) head = head.slice(0, -1);
  return { caption: head + CAPTION_TRUNCATED_NOTICE, truncated: true };
}

function buildUploadForm(field, blob, filename, payload) {
  const form = new FormData();
  for (const [k, v] of Object.entries(payload)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  form.append(field, blob, filename);
  return form;
}

async function tgFetchForm(method, form, { timeoutMs = 60000, baseUrl = TG_BASE, fetch: customFetch } = {}) {
  const fetchFn = customFetch || fetch;
  const token = getToken();
  if (!token && !customFetch) return { sent: false, ok: false, reason: "TELEGRAM_BOT_TOKEN_AHMAD not set" };
  const effectiveToken = token || "TEST_TOKEN";
  const url = `${baseUrl}${effectiveToken}/${method}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, { method: "POST", body: form, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    const cause = (err && err.cause && err.cause.code) || (err && err.cause && err.cause.message);
    return { sent: false, ok: false, status: 0, networkError: true, networkErrorMessage: redact(cause || (err && err.message) || "fetch failed") };
  }
  clearTimeout(timer);
  let body = null;
  const ct = res.headers.get("content-type") || "";
  try {
    body = ct.includes("json") ? await res.json() : await res.text();
  } catch (err) {
    return { sent: false, ok: false, status: res.status, networkError: true, networkErrorMessage: redact((err && err.message) || "response parse failed") };
  }
  if (body && typeof body === "object" && typeof body.description === "string") {
    body = { ...body, description: redact(body.description) };
  }
  if (!res.ok || !(body && body.ok === true)) {
    return { sent: false, ok: false, status: res.status, networkError: false, error: redact(typeof body === "string" ? body : JSON.stringify(body)).slice(0, 500) };
  }
  return { sent: true, ok: true, status: res.status, result: body.result };
}

// Shared body of sendPhoto / sendDocument; same Markdown-then-plain fallback.
async function sendUpload(method, field, source, caption, { buttons, timeoutMs, baseUrl, filename } = {}) {
  let blob;
  try {
    blob = new Blob([Buffer.isBuffer(source) ? source : await fsp.readFile(String(source))]);
  } catch (err) {
    return { sent: false, ok: false, status: 0, networkError: false, error: redact(`${field} unreadable: ${(err && err.message) || err}`) };
  }
  const name = filename || (typeof source === "string" ? path.basename(source) : `${field}.bin`);
  const cut = truncateCaption(caption);
  const payload = { chat_id: OWNER_CHAT_ID, caption: cut.caption, parse_mode: "Markdown" };
  if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  const first = await tgFetchForm(method, buildUploadForm(field, blob, name, payload), { timeoutMs, baseUrl });
  if (!isMarkdownEntityParseFailure(first)) return { ...first, captionTruncated: cut.truncated };
  console.log(`[telegram-client] ${method} Markdown parse entities failed; retrying without parse_mode`);
  const plain = { ...payload };
  delete plain.parse_mode;
  const second = await tgFetchForm(method, buildUploadForm(field, blob, name, plain), { timeoutMs, baseUrl });
  return { ...second, parseModeFallback: true, captionTruncated: cut.truncated };
}

// Photo (path or Buffer) + Markdown caption + buttons; caption capped at CAPTION_MAX.
export async function sendPhoto(photoPathOrBuffer, caption, opts = {}) {
  return sendUpload("sendPhoto", "photo", photoPathOrBuffer, caption, opts);
}

// Same for an arbitrary file (PDF, SVG, zip): bytes kept as-is.
export async function sendDocument(filePathOrBuffer, caption, opts = {}) {
  return sendUpload("sendDocument", "document", filePathOrBuffer, caption, opts);
}

export async function sendVoice(oggPathOrBuffer, caption = "", opts = {}) {
  const gateResult = caption ? await lexiconGate(String(caption), opts) : null;
  if (gateResult) return gateResult;
  return sendUpload("sendVoice", "voice", oggPathOrBuffer, caption || "", opts);
}

export async function getFile(fileId, { timeoutMs, baseUrl, fetch: customFetch } = {}) {
  return tgFetch("getFile", { file_id: fileId }, { timeoutMs, baseUrl, fetch: customFetch });
}

export async function downloadFile(filePath, destPath, { timeoutMs = 60000, fileBaseUrl = "https://api.telegram.org/file/bot", fetch: customFetch } = {}) {
  const fetchFn = customFetch || fetch;
  const token = getToken();
  if (!token && !customFetch) return { ok: false, sent: false, reason: "TELEGRAM_BOT_TOKEN_AHMAD not set" };
  const effectiveToken = token || "TEST_TOKEN";
  const cleanPath = String(filePath || "").replace(/^\/+/, "");
  const url = `${fileBaseUrl}${effectiveToken}/${cleanPath}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { method: "GET", signal: ctrl.signal });
    if (!res.ok) return { ok: false, status: res.status, error: redact(`HTTP ${res.status} ${res.statusText || ""}`.trim()) };
    const bytes = Buffer.from(await res.arrayBuffer());
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    await fsp.writeFile(destPath, bytes);
    return { ok: true, file: destPath, bytes: bytes.length };
  } catch (err) {
    return { ok: false, status: 0, networkError: true, networkErrorMessage: redact((err && err.message) || "download failed") };
  } finally {
    clearTimeout(timer);
  }
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
        if (body.text === "plain fallback .env* OWNER_REQUIRED") {
          if (body.parse_mode === "Markdown") {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, description: "Bad Request: cant parse entities: Cant find end of the entity starting at byte offset 624" }));
          }
          return res.end(JSON.stringify({ ok: true, result: { message_id: 624, date: 1, chat: { id: 8987077084 }, text: body.text } }));
        }
        if (body.text === "ordinary bad request") {
          res.statusCode = 400;
          return res.end(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }));
        }
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
    assert.equal(received.filter((r) => r.url.endsWith("/sendMessage")).length, 1);
    assert.equal(s.parseModeFallback, undefined);
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

    // (i) Markdown entity parse failure retries exactly once as plain text,
    // preserving the text bytes and all non-parse-mode payload fields.
    received.length = 0;
    const fallbackText = "plain fallback .env* OWNER_REQUIRED";
    const fallbackButtons = [[{ text: "DETAILS", callback_data: "d:KOL-1" }]];
    const sf = await sendMessage(fallbackText, { buttons: fallbackButtons, baseUrl, timeoutMs: 3000 });
    const fallbackCalls = received.filter((r) => r.url.endsWith("/sendMessage"));
    assert.equal(sf.sent, true);
    assert.equal(sf.result.message_id, 624);
    assert.equal(sf.parseModeFallback, true);
    assert.equal(fallbackCalls.length, 2);
    assert.equal(fallbackCalls[0].body.parse_mode, "Markdown");
    assert.equal(fallbackCalls[1].body.parse_mode, undefined);
    assert.equal(Buffer.compare(Buffer.from(fallbackCalls[1].body.text, "utf8"), Buffer.from(fallbackText, "utf8")), 0);
    assert.equal(fallbackCalls[1].body.chat_id, OWNER_CHAT_ID);
    assert.deepEqual(fallbackCalls[1].body.reply_markup, { inline_keyboard: fallbackButtons });
    ok("(i) sendMessage parse-entity 400 retries once without parse_mode and preserves text");

    // (j) Other Telegram 400s do not retry.
    received.length = 0;
    const bad400 = await sendMessage("ordinary bad request", { baseUrl, timeoutMs: 3000 });
    assert.equal(bad400.sent, false);
    assert.equal(bad400.status, 400);
    assert.equal(bad400.parseModeFallback, undefined);
    assert.equal(received.filter((r) => r.url.endsWith("/sendMessage")).length, 1);
    ok("(j) sendMessage non-parse 400 does not retry");
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
