import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/terminal';
import { judulSingkat } from '@/components/waktu';
import { umurMs, type Menunggu } from '@/components/keputusan';
import { caseHref } from '@/components/CaseCard';
import {
  FRAME,
  REKOMENDASI_KOSONG,
  STATE_LABEL,
  rekomendasi,
  sejakInggris,
  statusLabel,
} from '@/lib/kata';

export { statusLabel };

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent';

/**
 * A waiting item on the Decisions page: what it is, one line of stance, and the
 * way in. No answer buttons here either — every answer is given inside the
 * opened case, with the whole record in front of him.
 */
export function DecisionCard({ m }: { m: Menunggu }) {
  const age = sejakInggris(umurMs(m));
  const saran = rekomendasi(m);

  return (
    <article className="rounded-md-t border border-os-border bg-os-surface px-4 py-4 sm:px-5">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[10px] uppercase tracking-[0.12em]">
        <span className="text-os-accent">
          {m.inbox?.state === 'stuck' ? STATE_LABEL.blocked : STATE_LABEL.awaiting}
        </span>
        {age && <span className="text-os-dim">· {age}</span>}
        <span className="ml-auto text-os-dim">{m.d.identifier}</span>
      </div>

      <h3 className="max-w-[56ch] font-serif text-[19px] font-semibold leading-[1.24] tracking-[-0.012em] text-os-text">
        {judulSingkat(m.d.title)}
      </h3>

      <p
        className={`mt-2 max-w-[68ch] text-[13px] leading-relaxed ${
          saran ? 'text-os-muted' : 'text-os-dim'
        }`}
      >
        {saran ?? REKOMENDASI_KOSONG}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {m.d.ownerRequired && <Badge tone="accent">{FRAME.requiresYou}</Badge>}
        {!m.d.cardSent && (
          <Badge tone="warn" ghost>
            {FRAME.notDelivered}
          </Badge>
        )}
        <Link
          href={caseHref(m.d.identifier)}
          className={`ml-auto inline-flex min-h-[44px] items-center gap-2 rounded-sm-t border border-os-border-strong px-4 font-sans text-[13px] font-semibold text-os-text transition-colors hover:bg-os-surface2 ${FOKUS}`}
        >
          {FRAME.openCase}
          <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

/** The same item at a glance, for a list. */
export function DecisionRow({ m }: { m: Menunggu }) {
  const age = sejakInggris(umurMs(m));
  return (
    <li>
      <Link
        href={caseHref(m.d.identifier)}
        className={`hoverable flex min-h-[46px] items-center gap-3 border-b border-os-hairline px-3 transition-colors last:border-b-0 hover:bg-os-surface2 ${FOKUS}`}
      >
        <span className="shrink-0 font-mono text-[12px] text-os-dim">{m.d.identifier}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
          {judulSingkat(m.d.title)}
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-os-dim">
          {m.d.cardSent ? (age ?? '') : FRAME.notDelivered}
        </span>
      </Link>
    </li>
  );
}
