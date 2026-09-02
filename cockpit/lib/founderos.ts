import { open, readFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from module location, not cwd: Next uses different cwds in dev vs build.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const OPS_WATCHER_DIR = path.join(REPO_ROOT, 'ops-watcher');
const CONFIG_DIR = path.join(REPO_ROOT, 'config');

const HEARTBEAT_PATH = path.join(OPS_WATCHER_DIR, 'heartbeat-steps.jsonl');
const LANE_USAGE_PATH = path.join(OPS_WATCHER_DIR, 'lane-usage.jsonl');
const ROUTING_STATE_PATH = path.join(OPS_WATCHER_DIR, 'routing-state.json');
const SELF_REPAIR_PATH = path.join(OPS_WATCHER_DIR, 'self-repair-log.jsonl');
const LAYERS_PATH = path.join(CONFIG_DIR, 'project-layers.json');
const SKILL_MATRIX_PATH = path.join(CONFIG_DIR, 'skill-matrix.json');
const DECISION_LEDGER_PATH = path.join(CONFIG_DIR, 'decision-ledger.json');
const AGENT_REGISTRY_PATH = path.join(CONFIG_DIR, 'agent-registry.json');

// A record written before the wrapper recorded timeouts explicitly is counted
// as a timeout when it ran essentially the whole wrapper cap (8 minutes in the
// dispatch wrappers). Without this, historic timeouts silently read as ordinary
// failures and the timeout rate looks far better than it is.
const LANE_TIMEOUT_FALLBACK_MS = 470_000;

const PROBE_TO_LANE: Record<string, string> = {
  codex: 'corleone',
  kimi: 'sjahrir',
  ollama: 'hatta',
};
const LANE_TO_PROBE: Record<string, string> = {
  corleone: 'codex',
  sjahrir: 'kimi',
  hatta: 'ollama',
};

// ---------- Types ----------

export interface HeartbeatStep {
  ts: number;
  name: string;
  argv: string[];
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  skipped: boolean;
  durationMs: number;
  excerpt: string;
}

export interface Heartbeat {
  ts: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  total: number;
  succeeded: number;
  failed: number;
  steps: HeartbeatStep[];
}

export interface LaneUsageEntry {
  ts: string;
  lane: string;
  promptLength: number;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut?: boolean;
  extra?: {
    skipped?: boolean;
    reason?: string;
  };
}

export interface LaneStat {
  lane: string;
  runs: number;
  ok: number;
  failed: number;
  timedOut: number;
  timeoutRate: number;
  avgDurationMs: number;
  lastTs: string | null;
  quotaExhausted: boolean;
  cooldownRemainingMs: number;
}

export interface RoutingLaneState {
  lastFailureTs: number;
  lastFailureReason: string;
  failureCount: number;
  cooldownMs: number;
  quotaExhausted: boolean;
}

export interface RoutingState {
  lanes: Record<string, RoutingLaneState>;
}

export interface RepairEntry {
  ts: number;
  type: string;
  name: string;
  outcome: string;
  reason: string;
}

export type ProjectLayerStatus = 'implemented' | 'partial' | 'not-started' | 'deferred';

export interface ProjectLayer {
  id: string;
  label: string;
  ownerQuestion: string;
  status: ProjectLayerStatus;
  evidence: unknown;
}

export interface SkillMatrixEntry {
  taskClass: string;
  requiredSkills: string[];
  requiredStandards: string[];
  preferredMaker: string;
  preferredReviewer: string;
  compactContextRule: string;
  hardStops: string[];
}

export interface DecisionRecord {
  id: string;
  type: string;
  status: string;
  domain: string;
  statement: string;
  confidence: unknown;
  canonical: unknown;
  [key: string]: unknown;
}

export interface DecisionLedger {
  schema_version: unknown;
  scope: unknown;
  records: DecisionRecord[];
}

export type AgentRegistry = Record<string, unknown>;

// ---------- Small helpers ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function tryParseJson(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Scans a .jsonl file backwards in chunks so we never load a large file fully
// into memory just to find the tail. Returns the newest line that parses as
// JSON and satisfies `isValid`, skipping anything malformed along the way.
async function readLastMatchingJsonLine<T>(
  filePath: string,
  isValid: (v: unknown) => v is T
): Promise<T | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, 'r');
    const { size } = await handle.stat();
    const chunkSize = 65536;
    let position = size;
    let leftover = '';
    while (position > 0) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buf = Buffer.alloc(readSize);
      await handle.read(buf, 0, readSize, position);
      leftover = buf.toString('utf8') + leftover;
      const lines = leftover.split('\n');
      leftover = lines.shift() ?? '';
      for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = tryParseJson(lines[i]);
        if (candidate !== undefined && isValid(candidate)) return candidate;
      }
    }
    const candidate = tryParseJson(leftover);
    if (candidate !== undefined && isValid(candidate)) return candidate;
    return null;
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// Same backward-chunk scan as above, but collects up to `n` matching lines
// instead of stopping at the first. Returned in file order (oldest first).
async function readLastNMatchingJsonLines<T>(
  filePath: string,
  n: number,
  isValid: (v: unknown) => v is T
): Promise<T[]> {
  const collected: T[] = [];
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, 'r');
    const { size } = await handle.stat();
    const chunkSize = 65536;
    let position = size;
    let leftover = '';
    while (position > 0 && collected.length < n) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buf = Buffer.alloc(readSize);
      await handle.read(buf, 0, readSize, position);
      leftover = buf.toString('utf8') + leftover;
      const lines = leftover.split('\n');
      leftover = lines.shift() ?? '';
      for (let i = lines.length - 1; i >= 0 && collected.length < n; i--) {
        const candidate = tryParseJson(lines[i]);
        if (candidate !== undefined && isValid(candidate)) collected.push(candidate);
      }
    }
    if (collected.length < n) {
      const candidate = tryParseJson(leftover);
      if (candidate !== undefined && isValid(candidate)) collected.push(candidate);
    }
    collected.reverse();
    return collected;
  } catch {
    return [];
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// ---------- Validators ----------

function isHeartbeatStep(v: unknown): v is HeartbeatStep {
  if (!isRecord(v)) return false;
  return (
    typeof v.ts === 'number' &&
    typeof v.name === 'string' &&
    Array.isArray(v.argv) &&
    v.argv.every((a) => typeof a === 'string') &&
    typeof v.ok === 'boolean' &&
    (v.exitCode === null || typeof v.exitCode === 'number') &&
    typeof v.timedOut === 'boolean' &&
    typeof v.skipped === 'boolean' &&
    typeof v.durationMs === 'number' &&
    typeof v.excerpt === 'string'
  );
}

function isHeartbeat(v: unknown): v is Heartbeat {
  if (!isRecord(v)) return false;
  return (
    typeof v.ts === 'number' &&
    typeof v.startedAt === 'number' &&
    typeof v.finishedAt === 'number' &&
    typeof v.durationMs === 'number' &&
    typeof v.total === 'number' &&
    typeof v.succeeded === 'number' &&
    typeof v.failed === 'number' &&
    Array.isArray(v.steps) &&
    v.steps.every(isHeartbeatStep)
  );
}

function isLaneUsageEntry(v: unknown): v is LaneUsageEntry {
  if (!isRecord(v)) return false;
  if (
    typeof v.ts !== 'string' ||
    typeof v.lane !== 'string' ||
    typeof v.promptLength !== 'number' ||
    typeof v.ok !== 'boolean' ||
    (v.exitCode !== null && typeof v.exitCode !== 'number') ||
    typeof v.durationMs !== 'number' ||
    (v.timedOut !== undefined && typeof v.timedOut !== 'boolean')
  ) {
    return false;
  }
  if (v.extra !== undefined) {
    if (!isRecord(v.extra)) return false;
    if (v.extra.skipped !== undefined && typeof v.extra.skipped !== 'boolean') return false;
    if (v.extra.reason !== undefined && typeof v.extra.reason !== 'string') return false;
  }
  return true;
}

function isRoutingLaneState(v: unknown): v is RoutingLaneState {
  if (!isRecord(v)) return false;
  return (
    typeof v.lastFailureTs === 'number' &&
    typeof v.lastFailureReason === 'string' &&
    typeof v.failureCount === 'number' &&
    typeof v.cooldownMs === 'number' &&
    typeof v.quotaExhausted === 'boolean'
  );
}

function isRoutingState(v: unknown): v is RoutingState {
  if (!isRecord(v) || !isRecord(v.lanes)) return false;
  return Object.values(v.lanes).every(isRoutingLaneState);
}

function isRepairEntry(v: unknown): v is RepairEntry {
  if (!isRecord(v)) return false;
  return (
    typeof v.type === 'string' &&
    typeof v.name === 'string' &&
    typeof v.outcome === 'string' &&
    typeof v.reason === 'string' &&
    typeof v.ts === 'number'
  );
}

function isProjectLayerStatus(v: unknown): v is ProjectLayerStatus {
  return v === 'implemented' || v === 'partial' || v === 'not-started' || v === 'deferred';
}

function isProjectLayer(v: unknown): v is ProjectLayer {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.ownerQuestion === 'string' &&
    isProjectLayerStatus(v.status)
  );
}

function isSkillMatrixEntry(v: unknown): v is SkillMatrixEntry {
  if (!isRecord(v)) return false;
  return (
    typeof v.taskClass === 'string' &&
    Array.isArray(v.requiredSkills) &&
    v.requiredSkills.every((s) => typeof s === 'string') &&
    Array.isArray(v.requiredStandards) &&
    v.requiredStandards.every((s) => typeof s === 'string') &&
    typeof v.preferredMaker === 'string' &&
    typeof v.preferredReviewer === 'string' &&
    typeof v.compactContextRule === 'string' &&
    Array.isArray(v.hardStops) &&
    v.hardStops.every((s) => typeof s === 'string')
  );
}

function isDecisionRecord(v: unknown): v is DecisionRecord {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    typeof v.type === 'string' &&
    typeof v.status === 'string' &&
    typeof v.domain === 'string' &&
    typeof v.statement === 'string' &&
    'confidence' in v &&
    'canonical' in v
  );
}

function isDecisionLedger(v: unknown): v is DecisionLedger {
  if (!isRecord(v)) return false;
  return (
    'schema_version' in v &&
    'scope' in v &&
    Array.isArray(v.records) &&
    v.records.every(isDecisionRecord)
  );
}

// ---------- Exports ----------

export async function readHeartbeat(): Promise<Heartbeat | null> {
  try {
    return await readLastMatchingJsonLine(HEARTBEAT_PATH, isHeartbeat);
  } catch {
    return null;
  }
}

export async function readLanes(): Promise<LaneStat[] | null> {
  try {
    const entries = await readLastNMatchingJsonLines<LaneUsageEntry>(
      LANE_USAGE_PATH,
      200,
      isLaneUsageEntry
    );
    const routingRaw = await readJsonFile(ROUTING_STATE_PATH);
    const routing = isRoutingState(routingRaw) ? routingRaw : null;

    interface Accum {
      runs: number;
      ok: number;
      failed: number;
      timedOut: number;
      totalDurationMs: number;
      lastTs: string | null;
    }
    const byLane = new Map<string, Accum>();

    for (const entry of entries) {
      const acc = byLane.get(entry.lane) ?? {
        runs: 0,
        ok: 0,
        failed: 0,
        timedOut: 0,
        totalDurationMs: 0,
        lastTs: null,
      };
      const isSkipped = entry.extra?.skipped === true;
      if (!isSkipped) {
        const timedOut =
          entry.timedOut === true ||
          (typeof entry.timedOut !== 'boolean' && entry.durationMs >= LANE_TIMEOUT_FALLBACK_MS);
        acc.runs += 1;
        if (entry.ok) acc.ok += 1;
        else acc.failed += 1;
        if (timedOut) acc.timedOut += 1;
        acc.totalDurationMs += entry.durationMs;
      }
      if (acc.lastTs === null || Date.parse(entry.ts) > Date.parse(acc.lastTs)) {
        acc.lastTs = entry.ts;
      }
      byLane.set(entry.lane, acc);
    }

    const laneNames = new Set(byLane.keys());
    if (routing) {
      for (const probeKey of Object.keys(routing.lanes)) {
        laneNames.add(PROBE_TO_LANE[probeKey] ?? probeKey);
      }
    }

    const now = Date.now();
    const stats: LaneStat[] = [];
    for (const lane of laneNames) {
      const acc = byLane.get(lane);
      const probeKey = LANE_TO_PROBE[lane];
      const routingEntry = probeKey && routing ? routing.lanes[probeKey] : undefined;
      const cooldownRemainingMs = routingEntry
        ? Math.max(0, routingEntry.lastFailureTs + routingEntry.cooldownMs - now)
        : 0;
      stats.push({
        lane,
        runs: acc?.runs ?? 0,
        ok: acc?.ok ?? 0,
        failed: acc?.failed ?? 0,
        timedOut: acc?.timedOut ?? 0,
        timeoutRate: acc && acc.runs > 0 ? Math.round((acc.timedOut / acc.runs) * 100) : 0,
        avgDurationMs: acc && acc.runs > 0 ? acc.totalDurationMs / acc.runs : 0,
        lastTs: acc?.lastTs ?? null,
        quotaExhausted: routingEntry?.quotaExhausted ?? false,
        cooldownRemainingMs,
      });
    }
    return stats;
  } catch {
    return null;
  }
}

export async function readSelfRepair(limit = 10): Promise<RepairEntry[] | null> {
  try {
    const entries = await readLastNMatchingJsonLines<RepairEntry>(
      SELF_REPAIR_PATH,
      limit,
      isRepairEntry
    );
    return entries.reverse();
  } catch {
    return null;
  }
}

export async function readLayers(): Promise<ProjectLayer[] | null> {
  try {
    const raw = await readJsonFile(LAYERS_PATH);
    if (!Array.isArray(raw) || !raw.every(isProjectLayer)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function readSkillMatrix(): Promise<SkillMatrixEntry[] | null> {
  try {
    const raw = await readJsonFile(SKILL_MATRIX_PATH);
    if (!Array.isArray(raw) || !raw.every(isSkillMatrixEntry)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function readDecisions(): Promise<DecisionLedger | null> {
  try {
    const raw = await readJsonFile(DECISION_LEDGER_PATH);
    if (!isDecisionLedger(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function readAgents(): Promise<AgentRegistry | null> {
  try {
    const raw = await readJsonFile(AGENT_REGISTRY_PATH);
    if (!isRecord(raw) || !isRecord(raw.agents)) return null;
    return raw.agents;
  } catch {
    return null;
  }
}