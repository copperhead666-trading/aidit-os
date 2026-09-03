/**
 * Indonesian time and counting helpers shared by the home surface and the
 * decisions page. Pure functions only — no I/O, no React — so both a server
 * component and a client component can import them.
 */

/** "3 jam lalu", "2 hari lalu". Returns null when the input is not a real date. */
export function lamanya(iso: string | number | null | undefined): string | null {
  if (iso === null || iso === undefined) return null;
  const then = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const diff = Date.now() - then;
  if (diff < 0) return 'baru saja';
  const menit = Math.floor(diff / 60_000);
  if (menit < 1) return 'baru saja';
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari < 30) return `${hari} hari lalu`;
  return `${Math.floor(hari / 30)} bulan lalu`;
}

/**
 * The same age with the trailing "lalu" cut off — "3 jam", "2 hari". For list
 * rows and tiles, where a third word is a word too many.
 */
export function umurSingkat(iso: string | number | null | undefined): string | null {
  const s = lamanya(iso);
  if (s === null) return null;
  return s === 'baru saja' ? 'baru' : s.replace(/ lalu$/, '');
}

/** Clock time in the machine's own zone, e.g. "15:38". */
export function jamMenit(iso: string | number | null | undefined): string | null {
  if (iso === null || iso === undefined) return null;
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "21 detik", "3 menit" — for durations, not for points in time. */
export function durasi(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} detik`;
  const menit = Math.round(ms / 60_000);
  if (menit < 60) return `${menit} menit`;
  const jam = Math.floor(menit / 60);
  return `${jam} jam ${menit % 60} menit`;
}

/** Time-of-day greeting, Indonesian. */
export function sapaan(now = new Date()): string {
  const h = now.getHours();
  if (h < 4) return 'Masih malam';
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/**
 * Trims a multi-line issue title down to its first meaningful line. Some
 * directives carry their whole body in the title field, which would otherwise
 * flood a list row.
 */
// Routing prefixes the runner writes into issue titles. They tell the system
// which queue an item belongs to; they tell the owner nothing, and on a phone
// they were eating the first third of every headline.
const AWALAN = [
  /^OWNER DIRECTIVE:\s*/i,
  /^P[0-9]+ DECISION NEEDED:\s*/i,
  /^DECISION NEEDED:\s*/i,
  /^FYI\/DECISION:\s*/i,
  /^DECISION:\s*/i,
  /^APPROVE:\s*/i,
  /^BUG:\s*/i,
  /^SELFTEST:\s*/i,
  /^UX TEST:\s*/i,
  /^LIVE RETEST:\s*/i,
];

/** First real line of a title, with the routing prefix dropped. */
export function judulSingkat(title: string): string {
  const first = title.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? title.trim();
  let bersih = first;
  for (const re of AWALAN) bersih = bersih.replace(re, '');
  bersih = bersih.trim();
  // A title that was nothing but its prefix keeps the original rather than
  // rendering an empty headline.
  return bersih.length > 0 ? bersih : first;
}

/** The rest of a multi-line title, if there is any. */
export function sisaJudul(title: string): string | null {
  const lines = title.split('\n');
  const firstIndex = lines.findIndex((l) => l.trim().length > 0);
  if (firstIndex === -1) return null;
  const rest = lines.slice(firstIndex + 1).join('\n').trim();
  return rest.length > 0 ? rest : null;
}
