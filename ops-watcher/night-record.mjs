// ops-watcher/night-record.mjs
//
// What happened while he slept.
//
// maybeSendDigest already reports what is WAITING, once a day, to Telegram with
// a Cockpit link. Nothing reports what was DONE. The ledger has held the events
// all along — directive.* and execution.* — and nothing rendered them, which is
// the same shape as config/skill-matrix.json spending weeks as display-only
// config: data nobody reads is not a record, it is a file.
//
// This is the FOLD ONLY. It lives here rather than in cockpit/lib because
// ops-watcher/run-all-tests.mjs reads ops-watcher/ and nothing else, and a fold
// nobody can test is how a night gets reported wrong. The Cockpit imports it
// and renders; it does not decide.
//
// Telegram stays a one-way bell. The record belongs in the surface he acts in.

import { KINDS } from "./ledger-schema.mjs";
import { dayKey } from "./telegram-notify.mjs";

// The kinds that say something ran, and what came of it.
const OUTCOME_KINDS = new Map([
  [KINDS.EXECUTION_DONE, "done"],
  [KINDS.EXECUTION_NOOP, "no-op"],
  [KINDS.EXECUTION_FAILED, "failed"],
  [KINDS.EXECUTION_REVERTED, "reverted"],
]);

// Everything that ends with the owner having to look at it. CARD_SENT is in
// here because a card sent and not yet answered is the commonest way something
// waits; the answer kinds below clear it.
const AWAITING_KINDS = new Set([
  KINDS.DECISION_ESCALATED,
  KINDS.CARD_SENT,
  KINDS.CAP_ATTEMPT_REACHED,
  KINDS.CAP_EXECUTION_REACHED,
  KINDS.DIRECTIVE_UNEXECUTABLE,
  KINDS.DIRECTIVE_PLAN_REFUSED,
]);

// If he already answered, it is not waiting. Reporting an answered card as
// pending is how a morning review gets padded with work that is already done.
const ANSWERED_KINDS = new Set([
  KINDS.DECISION_APPROVED,
  KINDS.DECISION_REJECTED,
  KINDS.DECISION_DEFERRED,
  KINDS.DECISION_OPTION_CHOSEN,
  KINDS.DECISION_REVISION_REQUESTED,
]);

function subjectOf(event) {
  return String(event?.subject || event?.data?.identifier || "").trim() || "(unknown)";
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((x) => typeof x === "string" && x.trim()) : [];
}

/**
 * Fold ledger events into one record per directive for a given day.
 *
 * Returns { day, ran, awaiting, counts, quiet }.
 *
 * `quiet` is the point of the whole thing. A night with nothing done must SAY
 * so — an empty frame reads as a broken page, and the owner cannot tell the
 * difference between "nothing needed doing" and "the loop never woke up".
 *
 * The options are annotated because the Cockpit imports this module directly
 * and TypeScript infers the parameter types from here. Without the annotation
 * it reads `day = null` as "day is always null" and rejects a real day string
 * at the call site.
 *
 * @param {unknown[]} events
 * @param {{ day?: string | null, now?: (() => number) | number }} [options]
 */
export function foldNight(events, { day = null, now = Date.now } = {}) {
  const target = day || dayKey(typeof now === "function" ? now() : now);
  const list = Array.isArray(events) ? events : [];

  const byDirective = new Map();
  const awaiting = [];
  const answered = new Set();

  const touch = (id) => {
    if (!byDirective.has(id)) {
      byDirective.set(id, {
        identifier: id,
        outcome: null,
        filesChanged: [],
        verify: null,
        verifyOk: null,
        reason: null,
        startedAt: null,
        finishedAt: null,
        awaitsOwner: false,
      });
    }
    return byDirective.get(id);
  };

  for (const event of list) {
    const ts = String(event?.ts || "");
    if (!ts) continue;
    const eventDay = dayKey(Date.parse(ts));
    if (eventDay !== target) continue;

    const id = subjectOf(event);
    const kind = String(event?.kind || "");
    const data = event?.data && typeof event.data === "object" ? event.data : {};

    if (kind === KINDS.EXECUTION_STARTED) {
      const rec = touch(id);
      rec.startedAt = rec.startedAt || ts;
      continue;
    }

    if (OUTCOME_KINDS.has(kind)) {
      const rec = touch(id);
      rec.outcome = OUTCOME_KINDS.get(kind);
      rec.finishedAt = ts;
      const files = asArray(data.filesChanged || data.files);
      if (files.length) rec.filesChanged = files;
      if (typeof data.verify === "string" && data.verify.trim()) rec.verify = data.verify.trim();
      // A verify result is only claimed when the ledger actually carries one.
      // Inferring "green" from a done outcome would be reporting a check that
      // may never have run.
      if (typeof data.verifyOk === "boolean") rec.verifyOk = data.verifyOk;
      else if (rec.outcome === "done" && rec.verify) rec.verifyOk = true;
      else if (rec.outcome === "reverted") rec.verifyOk = false;
      if (typeof data.reason === "string" && data.reason.trim()) rec.reason = data.reason.trim();
      continue;
    }

    if (ANSWERED_KINDS.has(kind)) {
      answered.add(id);
      continue;
    }

    if (AWAITING_KINDS.has(kind)) {
      const rec = touch(id);
      rec.awaitsOwner = true;
      if (!rec.reason && typeof data.reason === "string" && data.reason.trim()) rec.reason = data.reason.trim();
      awaiting.push({ identifier: id, kind, at: ts, reason: rec.reason });
    }
  }

  // Only directives that actually ran belong in "ran". A directive that merely
  // had its plan refused never executed, and listing it as work done would be
  // the report claiming credit for a refusal.
  const ran = [...byDirective.values()]
    .filter((r) => r.outcome !== null)
    .sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));

  const counts = { done: 0, "no-op": 0, failed: 0, reverted: 0 };
  for (const r of ran) if (counts[r.outcome] !== undefined) counts[r.outcome] += 1;

  const awaitingUnique = [];
  const seen = new Set();
  for (const a of awaiting) {
    if (answered.has(a.identifier)) continue;
    const key = `${a.identifier}:${a.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    awaitingUnique.push(a);
  }
  for (const rec of byDirective.values()) if (answered.has(rec.identifier)) rec.awaitsOwner = false;

  return {
    day: target,
    ran,
    awaiting: awaitingUnique,
    counts,
    quiet: ran.length === 0 && awaitingUnique.length === 0,
  };
}

/**
 * One sentence for the top of the page, in the owner's language.
 *
 * A quiet night says it plainly. "Nothing ran" and a blank page are different
 * claims, and only one of them is honest about the loop having been awake.
 */
export function nightHeadline(record) {
  if (!record || record.quiet) {
    return `Tidak ada directive yang dijalankan pada ${record?.day || "hari ini"}. Sistem berjalan dan tidak menemukan pekerjaan yang siap dieksekusi.`;
  }
  const parts = [];
  if (record.counts.done) parts.push(`${record.counts.done} selesai`);
  if (record.counts.reverted) parts.push(`${record.counts.reverted} dikembalikan`);
  if (record.counts.failed) parts.push(`${record.counts.failed} gagal`);
  if (record.counts["no-op"]) parts.push(`${record.counts["no-op"]} tanpa perubahan`);
  const ranText = parts.length ? parts.join(", ") : "tidak ada eksekusi";
  const waitingText = record.awaiting.length
    ? ` ${record.awaiting.length} menunggu keputusan Anda.`
    : " Tidak ada yang menunggu keputusan Anda.";
  return `${record.day}: ${ranText}.${waitingText}`;
}
