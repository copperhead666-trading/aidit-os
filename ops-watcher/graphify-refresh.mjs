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
//
// WHY THE STAMP IS TAKEN BEFORE THE BUILD. Measured 2026-09-04: a full rebuild
// of this repo takes ~87 seconds, and commits during a working session land
// closer together than that (c1bb281 at 21:26:41, f22349d at 21:28:21 — 100s
// apart). The stamp used to be read AFTER the build finished, so a commit that
// landed while graphify was running got stamped onto a graph extracted before
// it. The stale-graph guard compares stamp against HEAD, so that graph then
// passed as FRESH while every line number in it had moved:
//
//     symbol                        graph   actual   off by
//     buildExecutionPrompt()        L1716   L1858     +142
//     graphFreshnessForAnchors()    L1610   L1693      +83
//     activeGraphAnchorsForFiles()  L1641   L1724      +83
//
// Stamping the commit the build STARTED at makes that case fail closed: the
// stamp names a commit older than HEAD, the existing refusal fires, and no
// anchors are emitted until the next rebuild catches up.
//
// The graphify cache was the other suspect and was RULED OUT by measurement: a
// full re-extract at f22349d re-indexed all 272 files and produced correct line
// numbers (L1858 / L1693 / L1724). The extractor is honest; the stamp was not.
//
// WHY A CONTENT CHECK TOO. A stamp is a claim about the graph. It cannot be
// checked against the graph's contents, so any future path that stamps at the
// wrong moment reproduces the same silent failure. verifyGraphContent turns the
// claim into evidence by reading the tree the graph is describing.

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_STAMP_SUFFIX } from "./venture-planner.mjs";

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

// How many symbols the content check reads back out of the working tree.
export const CONTENT_CHECK_SAMPLE = 10;

/**
 * Candidates for the content check: the DEEPEST located symbol in each file,
 * then the deepest of those across files.
 *
 * The depth is the whole point. A symbol near line 1 is stable no matter how
 * stale the graph is — imports and top-level constants do not move — so a
 * sample drawn from the head of files certifies a fossil. Measured on the two
 * graphs sitting on this machine, a 40-symbol sample taken that way scored
 * 40/40 on BOTH the stale graph and the fresh one: no discrimination at all.
 * The deepest symbol per file carries every insertion made above it, and the
 * same measurement on that sample scored 10/10 fresh against 8/10 stale.
 */
/**
 * Is this label the NAME OF A SYMBOL, or is it prose?
 *
 * A label with a separator, a dot or a space is a file, a member expression, or
 * a docstring — graphify emits nodes whose label IS the docstring text, and
 * those never appear verbatim on the line they are attributed to.
 *
 * Measured on the caveman-trading-os graph (Python, 3,372 located symbols):
 *   identifier-shaped labels   300/300 found on the exact line
 *   prose/docstring labels      90/300
 *
 * Exported because the SAME question is asked in two places: the content check
 * that decides what to sample, and directive-runner's anchor emission that
 * decides what a lane is pointed at. They were answered differently, so
 * "Return DASHBOARD_SECRET. Raises at start @ L23" was refused as a sample and
 * emitted as an anchor.
 */
export function isIdentifierShapedLabel(label) {
  const name = String(label == null ? "" : label).trim().replace(/\(\)$/, "");
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

export function contentCheckCandidates(graph, limit = CONTENT_CHECK_SAMPLE) {
  const perFile = new Map();
  for (const node of graph?.nodes || []) {
    const file = node?.source_file;
    if (!file || typeof file !== "string") continue;
    const matched = /(\d+)/.exec(String(node.source_location || ""));
    if (!matched) continue;
    // Only IDENTIFIER-shaped labels — see isIdentifierShapedLabel above.
    // Sampling a docstring label would refuse every fresh venture graph. This
    // repository has no Python, so the distinction only surfaced once a graph
    // was built over a venture.
    const label = String(node.label || "").replace(/\(\)$/, "");
    if (!isIdentifierShapedLabel(label)) continue;
    const line = Number(matched[1]);
    if (!Number.isInteger(line) || line < 1) continue;
    const current = perFile.get(file);
    if (!current || line > current.line) perFile.set(file, { file, line, label });
  }
  return [...perFile.values()]
    .sort((a, b) => b.line - a.line || a.file.localeCompare(b.file))
    .slice(0, limit);
}

// Real and in-memory paths both work with a plain "/" join: Windows Node
// accepts mixed separators, so "D:\repo" + "/ops-watcher/x.mjs" resolves, and
// the tests' "mem:" roots stay intact instead of being mangled by path.join.
function joinRepoPath(root, rel) {
  return String(root).endsWith("/") ? `${root}${rel}` : `${root}/${rel}`;
}

/**
 * Read the working tree back and confirm the graph describes it.
 *
 * A stamp is a claim; this is evidence. Every sampled symbol must be found on
 * the line the graph puts it on. A symbol whose name appears nowhere in its
 * file is SKIPPED rather than counted against the graph — that is an extractor
 * limitation, not drift — but a symbol that exists at a different line, or
 * beyond the end of the file, is exactly the drift this check is for.
 *
 * Returns { verified, checked, skipped, mismatches, reason }. Never throws.
 */
export async function verifyGraphContent(graph, deps = {}) {
  const _fs = deps._fs || fs;
  const sourceRoot = deps.sourceRoot || REPO_ROOT;
  const candidates = contentCheckCandidates(graph, deps.contentSample || CONTENT_CHECK_SAMPLE);

  const mismatches = [];
  let checked = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    let lines;
    try {
      lines = String(await _fs.readFile(joinRepoPath(sourceRoot, candidate.file), "utf8")).split("\n");
    } catch {
      skipped += 1; // The file is gone; that is the planner's problem, not the graph's.
      continue;
    }
    if (!lines.some((line) => line.includes(candidate.label))) {
      skipped += 1;
      continue;
    }
    checked += 1;
    if (candidate.line > lines.length) {
      mismatches.push(`${candidate.file}:${candidate.line} ${candidate.label} (file has ${lines.length} lines)`);
      continue;
    }
    if (!lines[candidate.line - 1].includes(candidate.label)) {
      mismatches.push(`${candidate.file}:${candidate.line} ${candidate.label}`);
    }
  }

  if (checked === 0) {
    // No evidence is not evidence of freshness. Refusing to certify costs the
    // planner one more refusal; certifying on nothing costs a wrong edit.
    return { verified: false, checked: 0, skipped, mismatches, reason: "no locatable symbols to check" };
  }
  if (mismatches.length) {
    return {
      verified: false,
      checked,
      skipped,
      mismatches,
      reason: `${mismatches.length}/${checked} sampled symbols are not where the graph says`,
    };
  }
  return { verified: true, checked, skipped, mismatches, reason: `${checked} sampled symbols confirmed in the tree` };
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

  // BEFORE the build, not after. The build takes ~87s on this repo and commits
  // land closer together than that; a fingerprint read after it names a commit
  // the graph never saw. Reading it here means a build that raced a commit
  // stamps the OLDER commit, HEAD disagrees, and the guard refuses — which is
  // what it was built to do. Reading it after meant the guard certified a graph
  // whose line numbers had all moved.
  //
  // The same pre-build value goes into the state file. Recording the post-build
  // fingerprint would make the next sweep say "repo unchanged since the last
  // refresh" and never rebuild, leaving the mismatch in place until something
  // else happened to move the tree.
  const fingerprint = deps.fingerprint || repoFingerprint(deps);

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

  // Promote first, stamp second — the order is the correctness argument.
  // venture-planner.mjs refuses to propose whenever the stamp beside the
  // active graph disagrees with `git rev-parse HEAD` (or is missing), so a
  // stamp written BEFORE the rename above succeeded would certify a graph
  // that is not there and wedge the planner harder than no stamp at all.
  // The fingerprint carries "<commit>:<dirty-marker>"; the planner compares
  // against plain HEAD, so only the commit goes in the stamp.
  const stampFile = activeGraph + GRAPH_STAMP_SUFFIX;
  const stampedCommit = String(fingerprint).split(":")[0];

  // Evidence before the claim. If the promoted graph does not describe the tree
  // it is supposed to describe, the stamp is REMOVED rather than merely skipped:
  // a stamp left over from an earlier run would certify this new graph, which is
  // the same silent failure with an older date on it.
  const verify = deps.verifyContent || verifyGraphContent;
  const content = await verify(fresh, { ...deps, _fs });
  if (!content.verified) {
    log(`graphify-refresh: promoted graph FAILED the content check — ${content.reason}`);
    for (const miss of (content.mismatches || []).slice(0, 5)) log(`graphify-refresh:   ${miss}`);
    log("graphify-refresh: removing the commit stamp — nothing may treat this graph as fresh");
    try { await _fs.unlink(stampFile); } catch { /* nothing to remove */ }
    // The state file is deliberately NOT written: leaving the old fingerprint in
    // place is what makes the next eligible sweep try again.
    return { ok: false, refreshed: false, reason: `content-check-failed: ${content.reason}`, mismatches: content.mismatches };
  }

  try {
    await _fs.writeFile(stampFile, stampedCommit, "utf8");
  } catch (err) {
    // Non-fatal on purpose: the graph is already promoted and correct. A
    // missing stamp costs the planner one more refusal, never a wrong answer.
    log(`graphify-refresh: stamp write failed (${err && err.message ? err.message : err}) — graph promoted without a commit stamp`);
  }

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
  log(`graphify-refresh: stamped ${stampedCommit} — ${content.reason}`);
  return {
    ok: true,
    refreshed: true,
    nodes: fresh.nodes.length,
    priorNodes,
    durationMs,
    stampedCommit,
    contentChecked: content.checked,
  };
}

// ===========================================================================
// N5. A GRAPH PER VENTURE, STAMPED WITH THE VENTURE'S OWN COMMIT.
//
// The two repositories move independently, and that is the whole design.
// Stamping a venture graph with the Aidit OS commit would be wrong in both
// directions at once: an Aidit OS commit would invalidate a venture graph that
// is still perfectly correct, and a venture commit would fail to invalidate one
// that has gone wrong. The second half is precisely the "fresh stamp, stale
// content" failure this file was rewritten for hours earlier.
//
// WHERE THE BUILD LANDS. `graphify update <path>` writes graphify-out/ beside
// the target root and ignores the working directory — measured, not assumed.
// So the build necessarily touches the venture repository. graphify-out/ is
// gitignored there (checked), and the copy Aidit OS actually reads is promoted
// into this repository at graphify-out/ventures/<id>/graph.json, so nothing
// here depends on a file inside a business repo staying put.
// ===========================================================================

export const VENTURE_GRAPH_ROOT = path.join(REPO_ROOT, "graphify-out", "ventures");

export function ventureGraphPath(id) {
  return path.join(VENTURE_GRAPH_ROOT, String(id), "graph.json");
}

export function ventureGraphStampPath(id) {
  return ventureGraphPath(id) + GRAPH_STAMP_SUFFIX;
}

function gitIn(dir, args, deps = {}) {
  const _spawn = deps.spawnSync || spawnSync;
  const r = _spawn("git", ["-C", dir, ...args], {
    encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (!r || r.status !== 0 || typeof r.stdout !== "string") return null;
  return r.stdout;
}

/**
 * The venture's commit, and whether its tree is clean.
 *
 * A DIRTY venture cannot produce a trustworthy graph: line numbers in an
 * uncommitted file are guaranteed by nothing, and the stamp names a commit that
 * does not describe what is actually on disk. Returns
 * { head, dirty, dirtyFiles } or null when git cannot answer.
 */
export function ventureCommitState(venturePath, deps = {}) {
  const head = gitIn(venturePath, ["rev-parse", "HEAD"], deps);
  if (head === null) return null;
  const status = gitIn(venturePath, ["status", "--porcelain"], deps);
  if (status === null) return null;
  const dirtyFiles = status.split(/\r?\n/).filter((l) => l.trim()).length;
  return { head: head.trim(), dirty: dirtyFiles > 0, dirtyFiles };
}

/**
 * Build and promote one venture's graph. Never throws.
 */
export async function refreshVentureGraph(venture, deps = {}) {
  const _fs = deps._fs || fs;
  const _spawn = deps.spawnSync || spawnSync;
  const log = deps.log || ((m) => console.log(m));
  const id = String(venture?.id || "");
  if (!id || !venture?.repoPath) return { ok: false, refreshed: false, reason: "venture has no id or repoPath" };

  const venturePath = deps.venturePath || path.join(REPO_ROOT, String(venture.repoPath));
  const target = deps.ventureGraph || ventureGraphPath(id);

  // Read the commit BEFORE the build, for the same reason the Aidit OS graph
  // does: a commit landing during the build must stamp the older commit and
  // fail closed, never the newer one.
  const commitState = (deps.ventureCommitState || ventureCommitState)(venturePath, deps);
  if (!commitState) {
    log(`graphify-refresh: ${id} — cannot read the venture's git state, not building`);
    return { ok: false, refreshed: false, reason: "venture-git-unreadable" };
  }
  if (commitState.dirty) {
    // Refuse loudly and REMOVE any stamp: a graph promoted from a dirty tree
    // would carry line numbers nothing guarantees.
    log(`graphify-refresh: ${id} — venture tree is DIRTY (${commitState.dirtyFiles} file(s)); refusing to stamp a graph over uncommitted work`);
    try { await _fs.unlink(target + GRAPH_STAMP_SUFFIX); } catch { /* nothing to remove */ }
    return { ok: false, refreshed: false, reason: `venture-dirty: ${commitState.dirtyFiles} uncommitted file(s)`, head: commitState.head };
  }

  const r = _spawn("graphify", ["update", venturePath, "--no-cluster"], {
    cwd: REPO_ROOT, encoding: "utf8", shell: false, windowsHide: true,
    timeout: deps.timeoutMs || BUILD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error || (typeof r.status === "number" && r.status !== 0)) {
    const why = r.error ? (r.error.message || String(r.error)) : `exit ${r.status}`;
    log(`graphify-refresh: ${id} build FAILED (${why}) — the existing venture graph is left untouched`);
    return { ok: false, refreshed: false, reason: `build-failed: ${why}` };
  }

  // graphify wrote beside the venture root; that is where the build lands.
  const built = deps.builtVentureGraph || path.join(venturePath, "graphify-out", "graph.json");
  const fresh = await readJson(built, _fs);
  if (!fresh || !Array.isArray(fresh.nodes) || fresh.nodes.length === 0) {
    log(`graphify-refresh: ${id} rebuilt graph is unreadable or empty — NOT promoting`);
    return { ok: false, refreshed: false, reason: "rebuilt graph unusable" };
  }

  const tmp = `${target}.incoming`;
  try {
    await _fs.mkdir(path.dirname(target), { recursive: true });
    await _fs.copyFile(built, tmp);
    await _fs.rename(tmp, target);
  } catch (err) {
    log(`graphify-refresh: ${id} promotion failed (${err && err.message ? err.message : err})`);
    try { await _fs.unlink(tmp); } catch { /* nothing to clean */ }
    return { ok: false, refreshed: false, reason: "promotion-failed" };
  }

  // Same evidence-before-claim rule as the Aidit OS graph, against the
  // VENTURE's tree.
  const verify = deps.verifyContent || verifyGraphContent;
  const content = await verify(fresh, { ...deps, _fs, sourceRoot: venturePath });
  if (!content.verified) {
    log(`graphify-refresh: ${id} promoted graph FAILED the content check — ${content.reason}`);
    for (const miss of (content.mismatches || []).slice(0, 5)) log(`graphify-refresh:   ${miss}`);
    try { await _fs.unlink(target + GRAPH_STAMP_SUFFIX); } catch { /* nothing to remove */ }
    return { ok: false, refreshed: false, reason: `content-check-failed: ${content.reason}`, mismatches: content.mismatches };
  }

  try {
    await _fs.writeFile(target + GRAPH_STAMP_SUFFIX, commitState.head, "utf8");
  } catch (err) {
    log(`graphify-refresh: ${id} stamp write failed (${err && err.message ? err.message : err})`);
  }

  log(`graphify-refresh: ${id} promoted ${fresh.nodes.length} nodes, stamped ${commitState.head} — ${content.reason}`);
  return { ok: true, refreshed: true, id, nodes: fresh.nodes.length, head: commitState.head, contentChecked: content.checked };
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
