// ops-watcher/graphify-analyst.mjs
// ON-DEMAND query wrapper for the GRAPHIFY-ANALYST Bennett-roster role
// ("structural/multi-hop code questions over existing graphs; refresh only
// when stale", trigger "structural question dispatch", review "AHMAD
// spot-check", default_lane "L3 Kimi K3" — SJAHRIR's lane). Unlike the other
// Bennett roles wired in this session (ESCALATION-SEC/GBRAIN-CURATOR/
// AUDIT-CLERK, which are periodic heartbeat sweeps), this one is an ON-DEMAND
// query tool: headless AHMAD invokes it via run_command when it needs a
// structural code-relationship answer beyond what plain file reading gives it,
// the same way it can already invoke HATTA/SJAHRIR/CORLEONE/HATTA-FLASH for
// implementation work.
//
// SCOPE: this is a QUERY wrapper only. It does NOT regenerate the graph (that
// is a separate, out-of-scope capability). Instead it DETECTS staleness and
// discloses it honestly in its answer (tells the caller the graph may be
// outdated and by how much), never silently answering as if the graph were
// current.
//
//   node ops-watcher/graphify-analyst.mjs "<structural question>"

import { spawnSync } from "node:child_process";
import { promises as fs, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logLaneUsage } from "./lane-usage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// DELIBERATE DUPLICATE of GRAPHIFY_ACTIVE in
// ops-watcher/ahmad-context-retrieval.mjs (same path: graphify-out/active/
// graph.json). We do NOT import it from ahmad-context-retrieval.mjs because
// importing that module would pull in its own heavy dependencies (gbrain
// spawn, full context-retrieval pipeline) into this thin query wrapper's
// simpler footprint. This mirrors the EXACT SAME already-documented
// "deliberate duplicate, avoid cross-file coupling" convention this codebase
// already uses for STUCK_THRESHOLD_MIN between watcher.mjs and
// ahmad-dispatch.mjs.
const GRAPHIFY_ACTIVE = path.join(REPO_ROOT, "graphify-out", "active", "graph.json");

const TIMEOUT_MS = 8 * 60 * 1000; // 480000ms, under ahmad-mcp-server.mjs's 9-min RUN_TIMEOUT_MS cap
const STALENESS_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const GRAPH_EXCERPT_SIZE_LIMIT = 100 * 1024; // 100KB — excerpt rather than dump full graph if larger

/**
 * Pure staleness computation. Returns an object describing whether the graph
 * is stale relative to the newest source file.
 *
 * @param {number} graphMtimeMs    - mtime of graph.json in epoch ms.
 * @param {number} newestSourceMtimeMs - mtime of the newest ops-watcher/*.mjs in epoch ms.
 * @returns {{stale: boolean, ageMs: number, thresholdMs: number}} staleness info.
 */
export function computeStaleness(graphMtimeMs, newestSourceMtimeMs) {
  if (!Number.isFinite(graphMtimeMs) || !Number.isFinite(newestSourceMtimeMs)) {
    return { stale: false, ageMs: NaN, thresholdMs: STALENESS_THRESHOLD_MS };
  }
  const ageMs = newestSourceMtimeMs - graphMtimeMs;
  return {
    stale: ageMs > STALENESS_THRESHOLD_MS,
    ageMs,
    thresholdMs: STALENESS_THRESHOLD_MS,
  };
}

/**
 * Pure prompt builder. Assembles the GRAPHIFY-ANALYST prompt for Kimi from the
 * question, graph content, and an optional staleness note.
 *
 * @param {string} question      - the structural question to answer.
 * @param {string} graphContent  - the graph JSON (or excerpt) as a string.
 * @param {string|null} [stalenessNote] - optional staleness disclosure paragraph, or null.
 * @returns {string} the full prompt string for `kimi -p`.
 */
export function buildPrompt(question, graphContent, stalenessNote) {
  const disclosure = stalenessNote
    ? `NOTE: this graph was last built on ${stalenessNote} and may not reflect files changed more recently — treat file-existence/structure claims about anything newer than that date with appropriate caution.`
    : "";
  return [
    `You are GRAPHIFY-ANALYST, answering structural/multi-hop code-relationship questions using an existing code graph for the FounderOS-Aidit repository.`,
    disclosure,
    `Given this graph data: ${graphContent}`,
    `answer the following question as accurately as possible based on the graph structure (nodes, source_file/source_location, community groupings): ${question}`,
    `If the graph does not contain enough information to answer confidently, say so explicitly rather than guessing.`,
  ].filter(Boolean).join(" ");
}

/**
 * Read the graph.json file. If it exceeds GRAPH_EXCERPT_SIZE_LIMIT, summarize
 * by community_name grouping rather than dumping every node.
 *
 * @param {string} filePath - absolute path to graph.json.
 * @param {typeof import("node:fs").promises.readFile} [_readFile] - injectable for tests.
 * @returns {Promise<string>} the graph content (full or excerpted) as a string.
 */
export async function readGraphContent(filePath, _readFile) {
  const readFileFn = _readFile || fs.readFile;
  const raw = await readFileFn(filePath, "utf8");
  if (raw.length <= GRAPH_EXCERPT_SIZE_LIMIT) return raw;

  // Excerpt: group nodes by community_name, list node count + sample labels
  // per community rather than dumping every node's full JSON.
  let graph;
  try {
    graph = JSON.parse(raw);
  } catch {
    // If the graph is unparseable, return a truncated raw excerpt so the
    // caller at least gets something rather than nothing.
    return raw.slice(0, GRAPH_EXCERPT_SIZE_LIMIT) + "\n...[graph parse failed, truncated raw excerpt]";
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const byCommunity = new Map();
  for (const node of nodes) {
    const cn = node.community_name || "(unknown)";
    if (!byCommunity.has(cn)) byCommunity.set(cn, []);
    byCommunity.get(cn).push(node);
  }
  const lines = [
    `{`,
    `  "excerpted": true,`,
    `  "node_count": ${nodes.length},`,
    `  "communities": {`,
  ];
  let first = true;
  for (const [cn, group] of byCommunity) {
    if (!first) lines.push(",");
    first = false;
    const sampleLabels = group.slice(0, 5).map((n) => n.label || n.id).join("; ");
    lines.push(`    ${JSON.stringify(cn)}: { "count": ${group.length}, "sample": ${JSON.stringify(sampleLabels)} }`);
  }
  lines.push(`  }`);
  lines.push(`}`);
  return lines.join("\n");
}

/**
 * Find the newest mtime among ops-watcher/*.mjs files (non-recursive).
 * Returns 0 if no .mjs files are found.
 *
 * @param {string} dirPath - absolute path to ops-watcher/.
 * @returns {number} epoch ms of the most recently modified .mjs file.
 */
export function findNewestSourceMtime(dirPath) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dirPath);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".mjs")) continue;
    try {
      const st = statSync(path.join(dirPath, entry));
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      // skip unreadable entries
    }
  }
  return newest;
}

async function main() {
  const question = process.argv[2];
  if (typeof question !== "string" || question.length === 0) {
    process.stderr.write('usage: node ops-watcher/graphify-analyst.mjs "<structural question>"\n');
    process.exit(2);
  }

  // Step 2: Stat the graph file; if missing, clear error and exit 1.
  let graphStat;
  try {
    graphStat = statSync(GRAPHIFY_ACTIVE);
  } catch {
    process.stderr.write(`graphify-analyst: graph file not found at ${GRAPHIFY_ACTIVE} — cannot answer structural questions without a graph.\n`);
    process.exit(1);
  }

  // Step 3: Compute staleness — compare graph mtime against the newest
  // ops-watcher/*.mjs file's mtime.
  const newestSourceMtime = findNewestSourceMtime(__dirname);
  const staleness = computeStaleness(graphStat.mtimeMs, newestSourceMtime);

  let stalenessNote = null;
  if (staleness.stale) {
    const graphDate = new Date(graphStat.mtimeMs).toISOString();
    stalenessNote = graphDate;
  }

  // Step 4: Read the graph content (full or excerpted).
  const graphContent = await readGraphContent(GRAPHIFY_ACTIVE);

  // Step 5: Build prompt and spawn kimi (SJAHRIR's lane).
  const prompt = buildPrompt(question, graphContent, stalenessNote);

  // `kimi` resolves to a native kimi.exe on this machine, so we spawn it
  // directly with shell:false (the safe default) — same reasoning as
  // sjahrir-dispatch.mjs. shell:false passes the args array VERBATIM via
  // CreateProcess — no cmd.exe parsing — so a free-form prompt containing
  // spaces / quotes / % / & is preserved exactly.
  const t0 = Date.now();
  const r = spawnSync("kimi", ["-p", prompt], {
    cwd: REPO_ROOT,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Date.now() - t0;

  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);

  if (r.signal === "SIGTERM" && r.status === null) {
    // spawnSync sets status=null + signal="SIGTERM" on timeout kill.
    process.stderr.write(`graphify-analyst: kimi timed out after ${TIMEOUT_MS}ms\n`);
    await logLaneUsage({ lane: "graphify-analyst", promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
    process.exit(1);
  }
  if (r.error) {
    process.stderr.write(`graphify-analyst: failed to spawn kimi: ${r.error && r.error.message ? r.error.message : r.error}\n`);
    await logLaneUsage({ lane: "graphify-analyst", promptLength: prompt.length, ok: false, exitCode: 1, durationMs });
    process.exit(1);
  }
  const exitCode = typeof r.status === "number" ? r.status : 1;
  await logLaneUsage({ lane: "graphify-analyst", promptLength: prompt.length, ok: exitCode === 0, exitCode, durationMs });
  process.exit(exitCode);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) main();