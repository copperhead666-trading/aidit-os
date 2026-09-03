// scripts/migrate-to-ledger.mjs
//
// Move FounderOS's truth out of Paperclip's Postgres and into git, then prove
// the move lost nothing.
//
// The repo's only in-repo copy of the board is 33 markdown files from 29 August
// whose curation rules deliberately DROP every OWNER_REQUIRED issue — so the
// owner's own decisions are exactly the part that is missing. This script makes
// a verbatim copy instead, derives a typed event ledger from it, and then
// re-derives every directive's state both ways and refuses the cutover if the
// two disagree.
//
//   node scripts/migrate-to-ledger.mjs --export     # live board -> state/import/
//   node scripts/migrate-to-ledger.mjs --derive     # state/import/ -> state/ledger.jsonl
//   node scripts/migrate-to-ledger.mjs --compare    # THE GATE: exit 0 only on zero differences
//   node scripts/migrate-to-ledger.mjs --export --derive --compare --dry-run
//
// The owner chose a one-session cutover with no dual-write period. --compare is
// therefore the only thing standing between him and a silent data loss, so it
// exits non-zero on any difference and says so in words that cannot be misread.
//
// READ-ONLY against Paperclip. This module does not import httpPost or
// httpPatch and never issues one; the only network seam is `_get`.
//
// Every seam is injectable (`_get`, `_fs`, `_now`, `listIssuesFn`, `appendMany`,
// `foldDirectives`, `discoverPort`) so the whole thing tests offline.

import path from "node:path";
import { promises as realFs } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  discoverPaperclipPort,
  httpGet,
  listIssues,
  CANONICAL_COMPANY_ID,
} from "../ops-watcher/paperclip-write-client.mjs";
import {
  classifyDirective,
  commentsOldestFirst,
  PLAN_MARKER,
  APPROVED_MARKER,
  REJECTED_MARKER,
  RESULT_MARKER,
  REFUSED_MARKER,
  DISPATCH_MARKER,
  EXECUTION_CAP_MARKER,
  UNEXECUTABLE_MARKER,
} from "../ops-watcher/directive-runner.mjs";
import { KINDS, makeEvent, validateEvent } from "../ops-watcher/ledger-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
export const IMPORT_DIR = path.join(REPO_ROOT, "state", "import");
export const LEDGER_FILE = path.join(REPO_ROOT, "state", "ledger.jsonl");

// ── markers their owning module keeps private ─────────────────────────────
// directive-runner.mjs exports most of its marker strings but keeps these as
// module-private `const`s (directive-runner.mjs:104, :135-136), and
// telegram-listener.mjs keeps DECISION_COMMENT_PREFIX private too. Copied here
// verbatim rather than exported from there, because this script may not edit
// those files. `t_markerStringsHaveNotDrifted` in the regression suite reads
// both source files and fails if any copy below stops matching the original —
// that check is the reason a copy is acceptable at all.
export const ATTEMPT_CAP_MARKER = "DIRECTIVE OWNER REQUIRED";
export const EXECUTION_CAP_BRIDGE_PHRASE = "eksekusi gagal identik";
export const DECISION_APPROVE_PREFIX = "OWNER MENYETUJUI via Telegram";
export const DECISION_REJECT_PREFIX = "OWNER MENOLAK via Telegram";
export const DECISION_DEFER_PREFIX = "OWNER MENUNDA via Telegram";
export const DECISION_ESCALATE_PREFIX = "OWNER MENGESKALASI ke AHMAD via Telegram";
// telegram-notify.mjs:79 + :242. This is the ONLY Telegram-message-to-issue
// mapping that exists anywhere in the system; if it does not survive the
// migration, every card the owner was ever sent becomes unattributable.
export const TELEGRAM_SENT_MARKER = "[TELEGRAM SENT]";

/**
 * Files that exist nowhere else on disk. The mapping found no second copy of
 * any of them, and heartbeat-steps.jsonl is 4.5 MB against a 5 MB rotation
 * threshold — its oldest history is one sweep away from being discarded.
 */
export const SIDECAR_FILES = Object.freeze([
  "ops-watcher/lane-usage.jsonl",
  "ops-watcher/self-repair-log.jsonl",
  "ops-watcher/events.jsonl",
  "ops-watcher/heartbeat-steps.jsonl",
  "ops-watcher/learning-os-state.json",
  "ops-watcher/pm2-supervisor-log.jsonl",
  // attemptCapDecisionResets and the getUpdates offset live only here.
  "ops-watcher/directive-runner-state.json",
  "ops-watcher/telegram-listener.state.json",
]);

// ── small helpers ─────────────────────────────────────────────────────────

function bodyOf(c) {
  return String(c && c.body != null ? c.body : "");
}

function toIso(value, fallbackIso) {
  const t = Date.parse(value == null ? "" : String(value));
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return fallbackIso;
}

function labelNamesOf(issue) {
  return (Array.isArray(issue?.labels) ? issue.labels : [])
    .map((l) => (typeof l === "string" ? l : l && l.name))
    .filter(Boolean)
    .map(String);
}

export function subjectOf(issue) {
  const s = issue?.identifier || issue?.id || null;
  return s == null || String(s).trim() === "" ? null : String(s);
}

/** Date stamp for the export filename, in UTC, so two runs on one day collide deliberately. */
export function exportFileName(nowMs) {
  return `paperclip-${new Date(nowMs).toISOString().slice(0, 10)}.json`;
}

// ── the marker vocabulary ─────────────────────────────────────────────────

/**
 * Turn one comment body into the fact it records.
 *
 * Nothing is ever discarded: a body that matches no marker becomes
 * KINDS.IMPORTED, so an unhandled case costs a weaker type, never a lost fact.
 *
 * Order matters and is not arbitrary:
 *   - APPROVED/REJECTED contain PLAN_MARKER as a substring, so they go first;
 *   - the execution cap starts with its own marker, but execution-cap reports
 *     posted before the marker was split start with the ATTEMPT cap marker and
 *     mention "eksekusi gagal identik" (directive-runner.mjs:193-197);
 *   - REFUSED is checked before PLAN because isPlanComment excludes refusals.
 *
 * @returns {{kind: string, actor: string, data: object}}
 */
export function classifyCommentBody(rawBody) {
  const body = bodyOf({ body: rawBody });
  const trimmed = body.trim();

  // The Telegram-to-issue mapping. Must survive, with the id, or the link
  // between a card the owner tapped and the issue it belonged to is gone.
  if (trimmed.startsWith(TELEGRAM_SENT_MARKER)) {
    const m = /message_id=(-?\d+)/.exec(trimmed);
    return {
      kind: KINDS.CARD_SENT,
      actor: "system",
      data: { marker: TELEGRAM_SENT_MARKER, message_id: m ? Number(m[1]) : null },
    };
  }

  // What the owner said, in the exact wording telegram-listener.mjs writes.
  if (trimmed.startsWith(DECISION_APPROVE_PREFIX)) {
    return { kind: KINDS.DECISION_APPROVED, actor: "owner", data: { marker: DECISION_APPROVE_PREFIX, via: "telegram" } };
  }
  if (trimmed.startsWith(DECISION_REJECT_PREFIX)) {
    return { kind: KINDS.DECISION_REJECTED, actor: "owner", data: { marker: DECISION_REJECT_PREFIX, via: "telegram" } };
  }
  if (trimmed.startsWith(DECISION_DEFER_PREFIX)) {
    return { kind: KINDS.DECISION_DEFERRED, actor: "owner", data: { marker: DECISION_DEFER_PREFIX, via: "telegram" } };
  }
  if (trimmed.startsWith(DECISION_ESCALATE_PREFIX)) {
    return { kind: KINDS.DECISION_ESCALATED, actor: "owner", data: { marker: DECISION_ESCALATE_PREFIX, via: "telegram" } };
  }

  // The brakes.
  if (trimmed.startsWith(EXECUTION_CAP_MARKER) ||
      (trimmed.startsWith(ATTEMPT_CAP_MARKER) && trimmed.includes(EXECUTION_CAP_BRIDGE_PHRASE))) {
    return { kind: KINDS.CAP_EXECUTION_REACHED, actor: "system", data: { marker: EXECUTION_CAP_MARKER } };
  }
  if (trimmed.startsWith(ATTEMPT_CAP_MARKER)) {
    return { kind: KINDS.CAP_ATTEMPT_REACHED, actor: "system", data: { marker: ATTEMPT_CAP_MARKER } };
  }
  if (trimmed.startsWith(UNEXECUTABLE_MARKER)) {
    return { kind: KINDS.DIRECTIVE_UNEXECUTABLE, actor: "system", data: { marker: UNEXECUTABLE_MARKER } };
  }

  // The directive's own lifecycle.
  if (body.includes(REFUSED_MARKER)) {
    return { kind: KINDS.DIRECTIVE_PLAN_REFUSED, actor: "system", data: { marker: REFUSED_MARKER } };
  }
  if (body.includes(APPROVED_MARKER)) {
    return { kind: KINDS.DECISION_APPROVED, actor: "owner", data: { marker: APPROVED_MARKER, via: "comment" } };
  }
  if (body.includes(REJECTED_MARKER)) {
    return { kind: KINDS.DECISION_REJECTED, actor: "owner", data: { marker: REJECTED_MARKER, via: "comment" } };
  }
  if (body.includes(RESULT_MARKER)) {
    return { kind: KINDS.EXECUTION_DONE, actor: "system", data: { marker: RESULT_MARKER } };
  }
  if (body.includes(PLAN_MARKER)) {
    return { kind: KINDS.DIRECTIVE_PLAN_POSTED, actor: "system", data: { marker: PLAN_MARKER } };
  }
  if (body.includes(DISPATCH_MARKER)) {
    return { kind: KINDS.DISPATCH_CLAIMED, actor: "agent", data: { marker: DISPATCH_MARKER } };
  }

  // Unrecognised. Kept, not dropped — the body is preserved in `shadow` by the
  // caller, so a marker nobody thought of is still fully recoverable later.
  return { kind: KINDS.IMPORTED, actor: "system", data: { marker: null } };
}

// ── derivation ────────────────────────────────────────────────────────────

/**
 * One issue and its comments -> the events they record.
 *
 * `ts` is always the fact's own time (the comment's createdAt), never now.
 * `source` is always "migration", so a later reader can always tell a fact that
 * was observed live from one reconstructed out of a comment body.
 * `shadow` always carries the original body, verbatim and unreformatted.
 */
export function deriveEventsForIssue(entry, { fallbackIso } = {}) {
  const issue = entry?.issue || {};
  const subject = subjectOf(issue);
  const fallback = fallbackIso || "1970-01-01T00:00:00.000Z";
  const createdIso = toIso(issue.createdAt || issue.created_at, fallback);
  const events = [];

  // The issue itself. classifyDirective's answer depends on the issue's status
  // and labels as much as on its comments ("ignored" without a DIRECTIVE label,
  // "new" for todo/backlog), so a projection reading only the ledger needs them
  // here or it can never agree with the old classifier.
  events.push(makeEvent({
    kind: KINDS.DIRECTIVE_CREATED,
    subject,
    actor: "system",
    source: "migration",
    ts: createdIso,
    data: {
      issueId: issue.id == null ? null : String(issue.id),
      identifier: subject,
      title: String(issue.title == null ? "" : issue.title),
      // Status and labels as observed at export time, not at creation time —
      // Paperclip keeps no history of either, so this is the only truth there is.
      status: String(issue.status == null ? "" : issue.status),
      labels: labelNamesOf(issue),
      observedAt: entry?.observedAt || fallback,
    },
    shadow: issue.description == null ? null : String(issue.description),
  }));

  // Paperclip's comments endpoint returns NEWEST FIRST. Sorting by the parsed
  // createdAt is not optional: reading them in arrival order is exactly the
  // KOL-73 bug, where every new plan was approved and then ignored in favour of
  // the oldest one. commentsOldestFirst is the repo's one sorter; reuse it
  // rather than adding a fourth copy of the same logic.
  const ordered = commentsOldestFirst(Array.isArray(entry?.comments) ? entry.comments : []);
  for (const c of ordered) {
    const body = bodyOf(c);
    const { kind, actor, data } = classifyCommentBody(body);
    const ts = toIso(c?.createdAt || c?.created_at || c?.updatedAt || c?.updated_at, createdIso);
    events.push(makeEvent({
      kind,
      subject,
      actor,
      source: "migration",
      ts,
      data: {
        ...data,
        commentId: c?.id == null ? null : String(c.id),
        issueId: issue.id == null ? null : String(issue.id),
      },
      // Verbatim. Nothing reformatted, nothing truncated.
      shadow: body,
    }));
  }
  return events;
}

/** The whole export document -> every event it records, issue order preserved. */
export function deriveEvents(doc, { fallbackIso } = {}) {
  const entries = Array.isArray(doc?.issues) ? doc.issues : [];
  const out = [];
  for (const entry of entries) {
    for (const ev of deriveEventsForIssue(entry, { fallbackIso: fallbackIso || doc?.exportedAt })) {
      out.push(ev);
    }
  }
  return out;
}

/**
 * The identity of a derived fact, for idempotency.
 *
 * A comment id is the strongest key the board gives us; where one is missing
 * (the synthetic directive.created event) the kind + subject + ts + shadow
 * triple is stable across runs because none of them is derived from the clock.
 */
export function eventIdentity(ev) {
  return JSON.stringify([
    ev.kind,
    ev.subject,
    ev.ts,
    ev.data && ev.data.commentId != null ? ev.data.commentId : null,
    ev.shadow == null ? null : ev.shadow,
  ]);
}

// ── ledger I/O (read-only here; writing goes through ledger.appendMany) ────

/**
 * ledger.mjs and projections.mjs are written by other agents against the same
 * ledger-schema.mjs contract. They are imported lazily and are overridable, so
 * this module — and its offline suite — load and run whether or not those files
 * have landed yet.
 */
async function resolveAppendMany(deps) {
  if (typeof deps?.appendMany === "function") return deps.appendMany;
  const mod = await import("../ops-watcher/ledger.mjs");
  return mod.appendMany;
}

async function resolveFoldDirectives(deps) {
  if (typeof deps?.foldDirectives === "function") return deps.foldDirectives;
  const mod = await import("../ops-watcher/projections.mjs");
  return mod.foldDirectives;
}

export async function readLedger(file, _fs = realFs) {
  let text;
  try {
    text = await _fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* a torn line is not a reason to lose the rest */ }
  }
  return out;
}

// ── --export ──────────────────────────────────────────────────────────────

/**
 * Pull every issue and every comment, verbatim. No curation, no reformatting,
 * nothing dropped — the 29 August markdown export's curation rules are the
 * reason this script exists.
 */
export async function runExport(opts = {}, deps = {}) {
  const _fs = deps._fs || realFs;
  const _get = deps._get || httpGet;
  const _now = deps._now || Date.now;
  const listIssuesFn = deps.listIssues || listIssues;
  const discoverPort = deps.discoverPort || discoverPaperclipPort;
  const log = deps.log || console.log;
  const companyId = opts.companyId || CANONICAL_COMPANY_ID;
  const importDir = opts.importDir || IMPORT_DIR;

  // One resolution path, the same one directive-runner.mjs uses
  // (directive-runner.mjs:990-994). There are already three copies of this in
  // the repo; this is not a fourth.
  const base = opts.base !== undefined
    ? opts.base
    : await (async () => {
      const port = await discoverPort();
      return port ? `http://127.0.0.1:${port}` : null;
    })();
  if (!base) return { ok: false, reason: "no Paperclip base resolved", issues: [] };

  const issuesRes = await listIssuesFn(base, companyId);
  if (issuesRes.networkError) return { ok: false, reason: `issues list network error: ${issuesRes.networkErrorMessage}`, issues: [] };
  if (issuesRes.authRequired) return { ok: false, reason: "issues list auth required", issues: [] };

  const nowMs = typeof _now === "function" ? _now() : _now;
  const observedAt = new Date(nowMs).toISOString();
  const issues = Array.isArray(issuesRes.issues) ? issuesRes.issues : [];
  const entries = [];
  const errors = [];
  let commentCount = 0;

  for (const issue of issues) {
    // GET only. This module imports no writer.
    const cRes = await _get(`${base}/api/issues/${issue.id}/comments`);
    if (cRes.networkError) {
      errors.push(`${subjectOf(issue)}: comments network error: ${cRes.networkErrorMessage}`);
      continue;
    }
    const comments = Array.isArray(cRes.body) ? cRes.body : [];
    commentCount += comments.length;
    // Verbatim: the issue and its comments exactly as the board returned them,
    // in the order the board returned them (newest first). --derive sorts.
    entries.push({ issue, comments, observedAt });
  }

  const doc = {
    exportedAt: observedAt,
    base,
    companyId,
    issueCount: entries.length,
    commentCount,
    errors,
    issues: entries,
  };

  const fileName = opts.fileName || exportFileName(nowMs);
  const exportPath = path.join(importDir, fileName);
  await _fs.mkdir(importDir, { recursive: true });
  await _fs.writeFile(exportPath, JSON.stringify(doc, null, 2), "utf8");

  const sidecars = await copySidecars({ importDir }, { _fs, log });

  log(`export: ${entries.length} issues, ${commentCount} comments -> ${exportPath}`);
  if (errors.length) log(`export: ${errors.length} issue(s) had comment errors — see "errors" in the file`);
  return { ok: true, exportPath, doc, sidecars, errors };
}

/**
 * Copy the eight files that exist nowhere else. A missing one is reported, not
 * fatal: losing the export over an absent optional sidecar would be the worse
 * outcome, and heartbeat-steps.jsonl is the one that cannot wait.
 */
export async function copySidecars(opts = {}, deps = {}) {
  const _fs = deps._fs || realFs;
  const log = deps.log || console.log;
  const importDir = opts.importDir || IMPORT_DIR;
  const names = opts.files || SIDECAR_FILES;
  await _fs.mkdir(importDir, { recursive: true });

  const results = [];
  for (const rel of names) {
    const src = path.join(REPO_ROOT, rel);
    const dest = path.join(importDir, path.basename(rel));
    try {
      const data = await _fs.readFile(src);
      await _fs.writeFile(dest, data);
      results.push({ file: rel, dest, bytes: data.length, copied: true });
    } catch (err) {
      log(`export: sidecar MISSING or unreadable: ${rel} (${err && err.message ? err.message : err})`);
      results.push({ file: rel, dest, bytes: 0, copied: false, reason: String(err && err.message ? err.message : err) });
    }
  }
  return results;
}

// ── --derive ──────────────────────────────────────────────────────────────

/**
 * Export -> ledger, through ledger.appendMany.
 *
 * Idempotent by construction: every derived event's identity is a pure function
 * of the export, so a second run finds all of them already present and appends
 * nothing. Running --derive twice must not double the ledger.
 */
export async function runDerive(opts = {}, deps = {}) {
  const _fs = deps._fs || realFs;
  const log = deps.log || console.log;
  const ledgerFile = opts.ledgerFile || LEDGER_FILE;
  const doc = opts.doc || JSON.parse(await _fs.readFile(opts.exportPath, "utf8"));

  const events = deriveEvents(doc);
  const invalid = [];
  for (const ev of events) {
    // seq is the writer's to assign, so validate everything else by lending a
    // placeholder rather than asserting a field this module does not own.
    const v = validateEvent({ ...ev, seq: 1 });
    if (!v.ok) invalid.push({ kind: ev.kind, subject: ev.subject, reason: v.reason });
  }

  const existing = new Set((await readLedger(ledgerFile, _fs)).map(eventIdentity));
  const fresh = events.filter((ev) => !existing.has(eventIdentity(ev)));

  if (opts.dryRun) {
    log(`derive (dry run): ${events.length} events derived, ${fresh.length} new, ${events.length - fresh.length} already in the ledger — nothing written`);
    return { ok: invalid.length === 0, derived: events.length, appended: 0, skipped: events.length - fresh.length, invalid, events, dryRun: true };
  }

  let appended = 0;
  if (fresh.length) {
    const appendMany = await resolveAppendMany(deps);
    const res = await appendMany(fresh, { file: ledgerFile });
    appended = res && typeof res.written === "number" ? res.written : fresh.length;
  }
  log(`derive: ${events.length} events derived, ${appended} appended, ${events.length - fresh.length} already present -> ${ledgerFile}`);
  if (invalid.length) log(`derive: ${invalid.length} event(s) FAILED schema validation — see the returned "invalid" list`);
  return { ok: invalid.length === 0, derived: events.length, appended, skipped: events.length - fresh.length, invalid, events };
}

// ── --compare: the gate ───────────────────────────────────────────────────

function stateStringOf(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.state === "string") return v.state;
  return null;
}

/**
 * Ask projections for every subject's state, tolerating either shape the
 * projection may take: one call over the whole ledger returning a Map / object
 * / array keyed by subject, or one call per subject.
 */
export async function projectStates(foldDirectives, events, subjects) {
  const out = new Map();
  let whole;
  try {
    whole = await foldDirectives(events);
  } catch {
    whole = undefined;
  }

  if (whole instanceof Map) {
    for (const s of subjects) out.set(s, stateStringOf(whole.get(s)));
    return out;
  }
  if (Array.isArray(whole)) {
    const bySubject = new Map(whole.map((r) => [r && r.subject, r]));
    for (const s of subjects) out.set(s, stateStringOf(bySubject.get(s)));
    return out;
  }
  if (whole && typeof whole === "object" && subjects.some((s) => Object.prototype.hasOwnProperty.call(whole, s))) {
    for (const s of subjects) out.set(s, stateStringOf(whole[s]));
    return out;
  }

  // Per-subject shape.
  for (const s of subjects) {
    const subset = events.filter((e) => e.subject === s);
    out.set(s, stateStringOf(await foldDirectives(subset, { subject: s })));
  }
  return out;
}

/**
 * THE GATE.
 *
 * For every issue in the export, compute the state twice — once the old way
 * (classifyDirective over the live comments) and once the new way
 * (foldDirectives over the derived ledger) — and refuse the cutover if they
 * disagree anywhere. There is no dual-write period to catch a mistake later.
 */
export async function runCompare(opts = {}, deps = {}) {
  const _fs = deps._fs || realFs;
  const _now = deps._now || Date.now;
  const log = deps.log || console.log;
  const ledgerFile = opts.ledgerFile || LEDGER_FILE;
  const doc = opts.doc || JSON.parse(await _fs.readFile(opts.exportPath, "utf8"));
  const events = opts.events || await readLedger(ledgerFile, _fs);
  const foldDirectives = await resolveFoldDirectives(deps);

  const entries = Array.isArray(doc?.issues) ? doc.issues : [];
  const subjects = entries.map((e) => subjectOf(e?.issue));
  const projected = await projectStates(foldDirectives, events, subjects);

  const rows = [];
  const differences = [];
  for (const entry of entries) {
    const issue = entry?.issue || {};
    const subject = subjectOf(issue);
    const oldState = classifyDirective(issue, entry?.comments || [], { now: _now }).state;
    const newState = projected.get(subject);
    const row = { subject, oldState, newState: newState == null ? "(absent)" : newState };
    rows.push(row);
    if (row.oldState !== row.newState) differences.push(row);
  }

  if (differences.length) {
    const w = Math.max(7, ...differences.map((d) => String(d.subject).length));
    log("");
    log(`${"ISSUE".padEnd(w)}  ${"OLD (classifyDirective)".padEnd(24)}  NEW (foldDirectives)`);
    log(`${"-".repeat(w)}  ${"-".repeat(24)}  ${"-".repeat(20)}`);
    for (const d of differences) {
      log(`${String(d.subject).padEnd(w)}  ${String(d.oldState).padEnd(24)}  ${d.newState}`);
    }
    log("");
    log(`${differences.length} DIFFERENCES — DO NOT CUT OVER`);
    return { ok: false, exitCode: 1, compared: rows.length, differences, rows };
  }

  log("");
  log(`compared ${rows.length} issues, both ways`);
  log("ZERO DIFFERENCES — safe to cut over");
  return { ok: true, exitCode: 0, compared: rows.length, differences, rows };
}

// ── CLI ───────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = { export: false, derive: false, compare: false, dryRun: false, exportPath: null, ledgerFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--export") args.export = true;
    else if (a === "--derive") args.derive = true;
    else if (a === "--compare") args.compare = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--export-file") args.exportPath = argv[++i] || null;
    else if (a === "--ledger") args.ledgerFile = argv[++i] || null;
  }
  return args;
}

/** The newest paperclip-*.json in state/import/, so --derive needs no argument. */
export async function newestExportPath(importDir, _fs = realFs) {
  let names;
  try {
    names = await _fs.readdir(importDir);
  } catch {
    return null;
  }
  const picks = names.filter((n) => /^paperclip-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  return picks.length ? path.join(importDir, picks[picks.length - 1]) : null;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const _fs = deps._fs || realFs;
  const log = deps.log || console.log;
  const args = parseArgs(argv);
  const importDir = deps.importDir || IMPORT_DIR;
  const ledgerFile = args.ledgerFile || deps.ledgerFile || LEDGER_FILE;

  if (!args.export && !args.derive && !args.compare) {
    log("usage: node scripts/migrate-to-ledger.mjs [--export] [--derive] [--compare] [--dry-run]");
    return 2;
  }

  let doc = null;
  let exportPath = args.exportPath;

  if (args.export) {
    // --dry-run still writes state/import/: that directory IS the safe place,
    // and an export that wrote nothing could not be compared against anything.
    const res = await runExport({ importDir }, deps);
    if (!res.ok) { log(`export FAILED: ${res.reason}`); return 1; }
    doc = res.doc;
    exportPath = res.exportPath;
  }

  if (args.derive || args.compare) {
    if (!doc) {
      exportPath = exportPath || await newestExportPath(importDir, _fs);
      if (!exportPath) { log("no export found in state/import/ — run --export first"); return 1; }
      doc = JSON.parse(await _fs.readFile(exportPath, "utf8"));
    }
  }

  // Events derived in this same invocation. A dry run deliberately writes no
  // ledger, so a --compare that only ever read the file would find nothing and
  // report every issue as "(absent)" — a gate that refuses for a plumbing
  // reason rather than a data one, which is exactly as useless as a gate that
  // always says yes. Hand the in-memory events straight to the comparison.
  let derivedEvents = null;

  if (args.derive) {
    const res = await runDerive({ doc, ledgerFile, dryRun: args.dryRun }, deps);
    if (!res.ok) { log("derive FAILED schema validation — DO NOT CUT OVER"); return 1; }
    derivedEvents = Array.isArray(res.events) ? res.events : null;
  }

  if (args.compare) {
    // Only substitute when the ledger on disk cannot be the answer: a dry run
    // wrote nothing. A real run must be compared against what actually landed,
    // because "what I meant to write" is not evidence that it was written.
    // deriveEvents deliberately leaves seq unset — assigning it is the ledger
    // writer's job, and this run never reaches the writer. The projection
    // rejects an event without a seq, so a dry run has to lend provisional
    // ones. They are positional, matching the order appendMany would have
    // written, so the comparison sees exactly what a real run would produce.
    const events = args.dryRun && args.derive && derivedEvents
      ? derivedEvents.map((ev, i) => ({ ...ev, seq: i + 1 }))
      : null;
    const res = await runCompare({ doc, ledgerFile, events }, deps);
    return res.exitCode;
  }

  return 0;
}

const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}
