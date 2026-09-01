import { readSupervisorLog } from '@/lib/supervisor';
import { readHeartbeat, readSelfRepair } from '@/lib/founderos';
import { PageHeader } from '@/components/PageHeader';
import { Dot, SectionHead } from '@/components/terminal';

export const dynamic = 'force-dynamic';

function formatRelative(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function DoctorPage() {
  const [heartbeat, supervisorEntries, repairEntries] = await Promise.all([
    readHeartbeat(),
    readSupervisorLog(20),
    readSelfRepair(20),
  ]);

  return (
    <div className="flex flex-col gap-8 min-w-0 overflow-x-hidden">
      <PageHeader eyebrow="cockpit" title="Doctor" />

      <section className="flex flex-col gap-3 min-w-0">
        <SectionHead label="Heartbeat" count={heartbeat ? heartbeat.total : undefined} />
        {heartbeat === null ? (
          <div className="border border-os-border rounded-md p-4 text-sm text-os-dim">
            Heartbeat unavailable — cannot read ops-watcher/heartbeat.json.
          </div>
        ) : (
          <div className="flex flex-col gap-2 min-w-0">
            <div className="text-xs text-os-muted">
              {heartbeat.succeeded}/{heartbeat.total} succeeded · finished {formatRelative(heartbeat.finishedAt)}
            </div>
            <div className="flex flex-col divide-y divide-os-border border border-os-border rounded-md bg-os-surface">
              {heartbeat.steps.map((step) => (
                <div key={`${step.name}-${step.ts}`} className="flex flex-col gap-1 p-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Dot state={step.skipped ? 'off' : step.ok ? 'ok' : 'err'} pulse={!step.skipped && !step.ok} />
                    <span className="text-sm text-os-text truncate flex-1 min-w-0">{step.name}</span>
                    <span className="text-xs text-os-dim shrink-0">{formatDuration(step.durationMs)}</span>
                  </div>
                  {step.excerpt ? (
                    <div className="line-clamp-4 break-words whitespace-pre-wrap font-mono text-xs text-os-muted min-w-0">
                      {step.excerpt}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 min-w-0">
        <SectionHead label="Process supervision" count={supervisorEntries ? supervisorEntries.length : undefined} />
        {supervisorEntries === null ? (
          <div className="border border-os-border rounded-md p-4 text-sm text-os-dim">
            Process supervision unavailable — cannot read ops-watcher/pm2-supervisor-log.jsonl.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-os-border border border-os-border rounded-md bg-os-surface">
            {supervisorEntries.map((entry) => {
              const isCritical = (entry.severity ?? '').toLowerCase() === 'critical';
              const hasDetail = entry.missing.length > 0 || entry.notOnline.length > 0 || entry.reasons.length > 0;
              return (
                <div key={entry.ts} className="flex flex-col gap-1 p-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Dot state={entry.outcome === 'healthy' ? 'ok' : isCritical ? 'err' : 'warn'} />
                    <span className="text-sm text-os-text truncate flex-1 min-w-0">{entry.outcome}</span>
                    <span className="text-xs text-os-dim shrink-0">{formatRelative(entry.ts)}</span>
                  </div>
                  {hasDetail ? (
                    <div className="flex flex-col gap-0.5 text-xs text-os-muted font-mono min-w-0">
                      {entry.missing.length > 0 ? (
                        <div className="break-words">missing: {entry.missing.join(', ')}</div>
                      ) : null}
                      {entry.notOnline.length > 0 ? (
                        <div className="break-words">not online: {entry.notOnline.join(', ')}</div>
                      ) : null}
                      {entry.reasons.length > 0 ? (
                        <div className="break-words">reasons: {entry.reasons.join(', ')}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 min-w-0">
        <SectionHead label="Self-repair" count={repairEntries ? repairEntries.length : undefined} />
        {repairEntries === null ? (
          <div className="border border-os-border rounded-md p-4 text-sm text-os-dim">
            Self-repair log unavailable — cannot read ops-watcher/self-repair-log.jsonl.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-os-border border border-os-border rounded-md bg-os-surface">
            {repairEntries.map((entry) => (
              <div key={`${entry.ts}-${entry.name}`} className="flex flex-col gap-1 p-3 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-os-text truncate">{entry.outcome}</span>
                  <span className="text-xs text-os-muted truncate flex-1 min-w-0">{entry.name}</span>
                  <span className="text-xs text-os-dim shrink-0">{formatRelative(entry.ts)}</span>
                </div>
                <div className="text-xs text-os-muted break-words">{entry.reason}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-os-dim">
        Regression suite results are not stored anywhere this cockpit can read. Run{' '}
        <span className="font-mono text-os-muted">node ops-watcher/run-all-tests.mjs</span> to produce them.
      </p>
    </div>
  );
}
