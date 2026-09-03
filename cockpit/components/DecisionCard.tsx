import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/terminal';
import { OwnerActions } from '@/components/OwnerActions';
import { judulSingkat, sisaJudul, umurSingkat } from '@/components/waktu';
import { kenapaGabisaDisetujui, kenapaNungguLo, type Menunggu } from '@/components/keputusan';

// Paperclip's own status words, said the way the owner would say them.
const STATUS_ID: Record<string, string> = {
  todo: 'belum jalan',
  backlog: 'antre',
  in_progress: 'lagi dikerjakan',
  in_review: 'lagi diperiksa',
  blocked: 'kehalang',
};

export function statusIndonesia(status: string): string {
  return STATUS_ID[status] ?? status.replace(/_/g, ' ');
}

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent';

// A separator you cannot see does no work. Decorative, so it is hidden from
// screen readers, but it still has to be visible to the eye it is drawn for.
function Titik() {
  return (
    <span className="text-os-dim" aria-hidden="true">
      ·
    </span>
  );
}

/**
 * Everything that is evidence rather than the question: the rest of a runaway
 * title, the full body, the plan. Collapsed, because the card above it has to
 * be answerable without any of it.
 */
function Selengkapnya({ m }: { m: Menunggu }) {
  const sisa = sisaJudul(m.d.title);
  const ditulis = umurSingkat(m.d.planAt);
  return (
    <details className="group overflow-hidden rounded-md-t border border-os-border">
      <summary
        className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 font-sans text-[13px] font-medium text-os-muted transition-colors hover:bg-os-surface2 hover:text-os-text [&::-webkit-details-marker]:hidden ${FOKUS}`}
      >
        <ChevronRight
          className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-90"
          aria-hidden="true"
        />
        Selengkapnya
        {ditulis && <span className="ml-auto font-normal">rencana {ditulis}</span>}
      </summary>
      <div className="space-y-3 border-t border-os-border px-3 py-3">
        <p className="text-[13px] leading-relaxed text-os-muted">{kenapaNungguLo(m)}</p>
        {sisa && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-os-muted">
            {sisa}
          </pre>
        )}
        {m.d.description !== null && (
          <p className="max-w-[70ch] whitespace-pre-wrap text-[14px] leading-relaxed text-os-text">
            {m.d.description}
          </p>
        )}
        {m.d.planBody !== null && (
          <pre className="max-h-72 overflow-auto rounded-sm-t bg-os-bg2 px-3 py-3 font-mono text-[12px] leading-relaxed text-os-muted">
            {m.d.planBody}
          </pre>
        )}
      </div>
    </details>
  );
}

/**
 * One waiting item, cut to what the owner needs to answer it: what it is, one
 * line of why, and the four answers. Everything else is one tap away.
 */
export function DecisionCard({ m }: { m: Menunggu }) {
  const terkunci = kenapaGabisaDisetujui(m);
  const umur = umurSingkat(m.d.planAt ?? m.inbox?.sinceIso ?? null);
  // One line under the title, never two: the body when there is one, because
  // that is where the actual question lives, and the reason when there is not.
  const inti = m.d.description ?? kenapaNungguLo(m);
  const adaLagi = m.d.description !== null || m.d.planBody !== null || sisaJudul(m.d.title) !== null;

  return (
    <article className="space-y-3.5 rounded-md-t border border-os-border bg-os-surface px-4 py-4 sm:px-5 sm:py-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-sans text-[13px] text-os-muted">
          <span className="font-mono text-[12px]">{m.d.identifier}</span>
          <Titik />
          <span>{statusIndonesia(m.d.status)}</span>
          {umur && (
            <>
              <Titik />
              <span>nunggu {umur}</span>
            </>
          )}
          {!m.d.cardSent && (
            <Badge tone="warn" ghost>
              belum dikirim
            </Badge>
          )}
          {m.d.ownerRequired && <Badge tone="accent">wajib lo</Badge>}
        </div>
        <h3 className="max-w-[62ch] text-[16px] font-semibold leading-snug text-os-text">
          {judulSingkat(m.d.title)}
        </h3>
        <p className="line-clamp-2 max-w-[70ch] text-[14px] leading-relaxed text-os-muted">{inti}</p>
      </div>

      {adaLagi && <Selengkapnya m={m} />}

      <OwnerActions identifier={m.d.identifier} terkunci={terkunci} />
    </article>
  );
}

/**
 * The same item at a glance, for the queue behind the one being answered.
 * Identifier, subject, age — nothing more.
 */
export function DecisionRow({ m }: { m: Menunggu }) {
  const umur = umurSingkat(m.d.planAt ?? m.inbox?.sinceIso ?? null);
  return (
    <li>
      <Link
        href="/decisions"
        className={`hoverable flex min-h-[44px] items-center gap-3 border-b border-os-hairline px-3 transition-colors last:border-b-0 hover:bg-os-surface2 ${FOKUS}`}
      >
        <span className="shrink-0 font-mono text-[12px] text-os-muted">{m.d.identifier}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
          {judulSingkat(m.d.title)}
        </span>
        <span className="shrink-0 font-sans text-[12px] text-os-muted">
          {m.d.cardSent ? (umur ?? statusIndonesia(m.d.status)) : 'belum dikirim'}
        </span>
      </Link>
    </li>
  );
}
