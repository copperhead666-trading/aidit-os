// ops-watcher/ruflo-lane-context.mjs
// Tiny Ruflo support helpers for lane wrappers. This does not start Ruflo and
// does not assume every lane is an MCP client; it only carries compact context.
//
// === THE CLOCK IS PART OF THE CONTEXT ===
// Until 2026-09-06 this file narrowed what a lane was allowed to do and said
// nothing about how long it had. Every lane therefore planned as if its time
// were unbounded, and then died at a wall it was never told about. The numbers
// were unambiguous: of 77 recorded runs, 43% of all lane wall-clock was wasted
// and 16% ended in a timeout, and the ten longest runs all ended at exactly
// 480.0 seconds — the spawn timeout to the millisecond. Runs that end at the
// limit to three decimal places were killed, not finished.
//
// A budget a model cannot see is not a budget, it is an ambush. So the prelude
// now states the wall in seconds and says what to do about it. This costs a
// few dozen tokens per dispatch and is the cheapest change available against
// the largest single source of waste in the lane system.

export const RUFLO_LANE_ENV = Object.freeze({
  CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS: "1",
  CLAUDE_FLOW_MCP_TOOLS: "memory,hooks,swarm,agent",
});

const PRELUDES = Object.freeze({
  hatta: [
    "Ruflo context: HATTA has no native MCP client in this Ollama harness.",
    "Use only supplied Ruflo context and allowed workspace tools; do not start daemons, install packages, or widen tool access.",
  ],
  sjahrir: [
    "Ruflo context: SJAHRIR must not assume native MCP unless the wrapper proves it.",
    "Use supplied Ruflo context as routing/memory hints only; do not start daemons, install packages, or write outside the assigned worktree.",
  ],
  gibran: [
    "Ruflo context: GIBRAN is review-only.",
    "Use supplied Ruflo context only as review background; never coordinate writes, mutate files, start daemons, or self-approve implementation.",
  ],
  // CORLEONE and SOEKARNO were absent here, so they fell to the generic text
  // below while the wrapper never applied any prelude at all. Both facts are
  // fixed together: the entries exist, and the dispatchers now call this.
  corleone: [
    "Ruflo context: CORLEONE writes inside its own git worktree and nowhere else.",
    "Use supplied Ruflo context as routing/memory hints only; do not start daemons, install packages, widen tool access, commit, or push.",
  ],
  soekarno: [
    "Ruflo context: SOEKARNO is read-only.",
    "Report what the files say; never write, move, or delete anything, and never start daemons or install packages.",
  ],
});

const GENERIC_PRELUDE = Object.freeze([
  "Ruflo context: use supplied routing/memory hints only.",
  "Do not start daemons, install packages, or widen tool access unless the packet explicitly permits it.",
]);

export function rufloLaneEnv() {
  return { ...RUFLO_LANE_ENV };
}

export function mergeRufloLaneEnv(baseEnv = {}) {
  const env = { ...baseEnv };
  for (const [key, value] of Object.entries(RUFLO_LANE_ENV)) {
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}

/**
 * The time-budget lines, or [] when the caller does not know the budget.
 *
 * Returns [] rather than inventing a number: a wrong budget is worse than a
 * missing one, because a lane told it has ten minutes when it has eight will
 * plan straight past the wall with more confidence than before.
 */
export function buildLaneBudgetLines(budgetMs) {
  const ms = Number(budgetMs);
  if (!Number.isFinite(ms) || ms <= 0) return [];
  const seconds = Math.floor(ms / 1000);
  const half = Math.floor(seconds / 2);
  return [
    `Time budget: this run is stopped after ${seconds} seconds of wall clock. That is a hard wall, not a target.`,
    "Only what you have already written to disk survives the wall. An unfinished larger change is worth nothing; a smaller correct one that lands is worth everything.",
    `By ${half} seconds you should be writing, not exploring. If the packet is too large for the budget, do the part that stands on its own, then say plainly what you left and why.`,
  ];
}

export function buildRufloLanePrelude(lane, { budgetMs } = {}) {
  const key = String(lane || "").trim().toLowerCase();
  const lines = PRELUDES[key] || GENERIC_PRELUDE;
  return ["[RUFLO LANE CONTEXT]", ...lines, ...buildLaneBudgetLines(budgetMs), "[/RUFLO LANE CONTEXT]"].join("\n");
}

export function withRufloLanePrelude(lane, prompt, { budgetMs } = {}) {
  const body = String(prompt ?? "");
  if (body.includes("[RUFLO LANE CONTEXT]")) return body;
  return `${buildRufloLanePrelude(lane, { budgetMs })}\n\n${body}`;
}
