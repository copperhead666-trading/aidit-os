/**
 * The house vocabulary, in one file.
 *
 * The rule the owner settled on 2026-09-03: ENGLISH is the frame — labels,
 * states, controls, column headers, anything the system says about itself.
 * INDONESIAN is the substance — every sentence he reads in order to understand
 * his own business, in a formal register that addresses him as "Anda", never
 * "lo".
 *
 * Both halves live here so they cannot drift, and so Telegram and the cockpit
 * can never phrase one item two different ways.
 *
 * Nothing in this file invents. Every Indonesian sentence below is derived from
 * a field a reader actually returned; where no field says it, the builder
 * returns null and the surface renders an honest gap instead of a guess.
 */
import type { Menunggu } from '@/components/keputusan';

/**
 * Five states, and only five. "Macet" and "nyangkut" used to mean the same
 * thing in two words; both are Blocked now.
 */
export type Keadaan = 'awaiting' | 'running' | 'blocked' | 'done' | 'dropped';

export const STATE_LABEL: Record<Keadaan, string> = {
  awaiting: 'Awaiting you',
  running: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
};

/** The dot tone each state carries. Colour ranks; the word carries the meaning. */
export const STATE_DOT: Record<Keadaan, 'ok' | 'warn' | 'err' | 'off'> = {
  awaiting: 'warn',
  running: 'warn',
  blocked: 'err',
  done: 'ok',
  dropped: 'off',
};

/** Paperclip's own status words, mapped onto the five. */
export function keadaanDari(status: string, stuck = false): Keadaan {
  if (stuck) return 'blocked';
  switch (status) {
    case 'done':
      return 'done';
    case 'cancelled':
      return 'dropped';
    case 'blocked':
      return 'blocked';
    case 'in_progress':
    case 'in_review':
      return 'running';
    default:
      return 'awaiting';
  }
}

/** The English state word for a raw Paperclip status. */
export function statusLabel(status: string): string {
  return STATE_LABEL[keadaanDari(status)];
}

/* ------------------------------------------------------------------ *
 * The Indonesian half: the eight slots of a decision record.
 * ------------------------------------------------------------------ */

/** THE QUESTION — what, exactly, is being put to him. */
export function pertanyaannya(m: Menunggu): string {
  if (m.d.planBody !== null) {
    return 'Menyetujui atau menolak rencana yang sudah tertulis di bawah ini.';
  }
  if (m.d.ownerRequired) {
    return 'Memberi keputusan yang tanpa itu pekerjaan ini tidak boleh berjalan.';
  }
  return 'Menjawab pertanyaan yang diajukan pada judul perkara ini.';
}

/** WHY IT REACHED YOU — the routing reason, in his terms. */
export function kenapaSampaiKeAnda(m: Menunggu): string {
  if (!m.d.cardSent) return 'Kartunya belum pernah dikirim ke Telegram.';
  if (m.d.ownerRequired) return 'Perkara ini tidak boleh berjalan tanpa jawaban Anda.';
  if (m.d.planBody !== null) return 'Rencananya sudah siap dan tinggal Anda jawab.';
  return 'Judul perkaranya sendiri yang meminta jawaban Anda.';
}

/**
 * IF YOU DO NOTHING — the cost of waiting, stated plainly. Every branch is a
 * consequence the data already establishes, not a prediction.
 */
export function kalauDidiamkan(m: Menunggu): string {
  if (m.inbox?.state === 'stuck') {
    return `Perkara ini tetap macet. Sudah gagal ${m.inbox.attempts} kali dengan sebab yang sama.`;
  }
  if (m.d.planBody !== null) {
    return 'Rencananya tidak dijalankan. Tidak ada yang dirilis dan tidak ada yang rusak.';
  }
  if (m.d.ownerRequired) {
    return 'Pekerjaannya tertahan sampai Anda menjawab.';
  }
  return 'Perkara ini tetap terbuka dan kembali ke brief Anda besok.';
}

/**
 * MY RECOMMENDATION — null when nothing in the data supports one.
 *
 * Deliberately narrow. A recommendation the system did not actually reason its
 * way to is worse than a visible gap, because the owner would act on it. The
 * one case that is a derivation rather than an invention: an item that has
 * already failed the same way more than once should not be waved through.
 */
export function rekomendasi(m: Menunggu): string | null {
  if (m.inbox?.state === 'stuck' && m.inbox.attempts > 1) {
    return `Jangan disetujui apa adanya. Sudah gagal ${m.inbox.attempts} kali dengan sebab yang sama: ${m.inbox.reason}`;
  }
  return null;
}

/** The sentence shown where a recommendation should be and is not. */
export const REKOMENDASI_KOSONG =
  'Belum ada rekomendasi tertulis untuk perkara ini.';

/** The sentence shown where the substance of a case should be and is not. */
export const ISI_KOSONG =
  'Perkara ini belum membawa uraian apa pun — hanya judulnya.';

/**
 * What each lane is FOR. A bare roster of names — HATTA, CORLEONE, SJAHRIR —
 * tells the owner nothing, so no lane is ever named without its role.
 * Frame text, therefore English.
 */
const LANE_ROLE: Record<string, string> = {
  hatta: 'code',
  ollama: 'code',
  corleone: 'code',
  codex: 'code',
  sjahrir: 'analysis',
  kimi: 'analysis',
  gibran: 'free tier',
  soekarno: 'read-only',
};

export function laneRole(lane: string): string | null {
  return LANE_ROLE[lane.toLowerCase()] ?? null;
}

/**
 * Ages in the frame — "4m ago", "3d ago". The Indonesian equivalent lives in
 * components/waktu.ts and is used for sentences; this one is for chrome, where
 * a two-character age has to fit next to a label.
 */
export function sejakInggris(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const menit = Math.floor(ms / 60_000);
  if (menit < 1) return 'just now';
  if (menit < 60) return `${menit}m ago`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam}h ago`;
  const hari = Math.floor(jam / 24);
  return `${hari}d ago`;
}

/** English weekday + day + month, e.g. "Wednesday 3 September". */
const HARI = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BULAN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function dateline(d = new Date()): string {
  return `${HARI[d.getDay()]} ${d.getDate()} ${BULAN[d.getMonth()]}`;
}

/** Clock, 24h, for the line under the dateline. */
export function jam(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "30 Aug" — a filing date in the frame. Null when the input is not a date. */
export function tanggalInggris(iso: string | number | null | undefined): string | null {
  if (iso === null || iso === undefined) return null;
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getDate()} ${BULAN[d.getMonth()].slice(0, 3)}`;
}

/**
 * YOUR OPTIONS — what each answer will actually do, in his language.
 *
 * The keys are the wire values `app/api/decision/route.ts` accepts and must not
 * be renamed; only what is printed beside them is house copy. The English word
 * is the control; the Indonesian sentence is the consequence.
 */
export const OPSI: { aksi: 'SETUJU' | 'REVISI' | 'TOLAK' | 'NANTI'; label: string; arti: string }[] = [
  {
    aksi: 'SETUJU',
    label: 'Approve',
    arti: 'AHMAD boleh menjalankan rencananya, mulai sapuan berikutnya.',
  },
  {
    aksi: 'REVISI',
    label: 'Revise',
    arti: 'Sebutkan yang harus berubah. Tidak ada yang dikerjakan sampai rencana barunya Anda setujui.',
  },
  {
    aksi: 'TOLAK',
    label: 'Decline',
    arti: 'Perkaranya ditutup dan tidak akan dikerjakan.',
  },
  {
    aksi: 'NANTI',
    label: 'Defer',
    arti: 'Tetap menunggu Anda. Tidak ada yang berubah.',
  },
];

/* ------------------------------------------------------------------ *
 * Small English fragments used as frame text. Kept here so a stray
 * Indonesian label cannot creep back into the chrome.
 * ------------------------------------------------------------------ */

export const FRAME = {
  awaitingYou: 'Awaiting you',
  overFourDays: 'Over 4 days',
  blocked: 'Blocked',
  checksPass: 'Checks pass',
  theQuestion: 'The question',
  whatExists: 'What already exists',
  thePlan: 'The proposed plan',
  yourOptions: 'Your options',
  myRecommendation: 'My recommendation',
  ifYouDoNothing: 'If you do nothing',
  whyThisReachedYou: 'Why this reached you',
  history: 'History',
  source: 'Source',
  evidence: 'The evidence',
  openCase: 'Open',
  more: 'more',
  brief: 'Brief',
  lastCheck: 'Last check',
  notDelivered: 'Never delivered',
  requiresYou: 'Requires you',
} as const;
