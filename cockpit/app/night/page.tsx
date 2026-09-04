export const dynamic = 'force-dynamic';

import { readNight, type NightRun, type NightWaiting } from '@/lib/night';
import { PageHeader } from '@/components/PageHeader';
import { Badge, SectionHead } from '@/components/terminal';

const PANEL = 'overflow-hidden rounded-md border border-os-border bg-os-surface';

// Outcome names are frame text, so English. The sentences underneath are the
// owner's language.
const OUTCOME_LABEL: Record<string, string> = {
  done: 'Done',
  'no-op': 'No change',
  failed: 'Failed',
  reverted: 'Reverted',
};

const OUTCOME_TONE: Record<string, 'ok' | 'warn' | 'err'> = {
  done: 'ok',
  'no-op': 'warn',
  failed: 'err',
  reverted: 'err',
};

function jam(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Run({ run }: { run: NightRun }) {
  const tone = OUTCOME_TONE[run.outcome] ?? 'warn';
  return (
    <li className="border-b border-os-border px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-os-text">{run.identifier}</span>
        <Badge tone={tone}>{OUTCOME_LABEL[run.outcome] ?? run.outcome}</Badge>
        <span className="ml-auto font-mono text-xs text-os-dim">{jam(run.finishedAt)}</span>
      </div>

      {run.filesChanged.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {run.filesChanged.map((f) => (
            <li key={f} className="font-mono text-xs text-os-dim">
              {f}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-os-dim">Tidak ada berkas yang berubah.</p>
      )}

      {/* A VERIFY line is shown only when the ledger carried one. An absent
          verdict is stated as absent rather than rendered as a pass. */}
      <div className="mt-2 text-xs">
        {run.verify ? (
          <>
            <span className={run.verifyOk ? 'text-os-accent' : 'text-os-muted'}>
              {run.verifyOk ? 'VERIFY hijau' : 'VERIFY merah'}
            </span>
            <span className="ml-2 font-mono text-os-dim">{run.verify}</span>
          </>
        ) : (
          <span className="text-os-dim">VERIFY tidak tercatat untuk directive ini.</span>
        )}
      </div>

      {run.reason && <p className="mt-1 text-xs text-os-dim">Alasan: {run.reason}</p>}
    </li>
  );
}

function Waiting({ item }: { item: NightWaiting }) {
  return (
    <li className="border-b border-os-border px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-os-text">{item.identifier}</span>
        <Badge tone="warn">{item.kind}</Badge>
        <span className="ml-auto font-mono text-xs text-os-dim">{jam(item.at)}</span>
      </div>
      {item.reason && <p className="mt-1 text-xs text-os-dim">{item.reason}</p>}
    </li>
  );
}

export default async function NightPage() {
  const night = await readNight();

  return (
    <div>
      <PageHeader eyebrow="Overnight" title="What ran while you slept" />

      {/* The headline is the whole point. A night with nothing done says so in
          a sentence; an empty page would read as a broken page, and the owner
          could not tell "nothing needed doing" from "the loop never woke up". */}
      <p className="mb-6 text-sm text-os-text">{night.headline}</p>

      {night.unreadable && (
        <p className="mb-6 rounded-md border border-os-border-strong px-4 py-3 text-sm text-os-muted">
          Ledger tidak dapat dibaca, jadi halaman ini tidak tahu apa yang terjadi semalam. Ini bukan
          malam yang sepi — ini catatan yang hilang.
        </p>
      )}

      <section className="mb-8">
        <SectionHead label="Dijalankan" count={night.ran.length} />
        {night.ran.length > 0 ? (
          <ul className={PANEL}>
            {night.ran.map((r) => (
              <Run key={`${r.identifier}-${r.finishedAt}`} run={r} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-os-dim">
            Tidak ada directive yang dieksekusi pada {night.day}.
          </p>
        )}
      </section>

      <section>
        <SectionHead label="Menunggu Anda" count={night.awaiting.length} />
        {night.awaiting.length > 0 ? (
          <ul className={PANEL}>
            {night.awaiting.map((a) => (
              <Waiting key={`${a.identifier}-${a.kind}`} item={a} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-os-dim">Tidak ada yang menunggu keputusan Anda.</p>
        )}
      </section>
    </div>
  );
}
