export const dynamic = 'force-dynamic';

import { readDecisions, type DecisionRecord } from '@/lib/founderos';
import { readOpenDecisions } from '@/lib/sources';
import { readInbox } from '@/lib/inbox';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Dot, SectionHead, SectionTitle } from '@/components/terminal';
import { Strip, type Angka } from '@/components/Strip';
import { DecisionCard } from '@/components/DecisionCard';
import {
  butuhJawaban,
  gabung,
  lagiJalan,
  nyangkut,
  umurMs,
  urutkan,
} from '@/components/keputusan';
import { judulSingkat, umurSingkat } from '@/components/waktu';
import { FRAME, statusLabel } from '@/lib/kata';

/** The line between "waiting" and "waiting too long", in the tiles. */
const EMPAT_HARI = 4 * 24 * 60 * 60 * 1000;

const DAFTAR = 'overflow-hidden rounded-md-t border border-os-border bg-os-surface';

// The ledger speaks in schema words. These are the same things named for a
// reader. Names are frame text, so English.
const JENIS_ID: Record<string, string> = {
  DECISION: 'Decided',
  PRINCIPLE: 'Standing principle',
  HISTORICAL_STATE: 'Historical state',
  IMPLEMENTATION_REALITY: 'Implementation reality',
  AGENT_GENERATED: 'Agent-generated',
  DESIGN_REQUIRED: 'Needs design',
  EXTERNAL_VERIFICATION: 'Needs external check',
};

const ASAL_ID: Record<string, string> = {
  OWNER_DECISION: 'owner decision',
  DIRECT_OWNER_STATEMENT: 'owner said it directly',
  OWNER_APPROVED: 'owner approved',
  OWNER_REQUIRED: 'awaiting owner',
  UNKNOWN: 'origin unknown',
  SUPERSEDED: 'superseded',
  IMPLEMENTATION_REALITY: 'implementation reality',
  AGENT_GENERATED: 'agent-generated',
  DESIGN_REQUIRED: 'not designed yet',
  LEGAL_REVIEW_REQUIRED: 'awaiting legal check',
};

function terjemah(kamus: Record<string, string>, kunci: string): string {
  return kamus[kunci] ?? kunci.toLowerCase().replace(/_/g, ' ');
}

function SumberMati({ apa }: { apa: string }) {
  return (
    <p className="flex min-h-[44px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
      <Dot state="off" />
      <span className="min-w-0">
        <span className="font-semibold text-os-text">{apa} tidak terbaca.</span> Isinya sengaja
        dikosongkan.
      </span>
    </p>
  );
}

function Kosong({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex min-h-[44px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
      <Dot state="ok" />
      {children}
    </p>
  );
}

function BarisCatatan({ r }: { r: DecisionRecord }) {
  const diganti = r.status === 'SUPERSEDED';
  return (
    <li
      className={`space-y-1.5 border-b border-os-hairline px-3 py-3.5 last:border-b-0 ${
        diganti ? 'opacity-65' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-os-muted">
        <span className="font-mono text-[12px]">{r.id}</span>
        <span className="text-os-dim" aria-hidden="true">
          ·
        </span>
        <span>{r.domain}</span>
        <span className="text-os-dim" aria-hidden="true">
          ·
        </span>
        <span>{terjemah(ASAL_ID, r.status)}</span>
        {r.canonical === true && <Badge tone="accent">canonical</Badge>}
        {typeof r.migrated_from === 'string' && (
          <Badge tone="default" ghost>
            migrated
          </Badge>
        )}
      </div>
      <p className="max-w-[74ch] text-[13px] leading-relaxed text-os-text">{r.statement}</p>
    </li>
  );
}

export default async function DecisionsPage() {
  const [ledger, openDecisions, inbox] = await Promise.all([
    readDecisions(),
    readOpenDecisions(),
    readInbox(),
  ]);

  const semua = openDecisions === null ? null : gabung(openDecisions, inbox);
  const antre = semua === null ? null : urutkan(butuhJawaban(semua));
  const macet = semua === null ? null : urutkan(nyangkut(semua));
  const jalan = semua === null ? null : lagiJalan(semua);
  const records = ledger?.records ?? null;

  const lamaNunggu = (antre ?? []).filter((m) => {
    const ms = umurMs(m);
    return ms !== null && ms > EMPAT_HARI;
  }).length;

  // Groups ordered largest first, ties alphabetically — the same ordering the
  // ledger page has always used, kept so the page does not reshuffle on reload.
  const perJenis = new Map<string, DecisionRecord[]>();
  for (const r of records ?? []) {
    const arr = perJenis.get(r.type) ?? [];
    arr.push(r);
    perJenis.set(r.type, arr);
  }
  const kelompok = [...perJenis.entries()].sort((a, b) =>
    b[1].length !== a[1].length ? b[1].length - a[1].length : a[0].localeCompare(b[0]),
  );

  const angka: Angka[] = [
    {
      value: antre === null ? '—' : String(antre.length),
      label: 'Awaiting',
      tone: antre !== null && antre.length > 0 ? 'accent' : 'plain',
    },
    {
      value: antre === null ? '—' : String(lamaNunggu),
      label: '4+ days',
      tone: lamaNunggu > 0 ? 'err' : 'plain',
    },
    {
      value: macet === null ? '—' : String(macet.length),
      label: 'Blocked',
      tone: macet !== null && macet.length > 0 ? 'err' : 'plain',
    },
    {
      value: records === null ? '—' : String(records.length),
      label: 'Ledger',
      tone: 'plain',
    },
  ];

  return (
    <div className="view max-w-[900px] pb-4">
      <PageHeader title="Decisions" />

      <Strip figures={angka} />

      <section className="mb-9 mt-6">
        <SectionTitle count={antre?.length}>{FRAME.awaitingYou}</SectionTitle>
        {antre === null ? (
          <SumberMati apa="Papan kerja" />
        ) : antre.length === 0 ? (
          <Kosong>Tidak ada yang menunggu Anda.</Kosong>
        ) : (
          <div className="space-y-4">
            {antre.map((m) => (
              <DecisionCard key={m.d.identifier} m={m} />
            ))}
          </div>
        )}
      </section>

      {macet !== null && macet.length > 0 && (
        <section className="mb-9">
          <SectionTitle count={macet.length}>Blocked — needs new direction</SectionTitle>
          <div className="space-y-4">
            {macet.map((m) => (
              <DecisionCard key={m.d.identifier} m={m} />
            ))}
          </div>
        </section>
      )}

      {jalan !== null && jalan.length > 0 && (
        <section className="mb-9">
          <SectionTitle count={jalan.length}>In progress</SectionTitle>
          <ul className={DAFTAR}>
            {jalan.map((m) => (
              <li
                key={m.d.identifier}
                className="flex min-h-[44px] items-center gap-3 border-b border-os-hairline px-3 last:border-b-0"
              >
                <span className="shrink-0 font-mono text-[12px] text-os-muted">
                  {m.d.identifier}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
                  {judulSingkat(m.d.title)}
                </span>
                <span className="shrink-0 text-[12px] text-os-muted">
                  {umurSingkat(m.inbox?.sinceIso ?? null) ?? statusLabel(m.d.status)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle count={records?.length}>The ledger</SectionTitle>
        {records === null ? (
          <SumberMati apa="Buku keputusan" />
        ) : records.length === 0 ? (
          <Kosong>Belum ada yang tercatat.</Kosong>
        ) : (
          <div className="space-y-7">
            {kelompok.map(([jenis, isi]) => (
              <div key={jenis}>
                {/* One level down from the section heading above: the archive
                    groups are a machine-room index, not four more headlines. */}
                <SectionHead label={terjemah(JENIS_ID, jenis)} count={isi.length} />
                <ul className={DAFTAR}>
                  {isi.map((r) => (
                    <BarisCatatan key={r.id} r={r} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
