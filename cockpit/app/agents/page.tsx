export const dynamic = 'force-dynamic';

import { readAgents, readLanes } from '@/lib/founderos';
import type { LaneStat } from '@/lib/founderos';
import { readExternalAgents } from '@/lib/sources';
import type { ExternalAgentEntry } from '@/lib/sources';
import { PageHeader } from '@/components/PageHeader';
import { Dot, Badge, SectionHead } from '@/components/terminal';

interface AgentRecord {
  agent_id?: unknown;
  display_name?: unknown;
  role?: unknown;
  runtime?: unknown;
  provider?: unknown;
  machine?: unknown;
  can_implement?: unknown;
  can_review?: unknown;
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

function isAgentRecord(v: unknown): v is AgentRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isExternalAgentRecord(v: unknown): v is ExternalAgentEntry {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function LaneLine({ lane }: { lane: LaneStat }) {
  const successRate =
    lane.runs > 0 ? `${Math.round((lane.ok / lane.runs) * 100)}%` : '—';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-os-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">runs</span>
        <span className="text-os-text">{lane.runs}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">success</span>
        <span className="text-os-text">{successRate}</span>
      </span>
      <span>
        {lane.quotaExhausted ? (
          <Badge tone="warn">quota exhausted · {formatDuration(lane.cooldownRemainingMs)}</Badge>
        ) : lane.runs === 0 ? (
          <Badge tone="warn" ghost>
            no runs
          </Badge>
        ) : (
          <Badge tone="ok" ghost>
            available
          </Badge>
        )}
      </span>
    </div>
  );
}

function LaneFoot({
  lane,
  hasLanes,
}: {
  lane: LaneStat | null;
  hasLanes: boolean;
}) {
  if (lane) return <LaneLine lane={lane} />;
  if (hasLanes) {
    return (
      <div className="flex items-center gap-2 text-os-muted">
        <Dot state="off" />
        no matching lane — no recorded runs
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-os-muted">
      <Dot state="off" />
      lane telemetry unavailable
    </div>
  );
}

export default async function AgentsPage() {
  const [agents, lanes, external] = await Promise.all([
    readAgents(),
    readLanes(),
    readExternalAgents(),
  ]);

  if (agents === null) {
    return (
      <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
        <PageHeader eyebrow="FOUNDEROS" title="Agents" />
        <section className="space-y-2">
          <SectionHead label="Roster" />
          <EmptyState file="config/agent-registry.json" />
        </section>
      </main>
    );
  }

  const hasLanes = lanes !== null;
  const laneMap = new Map<string, LaneStat>();
  if (hasLanes) {
    for (const lane of lanes as LaneStat[]) laneMap.set(lane.lane, lane);
  }

  const entries = Object.entries(agents).filter(([, v]) => isAgentRecord(v)) as [
    string,
    AgentRecord,
  ][];

  const externalEntries = external === null
    ? []
    : (Object.entries(external).filter(([, v]) => isExternalAgentRecord(v)) as [
        string,
        ExternalAgentEntry,
      ][]);

  return (
    <main className="min-h-screen bg-os-bg text-os-text px-4 py-6 sm:px-6 sm:py-8 max-w-3xl mx-auto space-y-8">
      <PageHeader
        eyebrow="FOUNDEROS"
        title="Agents"
        right={
          <div className="flex items-center gap-2 text-xs text-os-muted">
            <Dot state={hasLanes ? 'ok' : 'off'} />
            <span>
              {entries.length} declared · {externalEntries.length} external
            </span>
          </div>
        }
      />

      <section className="space-y-2">
        <SectionHead label="Roster" count={entries.length} />

        <div className="border border-os-border bg-os-surface p-3 text-xs text-os-muted flex items-start gap-2">
          <Dot state="off" />
          <span>
            registry declares <span className="text-os-text">{entries.length}</span> agent
            {entries.length === 1 ? '' : 's'} under{' '}
            <span className="text-os-dim">agents</span>. Lanes that did real dispatched work but
            are referenced only inside{' '}
            <span className="text-os-dim">owner_runtime_policy_overrides_this_mission</span> (e.g.
            SOEKARNO) are not registry entries, so their absence here is intentional and visible —
            not silent.
          </span>
        </div>

        {!hasLanes && (
          <div className="border border-os-border bg-os-surface p-3 text-xs text-os-muted flex items-center gap-2">
            <Dot state="off" />
            lane telemetry missing —{' '}
            <span className="text-os-dim">ops-watcher/lane-usage.jsonl</span> not found
          </div>
        )}

        <ul className="border border-os-border bg-os-surface divide-y divide-os-border">
          {entries.map(([key, agent]) => {
            const name = asString(agent.display_name) ?? key;
            const runtime = asString(agent.runtime);
            const provider = asString(agent.provider);
            const role = asString(agent.role);
            const agentId = asString(agent.agent_id) ?? key;
            const laneKey = agentId.toLowerCase();
            const lane = hasLanes ? laneMap.get(laneKey) ?? null : null;

            return (
              <li key={key} className="p-3 text-xs space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-os-text">{name}</span>
                  {agent.can_implement === true && (
                    <Badge tone="ok" ghost>
                      maker
                    </Badge>
                  )}
                  {agent.can_review === true && (
                    <Badge tone="accent" ghost>
                      reviewer
                    </Badge>
                  )}
                  {provider && (
                    <Badge tone="default" ghost>
                      {provider}
                    </Badge>
                  )}
                </div>

                {role && <p className="text-os-muted">{role}</p>}

                {runtime && (
                  <div className="font-mono text-[10px] text-os-dim break-words">{runtime}</div>
                )}

                <LaneFoot lane={lane} hasLanes={hasLanes} />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <SectionHead label="External lanes — not owned by this registry" count={externalEntries.length} />

        <div className="border border-os-border bg-os-surface p-3 text-xs text-os-muted flex items-start gap-2">
          <Dot state="warn" />
          <span>
            these lanes did real dispatched work but live under{' '}
            <span className="text-os-dim">external_agents_not_owned_by_this_registry</span> — this
            registry does not own their identity, runtime, or capacity. Joined to the same lane
            telemetry as the roster above.
          </span>
        </div>

        {external === null ? (
          <EmptyState file="config/agent-registry.json" />
        ) : externalEntries.length === 0 ? (
          <div className="border border-os-border bg-os-surface p-4 text-xs text-os-muted">
            <span className="inline-flex items-center gap-2">
              <Dot state="off" />
              no external lanes recorded
            </span>
          </div>
        ) : (
          <ul className="border border-os-border bg-os-surface divide-y divide-os-border">
            {externalEntries.map(([key, ext]) => {
              const status = asString(ext.status);
              const source = asString(ext.source);
              const dispatchReference = asString(ext.dispatch_reference);
              const laneKey = key.toLowerCase();
              const lane = hasLanes ? laneMap.get(laneKey) ?? null : null;

              return (
                <li key={key} className="p-3 text-xs space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-os-text">{key}</span>
                    <Badge tone="warn" ghost>
                      not owned
                    </Badge>
                  </div>

                  {status && <p className="text-os-muted">{status}</p>}

                  {(source || dispatchReference) && (
                    <div className="font-mono text-[10px] text-os-dim break-words space-y-0.5">
                      {source && <div>source: {source}</div>}
                      {dispatchReference && <div>dispatch: {dispatchReference}</div>}
                    </div>
                  )}

                  <LaneFoot lane={lane} hasLanes={hasLanes} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}