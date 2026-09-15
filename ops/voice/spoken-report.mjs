// ops-watcher/spoken-report.mjs
// Renders an English JARVIS spoken report for the owner.
// Address is always "Sir" (formal English per voice policy).
// Numbers are spoken as words; ticket identifiers are never exposed.

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

function numberWord(n) {
  if (n < 0) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r === 0 ? TENS[t] : `${TENS[t]} ${ONES[r]}`;
  }
  return String(n);
}

function greetingForHour(hour) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Render an English JARVIS spoken report -- a genuine spoken counterpart to
 * telegram.mjs's humanStatus(s) text lines, not a separate thinner summary.
 * Found live 2026-09-15: the old shape (summary.done/waiting/stuck/budget)
 * was never fully populated by its only caller (done/budget were NEVER
 * wired at all), so most evenings only "Stuck: N." survived -- a 2-4 second
 * clip regardless of how much was actually happening. This version takes
 * the same status object telegram.mjs's text report already builds
 * (statusLines()'s return value) plus an optional score, so voice and text
 * can never drift apart in substance again.
 *
 * @param {object} s – statusLines()'s return value (paused, boardOk, open,
 *   inProgress, review, blocked, asks, resting, freeDiskGb)
 * @param {object} opts
 * @param {number} opts.hour – WIB hour
 * @param {{jarvis:number}} [opts.score] – computeScore()'s result, evening only
 * @returns {string}
 */
export function renderSpokenReport(s, { hour = 7, score = null } = {}) {
  const lines = [`${greetingForHour(hour)}, Sir.`];

  if (s?.paused) {
    lines.push('All departments are currently paused.');
  } else if (s?.boardOk === false) {
    lines.push('The board is unreachable. Recovering.');
  } else {
    lines.push(`Open work: ${numberWord(s?.open ?? 0)}. In progress: ${numberWord(s?.inProgress ?? 0)}. In review: ${numberWord(s?.review ?? 0)}. Stuck: ${numberWord(s?.blocked ?? 0)}.`);
  }

  lines.push(s?.asks ? `Waiting on you: ${numberWord(s.asks)}.` : 'Nothing waiting on your decision.');

  if (s?.resting) { const w = numberWord(s.resting); lines.push(`${w[0].toUpperCase()}${w.slice(1)} lane${s.resting === 1 ? '' : 's'} resting.`); }
  if (s?.freeDiskGb != null && s.freeDiskGb < 10) lines.push(`Disk space is low: ${numberWord(Math.round(s.freeDiskGb))} gigabytes left.`);
  if (score?.jarvis !== undefined) lines.push(`JARVIS score: ${numberWord(score.jarvis)} out of one hundred.`);

  return lines.join('\n');
}

export { numberWord, greetingForHour };