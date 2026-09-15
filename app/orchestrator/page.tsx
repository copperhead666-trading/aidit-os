import { orchestratorSnapshot } from '@/lib/connectors/conductor';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Dot, SectionHead, type BadgeTone } from '@/components/terminal';
import { JarvisChat } from '@/components/JarvisChat';

export const dynamic = 'force-dynamic';

const LANE_TONE: Record<string, BadgeTone> = { ready: 'ok', resting: 'warn', disabled: 'default' };
const LANE_DOT: Record<string, string> = { ready: 'connected', resting: 'idle', disabled: 'off' };

function fmtUntil(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  } catch {
    return '';
  }
}

export default async function OrchestratorPage() {
  const s = await orchestratorSnapshot();
  const boardTiles = [
    { label: 'Terbuka', value: s.board.open, tone: 'default' as BadgeTone },
    { label: 'Berjalan', value: s.board.inProgress, tone: 'accent' as BadgeTone },
    { label: 'Ditinjau', value: s.board.review, tone: 'warn' as BadgeTone },
    { label: 'Tertahan', value: s.board.blocked, tone: 'err' as BadgeTone },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="jarvis"
        title="Orchestrator"
        right={
          <Badge tone={s.paperclipOk ? (s.paused ? 'warn' : 'ok') : 'err'}>
            <Dot state={s.paperclipOk ? (s.paused ? 'idle' : 'connected') : 'error'} />
            {s.paperclipOk ? (s.paused ? 'Dijeda' : 'Berjalan') : 'Tidak terhubung'}
          </Badge>
        }
      />

      <section className="mb-[18px] grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1">
        {boardTiles.map((t) => (
          <div key={t.label} className="rounded-lg-t border border-os-border bg-os-surface px-[17px] py-[15px]">
            <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">{t.label}</div>
            <div className="text-2xl font-bold tabular-nums">{t.value}</div>
          </div>
        ))}
      </section>

      {s.score && (
        <section className="mb-[18px]">
          <SectionHead label="Skor JARVIS" />
          <div className="grid grid-cols-3 gap-3 max-[1100px]:grid-cols-1">
            <div className="rounded-lg-t border border-os-border bg-os-surface px-[17px] py-[15px]">
              <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Keseluruhan</div>
              <div className="text-2xl font-bold tabular-nums">{s.score.jarvis}</div>
            </div>
            <div className="rounded-lg-t border border-os-border bg-os-surface px-[17px] py-[15px]">
              <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Sebagai orkestrator</div>
              <div className="text-2xl font-bold tabular-nums">{s.score.orchestrator.score}</div>
            </div>
            <div className="rounded-lg-t border border-os-border bg-os-surface px-[17px] py-[15px]">
              <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Sebagai asisten pribadi</div>
              <div className="text-2xl font-bold tabular-nums">{s.score.personalAssistant.score}</div>
            </div>
          </div>
          {s.score.drags.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1">
              {s.score.drags.map((d) => (
                <li key={d} className="text-[11.5px] text-os-dim">
                  · {d}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mb-[18px]">
        <JarvisChat />
      </section>

      {s.lastTick && (
        <section className="mb-[18px] rounded-lg-t border border-os-border bg-os-surface px-[17px] py-[15px]">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
            Ringkasan terakhir · {s.lastTick.wib} WIB
          </div>
          <p className="text-[13px] text-os-muted">{s.lastTick.summary}</p>
        </section>
      )}

      <section className="mb-[18px]">
        <SectionHead label="Kesehatan tim" count={s.lanes.length} />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 max-[640px]:grid-cols-1">
          {s.lanes.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg-t border border-os-border bg-os-surface px-3 py-2">
              <span className="flex items-center gap-2 font-mono text-[11px]">
                <Dot state={LANE_DOT[l.state]} />
                {l.id}
              </span>
              <Badge tone={LANE_TONE[l.state]}>{l.state === 'resting' ? `istirahat s/d ${fmtUntil(l.until)}` : l.state}</Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-[18px] grid gap-3.5 md:grid-cols-2 max-[640px]:grid-cols-1">
        <div>
          <SectionHead label="Pemakaian hari ini" />
          <div className="rounded-lg-t border border-os-border bg-os-surface px-[17px] py-[15px]">
            {Object.keys(s.usageToday).length === 0 ? (
              <p className="text-[12px] text-os-dim">Belum ada pemakaian tercatat hari ini.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {Object.entries(s.usageToday).map(([pool, n]) => (
                  <li key={pool} className="flex items-baseline justify-between text-[12px]">
                    <span className="text-os-muted">{pool}</span>
                    <span className="font-mono tabular-nums">{n}x</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          <SectionHead label="Ask menunggu" count={s.asks.length} />
          <div className="rounded-lg-t border border-os-border bg-os-surface px-[17px] py-[15px]">
            {s.asks.length === 0 ? (
              <p className="text-[12px] text-os-dim">Tidak ada yang menunggu keputusan Bapak.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.asks.map((a) => (
                  <li key={a.id} className="text-[12px] text-os-muted">
                    {a.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
