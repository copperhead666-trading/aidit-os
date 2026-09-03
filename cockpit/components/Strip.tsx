import Link from 'next/link';

/**
 * The instrument strip: four figures on one line, 62px tall.
 *
 * It replaces the four 168px tiles that used to open this screen. On an iPhone
 * 12 Pro in Safari there are 664 points of live screen; the tiles spent 384 of
 * them on statistics before the first thing the owner has to answer appeared.
 * The figures still matter, so they are still here — they are just no longer
 * the point of the screen.
 *
 * Every figure links to the list that produced it, so a number can always be
 * checked against the rows it counted.
 */
export type StripTone = 'plain' | 'accent' | 'err' | 'ok';

const NADA: Record<StripTone, string> = {
  plain: 'text-os-text',
  accent: 'text-os-accent',
  err: 'text-os-err',
  ok: 'text-os-ok',
};

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-os-accent';

export interface Angka {
  /** The figure itself. Em dash when the source could not be read. */
  value: string;
  /** English: a figure's name is frame text. */
  label: string;
  href?: string;
  tone?: StripTone;
}

function Isi({ f }: { f: Angka }) {
  return (
    <>
      <span
        className={`font-mono text-[19px] font-semibold leading-none tabular-nums ${NADA[f.tone ?? 'plain']}`}
      >
        {f.value}
      </span>
      <span className="mt-1.5 truncate font-sans text-[10px] uppercase tracking-[0.08em] text-os-dim">
        {f.label}
      </span>
    </>
  );
}

const SEL = 'flex min-h-[62px] min-w-0 flex-col justify-center border-l border-os-border px-3 first:border-l-0 sm:px-4';

export function Strip({ figures }: { figures: Angka[] }) {
  return (
    <div className="grid grid-cols-4 border-y border-os-border">
      {figures.map((f) =>
        f.href === undefined ? (
          <div key={f.label} className={SEL}>
            <Isi f={f} />
          </div>
        ) : (
          <Link
            key={f.label}
            href={f.href}
            className={`hoverable ${SEL} transition-colors hover:bg-os-surface ${FOKUS}`}
          >
            <Isi f={f} />
          </Link>
        ),
      )}
    </div>
  );
}
