/**
 * Real Aidit OS orchestrator connector — reads conductor/*.mjs's own state
 * files and calls Paperclip directly. Deliberately does NOT import
 * conductor/*.mjs: that tree assumes PM2's pinned Node 22 binary and does
 * Windows-specific child-process work (machineHealth() shells to
 * powershell.exe) that Next's bundler/runtime was never asked to handle.
 * Machine health is read from the last ops.tick ledger line instead of
 * spawning a process on every page load.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ConnectorStatus } from '@/lib/connectors/types';

const STATE_DIR = process.env.AIDIT_STATE_DIR ?? path.join(process.cwd(), 'state');
const CONFIG_DIR = path.join(process.cwd(), 'config');
const PAPERCLIP_URL = process.env.PAPERCLIP_URL ?? 'http://127.0.0.1:3120';

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function tailLines(file: string, n: number): string[] {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export type LaneState = { id: string; state: 'ready' | 'resting' | 'disabled'; until?: string };
export type AskSummary = { id: string; title: string; askedAt: string };
export type OrchestratorSnapshot = {
  paused: boolean;
  board: { open: number; inProgress: number; review: number; blocked: number; other: number };
  lanes: LaneState[];
  asks: AskSummary[];
  usageToday: Record<string, number>;
  machine: { freeRamMb: number | null; freeDiskGb: number | null } | null;
  lastTick: { wib: string; summary: string } | null;
  paperclipOk: boolean;
};

function laneStates(): LaneState[] {
  const cfg = readJson<{ lanes?: Record<string, { status?: string; pool?: string }> }>(
    path.join(CONFIG_DIR, 'lanes.json'),
    {},
  );
  const status = readJson<{ lanes?: Record<string, { state?: string; until?: string }> }>(
    path.join(STATE_DIR, 'lanes-status.json'),
    {},
  );
  return Object.entries(cfg.lanes ?? {}).map(([id, laneCfg]) => {
    if (laneCfg.status === 'disabled') return { id, state: 'disabled' as const };
    const s = status.lanes?.[id];
    if (s?.state === 'resting' && s.until && Date.parse(s.until) > Date.now()) {
      return { id, state: 'resting' as const, until: s.until };
    }
    return { id, state: 'ready' as const };
  });
}

function pendingAsks(): AskSummary[] {
  type AskRow = { id: string; title?: string; askedAt?: string; answer?: string };
  const rows: AskRow[] = tailLines(path.join(STATE_DIR, 'asks.jsonl'), 500)
    .map((l) => {
      try {
        return JSON.parse(l) as AskRow;
      } catch {
        return null;
      }
    })
    .filter((r): r is AskRow => r !== null);
  const byId = new Map<string, AskRow>();
  for (const r of rows) {
    if (r.answer) byId.delete(r.id);
    else byId.set(r.id, r);
  }
  return [...byId.values()].map((r) => ({ id: r.id, title: r.title ?? r.id, askedAt: r.askedAt ?? '' }));
}

function usageToday(): Record<string, number> {
  const today = new Date().toISOString().slice(0, 10);
  const cfg = readJson<{ lanes?: Record<string, { pool?: string }> }>(path.join(CONFIG_DIR, 'lanes.json'), {});
  const laneToPool = Object.fromEntries(Object.entries(cfg.lanes ?? {}).map(([id, l]) => [id, l.pool ?? id]));
  const counts: Record<string, number> = {};
  for (const line of tailLines(path.join(STATE_DIR, 'ledger.jsonl'), 5000)) {
    if (!line.includes(today)) continue; // cheap pre-filter before JSON.parse
    let row: { kind?: string; wib?: string; lane?: string; configDir?: string } | null = null;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row?.wib?.startsWith(today)) continue;
    let pool: string | null = null;
    if (row.kind === 'claude.call' || (row.kind === 'lane.run' && row.configDir)) {
      pool = row.configDir && row.configDir !== '~/.claude' ? 'claude-mesin' : 'claude-orkestrator';
    } else if (row.kind === 'lane.run' && row.lane) {
      pool = laneToPool[row.lane] ?? row.lane;
    }
    if (!pool) continue;
    counts[pool] = (counts[pool] ?? 0) + 1;
  }
  return counts;
}

function lastOpsTick(): { freeRamMb: number | null; freeDiskGb: number | null } | null {
  for (const line of tailLines(path.join(STATE_DIR, 'ledger.jsonl'), 500).reverse()) {
    let row: { kind?: string; machine?: { freeRamMb?: number; freeDiskGb?: number } } | null = null;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.kind === 'ops.tick' && row.machine) {
      return { freeRamMb: row.machine.freeRamMb ?? null, freeDiskGb: row.machine.freeDiskGb ?? null };
    }
  }
  return null;
}

function lastConductorTick(): { wib: string; summary: string } | null {
  for (const line of tailLines(path.join(STATE_DIR, 'ledger.jsonl'), 500).reverse()) {
    let row: { kind?: string; wib?: string; summary?: string; ok?: boolean } | null = null;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.kind === 'conductor.tick' && row.ok && row.summary) {
      return { wib: row.wib ?? '', summary: row.summary };
    }
  }
  return null;
}

export async function orchestratorSnapshot(): Promise<OrchestratorSnapshot> {
  const pause = readJson<{ paused?: boolean }>(path.join(STATE_DIR, 'pause.json'), {});
  const paperclipCfg = readJson<{ companyId?: string; baseUrl?: string }>(
    path.join(CONFIG_DIR, 'paperclip.json'),
    {},
  );
  const base = paperclipCfg.baseUrl ?? PAPERCLIP_URL;
  const board = { open: 0, inProgress: 0, review: 0, blocked: 0, other: 0 };
  let paperclipOk = false;
  if (paperclipCfg.companyId) {
    try {
      const res = await fetch(`${base}/api/companies/${paperclipCfg.companyId}/issues`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        paperclipOk = true;
        const issues = (await res.json()) as { status?: string }[];
        for (const i of issues) {
          if (i.status === 'todo') board.open += 1;
          else if (i.status === 'in_progress') board.inProgress += 1;
          else if (i.status === 'in_review') board.review += 1;
          else if (i.status === 'blocked') board.blocked += 1;
          else board.other += 1;
        }
      }
    } catch {
      paperclipOk = false;
    }
  }
  return {
    paused: !!pause.paused,
    board,
    lanes: laneStates(),
    asks: pendingAsks(),
    usageToday: usageToday(),
    machine: lastOpsTick(),
    lastTick: lastConductorTick(),
    paperclipOk,
  };
}

export async function orchestratorStatus(): Promise<ConnectorStatus> {
  try {
    const s = await orchestratorSnapshot();
    return {
      id: 'orchestrator',
      name: 'Aidit OS Orchestrator',
      kind: 'orchestration',
      state: s.paperclipOk ? (s.paused ? 'not_configured' : 'connected') : 'error',
      detail: s.paperclipOk
        ? s.paused
          ? 'Paperclip reachable, Conductor paused'
          : `Conductor live — ${s.board.open + s.board.inProgress + s.board.review + s.board.blocked} open issues`
        : 'Paperclip not reachable at ' + PAPERCLIP_URL,
      meta: { paused: String(s.paused), blocked: s.board.blocked, review: s.board.review },
    };
  } catch (err) {
    return {
      id: 'orchestrator',
      name: 'Aidit OS Orchestrator',
      kind: 'orchestration',
      state: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
