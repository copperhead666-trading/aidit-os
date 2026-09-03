import { judulSingkat, sisaJudul } from '@/components/waktu';
import { umurMs, kenapaGabisaDisetujui, type Menunggu } from '@/components/keputusan';
import {
  FRAME,
  ISI_KOSONG,
  OPSI,
  REKOMENDASI_KOSONG,
  STATE_LABEL,
  kalauDidiamkan,
  kenapaSampaiKeAnda,
  pertanyaannya,
  rekomendasi,
  sejakInggris,
  tanggalInggris,
} from '@/lib/kata';

/**
 * The decision record: the eight slots the owner asked for after KOL-67 reached
 * him carrying a topic instead of a decision ("KPI sudah dibuat — tapi apa isi
 * KPI-nya?").
 *
 * Slot labels are English; every value is Indonesian, because a value is
 * something he reads to understand his own business.
 *
 * A slot with nothing behind it says so. It does not get filled with a
 * plausible sentence — a missing source reads as missing, never as zero, and a
 * recommendation nobody reasoned to is worse than a visible gap because he
 * would act on it.
 */

function Slot({
  k,
  children,
  dim = false,
}: {
  k: string;
  children: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <section className="border-t border-os-border pt-3.5">
      <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-os-dim">{k}</h3>
      <div
        className={`max-w-[68ch] whitespace-pre-wrap text-[14px] leading-relaxed ${
          dim ? 'text-os-dim' : 'text-os-text'
        }`}
      >
        {children}
      </div>
    </section>
  );
}

export function CaseDetail({ m }: { m: Menunggu }) {
  const age = sejakInggris(umurMs(m));
  const raised = tanggalInggris(m.d.planAt ?? m.inbox?.sinceIso ?? null);
  const saran = rekomendasi(m);
  const terkunci = kenapaGabisaDisetujui(m);
  const sisa = sisaJudul(m.d.title);
  const state = m.inbox?.state === 'stuck' ? STATE_LABEL.blocked : STATE_LABEL.awaiting;

  // The filing line. Only the parts that exist, so a missing date never leaves
  // a separator hanging on its own.
  const jejak = [
    raised ? `Raised ${raised}` : null,
    age,
    m.d.cardSent ? null : FRAME.notDelivered,
  ].filter((s): s is string => s !== null && s !== '');

  return (
    <div className="space-y-3.5">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-os-accent">
          {state}
          {m.d.ownerRequired ? ` · ${FRAME.requiresYou}` : ''}
        </p>
        <h2 className="mt-2 max-w-[38ch] font-serif text-[24px] font-semibold leading-[1.16] tracking-[-0.015em] text-os-text">
          {judulSingkat(m.d.title)}
        </h2>
        {jejak.length > 0 && (
          <p className="mt-2 font-mono text-[12px] tabular-nums text-os-dim">{jejak.join(' · ')}</p>
        )}
      </header>

      <Slot k={FRAME.theQuestion}>{pertanyaannya(m)}</Slot>

      <Slot k={FRAME.whatExists} dim={m.d.description === null}>
        {m.d.description ?? ISI_KOSONG}
      </Slot>

      {sisa && (
        <Slot k="Rest of the title" dim>
          {sisa}
        </Slot>
      )}

      {m.d.planBody !== null && (
        <section className="border-t border-os-border pt-3.5">
          <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-os-dim">
            {FRAME.thePlan}
          </h3>
          {/* Verbatim. Quoted material is never rewritten — a translated or
              tidied quote stops being evidence. */}
          <pre className="max-h-80 overflow-auto rounded-sm-t bg-os-bg2 px-3 py-3 font-mono text-[12px] leading-relaxed text-os-muted">
            {m.d.planBody}
          </pre>
        </section>
      )}

      <Slot k={FRAME.yourOptions}>
        <ul className="space-y-2">
          {OPSI.filter((o) => !(terkunci && o.aksi === 'SETUJU')).map((o) => (
            <li key={o.aksi} className="flex gap-2.5">
              <span className="mt-[7px] h-[6px] w-[6px] shrink-0 rounded-full bg-os-border-strong" />
              <span>
                <span className="font-semibold text-os-text">{o.label}</span>
                <span className="text-os-muted"> — {o.arti}</span>
              </span>
            </li>
          ))}
        </ul>
        {terkunci && (
          <p className="mt-2.5 border-l-2 border-os-warn pl-3 text-[13px] leading-relaxed text-os-muted">
            <span className="font-semibold text-os-text">Approve tidak ditawarkan di sini.</span>{' '}
            {terkunci}
          </p>
        )}
      </Slot>

      <Slot k={FRAME.myRecommendation} dim={saran === null}>
        {saran ?? REKOMENDASI_KOSONG}
      </Slot>

      <Slot k={FRAME.ifYouDoNothing}>{kalauDidiamkan(m)}</Slot>

      <Slot k={FRAME.whyThisReachedYou} dim>
        {kenapaSampaiKeAnda(m)}
      </Slot>

      <section className="border-t border-os-border pt-3.5">
        <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-os-dim">
          {FRAME.source}
        </h3>
        <dl className="font-mono text-[12px] text-os-dim">
          <div className="flex justify-between gap-3 border-b border-os-hairline py-1.5">
            <dt>Case</dt>
            <dd className="text-os-muted">{m.d.identifier}</dd>
          </div>
          <div className="flex justify-between gap-3 border-b border-os-hairline py-1.5">
            <dt>Board status</dt>
            <dd className="text-os-muted">{m.d.status}</dd>
          </div>
          {m.d.labels.length > 0 && (
            <div className="flex justify-between gap-3 border-b border-os-hairline py-1.5">
              <dt>Labels</dt>
              <dd className="min-w-0 truncate text-os-muted">{m.d.labels.join(' · ')}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 py-1.5">
            <dt>Telegram card</dt>
            <dd className="text-os-muted">{m.d.cardSent ? 'sent' : 'never sent'}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
