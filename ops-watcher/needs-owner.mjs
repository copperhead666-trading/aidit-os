// ops-watcher/needs-owner.mjs
//
// One answer to one question: is this issue waiting on the owner?
//
// Why this file exists. On 2026-09-03 the live board held 17 items waiting on a
// decision and Telegram could only ever send a card for 3 of them. Not a bug in
// either place — two places, two different rules:
//
//   ops-watcher/telegram-notify.mjs:196   label OWNER_REQUIRED only
//   cockpit/lib/sources.ts:425            title prefix OR label
//
// The cockpit rule was widened; the Telegram rule was not, and nothing told
// anyone. Fourteen decisions — including KOL-62, the venture the owner picked
// himself — could not produce a notification at all.
//
// So the rule lives here, once, and every surface imports it. Pure: no I/O, no
// clock of its own, no network. Everything it needs is passed in, which is also
// what makes it testable without touching Paperclip.

export const OWNER_REQUIRED_LABEL = "OWNER_REQUIRED";
export const OWNER_REJECTED_LABEL = "OWNER_REJECTED";

/** An issue in one of these is finished; nobody is waiting on anything. */
export const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

// The prefixes the system itself writes into a title when the question belongs
// to the owner. `OWNER DIRECTIVE:` is the odd one out: telegram-listener wraps
// EVERY inbound owner message in it (telegram-listener.mjs:777), so the prefix
// means "this came from the owner", not "this is waiting for the owner". That
// is why stray chatter needs the separate check below.
const ASKS_OWNER_PREFIXES = [
  /^\s*APPROVE:/,
  /^\s*DECISION:/,
  /^\s*DECISION NEEDED:/,
  /^\s*P[0-9]+ DECISION NEEDED:/,
  /^\s*FYI\/DECISION:/,
  /^\s*OWNER DIRECTIVE:/,
];

/** Case-sensitive on purpose: `approve:` in prose is not a routing prefix. */
export function asksOwnerByTitle(title) {
  if (typeof title !== "string" || title.trim() === "") return false;
  return ASKS_OWNER_PREFIXES.some((re) => re.test(title));
}

/** Label names off an issue, whichever shape this endpoint returned. */
export function labelNamesOf(issue, idToName = null) {
  const names = [];
  if (issue && Array.isArray(issue.labels)) {
    for (const l of issue.labels) {
      if (l && typeof l.name === "string") names.push(l.name);
    }
  }
  if (idToName && issue && Array.isArray(issue.labelIds)) {
    for (const id of issue.labelIds) {
      const n = typeof id === "string" ? idToName.get(id) : undefined;
      if (typeof n === "string") names.push(n);
    }
  }
  return [...new Set(names)];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nothing ever happened to it, and that has been true for a while. */
export const NOISE_MIN_AGE_MS = 3 * DAY_MS;

/**
 * Is this issue waiting on the owner?
 *
 * @param issue      raw Paperclip issue
 * @param opts.idToName    Map of labelId -> name, when the caller only has ids
 * @param opts.commentCount  how many comments the issue carries, or null if unknown
 * @param opts.planUndecided true when a plan was posted and no decision followed
 * @param opts.now         injectable clock
 *
 * @returns {{waiting: boolean, reason: string, suspectedNoise: boolean, ageMs: number|null}}
 *
 * `suspectedNoise` never suppresses anything. An issue can be both waiting and
 * suspected noise; the caller decides how to present it. Auto-closing the
 * owner's own words because a heuristic disliked them is exactly the kind of
 * silent loss this module exists to end.
 */
export function needsOwner(issue, opts = {}) {
  const { idToName = null, commentCount = null, planUndecided = false, now = Date.now } = opts;

  const none = { waiting: false, reason: "not-waiting", suspectedNoise: false, ageMs: null };
  if (!issue || typeof issue !== "object") return { ...none, reason: "no-issue" };

  const status = typeof issue.status === "string" ? issue.status : "";
  if (TERMINAL_STATUSES.has(status)) return { ...none, reason: "terminal" };

  const names = labelNamesOf(issue, idToName);
  if (names.includes(OWNER_REJECTED_LABEL)) return { ...none, reason: "already-rejected" };

  const ageMs = issueAgeMs(issue, now);

  // Nothing has ever happened to it, and it has sat that way for days. This is
  // evidence, not a guess about the wording: a real directive accumulates a
  // plan, a dispatch marker, or a failure comment within hours. Deliberately
  // NOT a length or phrasing test — "openjarvis github" (17 chars) is real work
  // and "gua udh kirim nih bro" (21) is not, so the text cannot tell them apart.
  const suspectedNoise =
    commentCount === 0 &&
    !planUndecided &&
    (status === "backlog" || status === "todo") &&
    ageMs !== null &&
    ageMs >= NOISE_MIN_AGE_MS;

  if (names.includes(OWNER_REQUIRED_LABEL)) {
    return { waiting: true, reason: "label", suspectedNoise, ageMs };
  }
  if (planUndecided) {
    return { waiting: true, reason: "plan-undecided", suspectedNoise: false, ageMs };
  }
  if (asksOwnerByTitle(issue.title)) {
    return { waiting: true, reason: "title", suspectedNoise, ageMs };
  }
  return { ...none, ageMs };
}

/** Milliseconds since the issue was created, or null when it cannot be read. */
export function issueAgeMs(issue, now = Date.now) {
  const raw = issue && (issue.createdAt ?? issue.created_at);
  if (typeof raw !== "string") return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const nowMs = typeof now === "function" ? now() : now;
  return Math.max(0, nowMs - ms);
}

/**
 * The full set, from a board and a label map. Sorted by identifier so two runs
 * over the same board produce the same order — a reconciliation that reports a
 * difference because the sort drifted would be worse than useless.
 */
export function waitingOnOwner(issues, opts = {}) {
  const { idToName = null, commentCounts = null, planUndecided = null, now = Date.now } = opts;
  const out = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const id = issue && typeof issue.identifier === "string" ? issue.identifier : null;
    const verdict = needsOwner(issue, {
      idToName,
      now,
      commentCount: commentCounts && id ? (commentCounts.get(id) ?? null) : null,
      planUndecided: planUndecided && id ? planUndecided.has(id) === true : false,
    });
    if (verdict.waiting) out.push({ identifier: id, ...verdict });
  }
  out.sort((a, b) =>
    String(a.identifier).localeCompare(String(b.identifier), undefined, { numeric: true }),
  );
  return out;
}

/**
 * Can the owner actually be reached about this one? Today a card is only ever
 * sent for an issue carrying OWNER_REQUIRED (telegram-notify.mjs:196), so this
 * is the set the notifier can serve. `waitingOnOwner` minus this set is exactly
 * what the reconciliation step must report as unreachable.
 */
export function reachableByCard(issues, opts = {}) {
  const { idToName = null } = opts;
  const out = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const status = issue && typeof issue.status === "string" ? issue.status : "";
    if (TERMINAL_STATUSES.has(status)) continue;
    if (!labelNamesOf(issue, idToName).includes(OWNER_REQUIRED_LABEL)) continue;
    out.push(typeof issue.identifier === "string" ? issue.identifier : null);
  }
  return out.filter((x) => x !== null).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
