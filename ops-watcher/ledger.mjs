// ops-watcher/ledger.mjs
//
// The single writer for the FounderOS event ledger at `state/ledger.jsonl`.
//
// Why this module exists: today the state of a directive is reconstructed by
// matching ~25 free-text strings inside Paperclip comment bodies, by three
// parsers that do not share code. Every one of last week's four live bugs came
// from that. The replacement is an append-only log of typed facts, and this is
// the ONLY thing permitted to append to it. Everything else calls in here.
//
// Three properties this file is responsible for, in the order they matter:
//
//   1. The log can always be READ. A log that cannot be read at all is the one
//      failure mode that loses everything, so `readAll` skips a line it cannot
//      parse, counts it, and reports the count — it never throws.
//   2. There is only ONE writer at a time. Two processes appending
//      concurrently is silent corruption, so every write path takes an
//      exclusive lock file and releases it in a `finally`.
//   3. A half-written line is never left behind. See `verifyAndSettle` below
//      for why read-back verification, and not fsync, is the mechanism.
//
// Every seam is injected through a trailing `deps` object (`_fs`, `_now`,
// `ledgerFile`, `lockFile`, `staleLockMs`), so the regression suite runs
// entirely in memory: no disk, no clock, no network.

import { promises as realFs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvent } from "./ledger-schema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** The log itself. Tracked in git: it is the durable record, not a cache. */
export const DEFAULT_LEDGER_FILE = path.join(ROOT, "state", "ledger.jsonl");

/** The exclusive-writer lock. Never tracked in git. */
export const DEFAULT_LOCK_FILE = path.join(ROOT, "state", "ledger.lock");

/**
 * How long a lock may be held before a later writer is entitled to break it.
 * Two minutes is far longer than any honest append (which is two reads and one
 * append of a few hundred bytes) and short enough that a crashed heartbeat does
 * not wedge the ledger until a human notices.
 */
export const DEFAULT_STALE_LOCK_MS = 120_000;

function resolveDeps(deps = {}) {
  return {
    _fs: deps._fs || realFs,
    _now: deps._now || Date.now,
    ledgerFile: deps.ledgerFile || DEFAULT_LEDGER_FILE,
    lockFile: deps.lockFile || DEFAULT_LOCK_FILE,
    staleLockMs: Number.isFinite(deps.staleLockMs) ? deps.staleLockMs : DEFAULT_STALE_LOCK_MS,
    pid: Number.isFinite(deps.pid) ? deps.pid : process.pid,
    log: typeof deps.log === "function" ? deps.log : () => {},
  };
}

function errText(err) {
  return err && err.stack ? err.stack : String(err);
}

// ── reading ───────────────────────────────────────────────────────────

/**
 * Read the raw text of the log. A missing file is an empty log, not an error —
 * the very first append must work on a machine that has never written one.
 * Any OTHER read error propagates: not being able to read the log is exactly
 * the moment a writer must refuse to append, because it cannot know the last
 * seq and would otherwise reuse one.
 */
async function readRaw(_fs, ledgerFile) {
  try {
    return await _fs.readFile(ledgerFile, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return "";
    throw err;
  }
}

/**
 * The highest seq claimed by any line we can parse at all — deliberately more
 * permissive than `validateEvent`. A line that parses to an object with
 * `seq: 5` but an unknown `kind` is corrupt for reading purposes, yet it has
 * still consumed 5. Handing 5 out again would put two different facts under one
 * sequence number, which is worse than a gap. Gaps are legal; duplicates are not.
 */
function scanHighestSeq(text) {
  let highest = 0;
  for (const line of String(text || "").split("\n")) {
    if (line.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // Unparseable: its seq is unknowable. Nothing we can do.
    }
    if (parsed && typeof parsed === "object" && Number.isSafeInteger(parsed.seq) && parsed.seq > highest) {
      highest = parsed.seq;
    }
  }
  return highest;
}

/**
 * Parse the log into events, tolerating damage.
 *
 * Returns `{ ok, events, corrupt, corruptLines, reason }`. A line is corrupt if
 * it does not parse as JSON, or parses but fails `validateEvent` — either way it
 * is skipped and counted, never thrown on. `corruptLines` carries 1-based line
 * numbers so an operator can go and look at them.
 */
export async function readAll(deps = {}) {
  const { _fs, ledgerFile } = resolveDeps(deps);
  let text;
  try {
    text = await readRaw(_fs, ledgerFile);
  } catch (err) {
    // Even a hard read failure is answered, not thrown: a caller rendering the
    // cockpit must be able to show "the ledger is unreadable" rather than 500.
    return { ok: false, events: [], corrupt: 0, corruptLines: [], reason: `read failed: ${errText(err)}` };
  }

  const events = [];
  const corruptLines = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // A trailing newline is not damage.
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      corruptLines.push(i + 1);
      continue;
    }
    const verdict = validateEvent(parsed);
    if (!verdict.ok) {
      corruptLines.push(i + 1);
      continue;
    }
    events.push(parsed);
  }

  events.sort((a, b) => a.seq - b.seq);
  return { ok: true, events, corrupt: corruptLines.length, corruptLines, reason: null };
}

/** Every event with a seq strictly greater than `seq`. Same result shape as `readAll`. */
export async function readSince(seq, deps = {}) {
  const after = Number.isFinite(seq) ? seq : 0;
  const result = await readAll(deps);
  return { ...result, events: result.events.filter((ev) => ev.seq > after) };
}

/**
 * The highest seq on disk; 0 when the log is empty or missing.
 *
 * This is the reader-facing convenience. The write path does NOT call it — it
 * scans the same text it is about to verify against, under the lock, so that
 * an unreadable log fails the append instead of silently restarting at 1.
 */
export async function lastSeq(deps = {}) {
  const { _fs, ledgerFile } = resolveDeps(deps);
  try {
    return scanHighestSeq(await readRaw(_fs, ledgerFile));
  } catch {
    return 0;
  }
}

// ── the lock ──────────────────────────────────────────────────────────

async function ensureDir(_fs, file) {
  if (typeof _fs.mkdir !== "function") return;
  try {
    await _fs.mkdir(path.dirname(file), { recursive: true });
  } catch {
    // A directory that cannot be created will surface as a write error below,
    // with a far more useful message than anything we could add here.
  }
}

/**
 * Take the exclusive writer lock.
 *
 * `flag:"wx"` is an atomic create-or-fail: there is no read-then-write window
 * for a second process to slip through. The PID and startedAt inside are for
 * diagnosis and for the staleness decision.
 *
 * Returns `{ acquired, reason, holder, broke }`. `broke` is set whenever a
 * stale lock was removed, and carries why — a lock is never broken silently,
 * because "the previous writer died mid-append" is exactly the fact you want in
 * front of you when the log later looks odd.
 */
async function acquireLock({ _fs, _now, lockFile, staleLockMs, pid, log }) {
  const payload = () => JSON.stringify({ pid, startedAt: new Date(_now()).toISOString() });

  async function create() {
    try {
      await _fs.writeFile(lockFile, payload(), { flag: "wx" });
      return true;
    } catch (err) {
      if (err && err.code === "EEXIST") return false;
      throw err;
    }
  }

  await ensureDir(_fs, lockFile);

  if (await create()) return { acquired: true, reason: null, holder: null, broke: null };

  // Held. Decide whether the holder is alive-enough to respect.
  let holder = null;
  let unreadable = null;
  try {
    holder = JSON.parse(await _fs.readFile(lockFile, "utf8"));
  } catch (err) {
    unreadable = err && err.code === "ENOENT" ? "vanished" : "unparseable";
  }

  if (unreadable === "vanished") {
    // The holder released it between our create and our read. Try once more.
    if (await create()) return { acquired: true, reason: null, holder: null, broke: null };
    return { acquired: false, reason: "ledger is locked by another writer", holder: null, broke: null };
  }

  const startedAt = holder && typeof holder.startedAt === "string" ? Date.parse(holder.startedAt) : NaN;
  const ageMs = Number.isFinite(startedAt) ? _now() - startedAt : null;

  let breakReason = null;
  if (unreadable === "unparseable") {
    breakReason = "lock file is not readable JSON, so its age cannot be trusted";
  } else if (ageMs === null) {
    breakReason = "lock file has no usable startedAt";
  } else if (ageMs > staleLockMs) {
    breakReason = `lock held for ${ageMs}ms, over the ${staleLockMs}ms stale threshold`;
  }

  if (!breakReason) {
    return {
      acquired: false,
      reason: `ledger is locked by pid ${holder && holder.pid} (held ${ageMs}ms, under the ${staleLockMs}ms stale threshold)`,
      holder,
      broke: null,
    };
  }

  const broke = { reason: breakReason, previous: holder, ageMs };
  log(`ledger: breaking a stale lock — ${breakReason}`);
  try {
    await _fs.unlink(lockFile);
  } catch (err) {
    if (!err || err.code !== "ENOENT") {
      return { acquired: false, reason: `stale lock could not be removed: ${errText(err)}`, holder, broke };
    }
  }
  if (await create()) return { acquired: true, reason: null, holder, broke };
  // Someone else broke it and took it first. That is fine — they are the writer now.
  return { acquired: false, reason: "another writer took the lock while the stale one was being broken", holder, broke };
}

async function releaseLock({ _fs, lockFile }) {
  try {
    await _fs.unlink(lockFile);
  } catch {
    // A lock that is already gone needs no release. Anything else here would
    // mask the real result of the append the caller is waiting on.
  }
}

// ── writing ───────────────────────────────────────────────────────────

/**
 * Append `payload` to the log and prove it landed whole.
 *
 * Why read-back verification rather than write-then-fsync: fsync tells you the
 * bytes reached the device, but it cannot tell you the bytes are the ones you
 * meant — a short write that returned successfully still passes fsync. Reading
 * the file back and comparing against `prior + payload` catches a short, torn,
 * or interleaved write, and — because we already hold `prior` in hand — lets us
 * put the file back to the exact bytes it had before, so a failed append leaves
 * no residue at all. It costs one extra read of a small file per append, which
 * at this system's write rate is free.
 *
 * The honest limit: this cannot survive the machine losing power mid-write,
 * because there is no process left to run the restore. That case is handled at
 * the other end — `readAll` skips the resulting corrupt line and counts it.
 */
async function verifyAndSettle({ _fs, ledgerFile, prior, payload }) {
  await _fs.appendFile(ledgerFile, payload);

  let after;
  try {
    after = await readRaw(_fs, ledgerFile);
  } catch (err) {
    return { ok: false, reason: `append could not be verified: ${errText(err)}` };
  }
  if (after === prior + payload) return { ok: true, reason: null };

  // The bytes are not what we wrote. Put the file back the way we found it.
  try {
    await _fs.writeFile(ledgerFile, prior);
    return { ok: false, reason: "append did not verify; the log was restored to its previous bytes" };
  } catch (err) {
    return {
      ok: false,
      reason: `append did not verify AND the log could not be restored — inspect ${ledgerFile}: ${errText(err)}`,
    };
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The shared body of `append` and `appendMany`.
 *
 * All-or-nothing is achieved twice over: every candidate is validated before
 * any byte is written, and the whole batch goes out in ONE `appendFile` that is
 * verified and rolled back as a unit.
 */
async function writeBatch(rawEvents, deps) {
  const d = resolveDeps(deps);
  const { _fs, ledgerFile } = d;

  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    return { ok: false, seq: null, seqs: [], written: 0, reason: "nothing to append" };
  }
  for (let i = 0; i < rawEvents.length; i++) {
    if (!isPlainObject(rawEvents[i])) {
      return { ok: false, seq: null, seqs: [], written: 0, reason: `event ${i} is not an object`, index: i };
    }
  }

  let lock;
  try {
    lock = await acquireLock(d);
  } catch (err) {
    return { ok: false, seq: null, seqs: [], written: 0, reason: `lock failed: ${errText(err)}` };
  }
  if (!lock.acquired) {
    return { ok: false, seq: null, seqs: [], written: 0, reason: lock.reason, retryable: true, broke: lock.broke };
  }

  try {
    let prior;
    try {
      prior = await readRaw(_fs, ledgerFile);
    } catch (err) {
      // Cannot read means cannot know the last seq. Refusing is the only safe
      // move: appending blind would hand out a seq that is already in use.
      return { ok: false, seq: null, seqs: [], written: 0, reason: `log is unreadable, refusing to append: ${errText(err)}`, broke: lock.broke };
    }

    // If a previous write was torn and left no trailing newline, our line would
    // graft itself onto the damaged one and take a second fact down with it.
    // A leading newline keeps the damage confined to exactly one line.
    const separator = prior !== "" && !prior.endsWith("\n") ? "\n" : "";

    const next = scanHighestSeq(prior);
    const candidates = [];
    for (let i = 0; i < rawEvents.length; i++) {
      // The writer owns `seq`, always. Any seq a caller supplied is discarded
      // rather than honoured — a caller that could pick its own would be a
      // second writer wearing a disguise.
      const { seq: _discarded, ...rest } = rawEvents[i];
      const candidate = { seq: next + i + 1, ...rest };
      const verdict = validateEvent(candidate);
      if (!verdict.ok) {
        return { ok: false, seq: null, seqs: [], written: 0, reason: verdict.reason, index: i, broke: lock.broke };
      }
      candidates.push(candidate);
    }

    const payload = separator + candidates.map((c) => JSON.stringify(c) + "\n").join("");
    const settled = await verifyAndSettle({ _fs, ledgerFile, prior, payload });
    if (!settled.ok) {
      return { ok: false, seq: null, seqs: [], written: 0, reason: settled.reason, broke: lock.broke };
    }

    const seqs = candidates.map((c) => c.seq);
    return { ok: true, seq: seqs[seqs.length - 1], seqs, written: seqs.length, reason: null, broke: lock.broke };
  } catch (err) {
    // `append` must never throw: the heartbeat calls it, and a throw here would
    // take the whole sweep down over one bad fact.
    return { ok: false, seq: null, seqs: [], written: 0, reason: `append failed: ${errText(err)}` };
  } finally {
    await releaseLock(d);
  }
}

/**
 * Append exactly one event.
 *
 * Validates it (with the seq this writer assigns), writes exactly one line, and
 * returns `{ ok, seq, reason }`. Never throws. A rejected event does not write
 * and does not consume a seq — the next valid append takes the number the
 * rejected one would have had, so no seq on disk is ever reused.
 */
export async function append(event, deps = {}) {
  const result = await writeBatch([event], deps);
  return { ...result, seq: result.ok ? result.seqs[0] : null };
}

/**
 * Append a batch. All-or-nothing: one invalid event in the batch means none of
 * them are written and no seq is consumed. `seq` is the LAST seq assigned;
 * `seqs` has them all.
 */
export async function appendMany(events, deps = {}) {
  return writeBatch(events, deps);
}
