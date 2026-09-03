// ops-watcher/owner-surface.mjs
//
// Of the things waiting on the owner, which one gets its own card right now and
// which one belongs in the morning summary?
//
// Why this is a separate decision from "is it waiting". On 2026-09-03 the live
// board held 17 items waiting on a decision and Telegram could send a card for
// only 3, because the notifier keyed on the OWNER_REQUIRED label alone. Widening
// that selector fixes the blindness — and, on its own, would fire fourteen
// notifications in one sweep, two of them for the owner's own stray messages
// ("oke", "gua udh kirim nih bro"). Fixing invisibility by replacing it with a
// flood is not a fix.
//
// So the rule splits. Nothing is invisible; not everything interrupts.
//
//   card    the system explicitly escalated this, or a plan is waiting on a yes
//   digest  it is waiting, it is counted, it is listed once each morning
//
// This preserves today's card behaviour EXACTLY — a card is still sent for, and
// only for, an issue the system labelled OWNER_REQUIRED or a plan the runner
// posted — while making the other fourteen visible somewhere for the first time.
// Pure: no I/O, no clock of its own.

import { needsOwner } from "./needs-owner.mjs";

/** Where a waiting item reaches the owner. */
export const SURFACE = Object.freeze({
  CARD: "card",
  DIGEST: "digest",
  NONE: "none",
});

/**
 * Which surface does this issue belong on?
 *
 * `reason` comes from needsOwner and carries the whole argument:
 *   - "label"          something escalated it on purpose  -> interrupt
 *   - "plan-undecided" the runner posted a plan and stopped -> interrupt
 *   - "title"          it has been sitting in the queue      -> summarise
 */
export function surfaceFor(issue, opts = {}) {
  const verdict = needsOwner(issue, opts);
  if (!verdict.waiting) return { surface: SURFACE.NONE, ...verdict };
  if (verdict.reason === "label" || verdict.reason === "plan-undecided") {
    return { surface: SURFACE.CARD, ...verdict };
  }
  return { surface: SURFACE.DIGEST, ...verdict };
}

/** Convenience for the notifier's gate. */
export function cardWorthy(issue, opts = {}) {
  return surfaceFor(issue, opts).surface === SURFACE.CARD;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Older than this and the summary calls it out by name. */
export const OVERDUE_MS = 4 * DAY_MS;

/**
 * Everything waiting, split by surface and sorted, ready for the morning
 * message. Pure; the caller supplies the clock and the board.
 */
export function buildDigest(issues, opts = {}) {
  const { now = Date.now, idToName = null, commentCounts = null, planUndecided = null } = opts;
  const cards = [];
  const digest = [];

  for (const issue of Array.isArray(issues) ? issues : []) {
    const id = issue && typeof issue.identifier === "string" ? issue.identifier : null;
    if (id === null) continue;
    const v = surfaceFor(issue, {
      idToName,
      now,
      commentCount: commentCounts ? (commentCounts.get(id) ?? null) : null,
      planUndecided: planUndecided ? planUndecided.has(id) === true : false,
    });
    if (v.surface === SURFACE.NONE) continue;
    const row = {
      identifier: id,
      title: typeof issue.title === "string" ? issue.title : "",
      ageMs: v.ageMs,
      overdue: typeof v.ageMs === "number" && v.ageMs >= OVERDUE_MS,
      suspectedNoise: v.suspectedNoise === true,
      reason: v.reason,
    };
    (v.surface === SURFACE.CARD ? cards : digest).push(row);
  }

  const byAge = (a, b) => (b.ageMs ?? 0) - (a.ageMs ?? 0);
  cards.sort(byAge);
  digest.sort(byAge);

  const waiting = [...cards, ...digest];
  return {
    waiting,
    cards,
    digest,
    total: waiting.length,
    overdue: waiting.filter((r) => r.overdue).length,
    suspectedNoise: waiting.filter((r) => r.suspectedNoise).map((r) => r.identifier),
    oldest: waiting.length > 0 ? waiting.reduce((a, b) => ((b.ageMs ?? 0) > (a.ageMs ?? 0) ? b : a)) : null,
  };
}

/** Days, rounded down, for the message. */
function days(ms) {
  return typeof ms === "number" ? Math.floor(ms / DAY_MS) : null;
}

/**
 * The morning message, in the owner's language.
 *
 * Deliberately short and deliberately honest: it says how many are waiting, how
 * many are overdue, names the oldest, and stops. The detail lives in the
 * cockpit — a summary that tries to be the list is just the flood again, with
 * extra steps.
 */
export function renderDigest(summary, opts = {}) {
  const { cockpitUrl = null } = opts;
  if (!summary || summary.total === 0) {
    return "Pagi. Nggak ada yang nunggu keputusan lo.";
  }

  const lines = [];
  lines.push(`${summary.total} nunggu keputusan lo.`);

  if (summary.overdue > 0) {
    lines.push(`${summary.overdue} udah lewat 4 hari.`);
  }
  if (summary.oldest) {
    const d = days(summary.oldest.ageMs);
    const umur = d === null ? "umurnya nggak kecatat" : d === 0 ? "hari ini" : `${d} hari`;
    lines.push(`Paling lama: ${summary.oldest.identifier}, ${umur}.`);
  }
  if (summary.cards.length > 0) {
    lines.push(`${summary.cards.length} udah gua kirimin kartunya sendiri.`);
  }
  if (summary.suspectedNoise.length > 0) {
    lines.push(
      `${summary.suspectedNoise.length} kelihatannya kekirim nggak sengaja (${summary.suspectedNoise.join(", ")}) — tutup aja?`,
    );
  }
  if (cockpitUrl) lines.push(cockpitUrl);

  return lines.join("\n");
}
