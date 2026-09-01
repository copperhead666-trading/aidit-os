// ops-watcher/telegram-listener.mjs
// Long-polls Telegram for the OWNER's button taps on decision messages sent by
// telegram-notify.mjs, and applies each decision to the canonical Paperclip
// issue. Duplicate-protection: the getUpdates offset is persisted to a local
// state file, so re-running never reprocesses the same update.
//
// This module now exports BOTH:
//   - runListenerOnce(deps)         : the original single --once sweep (unchanged
//                                     contract; still the `--once` CLI entrypoint)
//   - processUpdateForCallback(...) : the per-update processing (parse -> immediate
//                                     ACK (daemon mode) -> applyAction -> edit), so
//                                     the new telegram-listener-daemon.mjs can drive
//                                     a genuine continuous long-poll loop WITHOUT
//                                     duplicating the applyAction logic.
// applyAction is also exported. The daemon and --once share the SAME applyAction
// path (so both get the comment-dedupe fix), differing only in WHEN the
// callback ACK is sent (--once acks after the work; the daemon acks "Processing…"
// FIRST so the OWNER's spinner clears immediately).
//
// callback_data scheme (set by telegram-notify.mjs):
//     "<actionLetter>:<shortId>"
//     "o:<shortId>:<optionIndex>"
//   a = APPROVE, r = REJECT, d = DETAILS, z = DEFER, k = ASK AHMAD, o = OPTION
//   shortId = the issue's Paperclip identifier (e.g. "KOL-9"). The listener
//   maps shortId -> real issue id by listing the company's issues and matching
//   `identifier` (canonical state lives in Paperclip, no local lookup file).
//   OPTION callbacks carry only a 0-based optionIndex; the selected key/label are
//   re-read from the issue's own "[DECISION OPTIONS]" marker comment (NOT
//   issue.metadata -- Paperclip's real issue schema has no metadata field; see
//   telegram-decision-options.mjs's header for the live-verified reason).
//
// Actions:
//   APPROVE  : remove OWNER_REQUIRED label (so the normal automatic test/review
//              flow resumes on its next sweep), post "OWNER MENYETUJUI via Telegram"
//              (owner-facing copy is professional Indonesian; only the callback_data
//              letters and marker-comment prefixes are English/machine-parsed),
//              answer the callback with a toast, edit the original message to drop
//              buttons and show the resolved state (cannot be tapped twice).
//   REJECT   : add OWNER_REJECTED label, set status to "cancelled", post a comment,
//              answer + edit.
//   DETAILS  : NO state change — fetch comments/state and send a NEW follow-up
//              Telegram message with more detail, answer the callback with a toast,
//              leave the original message + buttons untouched.
//   DEFER    : post a comment noting the owner deferred, answer with a toast
//              ("deferred, still pending"), leave OWNER_REQUIRED + original message
//              + buttons exactly as-is (deliberately non-durable, matching legacy
//              "postpone" semantics).
//   ASK AHMAD: add ESCALATED_TO_AHMAD label (so it surfaces via ops-watcher
//              detectors), post a comment, answer + edit.
//   OPTION   : resolve a dynamic multiple-choice card by removing OWNER_REQUIRED
//              and posting "OWNER MEMILIH: <label> via Telegram"; no heartbeat
//              spawn because the chosen option may be informational/contextual.
//
// NOTE: telegram-notify.mjs currently surfaces FOUR buttons on the decision card
// (APPROVE/REJECT/DETAILS/DEFER), or dynamic OPTION buttons when the issue has
// a valid "[DECISION OPTIONS]" marker comment. The "k"/ASK AHMAD action letter
// is supported here in the listener and exercised by tests, but is NOT yet
// rendered on the card — see telegram-notify.mjs buildButtons().
//
// TEXT-MESSAGE INGRESS (two paths):
//   1. Standalone text -> creates a new Paperclip issue tagged DIRECTIVE (no
//      approval loop) and triggers an event-driven wake. The OWNER already
//      decided by sending the directive.
//   2. REPLY to a decision card -> the reply text is captured as a free-text
//      NOTE and posted as a Paperclip comment on the matched issue (so the
//      OWNER can attach a reason/explanation to a decision without a separate
//      UI). The match is made by scanning the company's issues for the
//      "[TELEGRAM SENT] message_id=<id>" marker comment that records which
//      Telegram message we sent for which issue — canonical state stays in
//      Paperclip (no local message_id->issue lookup file). If the reply target
//      is not a known decision card, the message falls through to path 1.
//
// Every state-changing decision is persisted to Paperclip (a label change and/or
// a comment) — Paperclip is canonical, so a human reading only Paperclip sees it.
// The Paperclip comment trail (decision comments + [TELEGRAM SENT] markers +
// failure comments + OWNER NOTE comments) IS the audit ledger of every decision
// (who/what/when/which issue). There is intentionally NO separate structured
// audit log file: a second copy would duplicate canonical state and risk drift.
// If the OWNER later wants a queryable/retention-controlled separate ledger,
// that is a larger design decision (schema/storage/retention) and must be owner-
// approved before being added.
//
// COMMENT-DEDUPE (production-incident fix):
//   When the OWNER rapidly taps the same button multiple times, Telegram
//   delivers multiple callback_query updates for the SAME action on the SAME
//   issue. The underlying canonical PATCH is already idempotent (removing
//   OWNER_REQUIRED twice is harmless; adding OWNER_REJECTED twice is harmless),
//   BUT the confirmation-comment post was NOT idempotent — it produced ~10
//   duplicate "OWNER MENYETUJUI via Telegram" comments on one issue in the live
//   incident. Fix: before posting a decision confirmation comment, check the
//   issue's MOST RECENT comment; if it already starts with the same decision
//   prefix (e.g. "OWNER MENYETUJUI via Telegram") AND is within DEDUPE_WINDOW_MS,
//   skip the duplicate comment post. The canonical action is still applied
//   (idempotent), the callback is still answered every tap (no stuck spinner),
//   and the message is still edited — only the spam comment is suppressed.
//   Window = 60s (covers rapid repeat-tap bursts; an approve-then-reopen-then-
//   approve hours later has a different most-recent comment and is not suppressed).
//
// FAIL-SAFE CONTRACT (post-fix):
//   - The getUpdates offset ALWAYS advances past a returned update (even when
//     handling failed), so a Telegram/Paperclip hiccup never wedges the queue.
//   - BUT a state-changing PATCH that fails (networkError or non-2xx) is NEVER
//     falsely reported as "approved/rejected/escalated". Instead the outcome is
//     "patch-failed", a Paperclip comment records that the owner's decision was
//     RECEIVED but the label/status change FAILED (so the intent is not silently
//     lost), the Telegram message is edited to show "apply failed", and the toast
//     says so. The update is still consumed (offset advances) — we do not retry
//     forever — but the failure is now VISIBLE in both Paperclip and the log,
//     instead of silently swallowed and reported as success.
//   - State-file read/write failures are LOGGED (not silent). A read failure
//     (corrupt file) warns that the offset reset to 0 and recent updates may
//     be reprocessed; a write failure warns that the next run may reprocess these
//     updates (duplicate actions possible). Both used to be silently swallowed.
//
// EVENT-DRIVEN WAKE DI SEAM (spawnHeartbeatReal / _spawnHeartbeat):
//   The "spawn heartbeat --once" call (used on text-ingress and APPROVE paths)
//   is dependency-injected via the _spawnHeartbeat ctx field (defaulting to the
//   exported spawnHeartbeatReal) so the offline regression test suite can inject
//   a no-op fake and run fully offline — matching this file's own stated design
//   intent where literally EVERY other real I/O call is already DI'd. Before
//   this seam, the test suite inadvertently spawned REAL detached
//   `node ops-watcher/heartbeat.mjs --once` child processes against the LIVE
//   Paperclip instance because this one spawn call was not injected.
//
// Messages use parse_mode "Markdown"; free-form content (title, status) is escaped
// via escMd() so values like "in_review" / "OWNER_REQUIRED" do not break parsing.
//
//   node ops-watcher/telegram-listener.mjs --once
//
// Crash-proof: a Telegram or Paperclip network failure never throws; the update
// is skipped (offset still advances so we don't get stuck) and the error logged.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  discoverPaperclipPort,
  httpGet,
  httpPost,
  listLabels,
  ensureLabel,
  postComment,
  patchIssue,
} from "./paperclip-write-client.mjs";
import {
  getUpdates,
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  OWNER_CHAT_ID,
} from "./telegram-client.mjs";
import { parseDecisionOptionsFromComments } from "./telegram-decision-options.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const STATE_FILE = path.join(__dirname, "telegram-listener.state.json");
const SENT_MARKER = "[TELEGRAM SENT]";
// Paperclip's own "Ahmad" agent record — identity-of-record for assignment/
// attribution ONLY (same pattern already used for GIBRAN's real agent id in
// review-runner.mjs). This is NOT the real orchestrator's execution path: its
// runtimeConfig.heartbeat.enabled must stay false forever (see
// config/agent-registry.json hazard_3 — enabling it would spawn a SECOND,
// quota-colliding Claude Code CLI instance under Paperclip's own engine). The
// real wake is the external ops-watcher/ahmad-dispatch.mjs step in
// heartbeat.mjs's pipeline; this id only makes "assigned to AHMAD" visible and
// queryable in Paperclip so no human has to assign it by hand.
export const AHMAD_AGENT_ID = "cdea95bd-b9db-4035-854b-8ea677c1326e";

const ACTION_LETTERS = { a: "APPROVE", r: "REJECT", d: "DETAILS", z: "DEFER", k: "ASK AHMAD", o: "OPTION" };
const LABEL_SPECS = {
  OWNER_REQUIRED: "#b91c1c",
  OWNER_REJECTED: "#7f1d1d",
  ESCALATED_TO_AHMAD: "#9333ea",
};

// Decision confirmation-comment prefixes (the success-path comment for each
// state-changing action). Used by the comment-dedupe check. NOTE: the failure
// comments (postFailureComment) intentionally use a DIFFERENT body (they mention
// "DITERIMA ... GAGAL"), so a prior failure comment does NOT suppress a later
// success comment — only a prior SUCCESS comment does.
// Copy is professional Indonesian (owner-facing); only these string VALUES are
// language, the object KEYS ("APPROVE"/"REJECT"/.../"ASK AHMAD") stay as the
// internal action names used throughout this file's control flow — do not
// translate the keys.
const DECISION_COMMENT_PREFIX = {
  APPROVE: "OWNER MENYETUJUI via Telegram",
  REJECT: "OWNER MENOLAK via Telegram",
  DEFER: "OWNER MENUNDA via Telegram",
  "ASK AHMAD": "OWNER MENGESKALASI ke AHMAD via Telegram",
};
// Suppress a duplicate confirmation comment if the issue's MOST RECENT comment
// already starts with the same decision prefix AND was posted within this window.
// 60s comfortably covers a rapid repeat-tap burst (the production incident saw
// 10 taps in a few seconds) while not suppressing a genuinely new decision hours
// later (whose most-recent comment would be something else by then).
const DEDUPE_WINDOW_MS = 60_000;

const iso = () => new Date().toISOString();


// ---- Event-driven wake: spawn heartbeat --once (DI seam) ----
// The REAL implementation: spawns a detached `node ops-watcher/heartbeat.mjs
// --once` child process. Exported so the regression test suite (and the daemon)
// can inject a no-op fake for fully offline testing — matching this file's own
// stated design intent where every other real I/O call is already DI'd. Before
// this seam the test suite inadvertently spawned REAL heartbeat child processes
// against the live Paperclip instance.
export function spawnHeartbeatReal({ _spawn = spawn, execPath = process.execPath, cwd } = {}) {
  const child = _spawn(execPath, ["ops-watcher/heartbeat.mjs", "--once"], {
    cwd: cwd || path.resolve(__dirname, ".."),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid };
}

function hasRecentInProcessDecision(decisionDedupe, key, nowMs, windowMs) {
  if (!decisionDedupe || !key) return false;
  for (const [k, seenAt] of decisionDedupe.entries()) {
    if ((nowMs - seenAt) > windowMs) decisionDedupe.delete(k);
  }
  const prev = decisionDedupe.get(key);
  decisionDedupe.set(key, nowMs);
  return Number.isFinite(prev) && (nowMs - prev) <= windowMs;
}

// HTTP status considered a successful state-changing PATCH. 2xx only.
function okStatus(s) {
  return Number.isFinite(s) && s >= 200 && s < 300;
}

// ---- State-file persistence (now non-silent; injectable for tests) ----
// defaultReadState returns { ok, value?, code?, message? }. ok=false with
// code "ENOENT" means the file simply does not exist yet (first run) — caller
// treats that as offset 0 with no warning. Any OTHER read failure (corrupt
// JSON, permission error) is surfaced so the caller can WARN that the offset
// is being reset to 0 and recent updates may be reprocessed.
export async function defaultReadState(file) {
  try {
    return { ok: true, value: JSON.parse(await fs.readFile(file, "utf8")) };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}
// defaultWriteState returns { ok, code?, message? }. A failure here means the
// offset was NOT persisted, so the next run will reprocess the same updates
// (duplicate actions possible) — caller must WARN so this is never silent.
export async function defaultWriteState(file, obj) {
  try {
    await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err && err.code, message: err && err.message };
  }
}

// Escape Telegram legacy-Markdown special characters in free-form content that
// appears OUTSIDE code spans (inside `code spans` Markdown does not parse
// specials, so shortId in backticks is left alone). Escapes: \ * _ ` [.
export function escMd(s) {
  return String(s == null ? "" : s).replace(/([\\*_`\[])/g, "\\$1");
}

// Parse "a:KOL-9" -> { action: "APPROVE", actionLetter: "a", shortId: "KOL-9" }
// Parse "o:KOL-9:1" -> { action: "OPTION", actionLetter: "o", shortId: "KOL-9", optionIndex: 1 }
export function parseCallbackData(data) {
  const s = String(data || "");
  const idx = s.indexOf(":");
  if (idx < 0) return null;
  const letter = s.slice(0, idx);
  const shortId = s.slice(idx + 1);
  const action = ACTION_LETTERS[letter];
  if (action === "OPTION") {
    const parts = shortId.split(":");
    if (parts.length !== 2 || !parts[0] || !/^\d+$/.test(parts[1])) return null;
    return { actionLetter: letter, action, shortId: parts[0], optionIndex: Number(parts[1]) };
  }
  if (!action || !shortId) return null;
  return { actionLetter: letter, action, shortId };
}

// Build a map identifier -> issue for the company (fresh each call).
export async function buildIdentifierMap(base, companyId, _get) {
  const res = await _get(`${base}/api/companies/${companyId}/issues`);
  if (res.networkError) return { map: {}, networkError: true, networkErrorMessage: res.networkErrorMessage };
  const issues = Array.isArray(res.body) ? res.body : [];
  const map = {};
  for (const it of issues) if (it.identifier) map[String(it.identifier)] = it;
  return { map, networkError: false };
}

// Ensure the labels this listener may add/remove exist. Returns { name -> id }.
// Exported so the daemon can build the same label map without duplicating logic.
export async function ensureLabelMap(base, companyId, _ensureLabel) {
  const labelMap = {};
  for (const [name, color] of Object.entries(LABEL_SPECS)) {
    const r = await _ensureLabel(base, companyId, name, color);
    if (r.id) labelMap[name] = r.id;
  }
  return labelMap;
}

// Find the Paperclip issue whose "[TELEGRAM SENT] message_id=<id>" marker
// comment records the given Telegram message_id (the decision card we sent).
// Scans the company's issues + comments — canonical state lives in Paperclip,
// no local message_id->issue lookup file (same "no local lookup" pattern as
// buildIdentifierMap). Used to attach an OWNER's reply-to-decision-card text
// as a NOTE on the right issue. Returns the issue object or null. Never
// throws; on any network/parse error returns null (caller falls through to
// the directive-creation path, which is safe — the OWNER's text is not lost:
// it becomes a DIRECTIVE issue).
export async function findIssueByTelegramMessageId(base, companyId, _get, telegramMessageId) {
  if (!telegramMessageId && telegramMessageId !== 0) return null;
  const target = Number(telegramMessageId);
  if (!Number.isFinite(target)) return null;
  let issuesRes;
  try {
    issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
  } catch {
    return null;
  }
  if (!issuesRes || issuesRes.networkError || !Array.isArray(issuesRes.body)) return null;
  for (const it of issuesRes.body) {
    if (!it || !it.id) continue;
    let cRes;
    try {
      cRes = await _get(`${base}/api/issues/${it.id}/comments`);
    } catch {
      continue;
    }
    if (!cRes || cRes.networkError || !Array.isArray(cRes.body)) continue;
    const marker = cRes.body.find((c) =>
      String((c && c.body) || "").trim().startsWith(SENT_MARKER));
    if (!marker) continue;
    const m = String(marker.body || "").match(/message_id=(\d+)/);
    if (m && Number(m[1]) === target) return it;
  }
  return null;
}

function redactCb(s) { return String(s || "").slice(0, 64); }

// Re-fetch a fresh copy of the issue (so labelIds are current before we mutate).
async function freshIssue(base, issueId, _get) {
  const r = await _get(`${base}/api/issues/${issueId}`);
  if (r.networkError || !r.body) return null;
  return r.body;
}

// Post a comment describing a FAILED state change so the owner's received
// decision is recorded in Paperclip rather than silently lost. Never throws;
// returns the postComment result so the caller can log if even THIS failed.
async function postFailureComment(_postComment, base, issueId, shortId, action, failDesc) {
  const body =
    `OWNER ${action} via Telegram (${iso()}) — ketukan tombol oleh owner via @ahmadsuperbot DITERIMA, ` +
    `tetapi penerapan perubahan status di Paperclip GAGAL (${failDesc}). ` +
    `Perlu perbaikan manual untuk ${shortId}; update Telegram ini sudah diproses dan tidak akan dicoba ulang otomatis.`;
  return _postComment(base, issueId, body, { authorType: "user" });
}

// Comment-dedupe check (production-incident fix). Returns true if the issue's
// MOST RECENT comment already starts with the given decision prefix (same
// decision already recorded) AND is within windowMs. Never throws; on any fetch
// error returns false (safe: the canonical idempotent PATCH still applies; we
// just don't suppress a possibly-duplicate comment when we can't tell).
export async function hasRecentDecisionComment(_get, base, issueId, prefix, windowMs, nowFn) {
  if (!prefix) return false;
  let r;
  try {
    r = await _get(`${base}/api/issues/${issueId}/comments`);
  } catch {
    return false;
  }
  if (r.networkError || !Array.isArray(r.body) || r.body.length === 0) return false;

  // Do not assume Paperclip returns comments oldest-first. The live repeat-tap
  // failure showed that a "most recent is last" assumption is too weak: scan all
  // matching decision comments and apply the time window to each timestamp.
  // Missing timestamps are treated as duplicate only for a same-prefix comment
  // adjacent to either edge of the returned list, which preserves the old mock
  // behavior without letting one ancient undated comment suppress forever.
  const nowMs = nowFn();
  for (let i = 0; i < r.body.length; i += 1) {
    const c = r.body[i];
    const body = String((c && c.body) || "");
    if (!body.startsWith(prefix)) continue;
    const createdRaw = c.createdAt || c.created_at || c.timestamp;
    const created = createdRaw ? Date.parse(createdRaw) : NaN;
    if (Number.isFinite(created)) {
      if ((nowMs - created) <= windowMs) return true;
      continue;
    }
    if (i === 0 || i === r.body.length - 1) return true;
  }
  return false;
}

// Per-update processing, shared by --once (immediateAck=false) and the daemon
// (immediateAck=true). When immediateAck is true the callback is answered with
// "Processing…" BEFORE any Paperclip work so the OWNER's spinner clears fast;
// applyAction then runs with preAcked=true (its internal toasts become no-ops
// since a callback_query can only be answered once) and editMessageText shows
// the final outcome. When immediateAck is false, applyAction answers the
// callback itself after the work (original --once behaviour, preserved exactly).
//
// ctx fields:
//   base, companyId, labelMap, idMap, upOpts, immediateAck,
//   _get, _listLabels, _ensureLabel, _postComment, _patchIssue,
//   _answerCallbackQuery, _editMessageText, _sendMessage,
//   _httpPost = httpPost,
//   _spawnHeartbeat (DI seam for the event-driven wake spawn; defaults to the
//                   real spawnHeartbeatReal — the regression tests inject a no-op
//                   fake so the test suite is fully offline),
//   log, now=Date.now, dedupeWindowMs=DEDUPE_WINDOW_MS
export async function processUpdateForCallback(upd, ctx) {
  const {
    base, companyId, labelMap, idMap, upOpts, immediateAck,
    _get, _listLabels, _ensureLabel, _postComment, _patchIssue,
    _answerCallbackQuery, _editMessageText, _sendMessage,
    _httpPost = httpPost,
    _spawnHeartbeat = spawnHeartbeatReal,
    log, now = Date.now, dedupeWindowMs = DEDUPE_WINDOW_MS,
    decisionDedupe = null,
  } = ctx;

  const uid = upd.update_id;
  const cq = upd.callback_query;
  const sendOwnerMessage = (text) => _sendMessage(text, upOpts).catch(() => {});

  // ---- Text-message ingress: OWNER sent a plain text message (not a button tap) ----
  // Two sub-paths:
  //   (A) a REPLY to a decision-card message -> attach the reply text as a NOTE
  //       (Paperclip comment) on the matched issue; no new issue, no wake.
  //   (B) a STANDALONE text -> create a Paperclip issue tagged DIRECTIVE (no
  //       approval loop) and wake the heartbeat pipeline so telegram-notify
  //       later sends the OWNER a decision message with buttons.
  // (A) falls through to (B) if the reply target is not a known decision card.
  if (!cq && upd.message && upd.message.text) {
    const msgText = String(upd.message.text || "").trim();
    if (!msgText) {
      log(`telegram-listener: update ${uid} has empty text — skipping`);
      return { update_id: uid, outcome: "empty-text-skipped" };
    }
    // Only process messages from the OWNER (not from group chats or random users).
    // The bot only has the OWNER as a contact, but guard anyway.
    const chatId = String(upd.message.chat && upd.message.chat.id || "");
    if (chatId !== OWNER_CHAT_ID) {
      log(`telegram-listener: update ${uid} text from non-owner chat_id=${chatId} — skipping`);
      return { update_id: uid, outcome: "non-owner-text-skipped" };
    }

    // ---- Sub-path (A): reply-to-decision-card note capture ----
    // If the OWNER replied to a decision-card message, attach the reply text as
    // a free-text NOTE on the matched issue (so the OWNER can attach a
    // reason/explanation to a decision without a separate UI). Match is made by
    // scanning Paperclip for the [TELEGRAM SENT] marker whose message_id equals
    // the replied-to message_id. If no match, fall through to sub-path (B).
    const replyTo = upd.message.reply_to_message;
    if (replyTo && (replyTo.message_id || replyTo.message_id === 0)) {
      let targetIssue = null;
      try {
        targetIssue = await findIssueByTelegramMessageId(base, companyId, _get, replyTo.message_id);
      } catch (e) {
        log(`telegram-listener: update ${uid} note-match scan threw (suppressed): ${e && e.message} — falling through to directive`);
      }
      if (targetIssue) {
        const targetLabel = targetIssue.identifier || targetIssue.id;
        const noteBody =
          `OWNER NOTE via Telegram reply (${iso()}) — @ahmadsuperbot reply by owner to decision card for ${targetLabel}:\n${msgText}`;
        let nc = null;
        try {
          nc = await _postComment(base, targetIssue.id, noteBody, { authorType: "user" });
        } catch (e) {
          log(`telegram-listener: update ${uid} reply-note post threw (suppressed): ${e && e.message}`);
          nc = { networkError: true, networkErrorMessage: String(e && e.message) };
        }
        if (!nc || nc.networkError) {
          log(`telegram-listener: update ${uid} reply-note post FAILED for ${targetLabel} — not creating a directive; owner may retry`);
          await _sendMessage(`Could not attach your note to ${targetLabel} — please retry.`, upOpts).catch(() => {});
          return { update_id: uid, outcome: "reply-note-failed", issueId: targetIssue.id, identifier: targetIssue.identifier, networkError: true };
        }
        log(`telegram-listener: update ${uid} OWNER reply-note attached to ${targetLabel}`);
        const ackText = `Note attached to ${targetLabel}: "${msgText.slice(0, 60)}${msgText.length > 60 ? "\u2026" : ""}"`;
        await _sendMessage(ackText, upOpts).catch(() => {});
        return { update_id: uid, outcome: "reply-note-attached", issueId: targetIssue.id, identifier: targetIssue.identifier };
      }
      log(`telegram-listener: update ${uid} reply_to_message=${replyTo.message_id} did not match a known decision card — treating as directive`);
    }

    // ---- Sub-path (B): standalone text -> create a DIRECTIVE issue ----
    log(`telegram-listener: update ${uid} OWNER text message (${msgText.length} chars) — creating Paperclip issue`);
    try {
      const issueRes = await _httpPost(
        `${base}/api/companies/${companyId}/issues`,
        { title: `OWNER DIRECTIVE: ${msgText.slice(0, 80)}`, description: msgText },
      );
      if (issueRes.networkError) {
        log(`telegram-listener: update ${uid} createIssue network error: ${issueRes.networkErrorMessage}`);
        return { update_id: uid, outcome: "create-issue-network-error" };
      }
      if (issueRes.status >= 400 || !issueRes.body || !issueRes.body.id) {
        log(`telegram-listener: update ${uid} createIssue failed status=${issueRes.status}`);
        return { update_id: uid, outcome: "create-issue-failed" };
      }
      // P2: OWNER's own directive does NOT get OWNER_REQUIRED — the OWNER already
      // decided by sending the directive. OWNER_REQUIRED is reserved for decisions
      // Ahmad needs back from the OWNER. Instead, tag it with a DIRECTIVE label
      // and set status to "todo" so the pipeline picks it up for execution.
      const labels = [];
      const ownerId = labelMap && labelMap["OWNER_REQUIRED"];
      // Ensure DIRECTIVE label exists and tag the issue
      let directiveLabelId = labelMap && labelMap["DIRECTIVE"];
      if (!directiveLabelId) {
        const dr = await _ensureLabel(base, companyId, "DIRECTIVE", "#3b82f6").catch(() => null);
        if (dr && dr.id) directiveLabelId = dr.id;
      }
      if (directiveLabelId) labels.push(directiveLabelId);
      // P0 canonical auto-assign: every DIRECTIVE issue is assigned to AHMAD at
      // creation time — no human ever has to open Paperclip and assign it by
      // hand (see AHMAD_AGENT_ID doc comment above for what this id is/is not).
      const assignPatch = { status: "todo", assigneeAgentId: AHMAD_AGENT_ID };
      if (labels.length > 0) assignPatch.labelIds = labels;
      await _patchIssue(base, issueRes.body.id, assignPatch, upOpts).catch(() => {});
      log(`telegram-listener: update ${uid} created issue ${issueRes.body.identifier || issueRes.body.id} — DIRECTIVE, auto-assigned to AHMAD (${AHMAD_AGENT_ID})`);

      // ---- Immediate ACK to OWNER (<5s target) ----
      // Send a receipt confirmation so the OWNER knows the message was received
      // without waiting for the heartbeat -> telegram-notify cycle (which can take
      // up to 5 minutes). This is a fire-and-forget; failure is logged but never
      // blocks the ingress path.
      const ackText = `Received: "${msgText.slice(0, 60)}${msgText.length > 60 ? "\u2026" : ""}"\nCreated ${issueRes.body.identifier || "issue"} — executing.`;
      await _sendMessage(ackText, upOpts).catch(() => {});
      log(`telegram-listener: update ${uid} ACK sent to OWNER`);

      // ---- Event-driven wake: spawn heartbeat --once immediately ----
      // Trigger the pipeline directly — no approval loop for OWNER's own directive.
      // Uses the DI seam (_spawnHeartbeat) so offline tests inject a no-op fake
      // instead of spawning a REAL detached node child process against live Paperclip.
      try {
        const r = _spawnHeartbeat();
        log(`telegram-listener: update ${uid} spawned heartbeat --once (pid=${r && r.pid})`);
      } catch (e) {
        log(`telegram-listener: update ${uid} heartbeat spawn failed (non-fatal): ${e && e.message}`);
      }

      return { update_id: uid, outcome: "text-ingressed", issueId: issueRes.body.id, identifier: issueRes.body.identifier };
    } catch (err) {
      log(`telegram-listener: update ${uid} text ingress threw (suppressed): ${err && err.message}`);
      return { update_id: uid, outcome: "text-ingress-error", error: String(err && err.message) };
    }
  }

  if (!cq) {
    log(`telegram-listener: update ${uid} has no callback_query and no text — skipping`);
    return { update_id: uid, outcome: "non-callback-skipped" };
  }
  const parsed = parseCallbackData(cq.data);
  if (!parsed) {
    log(`telegram-listener: update ${uid} unparseable callback_data="${redactCb(cq.data)}" — answering + skipping`);
    await _answerCallbackQuery(cq.id, "aksi tidak terbaca", upOpts).catch(() => {});
    return { update_id: uid, outcome: "unparseable" };
  }
  const issue = idMap[parsed.shortId];
  if (!issue) {
    log(`telegram-listener: update ${uid} ${parsed.action} shortId=${parsed.shortId} — no matching Paperclip issue; answering + skipping`);
    await _answerCallbackQuery(cq.id, "issue tidak ditemukan", upOpts).catch(() => {});
    return { update_id: uid, outcome: "issue-not-found", action: parsed.action, shortId: parsed.shortId };
  }

  // IMMEDIATE ACK (daemon mode): clear the spinner before any Paperclip work.
  if (immediateAck) {
    await _answerCallbackQuery(cq.id, "Memproses…", upOpts).catch(() => {});
  }

  try {
    const r = await applyAction({
      base, companyId, issue, parsed, cq, upOpts, labelMap,
      _get, _listLabels, _ensureLabel, _postComment, _patchIssue,
      _answerCallbackQuery, _editMessageText, _sendMessage,
      _spawnHeartbeat,
      log,
      preAcked: !!immediateAck, now, dedupeWindowMs, decisionDedupe,
    });
    return { update_id: uid, identifier: parsed.shortId, action: parsed.action, outcome: r.outcome };
  } catch (err) {
    // Never let one update's handler crash the whole sweep.
    log(`telegram-listener: update ${uid} ${parsed.action} ${parsed.shortId} handler threw: ${err && err.message}`);
    if (!immediateAck) {
      await _answerCallbackQuery(cq.id, "terjadi kesalahan internal", upOpts).catch(() => {});
    }
    return { update_id: uid, identifier: parsed.shortId, action: parsed.action, outcome: "handler-error", error: String(err && err.message) };
  }
}

// Core, dependency-injected for testability.
// deps: { base, companyId, telegramBase, stateFile,
//         httpGet, listLabels, ensureLabel, postComment, patchIssue,
//         getUpdates, answerCallbackQuery, editMessageText, sendMessage,
//         readState, writeState, log, _spawnHeartbeat }
export async function runListenerOnce(deps) {
  const {
    base,
    companyId = COMPANY_ID,
    telegramBase,
    stateFile = STATE_FILE,
    httpGet: _get = httpGet,
    listLabels: _listLabels = listLabels,
    ensureLabel: _ensureLabel = ensureLabel,
    postComment: _postComment = postComment,
    patchIssue: _patchIssue = patchIssue,
    getUpdates: _getUpdates = getUpdates,
    answerCallbackQuery: _answerCallbackQuery = answerCallbackQuery,
    editMessageText: _editMessageText = editMessageText,
    sendMessage: _sendMessage = sendMessage,
    readState: _readState = defaultReadState,
    writeState: _writeState = defaultWriteState,
    _spawnHeartbeat = spawnHeartbeatReal,
    log = (m) => console.log(m),
  } = deps;

  const results = [];
  if (!base) {
    log("telegram-listener: no Paperclip base resolved (instance not running)");
    return { results, error: "no-base" };
  }

  // Load persisted offset (non-silent: a corrupt/unreadable file is warned).
  const sr = await _readState(stateFile);
  let offset = 0;
  let stateReadReset = false;
  if (sr.ok && sr.value && Number.isFinite(sr.value.offset)) {
    offset = sr.value.offset;
  } else if (!sr.ok && sr.code !== "ENOENT") {
    // ENOENT is the normal first-run case (no file yet). Anything else is a
    // real read problem — warn loudly because we are resetting to 0, which
    // can reprocess (and thus duplicate) any updates still in Telegram's queue.
    stateReadReset = true;
    log(`telegram-listener: WARN state file read failed (code=${sr.code || "?"}, msg=${String(sr.message || "").slice(0, 120)}) — resetting offset to 0; recent updates may be REPROCESSED (duplicate actions possible)`);
  }
  log(`telegram-listener: polling getUpdates with offset=${offset}${stateReadReset ? " (reset due to state read failure)" : ""}`);

  const upOpts = {};
  if (telegramBase) upOpts.baseUrl = telegramBase;
  // Keep long-poll short for a single --once sweep so it returns promptly.
  upOpts.timeoutMs = 8000;
  const up = await _getUpdates(offset, upOpts);
  if (!up.ok) {
    const why = up.networkError
      ? `network error: ${up.networkErrorMessage}`
      : up.reason || `Telegram API status ${up.status}`;
    log(`telegram-listener: getUpdates failed (${why})`);
    return { results, error: up.reason ? "no-token" : "getupdates-failed", reason: why };
  }
  const updates = up.updates || [];
  log(`telegram-listener: ${updates.length} update(s) returned`);

  if (updates.length === 0) {
    return { results };
  }

  // Ensure labels we may need to add exist (idempotent).
  const labelMap = await ensureLabelMap(base, companyId, _ensureLabel);

  // Build identifier -> issue map once.
  const mapResult = await buildIdentifierMap(base, companyId, _get);
  if (mapResult.networkError) {
    log(`telegram-listener: identifier map build network error: ${mapResult.networkErrorMessage} — skipping updates this sweep`);
    return { results, error: "map-network" };
  }
  const idMap = mapResult.map;

  const decisionDedupe = new Map();
  let maxUpdateId = offset;
  for (const upd of updates) {
    const uid = upd.update_id;
    if (Number.isFinite(uid) && uid > maxUpdateId) maxUpdateId = uid;
    const r = await processUpdateForCallback(upd, {
      base, companyId, labelMap, idMap, upOpts, immediateAck: false,
      _get, _listLabels, _ensureLabel, _postComment, _patchIssue,
      _answerCallbackQuery, _editMessageText, _sendMessage,
      _spawnHeartbeat, log, decisionDedupe,
    });
    results.push(r);
  }

  // Persist the advanced offset so a re-run never reprocesses the same updates.
  // Non-silent: if the write fails, the next run WILL reprocess these updates
  // (duplicate actions possible) — we surface that as an error in the result.
  const nextOffset = maxUpdateId + 1;
  const wr = await _writeState(stateFile, { offset: nextOffset, updatedAt: iso() });
  if (wr.ok) {
    log(`telegram-listener: persisted offset=${nextOffset}`);
  } else {
    log(`telegram-listener: ERROR persisting offset=${nextOffset} FAILED (code=${wr.code || "?"}, msg=${String(wr.message || "").slice(0, 120)}) — next run may REPROCESS these updates (duplicate actions possible)`);
  }

  return { results, advancedOffset: nextOffset, persistError: wr.ok ? false : (wr.code || wr.message || "write-failed") };
}

export async function applyAction(ctx) {
  const {
    base, issue, parsed, cq, upOpts, labelMap, _get, _postComment, _patchIssue,
    _answerCallbackQuery, _editMessageText, _sendMessage,
    _spawnHeartbeat = spawnHeartbeatReal,
    log,
    preAcked = false, now = Date.now, dedupeWindowMs = DEDUPE_WINDOW_MS,
    decisionDedupe = null,
  } = ctx;
  const { action, shortId } = parsed;
  const issueId = issue.id;
  const decisionKey = `${issueId}:${action}`;
  const messageId = cq.message && cq.message.message_id;
  // When preAcked (daemon mode), the callback was already answered with
  // "Processing…" before this function was called; a callback_query can only be
  // answered ONCE, so internal toasts become no-ops (the final outcome is shown
  // via editMessageText instead). When not preAcked (--once), the toast is the
  // real per-outcome answerCallbackQuery (original behaviour, preserved).
  const toast = (text) =>
    preAcked
      ? Promise.resolve({ sent: false, reason: "pre-acked" })
      : _answerCallbackQuery(cq.id, text, upOpts).catch(() => {});
  const edit = (text, { removeButtons = false, buttons: keepButtons = null } = {}) => {
    if (messageId == null) return Promise.resolve({ sent: false, reason: "no-message" });
    const opts = { ...upOpts };
    if (removeButtons) opts.removeKeyboard = true;
    else if (keepButtons) opts.buttons = keepButtons;
    return _editMessageText(messageId, text, opts).catch(() => ({ sent: false }));
  };

  if (action === "APPROVE") {
    const fresh = await freshIssue(base, issueId, _get);
    if (!fresh) { await toast("gagal memuat issue"); return { outcome: "load-failed" }; }
    const cur = Array.isArray(fresh.labelIds) ? fresh.labelIds.slice() : [];
    const next = new Set(cur);
    if (labelMap.OWNER_REQUIRED) next.delete(labelMap.OWNER_REQUIRED);
    const p = await _patchIssue(base, issueId, { labelIds: [...next] });
    if (p.networkError || !okStatus(p.status)) {
      const failDesc = p.networkError ? `Paperclip network error (${p.networkErrorMessage || "?"})` : `Paperclip HTTP ${p.status}`;
      log(`telegram-listener: ${shortId} APPROVE PATCH FAILED (${failDesc}) — recording received decision, NOT claiming success; offset will still advance`);
      const fc = await postFailureComment(_postComment, base, issueId, shortId, "MENYETUJUI", failDesc);
      if (fc && fc.networkError) log(`telegram-listener: ${shortId} APPROVE failure-comment ALSO failed to post (network error) — owner decision is NOT recorded in Paperclip; investigate manually`);
      await toast("\u26A0\uFE0F Disetujui tapi gagal diterapkan");
      await edit(`\u26A0\uFE0F DISETUJUI (gagal diterapkan)\n${escMd(fresh.title || "(tanpa judul)")}\nPerlu perbaikan manual.`, { removeButtons: true });
      return { outcome: "patch-failed", networkError: !!p.networkError, status: p.status };
    }
    log(`telegram-listener: ${shortId} APPROVE -> removed OWNER_REQUIRED (PATCH ${p.status})`);
    // Comment-dedupe: skip a duplicate confirmation comment if this process has
    // already handled the same decision in the window, or Paperclip already has
    // a recent matching decision comment.
    const dup = hasRecentInProcessDecision(decisionDedupe, decisionKey, now(), dedupeWindowMs) ||
      await hasRecentDecisionComment(_get, base, issueId, DECISION_COMMENT_PREFIX.APPROVE, dedupeWindowMs, now);
    if (dup) {
      log(`telegram-listener: ${shortId} APPROVE — duplicate confirmation comment suppressed (recent identical decision already recorded)`);
    } else {
      const cm = await _postComment(base, issueId,
        `OWNER MENYETUJUI via Telegram (${iso()}) — ketukan tombol oleh owner via @ahmadsuperbot. Label OWNER_REQUIRED dihapus sehingga alur otomatis dapat dilanjutkan.`,
        { authorType: "user" });
      if (cm && cm.networkError) log(`telegram-listener: ${shortId} APPROVE label WAS removed but the confirmation comment FAILED to post (network error)`);
    }
    await toast("\u2705 Disetujui");
    await edit(`\u2705 DISETUJUI\n${escMd(fresh.title || "(tanpa judul)")}\nSedang dieksekusi`, { removeButtons: true });

    // ---- Event-driven wake: spawn heartbeat --once immediately ----
    // Uses the DI seam (_spawnHeartbeat) so offline tests inject a no-op fake
    // instead of spawning a REAL detached node child process against live Paperclip.
    try {
      const r = _spawnHeartbeat();
      log(`telegram-listener: ${shortId} APPROVE -> spawned heartbeat --once (pid=${r && r.pid})`);
    } catch (e) {
      log(`telegram-listener: ${shortId} heartbeat spawn failed (non-fatal): ${e && e.message}`);
    }

    return { outcome: "approved" };
  }

  if (action === "REJECT") {
    const fresh = await freshIssue(base, issueId, _get);
    if (!fresh) { await toast("gagal memuat issue"); return { outcome: "load-failed" }; }
    const cur = Array.isArray(fresh.labelIds) ? fresh.labelIds.slice() : [];
    const next = new Set(cur);
    if (labelMap.OWNER_REQUIRED) next.delete(labelMap.OWNER_REQUIRED);
    if (labelMap.OWNER_REJECTED) next.add(labelMap.OWNER_REJECTED);
    // "cancelled" is a real accepted status on this Paperclip instance (verified live).
    const p = await _patchIssue(base, issueId, { status: "cancelled", labelIds: [...next] });
    if (p.networkError || !okStatus(p.status)) {
      const failDesc = p.networkError ? `Paperclip network error (${p.networkErrorMessage || "?"})` : `Paperclip HTTP ${p.status}`;
      log(`telegram-listener: ${shortId} REJECT PATCH FAILED (${failDesc}) — recording received decision, NOT claiming success; offset will still advance`);
      const fc = await postFailureComment(_postComment, base, issueId, shortId, "MENOLAK", failDesc);
      if (fc && fc.networkError) log(`telegram-listener: ${shortId} REJECT failure-comment ALSO failed to post (network error) — investigate manually`);
      await toast("\u26A0\uFE0F Ditolak tapi gagal diterapkan");
      await edit(`\u26A0\uFE0F DITOLAK (gagal diterapkan)\n${escMd(fresh.title || "(tanpa judul)")}\nPerlu perbaikan manual.`, { removeButtons: true });
      return { outcome: "patch-failed", networkError: !!p.networkError, status: p.status };
    }
    log(`telegram-listener: ${shortId} REJECT -> status=cancelled + OWNER_REJECTED (PATCH ${p.status})`);
    const dup = hasRecentInProcessDecision(decisionDedupe, decisionKey, now(), dedupeWindowMs) ||
      await hasRecentDecisionComment(_get, base, issueId, DECISION_COMMENT_PREFIX.REJECT, dedupeWindowMs, now);
    if (dup) {
      log(`telegram-listener: ${shortId} REJECT — duplicate confirmation comment suppressed (recent identical decision already recorded)`);
    } else {
      const cm = await _postComment(base, issueId,
        `OWNER MENOLAK via Telegram (${iso()}) — ketukan tombol oleh owner via @ahmadsuperbot. Status diubah menjadi cancelled; label OWNER_REJECTED ditambahkan.`,
        { authorType: "user" });
      if (cm && cm.networkError) log(`telegram-listener: ${shortId} REJECT state WAS changed but the confirmation comment FAILED to post (network error)`);
    }
    await toast("\U0001F6AB Ditolak");
    await edit(`\U0001F6AB DITOLAK\n${escMd(fresh.title || "(tanpa judul)")}\nDibatalkan`, { removeButtons: true });
    return { outcome: "rejected" };
  }

  if (action === "DETAILS") {
    // No state change; send a follow-up message with more detail.
    const cRes = await _get(`${base}/api/issues/${issueId}/comments`);
    const comments = Array.isArray(cRes.body) ? cRes.body : [];
    const recent = comments.slice(-4).map((c) =>
      `• ${escMd(c.authorType || "?")}${c.authorAgentId ? "(agent)" : ""}: ${escMd(String(c.body || "").split("\n")[0].slice(0, 120))}`)
      .join("\n") || "(tidak ada komentar)";
    const fresh = await freshIssue(base, issueId, _get);
    const status = fresh ? fresh.status : issue.status;
    const title = fresh ? fresh.title : issue.title;
    const labelIds = (fresh ? fresh.labelIds : issue.labelIds) || [];
    const detail = [
      `*Detail* \`${shortId}\``,
      "",
      `*Judul:* ${escMd(title || "(tanpa judul)")}`,
      `*Status:* ${escMd(status)}`,
      `*Label:* ${escMd(labelIds.join(", "))}`,
      "",
      `*Komentar terbaru (${comments.length}):*`,
      recent,
    ].join("\n");
    await _sendMessage(detail, { ...upOpts }).catch(() => ({ sent: false }));
    log(`telegram-listener: ${shortId} DETAILS -> sent follow-up message (${comments.length} comments)`);
    await toast("📋 detail terkirim");
    // Intentionally do NOT edit or change Paperclip state.
    return { outcome: "details-sent" };
  }

  if (action === "DEFER") {
    // Deliberately non-durable: only a comment. Label + buttons stay.
    const dup = hasRecentInProcessDecision(decisionDedupe, decisionKey, now(), dedupeWindowMs) ||
      await hasRecentDecisionComment(_get, base, issueId, DECISION_COMMENT_PREFIX.DEFER, dedupeWindowMs, now);
    if (dup) {
      log(`telegram-listener: ${shortId} DEFER — duplicate confirmation comment suppressed (recent identical decision already recorded)`);
      await toast("⏸ ditunda — masih menunggu");
      return { outcome: "deferred", deduped: true };
    }
    const cm = await _postComment(base, issueId,
      `OWNER MENUNDA via Telegram (${iso()}) — ketukan tombol oleh owner via @ahmadsuperbot. Tidak ada perubahan status; issue tetap OWNER_REQUIRED dan menunggu keputusan.`,
      { authorType: "user" });
    if (cm && cm.networkError) {
      log(`telegram-listener: ${shortId} DEFER comment FAILED to post (network error) — nothing was recorded`);
      await toast("⚠️ gagal menunda");
      return { outcome: "comment-failed", networkError: true };
    }
    log(`telegram-listener: ${shortId} DEFER -> posted defer comment, no state change`);
    await toast("\u23F8 Ditunda");
    // Edit to show deferred state, keep APPROVE/REJECT/DETAILS (remove DEFER only)
    await edit(`\u23F8 DITUNDA\n${escMd(issue.title || "(tanpa judul)")}\nMasih menunggu keputusan Anda.`, {
      buttons: [
        [{ text: "SETUJUI", callback_data: `a:${shortId}` }],
        [{ text: "TOLAK", callback_data: `r:${shortId}` }],
        [{ text: "DETAIL", callback_data: `d:${shortId}` }],
      ],
    });
    return { outcome: "deferred" };
  }

  if (action === "OPTION") {
    const fresh = await freshIssue(base, issueId, _get);
    if (!fresh) { await toast("gagal memuat issue"); return { outcome: "load-failed" }; }
    const freshCommentsRes = await _get(`${base}/api/issues/${issueId}/comments`);
    const freshComments = Array.isArray(freshCommentsRes.body) ? freshCommentsRes.body : [];
    const validated = parseDecisionOptionsFromComments(freshComments);
    const optionIndex = parsed.optionIndex;
    if (!validated.ok || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= validated.options.length) {
      log(`telegram-listener: ${shortId} OPTION index=${optionIndex} invalid for current decision-options comment (${validated.ok ? `available=${validated.options.length}` : validated.reason}) — no Paperclip mutation applied`);
      await toast("⚠️ opsi sudah tidak berlaku");
      await edit(`⚠️ OPSI SUDAH TIDAK BERLAKU\n${escMd(fresh.title || "(tanpa judul)")}\nOpsi di Paperclip berubah; minta kartu baru.`, { removeButtons: true });
      return { outcome: "invalid-option" };
    }

    const selected = validated.options[optionIndex];
    const cur = Array.isArray(fresh.labelIds) ? fresh.labelIds.slice() : [];
    const next = new Set(cur);
    if (labelMap.OWNER_REQUIRED) next.delete(labelMap.OWNER_REQUIRED);
    const p = await _patchIssue(base, issueId, { labelIds: [...next] });
    if (p.networkError || !okStatus(p.status)) {
      const failDesc = p.networkError ? `Paperclip network error (${p.networkErrorMessage || "?"})` : `Paperclip HTTP ${p.status}`;
      log(`telegram-listener: ${shortId} OPTION PATCH FAILED (${failDesc}) — recording received option, NOT claiming success; offset will still advance`);
      const fc = await postFailureComment(_postComment, base, issueId, shortId, `MEMILIH "${selected.label}"`, failDesc);
      if (fc && fc.networkError) log(`telegram-listener: ${shortId} OPTION failure-comment ALSO failed to post (network error) — owner selection is NOT recorded in Paperclip; investigate manually`);
      await toast("⚠️ opsi gagal diterapkan");
      await edit(`⚠️ OPSI DIPILIH (gagal diterapkan)\n${escMd(fresh.title || "(tanpa judul)")}\nPerlu perbaikan manual.`, { removeButtons: true });
      return { outcome: "patch-failed", networkError: !!p.networkError, status: p.status };
    }

    log(`telegram-listener: ${shortId} OPTION index=${optionIndex} key=${selected.key} -> removed OWNER_REQUIRED (PATCH ${p.status})`);
    const optionDecisionKey = `${issueId}:${action}:${optionIndex}`;
    const optionPrefix = `OWNER MEMILIH: ${selected.label} via Telegram`;
    const dup = hasRecentInProcessDecision(decisionDedupe, optionDecisionKey, now(), dedupeWindowMs) ||
      await hasRecentDecisionComment(_get, base, issueId, optionPrefix, dedupeWindowMs, now);
    if (dup) {
      log(`telegram-listener: ${shortId} OPTION index=${optionIndex} — duplicate confirmation comment suppressed (recent identical option already recorded)`);
    } else {
      const cm = await _postComment(base, issueId,
        `OWNER MEMILIH: ${selected.label} via Telegram (${iso()}) — ketukan tombol oleh owner via @ahmadsuperbot. decision_options key=${selected.key}; label OWNER_REQUIRED dihapus.`,
        { authorType: "user" });
      if (cm && cm.networkError) log(`telegram-listener: ${shortId} OPTION label WAS removed but the confirmation comment FAILED to post (network error)`);
    }
    await toast(`✅ Dipilih: ${selected.label}`);
    await edit(`✅ DIPILIH OWNER\n${escMd(fresh.title || "(tanpa judul)")}\n${escMd(selected.label)}`, { removeButtons: true });
    return { outcome: "option-selected", optionKey: selected.key };
  }

  if (action === "ASK AHMAD") {
    const fresh = await freshIssue(base, issueId, _get);
    if (!fresh) { await toast("gagal memuat issue"); return { outcome: "load-failed" }; }
    const cur = Array.isArray(fresh.labelIds) ? fresh.labelIds.slice() : [];
    const next = new Set(cur);
    if (labelMap.ESCALATED_TO_AHMAD) next.add(labelMap.ESCALATED_TO_AHMAD);
    const p = await _patchIssue(base, issueId, { labelIds: [...next] });
    if (p.networkError || !okStatus(p.status)) {
      const failDesc = p.networkError ? `Paperclip network error (${p.networkErrorMessage || "?"})` : `Paperclip HTTP ${p.status}`;
      log(`telegram-listener: ${shortId} ASK AHMAD PATCH FAILED (${failDesc}) — recording received decision, NOT claiming success; offset will still advance`);
      const fc = await postFailureComment(_postComment, base, issueId, shortId, "MENGESKALASI ke AHMAD", failDesc);
      if (fc && fc.networkError) log(`telegram-listener: ${shortId} ASK AHMAD failure-comment ALSO failed to post (network error) — investigate manually`);
      await toast("⚠️ gagal mengeskalasi");
      await edit(`\u26A0\uFE0F DIESKALASI (gagal diterapkan)\n${escMd(fresh.title || "(tanpa judul)")}\nPerlu perbaikan manual.`, { removeButtons: true });
      return { outcome: "patch-failed", networkError: !!p.networkError, status: p.status };
    }
    log(`telegram-listener: ${shortId} ASK AHMAD -> added ESCALATED_TO_AHMAD (PATCH ${p.status})`);
    const dup = hasRecentInProcessDecision(decisionDedupe, decisionKey, now(), dedupeWindowMs) ||
      await hasRecentDecisionComment(_get, base, issueId, DECISION_COMMENT_PREFIX["ASK AHMAD"], dedupeWindowMs, now);
    if (dup) {
      log(`telegram-listener: ${shortId} ASK AHMAD — duplicate confirmation comment suppressed (recent identical decision already recorded)`);
    } else {
      const cm = await _postComment(base, issueId,
        `OWNER MENGESKALASI ke AHMAD via Telegram (${iso()}) — ketukan tombol oleh owner via @ahmadsuperbot. Label ESCALATED_TO_AHMAD ditambahkan agar terlihat di detektor ops-watcher.`,
        { authorType: "user" });
      if (cm && cm.networkError) log(`telegram-listener: ${shortId} ASK AHMAD label WAS added but the confirmation comment FAILED to post (network error)`);
    }
    await toast("\U0001F4E2 Dieskalasi ke Ahmad");
    await edit(`\U0001F4E2 DIESKALASI KE AHMAD\n${escMd(fresh.title || "(tanpa judul)")}\nAhmad akan menyelidiki.`, { removeButtons: true });
    return { outcome: "escalated" };
  }

  await toast("aksi tidak dikenali");
  return { outcome: "unknown-action" };
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) if (argv[i] === "--once") out.once = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.log("usage: node ops-watcher/telegram-listener.mjs --once");
    process.exit(2);
  }
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  const r = await runListenerOnce({ base, log: (m) => console.log(m) });
  const processed = r.results.filter((x) => x.outcome && x.outcome !== "non-callback-skipped").length;
  console.log(`telegram-listener --once: processed=${processed} updates=${r.results.length} (error=${r.error || "none"}${r.persistError ? ", persistError=" + r.persistError : ""})`);
  for (const x of r.results)
    console.log(`  - update ${x.update_id}: ${x.action || "?"} ${x.shortId || x.identifier || ""} -> ${x.outcome}`);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => {
    console.error("telegram-listener fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}