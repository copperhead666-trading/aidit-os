// ops-watcher/telegram-notify.mjs
// Notifies the OWNER via Telegram about Paperclip issues that need an owner
// decision, and persists a "[TELEGRAM SENT]" marker comment on each notified
// issue so a future run never double-sends for the same issue.
//
// "Needs OWNER attention" = the issue carries a label named OWNER_REQUIRED AND
// has no existing comment whose body starts with the marker "[TELEGRAM SENT]".
//
// For each such issue, sends a real Telegram message to the OWNER with the
// issue's identifier/title and inline buttons. By default the card has 4 fixed
// buttons:
//   APPROVE  -> callback_data "a:<shortId>"
//   REJECT   -> callback_data "r:<shortId>"
//   DETAILS  -> callback_data "d:<shortId>"
//   DEFER    -> callback_data "z:<shortId>"
// (A fifth action letter "k"/ASK AHMAD is supported by telegram-listener.mjs
// and exercised by tests, but is NOT yet rendered on this card — see the
// buildButtons() function below.)
// If the issue has a "[DECISION OPTIONS]" marker comment carrying a valid 2-5
// item array of { key, label } (see telegram-decision-options.mjs -- NOT
// issue.metadata, which Paperclip's real schema does not support; see that
// file's header for the live-verified reason), the card is dynamic instead:
//   OPTION   -> callback_data "o:<shortId>:<optionIndex>"
// where optionIndex is the 0-based index into that comment's decision_options.
//
// === callback_data encoding scheme (documented) ===
// Telegram limits callback_data to 64 bytes. We use a compact scheme:
//     "<actionLetter>:<shortId>"
//     "o:<shortId>:<optionIndex>"
// where actionLetter ∈ { a=APPROVE, r=REJECT, d=DETAILS, z=DEFER,
// k=ASK AHMAD, o=OPTION }
// and shortId is the issue's OWN short identifier (the "KOL-N" string from
// Paperclip's `identifier` field), which is already short and unique within the
// company. telegram-listener maps shortId back to the real issue by listing the
// company's issues and matching identifier — no local lookup file needed, so
// state stays canonical in Paperclip. For OPTION callbacks, the label/key are
// deliberately NOT encoded in callback_data; the listener re-fetches the fresh
// issue and looks up decision_options[optionIndex]. If an issue ever lacks an
// identifier we skip it (and log), since a UUID would blow past the 64-byte
// budget when paired with an action letter and would be ambiguous to a human
// reading Paperclip.
//
// After a successful send, we POST a comment whose body starts with the fixed
// marker "[TELEGRAM SENT]" and includes the real Telegram message_id, so:
//   (1) a future run sees the marker and skips (no double-send), and
//   (2) a human reading only Paperclip can see the message was sent + its id.
//
// Markdown note: messages use parse_mode "Markdown" (legacy) for bold/italic/
// code. Free-form issue content (title, description) is run through escMd() so
// that underscores in values like "OWNER_REQUIRED" or "in_review" do not break
// Markdown parsing (Telegram returns 400 on an unmatched `_`).
//
//   node ops-watcher/telegram-notify.mjs --once
//
// Crash-proof: Telegram API failure or Paperclip failure never throws; each is
// reported in the returned results and the script exits 0 unless it itself
// crashed (it catches and logs). Paperclip is canonical state.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverPaperclipPort,
  httpGet,
  listLabels,
  ensureLabel,
  postComment,
} from "./paperclip-write-client.mjs";
import { sendMessage, tokenStatus } from "./telegram-client.mjs";
import {
  buildDecisionOptionsCommentBody,
  parseDecisionOptionsFromComments,
} from "./telegram-decision-options.mjs";

export { buildDecisionOptionsCommentBody };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const SENT_MARKER = "[TELEGRAM SENT]";
const LABEL_SPECS = {
  OWNER_REQUIRED: "#b91c1c",
};

const iso = () => new Date().toISOString();

// Escape Telegram legacy-Markdown special characters in free-form content that
// appears OUTSIDE code spans. (Inside `code spans` Markdown does not parse
// specials, so we do NOT escape shortId there.) Escapes: * _ ` [ and backslash.
export function escMd(s) {
  return String(s == null ? "" : s).replace(/([\\*_`\[])/g, "\\$1");
}

function buildDefaultButtons(shortId) {
  return [
    [{ text: "SETUJUI", callback_data: `a:${shortId}` }],
    [{ text: "TOLAK", callback_data: `r:${shortId}` }],
    [{ text: "DETAIL", callback_data: `d:${shortId}` }],
    [{ text: "TUNDA", callback_data: `z:${shortId}` }],
  ];
}

// Build the inline keyboard. A valid "[DECISION OPTIONS]" marker comment (see
// telegram-decision-options.mjs) takes precedence. Otherwise, keep the exact
// legacy 4-button card.
// APPROVE and REJECT are terminal (remove all buttons after).
// DETAILS shows more info (non-terminal, buttons stay).
// DEFER is non-terminal (keeps APPROVE/REJECT/DETAILS available).
// NOTE: ASK AHMAD (k:<shortId>) is NOT surfaced on the card yet; the listener
// supports it but no button is rendered here.
export function buildButtons(shortId, comments = [], { log = () => {} } = {}) {
  const validated = parseDecisionOptionsFromComments(comments);
  if (validated.ok) {
    return validated.options.map((opt, idx) => [
      { text: opt.label, callback_data: `o:${shortId}:${idx}` },
    ]);
  }
  if (validated.reason !== "no decision-options comment found") {
    log(`telegram-notify: ${shortId} invalid decision-options comment (${validated.reason}) — falling back to default APPROVE/REJECT/DETAILS/DEFER buttons`);
  }

  return buildDefaultButtons(shortId);
}

function buildMessageText(it, shortId) {
  const title = escMd(it.title || "(tanpa judul)");
  // Concise card: no long description. Details available via the DETAIL button.
  return [
    `\u26A0\uFE0F Perlu keputusan Anda`,
    ``,
    `${title}`,
    ``,
    `Ketuk salah satu tombol di bawah untuk memutuskan.`,
  ].join("\n");
}

// Core, dependency-injected for testability (same pattern as review-runner).
// deps: { base, companyId, telegramBase, httpGet, listLabels, ensureLabel,
//         postComment, sendMessage, log, tokenStatusFn }
export async function runNotifyOnce(deps) {
  const {
    base,
    companyId = COMPANY_ID,
    telegramBase,
    httpGet: _get = httpGet,
    listLabels: _listLabels = listLabels,
    ensureLabel: _ensureLabel = ensureLabel,
    postComment: _postComment = postComment,
    sendMessage: _sendMessage = sendMessage,
    log = (m) => console.log(m),
    tokenStatusFn = tokenStatus,
  } = deps;

  const results = [];
  if (!base) {
    log("telegram-notify: no Paperclip base resolved (instance not running)");
    return { results, error: "no-base" };
  }

  const ts = tokenStatusFn();
  if (!ts.present) {
    log(`telegram-notify: TELEGRAM_BOT_TOKEN_AHMAD not set (present=${ts.present}) — cannot send`);
    return { results, error: "no-token" };
  }
  log(`telegram-notify: token present: true/length ${ts.length}`);

  // Ensure the OWNER_REQUIRED label exists.
  const labelMap = {};
  for (const [name, color] of Object.entries(LABEL_SPECS)) {
    const r = await _ensureLabel(base, companyId, name, color);
    if (r.networkError) {
      log(`telegram-notify: ensureLabel ${name} network error: ${r.networkErrorMessage}`);
      return { results, error: "label-network" };
    }
    if (!r.id) {
      log(`telegram-notify: could not ensure label ${name} (status ${r.status})`);
      return { results, error: "label" };
    }
    labelMap[name] = r.id;
  }

  // List issues for the company.
  const issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
  if (issuesRes.networkError) {
    log(`telegram-notify: issues list network error: ${issuesRes.networkErrorMessage}`);
    return { results, error: "network" };
  }
  const issues = Array.isArray(issuesRes.body) ? issuesRes.body : [];
  log(`telegram-notify: ${issues.length} issues in company; scanning for OWNER_REQUIRED`);

  for (const it of issues) {
    const labelIds = Array.isArray(it.labelIds) ? it.labelIds : [];
    const labelNames = (it.labels || [])
      .map((l) => (typeof l === "string" ? l : l.name || ""))
      .map((s) => String(s).toUpperCase());
    const hasOwnerRequired =
      labelIds.includes(labelMap.OWNER_REQUIRED) || labelNames.includes("OWNER_REQUIRED");
    if (!hasOwnerRequired) continue;

    const shortId = it.identifier || null;
    if (!shortId) {
      log(`telegram-notify: issue ${it.id} has OWNER_REQUIRED but no identifier — skipping (callback_data would not fit a UUID)`);
      results.push({ id: it.id, identifier: null, outcome: "skipped-no-identifier" });
      continue;
    }

    // Has it already been sent? Check comments for the marker.
    const cRes = await _get(`${base}/api/issues/${it.id}/comments`);
    if (cRes.networkError) {
      log(`telegram-notify: ${shortId} comments fetch network error -> skip`);
      results.push({ id: it.id, identifier: shortId, outcome: "comments-network-error" });
      continue;
    }
    const comments = Array.isArray(cRes.body) ? cRes.body : [];
    const alreadySent = comments.some((c) =>
      String(c.body || "").trim().startsWith(SENT_MARKER));
    if (alreadySent) {
      log(`telegram-notify: ${shortId} already has a "${SENT_MARKER}" comment -> skip (no double-send)`);
      results.push({ id: it.id, identifier: shortId, outcome: "already-sent" });
      continue;
    }

    // Send the Telegram message.
    const text = buildMessageText(it, shortId);
    const buttons = buildButtons(shortId, comments, { log });
    const sendOpts = {};
    if (telegramBase) sendOpts.baseUrl = telegramBase;
    const s = await _sendMessage(text, { buttons, ...sendOpts });
    if (!s.sent) {
      const why = s.networkError
        ? `network error: ${s.networkErrorMessage}`
        : s.reason || `Telegram API status ${s.status}`;
      log(`telegram-notify: ${shortId} send FAILED (${why}) — not marking sent, will retry next sweep`);
      results.push({ id: it.id, identifier: shortId, outcome: "send-failed", reason: why });
      continue;
    }

    const messageId = s.result && s.result.message_id;
    log(`telegram-notify: ${shortId} sent Telegram message_id=${messageId}`);

    // Post the marker comment so we never double-send and so Paperclip records it.
    const markerBody =
      `${SENT_MARKER} message_id=${messageId} (${iso()}) — owner decision requested via @ahmadsuperbot for ${shortId}.`;
    const mc = await _postComment(base, it.id, markerBody, { authorType: "user" });
    if (mc.networkError) {
      log(`telegram-notify: ${shortId} marker comment network error: ${mc.networkErrorMessage} (message WAS sent; may re-send next sweep)`);
      results.push({ id: it.id, identifier: shortId, outcome: "sent-marker-failed", message_id: messageId });
      continue;
    }
    log(`telegram-notify: ${shortId} marker comment posted`);
    results.push({ id: it.id, identifier: shortId, outcome: "sent", message_id: messageId });
  }

  return { results };
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
    console.log("usage: node ops-watcher/telegram-notify.mjs --once");
    process.exit(2);
  }
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  const r = await runNotifyOnce({ base, log: (m) => console.log(m) });
  const sent = r.results.filter((x) => x.outcome === "sent").length;
  const skipped = r.results.length - sent;
  console.log(`telegram-notify --once: sent=${sent} skipped/other=${skipped} (error=${r.error || "none"})`);
  for (const x of r.results)
    console.log(`  - ${x.identifier || x.id}: ${x.outcome}${x.message_id ? " (message_id=" + x.message_id + ")" : ""}`);
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
    console.error("telegram-notify fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}