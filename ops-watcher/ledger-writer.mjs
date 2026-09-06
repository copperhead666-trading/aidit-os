// ops-watcher/ledger-writer.mjs
//
// Backfill the append-only ledger from Paperclip facts that are visible on the
// board but missing from state/ledger.jsonl.
//
//   node ops-watcher/ledger-writer.mjs --once
//
// The sweep is dependency-injected for offline tests. Production writes only
// through ops-watcher/ledger.mjs.

import { pathToFileURL } from "node:url";

import {
  readAll as defaultReadAll,
  appendMany as defaultAppendMany,
} from "./ledger.mjs";
import { KINDS } from "./ledger-schema.mjs";
import {
  DIRECTIVE_LABEL,
  foldDirectives as defaultFoldDirectives,
} from "./projections.mjs";
import {
  APPROVED_MARKER,
  PLAN_MARKER,
  REFUSED_MARKER,
  REJECTED_MARKER,
  RESULT_MARKER,
} from "./directive-runner.mjs";
import {
  discoverPaperclipPort as defaultDiscoverPaperclipPort,
  httpGet as defaultHttpGet,
  resolvePaperclipToken as defaultResolvePaperclipToken,
  listIssues as defaultListIssues,
  CANONICAL_COMPANY_ID,
} from "./paperclip-write-client.mjs";

// MUST be a member of ledger-schema.mjs's SOURCES allowlist:
//   cockpit, telegram, runner, heartbeat, migration, manual
// It was "ledger-writer", which is not in that set, so ledger.mjs rejected every
// single event with `unknown source "ledger-writer"` — and because appendMany
// REPORTS that as { ok:false } rather than throwing, this module counted the
// rejected batch as appended. A live run claimed 53 events written while
// state/ledger.jsonl stayed at 329 lines.
//
// "heartbeat" is the honest value: this sweep runs as a heartbeat step, and the
// distinction the SOURCES set actually cares about is live observation versus
// "migration", meaning reconstructed from the pre-cutover export. These facts
// are read from the live board, so they are not migration.
export const LEDGER_WRITER_SOURCE = "heartbeat";
export const TELEGRAM_SENT_MARKER = "[TELEGRAM SENT]";

const DECISION_MARKERS = Object.freeze([
  { prefix: "OWNER MENYETUJUI via Telegram", kind: KINDS.DECISION_APPROVED },
  { prefix: "OWNER APPROVED via Telegram", kind: KINDS.DECISION_APPROVED },
  { prefix: "OWNER MENOLAK via Telegram", kind: KINDS.DECISION_REJECTED },
  { prefix: "OWNER REJECTED via Telegram", kind: KINDS.DECISION_REJECTED },
  { prefix: "OWNER MENUNDA via Telegram", kind: KINDS.DECISION_DEFERRED },
  { prefix: "OWNER DEFERRED via Telegram", kind: KINDS.DECISION_DEFERRED },
  { prefix: "OWNER MENGESKALASI ke AHMAD via Telegram", kind: KINDS.DECISION_ESCALATED },
  { prefix: "OWNER ESCALATED via Telegram", kind: KINDS.DECISION_ESCALATED },
]);

const DIRECTIVE_PLAN_MARKERS = Object.freeze([
  { prefix: APPROVED_MARKER, skip: true },
  { prefix: REJECTED_MARKER, skip: true },
  { prefix: REFUSED_MARKER, kind: KINDS.DIRECTIVE_PLAN_REFUSED },
  { prefix: PLAN_MARKER, kind: KINDS.DIRECTIVE_PLAN_POSTED },
]);

// RESULT_MARKER ("DIRECTIVE RESULT") shares no prefix with any plan marker
// ("DIRECTIVE PLAN", "DIRECTIVE PLAN APPROVED", "DIRECTIVE PLAN REJECTED",
// "PLAN_REFUSED"), so no longest-first ordering trap exists here. Imported,
// not retyped, for the same reason as the plan markers.
const DIRECTIVE_COMPLETION_MARKERS = Object.freeze([
  { prefix: RESULT_MARKER, kind: KINDS.EXECUTION_DONE },
]);

function toIso(value) {
  const t = Date.parse(value == null ? "" : String(value));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function excerpt(value, max = 160) {
  const s = String(value == null ? "" : value)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max)}...[truncated]` : s;
}

function subjectOf(issue) {
  const raw = issue?.identifier || issue?.id || "";
  const subject = String(raw).trim();
  return subject || null;
}

export function labelNamesOf(issue) {
  return (Array.isArray(issue?.labels) ? issue.labels : [])
    .map((label) => {
      if (typeof label === "string") return label;
      if (label && typeof label.name === "string") return label.name;
      return "";
    })
    .map((label) => label.trim())
    .filter(Boolean);
}

function sameStringSet(a, b) {
  const aa = [...new Set((a || []).map((v) => String(v).trim()).filter(Boolean))].sort();
  const bb = [...new Set((b || []).map((v) => String(v).trim()).filter(Boolean))].sort();
  return JSON.stringify(aa) === JSON.stringify(bb);
}

function hasDirectiveLabel(issue) {
  return labelNamesOf(issue).some((label) => label.toUpperCase() === String(DIRECTIVE_LABEL).toUpperCase());
}

function boardEntryIssue(entry) {
  return entry?.issue && typeof entry.issue === "object" ? entry.issue : entry;
}

function commentsFromEntry(entry) {
  if (Array.isArray(entry?.comments)) return entry.comments;
  if (Array.isArray(entry?.issue?.comments)) return entry.issue.comments;
  if (Array.isArray(entry?.comments?.body)) return entry.comments.body;
  return null;
}

export function commentsOldestFirst(comments) {
  return [...(Array.isArray(comments) ? comments : [])].sort((a, b) => {
    const ta = toIso(a?.createdAt || a?.created_at || a?.updatedAt || a?.updated_at) || "";
    const tb = toIso(b?.createdAt || b?.created_at || b?.updatedAt || b?.updated_at) || "";
    const byTime = ta.localeCompare(tb);
    if (byTime !== 0) return byTime;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

function messageIdFrom(body) {
  const match = /message_id=(-?\d+)/.exec(String(body || ""));
  return match ? Number(match[1]) : null;
}

export function classifyComment(comment) {
  const body = String(comment?.body || "");
  const trimmed = body.trim();
  if (trimmed.startsWith(TELEGRAM_SENT_MARKER)) {
    return {
      kind: KINDS.CARD_SENT,
      actor: "system",
      marker: TELEGRAM_SENT_MARKER,
      data: { message_id: messageIdFrom(trimmed) },
    };
  }

  const decision = DECISION_MARKERS.find((entry) => trimmed.startsWith(entry.prefix));
  if (decision) {
    return {
      kind: decision.kind,
      actor: "owner",
      marker: decision.prefix,
      data: { via: "telegram" },
    };
  }

  const directivePlan = DIRECTIVE_PLAN_MARKERS.find((entry) => trimmed.startsWith(entry.prefix));
  if (directivePlan) {
    if (directivePlan.skip) return { skip: true };
    return {
      kind: directivePlan.kind,
      actor: "system",
      marker: directivePlan.prefix,
      data: {},
    };
  }

  const directiveCompletion = DIRECTIVE_COMPLETION_MARKERS.find((entry) => trimmed.startsWith(entry.prefix));
  if (directiveCompletion) {
    return {
      kind: directiveCompletion.kind,
      actor: "system",
      marker: directiveCompletion.prefix,
      data: {},
    };
  }

  return null;
}

function eventBase({ kind, subject, actor, ts, data, shadow }) {
  const event = {
    kind,
    subject,
    actor,
    source: LEDGER_WRITER_SOURCE,
    data,
    ts,
    shadow: shadow == null ? null : String(shadow),
  };
  event.data.ledgerWriterIdentity = eventIdentity(event);
  return event;
}

export function eventIdentity(event) {
  const d = event?.data || {};
  if (d.commentId) return `${event.kind}:comment:${d.commentId}`;
  if (event.kind === KINDS.DIRECTIVE_CREATED && d.issueId) {
    return `${event.kind}:issue:${d.issueId}`;
  }
  if (event.kind === KINDS.ISSUE_STATUS_CHANGED && d.issueId) {
    return `${event.kind}:issue:${d.issueId}:ts:${event.ts}:status:${d.status}`;
  }
  if (event.kind === KINDS.ISSUE_LABEL_CHANGED && d.issueId) {
    return `${event.kind}:issue:${d.issueId}:ts:${event.ts}:labels:${JSON.stringify([...(d.labels || [])].sort())}`;
  }
  return `${event.kind}:subject:${event.subject}:ts:${event.ts}:shadow:${event.shadow || ""}`;
}

function legacyEventIdentities(event) {
  const ids = new Set();
  if (!event || typeof event !== "object") return ids;
  if (event.data?.ledgerWriterIdentity) ids.add(String(event.data.ledgerWriterIdentity));
  const canonical = eventIdentity(event);
  if (canonical) ids.add(canonical);
  if (event.data?.commentId) ids.add(`${event.kind}:comment:${event.data.commentId}`);
  if (event.kind === KINDS.DIRECTIVE_CREATED && event.data?.issueId) {
    ids.add(`${event.kind}:issue:${event.data.issueId}`);
  }
  if (event.kind === KINDS.ISSUE_STATUS_CHANGED && event.data?.issueId) {
    ids.add(`${event.kind}:issue:${event.data.issueId}:ts:${event.ts}:status:${event.data.status}`);
  }
  if (event.kind === KINDS.ISSUE_LABEL_CHANGED && event.data?.issueId) {
    ids.add(`${event.kind}:issue:${event.data.issueId}:ts:${event.ts}:labels:${JSON.stringify([...(event.data.labels || [])].sort())}`);
  }
  return ids;
}

function missingIssueFact(issue, kind, reason, summary) {
  summary.unclassified += 1;
  summary.unclassifiedDetails.push({
    kind,
    issueId: issue?.id == null ? null : String(issue.id),
    identifier: subjectOf(issue),
    reason,
  });
}

function derivationSummary(summary) {
  if (summary && Array.isArray(summary.unclassifiedDetails)) return summary;
  return { unclassified: 0, unclassifiedDetails: [] };
}

export function deriveEventsForIssue(entry, folded = new Map(), summary = null) {
  summary = derivationSummary(summary);
  const issue = boardEntryIssue(entry);
  const subject = subjectOf(issue);
  const issueId = issue?.id == null ? null : String(issue.id);
  const labels = labelNamesOf(issue);
  const events = [];

  if (!subject || !issueId) {
    missingIssueFact(issue, "issue", "issue missing stable id or subject", summary);
    return events;
  }

  if (hasDirectiveLabel(issue)) {
    const createdTs = toIso(issue.createdAt || issue.created_at);
    if (!createdTs) {
      missingIssueFact(issue, KINDS.DIRECTIVE_CREATED, "directive issue missing createdAt", summary);
    } else {
      events.push(eventBase({
        kind: KINDS.DIRECTIVE_CREATED,
        subject,
        actor: "system",
        ts: createdTs,
        data: {
          issueId,
          identifier: subject,
          title: String(issue.title || ""),
          status: String(issue.status || ""),
          labels,
          boardTimestamp: createdTs,
        },
        shadow: issue.description == null ? null : String(issue.description),
      }));
    }
  }

  const foldedRecord = folded instanceof Map ? folded.get(subject) : null;
  const updatedTs = toIso(issue.updatedAt || issue.updated_at);
  if (foldedRecord && String(issue.status || "") && String(foldedRecord.status || "") !== String(issue.status || "")) {
    if (!updatedTs) {
      missingIssueFact(issue, KINDS.ISSUE_STATUS_CHANGED, "status differs but issue missing updatedAt", summary);
    } else {
      events.push(eventBase({
        kind: KINDS.ISSUE_STATUS_CHANGED,
        subject,
        actor: "system",
        ts: updatedTs,
        data: {
          issueId,
          identifier: subject,
          from: foldedRecord.status == null ? null : String(foldedRecord.status),
          status: String(issue.status),
          boardTimestamp: updatedTs,
        },
        shadow: null,
      }));
    }
  }

  if (foldedRecord && !sameStringSet(foldedRecord.labels || [], labels)) {
    if (!updatedTs) {
      missingIssueFact(issue, KINDS.ISSUE_LABEL_CHANGED, "labels differ but issue missing updatedAt", summary);
    } else {
      events.push(eventBase({
        kind: KINDS.ISSUE_LABEL_CHANGED,
        subject,
        actor: "system",
        ts: updatedTs,
        data: {
          issueId,
          identifier: subject,
          from: Array.isArray(foldedRecord.labels) ? foldedRecord.labels : [],
          labels,
          boardTimestamp: updatedTs,
        },
        shadow: null,
      }));
    }
  }

  const comments = commentsFromEntry(entry);
  if (Array.isArray(comments)) {
    for (const comment of commentsOldestFirst(comments)) {
      const commentId = comment?.id == null ? null : String(comment.id);
      const commentTs = toIso(comment?.createdAt || comment?.created_at || comment?.updatedAt || comment?.updated_at);
      const classified = classifyComment(comment);
      if (classified?.skip) {
        continue;
      }
      if (!classified) {
        summary.unclassified += 1;
        summary.unclassifiedDetails.push({
          issueId,
          identifier: subject,
          commentId,
          ts: commentTs,
          reason: "comment did not match a known ledger kind",
          excerpt: excerpt(comment?.body),
        });
        continue;
      }
      if (
        (classified.kind === KINDS.DIRECTIVE_PLAN_POSTED ||
          classified.kind === KINDS.DIRECTIVE_PLAN_REFUSED ||
          classified.kind === KINDS.EXECUTION_DONE) &&
        !hasDirectiveLabel(issue)
      ) {
        continue;
      }
      if (!commentId || !commentTs) {
        summary.unclassified += 1;
        summary.unclassifiedDetails.push({
          issueId,
          identifier: subject,
          commentId,
          ts: commentTs,
          reason: "classified comment missing id or timestamp",
          excerpt: excerpt(comment?.body),
        });
        continue;
      }
      events.push(eventBase({
        kind: classified.kind,
        subject,
        actor: classified.actor,
        ts: commentTs,
        data: {
          marker: classified.marker,
          ...classified.data,
          ...(classified.kind === KINDS.DIRECTIVE_PLAN_POSTED ||
          classified.kind === KINDS.DIRECTIVE_PLAN_REFUSED ||
          classified.kind === KINDS.EXECUTION_DONE
            ? { identifier: subject }
            : {}),
          commentId,
          issueId,
          boardTimestamp: commentTs,
        },
        shadow: comment.body == null ? "" : String(comment.body),
      }));
    }
  }

  return events;
}

export function sortEventsChronologically(events) {
  return [...events].sort((a, b) => {
    const byTs = String(a.ts || "").localeCompare(String(b.ts || ""));
    if (byTs !== 0) return byTs;
    return eventIdentity(a).localeCompare(eventIdentity(b));
  });
}

function eventsAlreadyPresent(events) {
  const ids = new Set();
  for (const event of events || []) {
    for (const id of legacyEventIdentities(event)) ids.add(id);
  }
  return ids;
}

function normalizeListResult(listResult) {
  if (listResult?.networkError) {
    return { issues: [], errors: [`issues list network error: ${listResult.networkErrorMessage || "unknown"}`] };
  }
  if (listResult?.authRequired) return { issues: [], errors: ["issues list auth required"] };
  if (Array.isArray(listResult)) return { issues: listResult, errors: [] };
  if (Array.isArray(listResult?.issues)) return { issues: listResult.issues, errors: [] };
  if (Array.isArray(listResult?.body)) return { issues: listResult.body, errors: [] };
  return { issues: [], errors: ["issues list returned no issues array"] };
}

async function resolveBase({ base, discoverPaperclipPort, summary }) {
  if (base) return base;
  let port = null;
  try {
    port = await discoverPaperclipPort(null, { attempts: 3, retryDelayMs: 1500 });
  } catch (err) {
    summary.errors.push(`Paperclip discovery failed: ${err && err.message ? err.message : String(err)}`);
    return null;
  }
  if (!port) {
    summary.errors.push("no Paperclip base resolved");
    return null;
  }
  return String(port).startsWith("http") ? String(port) : `http://127.0.0.1:${port}`;
}

async function fetchBoardEntries({ base, companyId, listIssues, httpGet, token, summary }) {
  let listResult;
  try {
    listResult = await listIssues(base, companyId, token ? { token } : {});
  } catch (err) {
    summary.errors.push(`issues list failed: ${err && err.message ? err.message : String(err)}`);
    return [];
  }

  const normalized = normalizeListResult(listResult);
  summary.errors.push(...normalized.errors);

  const entries = [];
  for (const raw of normalized.issues) {
    const issue = boardEntryIssue(raw);
    if (!issue || typeof issue !== "object") {
      summary.unclassified += 1;
      summary.unclassifiedDetails.push({ reason: "issue entry was not an object" });
      continue;
    }

    const embedded = commentsFromEntry(raw);
    if (Array.isArray(embedded)) {
      entries.push(raw?.issue ? raw : { issue, comments: embedded });
      continue;
    }

    let comments = [];
    try {
      const commentsRes = await httpGet(`${base}/api/issues/${issue.id}/comments`, token ? { token } : undefined);
      if (commentsRes?.networkError) {
        summary.errors.push(`${subjectOf(issue) || issue.id}: comments network error: ${commentsRes.networkErrorMessage || "unknown"}`);
      } else if (commentsRes?.authRequired) {
        summary.errors.push(`${subjectOf(issue) || issue.id}: comments auth required`);
      } else if (Array.isArray(commentsRes?.body)) {
        comments = commentsRes.body;
      } else if (Array.isArray(commentsRes)) {
        comments = commentsRes;
      } else {
        summary.errors.push(`${subjectOf(issue) || issue.id}: comments endpoint returned no array`);
      }
    } catch (err) {
      summary.errors.push(`${subjectOf(issue) || issue.id}: comments fetch failed: ${err && err.message ? err.message : String(err)}`);
    }

    entries.push({ issue, comments });
  }

  return entries;
}

export async function runLedgerWriterOnce(deps = {}) {
  const summary = {
    ok: true,
    derived: 0,
    appended: 0,
    alreadyPresent: 0,
    unclassified: 0,
    unclassifiedDetails: [],
    errors: [],
    base: deps.base || null,
    companyId: deps.companyId || CANONICAL_COMPANY_ID,
  };

  const readAll = deps.readAll || defaultReadAll;
  const appendMany = deps.appendMany || defaultAppendMany;
  const foldDirectives = deps.foldDirectives || defaultFoldDirectives;
  const listIssues = deps.listIssues || defaultListIssues;
  const httpGet = deps.httpGet || defaultHttpGet;
  const discoverPaperclipPort = deps.discoverPaperclipPort || defaultDiscoverPaperclipPort;
  const resolvePaperclipToken = deps.resolvePaperclipToken || defaultResolvePaperclipToken;
  const ledgerDeps = deps.ledgerDeps || {};

  let ledgerEvents = [];
  try {
    // ledger.mjs's readAll returns a RESULT OBJECT — { ok, events, corrupt,
    // corruptLines, reason } — not a bare array. Everything downstream here
    // iterates events, and the tests stubbed readAll with a plain array, so the
    // suite was green while the real call threw
    // "(events || []) is not iterable" on the first live run. Accept both
    // shapes: the object from the real module, and a bare array from a stub.
    const read = await readAll(ledgerDeps);
    ledgerEvents = Array.isArray(read) ? read : (read?.events ?? []);
    // A ledger that could not be read is NOT an empty ledger. Treating a failed
    // read as "no events" would make every derived event look missing and
    // append the entire board's history a second time.
    if (!Array.isArray(read) && read && read.ok === false) {
      summary.errors.push(`ledger read not ok: ${read.reason || "unknown reason"}`);
      summary.ok = false;
      return summary;
    }
  } catch (err) {
    summary.errors.push(`ledger read failed: ${err && err.message ? err.message : String(err)}`);
    summary.ok = false;
    return summary;
  }

  let folded = new Map();
  try {
    folded = foldDirectives(ledgerEvents, deps.projectionOpts || {});
  } catch (err) {
    summary.errors.push(`directive fold failed: ${err && err.message ? err.message : String(err)}`);
    summary.ok = false;
    return summary;
  }

  let token = null;
  try {
    token = await resolvePaperclipToken();
  } catch (err) {
    summary.errors.push(`Paperclip token resolution failed: ${err && err.message ? err.message : String(err)}`);
  }

  const base = await resolveBase({ base: deps.base, discoverPaperclipPort, summary });
  summary.base = base;
  if (!base) {
    summary.ok = false;
    return summary;
  }

  const entries = await fetchBoardEntries({
    base,
    companyId: summary.companyId,
    listIssues,
    httpGet,
    token,
    summary,
  });

  const derived = [];
  for (const entry of entries) {
    try {
      derived.push(...deriveEventsForIssue(entry, folded, summary));
    } catch (err) {
      const issue = boardEntryIssue(entry);
      summary.errors.push(`${subjectOf(issue) || issue?.id || "unknown issue"}: derivation failed: ${err && err.message ? err.message : String(err)}`);
    }
  }

  const ordered = sortEventsChronologically(derived);
  summary.derived = ordered.length;

  const present = eventsAlreadyPresent(ledgerEvents);
  const missing = [];
  for (const event of ordered) {
    const id = event.data.ledgerWriterIdentity;
    if (present.has(id)) {
      summary.alreadyPresent += 1;
    } else {
      present.add(id);
      missing.push(event);
    }
  }

  if (missing.length === 0) {
    summary.ok = summary.errors.length === 0;
    return summary;
  }

  try {
    const appended = await appendMany(missing, ledgerDeps);
    // appendMany does NOT throw on a rejected batch. It returns
    // { ok, seq, seqs, written, reason, index, broke } and reports validation
    // failures as ok:false. Counting missing.length as "appended" whenever the
    // return was not an array made this module claim 53 writes while the file
    // stayed at 329 lines — a green summary over a log that never changed,
    // which is worse than an error because nobody goes looking.
    //
    // Trust `written`/`seqs` when they are there, and treat ok:false as a
    // FAILURE that is reported with the writer's own reason.
    if (Array.isArray(appended)) {
      summary.appended = appended.length;
    } else if (appended && typeof appended === "object") {
      summary.appended = Number.isFinite(appended.written)
        ? appended.written
        : (Array.isArray(appended.seqs) ? appended.seqs.length : 0);
      if (appended.ok === false) {
        summary.errors.push(
          `ledger append rejected: ${appended.reason || "unknown reason"}` +
            (Number.isFinite(appended.index) ? ` (at event index ${appended.index})` : ""),
        );
        summary.ok = false;
        return summary;
      }
    } else {
      summary.appended = 0;
    }
  } catch (err) {
    summary.errors.push(`ledger append failed: ${err && err.message ? err.message : String(err)}`);
    summary.ok = false;
    return summary;
  }

  summary.ok = summary.errors.length === 0;
  return summary;
}

export const runOnce = runLedgerWriterOnce;
export const sweepOnce = runLedgerWriterOnce;

async function main() {
  if (!process.argv.includes("--once")) {
    console.log("usage: node ops-watcher/ledger-writer.mjs --once");
    return;
  }
  const summary = await runLedgerWriterOnce();
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.log(JSON.stringify({
      ok: false,
      derived: 0,
      appended: 0,
      alreadyPresent: 0,
      unclassified: 0,
      unclassifiedDetails: [],
      errors: [`ledger-writer crashed before summary: ${err && err.message ? err.message : String(err)}`],
    }, null, 2));
  });
}
