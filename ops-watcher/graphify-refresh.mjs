// ops-watcher/graphify-refresh.mjs
//
// Keeps the code graph from becoming a fossil.
//
// WHY. ops-watcher/graphify-analyst.mjs has worked for weeks and has been
// honest the whole time: it declares the graph stale past one hour rather than
// answering as if it were current. What was missing was anything that made it
// fresh. On 2026-09-04 graphify-out/active/graph.json was dated 28 August —
// 265 nodes, 808 links, and none of the modules written since. Every structural
// question for a week came back with "the graph may be out of date". Honest,
// and useless.
//
// The first real regeneration produced 8,926 nodes and 16,695 links, and it
// contains reconcile.mjs, specialists.mjs, decision-brief.mjs,
// raise-decision.mjs and soekarno-dispatch.mjs. The old file was a fossil, not
// a smaller view.
//
// WHY NOT EVERY SWEEP. The heartbeat runs every five minutes. A full re-extract
// is minutes of CPU on a machine that also runs the board, the cockpit and the
// lanes. So a refresh needs BOTH conditions: enough time has passed, AND the
// repo actually changed since the last one. Nothing changed means nothing to
// rebuild — the graph is not stale, it is simply still correct.
//
// WHY THE FILE MOVES. `graphify update` writes graphify-out/graph.json;
// graphify-analyst reads graphify-out/active/graph.json — active/ and legacy/
// are two corpora kept side by side. So the fresh graph is PROMOTED into
// active/ by writing beside it and renaming. A half-written graph is worse than
// a stale one: the analyst would answer confidently from a truncated file.

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const BUILT_GRAPH = path.join(REPO_ROOT, "graphify-out", "graph.json");
export const ACTIVE_GRAPH = path.join(REPO_ROOT, "graphify-out", "active", "graph.json");
export const STATE_FILE = path.join(__dirname, "graphify-refresh-state.json");

// Six hours, not one. The analyst's one-hour threshold is the right point to
// START DISCLOSING staleness to a reader; it is the wrong point to start
// spending minutes of CPU. Disclosure is cheap, rebuilding is not.
export const MIN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

// A build that overruns this is wedged, not slow.
export const BUILD_TIMEOUT_MS = 20 * 60 * 1000;

function nowMs(now) {
  return typeof now === "function" ? now() : (now || Date.now());
}

async function readJson(file, _fs) {
  try {
    return JSON.parse(await _fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * What the repo looks like right now, in one string. HEAD alone is not enough:
 * most of a working session is uncommitted, and a graph that only refreshes on
 * commit would be stale for exactly the hours it is most needed.
 */
export function repoFingerprint(deps = {}) {
  const _spawn = deps.spawnSync || spawnSync;
  const run = (args) => {
    const r = _spawn("git", args, { cwd: REPO_ROOT, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000 });
    return r && typeof r.stdout === "string" ? r.stdout.trim() : "";
  };
  const head = run(["rev-parse", "HEAD"]);
  // Names only, not contents: this answers "did the working tree move", and a
  // content hash of a gigabyte of repo would cost more than the question.
  const dirty = run(["status", "--porcelain"]);
  return `${head}:${dirty.length}:${dirty.split("\n").length}`;
}

/**
 * Decide, without doing anything. Returns { refresh, reason }.
 */
export async function shouldRefresh(deps = {}) {
  const _fs = deps._fs || fs;
  const at = nowMs(deps.now);
  const activeGraph = deps.activeGraph || ACTIVE_GRAPH;

  let stat = null;
  try {
    stat = await _fs.stat(activeGraph);
  } catch {
    return { refresh: true, reason: "no graph on disk" };
  }

  const state = (await readJson(deps.stateFile || STATE_FILE, _fs)) || {};
  const ageMs = at - stat.mtimeMs;
  if (ageMs < (deps.minIntervalMs || MIN_REFRESH_INTERVAL_MS)) {
    return { refresh: false, reason: `graph is ${Math.round(ageMs / 60000)} min old, under the interval`, ageMs };
  }

  const fingerprint = deps.fingerprint || repoFingerprint(deps);
  if (state.fingerprint && state.fingerprint === fingerprint) {
    // Deliberately not "stale": an unchanged repo has an accurate graph no
    // matter how old the file is. Rebuilding it would produce the same bytes.
    return { refresh: false, reason: "repo unchanged since the last refresh", ageMs, fingerprint };
  }

  return { refresh: true, reason: `graph is ${Math.round(ageMs / 3600000)}h old and the repo moved`, ageMs, fingerprint };
}

/**
 * Rebuild and promote. Never throws; every failure is a returned reason.
 */
export async function refreshOnce(deps = {}) {
  const _fs = deps._fs || fs;
  const _spawn = deps.spawnSync || spawnSync;
  const log = deps.log || ((m) => console.log(m));
  const activeGraph = deps.activeGraph || ACTIVE_GRAPH;
  const builtGraph = deps.builtGraph || BUILT_GRAPH;
  const stateFile = deps.stateFile || STATE_FILE;

  const decision = deps.force ? { refresh: true, reason: "forced" } : await shouldRefresh(deps);
  if (!decision.refresh) {
    log(`graphify-refresh: skipped — ${decision.reason}`);
    return { ok: true, refreshed: false, reason: decision.reason };
  }

  log(`graphify-refresh: rebuilding — ${decision.reason}`);
  const started = nowMs(deps.now);

  // --no-cluster on purpose: clustering calls an LLM to name communities, and
  // this step must stay free and offline. The analyst answers structural
  // questions from nodes and links, not from community labels.
  const r = _spawn("graphify", ["update", ".", "--no-cluster"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: deps.timeoutMs || BUILD_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (r.error || (typeof r.status === "number" && r.status !== 0)) {
    const why = r.error ? (r.error.message || String(r.error)) : `exit ${r.status}`;
    log(`graphify-refresh: rebuild FAILED (${why}) — the existing graph is left untouched`);
    return { ok: false, refreshed: false, reason: `build-failed: ${why}` };
  }

  // Only promote something that parses and has content. A build can exit 0 and
  // still leave a graph worth less than the one already in place.
  const fresh = await readJson(builtGraph, _fs);
  if (!fresh || !Array.isArray(fresh.nodes) || fresh.nodes.length === 0) {
    log("graphify-refresh: the rebuilt graph is unreadable or empty — NOT promoting");
    return { ok: false, refreshed: false, reason: "rebuilt graph unusable" };
  }

  const priorNodes = (await readJson(activeGraph, _fs))?.nodes?.length ?? 0;

  // Write beside the target, then rename. A rename is the closest thing to
  // atomic here, and it is what keeps the analyst from ever reading half a file.
  const tmp = `${activeGraph}.incoming`;
  try {
    // The destination directory does not exist on a fresh clone: graphify-out/
    // is gitignored, so nothing creates graphify-out/active/ before the first
    // promotion. Without this, copyFile throws ENOENT and EVERY first promotion
    // fails after paying the full ~48s build cost, leaving the analyst with no
    // graph and nothing but a log line nobody reads.
    await _fs.mkdir(path.dirname(activeGraph), { recursive: true });
    await _fs.copyFile(builtGraph, tmp);
    await _fs.rename(tmp, activeGraph);
  } catch (err) {
    log(`graphify-refresh: promotion failed (${err && err.message ? err.message : err}) — old graph still in place`);
    try { await _fs.unlink(tmp); } catch { /* nothing to clean */ }
    return { ok: false, refreshed: false, reason: "promotion-failed" };
  }

  const fingerprint = deps.fingerprint || repoFingerprint(deps);
  try {
    await _fs.writeFile(
      stateFile,
      JSON.stringify({ fingerprint, refreshedAt: new Date(nowMs(deps.now)).toISOString(), nodes: fresh.nodes.length }, null, 2) + "\n",
      "utf8",
    );
  } catch {
    // A lost state file costs one extra rebuild, not correctness.
  }

  const durationMs = nowMs(deps.now) - started;
  log(`graphify-refresh: promoted ${fresh.nodes.length} nodes (was ${priorNodes}) in ${Math.round(durationMs / 1000)}s`);
  return { ok: true, refreshed: true, nodes: fresh.nodes.length, priorNodes, durationMs };
}

// ---- CLI ----
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--once") && !args.includes("--force")) {
    console.log("usage: node ops-watcher/graphify-refresh.mjs --once [--force]");
    process.exit(2);
  }
  const r = await refreshOnce({ force: args.includes("--force"), log: (m) => console.log(m) });
  process.exit(r.ok ? 0 : 1);
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
    console.error("graphify-refresh fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
