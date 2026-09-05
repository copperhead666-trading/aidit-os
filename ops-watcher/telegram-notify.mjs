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
import { cardWorthy, buildDigest, renderDigest } from "./owner-surface.mjs";
import { parseDecisionBriefFromComments } from "./decision-brief.mjs";
import {
  ACTION_FLAGS,
  buttonsForActions,
  parseEscalationActionsFromComments,
} from "./escalation-actions.mjs";

export { buildDecisionOptionsCommentBody };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const SENT_MARKER = "[TELEGRAM SENT]";

// Where the daily digest remembers it already went out. Same shape and the same
// gitignore rule as every other ops-watcher state file.
const DIGEST_STATE_FILE = path.join(__dirname, "owner-digest-state.json");
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

  // E2: the SENDER declares which actions this escalation supports, and the
  // card renders only those. An escalation that declares nothing keeps the card
  // it has today — a producer that has not been taught to declare must not
  // silently lose the owner's buttons.
  const actions = parseEscalationActionsFromComments(comments);
  if (actions) {
    log(`telegram-notify: ${shortId} escalation declares actions (${ACTION_FLAGS.filter((f) => actions[f]).join(", ") || "none"})`);
    return buttonsForActions(shortId, actions);
  }

  return buildDefaultButtons(shortId);
}

// How much of an issue's description the card carries when there is no brief.
// Long enough for the options to survive (KOL-66's ran to three short lines),
// short enough that the card is still a card and not the issue body.
export const DESCRIPTION_BUDGET = 700;

// Cut on a sentence boundary. A card that ends mid-word reads as broken and the
// owner cannot tell whether the rest mattered.
function trimTo(text, budget) {
  const s = String(text || "").trim();
  if (s.length <= budget) return s;
  const cut = s.slice(0, budget);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  return (stop > budget * 0.5 ? cut.slice(0, stop) : cut).trim() + "\u2026";
}

/**
 * The card the owner actually decides from.
 *
 * WHAT THIS USED TO BE, and why the owner was right to complain: the title, and
 * nothing else. Meanwhile the issue carried a full five-slot decision brief \u2014
 * the question, the current state with its sources, the options with their
 * consequences, a recommendation with reasoning, and the cost of waiting \u2014 and
 * the card showed none of it. He had to open the board to find out what he was
 * approving, which makes both the card and the brief half useless.
 *
 * It now leads with the QUESTION rather than the subject line, then the
 * recommendation the APPROVE button actually approves, then what waiting costs.
 * The current state and the full option list stay behind DETAILS: a card that
 * tries to be the whole brief is the flood again, in a smaller font.
 *
 * Falls back to the old shape when an issue carries no brief \u2014 most of the
 * board predates the gate that requires one.
 */
export function buildMessageText(it, shortId, brief = null) {
  const title = escMd(it.title || "(tanpa judul)");
  if (!brief) {
    // E1: the card carries the content. The no-brief branch used to send the
    // title and "tap a button", dropping issue.description entirely \u2014 and for
    // KOL-66 that description WAS the answer ("Reply with one: commit them,
    // discard them, or leave as-is for now"). The options were written down and
    // the card threw them away.
    //
    // A missing description still yields the old card byte-for-byte: there is
    // nothing to add, and inventing a line would say less than silence.
    const description = String(it.description || "").trim();
    const body = description ? trimTo(description, DESCRIPTION_BUDGET) : "";
    const truncated = Boolean(description) && description.length > DESCRIPTION_BUDGET;
    return [
      `\u26A0\uFE0F Perlu keputusan Anda`,
      ``,
      `${title}`,
      ...(body ? [``, escMd(body)] : []),
      ...(truncated ? [``, `\u2702\uFE0F Keterangan dipotong (${description.length} karakter). Teks penuh ada di DETAIL.`] : []),
      ``,
      `Ketuk salah satu tombol di bawah untuk memutuskan.`,
    ].join("\n");
  }

  const chosen = Array.isArray(brief.pilihan)
    ? brief.pilihan.find((o) => o && o.key === brief.rekomendasi?.pilihan)
    : null;
  const saranLabel = chosen ? chosen.label : (brief.rekomendasi?.pilihan || "");
  const lines = [
    `\u26A0\uFE0F Perlu keputusan Anda \u00B7 ${escMd(shortId)}`,
    ``,
    `${escMd(trimTo(brief.pertanyaan, 220))}`,
  ];
  if (saranLabel) {
    lines.push(``, `*Saran:* ${escMd(trimTo(saranLabel, 90))}`);
    if (brief.rekomendasi?.alasan) {
      lines.push(escMd(trimTo(brief.rekomendasi.alasan, 260)));
    }
  }
  if (brief.kalau_didiamkan) {
    lines.push(``, `*Kalau didiamkan:* ${escMd(trimTo(brief.kalau_didiamkan, 220))}`);
  }
  const pilihan = Array.isArray(brief.pilihan) ? brief.pilihan : [];
  if (pilihan.length) {
    lines.push(``, `*Pilihan:*`);
    for (const [idx, opt] of pilihan.entries()) {
      const label = trimTo(opt?.label || opt?.key || `Pilihan ${idx + 1}`, 90);
      const marker = opt?.key === brief.rekomendasi?.pilihan ? ` *(saran)*` : "";
      lines.push(`${idx + 1}. ${escMd(label)}${marker}`);
    }
  }
  lines.push(``, `Keadaan sekarang, sumber, dan konsekuensi tiap pilihan ada di DETAIL.`);
  return lines.join("\n");
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
    now: _now = Date.now,
    digestState: _digestState = null,
    sendDigest = false,
    cockpitUrl = null,
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

  // The board returns labels as ids; needsOwner reads names. Invert the map we
  // just built rather than re-deriving names from a second shape.
  const idToName = new Map(
    Object.entries(labelMap).map(([name, id]) => [id, name]),
  );

  // WHY THIS IS NOT A LABEL CHECK ANY MORE.
  //
  // This loop used to select on "carries the OWNER_REQUIRED label". Measured
  // against the live board on 2026-09-03 that was 3 issues, while 17 met this
  // repo's own definition of waiting on the owner — among them eight real
  // decisions that had been sitting in `todo` and had never been sent:
  // KOL-50/52/53 (P4 DECISION NEEDED), KOL-62/63 (APPROVE: start real work),
  // KOL-65/66/72 (DECISION: Caveman). The other fourteen were invisible purely
  // because nobody had remembered to apply a label.
  //
  // The fix is not "send all seventeen". owner-surface.mjs already drew the
  // right line and had no caller: something escalated on purpose, or a plan the
  // runner posted and stopped at, EARNS an interrupt; everything else earns a
  // place in one daily summary. Sending a card for `OWNER DIRECTIVE: oke` —
  // the owner's own word, wrapped by the listener — would be asking the owner
  // to approve himself.
  const cards = issues.filter((it) => cardWorthy(it, { idToName, now: _now }));
  log(
    `telegram-notify: ${issues.length} issues in company; ${cards.length} card-worthy (owner-surface)`,
  );

  for (const it of cards) {

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

    // Send the Telegram message. `comments` arrives newest-first straight from
    // the endpoint, which is the order parseDecisionBriefFromComments wants —
    // a re-escalation supersedes the brief before it.
    const brief = parseDecisionBriefFromComments(comments);
    const text = buildMessageText(it, shortId, brief);
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

  // The other surface. Everything that is waiting but did not earn an interrupt
  // gets counted in one message a day — that is the whole reason fourteen items
  // stayed invisible: there was nowhere quieter than a card for them to go.
  // Once a day, not once a sweep: the heartbeat runs every five minutes, and a
  // summary that arrives 288 times is a flood wearing a summary's clothes.
  //
  // OPT-IN ON PURPOSE. The digest keeps state in a real file, and the first
  // version of this ran during the existing telegram suite, wrote
  // owner-digest-state.json, and marked the day already sent — a test quietly
  // eating the owner's only summary of the day. A caller now has to ask.
  if (!sendDigest && !_digestState) {
    return { results, digest: { outcome: "not-requested" } };
  }
  const digest = await maybeSendDigest({
    issues,
    idToName,
    now: _now,
    state: _digestState,
    sendMessage: _sendMessage,
    telegramBase,
    cockpitUrl,
    log,
  });

  return { results, digest };
}

/** Local calendar day, so "once a day" means what the owner means by it. */
export function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Injected wholesale in tests so no test ever touches the real state file.
const fileDigestState = {
  async read() {
    try {
      const fs = await import("node:fs/promises");
      return JSON.parse(await fs.readFile(DIGEST_STATE_FILE, "utf8"));
    } catch {
      return {};
    }
  },
  async write(next) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(DIGEST_STATE_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  },
};

export async function maybeSendDigest(opts = {}) {
  const {
    issues = [],
    idToName = null,
    now = Date.now,
    state = null,
    sendMessage: _send = sendMessage,
    telegramBase = null,
    cockpitUrl = null,
    log = () => {},
  } = opts;
  const store = state || fileDigestState;
  const nowMs = typeof now === "function" ? now() : now;
  const today = dayKey(nowMs);

  const prior = (await store.read()) || {};
  if (prior.lastSentDay === today) {
    return { outcome: "already-sent-today", day: today };
  }

  const summary = buildDigest(issues, { now: () => nowMs, idToName });

  // Nothing waiting is not a reason to say good morning. Silence is the correct
  // message when there is no message.
  if (!summary || summary.total === 0) {
    await store.write({ ...prior, lastSentDay: today });
    return { outcome: "nothing-waiting", day: today, total: 0 };
  }

  const text = renderDigest(summary, { cockpitUrl });
  const sendOpts = {};
  if (telegramBase) sendOpts.baseUrl = telegramBase;
  const s = await _send(text, sendOpts);
  if (!s.sent) {
    const why = s.networkError
      ? `network error: ${s.networkErrorMessage}`
      : s.reason || `Telegram API status ${s.status}`;
    // Deliberately NOT marking the day done: a digest that failed to send has
    // not been sent, and the next sweep should try again.
    log(`telegram-notify: digest send FAILED (${why}) — will retry next sweep`);
    return { outcome: "send-failed", day: today, total: summary.total, reason: why };
  }

  await store.write({ ...prior, lastSentDay: today });
  log(`telegram-notify: digest sent — ${summary.total} waiting, ${summary.cards.length} of them on cards`);
  return {
    outcome: "sent",
    day: today,
    total: summary.total,
    cards: summary.cards.length,
    digest: summary.digest.length,
    message_id: s.result && s.result.message_id,
  };
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
  const r = await runNotifyOnce({ base, log: (m) => console.log(m), sendDigest: true });
  const sent = r.results.filter((x) => x.outcome === "sent").length;
  const skipped = r.results.length - sent;
  console.log(`telegram-notify --once: sent=${sent} skipped/other=${skipped} (error=${r.error || "none"})`);
  if (r.digest) console.log(`telegram-notify --once: digest ${r.digest.outcome}${r.digest.total !== undefined ? " total=" + r.digest.total : ""}`);
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
