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
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const DESCRIPTION_DISCLOSURE_CHAR_LIMIT = 180;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function descriptionSentences(text: string): string[] {
  return normalizeText(text).match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()) ?? [];
}

function isHistoryFirstSentence(sentence: string): boolean {
  return /^(SUPERSEDED|RESOLVED|DISCOVERED|PRIOR|EARLIER|LEGACY)\b/i.test(sentence);
}

function shortenSummary(summary: string): string {
  const clean = normalizeText(summary)
    .replace(/^OWNER confirmed\s+/i, '')
    .replace(/\bALSO\b/g, 'also');
  if (clean.length <= 150) return clean;

  const softBreak = Math.max(
    clean.lastIndexOf(', ', 150),
    clean.lastIndexOf('; ', 150),
    clean.lastIndexOf(' - ', 150),
  );
  return `${clean.slice(0, softBreak > 80 ? softBreak : 150).trim()}...`;
}

function currentDescriptionLine(description: string): string {
  const sentences = descriptionSentences(description);
  const firstCurrentSentence =
    sentences.find(
      (sentence) =>
        !isHistoryFirstSentence(sentence) &&
        /\b(active|available|installed|usable|wired|confirmed|runs|lane|ready)\b/i.test(sentence),
    ) ??
    sentences.find((sentence) => !isHistoryFirstSentence(sentence)) ??
    sentences[0];

  if (!firstCurrentSentence) return 'Current state: full registry note available below.';
  return `Current state: ${shortenSummary(firstCurrentSentence)}`;
}

function AgentDescription({ role }: { role: string }) {
  if (role.length <= DESCRIPTION_DISCLOSURE_CHAR_LIMIT) {
    return <p className="text-os-muted">{role}</p>;
  }

  return (
    <div className="space-y-1 min-w-0">
      <p className="text-os-muted">{currentDescriptionLine(role)}</p>
      <details className="text-os-muted min-w-0">
        <summary className="cursor-pointer text-os-dim">Full registry note</summary>
        <p className="mt-1 whitespace-pre-wrap break-words">{role}</p>
      </details>
    </div>
  );
}

// Derives the lane status cell from the same real numbers, thresholds and
// wording as the Home page's `laneStatus()`. A lane that has run and never
// succeeded must never read "available"; a lane whose success rate is at or
// below half is degraded, not healthy. Quota state is reported separately and
// never reads as "ok" once the flag is set, even when the cooldown window has
// elapsed. Kept inlined here (not extracted to a shared helper) per task scope.
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
  if (lane.runs >= 10 && lane.timeoutRate >= 35) {
    return { tone: 'warn', label: `${lane.timeoutRate}% timeout` };
  }
  const successRate = Math.round((lane.ok / lane.runs) * 100);
  if (successRate <= 50) {
    return { tone: 'warn', label: `${successRate}% — degraded` };
  }
  return { tone: 'ok', label: 'ok', ghost: true };
}

function LaneLine({ lane }: { lane: LaneStat }) {
  const successRate =
    lane.runs > 0 ? `${Math.round((lane.ok / lane.runs) * 100)}%` : '—';
  const timeoutRate = lane.runs > 0 ? `${lane.timeoutRate}%` : '—';
  const timeoutValueClass =
    lane.runs > 0 && lane.timeoutRate >= 35 ? 'text-os-warn' : 'text-os-text';
  const status = laneStatus(lane);
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
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">timeout</span>
        <span className={timeoutValueClass}>{timeoutRate}</span>
      </span>
      <span>
        <Badge tone={status.tone} ghost={status.ghost}>
          {status.label}
        </Badge>
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
                  <Badge tone={agent.can_review === true ? 'accent' : 'default'} ghost>
                    {agent.can_review === true ? 'can review' : 'cannot review'}
                  </Badge>
                  <Badge tone={agent.can_implement === true ? 'ok' : 'default'} ghost>
                    {agent.can_implement === true ? 'can implement' : 'cannot implement'}
                  </Badge>
                  {provider && (
                    <Badge tone="default" ghost>
                      {provider}
                    </Badge>
                  )}
                </div>

                {role && <AgentDescription role={role} />}

                {runtime && (
                  <div className="font-mono text-[10px] text-os-dim break-words">{runtime}</div>
                )}

                <LaneFoot lane={lane} hasLanes={hasLanes} />
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-os-muted">Timeout = dispatch yang habis di batas 8 menit lalu gagal. Beda dengan gagal cepat: waktunya benar-benar terbakar.</p>
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