export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { readHeartbeat, readLanes, type LaneStat } from '@/lib/founderos';
import { readOpenDecisions, readIssues, type IssueSummary } from '@/lib/sources';
import { readInbox } from '@/lib/inbox';
import { Dot, SectionTitle } from '@/components/terminal';
import { Strip, type Angka } from '@/components/Strip';
import { CaseCard, CaseRow } from '@/components/CaseCard';
import { CaseDetail } from '@/components/CaseDetail';
import { OwnerActions } from '@/components/OwnerActions';
import {
  butuhJawaban,
  gabung,
  kenapaGabisaDisetujui,
  nyangkut,
  umurMs,
  urutkan,
  type Menunggu,
} from '@/components/keputusan';
import { judulSingkat } from '@/components/waktu';
import { FRAME, dateline, jam, laneRole, sejakInggris, statusLabel } from '@/lib/kata';

const FOKUS =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-os-accent';

/** How many of the waiting queue to list under the one being read, on a phone. */
const PRATINJAU = 5;

/** On the desk the queue is the left column, so it can be longer. */
const PRATINJAU_MEJA = 8;

/** The line between "waiting" and "waiting too long". */
const EMPAT_HARI = 4 * 24 * 60 * 60 * 1000;

const DAFTAR = 'overflow-hidden rounded-md-t border border-os-border bg-os-surface';
const BARIS = 'flex min-h-[46px] items-center gap-3 border-b border-os-hairline px-3 last:border-b-0';

function Kosong({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex min-h-[46px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
      <Dot state="ok" />
      {children}
    </p>
  );
}

function SumberMati({ apa }: { apa: string }) {
  return (
    <p className="flex min-h-[46px] items-center gap-2.5 rounded-md-t border border-os-border bg-os-surface px-4 py-3 text-[13px] text-os-muted">
      <Dot state="off" />
      <span className="min-w-0">
        <span className="font-semibold text-os-text">{apa} tidak terbaca.</span> Angkanya sengaja
        dikosongkan.
      </span>
    </p>
  );
}

// A lane is only called out when its own numbers say something is wrong: the
// quota is spent, or it has been called enough times to know the failures are a
// pattern and not one bad night.
function laneBermasalah(lane: LaneStat): string | null {
  if (lane.quotaExhausted) return 'jatah mingguannya habis';
  if (lane.runs >= 3 && lane.ok === 0) return `${lane.runs} kali dipanggil, tidak satu pun jadi`;
  if (lane.runs >= 3 && lane.ok / lane.runs <= 0.5) {
    return `hanya ${Math.round((lane.ok / lane.runs) * 100)}% yang jadi`;
  }
  return null;
}

export default async function Page() {
  const [heartbeat, lanes, openDecisions, inbox, issues] = await Promise.all([
    readHeartbeat(),
    readLanes(),
    readOpenDecisions(),
    readInbox(),
    readIssues(),
  ]);

  const semua = openDecisions === null ? null : gabung(openDecisions, inbox);
  const antre = semua === null ? null : urutkan(butuhJawaban(semua));
  const macet = semua === null ? null : nyangkut(semua);
  const paling: Menunggu | null = antre && antre.length > 0 ? antre[0] : null;
  const sisanya = antre ? antre.slice(1) : [];

  const jalan: IssueSummary[] =
    issues?.filter((i) => i.status === 'in_progress' || i.status === 'in_review') ?? [];
  const laneRusak = (lanes ?? [])
    .map((l) => ({ lane: l, sebab: laneBermasalah(l) }))
    .filter((x): x is { lane: LaneStat; sebab: string } => x.sebab !== null);
  const totalMacet = (macet?.length ?? 0) + laneRusak.length;

  const lamaNunggu = (antre ?? []).filter((m) => {
    const ms = umurMs(m);
    return ms !== null && ms > EMPAT_HARI;
  }).length;

  // Four figures, 62 points, and then the work. Each one links to the list that
  // produced it, so a count can always be checked against its own rows.
  // Strip labels are cut short on purpose: four of them share 390 points, and a
  // truncated label is worse than a terse one. The section heading directly
  // below says "Awaiting you" in full, so nothing is lost.
  const angka: Angka[] = [
    {
      value: antre === null ? '—' : String(antre.length),
      label: 'Awaiting',
      href: '/decisions',
      tone: antre !== null && antre.length > 0 ? 'accent' : 'plain',
    },
    {
      value: antre === null ? '—' : String(lamaNunggu),
      label: '4+ days',
      href: '/decisions',
      tone: lamaNunggu > 0 ? 'err' : 'plain',
    },
    {
      value: semua === null && lanes === null ? '—' : String(totalMacet),
      label: 'Blocked',
      href: '/inbox',
      tone: totalMacet > 0 ? 'err' : 'plain',
    },
    {
      value: heartbeat === null ? '—' : `${heartbeat.succeeded}/${heartbeat.total}`,
      label: 'Checks',
      href: '/doctor',
      tone: heartbeat === null ? 'plain' : heartbeat.failed === 0 ? 'ok' : 'err',
    },
  ];

  return (
    <div className="view pb-6">
      {/* A dateline, not a greeting. It says when this was true, which is the
          one thing a greeting never told him — and it costs 40 points where
          "Selamat pagi, Adit" cost 90. */}
      <header className="pb-3.5">
        <p className="font-serif text-[22px] leading-tight tracking-[-0.01em] text-os-text">
          {dateline()}
        </p>
        <p className="mt-0.5 font-mono text-[12px] tabular-nums text-os-dim">{jam()}</p>
      </header>

      <Strip figures={angka} />

      <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-8">
        {/* ---------------- the queue ---------------- */}
        <div className="min-w-0">
          <SectionTitle count={antre?.length} link="All" href="/decisions">
            {FRAME.awaitingYou}
          </SectionTitle>

          {antre === null ? (
            <SumberMati apa="Papan kerja" />
          ) : antre.length === 0 ? (
            <Kosong>Tidak ada yang menunggu Anda.</Kosong>
          ) : (
            <>
              {/* The phone gets one case at a time: the whole context of the
                  head of the queue, and an honest count of what is behind it. */}
              <div className="lg:hidden">
                {paling && <CaseCard m={paling} />}
                {sisanya.length > 0 && (
                  <div className={`mt-4 ${DAFTAR}`}>
                    <ul>
                      {sisanya.slice(0, PRATINJAU).map((m) => (
                        <CaseRow key={m.d.identifier} m={m} />
                      ))}
                    </ul>
                    {sisanya.length > PRATINJAU && (
                      <Link
                        href="/decisions"
                        className={`hoverable flex min-h-[46px] items-center border-t border-os-border px-3 font-sans text-[13px] font-medium text-os-muted transition-colors hover:bg-os-surface2 hover:text-os-text ${FOKUS}`}
                      >
                        {sisanya.length - PRATINJAU} {FRAME.more}
                      </Link>
                    )}
                  </div>
                )}
              </div>

              {/* The desk gets the whole queue instead, because the record of
                  the head of it is already open in the column beside this one.
                  Repeating that case as a big card here would say it twice. */}
              <div className={`hidden lg:block ${DAFTAR}`}>
                <ul>
                  {antre.slice(0, PRATINJAU_MEJA).map((m, i) => (
                    <CaseRow key={m.d.identifier} m={m} selected={i === 0} />
                  ))}
                </ul>
                {antre.length > PRATINJAU_MEJA && (
                  <Link
                    href="/decisions"
                    className={`hoverable flex min-h-[46px] items-center border-t border-os-border px-3 font-sans text-[13px] font-medium text-os-muted transition-colors hover:bg-os-surface2 hover:text-os-text ${FOKUS}`}
                  >
                    {antre.length - PRATINJAU_MEJA} {FRAME.more}
                  </Link>
                )}
              </div>
            </>
          )}

          <section className="mt-8">
            <SectionTitle
              count={issues === null ? undefined : jalan.length}
              link="All work"
              href="/tasks"
            >
              In progress
            </SectionTitle>
            {issues === null ? (
              <SumberMati apa="Papan kerja" />
            ) : jalan.length === 0 ? (
              <Kosong>Tidak ada yang sedang berjalan.</Kosong>
            ) : (
              <ul className={DAFTAR}>
                {jalan.map((i) => (
                  <li key={i.identifier} className={BARIS}>
                    <Dot state="warn" />
                    <span className="shrink-0 font-mono text-[12px] text-os-dim">
                      {i.identifier}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
                      {judulSingkat(i.title)}
                    </span>
                    <span className="shrink-0 font-mono text-[12px] tabular-nums text-os-dim">
                      {sejakInggris(i.updatedAt === null ? null : Date.now() - Date.parse(i.updatedAt)) ??
                        statusLabel(i.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <SectionTitle
              count={semua === null && lanes === null ? undefined : totalMacet}
              link="Attention"
              href="/inbox"
            >
              {FRAME.blocked}
            </SectionTitle>
            {semua === null && lanes === null ? (
              <SumberMati apa="Papan kerja dan catatan jalur" />
            ) : totalMacet === 0 ? (
              <Kosong>Tidak ada yang mentok.</Kosong>
            ) : (
              <ul className={DAFTAR}>
                {(macet ?? []).map((m) => {
                  // Metadata, so English: an age and a failure count are frame,
                  // not something he reads to understand the business.
                  const jejak = [
                    m.inbox && m.inbox.attempts > 0 ? `failed ${m.inbox.attempts}×` : null,
                    sejakInggris(umurMs(m)),
                  ].filter((s): s is string => s !== null);
                  return (
                    <li key={m.d.identifier} className={BARIS}>
                      <Dot state="err" />
                      <span className="shrink-0 font-mono text-[12px] text-os-dim">
                        {m.d.identifier}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
                        {judulSingkat(m.d.title)}
                      </span>
                      {jejak.length > 0 && (
                        <span className="shrink-0 text-[12px] text-os-dim">{jejak.join(' · ')}</span>
                      )}
                    </li>
                  );
                })}
                {laneRusak.map(({ lane, sebab }) => {
                  const role = laneRole(lane.lane);
                  return (
                    <li key={lane.lane} className={BARIS}>
                      <Dot state="warn" />
                      <span className="shrink-0 font-mono text-[12px] text-os-dim">
                        {lane.lane}
                        {role ? ` · ${role}` : ''}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-os-text">
                        {sebab}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* ---------------- the evidence ----------------
            The whole reason to open a laptop rather than answer from bed: the
            case and what it rests on, side by side. Hidden below `lg`, where
            the phone gives it a screen of its own instead. */}
        {paling && (
          <aside className="hidden lg:sticky lg:top-[72px] lg:block">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.15em] text-os-dim">
                {FRAME.evidence}
              </h2>
              <span className="font-mono text-[12px] text-os-dim">{paling.d.identifier}</span>
            </div>
            <div className="max-h-[calc(100vh-160px)] overflow-y-auto rounded-md-t border border-os-border bg-os-surface px-5 py-5">
              <CaseDetail m={paling} />
              <div className="mt-6 border-t border-os-border pt-5">
                <OwnerActions
                  identifier={paling.d.identifier}
                  terkunci={kenapaGabisaDisetujui(paling)}
                />
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
