import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SupervisorEntry {
  ts: number;
  outcome: string;
  severity: string | null;
  missing: string[];
  notOnline: string[];
  reasons: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSupervisorEntry(value: unknown): value is SupervisorEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.ts === 'number' &&
    typeof entry.outcome === 'string' &&
    (entry.severity === null || typeof entry.severity === 'string') &&
    isStringArray(entry.missing) &&
    isStringArray(entry.notOnline) &&
    isStringArray(entry.reasons)
  );
}

export async function readSupervisorLog(limit = 20): Promise<SupervisorEntry[] | null> {
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.join(moduleDir, '..', '..');
    const filePath = path.join(repoRoot, 'ops-watcher', 'pm2-supervisor-log.jsonl');
    const raw = await fs.readFile(filePath, 'utf8');

    const entries: SupervisorEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isSupervisorEntry(parsed)) {
          entries.push(parsed);
        }
      } catch {
        // skip malformed line
      }
    }

    entries.sort((a, b) => b.ts - a.ts);
    return entries.slice(0, limit);
  } catch {
    return null;
  }
}
