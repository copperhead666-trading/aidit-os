// ops-watcher/lane-usage.mjs — best-effort usage/budget tracking for dispatch lanes.
//
// The origin FounderOS architecture this forked from has a "budgets" concept in
// its Back Office layer ("agents wake on a heartbeat, pull work, and report back
// ... org hierarchy, tickets, heartbeats, budgets"). This fork currently has
// ZERO usage/cost visibility across the HATTA/SJAHRIR/CORLEONE/Flash dispatch
// lanes. This module fills that gap with a minimal, best-effort usage log: it
// records counts, timestamps, and durations per dispatch invocation to an
// append-only NDJSON file (`lane-usage.jsonl`, same convention as watcher.mjs's
// events.jsonl).
//
// This is usage/COUNT tracking, NOT precise dollar-cost metering — that's
// impossible for the flat-rate/free lanes (Ollama-local Flash, etc.) anyway. The
// goal is simply to make usage PATTERNS visible (how often each lane fires,
// success/failure ratios, rough timing), not to bill anyone.
//
// CRITICAL design constraint: this is invisible plumbing. It MUST NEVER throw
// and MUST NEVER write to the console — a logging failure must never break the
// actual dispatch it's attached to. Every operation is wrapped in try/catch and
// silently swallows errors.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default log file: ops-watcher/lane-usage.jsonl (same REPO_ROOT-relative pattern
// as watcher.mjs's EVENTS_FILE constant — resolved relative to this file's own
// __dirname, not process.cwd()).
const DEFAULT_FILE = path.join(__dirname, "lane-usage.jsonl");

/**
 * Append ONE JSON line (NDJSON) to the lane-usage log. Best-effort, never throws.
 *
 * @param {object}  opts
 * @param {string}  opts.lane         - fixed lane identifier (e.g. "sjahrir").
 * @param {number|null} [opts.promptLength] - length of the prompt string.
 * @param {boolean} opts.ok           - true if the dispatch succeeded (exit 0).
 * @param {number|null} [opts.exitCode] - numeric exit code, or null.
 * @param {number|null} [opts.durationMs] - wall-clock duration in ms, or null.
 * @param {*} [opts.extra]            - any optional extra metadata.
 * @param {string} [opts.file]        - override target file path (for tests).
 * @returns {Promise<void>}
 */
export async function logLaneUsage({ lane, promptLength, ok, exitCode, durationMs, extra, file } = {}) {
  const target = file || DEFAULT_FILE;
  const record = {
    ts: new Date().toISOString(),
    lane,
    promptLength: typeof promptLength === "number" ? promptLength : null,
    ok: ok === true,
    exitCode: typeof exitCode === "number" ? exitCode : null,
    durationMs: typeof durationMs === "number" ? durationMs : null,
  };
  if (extra !== undefined) record.extra = extra;
  try {
    await fs.appendFile(target, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Silent no-op. Logging must never break the dispatch it's attached to.
  }
}