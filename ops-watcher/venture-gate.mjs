// ops-watcher/venture-gate.mjs
//
// The fences that make the owner's overnight pre-authorization real.
//
// He pre-authorized unattended venture work with five conditions. Four of them
// were sentences in a packet — which is exactly what "nothing under ventures/
// may be touched" was until it became validatePlanScope. A pre-authorization is
// only as real as its fences, and prose in a brief is not a fence.
//
//   G1  a NIGHTLY ceiling of 6, not a per-sweep cap of 1
//   G2  two consecutive failures halt venture execution until morning
//   G3  the venture's uncommitted files are untouchable
//   G4  nothing is committed to or pushed from the venture repository
//
// Everything here is pure or injectable. The gate decides; directive-runner
// acts on the decision and owns every write.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dayKey } from "./telegram-notify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Six is what the owner can actually review in one morning. MAX_EXECUTIONS_PER_SWEEP
// is 1, but the heartbeat sweeps every five minutes, so an eight-hour night
// permits about 96 executions. A per-sweep cap answers "how much at once"; it
// has never answered "how much in total".
export const NIGHTLY_EXECUTION_CEILING = 6;

// Two, not three. CORLEONE failed three times running on one file on
// 2026-09-04 and only a person noticing stopped it. Unattended, a losing streak
// is quota spent on nothing, and 44% of recorded lane time already produces no
// result.
export const CONSECUTIVE_FAILURE_HALT = 2;

export { dayKey };

// ---------------------------------------------------------------------------
// G1. The nightly ceiling.
// ---------------------------------------------------------------------------

// The counter lives under one day-key, so it resets by arithmetic rather than
// by anything having to run at midnight. dayKey is telegram-notify's, not a
// second implementation: two day boundaries that can disagree is a bug waiting
// for a timezone.
export function nightlyState(state) {
  const n = state && typeof state.nightly === "object" && state.nightly ? state.nightly : {};
  return { day: typeof n.day === "string" ? n.day : null, executed: Number(n.executed) || 0 };
}

export function nightlyExecutedOn(state, day) {
  const current = nightlyState(state);
  return current.day === day ? current.executed : 0;
}

/**
 * Returns { allowed, executed, ceiling, reason }.
 *
 * At the ceiling the sweep DECLINES and says so. The work is not dropped: the
 * directive stays approved and executable, and the next day's sweep picks it
 * up. Silently discarding approved work would be the worse failure — the owner
 * approved it and would never learn it evaporated.
 */
export function nightlyCeilingCheck(state, { now = Date.now, ceiling = NIGHTLY_EXECUTION_CEILING } = {}) {
  const day = dayKey(typeof now === "function" ? now() : now);
  const executed = nightlyExecutedOn(state, day);
  if (executed >= ceiling) {
    return {
      allowed: false,
      day,
      executed,
      ceiling,
      reason: `nightly ceiling reached: ${executed}/${ceiling} executions on ${day} — remaining approved directives WAIT for the next day, nothing is dropped`,
    };
  }
  return { allowed: true, day, executed, ceiling, reason: `${executed}/${ceiling} executions used on ${day}` };
}

// Mutates state. The caller persists it — this module never writes.
export function recordNightlyExecution(state, { now = Date.now } = {}) {
  const day = dayKey(typeof now === "function" ? now() : now);
  const executed = nightlyExecutedOn(state, day) + 1;
  state.nightly = { day, executed };
  return state.nightly;
}

// ---------------------------------------------------------------------------
// G2. Two consecutive failures halt the night.
// ---------------------------------------------------------------------------

export function ventureStreakState(state) {
  const s = state && typeof state.ventureStreak === "object" && state.ventureStreak ? state.ventureStreak : {};
  return {
    consecutiveFailures: Number(s.consecutiveFailures) || 0,
    haltedDay: typeof s.haltedDay === "string" ? s.haltedDay : null,
    haltedAt: typeof s.haltedAt === "string" ? s.haltedAt : null,
    lastReason: typeof s.lastReason === "string" ? s.lastReason : null,
  };
}

/**
 * Returns { halted, consecutiveFailures, reason }.
 *
 * The halt is scoped to a day-key, so morning clears it without anyone having
 * to remember to. It halts VENTURE execution only: Aidit OS's own directives
 * are unaffected, because the streak that justified stopping was a venture
 * streak and widening a halt beyond its evidence is its own kind of wrong.
 */
export function ventureHaltCheck(state, { now = Date.now, limit = CONSECUTIVE_FAILURE_HALT } = {}) {
  const day = dayKey(typeof now === "function" ? now() : now);
  const streak = ventureStreakState(state);
  if (streak.haltedDay === day) {
    return {
      halted: true,
      day,
      consecutiveFailures: streak.consecutiveFailures,
      reason: `venture execution HALTED for ${day} after ${streak.consecutiveFailures} consecutive failures (last: ${streak.lastReason || "unknown"}) — waiting for the owner`,
    };
  }
  // A halt from an earlier day does not carry over; morning is the reset.
  return { halted: false, day, consecutiveFailures: streak.haltedDay ? 0 : streak.consecutiveFailures, reason: "no halt in effect" };
}

/**
 * Records one venture execution outcome and returns the halt decision.
 * Mutates state; the caller persists and reports.
 */
export function recordVentureOutcome(state, outcome, { now = Date.now, limit = CONSECUTIVE_FAILURE_HALT, reason = null } = {}) {
  const day = dayKey(typeof now === "function" ? now() : now);
  const prior = ventureStreakState(state);
  const carried = prior.haltedDay === day ? prior.consecutiveFailures : (prior.haltedDay ? 0 : prior.consecutiveFailures);

  if (outcome === "done") {
    // A success breaks the streak. It does NOT lift a halt already in effect:
    // the halt exists so a person looks at what happened, and a later success
    // is not that person.
    state.ventureStreak = {
      consecutiveFailures: 0,
      haltedDay: prior.haltedDay === day ? day : null,
      haltedAt: prior.haltedDay === day ? prior.haltedAt : null,
      lastReason: null,
    };
    return { ...ventureHaltCheck(state, { now, limit }), justHalted: false };
  }

  const consecutiveFailures = carried + 1;
  const halting = consecutiveFailures >= limit;
  state.ventureStreak = {
    consecutiveFailures,
    haltedDay: halting ? day : (prior.haltedDay === day ? day : null),
    haltedAt: halting && prior.haltedDay !== day ? new Date(typeof now === "function" ? now() : now).toISOString() : prior.haltedAt,
    lastReason: reason || outcome,
  };
  return {
    ...ventureHaltCheck(state, { now, limit }),
    justHalted: halting && prior.haltedDay !== day,
    consecutiveFailures,
  };
}

// ---------------------------------------------------------------------------
// G3 + G4. What the venture repository says about itself.
// ---------------------------------------------------------------------------

function gitIn(dir, args, deps = {}, { trim = true } = {}) {
  const exec = deps.execFileSync || execFileSync;
  try {
    const raw = String(exec("git", ["-C", dir, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    }));
    // `status --porcelain` encodes the state in the FIRST TWO COLUMNS, and a
    // modified-but-unstaged file starts with a space. Trimming the whole block
    // ate that space on the first line only, so " M src/x.py" parsed as
    // "rc/x.py" — a path that matches nothing, silently making the owner's
    // first uncommitted file touchable. Never trim the left edge of porcelain.
    return trim ? raw.trim() : raw.replace(/\s+$/, "");
  } catch {
    return null;
  }
}

/**
 * The venture's uncommitted paths, as repo-relative Aidit OS paths.
 *
 * DERIVED at gate time, never hardcoded. config/ventures.json names five files
 * as the owner's decision since KOL-66; a literal list here would be wrong the
 * moment he commits one of them, and wrong in the dangerous direction — it
 * would keep refusing a file he had already dealt with while missing a new one.
 *
 * Returns null when git cannot answer. A null is NOT an empty list: the caller
 * must fail closed, because "no uncommitted files" and "I could not tell" are
 * the same answer only if you are not paying attention.
 */
export function ventureUncommittedPaths(venture, deps = {}) {
  const repoPath = String(venture?.repoPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!repoPath) return null;
  const abs = deps.venturePath || path.join(REPO_ROOT, repoPath);
  const out = gitIn(abs, ["status", "--porcelain"], deps, { trim: false });
  if (out === null) return null;
  if (!out.trim()) return [];
  return out
    .split(/\r?\n/)
    .filter((line) => line.length > 3)
    // Two status columns, one space, then the path. Match it rather than
    // slicing a fixed width, so an unexpected shape yields nothing instead of
    // a plausible-looking wrong path.
    .map((line) => (/^..\s(.+)$/.exec(line) || [])[1] || "")
    .map((p) => p.trim())
    .filter(Boolean)
    // A rename reads "old -> new"; both sides are his.
    .flatMap((p) => (p.includes(" -> ") ? p.split(" -> ") : [p]))
    .map((p) => `${repoPath}/${p.replace(/^"|"$/g, "").replace(/\\/g, "/")}`);
}

/**
 * G3. Refuse any plan path that is one of the venture's uncommitted files.
 *
 * Returns { ok, violations }.
 */
export function checkUncommittedFiles(files, ventures, deps = {}) {
  const list = Array.isArray(files) ? files : [];
  const violations = [];
  const readPaths = deps.ventureUncommittedPaths || ventureUncommittedPaths;

  for (const venture of Array.isArray(ventures) ? ventures : []) {
    const base = String(venture?.repoPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!base) continue;
    const touched = list
      .map((f) => String(f || "").replace(/\\/g, "/").replace(/^\.\//, ""))
      .filter((f) => f === base || f.startsWith(`${base}/`));
    if (!touched.length) continue;

    const uncommitted = readPaths(venture, deps);
    if (uncommitted === null) {
      // Fail closed. Not knowing is not permission.
      for (const f of touched) violations.push(`${f}: cannot read the venture's git status — refusing rather than assuming it is clean`);
      continue;
    }
    const owned = new Set(uncommitted);
    for (const f of touched) {
      if (owned.has(f)) {
        violations.push(`${f}: uncommitted in ${venture.id} — the owner's since KOL-66, not available to a lane`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * G4. A snapshot of the venture repository's git position, taken before and
 * after execution.
 *
 * The packet's "no git" hard stop is prompt text. CORLEONE's workspace-write
 * sandbox and HATTA's path jail happen to cover it; SJAHRIR's compliance is
 * assumed, and assumption is not a fence. This compares what the repository
 * actually did, so it catches a commit or a push regardless of which lane made
 * it or how.
 *
 * That repository has an off-machine remote — it is the one path by which
 * tonight's mistake becomes someone else's.
 */
export function ventureGitPosition(venture, deps = {}) {
  const repoPath = String(venture?.repoPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!repoPath) return null;
  const abs = deps.venturePath || path.join(REPO_ROOT, repoPath);
  const head = gitIn(abs, ["rev-parse", "HEAD"], deps);
  if (head === null) return null;
  return {
    id: venture.id,
    head,
    branch: gitIn(abs, ["rev-parse", "--abbrev-ref", "HEAD"], deps),
    // Every remote-tracking ref, so a push that moves origin/main is visible
    // even when local HEAD did not move.
    remoteRefs: gitIn(abs, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"], deps) || "",
    status: gitIn(abs, ["status", "--porcelain"], deps) || "",
  };
}

/**
 * Compare two positions. Returns { ok, violations }.
 */
export function compareVentureGitPosition(before, after) {
  const violations = [];
  if (!before || !after) {
    return { ok: false, violations: ["venture git position unavailable — refusing to certify that nothing was committed or pushed"] };
  }
  if (before.head !== after.head) {
    violations.push(`${after.id}: HEAD moved ${String(before.head).slice(0, 7)} -> ${String(after.head).slice(0, 7)} — a commit was made to the venture repository`);
  }
  if (before.branch !== after.branch) {
    violations.push(`${after.id}: branch changed ${before.branch} -> ${after.branch}`);
  }
  if (before.remoteRefs !== after.remoteRefs) {
    violations.push(`${after.id}: a remote-tracking ref moved — something was pushed to the off-machine remote`);
  }
  return { ok: violations.length === 0, violations };
}

// Plans that ASK for a git write are refused before a lane ever sees them. This
// is the cheap pre-flight; compareVentureGitPosition is the one that actually
// holds, because it does not depend on the plan saying what it will do.
const GIT_WRITE_VERBS = /\bgit\b[^\n]*?(?<!-)\b(push|commit|merge|rebase|reset|cherry-pick|tag|am|apply|revert)\b(?!-)/i;

export function checkPlanForVentureGitWrites(plan) {
  const violations = [];
  const haystacks = [
    ...(Array.isArray(plan?.steps) ? plan.steps : []),
    String(plan?.verify || ""),
    String(plan?.objective || ""),
  ];
  for (const text of haystacks) {
    const s = String(text || "");
    if (GIT_WRITE_VERBS.test(s)) {
      violations.push(`plan asks for a git write: "${s.slice(0, 120)}" — no commit to or push from a venture repository`);
    }
  }
  return { ok: violations.length === 0, violations };
}
