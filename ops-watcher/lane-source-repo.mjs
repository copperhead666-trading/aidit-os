// ops-watcher/lane-source-repo.mjs
// Decides whether a lane should be cut from Aidit OS or from a registered
// venture repository. The prompt supplies only the venture id; the registry is
// the authority for whether that id may be used and where it lives.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ventureById } from "./ventures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

function insideRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function statIsDirectory(stat) {
  return stat && typeof stat.isDirectory === "function" && stat.isDirectory();
}

function statIsGitEntry(stat) {
  return stat && (
    (typeof stat.isDirectory === "function" && stat.isDirectory()) ||
    (typeof stat.isFile === "function" && stat.isFile())
  );
}

async function repositoryExists(repoPath, _fs) {
  try {
    if (!statIsDirectory(await _fs.stat(repoPath))) return false;
    return statIsGitEntry(await _fs.stat(path.join(repoPath, ".git")));
  } catch {
    return false;
  }
}

export function ventureIdFromPrompt(prompt) {
  try {
    if (typeof prompt !== "string" || prompt.length === 0) return null;
    for (const line of prompt.split(/\r?\n/)) {
      const match = line.match(/^\s*VENTURE_ID:\s*(.*?)\s*$/);
      if (!match) continue;
      const id = match[1].trim();
      return id.length > 0 ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function sourceRepoForPrompt(prompt, deps = {}) {
  const ventureId = ventureIdFromPrompt(prompt);
  if (!ventureId) return { sourceRepo: null, ventureId: null, reason: "not venture work" };

  const _ventureById = deps.ventureById || ventureById;
  const _fs = deps._fs || fs;
  const repoRoot = path.resolve(deps.repoRoot || REPO_ROOT);

  let venture;
  try {
    venture = await _ventureById(ventureId, deps.ventureDeps || deps);
  } catch {
    return { sourceRepo: null, ventureId, reason: `venture ${ventureId} could not be read from the registry` };
  }

  if (!venture) return { sourceRepo: null, ventureId, reason: `unknown venture ${ventureId}` };
  if (venture.status !== "active") return { sourceRepo: null, ventureId, reason: `venture ${ventureId} is not active` };

  const repoPath = typeof venture.repoPath === "string" ? venture.repoPath.trim() : "";
  const sourceRepo = path.resolve(repoRoot, repoPath);
  if (!repoPath || !insideRoot(repoRoot, sourceRepo)) {
    return { sourceRepo: null, ventureId, reason: `venture ${ventureId} repository is missing` };
  }
  if (!await repositoryExists(sourceRepo, _fs)) {
    return { sourceRepo: null, ventureId, reason: `venture ${ventureId} repository is missing` };
  }

  return { sourceRepo, ventureId, reason: `venture ${ventureId} repository selected` };
}
