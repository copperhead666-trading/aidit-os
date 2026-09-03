// ops-watcher/specialists.mjs
//
// Decides WHICH specialist voice a dispatch packet speaks in, and keeps that
// decision small enough to survive HATTA.
//
// Two registries already existed in this repo and neither was ever read by a
// dispatcher. config/skill-matrix.json (taskClass -> required skills, standards,
// preferred maker/reviewer, hard stops) was read only by the cockpit, to be
// displayed. skills/resolve-skills.mjs was called only by a CLI preview. This
// module is the wire between them and the packet builders.
//
// WHY EXCERPTS AND NOT WHOLE PERSONAS: the vendored personas in
// agents/specialists/ run 10-18 KB each. HATTA's measured failure mode is packet
// size — over 25 real dispatches on 2026-09-01 the timeouts clustered on packets
// of roughly 3 KB (docs/standards/prompting-standards.md). Pasting a 13 KB
// persona into a packet would not make HATTA a designer, it would make HATTA time
// out. So a persona contributes its identity line and its hard rules, truncated
// on a sentence boundary, and nothing else. The full file stays in the repo as
// the auditable source of that excerpt.
//
// This module never dispatches, never spawns, never writes. It returns strings.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MATRIX_FILE = path.join(REPO_ROOT, "config", "skill-matrix.json");
const SPECIALIST_DIR = path.join(REPO_ROOT, "agents", "specialists");

// Per-persona and per-section budgets, in characters. Two personas at 900 chars
// each plus headers lands a specialist section near 2 KB, which still leaves room
// inside HATTA's working envelope for the actual task.
export const DEFAULT_PERSONA_BUDGET = 900;
export const DEFAULT_MAX_SPECIALISTS = 2;

// Keyword -> taskClass. Deliberately explicit rather than clever: a wrong guess
// here silently hands a database job to a designer, and a table a human can read
// is a table a human can correct. Indonesian terms are included because the owner
// writes directives in Indonesian.
//
// Two rules were learned from the owner's own first example, "bangun dashboard
// untuk trading os":
//
//  1. Classification scores by how many distinct keywords match, and only falls
//     back to this list's order to break a tie. First-match-wins let a single
//     stray word decide the whole class.
//  2. A class must be keyed on the WORK, not on the venture the work belongs to.
//     "trading" and "caveman" name a venture; every dashboard, report and
//     migration that venture ever needs would have been swallowed by
//     trading-safety. Only the safety concern itself belongs here — position
//     sizing, risk limits, drawdown — so that "a dashboard for the trading OS"
//     correctly reaches a designer, while "add a risk limit" does not.
export const TASK_CLASS_KEYWORDS = Object.freeze([
  ["trading-safety", ["position sizing", "risk limit", "backtest", "drawdown", "stop loss", "stop-loss", "max loss", "leverage", "liquidation"]],
  ["frontend-design", ["dashboard", "cockpit", "ui", "ux", "design", "layout", "component", "css", "page", "screen", "visual", "tampilan", "halaman"]],
  ["database-storage", ["database", "postgres", "sql", "schema", "migration", "index", "query", "ledger"]],
  ["backend-api", ["api", "endpoint", "route", "server", "backend", "webhook", "http"]],
  ["agent-dispatch", ["dispatch", "lane", "agent", "orchestrat", "routing", "worker", "swarm"]],
  ["infra-network", ["pm2", "daemon", "service", "deploy", "network", "port", "tailscale", "infra", "uptime", "restart"]],
  ["repo-analysis", ["audit", "survey", "analyse", "analyze", "inventory", "investigate", "read-only"]],
  ["cleanup-archive", ["cleanup", "clean up", "archive", "delete", "remove", "prune", "dedupe", "stale"]],
  ["owner-communication", ["report", "summary", "explain", "brief", "card", "telegram", "notify", "laporan"]],
]);

// taskClass -> vendored persona slugs (basenames in agents/specialists/).
// Kept here rather than inside skill-matrix.json so that a missing persona file
// degrades to "no specialist section" instead of breaking the cockpit's reader
// of that same file.
export const TASK_CLASS_SPECIALISTS = Object.freeze({
  "frontend-design": ["design-ui-designer", "design-ux-architect", "design-ui-finish-gate-reviewer"],
  "backend-api": ["engineering-backend-architect", "engineering-api-platform-engineer"],
  "database-storage": ["engineering-database-optimizer", "engineering-database-reliability-engineer"],
  "agent-dispatch": ["engineering-multi-agent-systems-architect", "agents-orchestrator"],
  "repo-analysis": ["specialized-codebase-archaeologist", "engineering-codebase-onboarding-engineer"],
  "cleanup-archive": ["engineering-minimal-change-engineer", "specialized-codebase-archaeologist"],
  "trading-safety": ["finance-investment-researcher", "testing-reality-checker"],
  "infra-network": ["engineering-sre", "engineering-devops-automator"],
  "owner-communication": ["specialized-chief-of-staff", "design-visual-storyteller"],
});

export async function readSkillMatrix(deps = {}) {
  const _fs = deps._fs || fs;
  try {
    const raw = await _fs.readFile(deps.matrixFile || MATRIX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Returns a taskClass slug, or null when nothing matches. Null is a real answer:
// an unclassified task gets no specialist rather than a wrong one.
//
// Scores by distinct keywords matched, so a task that is mostly about one thing
// and mentions another in passing lands on the thing it is mostly about. Ties go
// to the earlier entry in TASK_CLASS_KEYWORDS, which is ordered by specificity.
export function classifyTaskClass(text) {
  const s = String(text || "").toLowerCase();
  if (!s.trim()) return null;
  let best = null;
  let bestScore = 0;
  for (const [taskClass, keywords] of TASK_CLASS_KEYWORDS) {
    const score = keywords.filter((k) => s.includes(k)).length;
    if (score > bestScore) {
      best = taskClass;
      bestScore = score;
    }
  }
  return best;
}

// Every score, not just the winner. The runner-up is worth seeing when a
// classification looks wrong, and a human debugging a bad dispatch should not
// have to re-derive it by hand.
export function scoreTaskClasses(text) {
  const s = String(text || "").toLowerCase();
  return TASK_CLASS_KEYWORDS
    .map(([taskClass, keywords]) => ({ taskClass, matched: keywords.filter((k) => s.includes(k)) }))
    .filter((r) => r.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length);
}

export async function matrixEntryFor(taskClass, deps = {}) {
  if (!taskClass) return null;
  const matrix = await readSkillMatrix(deps);
  return matrix.find((e) => e && e.taskClass === taskClass) || null;
}

// Cut on a sentence or line boundary so an excerpt never ends mid-word. A
// persona that trails off reads as a broken prompt, and a model treats it as one.
function truncateCleanly(text, budget) {
  const s = String(text || "").trim();
  if (s.length <= budget) return s;
  const cut = s.slice(0, budget);
  const stop = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return (stop > budget * 0.5 ? cut.slice(0, stop + 1) : cut).trim();
}

function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// The operationally binding half of a persona is its rules section, not its
// mission prose. Prefer the rules; fall back to the mission only when a persona
// has no rules heading at all.
function extractRules(raw) {
  const sections = String(raw || "").split(/\r?\n(?=##\s)/);
  const head = (s) => s.split(/\r?\n/)[0] || "";
  const rules = sections.find((s) => /critical rules|rules you must|non-negotiable/i.test(head(s)));
  if (rules) return rules;
  const mission = sections.find((s) => /core mission|your mission/i.test(head(s)));
  return mission || "";
}

export async function loadSpecialist(slug, deps = {}) {
  const _fs = deps._fs || fs;
  const budget = deps.budget || DEFAULT_PERSONA_BUDGET;
  try {
    const raw = await _fs.readFile(path.join(deps.dir || SPECIALIST_DIR, `${slug}.md`), "utf8");
    const fm = parseFrontmatter(raw);
    return {
      slug,
      name: fm.name || slug,
      description: fm.description || "",
      rules: truncateCleanly(extractRules(raw), budget),
    };
  } catch {
    return null;
  }
}

// The string that goes into a dispatch packet. Empty string when there is no
// classification and no specialist — an empty section is correct, a guessed one
// is not.
export async function buildSpecialistSection(taskClass, deps = {}) {
  const max = deps.max || DEFAULT_MAX_SPECIALISTS;
  const slugs = (TASK_CLASS_SPECIALISTS[taskClass] || []).slice(0, max);
  const loaded = (await Promise.all(slugs.map((s) => loadSpecialist(s, deps)))).filter(Boolean);
  if (!loaded.length) return "";
  const parts = [`SPECIALIST VOICE (taskClass: ${taskClass}) — judge this work the way these roles would:`];
  for (const p of loaded) {
    parts.push("", `## ${p.name}`);
    if (p.description) parts.push(p.description);
    if (p.rules) parts.push(p.rules);
  }
  return parts.join("\n");
}

// One call for a packet builder: classify the task, pull its matrix entry, and
// render the specialist section. hardStops and requiredStandards come back
// separately because they are constraints, not voice — a caller must render them
// as hard limits, never as flavour. preferredMaker is a SUGGESTION only: lane
// availability and lane fitness (ops-watcher/routing.mjs) still decide who runs,
// because a preferred lane that is quota-blocked is not a lane.
export async function resolveSpecialistsForPacket(taskText, deps = {}) {
  const taskClass = deps.taskClass || classifyTaskClass(taskText);
  const entry = await matrixEntryFor(taskClass, deps);
  const section = await buildSpecialistSection(taskClass, deps);
  const max = deps.max || DEFAULT_MAX_SPECIALISTS;
  return {
    taskClass,
    specialists: (TASK_CLASS_SPECIALISTS[taskClass] || []).slice(0, max),
    section,
    hardStops: (entry && entry.hardStops) || [],
    requiredStandards: (entry && entry.requiredStandards) || [],
    requiredSkills: (entry && entry.requiredSkills) || [],
    compactContextRule: (entry && entry.compactContextRule) || null,
    preferredMaker: (entry && entry.preferredMaker) || null,
    preferredReviewer: (entry && entry.preferredReviewer) || null,
  };
}
