// ops-watcher/health-os.mjs — HEALTH OS v1 scaffold (FounderOS-native core).
//
//   node ops-watcher/health-os.mjs --once
//
// WHAT THIS IS
// Health OS is NOT a separate app. It is a capability inside FounderOS, with
// AHMAD as the single logical orchestrator (per the recovered spec,
// handoffs/ahmad/RECOVERED-SPECS-HEALTH-LEARNING-LAWYER-CIVILLAW-2026-08-29.md
// section 1). The OWNER approved the "multi-ingestion + custom core" strategy
// (KOL-50, 2026-08-30): Gadgetbridge (Huawei Watch Fit 5 wearable data),
// ActivityWatch (screen/sedentary load), and Loop Habit Tracker / uhabits-style
// logging (smoking-log pattern) are compact/stable donor SIGNAL SOURCES that
// the OWNER runs as SEPARATE apps on their own devices. This module is the
// FounderOS-native core that will eventually INGEST their exported data. It is
// NOT a fork of any of those three donor apps — none of them live in this repo.
//
// BOUNDARY — what this scaffold deliberately does NOT decide or invent (per the
// spec's "NOT YET DECIDED" rule and the OWNER's boundary directive):
//   - Exact wearable data ingestion protocol/format. The OWNER has NOT yet
//     paired Gadgetbridge, so there is no real data to ingest yet. This module
//     builds against a clean, documented stub/interface (ingestWearableExport)
//     that returns a clean "no data available" result rather than throwing when
//     the export path is missing. Real Gadgetbridge/ActivityWatch parsing logic
//     waits until the OWNER has actually paired a device and real export data
//     exists to build against. Do not guess at their real file formats.
//   - Exact numeric LOW-ENERGY/EMERGENCY thresholds. The weights/thresholds in
//     determineDailyMode are clearly-labeled PROVISIONAL placeholder constants
//     (a simple weighted sum with obviously-adjustable numbers), commented
//     loudly as pending OWNER tuning based on real use.
//   - Dashboard/UI design. None needed for this scaffold.
//   - Nutrition tracking. Out of scope.
//   - Medical records. Out of scope.
//   - A dedicated mental-health module. Out of scope entirely (mood is in the
//     daily check-in, but that is not a designed mental-health system).
//   - Smoking quit-date. NEVER set autonomously — there is NO code path here that
//     could set a "quit date"; any quit-date requires explicit OWNER input. The
//     smoking function (recordSmokingEvent) is purely a frictionless logging
//     function with NO adaptive-reduction-target computation and NO quit-date
//     logic.
//
// ARCHITECTURE / CONVENTIONS (matches every other ops-watcher module this session):
//   - ESM, no npm/package.json.
//   - Dependency-injected for EVERY external effect (state file read/write,
//     wearable export file access, clock). Defaults are the real implementations;
//     tests inject in-memory or temp-path fixtures so NO real production state
//     file is ever touched by the regression suite.
//   - Crash-proof: every operation is independently try/caught so one failing
//     call cannot silence or crash the others. A state read/write failure is a
//     clean refusal (no false data), never a throw that propagates.
//   - State storage: ops-watcher/health-os-state.json — a NEW local operational
//     state file, following the EXACT pattern of ops-watcher/steward-state.json
//     and ops-watcher/review-runner.state.json (a single JSON object persisted
//     locally). config/ (agent-registry.json, decision-ledger.json) is
//     DECLARATIVE ONLY and is never used for live operational/daily-check-in
//     state.
//   - CLI via `node ops-watcher/health-os.mjs --once` is read-only reporting
//     only (last check-in, current mode, recent smoking-log count). An
//     interactive daily check-in flow (e.g. via Telegram) is a separate future
//     task, NOT this scaffold. This module is NOT wired into heartbeat.mjs yet
//     (that is a separate future step).
//
// DAILY MODES (per the spec):
//   NORMAL      — proceed with the planned day.
//   LOW-ENERGY  — reduce/narrow work to ~2-3 highest-value items; allow
//                 lower-priority work to move/reorder/shorten/reschedule.
//   EMERGENCY   — prioritize basic needs and recovery; avoid creating
//                 artificial "catch-up debt."
//
// PROTECTED ANCHORS (per the spec) — must not simply be optimized away:
//   sleep/recovery, relationship/family time, long-term learning,
//   leisure/hobbies. checkProtectedAnchor flags (does NOT block) if a proposed
//   schedule change would touch one of these. v1 is a label/tag-matching check;
//   a full calendar-integration system is future work, not yet decided.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const STATE_FILE = path.join(__dirname, "health-os-state.json");

const iso = (ms) => new Date(ms).toISOString();
const nowMs = () => Date.now();

// The four subjective check-in fields, each rated 1-5 per the spec. The morning
// check-in is intended to take ~10-20 seconds.
const CHECK_IN_FIELDS = ["energy", "mood", "focus", "body"];
const MIN_RATING = 1;
const MAX_RATING = 5;

// The four protected anchors named in the spec, expressed as the canonical
// labels/tags checkProtectedAnchor matches against (case-insensitive substring
// match on any tag in the proposed change). v1 label/tag-matching only.
const PROTECTED_ANCHOR_LABELS = [
  "sleep",
  "recovery",
  "relationship",
  "family",
  "learning",
  "leisure",
  "hobbies",
];

// Smoking-event types allowed by recordSmokingEvent (frictionless logging only —
// NO adaptive-reduction-target computation, NO quit-date logic).
const SMOKING_EVENT_TYPES = new Set(["smoke", "lapse", "craving"]);

// ====================================================================
// PROVISIONAL daily-mode weights and thresholds.
// >>> THESE NUMBERS ARE PLACEHOLDERS PENDING OWNER TUNING <<<
// The spec explicitly leaves "Exact numeric thresholds that trigger LOW-ENERGY
// or EMERGENCY" as NOT YET DECIDED. The values below are an obviously-adjustable
// starting point so the code has a real, testable shape. They MUST be revisited
// once the OWNER has real check-in + wearable data to calibrate against. Do
// NOT treat these as canonical — they are provisional scaffolding only.
// ====================================================================
//
// determineDailyMode computes a "capacity score" where HIGHER = better capacity
// (more likely NORMAL) and LOWER = worse (more likely LOW-ENERGY/EMERGENCY).
//
// Subjective weights (energy, mood, focus, body) — each 1-5. These sum to 1.0 so
// the subjective combined score stays on the same 1-5 scale as the inputs,
// making the thresholds below directly comparable to the raw rating range.
const SUBJECTIVE_WEIGHTS = {
  energy: 0.35, // the OWNER's spec emphasizes energy as the primary signal
  mood: 0.20,
  focus: 0.25,
  body: 0.20,
};

// Wearable-signal adjustment weights. Each is a SMALL downward nudge applied
// ONLY when the wearable signal is present (degrades gracefully to
// check-in-only when no wearable data exists — never crashes or blocks on
// missing wearable input). A poor wearable signal pulls the capacity score
// DOWN (worse). These are PROVISIONAL placeholders.
const WEARABLE_ADJUSTMENT_WEIGHTS = {
  sleepQuality: 0.30, // 1-5, lower = worse sleep
  restingHrDeviation: 0.0, // placeholder: resting-HR deviation from baseline (future)
  recoveryScore: 0.30, // 1-5, lower = worse recovery (if the device provides one)
};

// PROVISIONAL capacity-score thresholds (on the 1-5 scale). Adjust after real use.
//   score >= NORMAL_THRESHOLD   -> NORMAL
//   score >= LOW_ENERGY_THRESHOLD -> LOW-ENERGY
//   else                         -> EMERGENCY
const NORMAL_THRESHOLD = 3.5;
const LOW_ENERGY_THRESHOLD = 2.0;

// How many recent smoking events the CLI report counts (the last N, newest
// first). v1 just reports a count; trend analysis is future work.
const SMOKING_REPORT_RECENT_N = 10;

// ---- State file read/write (crash-proof defaults, injectable for tests) ----
// Matches the steward-state.json / review-runner.state.json pattern exactly: a
// single JSON object persisted locally. The default state shape:
//   {
//     checkIns: [],              // morning check-in records, newest last
//     currentMode: null,         // "NORMAL" | "LOW-ENERGY" | "EMERGENCY" | null
//     modeUpdatedAt: null,       // ISO timestamp of the last mode determination
//     smokingLog: [],            // smoking events, newest last
//     wearableLastIngestedAt: null // ISO timestamp of last successful ingestion
//   }
async function defaultReadState(stateFile) {
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return freshState();
  }
}

async function defaultWriteState(stateFile, state) {
  try {
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // crash-proof: never throw on state write failure (mirrors steward.mjs)
  }
}

function freshState() {
  return {
    checkIns: [],
    currentMode: null,
    modeUpdatedAt: null,
    smokingLog: [],
    wearableLastIngestedAt: null,
  };
}

// Normalize an arbitrary parsed object into a well-shaped state, tolerating
// missing/null/extra fields without throwing (crash-proof).
function normalizeState(obj) {
  if (!obj || typeof obj !== "object") return freshState();
  return {
    checkIns: Array.isArray(obj.checkIns) ? obj.checkIns : [],
    currentMode:
      obj.currentMode === "NORMAL" ||
      obj.currentMode === "LOW-ENERGY" ||
      obj.currentMode === "EMERGENCY"
        ? obj.currentMode
        : null,
    modeUpdatedAt: typeof obj.modeUpdatedAt === "string" ? obj.modeUpdatedAt : null,
    smokingLog: Array.isArray(obj.smokingLog) ? obj.smokingLog : [],
    wearableLastIngestedAt:
      typeof obj.wearableLastIngestedAt === "string" ? obj.wearableLastIngestedAt : null,
  };
}

// ---- Default real wearable-export file/dir probe (crash-proof, injectable) ----
// This is a PLACEHOLDER interface. The real export mechanism Gadgetbridge /
// ActivityWatch eventually provide is NOT yet decided (the OWNER has not yet
// paired a device). We do NOT guess at their real file formats here — we only
// probe whether the designated path exists at all, and if it does, return a
// clean "not yet implemented" signal rather than trying to parse an unknown
// format. Once real export data exists, this function is the single seam that
// gets a real parser; the rest of the code already consumes the documented
// internal shape (see WEARABLE_SIGNAL_SHAPE below).
async function defaultProbeWearableSource(sourcePath) {
  try {
    await fs.access(sourcePath);
    return { exists: true };
  } catch {
    return { exists: false };
  }
}

// The clean INTERNAL shape this module's code consumes once real wearable data
// exists. ingestWearableExport returns { available, signals } where signals (when
// available) is an object with these optional numeric fields, each 1-5 or null:
//   {
//     sleepQuality: 1-5 | null,   // subjective-style 1-5 scale, derived from the
//                                  // wearable's sleep data once a real parser exists
//     restingHr: number | null,    // raw resting heart rate (future; placeholder)
//     recoveryScore: 1-5 | null,   // 1-5 recovery score if the device provides one
//     ingestedAt: <ISO string>     // when this batch was ingested
//   }
// Every field is OPTIONAL / nullable so the rest of the code degrades gracefully
// to check-in-only when no wearable data exists. This shape is intentionally
// minimal and FounderOS-native — it is NOT any donor app's raw export shape.
const WEARABLE_SIGNAL_SHAPE_DOC = "see comment above ingestWearableExport";

// ====================================================================
// 1. recordMorningCheckIn
// ====================================================================
// Validates energy/mood/focus/body (each 1-5 per the spec). Out-of-range or
// missing input is REJECTED and logged — never crashes. On success, persists
// the check-in to the state file (appended to checkIns) and returns the record.
//
// deps: { stateFile, readState, writeState, log, now }
// Returns:
//   { ok: true, checkIn: {...}, state: {...} }                      on success
//   { ok: false, reason: "...", field: "energy"|"mood"|...|null }   on rejection
export async function recordMorningCheckIn(input, deps = {}) {
  const {
    stateFile = STATE_FILE,
    readState = defaultReadState,
    writeState = defaultWriteState,
    log = (m) => console.log(m),
    now = nowMs,
  } = deps;

  const { energy, mood, focus, body } = input || {};
  const values = { energy, mood, focus, body };

  // Validate each field is an integer in [1,5]. Reject (log + return) on the
  // first out-of-range/missing field — never throw.
  for (const field of CHECK_IN_FIELDS) {
    const v = values[field];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      !Number.isInteger(v) ||
      v < MIN_RATING ||
      v > MAX_RATING
    ) {
      log(
        `health-os: recordMorningCheckIn REJECTED field '${field}'=` +
          `${JSON.stringify(v)} (must be an integer ${MIN_RATING}-${MAX_RATING}) — ` +
          `check-in ignored, no state change`,
      );
      return {
        ok: false,
        reason: `${field} must be an integer ${MIN_RATING}-${MAX_RATING} (got ${JSON.stringify(v)})`,
        field,
      };
    }
  }

  const ts = typeof (input && input.now) === "number" ? input.now : now();
  const record = {
    at: iso(ts),
    energy,
    mood,
    focus,
    body,
  };

  let state;
  try {
    state = await readState(stateFile);
  } catch (err) {
    log(`health-os: recordMorningCheckIn state read threw (${err && err.message}) — using fresh state`);
    state = freshState();
  }
  state = normalizeState(state);
  state.checkIns.push(record);

  try {
    await writeState(stateFile, state);
  } catch (err) {
    // crash-proof: state write failure does not undo the in-memory record, but
    // we report it so the caller knows the persist may not have landed.
    log(`health-os: recordMorningCheckIn state write threw (${err && err.message}) — record may not have persisted`);
    return { ok: true, checkIn: record, state, persisted: false };
  }

  log(
    `health-os: morning check-in recorded at ${record.at} ` +
      `(energy=${energy} mood=${mood} focus=${focus} body=${body})`,
  );
  return { ok: true, checkIn: record, state, persisted: true };
}

// ====================================================================
// 2. determineDailyMode
// ====================================================================
// Returns "NORMAL" | "LOW-ENERGY" | "EMERGENCY" using a simple, clearly-commented
// weighted combination of the check-in scores and whatever wearable signals
// are available. Degrades gracefully to check-in-only when no wearable data
// exists — never crashes or blocks on missing wearable input.
//
// >>> WEIGHTS AND THRESHOLDS BELOW ARE PROVISIONAL PLACEHOLDERS <<<
// >>> PENDING OWNER TUNING BASED ON REAL USE. SEE CONSTANTS ABOVE. <<<
//
// deps: { log }  (pure-ish; no I/O — reads nothing, writes nothing)
// input:
//   checkIn: { energy, mood, focus, body } | null   (the last check-in, 1-5 each)
//   wearableSignals: { sleepQuality, restingHr, recoveryScore } | null
//   now: number (timestamp; only used for the returned at field)
// Returns:
//   { mode: "NORMAL"|"LOW-ENERGY"|"EMERGENCY", score: number, components: {...} }
export function determineDailyMode(input, deps = {}) {
  const { log = () => {} } = deps;
  const { checkIn = null, wearableSignals = null, now } = input || {};

  // If there is no check-in at all, we cannot determine a mode from subjective
  // state. Per the spec the morning loop combines check-in + wearable; with
  // neither, we default to NORMAL (do not fabricate a LOW-ENERGY/EMERGENCY from
  // nothing). This is the documented graceful degradation.
  if (!checkIn) {
    log("health-os: determineDailyMode — no check-in available, defaulting to NORMAL (no subjective signal)");
    return {
      mode: "NORMAL",
      score: null,
      components: { subjective: null, wearableAdjustment: 0, reason: "no-check-in" },
    };
  }

  // ---- Subjective combined score (weighted, stays on the 1-5 scale) ----
  let subjective = 0;
  let usedWeight = 0;
  for (const field of CHECK_IN_FIELDS) {
    const v = checkIn[field];
    const w = SUBJECTIVE_WEIGHTS[field];
    if (typeof v === "number" && Number.isFinite(v) && typeof w === "number") {
      subjective += v * w;
      usedWeight += w;
    }
  }
  // Renormalize to the 1-5 scale if some fields were missing (graceful).
  if (usedWeight > 0 && usedWeight !== 1) {
    subjective = subjective / usedWeight * 1.0;
  }

  // ---- Wearable adjustment (optional, degrades to zero when absent) ----
  // Each present wearable signal nudges the score toward the signal's value
  // (1-5), weighted by WEARABLE_ADJUSTMENT_WEIGHTS. A poor wearable signal
  // (low sleepQuality / recoveryScore) pulls the combined score DOWN. When no
  // wearable signals are present, adjustment is 0 and the mode is purely
  // subjective — the documented check-in-only degradation.
  let wearableAdjustment = 0;
  let wearableUsedWeight = 0;
  const ws = wearableSignals || {};
  for (const key of Object.keys(WEARABLE_ADJUSTMENT_WEIGHTS)) {
    const v = ws[key];
    const w = WEARABLE_ADJUSTMENT_WEIGHTS[key];
    if (typeof v === "number" && Number.isFinite(v) && typeof w === "number" && w > 0) {
      // Pull the combined score toward the wearable signal value, proportionally.
      // A wearable signal equal to the subjective score has no effect; a worse
      // wearable signal pulls the combined score down.
      wearableAdjustment += (v - subjective) * w;
      wearableUsedWeight += w;
    }
  }

  const score = subjective + wearableAdjustment;

  // ---- PROVISIONAL thresholds (see constants; pending OWNER tuning) ----
  let mode;
  if (score >= NORMAL_THRESHOLD) {
    mode = "NORMAL";
  } else if (score >= LOW_ENERGY_THRESHOLD) {
    mode = "LOW-ENERGY";
  } else {
    mode = "EMERGENCY";
  }

  log(
    `health-os: determineDailyMode -> ${mode} (subjective=${subjective.toFixed(2)}, ` +
      `wearableAdj=${wearableAdjustment.toFixed(2)}, score=${score.toFixed(2)}) ` +
      `[PROVISIONAL thresholds: NORMAL>=${NORMAL_THRESHOLD}, LOW-ENERGY>=${LOW_ENERGY_THRESHOLD}]`,
  );

  return {
    mode,
    score,
    components: {
      subjective,
      wearableAdjustment,
      wearableUsed: wearableUsedWeight > 0,
      reason: wearableUsedWeight > 0 ? "check-in+wearable" : "check-in-only",
    },
  };
}

// ====================================================================
// 3. ingestWearableExport  (STUB interface — real protocol NOT YET DECIDED)
// ====================================================================
// Reads a designated local export file/directory (which does NOT exist yet —
// the OWNER has not yet paired their device). Must return a clean "no data
// available" result rather than throwing when the path is missing.
//
// This is a PLACEHOLDER interface for whatever real export mechanism
// Gadgetbridge / ActivityWatch eventually provide. We do NOT guess at their
// real file formats — we only define a clean internal shape (see the comment
// above) that the rest of this code can consume once real data exists. When a
// real parser is built, it replaces the body of this function; the return
// shape stays the same so determineDailyMode needs no changes.
//
// deps: { probeWearableSource, log, now }
// Returns:
//   { available: false, signals: null, sourcePath, reason: "no data available at <path>" }
//     when the path is missing (the normal case today).
//   { available: true, signals: {...}, sourcePath, reason: "parsed", ingestedAt }
//     once a real parser exists. For now, if the path DOES exist, we return a
//     clean "not yet implemented" signal rather than guessing at an unknown
//     format — we never fabricate wearable signals from a file we cannot parse.
export async function ingestWearableExport(input, deps = {}) {
  const {
    probeWearableSource = defaultProbeWearableSource,
    log = (m) => console.log(m),
    now = nowMs,
  } = deps;
  const { sourcePath } = input || {};

  if (!sourcePath || typeof sourcePath !== "string") {
    log("health-os: ingestWearableExport — no sourcePath provided, returning no-data");
    return {
      available: false,
      signals: null,
      sourcePath: sourcePath || null,
      reason: "no sourcePath provided",
    };
  }

  let probe;
  try {
    probe = await probeWearableSource(sourcePath);
  } catch (err) {
    // crash-proof: a throwing probe is treated as "no data available", never a
    // crash that blocks the morning loop.
    log(`health-os: ingestWearableExport probe threw (${err && err.message}) — returning no-data`);
    return {
      available: false,
      signals: null,
      sourcePath,
      reason: `probe error: ${err && err.message || err}`,
    };
  }

  if (!probe || !probe.exists) {
    log(`health-os: ingestWearableExport — no data available at ${sourcePath} (path missing — device not yet paired?)`);
    return {
      available: false,
      signals: null,
      sourcePath,
      reason: `no data available at ${sourcePath}`,
    };
  }

  // The path EXISTS but we have NO real parser yet (the OWNER has not paired a
  // device / we have not decided the real export format). Returning a clean
  // "not yet implemented" rather than fabricating signals from an unknown file
  // is the honest, crash-proof behavior. determineDailyMode degrades to
  // check-in-only when signals is null.
  log(`health-os: ingestWearableExport — ${sourcePath} exists but no real parser implemented yet (returning no-signals, degrading to check-in-only)`);
  return {
    available: true,
    signals: null,
    sourcePath,
    reason: "source exists but wearable parser not yet implemented (placeholder)",
    ingestedAt: iso(now()),
  };
}

// ====================================================================
// 4. checkProtectedAnchor
// ====================================================================
// A simple guard function that FLAGS (does NOT block — just flags/logs) if a
// proposed schedule change would touch one of the four protected anchors named
// in the spec: sleep/recovery, relationship/family time, long-term learning,
// leisure/hobbies. v1 is a label/tag-matching check (case-insensitive
// substring match), NOT a full calendar-integration system (that is future work,
// not yet decided).
//
// deps: { log }
// input:
//   proposedChange: { tags: string[] | labels: string[] | description: string, ... }
//   now: number (timestamp; only used for the returned at field)
// Returns:
//   { flagged: boolean, anchors: string[], note: string }
export function checkProtectedAnchor(input, deps = {}) {
  const { log = () => {} } = deps;
  const { proposedChange = {} } = input || {};

  // Collect candidate tag/label strings from the proposed change. We accept
  // tags[], labels[], or a free-text description — v1 matches loosely so a
  // human tagging a schedule item as "learning" or "family dinner" is flagged.
  const candidates = new Set();
  const collect = (val) => {
    if (!val) return;
    if (Array.isArray(val)) {
      for (const s of val) if (typeof s === "string") candidates.add(s);
    } else if (typeof val === "string") {
      // Split a description-ish string on whitespace/punctuation into tokens.
      const tokens = val.toLowerCase().split(/[^a-z]+/).filter(Boolean);
      for (const t of tokens) candidates.add(t);
    }
  };
  collect(proposedChange.tags);
  collect(proposedChange.labels);
  collect(proposedChange.description);
  collect(proposedChange.title);
  collect(proposedChange.anchor);

  const matched = new Set();
  for (const c of candidates) {
    const lc = String(c).toLowerCase();
    for (const anchor of PROTECTED_ANCHOR_LABELS) {
      if (lc.includes(anchor)) {
        matched.add(anchor);
      }
    }
  }

  const anchors = [...matched];
  const flagged = anchors.length > 0;
  const note = flagged
    ? `PROTECTED ANCHOR touched: ${anchors.join(", ")} — protected human time; do not optimize away`
    : "no protected anchor touched";

  if (flagged) {
    log(`health-os: checkProtectedAnchor FLAGGED — ${note}`);
  }
  return { flagged, anchors, note };
}

// ====================================================================
// 5. recordSmokingEvent
// ====================================================================
// Purely a FRICTIONLESS logging function (matches the spec's
// "fast/frictionless smoking logs" requirement). NO adaptive-reduction-target
// computation and NO quit-date logic (explicitly out of scope — a smoking
// quit-date can NEVER be set autonomously; any quit-date requires explicit
// OWNER input, and there is no code path here that could set one).
//
// deps: { stateFile, readState, writeState, log, now }
// input:
//   type: "smoke" | "lapse" | "craving"
//   note: string (optional, free-text)
//   now: number (timestamp)
// Returns:
//   { ok: true, event: {...}, state: {...} }                     on success
//   { ok: false, reason: "...", type }                           on invalid type
export async function recordSmokingEvent(input, deps = {}) {
  const {
    stateFile = STATE_FILE,
    readState = defaultReadState,
    writeState = defaultWriteState,
    log = (m) => console.log(m),
    now = nowMs,
  } = deps;

  const { type, note } = input || {};

  if (!SMOKING_EVENT_TYPES.has(type)) {
    log(
      `health-os: recordSmokingEvent REJECTED type=${JSON.stringify(type)} ` +
        `(must be one of ${[...SMOKING_EVENT_TYPES].join(", ")}) — event ignored`,
    );
    return {
      ok: false,
      reason: `type must be one of ${[...SMOKING_EVENT_TYPES].join(", ")} (got ${JSON.stringify(type)})`,
      type,
    };
  }

  const ts = typeof (input && input.now) === "number" ? input.now : now();
  const event = {
    at: iso(ts),
    type,
    note: typeof note === "string" ? note : null,
  };

  let state;
  try {
    state = await readState(stateFile);
  } catch (err) {
    log(`health-os: recordSmokingEvent state read threw (${err && err.message}) — using fresh state`);
    state = freshState();
  }
  state = normalizeState(state);
  state.smokingLog.push(event);

  try {
    await writeState(stateFile, state);
  } catch (err) {
    log(`health-os: recordSmokingEvent state write threw (${err && err.message}) — event may not have persisted`);
    return { ok: true, event, state, persisted: false };
  }

  log(`health-os: smoking event logged at ${event.at} (type=${type}${note ? `, note=${note}` : ""})`);
  return { ok: true, event, state, persisted: true };
}

// ====================================================================
// CLI entrypoint (--once) — read-only reporting
// ====================================================================
// Reports current state (last check-in, current mode, recent smoking-log
// count). Read-only: no interactive prompt, no writes. An interactive daily
// check-in flow (e.g. via Telegram) is a separate future task, NOT this
// scaffold.
function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) if (argv[i] === "--once") out.once = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/health-os.mjs --once");
    process.exit(2);
  }

  const state = await defaultReadState(STATE_FILE);
  const lines = [];
  lines.push(`health-os --once report (${iso(nowMs())})`);

  // Last check-in
  const lastCheckIn = state.checkIns.length > 0 ? state.checkIns[state.checkIns.length - 1] : null;
  if (lastCheckIn) {
    lines.push(
      `  last check-in: ${lastCheckIn.at} ` +
        `(energy=${lastCheckIn.energy} mood=${lastCheckIn.mood} ` +
        `focus=${lastCheckIn.focus} body=${lastCheckIn.body})`,
    );
  } else {
    lines.push("  last check-in: (none recorded yet)");
  }

  // Current mode
  if (state.currentMode) {
    lines.push(`  current mode: ${state.currentMode} (set ${state.modeUpdatedAt || "?"})`);
  } else {
    lines.push("  current mode: (not yet determined)");
  }

  // Smoking log
  const total = state.smokingLog.length;
  const recent = state.smokingLog.slice(-SMOKING_REPORT_RECENT_N).reverse();
  lines.push(`  smoking log: ${total} event(s) total (showing last ${recent.length})`);
  for (const ev of recent) {
    lines.push(`    ${ev.at} ${ev.type}${ev.note ? ` — ${ev.note}` : ""}`);
  }

  // Wearable ingestion
  if (state.wearableLastIngestedAt) {
    lines.push(`  wearable last ingested: ${state.wearableLastIngestedAt}`);
  } else {
    lines.push("  wearable last ingested: (never — device not yet paired)");
  }

  console.log(lines.join("\n"));
  process.exit(0);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => {
    console.error("health-os fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}