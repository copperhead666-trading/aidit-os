// ops-watcher/ventures.mjs
//
// Reads the venture registry for ops-side code.
//
// config/skill-matrix.json spent weeks as display-only config: the cockpit read
// it, but the ops loop did not. This file is the small reader that keeps
// config/ventures.json from becoming the same kind of inert documentation. A
// directory under ventures/ is not consent to work; only this registry and its
// status field are.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
export const VENTURES_FILE = path.join(REPO_ROOT, "config", "ventures.json");

export async function readVentures(deps = {}) {
  const _fs = deps._fs || fs;
  try {
    const raw = await _fs.readFile(deps.file || VENTURES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Array.isArray(parsed.ventures) ? parsed.ventures.filter((v) => v && typeof v === "object") : [];
  } catch {
    return [];
  }
}

export async function activeVentures(deps = {}) {
  const ventures = await readVentures(deps);
  return ventures.filter((venture) => venture.status === "active");
}

export async function ventureById(id, deps = {}) {
  const ventures = await readVentures(deps);
  return ventures.find((venture) => venture.id === id) || null;
}

export async function ventureForPath(repoRelPath, deps = {}) {
  const wanted = normalizeRepoPath(repoRelPath);
  if (!wanted) return null;
  const ventures = await readVentures(deps);
  return ventures.find((venture) => {
    const base = normalizeRepoPath(venture.repoPath);
    return base && (wanted === base || wanted.startsWith(`${base}/`));
  }) || null;
}

export async function hardStopsFor(id, deps = {}) {
  const venture = await ventureById(id, deps);
  return Array.isArray(venture?.hardStops) ? venture.hardStops : [];
}

export async function ownerDecisionRequiredFor(id, deps = {}) {
  const venture = await ventureById(id, deps);
  return Array.isArray(venture?.owner_decision_required) ? venture.owner_decision_required : [];
}

export function hasStatedMetric(venture) {
  const metric = venture?.metrik;
  return typeof metric === "string" && metric.trim().length > 0;
}

function normalizeRepoPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/g, "")
    .trim();
}
