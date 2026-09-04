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

// ---- Per-run detail (added 2026-09-04) ----
//
// WHY THIS EXISTS. Until now this log held seven scalars per run: ts, lane,
// promptLength, ok, timedOut, exitCode, durationMs. That is enough to say a lane
// failed and nothing about WHY.
//
// The proof is on the record. HATTA's real defect — re-uploading whole file
// bodies on every iteration until it timed itself out — was found from
// hatta/.harness-evidence.json, which says "read_file heartbeat.mjs -> 32,071
// chars". No other lane writes such a file. The same disease then showed up in
// SJAHRIR (three 480s timeouts, all on ~450-line file pairs) and was caught only
// because a human noticed the pattern across three separate reports.
//
// Invisible is not the same as absent. These fields make the next one findable
// from the log instead of from a hunch.
//
// The seven original fields are UNCHANGED, in shape and in name.
// ops-watcher/lane-usage-report.mjs and ops-watcher/lane-guard.mjs read them,
// and every historical record must stay comparable with every new one — the
// decision about whether a lane is worth waiting for rests on that history.
// Everything below is additive and defaults to null, so an old record and a new
// record differ by presence, never by meaning.

/** Coerce to a finite non-negative integer, or null. Never throws. */
function nonNegativeInt(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * Byte length of a stdio stream. Bytes, NOT characters: the thing being
 * measured is what crossed the wire, and a multi-byte file makes those two
 * numbers differ by exactly the amount that matters. Never throws.
 *
 * @param {*} value - a string, Buffer, or anything else.
 * @returns {number|null}
 */
export function stdioBytes(value) {
  try {
    if (value == null) return null;
    if (Buffer.isBuffer(value)) return value.length;
    if (typeof value === "string") return Buffer.byteLength(value, "utf8");
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalise whatever structured detail a vendor CLI reported into a flat,
 * JSON-safe object. Each CLI reports something different — codex, kimi and
 * claude do not agree on a schema — so this stores what was given rather than
 * forcing a shape none of them emit.
 *
 * Values are capped: this log is append-only plumbing, and a CLI that returns
 * its entire transcript in a field must not turn the usage log into a second
 * copy of the conversation.
 *
 * Never throws.
 */
export const CLI_FIELD_MAX = 500;
export function normalizeCliDetail(detail) {
  try {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
    const out = {};
    for (const [key, raw] of Object.entries(detail)) {
      if (raw == null) continue;
      if (typeof raw === "number" || typeof raw === "boolean") {
        out[key] = raw;
      } else if (typeof raw === "string") {
        out[key] = raw.length > CLI_FIELD_MAX ? `${raw.slice(0, CLI_FIELD_MAX)}…[truncated]` : raw;
      }
      // Objects and arrays are deliberately dropped rather than serialised: a
      // nested blob here is how a log file quietly becomes unreadable.
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Append ONE JSON line (NDJSON) to the lane-usage log. Best-effort, never throws.
 *
 * @param {object}  opts
 * @param {string}  opts.lane         - fixed lane identifier (e.g. "sjahrir").
 * @param {number|null} [opts.promptLength] - length of the prompt string.
 * @param {boolean} opts.ok           - true if the dispatch succeeded (exit 0).
 * @param {boolean} [opts.timedOut]   - true if the wrapper timeout fired.
 * @param {number|null} [opts.exitCode] - numeric exit code, or null.
 * @param {number|null} [opts.durationMs] - wall-clock duration in ms, or null.
 * @param {number|null} [opts.turns]  - iterations/turns the run took, when the
 *                                      CLI or harness reports them. This is the
 *                                      field that separates "the lane is slow"
 *                                      from "the lane spent four turns hunting
 *                                      for a file it was never given".
 * @param {*} [opts.stdout]           - raw stdout; stored as a BYTE COUNT only.
 * @param {*} [opts.stderr]           - raw stderr; stored as a BYTE COUNT only.
 * @param {number|null} [opts.stdoutBytes] - explicit override when the caller
 *                                      already knows the size and does not hold
 *                                      the text.
 * @param {number|null} [opts.stderrBytes] - as above.
 * @param {object|null} [opts.cli]    - structured fields the vendor CLI reported
 *                                      (model, reasoning effort, token counts,
 *                                      session id…). Scalars only; see
 *                                      normalizeCliDetail.
 * @param {*} [opts.extra]            - any optional extra metadata.
 * @param {string} [opts.file]        - override target file path (for tests).
 * @returns {Promise<void>}
 */
export async function logLaneUsage({
  lane,
  promptLength,
  ok,
  timedOut,
  exitCode,
  durationMs,
  turns,
  stdout,
  stderr,
  stdoutBytes,
  stderrBytes,
  cli,
  extra,
  file,
} = {}) {
  const target = file || DEFAULT_FILE;
  const record = {
    ts: new Date().toISOString(),
    lane,
    promptLength: typeof promptLength === "number" ? promptLength : null,
    ok: ok === true,
    // First-class, not inferred. A timeout used to be detectable only by
    // comparing durationMs against the wrapper cap, which silently mislabels a
    // timeout as an ordinary failure once a cap changes.
    timedOut: timedOut === true,
    exitCode: typeof exitCode === "number" ? exitCode : null,
    durationMs: typeof durationMs === "number" ? durationMs : null,
    // ---- per-run detail; null when the lane cannot report it ----
    turns: nonNegativeInt(turns),
    stdoutBytes: nonNegativeInt(stdoutBytes) ?? stdioBytes(stdout),
    stderrBytes: nonNegativeInt(stderrBytes) ?? stdioBytes(stderr),
    cli: normalizeCliDetail(cli),
  };
  if (extra !== undefined) record.extra = extra;
  try {
    await fs.appendFile(target, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Silent no-op. Logging must never break the dispatch it's attached to.
  }
}
/**
 * Measured reliability per lane, read from the usage log. Availability says a
 * lane answers; this says whether its answers are worth waiting for.
 * Returns { <lane>: { n, ok, failed, timedOut, successRate, timeoutRate } }
 * where successRate and timeoutRate are integer percentages, or null when a
 * lane has no records. Never throws: an unreadable/absent log returns {}.
 * @param {object} [opts]
 * @param {string} [opts.file]     - override the log path (tests).
 * @param {number} [opts.limit]    - consider only the most recent N records
 *                                   per lane (default 50), so a lane is judged
 *                                   on recent behaviour, not its whole history.
 * @param {number} [opts.capMs]    - a record with no explicit timedOut flag is
 *                                   counted as a timeout when durationMs >=
 *                                   this (default 470000). Older records
 *                                   predate the timedOut field; this keeps them
 *                                   usable instead of silently counting a
 *                                   timeout as an ordinary failure.
 */
export async function readLaneHealth(opts = {}) {
  const target = opts.file || DEFAULT_FILE;
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : 50;
  const capMs = Number.isFinite(opts.capMs) && opts.capMs >= 0 ? opts.capMs : 470_000;
  let raw;
  try {
    raw = await fs.readFile(target, "utf8");
  } catch {
    return {};
  }

  const byLane = new Map();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const lane = typeof record.lane === "string" && record.lane.trim() ? record.lane : null;
    if (!lane) continue;
    if (!byLane.has(lane)) byLane.set(lane, []);
    const records = byLane.get(lane);
    records.push(record);
    while (records.length > limit) records.shift();
  }

  const out = {};
  for (const [lane, records] of byLane.entries()) {
    const n = records.length;
    if (n === 0) {
      out[lane] = null;
      continue;
    }
    const okCount = records.filter((r) => r && r.ok === true).length;
    const timedOutCount = records.filter((r) => {
      if (!r) return false;
      if (r.timedOut === true) return true;
      if (typeof r.timedOut === "boolean") return false;
      return typeof r.durationMs === "number" && r.durationMs >= capMs;
    }).length;
    out[lane] = {
      n,
      ok: okCount,
      failed: n - okCount,
      timedOut: timedOutCount,
      successRate: Math.round((okCount / n) * 100),
      timeoutRate: Math.round((timedOutCount / n) * 100),
    };
  }
  return out;
}


