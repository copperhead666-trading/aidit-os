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
 * Render an English JARVIS spoken report (at most 8 lines).
 *
 * @param {object} summary – digest summary from owner-surface.buildDigest
 * @param {object} opts
 * @param {number} opts.hour – WIB hour (7 or 19)
 * @returns {string}
 */
export function renderSpokenReport(summary, { hour = 7 } = {}) {
  const lines = [];

  lines.push(`${greetingForHour(hour)}, Sir.`);

  if (summary?.done !== undefined) {
    lines.push(`Done: ${numberWord(summary.done)}.`);
  }

  const waiting = Array.isArray(summary?.waiting) ? summary.waiting : [];
  if (waiting.length > 0) {
    lines.push(`Waiting on you: ${numberWord(waiting.length)}.`);
  }

  if (summary?.stuck !== undefined && summary.stuck > 0) {
    lines.push(`Stuck: ${numberWord(summary.stuck)}.`);
  }

  if (summary?.budget?.percentLeft !== undefined) {
    lines.push(`Voice budget: ${numberWord(summary.budget.percentLeft)} percent.`);
  }

  return lines.join('\n');
}

export { numberWord, greetingForHour };