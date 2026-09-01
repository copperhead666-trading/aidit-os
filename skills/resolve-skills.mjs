// skills/resolve-skills.mjs
// Pure, offline, testable skill-bootstrap resolver.
//
// Reads handoffs/sjahrir/skill-index.json and, given a role + a task-kind label,
// returns the mandatory core skills for that role plus any task-specific skills
// whose triggers match the task-kind AND whose applicableRoles include the role.
//
//   import { resolveSkillsForPacket, formatSkillsSection } from "./resolve-skills.mjs";
//   const r = resolveSkillsForPacket("HATTA", "telegram-bot-integration");
//   console.log(formatSkillsSection(r));
//
// This module makes NO network calls, touches NO Paperclip/Telegram/cockpit, and
// performs NO filesystem writes. It only READS the index file (and, optionally,
// the skills/ directory listing) — that is the entire bootstrap's allowed scope
// per handoffs/sjahrir/SKILL-BOOTSTRAP-DESIGN.md Section 6.
//
// Tested by: skills/resolve-skills.regression.test.mjs
//   node skills/resolve-skills.regression.test.mjs

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// skills/ -> ../handoffs/sjahrir/skill-index.json
export const DEFAULT_INDEX_PATH = path.join(
  __dirname, "..", "handoffs", "sjahrir", "skill-index.json"
);
// The skills/ directory itself holds the per-skill *.md content files.
export const DEFAULT_SKILLS_DIR = __dirname;

// ---- IO helpers (kept tiny + injectable so tests can run fully offline) ----

export function loadSkillIndex(indexPath = DEFAULT_INDEX_PATH) {
  return JSON.parse(readFileSync(indexPath, "utf8"));
}

// Returns a Set of "<name>.md" filenames present in the skills/ directory. Used
// only by callers that want to cross-check that a referenced skill has a content
// file; the core resolver itself does NOT require this (the index is authority).
export function listSkillFiles(skillsDir = DEFAULT_SKILLS_DIR) {
  try {
    return new Set(readdirSync(skillsDir).filter((f) => f.endsWith(".md")));
  } catch {
    return new Set();
  }
}

// ---- pure matching ----

// A task-kind matches a trigger if they are equal (case-insensitive) OR the
// task-kind contains the trigger as a substring (case-insensitive). This lets a
// dispatcher pass a coarse label like "telegram-bot-integration" and still match
// the trigger token "telegram-bot", while an exact keyword like "telegram-bot"
// also matches. Whitespace is trimmed.
function triggerMatches(taskKind, triggers) {
  if (!taskKind || !Array.isArray(triggers)) return false;
  const tk = String(taskKind).toLowerCase().trim();
  if (!tk) return false;
  for (const t of triggers) {
    const tl = String(t).toLowerCase().trim();
    if (!tl) continue;
    if (tk === tl || tk.includes(tl)) return true;
  }
  return false;
}

function matchedTriggerOf(taskKind, triggers) {
  const tk = String(taskKind).toLowerCase().trim();
  for (const t of triggers || []) {
    const tl = String(t).toLowerCase().trim();
    if (tl && (tk === tl || tk.includes(tl))) return t;
  }
  return null;
}

// ---- main API ----

// resolveSkillsForPacket(role, taskKind, options?) -> { core, taskSpecific }
//
//   core          : array of { name, description } for the role's mandatory core
//                  skills (shallow-copied so callers can't mutate the index).
//                  [] when the role is unknown — never throws.
//   taskSpecific  : array of matching task-specific entries (name, description,
//                  triggers, applicableRoles, matchedTrigger) — only those whose
//                  triggers match taskKind AND whose applicableRoles include role.
//
// options.index      : an in-memory index object (tests). Defaults to loadSkillIndex().
// options.indexPath  : override the on-disk index path.
export function resolveSkillsForPacket(role, taskKind, options = {}) {
  const index = options.index ?? loadSkillIndex(options.indexPath ?? DEFAULT_INDEX_PATH);
  const mandatoryCore = (index && index.mandatoryCore) ? index.mandatoryCore : {};
  const taskSpecific = (index && Array.isArray(index.taskSpecific)) ? index.taskSpecific : [];

  const core = Array.isArray(mandatoryCore[role])
    ? mandatoryCore[role].map((s) => ({ name: s.name, description: s.description }))
    : [];

  const taskSpecificMatched = taskSpecific
    .filter((entry) =>
      triggerMatches(taskKind, entry.triggers) &&
      Array.isArray(entry.applicableRoles) &&
      entry.applicableRoles.includes(role)
    )
    .map((entry) => ({
      name: entry.name,
      description: entry.description,
      triggers: Array.isArray(entry.triggers) ? entry.triggers.slice() : [],
      applicableRoles: Array.isArray(entry.applicableRoles) ? entry.applicableRoles.slice() : [],
      matchedTrigger: matchedTriggerOf(taskKind, entry.triggers),
    }));

  return { core, taskSpecific: taskSpecificMatched };
}

// formatSkillsSection(resolved) -> string
// Renders the "### Loaded skills" block documented in SKILL-BOOTSTRAP-DESIGN.md
// Section 5, ready to paste into a task packet.
export function formatSkillsSection(resolved) {
  const core = (resolved && Array.isArray(resolved.core)) ? resolved.core : [];
  const taskSpecific = (resolved && Array.isArray(resolved.taskSpecific)) ? resolved.taskSpecific : [];
  const lines = [];
  lines.push("### Loaded skills");
  lines.push("");
  lines.push("Core (always active for this role):");
  if (core.length === 0) {
    lines.push("- (no mandatory core skills for this role)");
  } else {
    for (const s of core) lines.push(`- ${s.name}: ${s.description}`);
  }
  lines.push("");
  lines.push("Task-specific (available if needed — load if the task touches the trigger area):");
  if (taskSpecific.length === 0) {
    lines.push("- (none matched for this task)");
  } else {
    for (const s of taskSpecific) {
      lines.push(`- ${s.name}: ${s.description} — trigger: ${s.matchedTrigger}`);
    }
  }
  return lines.join("\n");
}

// Optional helper: confirm every skill referenced by the resolved set has a
// content file in skills/. Returns { missingCore: [], missingTaskSpecific: [] }.
// Not required by the bootstrap contract; provided for dispatcher self-checks.
export function verifySkillFilesExist(resolved, skillsDir = DEFAULT_SKILLS_DIR) {
  const files = listSkillFiles(skillsDir);
  const missingCore = resolved.core
    .map((s) => s.name)
    .filter((name) => !files.has(`${name}.md`));
  const missingTaskSpecific = resolved.taskSpecific
    .map((s) => s.name)
    .filter((name) => !files.has(`${name}.md`));
  return { missingCore, missingTaskSpecific };
}