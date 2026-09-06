// ops-watcher/ledger-schema.mjs
//
// The shape of one fact, and the closed list of facts this system can record.
//
// Why a schema module and not just a convention: today the state of a directive
// is reconstructed by matching ~25 free-text strings in comment bodies, by three
// separate parsers that do not share code (directive-runner.mjs:376,
// cockpit/lib/inbox.ts:224, cockpit/lib/sources.ts:460). Every one of last
// week's four live bugs came from that. A typed event with a closed `kind` set
// is the fix: a reader either knows a kind or it does not, and a typo is a
// validation failure at write time instead of a silently missed state months
// later.
//
// Pure: no I/O, no clock, no imports. Safe for the ops-watcher modules, the
// migration script, and (through a thin wrapper) the Next.js cockpit.

/** Bump when the shape below changes in a way older readers cannot handle. */
export const LEDGER_SCHEMA_VERSION = 1;

/**
 * Every fact the system may record. Grouped by the thing they happen to.
 *
 * The naming is `noun.past_tense`: an event says what HAPPENED, never what
 * should happen. A kind that reads like an instruction ("directive.execute")
 * would invite the log to become a queue, and a queue that is also a history is
 * neither.
 */
export const KINDS = Object.freeze({
  // ── the directive itself ──────────────────────────────────────────
  DIRECTIVE_CREATED: "directive.created",
  DIRECTIVE_PLAN_POSTED: "directive.plan_posted",
  DIRECTIVE_PLAN_REFUSED: "directive.plan_refused",
  DIRECTIVE_PLAN_PARSE_FAILED: "directive.plan_parse_failed",
  DIRECTIVE_UNEXECUTABLE: "directive.unexecutable",

  // ── what the owner said ───────────────────────────────────────────
  DECISION_APPROVED: "decision.approved",
  DECISION_REJECTED: "decision.rejected",
  DECISION_DEFERRED: "decision.deferred",
  DECISION_REVISION_REQUESTED: "decision.revision_requested",
  DECISION_OPTION_CHOSEN: "decision.option_chosen",
  DECISION_ESCALATED: "decision.escalated",
  OWNER_NOTE: "owner.note",

  // ── reaching the owner ────────────────────────────────────────────
  CARD_SENT: "card.sent",
  CARD_SEND_FAILED: "card.send_failed",
  DIGEST_SENT: "digest.sent",

  // ── doing the work ────────────────────────────────────────────────
  EXECUTION_STARTED: "execution.started",
  EXECUTION_DONE: "execution.done",
  EXECUTION_NOOP: "execution.noop",
  EXECUTION_FAILED: "execution.failed",
  EXECUTION_REVERTED: "execution.reverted",
  DISPATCH_CLAIMED: "dispatch.claimed",

  // ── the brakes ────────────────────────────────────────────────────
  CAP_ATTEMPT_REACHED: "cap.attempt_reached",
  CAP_EXECUTION_REACHED: "cap.execution_reached",

  // ── other surfaces that own durable facts ─────────────────────────
  TEST_RESULT: "test.result",
  REVIEW_VERDICT: "review.verdict",
  ISSUE_STATUS_CHANGED: "issue.status_changed",
  ISSUE_LABEL_CHANGED: "issue.label_changed",
  LANE_USED: "lane.used",
  REPAIR_ATTEMPTED: "repair.attempted",
  HEARTBEAT_SWEPT: "heartbeat.swept",

  // ── the invariant that must never go quiet ────────────────────────
  RECONCILE_OK: "reconcile.ok",
  RECONCILE_DRIFT: "reconcile.drift",

  // ── provenance for anything lifted out of the old world ───────────
  IMPORTED: "imported",
});

/** The closed set, for validation. */
export const ALL_KINDS = Object.freeze(new Set(Object.values(KINDS)));

/** Who caused it. `owner` is reserved for a real human action, always. */
export const ACTORS = Object.freeze(new Set(["owner", "system", "agent"]));

/**
 * Where the fact came from. `migration` marks everything derived from the
 * pre-cutover Paperclip export, so a later reader can always tell a fact that
 * was observed live from one that was reconstructed from a comment body.
 */
export const SOURCES = Object.freeze(
  new Set(["cockpit", "telegram", "runner", "heartbeat", "migration", "manual"]),
);

/**
 * One event.
 *
 * @typedef {object} LedgerEvent
 * @property {number}  seq     monotonic, assigned by the writer, never reused
 * @property {string}  ts      ISO 8601 UTC, when the fact happened (not when written)
 * @property {string}  kind    one of KINDS
 * @property {string|null} subject  usually an issue identifier like "KOL-62"
 * @property {string}  actor   one of ACTORS
 * @property {string}  source  one of SOURCES
 * @property {object}  data    kind-specific payload; always an object, never null
 * @property {string|null} shadow  the free text also written to Paperclip, verbatim
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * Validate one event. Returns `{ok:true}` or `{ok:false, reason}` — never
 * throws, because the writer must be able to reject a bad event and keep
 * running rather than take the heartbeat down with it.
 */
export function validateEvent(ev) {
  if (ev === null || typeof ev !== "object" || Array.isArray(ev)) {
    return { ok: false, reason: "event is not an object" };
  }
  if (!Number.isSafeInteger(ev.seq) || ev.seq < 1) {
    return { ok: false, reason: "seq must be a positive safe integer" };
  }
  if (typeof ev.ts !== "string" || !ISO_RE.test(ev.ts)) {
    return { ok: false, reason: "ts must be an ISO-8601 UTC timestamp ending in Z" };
  }
  if (typeof ev.kind !== "string" || !ALL_KINDS.has(ev.kind)) {
    return { ok: false, reason: `unknown kind ${JSON.stringify(ev.kind)}` };
  }
  if (ev.subject !== null && (typeof ev.subject !== "string" || ev.subject.trim() === "")) {
    return { ok: false, reason: "subject must be a non-empty string or null" };
  }
  if (typeof ev.actor !== "string" || !ACTORS.has(ev.actor)) {
    return { ok: false, reason: `unknown actor ${JSON.stringify(ev.actor)}` };
  }
  if (typeof ev.source !== "string" || !SOURCES.has(ev.source)) {
    return { ok: false, reason: `unknown source ${JSON.stringify(ev.source)}` };
  }
  if (ev.data === null || typeof ev.data !== "object" || Array.isArray(ev.data)) {
    return { ok: false, reason: "data must be an object" };
  }
  if (ev.shadow !== null && typeof ev.shadow !== "string") {
    return { ok: false, reason: "shadow must be a string or null" };
  }
  // A newline inside a serialised event would split one fact across two lines
  // and corrupt every reader after it. Cheaper to refuse than to detect later.
  if (JSON.stringify(ev).includes("\n")) {
    return { ok: false, reason: "serialised event must not contain a newline" };
  }
  return { ok: true };
}

/** Build a well-formed event without a sequence number; the writer assigns it. */
export function makeEvent({ kind, subject = null, actor = "system", source = "runner", data = {}, ts, shadow = null }) {
  return {
    kind,
    subject,
    actor,
    source,
    data,
    ts: typeof ts === "string" ? ts : new Date().toISOString(),
    shadow,
  };
}

/**
 * The owner decision kinds, in one place, because "did the owner answer?" is
 * asked by the runner, the cockpit, the digest and the reconciler, and four
 * copies of that list is how the current system got into trouble.
 */
export const DECISION_KINDS = Object.freeze(
  new Set([
    KINDS.DECISION_APPROVED,
    KINDS.DECISION_REJECTED,
    KINDS.DECISION_DEFERRED,
    KINDS.DECISION_REVISION_REQUESTED,
    KINDS.DECISION_OPTION_CHOSEN,
    KINDS.DECISION_ESCALATED,
  ]),
);

/** Kinds that end a directive's life. */
export const TERMINAL_KINDS = Object.freeze(
  new Set([KINDS.EXECUTION_DONE, KINDS.DECISION_REJECTED]),
);
