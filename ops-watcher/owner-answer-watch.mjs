// ops-watcher/owner-answer-watch.mjs
//
// Emits one line the moment the owner answers a decision on the board.
//
// === WHY THIS EXISTS ===
// The owner's instruction on 2026-09-06: park the question, keep working, and
// pick the decision up the moment he taps an answer — without him having to
// come back and tell a session that he did. Everything needed for that already
// existed except the last link. raise-decision.mjs puts the question on the
// board, ahmad-escalate.mjs labels and briefs it, telegram-notify.mjs sends the
// card, telegram-listener.mjs records the tap as a comment. Nothing watched for
// that comment. So an answered decision sat there until somebody thought to
// look, which is the same as not being answered.
//
// This is a READ-ONLY watcher. It never labels, comments, patches, or decides.
// It reports, and something else acts. A watcher that also acts is a second
// decision-maker nobody voted for.
//
//   node ops-watcher/owner-answer-watch.mjs --once
//   node ops-watcher/owner-answer-watch.mjs --follow [--interval-ms 30000]
//   node ops-watcher/owner-answer-watch.mjs --follow --issue KOL-91 --issue KOL-92
//
// --once   prints answers newer than --since (default: now) and exits.
// --follow polls until killed, printing each new answer exactly once.
//
// WHICH ISSUES ARE WATCHED. Answering is what REMOVES the OWNER_REQUIRED label
// (telegram-listener drops it on APPROVE and on OPTION), so an issue that was
// waiting is no longer marked as waiting the instant it is answered. Watching
// only the currently-labelled set would therefore miss every answer it exists
// to catch. The watched set is STICKY: once an issue is seen carrying
// OWNER_REQUIRED it stays watched for the life of the process, and identifiers
// named with --issue are watched from the start regardless of labels.

import { discoverPaperclipPort, httpGet } from "./watcher.mjs";
import { CANONICAL_COMPANY_ID, listIssues } from "./paperclip-write-client.mjs";

export const OWNER_REQUIRED_LABEL = "OWNER_REQUIRED";

// The exact sentences telegram-listener.mjs writes when a button is tapped.
// Kept as a table rather than one regex so a new action shows up as an unknown
// answer instead of being silently classified as an existing one.
export const OWNER_ANSWER_PREFIXES = Object.freeze([
  { action: "CHOSE", prefix: "OWNER MEMILIH:" },
  { action: "APPROVED", prefix: "OWNER MENYETUJUI" },
  { action: "REJECTED", prefix: "OWNER MENOLAK" },
  { action: "DEFERRED", prefix: "OWNER MENUNDA" },
]);

/**
 * Classify one comment body as an owner answer, or null when it is not one.
 *
 * DEFER IS AN ANSWER TOO, and deliberately a different one: it means "not now",
 * leaves OWNER_REQUIRED in place, and must NOT be treated as a decision to act
 * on. Reporting it as its own action is what keeps a caller from reading
 * silence-after-defer as approval.
 */
export function classifyOwnerAnswer(body) {
  const text = String(body || "").trim();
  for (const { action, prefix } of OWNER_ANSWER_PREFIXES) {
    if (!text.startsWith(prefix)) continue;
    if (action !== "CHOSE") return { action, choice: null };
    // "OWNER MEMILIH: <label> via Telegram (<iso>) — ..."
    const after = text.slice(prefix.length).trim();
    const choice = after.split(/\s+via Telegram|\s+\(|\s+—/)[0].trim();
    return { action, choice: choice || null };
  }
  return null;
}

/**
 * The answers in `comments` that this watcher has not reported yet.
 *
 * `seen` is a Set of comment ids and is MUTATED as answers are taken, so a
 * poll loop reports each answer exactly once. A comment with no id is reported
 * once and never again by falling back to a body+timestamp key: dropping it
 * would lose a real answer, and reporting it every poll would be noise.
 */
export function newOwnerAnswers(comments, { seen = new Set(), sinceMs = 0 } = {}) {
  const out = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment || typeof comment !== "object") continue;
    const classified = classifyOwnerAnswer(comment.body);
    if (!classified) continue;

    const createdMs = Date.parse(comment.createdAt || comment.created_at || "");
    if (Number.isFinite(createdMs) && createdMs < sinceMs) continue;

    const key = comment.id ? `id:${comment.id}` : `body:${comment.createdAt || ""}:${String(comment.body || "").slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...classified,
      commentId: comment.id || null,
      createdAt: comment.createdAt || comment.created_at || null,
      body: String(comment.body || ""),
    });
  }
  return out;
}

/** One event line. Stable and greppable: a Monitor turns each into a notification. */
export function formatAnswerLine(identifier, answer) {
  const parts = [
    "OWNER ANSWER",
    identifier || "?",
    answer.action,
    answer.choice ? `choice="${answer.choice}"` : null,
    answer.createdAt ? `at=${answer.createdAt}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

/** True when the issue carries OWNER_REQUIRED, whatever shape labels arrive in. */
export function isOwnerRequired(issue) {
  const labels = (issue && issue.labels) || [];
  return labels.some((l) => String((l && l.name) || l || "").toUpperCase() === OWNER_REQUIRED_LABEL);
}

/**
 * One sweep. Returns { lines, watched, errors } and NEVER throws: a watcher
 * that dies on one bad poll is worse than no watcher, because its silence looks
 * exactly like "no answer yet".
 */
export async function sweepOnce(state, deps = {}) {
  const _get = deps.httpGet || httpGet;
  const _list = deps.listIssues || listIssues;
  const base = deps.base;
  const companyId = deps.companyId || CANONICAL_COMPANY_ID;
  const lines = [];
  const errors = [];

  let issues = [];
  try {
    const res = await _list(base, companyId);
    if (res.networkError) {
      errors.push(`board unreachable: ${res.networkErrorMessage || "network error"}`);
      return { lines, watched: state.watched, errors };
    }
    issues = res.issues || [];
  } catch (err) {
    errors.push(`board listing threw: ${err && err.message ? err.message : err}`);
    return { lines, watched: state.watched, errors };
  }

  // Sticky watched set: answering removes the label, so a set recomputed from
  // labels alone would drop the issue in the same sweep that answers it.
  for (const issue of issues) {
    if (issue && issue.identifier && isOwnerRequired(issue)) state.watched.add(issue.identifier);
  }

  const byIdentifier = new Map(issues.filter((i) => i && i.identifier).map((i) => [i.identifier, i]));
  for (const identifier of state.watched) {
    const issue = byIdentifier.get(identifier);
    if (!issue) continue;
    let comments = [];
    try {
      const res = await _get(`${base}/api/issues/${issue.id}/comments`);
      if (res.networkError) { errors.push(`${identifier}: comments unreachable`); continue; }
      comments = Array.isArray(res.body) ? res.body : [];
    } catch (err) {
      errors.push(`${identifier}: comments threw: ${err && err.message ? err.message : err}`);
      continue;
    }
    if (!state.seen.has(identifier)) state.seen.set(identifier, new Set());
    for (const answer of newOwnerAnswers(comments, { seen: state.seen.get(identifier), sinceMs: state.sinceMs })) {
      lines.push(formatAnswerLine(identifier, answer));
    }
  }

  return { lines, watched: state.watched, errors };
}

export function makeState({ sinceMs = Date.now(), issues = [] } = {}) {
  return { sinceMs, watched: new Set(issues), seen: new Map() };
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { follow: false, once: false, intervalMs: 30000, issues: [], sinceMs: Date.now() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--follow") out.follow = true;
    else if (a === "--once") out.once = true;
    else if (a === "--issue") { const v = argv[++i]; if (v) out.issues.push(v); }
    else if (a === "--interval-ms") { const v = Number.parseInt(argv[++i], 10); if (Number.isFinite(v) && v >= 1000) out.intervalMs = v; }
    else if (a === "--since") { const v = Date.parse(argv[++i]); if (Number.isFinite(v)) out.sinceMs = v; }
    else if (a === "--all-history") out.sinceMs = 0;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = await discoverPaperclipPort();
  if (!port) {
    process.stderr.write("owner-answer-watch: no Paperclip base resolved (instance not running)\n");
    process.exit(1);
  }
  const base = `http://127.0.0.1:${port}`;
  const state = makeState({ sinceMs: args.sinceMs, issues: args.issues });

  // Errors are reported on stderr, never stdout: stdout is the event stream and
  // a transient network blip is not an owner answer.
  const runSweep = async () => {
    const { lines, errors } = await sweepOnce(state, { base });
    for (const line of lines) process.stdout.write(`${line}\n`);
    for (const e of errors) process.stderr.write(`owner-answer-watch: ${e}\n`);
  };

  if (!args.follow) {
    await runSweep();
    process.exit(0);
  }

  process.stderr.write(`owner-answer-watch: following the board every ${args.intervalMs}ms (watching ${state.watched.size} named issue(s) plus everything labelled ${OWNER_REQUIRED_LABEL})\n`);
  for (;;) {
    await runSweep();
    await new Promise((r) => setTimeout(r, args.intervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("owner-answer-watch.mjs")) {
  main().catch((err) => {
    process.stderr.write(`owner-answer-watch: crashed: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
}
