/**
 * The night's record, read from the ledger.
 *
 * The FOLD is not here. It lives in ops-watcher/night-record.mjs because
 * ops-watcher/run-all-tests.mjs reads ops-watcher/ and nothing else, and a fold
 * nobody can test is how a night gets reported wrong. This file reads the file
 * and hands the events over; it decides nothing.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from module location, not cwd: Next uses different cwds in dev vs build.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');
const LEDGER_PATH = path.join(REPO_ROOT, 'state', 'ledger.jsonl');

// The fold itself, imported from ops-watcher so it stays under the suite.
import { foldNight, nightHeadline } from '../../ops-watcher/night-record.mjs';

export interface NightRun {
  identifier: string;
  outcome: 'done' | 'no-op' | 'failed' | 'reverted';
  filesChanged: string[];
  verify: string | null;
  verifyOk: boolean | null;
  reason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  awaitsOwner: boolean;
}

export interface NightWaiting {
  identifier: string;
  kind: string;
  at: string;
  reason: string | null;
}

export interface NightRecord {
  day: string;
  ran: NightRun[];
  awaiting: NightWaiting[];
  counts: { done: number; 'no-op': number; failed: number; reverted: number };
  quiet: boolean;
  headline: string;
  /** True when the ledger itself could not be read — a different thing from a
      quiet night, and the page must not present one as the other. */
  unreadable: boolean;
}

export async function readNight(day?: string): Promise<NightRecord> {
  let events: unknown[] = [];
  let unreadable = false;
  try {
    const raw = await readFile(LEDGER_PATH, 'utf8');
    events = raw
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        // One corrupt line must not lose the night. The ledger's own reader
        // takes the same position.
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    unreadable = true;
  }

  const record = foldNight(events, day ? { day } : undefined);
  return { ...record, headline: nightHeadline(record), unreadable };
}
