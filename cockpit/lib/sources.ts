import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

export interface IssueSummary {
  identifier: string;
  title: string;
  status: string;
  priority: string;
  labels: string[];
  updatedAt: string | null;
  ownerRequired: boolean;
}

export interface BacklogItem {
  id: string;
  classification: string;
  title: string;
}

export interface GbrainSource {
  name: string;
  capturedAt: number | null;
  failureCount: number;
  lastAttemptMs: number | null;
}

export interface ExternalAgentEntry {
  source?: unknown;
  status?: unknown;
  dispatch_reference?: unknown;
  [key: string]: unknown;
}

function getRepoRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..', '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripMarkdown(value: string): string {
  return value.replace(/(\*\*|__|\*|_|`)/g, '').trim();
}

// Classification tokens like KEEP_BACKLOG carry underscores that are NOT markdown
// emphasis — but stripMarkdown() removes every `_` (correctly, for titles that use
// `_word_` emphasis). So `stripMarkdown('KEEP_BACKLOG')` becomes `KEEPBACKLOG` and
// never equals the literal list entry `KEEP_BACKLOG`. Rather than weaken stripMarkdown
// for titles, normalise BOTH sides of the comparison through the same function so an
// underscored token matches itself regardless of which side carries the underscore.
function normalizeClassification(value: string): string {
  return stripMarkdown(value).toUpperCase();
}

export async function readIssues(): Promise<IssueSummary[] | null> {
  try {
    const root = getRepoRoot();
    const configPath = path.join(root, 'config', 'paperclip-endpoint.json');
    const configRaw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configRaw) as unknown;
    if (!isRecord(config)) return null;

    const primaryEndpoint = isRecord(config.primary_endpoint) ? config.primary_endpoint : null;
    const discovery = isRecord(config.discovery_strategy) ? config.discovery_strategy : null;
    const canonical = isRecord(config.canonical_identity) ? config.canonical_identity : null;
    if (!canonical) return null;

    const fingerprint =
      typeof canonical.backup_dir_fingerprint === 'string' ? canonical.backup_dir_fingerprint : null;
    const knownCompany = isRecord(canonical.known_company) ? canonical.known_company : null;
    const companyId =
      knownCompany && typeof knownCompany.id === 'string'
        ? knownCompany.id
        : knownCompany && typeof knownCompany.id === 'number'
          ? String(knownCompany.id)
          : null;
    if (!fingerprint || !companyId) return null;

    const candidatePorts: number[] = [];
    const primaryPort = primaryEndpoint && typeof primaryEndpoint.port === 'number' ? primaryEndpoint.port : null;
    if (primaryPort !== null) candidatePorts.push(primaryPort);
    if (discovery && Array.isArray(discovery.candidate_ports)) {
      for (const port of discovery.candidate_ports) {
        if (typeof port === 'number') candidatePorts.push(port);
      }
    }

    let verifiedPort: number | null = null;
    for (const port of candidatePorts) {
      const res = await fetchWithTimeout(`http://127.0.0.1:${port}/api/health`, 2000);
      if (!res || !res.ok) continue;
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        continue;
      }
      if (!isRecord(body)) continue;
      const backup = isRecord(body.databaseBackup) ? body.databaseBackup : null;
      // A port can answer /api/health while belonging to a different, drifted Paperclip instance —
      // only trust it once its backup dir matches the fingerprint pinned in the config file.
      if (backup && backup.backupDir === fingerprint) {
        verifiedPort = port;
        break;
      }
    }
    if (verifiedPort === null) return null;

    const issuesRes = await fetchWithTimeout(
      `http://127.0.0.1:${verifiedPort}/api/companies/${companyId}/issues`,
      2000,
    );
    if (!issuesRes || !issuesRes.ok) return null;
    let issuesBody: unknown;
    try {
      issuesBody = await issuesRes.json();
    } catch {
      return null;
    }
    if (!Array.isArray(issuesBody)) return null;

    const summaries: IssueSummary[] = [];
    for (const item of issuesBody) {
      if (!isRecord(item)) continue;
      const identifier = typeof item.identifier === 'string' ? item.identifier : null;
      const title = typeof item.title === 'string' ? item.title : null;
      const status = typeof item.status === 'string' ? item.status : null;
      const priority = typeof item.priority === 'string' ? item.priority : null;
      if (identifier === null || title === null || status === null || priority === null) continue;

      const labels: string[] = [];
      let ownerRequired = false;
      if (Array.isArray(item.labels)) {
        for (const label of item.labels) {
          if (isRecord(label) && typeof label.name === 'string') {
            labels.push(label.name);
            if (label.name === 'OWNER_REQUIRED') ownerRequired = true;
          }
        }
      }

      const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt : null;

      summaries.push({ identifier, title, status, priority, labels, updatedAt, ownerRequired });
    }

    summaries.sort((a, b) => {
      if (a.ownerRequired !== b.ownerRequired) return a.ownerRequired ? -1 : 1;
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : NaN;
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : NaN;
      const aValid = !Number.isNaN(aTime);
      const bValid = !Number.isNaN(bTime);
      if (aValid && bValid) return bTime - aTime;
      if (aValid) return -1;
      if (bValid) return 1;
      return 0;
    });

    return summaries.slice(0, 60);
  } catch {
    return null;
  }
}

const BACKLOG_CLASSIFICATIONS = [
  'DONE',
  'ACTIVE',
  'KEEP_BACKLOG',
  'SUPERSEDED',
  'NEEDS_RECOVERY',
  'OWNER_DECISION',
  'DROP_RECOMMENDED',
];

// The prefixes FOS/PROD/TRD/BUS/KOL were examples, not the full set — the live backlog
// also uses VOICE, INFRA, HIST, AGENT, and any future prefix nobody enumerated. Accept
// any uppercase prefix of two to six letters followed by a hyphen and digits, so a row
// is never silently dropped just because its prefix wasn't on a hand-written list.
const BACKLOG_ID_PATTERN = /\b[A-Z]{2,6}-\d+\b/;

export async function readBacklog(): Promise<BacklogItem[] | null> {
  try {
    const root = getRepoRoot();
    const filePath = path.join(root, 'handoffs', 'sjahrir', 'MASTER-CANONICAL-BACKLOG.md');
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);

    const items: BacklogItem[] = [];
    const seen = new Set<string>();

    // Column order in this hand-written doc is not guaranteed, so each row is scanned
    // cell-by-cell for an id pattern and a known classification word rather than by index.
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith('|')) continue;

      const cells = trimmedLine
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      if (cells.length === 0) continue;

      const isSeparatorRow = cells.every((cell) => /^:?-{2,}:?$/.test(cell));
      if (isSeparatorRow) continue;

      let idCellIndex = -1;
      let id: string | null = null;
      for (let i = 0; i < cells.length; i++) {
        const match = cells[i].match(BACKLOG_ID_PATTERN);
        if (match) {
          id = match[0];
          idCellIndex = i;
          break;
        }
      }
      if (id === null) continue;

      let classificationCellIndex = -1;
      let classification: string | null = null;
      for (let i = 0; i < cells.length; i++) {
        if (i === idCellIndex) continue;
        // Both the cell and the canonical classification word are run through the same
        // normaliser (stripMarkdown + uppercase), so an underscored token like
        // KEEP_BACKLOG matches itself even though stripMarkdown drops the `_`.
        const normalized = normalizeClassification(cells[i]);
        const match = BACKLOG_CLASSIFICATIONS.find(
          (word) => normalized === normalizeClassification(word),
        );
        if (match) {
          classification = match;
          classificationCellIndex = i;
          break;
        }
      }
      if (classification === null) continue;

      let title: string | null = null;
      for (let i = 0; i < cells.length; i++) {
        if (i === idCellIndex || i === classificationCellIndex) continue;
        const cleaned = stripMarkdown(cells[i]);
        if (cleaned.length === 0) continue;
        if (title === null || cleaned.length > title.length) title = cleaned;
      }
      if (title === null) continue;

      const key = `${id}:${classification}:${title}`;
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({ id, classification, title });
    }

    if (items.length === 0) return null;
    return items;
  } catch {
    return null;
  }
}

export async function readExternalAgents(): Promise<Record<string, ExternalAgentEntry> | null> {
  try {
    const root = getRepoRoot();
    const filePath = path.join(root, 'config', 'agent-registry.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as unknown;
    if (!isRecord(data)) return null;
    const external = data.external_agents_not_owned_by_this_registry;
    if (!isRecord(external)) return null;
    return external as Record<string, ExternalAgentEntry>;
  } catch {
    return null;
  }
}

interface GbrainFailureRecord {
  count: number;
  lastAttemptMs: number | null;
}

export async function readGbrain(): Promise<GbrainSource[] | null> {
  try {
    const root = getRepoRoot();
    const filePath = path.join(root, 'ops-watcher', 'gbrain-curator-state.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as unknown;
    if (!isRecord(data)) return null;

    const failures = isRecord(data.__failures) ? data.__failures : {};

    const names = new Set<string>();
    for (const key of Object.keys(data)) {
      if (key === '__failures') continue;
      names.add(key);
    }
    for (const key of Object.keys(failures)) {
      names.add(key);
    }

    const results: GbrainSource[] = [];
    for (const name of names) {
      const capturedRaw = data[name];
      const capturedAt = typeof capturedRaw === 'number' ? capturedRaw : null;

      const failureEntryRaw = failures[name];
      let failureCount = 0;
      let lastAttemptMs: number | null = null;
      if (isRecord(failureEntryRaw)) {
        const failureEntry: Partial<GbrainFailureRecord> = failureEntryRaw;
        failureCount = typeof failureEntry.count === 'number' ? failureEntry.count : 0;
        lastAttemptMs = typeof failureEntry.lastAttemptMs === 'number' ? failureEntry.lastAttemptMs : null;
      }

      results.push({ name, capturedAt, failureCount, lastAttemptMs });
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return results;
  } catch {
    return null;
  }
}