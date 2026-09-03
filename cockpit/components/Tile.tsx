import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/**
 * One number, big enough to read at arm's length on a phone, with a small
 * labelled icon above it and a single phrase under it. Nothing else fits by
 * design: the detail lives on the page the tile points at.
 */
export type TileTone = 'netral' | 'butuh' | 'buruk';

// Colour never carries the meaning alone — the label names the thing and the
// sub-line says what happened. The hue only ranks the four tiles against each
// other at a glance.
const NILAI: Record<TileTone, string> = {
  netral: 'text-os-text',
  butuh: 'text-os-accent',
  buruk: 'text-os-err',
};

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent';

export type TileMark = 'ok' | 'warn' | 'bad' | 'idle';

// One mark per real item — not a sparkline, not a trend, no invented series.
// Fifteen marks under "15/15" are the fifteen checks, and a red one is a check
// that failed. When there is nothing real to count the row is not drawn.
const MARK: Record<TileMark, string> = {
  ok: 'bg-os-ok',
  warn: 'bg-os-warn',
  bad: 'bg-os-err',
  idle: 'bg-os-border-strong',
};

function Marks({ marks }: { marks: TileMark[] }) {
  if (marks.length === 0) return null;
  const shown = marks.slice(0, 24);
  return (
    <div className="mt-3 flex items-end gap-[3px]" aria-hidden="true">
      {shown.map((m, i) => (
        <span key={i} className={`h-[7px] w-full rounded-[1px] ${MARK[m]}`} />
      ))}
    </div>
  );
}

const KOTAK =
  'flex min-h-[168px] flex-col rounded-md-t bg-os-surface px-5 py-5';

export function Tile({
  icon: Ikon,
  label,
  value,
  sub,
  href,
  tone = 'netral',
  marks,
}: {
  icon: LucideIcon;
  label: string;
  /** The one number. Mono, because it is a count or a ratio. */
  value: string;
  /** One phrase. If it needs a sentence, it belongs on the page behind it. */
  sub: string;
  href?: string;
  tone?: TileTone;
  /** One entry per real item. Omitted when nothing real can be counted. */
  marks?: TileMark[];
}) {
  const isi = (
    <>
      <div className="flex items-center gap-2 font-sans text-[13px] text-os-muted">
        <Ikon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <p
        className={`mt-auto pt-6 font-mono text-[32px] font-semibold leading-none tracking-[-0.03em] ${NILAI[tone]}`}
      >
        {value}
      </p>
      <p className="mt-2 font-sans text-[13px] leading-snug text-os-muted">{sub}</p>
      {marks && marks.length > 0 && <Marks marks={marks} />}
    </>
  );

  if (href === undefined) {
    return <div className={KOTAK}>{isi}</div>;
  }
  return (
    <Link href={href} className={`hoverable ${KOTAK} transition-colors hover:bg-os-surface2 ${FOKUS}`}>
      {isi}
    </Link>
  );
}

/** The row the four tiles sit in: two across on a phone, four on a wide screen. */
export function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-9 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{children}</div>;
}
