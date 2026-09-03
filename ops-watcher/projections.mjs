// ops-watcher/projections.mjs
//
// One fold from typed events to the state every surface reads.
//
// Why this file exists. Today "what state is this directive in?" is answered by
// matching ~25 free-text strings against Paperclip comment bodies, by three
// parsers that do not share a line of code:
//
//   ops-watcher/directive-runner.mjs:376   classifyDirective   (the real one)
//   cockpit/lib/inbox.ts:224              classifyIssue
//   cockpit/lib/sources.ts:460            an inline loop
//
// They disagree in production. sources.ts:504 accepts `OWNER MENYETUJUI`;
// directive-runner.mjs:255 requires the whole `OWNER MENYETUJUI via Telegram`.
// The cockpit therefore shows a directive as approved while the runner does not,
// and nothing reconciles the two. This module replaces all three with a single
// fold over the ledger, so a disagreement becomes impossible rather than merely
// unlikely.
//
// Two rules that look like details and are not:
//
//   Order is by `seq`, never by `ts`. The current system's worst ordering bug is
//   directive-runner.mjs:245 — `commentsOldestFirst` returns the array UNTOUCHED
//   when any single comment has an unparsable timestamp, after which every
//   positional reader ("the last plan", "the first decision after it") silently
//   reads the list backwards. A monotonic integer cannot fail that way.
//
//   An unrecognised `kind` is skipped and counted, never thrown on. The ledger
//   will outlive this reader; a newer writer adding a kind must degrade a
//   projection, not take the heartbeat down.
//
// Pure. No fs, no network, no Paperclip, no clock of its own — `now` is injected
// exactly as needs-owner.mjs injects it, which is what lets the cockpit import
// this module unchanged and what lets the tests run offline.
//
// Parity note. The `state` and `reason` strings below are byte-identical to
// classifyDirective's, including its comment-era vocabulary ("result marker
// present", "newest comment is stale"). During the migration the two are
// compared over the live board and any wording drift would read as a real
// difference. The vocabulary can be modernised once that gate has passed.

import { KINDS, ALL_KINDS, LEDGER_SCHEMA_VERSION } from "./ledger-schema.mjs";
import { waitingOnOwner, reachableByCard, OWNER_REQUIRED_LABEL } from "./needs-owner.mjs";

/** The closed set of directive states, in the order classifyDirective decides them. */
export const DIRECTIVE_STATES = Object.freeze([
  "done",
  "ignored",
  "rejected",
  "approved",
  "awaiting-approval",
  "stalled",
  "new",
]);

/** Mirrors directive-runner.mjs:DEFAULT_STALLED_AFTER_MS. Six hours of silence. */
export const DEFAULT_STALLED_AFTER_MS = 6 * 60 * 60 * 1000;

/** The label that makes a directive a directive, matched case-insensitively. */
export const DIRECTIVE_LABEL = "DIRECTIVE";

// ── small total helpers ───────────────────────────────────────────────
// Every one of these answers for junk rather than throwing on it. A projection
// that dies on one malformed event loses the other ten thousand.

function asMs(now) {
  const v = typeof now === "function" ? now() : now;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/** Milliseconds for an event timestamp, or null when it cannot be read. */
function tsMs(ev) {
  const t = Date.parse(ev && typeof ev.ts === "string" ? ev.ts : "");
  return Number.isFinite(t) ? t : null;
}

function isoOrNull(ms) {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function dataOf(ev) {
  const d = ev && ev.data;
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}

function nonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Identifier order: KOL-9 before KOL-62 before KOL-100, never lexicographic. */
function byIdentifier(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** A plain object with its keys in identifier order, so JSON.stringify is stable. */
function sortedObject(map) {
  const out = {};
  for (const k of [...map.keys()].sort(byIdentifier)) out[k] = map.get(k);
  return out;
}

// A total tie-break for two events that share a seq. Duplicate seqs should never
// occur — the writer never reuses one — but if they ever do, the output must
// still not depend on which order they arrived in.
const stableKeyCache = new WeakMap();
function stableKey(ev) {
  const cached = stableKeyCache.get(ev);
  if (cached !== undefined) return cached;
  let key;
  try {
    key = JSON.stringify(ev, Object.keys(ev).sort());
  } catch {
    key = String(ev);
  }
  stableKeyCache.set(ev, key);
  return key;
}

function compareEvents(a, b) {
  if (a.seq !== b.seq) return a.seq - b.seq;
  const at = tsMs(a);
  const bt = tsMs(b);
  // An unreadable timestamp sorts after a readable one rather than poisoning the
  // comparison with NaN, which would make the sort order implementation-defined.
  const an = at === null ? Number.POSITIVE_INFINITY : at;
  const bn = bt === null ? Number.POSITIVE_INFINITY : bt;
  if (an !== bn) return an < bn ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const as = typeof a.subject === "string" ? a.subject : "";
  const bs = typeof b.subject === "string" ? b.subject : "";
  if (as !== bs) return as < bs ? -1 : 1;
  const ak = stableKey(a);
  const bk = stableKey(b);
  return ak < bk ? -1 : ak > bk ? 1 : 0;
}

// ── the single indexing pass ──────────────────────────────────────────

/**
 * Read every event once: drop what cannot be understood (counting it), order the
 * rest by `seq`, and accumulate per subject.
 *
 * The input array is never sorted, written to, or otherwise touched; the sort
 * happens on a fresh array of the same references, and no event object is
 * mutated.
 *
 * @returns {{applied: object[], subjects: Map<string, object>, unknownKind: Map<string, number>,
 *            invalid: number, skipped: number, total: number, lastSeq: number|null,
 *            lastEventAt: string|null}}
 */
export function indexEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const applied = [];
  const unknownKind = new Map();
  let invalid = 0;

  for (const ev of list) {
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) { invalid++; continue; }
    if (!Number.isSafeInteger(ev.seq)) { invalid++; continue; }
    if (typeof ev.kind !== "string") { invalid++; continue; }
    // The forward-compatibility rule: a kind this reader has never heard of is
    // counted and stepped over. Never thrown on.
    if (!ALL_KINDS.has(ev.kind)) {
      unknownKind.set(ev.kind, (unknownKind.get(ev.kind) || 0) + 1);
      continue;
    }
    applied.push(ev);
  }

  applied.sort(compareEvents);

  const subjects = new Map();
  let lastSeq = null;
  let lastMs = null;

  for (const ev of applied) {
    if (lastSeq === null || ev.seq > lastSeq) lastSeq = ev.seq;
    const t = tsMs(ev);
    if (t !== null && (lastMs === null || t > lastMs)) lastMs = t;

    const subject = nonEmptyString(ev.subject);
    if (subject === null) continue; // digests and sweeps belong to no directive

    let acc = subjects.get(subject);
    if (!acc) {
      acc = newAccumulator(subject);
      subjects.set(subject, acc);
    }
    applyEvent(acc, ev, t);
  }

  return {
    applied,
    subjects,
    unknownKind,
    invalid,
    skipped: invalid + [...unknownKind.values()].reduce((a, b) => a + b, 0),
    total: list.length,
    lastSeq,
    lastEventAt: isoOrNull(lastMs),
  };
}

function newAccumulator(subject) {
  return {
    subject,
    count: 0,
    firstSeq: null,
    maxSeq: null,
    // `maxMs` is the newest timestamp seen, not the timestamp of the highest
    // seq. It mirrors newestComment() in directive-runner.mjs, which is what the
    // staleness rule below actually asks about: when did anything last happen.
    maxMs: null,
    minMs: null,
    createdMs: null,
    hasCreated: false,
    title: null,
    status: "",
    labels: new Set(),
    ownerRequiredSeq: null,
    ownerRequiredMs: null,
    planSeq: null,
    planMs: null,
    plansPosted: 0,
    planRefusals: 0,
    planParseFailures: 0,
    unexecutable: 0,
    refused: false,
    decisions: [],       // approved / rejected only, in seq order
    otherDecisions: [],  // deferred, revision, option, escalated, in seq order
    capExecution: [],    // {seq, ms}
    capAttempts: 0,
    dispatchClaimed: false,
    executionsStarted: 0,
    executionsDone: 0,
    executionsNoop: 0,
    executionsReverted: 0,
    executionFailures: 0,
  };
}

/** Read a label list off an event payload, whichever shape the writer used. */
function labelNames(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const l of value) {
    if (typeof l === "string" && l.trim() !== "") out.push(l);
    else if (l && typeof l === "object" && nonEmptyString(l.name)) out.push(l.name);
  }
  return out;
}

function hasOwnerRequired(labels) {
  for (const n of labels) if (String(n).toUpperCase() === OWNER_REQUIRED_LABEL) return true;
  return false;
}

// Events arrive here already in seq order, so "the latest" is simply "the last
// one written". No event object is read from twice and none is written to.
function applyEvent(acc, ev, t) {
  acc.count++;
  if (acc.firstSeq === null) acc.firstSeq = ev.seq;
  if (acc.maxSeq === null || ev.seq > acc.maxSeq) acc.maxSeq = ev.seq;
  if (t !== null && (acc.maxMs === null || t > acc.maxMs)) acc.maxMs = t;
  if (t !== null && (acc.minMs === null || t < acc.minMs)) acc.minMs = t;

  const data = dataOf(ev);
  const hadOwnerRequired = hasOwnerRequired(acc.labels);

  switch (ev.kind) {
    case KINDS.DIRECTIVE_CREATED: {
      acc.hasCreated = true;
      if (acc.createdMs === null && t !== null) acc.createdMs = t;
      const title = nonEmptyString(data.title);
      if (title !== null) acc.title = title;
      const status = nonEmptyString(data.status);
      if (status !== null) acc.status = status;
      const labels = labelNames(data.labels);
      if (labels !== null) acc.labels = new Set(labels);
      break;
    }
    case KINDS.ISSUE_STATUS_CHANGED: {
      const status = nonEmptyString(data.status) ?? nonEmptyString(data.to);
      if (status !== null) acc.status = status;
      break;
    }
    case KINDS.ISSUE_LABEL_CHANGED: {
      // Either the whole set, or a delta. Both shapes appear in the wild because
      // Paperclip returns `labels` on some endpoints and `labelIds` on others.
      const whole = labelNames(data.labels);
      if (whole !== null) {
        acc.labels = new Set(whole);
      } else {
        for (const n of labelNames(data.added) ?? []) acc.labels.add(n);
        for (const n of labelNames(data.removed) ?? []) {
          for (const have of [...acc.labels]) {
            if (String(have).toUpperCase() === String(n).toUpperCase()) acc.labels.delete(have);
          }
        }
      }
      break;
    }
    case KINDS.DIRECTIVE_PLAN_POSTED:
      acc.planSeq = ev.seq;
      acc.planMs = t;
      acc.plansPosted++;
      break;
    case KINDS.DIRECTIVE_PLAN_REFUSED:
      acc.planRefusals++;
      acc.refused = true;
      break;
    case KINDS.DIRECTIVE_PLAN_PARSE_FAILED:
      acc.planParseFailures++;
      break;
    case KINDS.DIRECTIVE_UNEXECUTABLE:
      // Reported to the owner, but it settles nothing: classifyDirective does not
      // read the unexecutable comment as a state, and neither does this fold.
      acc.unexecutable++;
      break;
    case KINDS.DECISION_APPROVED:
    case KINDS.DECISION_REJECTED:
      acc.decisions.push({ seq: ev.seq, ms: t, kind: ev.kind });
      break;
    case KINDS.DECISION_DEFERRED:
    case KINDS.DECISION_REVISION_REQUESTED:
    case KINDS.DECISION_OPTION_CHOSEN:
    case KINDS.DECISION_ESCALATED:
      // The owner said something, but not yes and not no. decisionFromComment
      // (directive-runner.mjs:253) recognises only approve and reject, so a
      // deferral leaves the directive awaiting a decision — deliberately, and
      // recorded here so the cockpit can still show that the owner replied.
      acc.otherDecisions.push({ seq: ev.seq, ms: t, kind: ev.kind });
      break;
    case KINDS.CAP_EXECUTION_REACHED:
      acc.capExecution.push({ seq: ev.seq, ms: t });
      break;
    case KINDS.CAP_ATTEMPT_REACHED:
      acc.capAttempts++;
      break;
    case KINDS.DISPATCH_CLAIMED:
      acc.dispatchClaimed = true;
      break;
    case KINDS.EXECUTION_STARTED:
      acc.executionsStarted++;
      break;
    case KINDS.EXECUTION_DONE:
      acc.executionsDone++;
      break;
    case KINDS.EXECUTION_NOOP:
      acc.executionsNoop++;
      break;
    case KINDS.EXECUTION_REVERTED:
      acc.executionsReverted++;
      break;
    case KINDS.EXECUTION_FAILED:
      acc.executionFailures++;
      break;
    default:
      // A known kind this projection has no opinion about (test.result,
      // lane.used, review.verdict, …). It still counts as activity, which is
      // exactly what the suspected-noise rule needs, so nothing more to do.
      break;
  }

  if (!hadOwnerRequired && hasOwnerRequired(acc.labels)) {
    acc.ownerRequiredSeq = ev.seq;
    acc.ownerRequiredMs = t;
  }
}

/**
 * When this subject first appeared. The creation event when there is one, and
 * otherwise the oldest event carrying a readable timestamp — an issue whose
 * creation was never recorded still has an age, and needsOwner's noise rule
 * needs one to answer at all.
 */
function createdAtMs(acc) {
  return acc.createdMs !== null ? acc.createdMs : acc.minMs;
}

function isDirectiveLabelled(acc) {
  for (const n of acc.labels) if (String(n).toUpperCase() === DIRECTIVE_LABEL) return true;
  return false;
}

/**
 * The OLDEST approve/reject at or after the plan.
 *
 * This is findPlanDecision (directive-runner.mjs:363) restated in seq terms, and
 * the choice of "oldest" is load-bearing rather than incidental: the whole
 * execution-cap rule below exists because of it. Changing it here would silently
 * change approval semantics everywhere.
 */
function firstDecisionAtOrAfterPlan(acc) {
  for (const d of acc.decisions) {
    if (d.seq > acc.planSeq) return d;
  }
  return null;
}

/**
 * Has the owner approved SINCE the newest execution-cap report?
 *
 * The KOL-36 bug in one sentence: the directive was approved at 09:08, capped at
 * 11:20, and approved again at 11:29; because the classifier reports the OLDEST
 * approval it reported 09:08, and a "was there a cap between the plan and the
 * approval" test read false — so the owner's second tap did nothing, twice, in
 * two successive fixes (be5052c, then 4c1ca40). The question is not which
 * decision the classifier picked. It is whether an approval is newer than the
 * cap. Answered here by looking at the decisions directly.
 */
function hasApprovalAfterExecutionCap(acc) {
  let capSeq = null;
  for (const c of acc.capExecution) {
    if (c.seq > acc.planSeq && (capSeq === null || c.seq > capSeq)) capSeq = c.seq;
  }
  if (capSeq === null) return false;
  for (const d of acc.decisions) {
    if (d.kind === KINDS.DECISION_APPROVED && d.seq > capSeq) return true;
  }
  return false;
}

// ── projection 1: directive state ─────────────────────────────────────

function classifyAccumulator(acc, nowMs, stalledAfterMs) {
  const status = String(acc.status || "").toLowerCase();
  const isDirective = isDirectiveLabelled(acc);

  // Order below is classifyDirective's order, decision for decision. `done` is
  // tested before the DIRECTIVE label on purpose: a finished issue is finished
  // whether or not anyone ever labelled it.
  if (status === "done" || acc.executionsDone > 0) {
    return {
      state: "done",
      reason: status === "done" ? "status done" : "result marker present",
      approvedAt: null,
    };
  }
  if (!isDirective) {
    return { state: "ignored", reason: "missing DIRECTIVE label", approvedAt: null };
  }
  if (acc.refused) {
    return { state: "rejected", reason: "plan refused marker present", approvedAt: null };
  }

  if (acc.planSeq !== null) {
    const decision = firstDecisionAtOrAfterPlan(acc);
    if (decision && decision.kind === KINDS.DECISION_APPROVED) {
      if (hasApprovalAfterExecutionCap(acc)) {
        return {
          state: "stalled",
          reason: "owner approved a re-plan after the execution cap",
          approvedAt: isoOrNull(decision.ms),
        };
      }
      return {
        state: "approved",
        reason: "owner approved via Telegram after plan",
        approvedAt: isoOrNull(decision.ms),
      };
    }
    if (decision && decision.kind === KINDS.DECISION_REJECTED) {
      return {
        state: "rejected",
        reason: "owner rejected via Telegram after plan",
        approvedAt: isoOrNull(decision.ms),
      };
    }
    return { state: "awaiting-approval", reason: "plan posted, awaiting owner decision", approvedAt: null };
  }

  if (acc.dispatchClaimed && acc.maxMs !== null && nowMs - acc.maxMs >= stalledAfterMs) {
    return { state: "stalled", reason: "wake marker present and newest comment is stale", approvedAt: null };
  }
  if (status === "todo" || status === "backlog") {
    return { state: "new", reason: "directive todo/backlog without plan", approvedAt: null };
  }
  return { state: "ignored", reason: `status ${status || "unknown"} is not eligible`, approvedAt: null };
}

/**
 * Every directive's state, folded from the ledger.
 *
 * `attempts` counts planning attempts — a plan posted, a plan refused, or a plan
 * that failed to parse — which is the quantity DEFAULT_MAX_PLAN_ATTEMPTS bounds.
 * `executionFailures` counts execution.failed only; reverted, no-op and started
 * are reported separately so no outcome is folded into another.
 *
 * The returned Map is built in identifier order, so iterating it is deterministic
 * even though a Map's order is otherwise an accident of insertion.
 *
 * @param {object[]} events
 * @param {{now?: function|number, stalledAfterMs?: number, index?: object}} [opts]
 * @returns {Map<string, object>}
 */
export function foldDirectives(events, opts = {}) {
  const { now = Date.now, stalledAfterMs = DEFAULT_STALLED_AFTER_MS, index = null } = opts;
  const idx = index || indexEvents(events);
  const nowMs = asMs(now);

  const out = new Map();
  for (const subject of [...idx.subjects.keys()].sort(byIdentifier)) {
    const acc = idx.subjects.get(subject);
    const verdict = classifyAccumulator(acc, nowMs, stalledAfterMs);
    out.set(subject, {
      subject,
      state: verdict.state,
      reason: verdict.reason,
      lastEventAt: isoOrNull(acc.maxMs),
      lastSeq: acc.maxSeq,
      approvedAt: verdict.approvedAt,
      planSeq: acc.planSeq,
      planAt: isoOrNull(acc.planMs),
      attempts: acc.plansPosted + acc.planRefusals + acc.planParseFailures,
      executionFailures: acc.executionFailures,
      executionsStarted: acc.executionsStarted,
      executionsDone: acc.executionsDone,
      executionsNoop: acc.executionsNoop,
      executionsReverted: acc.executionsReverted,
      capExecutionCount: acc.capExecution.length,
      capAttemptCount: acc.capAttempts,
      unexecutableCount: acc.unexecutable,
      status: acc.status,
      title: acc.title,
      isDirective: isDirectiveLabelled(acc),
      labels: [...acc.labels].sort(byIdentifier),
      createdAt: isoOrNull(createdAtMs(acc)),
      eventCount: acc.count,
    });
  }
  return out;
}

// ── projection 2: what the owner is holding ───────────────────────────

/**
 * When did this issue start waiting, and at which event?
 *
 * "Since when" has to name a real event, not a guess: the label that was added,
 * the plan that went unanswered, or — when only the title asks — the moment the
 * issue appeared.
 */
function waitingSinceFor(acc, reason) {
  if (reason === "label" && acc.ownerRequiredSeq !== null) {
    return { at: isoOrNull(acc.ownerRequiredMs), seq: acc.ownerRequiredSeq };
  }
  if (reason === "plan-undecided" && acc.planSeq !== null) {
    return { at: isoOrNull(acc.planMs), seq: acc.planSeq };
  }
  return { at: isoOrNull(createdAtMs(acc)), seq: acc.firstSeq };
}

/**
 * What is waiting on the owner, and since when.
 *
 * The rule itself is NOT restated here. `needsOwner` / `waitingOnOwner` in
 * needs-owner.mjs own it, and this function's whole job is to hand them an issue
 * shape rebuilt from events. A second rule is the exact failure this migration
 * exists to end: on 2026-09-03 the board held 17 waiting items and Telegram
 * could send a card for 3, because two files answered the same question
 * differently and nothing compared them.
 *
 * `commentCount` is passed as the count of events other than the creation
 * itself — the event-world spelling of "nothing has ever happened to it", which
 * is what the suspected-noise heuristic actually tests.
 */
export function foldDecisions(events, opts = {}) {
  const { now = Date.now, stalledAfterMs = DEFAULT_STALLED_AFTER_MS, index = null, directives = null } = opts;
  const idx = index || indexEvents(events);
  const states = directives || foldDirectives(events, { now, stalledAfterMs, index: idx });

  const issues = [];
  const commentCounts = new Map();
  const planUndecided = new Set();

  for (const subject of [...idx.subjects.keys()].sort(byIdentifier)) {
    const acc = idx.subjects.get(subject);
    issues.push({
      identifier: subject,
      title: acc.title,
      status: acc.status,
      labels: [...acc.labels].sort(byIdentifier).map((name) => ({ name })),
      labelIds: [],
      createdAt: isoOrNull(createdAtMs(acc)),
    });
    commentCounts.set(subject, Math.max(0, acc.count - (acc.hasCreated ? 1 : 0)));
    const st = states.get(subject);
    if (st && st.state === "awaiting-approval") planUndecided.add(subject);
  }

  const waiting = waitingOnOwner(issues, { commentCounts, planUndecided, now }).map((v) => {
    const acc = idx.subjects.get(v.identifier);
    const since = waitingSinceFor(acc, v.reason);
    const st = states.get(v.identifier);
    return {
      identifier: v.identifier,
      reason: v.reason,
      suspectedNoise: v.suspectedNoise,
      ageMs: v.ageMs,
      waitingSince: since.at,
      waitingSinceSeq: since.seq,
      directiveState: st ? st.state : null,
      lastEventAt: st ? st.lastEventAt : null,
    };
  });

  const reachable = reachableByCard(issues);
  const reachableSet = new Set(reachable);
  const unreachable = waiting.map((w) => w.identifier).filter((id) => !reachableSet.has(id));

  return {
    waiting,
    reachableByCard: reachable,
    // waitingOnOwner minus reachableByCard: the set nobody can be told about.
    // This difference is the 17-vs-3 gap, reported rather than left implicit.
    unreachable,
    counts: {
      waiting: waiting.length,
      reachable: reachable.length,
      unreachable: unreachable.length,
      suspectedNoise: waiting.filter((w) => w.suspectedNoise).length,
    },
  };
}

// ── projection 3: what reached the owner ──────────────────────────────

/** Telegram message ids arrive as numbers and index as strings. Normalise once. */
function readMessageId(data) {
  const raw = data.messageId ?? data.message_id ?? null;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return null;
}

function readChatId(data) {
  const raw = data.chatId ?? data.chat_id ?? null;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return null;
}

/**
 * Cards sent, and the message_id ↔ subject map.
 *
 * Treat this map as load-bearing. Today it exists in exactly one place — a
 * `[TELEGRAM SENT] message_id=N` line inside a Paperclip comment — and nowhere
 * on disk. It is the only thing that can turn an owner's reply to a Telegram
 * card back into the directive it answers. Lose it and every reply is orphaned:
 * the owner taps approve and nothing on this side knows what was approved.
 *
 * A subject can hold several message ids (a re-sent card, a second decision on
 * one directive), so `bySubject` is a list in seq order, not a single id.
 */
export function foldDelivery(events, opts = {}) {
  const { index = null } = opts;
  const idx = index || indexEvents(events);

  const cards = [];
  const failures = [];
  const digests = [];
  const byMessageId = new Map();
  const bySubject = new Map();
  let orphans = 0;
  let collisions = 0;

  for (const ev of idx.applied) {
    const data = dataOf(ev);
    const subject = nonEmptyString(ev.subject);
    const at = isoOrNull(tsMs(ev));

    if (ev.kind === KINDS.CARD_SENT) {
      const messageId = readMessageId(data);
      const card = { seq: ev.seq, ts: at, subject, messageId, chatId: readChatId(data) };
      cards.push(card);
      if (messageId === null) {
        // A card that went out without a recoverable id. The owner can still tap
        // it; nothing here will be able to say what they tapped.
        orphans++;
      } else {
        const prior = byMessageId.get(messageId);
        if (prior && prior.subject !== subject) collisions++;
        byMessageId.set(messageId, { subject, seq: ev.seq, ts: at });
        if (subject !== null) {
          if (!bySubject.has(subject)) bySubject.set(subject, []);
          bySubject.get(subject).push(messageId);
        }
      }
    } else if (ev.kind === KINDS.CARD_SEND_FAILED) {
      failures.push({
        seq: ev.seq,
        ts: at,
        subject,
        reason: nonEmptyString(data.reason) ?? nonEmptyString(data.error),
      });
    } else if (ev.kind === KINDS.DIGEST_SENT) {
      digests.push({ seq: ev.seq, ts: at, messageId: readMessageId(data) });
    }
  }

  return {
    cards,
    byMessageId: sortedObject(byMessageId),
    bySubject: sortedObject(bySubject),
    failures,
    digests,
    counts: {
      sent: cards.length,
      failed: failures.length,
      digests: digests.length,
      // A card whose message_id could not be read is a reply that can never be
      // routed home. Counted loudly rather than dropped quietly.
      orphans,
      collisions,
    },
  };
}

// ── everything, once ──────────────────────────────────────────────────

/**
 * Every projection from one indexing pass — the shape written to
 * `state/projections/*.json`.
 *
 * Determinism: with the same events and the same `now`, this returns a
 * byte-identical JSON serialisation. Input order does not matter (events are
 * sorted by seq), Map order does not matter (every map becomes a key-sorted
 * object or an explicitly sorted array), and no clock is read unless one is
 * omitted. `now` must be pinned by any caller that compares two runs — the
 * stalled rule genuinely depends on wall time, and pretending otherwise would
 * only hide that.
 */
export function project(events, opts = {}) {
  const { now = Date.now, stalledAfterMs = DEFAULT_STALLED_AFTER_MS } = opts;
  const idx = indexEvents(events);
  const directives = foldDirectives(events, { now, stalledAfterMs, index: idx });
  const decisions = foldDecisions(events, { now, stalledAfterMs, index: idx, directives });
  const delivery = foldDelivery(events, { index: idx });

  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    source: {
      events: idx.total,
      applied: idx.applied.length,
      skipped: idx.skipped,
      lastSeq: idx.lastSeq,
      lastEventAt: idx.lastEventAt,
    },
    skipped: {
      total: idx.skipped,
      invalid: idx.invalid,
      // Named so an operator can see WHICH newer kind this reader did not know,
      // rather than only that something was dropped.
      unknownKinds: sortedObject(idx.unknownKind),
    },
    directives: [...directives.values()],
    decisions,
    delivery,
  };
}
