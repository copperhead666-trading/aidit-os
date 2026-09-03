/**
 * Turning what the readers return into the one thing the owner actually asks:
 * "what is waiting on me, and which one first?"
 *
 * Pure: every value here is derived from `readOpenDecisions()` and
 * `readInbox()`. Nothing is invented, defaulted, or filled in.
 */
import type { OpenDecision } from '@/lib/sources';
import type { InboxItem } from '@/lib/inbox';

export interface Menunggu {
  /** The waiting item, exactly as the reader returned it. */
  d: OpenDecision;
  /** The same issue as the inbox classifier sees it, when it saw it at all. */
  inbox: InboxItem | null;
}

/** Pairs each waiting decision with its inbox classification, by identifier. */
export function gabung(
  decisions: OpenDecision[],
  inbox: InboxItem[] | null,
): Menunggu[] {
  const byId = new Map((inbox ?? []).map((i) => [i.identifier, i]));
  return decisions.map((d) => ({ d, inbox: byId.get(d.identifier) ?? null }));
}

/**
 * How long this has been sitting, in milliseconds. Null when nothing in either
 * reader dated it — an unknown age is never counted as a young one.
 */
export function umurMs(m: Menunggu, now = Date.now()): number | null {
  const iso = m.d.planAt ?? m.inbox?.sinceIso ?? null;
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/** Still genuinely a question for the owner — not already grinding or jammed. */
export function butuhJawaban(items: Menunggu[]): Menunggu[] {
  return items.filter((m) => m.inbox?.state !== 'stuck' && m.inbox?.state !== 'working');
}

/** Jammed: the same failure has already repeated, so nobody is making progress. */
export function nyangkut(items: Menunggu[]): Menunggu[] {
  return items.filter((m) => m.inbox?.state === 'stuck');
}

/** Being worked on right now by the system, with nothing asked of the owner. */
export function lagiJalan(items: Menunggu[]): Menunggu[] {
  return items.filter((m) => m.inbox?.state === 'working');
}

// Anything parked in `backlog` was filed but never scheduled, so it sits below
// the live queue no matter how it is labelled.
function belumDijadwalkan(m: Menunggu): boolean {
  return m.d.status === 'backlog';
}

/**
 * Most urgent first. In order: the system explicitly flagged it for the owner,
 * then it was never delivered to him at all, then a written plan is sitting
 * undecided, then the oldest plan, then issue number.
 */
export function urutkan(items: Menunggu[]): Menunggu[] {
  const skor = (m: Menunggu): number => {
    let s = 0;
    if (belumDijadwalkan(m)) s += 100;
    if (!m.d.ownerRequired) s += 10;
    if (m.d.cardSent) s += 4;
    if (m.d.planBody === null) s += 2;
    return s;
  };
  return [...items].sort((a, b) => {
    const ds = skor(a) - skor(b);
    if (ds !== 0) return ds;
    const at = a.d.planAt ? Date.parse(a.d.planAt) : NaN;
    const bt = b.d.planAt ? Date.parse(b.d.planAt) : NaN;
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return a.d.identifier.localeCompare(b.d.identifier, undefined, { numeric: true });
  });
}

/**
 * Why this landed on the owner's desk, in his own terms. Each branch names a
 * field the reader actually returned.
 */
export function kenapaNungguLo(m: Menunggu): string {
  if (!m.d.cardSent) return 'Kartunya belum pernah dikirim ke Telegram.';
  if (m.d.ownerRequired) return 'Perkara ini tidak boleh berjalan tanpa jawaban Anda.';
  if (m.d.planBody !== null) return 'Rencananya sudah siap dan tinggal Anda jawab.';
  return 'Judul perkaranya sendiri yang meminta jawaban Anda.';
}

/**
 * A plan whose FILES section is empty. On its own this means nothing; it only
 * gets shown next to real failure evidence, as the explanation for it.
 */
function rencanaTanpaBerkas(planBody: string | null): boolean {
  if (planBody === null) return false;
  const baris = planBody.split('\n').find((l) => l.trimStart().startsWith('FILES:'));
  if (baris === undefined) return false;
  return baris.slice(baris.indexOf('FILES:') + 'FILES:'.length).trim().toUpperCase() === 'NONE';
}

/**
 * When approving would be pointless, this is the sentence that says so. Null
 * means SETUJU is a real option.
 *
 * The bar is evidence, not suspicion: the item must already have failed the same
 * way more than once. Only then is the plan's own emptiness offered as the
 * reason why.
 */
export function kenapaGabisaDisetujui(m: Menunggu): string | null {
  if (m.inbox?.state !== 'stuck') return null;
  const dasar = `Gagal ${m.inbox.attempts} kali dengan sebab yang sama: ${m.inbox.reason}`;
  if (rencanaTanpaBerkas(m.d.planBody)) {
    return `${dasar}. Rencananya sendiri tidak menyentuh berkas apa pun.`;
  }
  return `${dasar}.`;
}
