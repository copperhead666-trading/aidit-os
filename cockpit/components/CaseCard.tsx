import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/terminal';
import { judulSingkat } from '@/components/waktu';
import { umurMs, type Menunggu } from '@/components/keputusan';
import {
  FRAME,
  REKOMENDASI_KOSONG,
  STATE_LABEL,
  rekomendasi,
  sejakInggris,
} from '@/lib/kata';

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent';

export function caseHref(identifier: string): string {
  return `/case/${encodeURIComponent(identifier)}`;
}

/**
 * The card at the top of the deck.
 *
 * It carries no answer buttons, deliberately. The owner's own instruction:
 * "tinggal gua klik dan gua baca keseluruhan konteks yang perlu gua approve" —
 * so answering happens in the opened case, where the whole record is in front
 * of him. A closed card that could be approved would be a card inviting a
 * decision made without reading it.
 *
 * Frame in English, substance in Indonesian.
 */
export function CaseCard({ m }: { m: Menunggu }) {
  const age = sejakInggris(umurMs(m));
  const saran = rekomendasi(m);

  return (
    <article className="rounded-md-t border border-os-border bg-os-surface px-4 py-4 sm:px-5 sm:py-[18px]">
      <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-mono text-[10px] uppercase tracking-[0.12em]">
        <span className="text-os-accent">
          {m.inbox?.state === 'stuck' ? STATE_LABEL.blocked : STATE_LABEL.awaiting}
        </span>
        {age && <span className="text-os-dim">· {age}</span>}
        <span className="ml-auto text-os-dim">{m.d.identifier}</span>
      </div>

      <h3 className="max-w-[52ch] font-serif text-[22px] font-semibold leading-[1.2] tracking-[-0.012em] text-os-text">
        {judulSingkat(m.d.title)}
      </h3>

      <p
        className={`mt-2.5 max-w-[60ch] border-t border-os-border pt-2.5 text-[13px] leading-relaxed ${
          saran ? 'text-os-muted' : 'text-os-dim'
        }`}
      >
        {saran ?? REKOMENDASI_KOSONG}
      </p>

      {(!m.d.cardSent || m.d.ownerRequired) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.d.ownerRequired && <Badge tone="accent">{FRAME.requiresYou}</Badge>}
          {!m.d.cardSent && (
            <Badge tone="warn" ghost>
              {FRAME.notDelivered}
            </Badge>
          )}
        </div>
      )}

      <Link
        href={caseHref(m.d.identifier)}
        className={`mt-3.5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm-t border border-os-accent bg-os-accent px-4 font-sans text-[14px] font-semibold text-os-ink transition-colors hover:bg-os-accent2 sm:w-auto ${FOKUS}`}
      >
        {FRAME.openCase}
        <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      </Link>
    </article>
  );
}

/**
 * One waiting item at a glance, for the queue behind the one being read.
 *
 * `selected` marks the case whose record is open beside it on the desk. It is
 * the only row that carries the accent, so the left column and the right one
 * are visibly about the same thing.
 */
export function CaseRow({ m, selected = false }: { m: Menunggu; selected?: boolean }) {
  const age = sejakInggris(umurMs(m));
  return (
    <li>
      <Link
        href={caseHref(m.d.identifier)}
        aria-current={selected ? 'true' : undefined}
        className={`hoverable flex min-h-[46px] items-center gap-3 border-b border-l-2 border-os-hairline px-3 transition-colors last:border-b-0 hover:bg-os-surface2 ${
          selected ? 'border-l-os-accent bg-os-surface2' : 'border-l-transparent'
        } ${FOKUS}`}
      >
        <span className={`shrink-0 font-mono text-[12px] ${selected ? 'text-os-accent' : 'text-os-dim'}`}>
          {m.d.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
          {judulSingkat(m.d.title)}
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-os-muted">
          {m.d.cardSent ? (age ?? '') : FRAME.notDelivered}
        </span>
      </Link>
    </li>
  );
}
