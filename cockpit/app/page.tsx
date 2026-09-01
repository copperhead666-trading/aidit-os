export const dynamic = 'force-dynamic';

import { readHeartbeat, readLanes, readSelfRepair, readDecisions, readLayers } from '@/lib/founderos';
import { PageHeader } from '@/components/PageHeader';
import { Dot, Badge, SectionHead } from '@/components/terminal';
import type { LaneStat, RepairEntry } from '@/lib/founderos';

function formatRelativeTime(value: string | number): string {
  const then = typeof value === 'number' ? new Date(value).getTime() : new Date(value).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Derives the status cell for a lane from its real numbers, not from a single
// flag. A lane that has run and never succeeded must never read "ok"; a lane
// whose success rate is at or below half is degraded, not healthy. Quota state
// is reported separately and never reads as "ready" once the flag is set, even
// when the cooldown window has elapsed.
function laneStatus(lane: LaneStat): { tone: 'ok' | 'warn' | 'err'; label: string; ghost?: boolean } {
  if (lane.quotaExhausted) {
    if (lane.cooldownRemainingMs > 0) {
      return { tone: 'warn', label: `cooldown ${formatDuration(lane.cooldownRemainingMs)}` };
    }
    return { tone: 'warn', label: 'quota exhausted' };
  }
  if (lane.runs === 0) {
    return { tone: 'warn', label: 'no runs', ghost: true };
  }
  if (lane.ok === 0) {
    return { tone: 'err', label: 'no successful runs' };
  }
  const successRate = Math.round((lane.ok / lane.runs) * 100);
  if (successRate <= 50) {
    return { tone: 'warn', label: `${successRate}% — degraded` };
  }
  return { tone: 'ok', label: 'ok', ghost: true };
}

// Maps a repair outcome to a Dot state. `repaired`/`ok` are healthy, `reverted`/
// `failed` are errors, `skipped` is inert (off), anything else is uncertain.
// Matching is anchored to avoid false positives (e.g. "broken" containing "ok").
function repairState(outcome: string): 'ok' | 'warn' | 'err' | 'off' {
  const o = outcome.toLowerCase();
  if (o === 'ok' || o === 'repaired' || o.includes('repair')) return 'ok';
  if (o.includes('revert') || o.includes('fail')) return 'err';
  if (o.includes('skip')) return 'off';
  return 'warn';
}

interface CollapsedRepair {
  name: string;
  type: string;
  outcome: string;
  reason: string;
  ts: number;
  repeat: number;
}

// Collapses consecutive repair entries that share name, outcome and reason into
// a single line carrying a repeat count. `repairs` arrives newest-first, so the
// first entry of each run is the most recent — its timestamp is the one shown.
function collapseRepairs(repairs: RepairEntry[]): CollapsedRepair[] {
  const out: CollapsedRepair[] = [];
  for (const r of repairs) {
    const last = out[out.length - 1];
    if (last && last.name === r.name && last.outcome === r.outcome && last.reason === r.reason) {
      last.repeat += 1;
      continue;
    }
    out.push({ name: r.name, type: r.type, outcome: r.outcome, reason: r.reason, ts: r.ts, repeat: 1 });
  }
  return out;
}

function EmptyState({ file }: { file: string }) {
  return (
    <div className="border border-os-border bg-os-surface p-4 text-xs text-os-muted">
      <span className="inline-flex items-center gap-2">
        <Dot state="off" />
        source missing — <span className="text-os-dim">{file}</span> not found
      </span>
    </div>
  );
}

export default async function Page() {
  const [heartbeat, lanes, repairs, decisions, layers] = await Promise.all([
    readHeartbeat(),
    readLanes(),
    readSelfRepair(5),
    readDecisions(),
    readLayers(),
  ]);

  const overallState = heartbeat === null ? 'off' : heartbeat.failed === 0 ? 'ok' : 'err';
  const overallLabel =
    heartbeat === null ? 'unknown' : heartbeat.failed === 0 ? 'operational' : 'degraded';

  const statusOrder = ['implemented', 'partial', 'not-started', 'deferred'] as const;
  const statusCounts =
    layers?.reduce<Record<string, number>>((acc, l) => {
      acc[l.status] = (acc[l.status] ?? 0) + 1;
      return acc;
    }, {}) ?? null;
  const layerBreakdown =
    statusCounts &&
    statusOrder
      .filter((s) => statusCounts[s])
      .map((s) => `${statusCounts[s]} ${s}`)
      .join(' · ');

  const collapsedRepairs = repairs ? collapseRepairs(repairs) : null;

  return (
    <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
      <PageHeader
        eyebrow="FOUNDEROS"
        title="Cockpit"
        right={
          <div className="flex items-center gap-2 text-xs text-os-muted">
            <Dot state={overallState} pulse={overallState === 'err'} />
            <span>{overallLabel}</span>
          </div>
        }
      />

      <section className="space-y-2">
        <SectionHead label="Heartbeat" />
        {heartbeat ? (
          <div className="border border-os-border bg-os-surface p-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Dot state={heartbeat.failed === 0 ? 'ok' : 'err'} pulse={heartbeat.failed !== 0} />
                <span className="text-sm">
                  {heartbeat.succeeded}/{heartbeat.total} steps
                </span>
              </div>
              <span className="text-xs text-os-dim">{formatRelativeTime(heartbeat.finishedAt)}</span>
            </div>
            {heartbeat.failed > 0 && (
              <div className="text-xs text-os-err">
                failing:{' '}
                {heartbeat.steps
                  .filter((s) => !s.ok && !s.skipped)
                  .map((s) => s.name)
                  .join(', ')}
              </div>
            )}
          </div>
        ) : (
          <EmptyState file="heartbeat.json" />
        )}
      </section>

      <section className="space-y-2">
        <SectionHead label="Lanes" count={lanes?.length} />
        {lanes ? (
          <div className="overflow-x-auto border border-os-border bg-os-surface">
            <table className="w-full text-xs min-w-[480px]">
              <thead>
                <tr className="border-b border-os-border text-os-dim">
                  <th className="text-left font-normal px-3 py-2">lane</th>
                  <th className="text-right font-normal px-3 py-2">runs</th>
                  <th className="text-right font-normal px-3 py-2">success</th>
                  <th className="text-right font-normal px-3 py-2">avg</th>
                  <th className="text-right font-normal px-3 py-2">status</th>
                </tr>
              </thead>
              <tbody>
                {lanes.map((lane) => {
                  const successRate = lane.runs > 0 ? Math.round((lane.ok / lane.runs) * 100) : null;
                  const status = laneStatus(lane);
                  return (
                    <tr key={lane.lane} className="border-b border-os-border last:border-b-0">
                      <td className="px-3 py-2">{lane.lane}</td>
                      <td className="px-3 py-2 text-right">{lane.runs}</td>
                      <td className="px-3 py-2 text-right">
                        {lane.runs === 0 ? (
                          <span className="text-os-warn">idle</span>
                        ) : (
                          `${successRate}%`
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(lane.avgDurationMs / 1000).toFixed(1)}s
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Badge tone={status.tone} ghost={status.ghost}>
                          {status.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState file="lanes.json" />
        )}
      </section>

      <section className="space-y-2">
        <SectionHead label="Self-repair" count={repairs?.length} />
        {repairs ? (
          repairs.length === 0 ? (
            <div className="border border-os-border bg-os-surface p-4 flex items-center gap-2 text-xs text-os-muted">
              <Dot state="ok" />
              no repair attempts recorded
            </div>
          ) : (
            <ul className="border border-os-border bg-os-surface divide-y divide-os-border">
              {collapsedRepairs!.map((r, i) => {
                const state = repairState(r.outcome);
                return (
                  <li key={`${r.ts}-${i}`} className="p-3 flex items-start gap-2 text-xs">
                    <Dot state={state} />
                    <div className="min-w-0">
                      <div className="text-os-text">
                        {r.name} <span className="text-os-dim">· {r.type}</span>
                        <span className="text-os-dim"> · {r.outcome}</span>
                        {r.repeat > 1 && (
                          <span className="text-os-dim"> · ×{r.repeat}</span>
                        )}
                      </div>
                      <div className="text-os-muted">{r.reason}</div>
                      <div className="text-os-dim">{formatRelativeTime(r.ts)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <EmptyState file="self-repair.json" />
        )}
      </section>

      <section className="space-y-2">
        <SectionHead label="Ledger" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-os-border bg-os-surface p-4">
            {decisions ? (
              <>
                <div className="text-2xl text-os-text">{decisions.records.length}</div>
                <div className="text-xs text-os-muted">decisions logged</div>
              </>
            ) : (
              <EmptyState file="decisions.json" />
            )}
          </div>
          <div className="border border-os-border bg-os-surface p-4">
            {layers ? (
              <>
                <div className="text-2xl text-os-text">{layers.length}</div>
                <div className="text-xs text-os-muted">
                  layers{layerBreakdown ? ` · ${layerBreakdown}` : ''}
                </div>
              </>
            ) : (
              <EmptyState file="layers.json" />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}