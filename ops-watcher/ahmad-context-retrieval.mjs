// ops-watcher/ahmad-context-retrieval.mjs
// Standalone, read-only Cognitive Core retrieval prototype for AHMAD dispatch
// prep. This file is deliberately NOT imported by ahmad-dispatch.mjs, heartbeat,
// or any automatic trigger. It gathers bounded evidence and returns a compact
// ContextBundle; it never dispatches, spawns, or mutates Paperclip/GBrain/
// Graphify/filesystem state.
//
//   node ops-watcher/ahmad-context-retrieval.mjs --issue KOL-xx --once
//
// The production-facing dependency is explicit GBRAIN_HOME. Tests inject
// runGbrain/readGraphify/getSourceInfo fixtures so they never touch the live
// store.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GRAPHIFY_ACTIVE = path.join(ROOT, "graphify-out", "active", "graph.json");

export const CONTEXT_BUNDLE_VERSION = "0.1";
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_EVIDENCE_UNITS = 7;
export const DEFAULT_MAX_CONTEXT_CHARS = 6000;

const READ_ONLY_GBRAIN_COMMANDS = new Set([
  "get",
  "list",
  "search",
  "query",
  "stats",
  "graph",
]);

const FORBIDDEN_GBRAIN_COMMANDS = new Set([
  "put",
  "delete",
  "import",
  "sync",
  "embed",
  "link",
  "unlink",
  "tag",
  "untag",
  "timeline-add",
  "capture",
  "publish",
  "backfill",
  "reindex-code",
  "reindex-search-vector",
  "reconcile-links",
]);

const KNOWN_CANONICAL_SOURCES = new Map([
  ["agent-registry", "config/agent-registry.json"],
  ["canonical-decision-ledger", "config/decision-ledger.json"],
  ["paperclip-endpoint", "config/paperclip-endpoint.json"],
  ["master-canonical-backlog", "handoffs/sjahrir/MASTER-CANONICAL-BACKLOG.json"],
  ["canonical-role-map", "handoffs/sjahrir/CANONICAL-ROLE-MAP.json"],
]);

function isoNow(now) {
  if (typeof now === "function") return isoNow(now());
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "string" && now.trim()) return now;
  if (typeof now === "number") return new Date(now).toISOString();
  return new Date().toISOString();
}

function labelsOf(issue) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels
    .map((l) => (typeof l === "string" ? l : l && l.name))
    .filter(Boolean)
    .map(String);
}

function compactText(s, n = 700) {
  const oneLine = String(s || "").replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n - 3).trimEnd() + "..." : oneLine;
}

function buildQueryText({ issue, targetRole, taskKind, mentionedPaths }) {
  const parts = [
    issue?.identifier,
    issue?.title,
    issue?.description,
    labelsOf(issue).join(" "),
    targetRole,
    taskKind,
    ...(Array.isArray(mentionedPaths) ? mentionedPaths : []),
  ].filter(Boolean);
  return compactText(parts.join(" "), 1200);
}

function issueName(issue) {
  return issue?.identifier || issue?.id || issue?.title || "unknown issue";
}

function makeEmptyBundle({ generatedAt, querySummary }) {
  return {
    context_bundle_version: CONTEXT_BUNDLE_VERSION,
    generated_at: generatedAt,
    query_summary: querySummary,
    status: "empty",
    evidence: [],
    canonical_pointers: [],
    stale_warnings: [],
    conflicts: [],
    excluded_hits: [],
  };
}

function ensureReadOnlyGbrainCommand(command) {
  const cmd = String(command || "");
  if (!READ_ONLY_GBRAIN_COMMANDS.has(cmd) || FORBIDDEN_GBRAIN_COMMANDS.has(cmd)) {
    throw new Error(`gbrain command is not read-only: ${cmd}`);
  }
}

export function runGbrainReal({ command, args = [], gbrainHome, timeoutMs = DEFAULT_TIMEOUT_MS, cwd = ROOT, signal } = {}) {
  ensureReadOnlyGbrainCommand(command);
  return new Promise((resolve) => {
    if (!gbrainHome) {
      resolve({
        code: null,
        stdout: "",
        stderr: "GBRAIN_HOME is required for retrieval",
        timedOut: false,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn("gbrain", [command, ...args], {
        cwd,
        env: { ...process.env, GBRAIN_HOME: gbrainHome },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        code: null,
        stdout: "",
        stderr: String(err && err.message ? err.message : err),
        timedOut: false,
      });
      return;
    }
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const stopChild = () => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      try { child.stdout.destroy(); } catch { /* ignore */ }
      try { child.stderr.destroy(); } catch { /* ignore */ }
      try { child.unref(); } catch { /* ignore */ }
    };
    const onAbort = () => {
      timedOut = true;
      stopChild();
      finish({ code: null, stdout, stderr, timedOut: true });
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(onAbort, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      finish({
        code: null,
        stdout,
        stderr: stderr + String(err && err.message ? err.message : err),
        timedOut,
      });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr, timedOut });
    });
  });
}

async function boundedCall(label, fn, timeoutMs, signal) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      try { signal?.abort?.(); } catch { /* ignore */ }
      resolve({
        ok: false,
        timedOut: true,
        error: `${label} timed out after ${timeoutMs}ms`,
        value: null,
      });
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      timeout,
    ]);
    clearTimeout(timer);
    if (value && value.timedOut && value.ok === false) return value;
    return { ok: true, timedOut: false, value, error: null };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      timedOut: false,
      value: null,
      error: `${label} failed: ${err && err.message ? err.message : err}`,
    };
  }
}

async function callGbrain(command, args, deps, degraded) {
  ensureReadOnlyGbrainCommand(command);
  const ctrl = new AbortController();
  const r = await boundedCall(
    `gbrain ${command}`,
    () => deps.runGbrain({
      command,
      args,
      gbrainHome: deps.gbrainHome,
      timeoutMs: deps.timeoutMs,
      cwd: deps.repoRoot,
      signal: ctrl.signal,
    }),
    deps.timeoutMs,
    ctrl,
  );
  if (!r.ok) {
    degraded.push({ source: `gbrain:${command}`, reason: r.error });
    return { code: null, stdout: "", stderr: r.error, timedOut: r.timedOut };
  }
  const out = r.value || {};
  if (out.timedOut || out.code !== 0) {
    degraded.push({
      source: `gbrain:${command}`,
      reason: out.timedOut
        ? `gbrain ${command} timed out after ${deps.timeoutMs}ms`
        : compactText(out.stderr || `gbrain ${command} exited ${out.code}`, 300),
    });
  }
  return out;
}

function parseGbrainHits(stdout, sourceCommand) {
  const hits = [];
  for (const raw of String(stdout || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[([0-9.]+)\]\s+([^\s]+)\s+--\s*(.*)$/);
    if (!m) continue;
    hits.push({
      source_system: "gbrain",
      source_command: sourceCommand,
      score: Number(m[1]),
      slug: m[2],
      snippet: m[3],
    });
  }
  return hits;
}

function mergeHits(...lists) {
  const bySlug = new Map();
  for (const hit of lists.flat()) {
    const prev = bySlug.get(hit.slug);
    if (!prev || hit.score > prev.score) bySlug.set(hit.slug, hit);
  }
  return [...bySlug.values()].sort((a, b) => b.score - a.score);
}

function parseFrontmatter(markdown) {
  const text = String(markdown || "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fm = {};
  if (!m) return { frontmatter: fm, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!mm) continue;
    fm[mm[1]] = mm[2].replace(/^['"]|['"]$/g, "");
  }
  return { frontmatter: fm, body: text.slice(m[0].length) };
}

function timestampFromPage(markdown) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const keys = ["indexed_at", "captured_at", "updated_at", "last_updated_at", "last_observed_at"];
  for (const k of keys) {
    if (frontmatter[k]) return frontmatter[k];
  }
  const m = body.match(/\b(?:indexed_at|captured_at|updated_at|last_updated_at|last_observed_at)\s*[:=]\s*['"]?([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][^'"\s]+)?)/i);
  return m ? m[1] : null;
}

function normalizeDateMs(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : NaN;
}

function titleFromPage(slug, markdown) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  if (frontmatter.title) return frontmatter.title;
  const h = body.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : slug;
}

function inferCanonicalPath(slug, markdown) {
  if (KNOWN_CANONICAL_SOURCES.has(slug)) return KNOWN_CANONICAL_SOURCES.get(slug);
  const text = String(markdown || "");
  const m = text.match(/\bsource_path\s*[:=]\s*['"]?([^'"\r\n]+)/i)
    || text.match(/\bsource_file\s*[:=]\s*['"]?([^'"\r\n]+)/i)
    || text.match(/\b(config\/[A-Za-z0-9_.\/-]+|handoffs\/[A-Za-z0-9_.\/ -]+|ops-watcher\/[A-Za-z0-9_.\/-]+)/i);
  return m ? m[1].trim() : null;
}

async function defaultGetSourceInfo(relPath, { repoRoot = ROOT } = {}) {
  const full = path.resolve(repoRoot, relPath);
  const rootRel = path.relative(repoRoot, full);
  if (rootRel.startsWith("..") || path.isAbsolute(rootRel)) return null;
  try {
    const st = await fs.stat(full);
    const content = await fs.readFile(full, "utf8").catch(() => "");
    let lastUpdatedAt = null;
    let claims = [];
    try {
      const obj = JSON.parse(content);
      lastUpdatedAt = obj.last_updated_at || obj.updated_at || null;
      claims = extractClaimsFromJson(obj, relPath);
    } catch {
      const m = content.match(/\blast_updated_at\s*[:=]\s*['"]?([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[T ][^'"\s,}]+)?)/i);
      lastUpdatedAt = m ? m[1] : null;
    }
    return {
      path: relPath,
      mtimeMs: st.mtimeMs,
      mtimeIso: new Date(st.mtimeMs).toISOString(),
      lastUpdatedAt,
      claims,
    };
  } catch {
    return null;
  }
}

function extractClaimsFromJson(obj, sourcePath) {
  const claims = [];
  const visit = (value, pointer) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${pointer}/${i}`));
      return;
    }
    const id = value.id || value.identifier || value.name || value.key || value.slug;
    if (id && (value.status != null || value.value != null)) {
      claims.push({
        topic: String(id),
        field: value.status != null ? "status" : "value",
        value: String(value.status != null ? value.status : value.value),
        evidence: `${sourcePath}:${pointer}`,
      });
    }
    for (const [k, v] of Object.entries(value)) visit(v, `${pointer}/${k}`);
  };
  visit(obj, "");
  return claims;
}

function extractClaimsFromText(text, fallbackTopic, source) {
  const claims = [];
  const lines = String(text || "").split(/\r?\n/);
  let topic = fallbackTopic;
  let field = null;
  let value = null;
  for (const line of lines) {
    const t = line.match(/^\s*(?:topic|entity)\s*:\s*(.+?)\s*$/i);
    if (t) topic = t[1].trim();
    const s = line.match(/^\s*(status|value)\s*:\s*(.+?)\s*$/i);
    if (s) {
      field = s[1].toLowerCase();
      value = s[2].trim();
    }
    const c = line.match(/^\s*claim\s*:\s*(.+?)\s*=\s*(.+?)\s*$/i);
    if (c) {
      claims.push({
        topic: c[1].trim(),
        field: "value",
        value: c[2].trim(),
        evidence: source,
      });
    }
  }
  if (topic && field && value) {
    claims.push({ topic, field, value, evidence: source });
  }
  return claims;
}

async function loadGraphify(deps, degraded) {
  if (typeof deps.readGraphify === "function") {
    const ctrl = new AbortController();
    const r = await boundedCall(
      "graphify active graph",
      () => deps.readGraphify({ path: deps.graphifyPath, signal: ctrl.signal }),
      deps.timeoutMs,
      ctrl,
    );
    if (!r.ok) {
      degraded.push({ source: "graphify:active", reason: r.error });
      return null;
    }
    return r.value;
  }
  try {
    const raw = await fs.readFile(deps.graphifyPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    degraded.push({
      source: "graphify:active",
      reason: compactText(err && err.message ? err.message : err, 300),
    });
    return null;
  }
}

function graphifyPointers(graph, { queryText, mentionedPaths }, max = 5) {
  if (!graph || typeof graph !== "object") return { pointers: [], evidence: [], excluded: [] };
  const terms = [
    ...String(queryText || "").split(/[^A-Za-z0-9_.\/-]+/),
    ...(Array.isArray(mentionedPaths) ? mentionedPaths : []),
  ].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 4);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const matches = [];
  for (const node of nodes) {
    const hay = [
      node.id,
      node.label,
      node.source_file,
      node.source_location,
      node.community_name,
    ].filter(Boolean).join(" ").toLowerCase();
    if (terms.some((t) => hay.includes(t))) matches.push(node);
  }
  const picked = matches.slice(0, max);
  const pointers = [];
  const evidence = [];
  for (const node of picked) {
    const sourceFile = node.source_file || node.sourceFile || null;
    const loc = node.source_location || node.sourceLocation || node.id || "";
    const pointer = sourceFile ? `${sourceFile}${loc ? `:${loc}` : ""}` : `graphify-out/active/graph.json:${node.id || node.label}`;
    pointers.push(pointer);
    evidence.push({
      title: String(node.label || node.id || "Graphify structural match"),
      source: "graphify:active",
      canonical_pointer: pointer,
      why_relevant: "Active Graphify structural node matched the issue, role, task, or mentioned path.",
      freshness: "unknown",
      confidence: node.confidence || node.confidence_score ? "MEDIUM" : "LOW",
      excerpt: compactText(node.context || node.source_file || node.id || node.label || "", 350),
    });
  }
  const excluded = matches.slice(max).map((node) => ({
    source: `graphify:active:${node.id || node.label || "node"}`,
    reason: "bounded evidence cap reached",
  }));
  return { pointers, evidence, excluded };
}

async function normalizeGbrainEvidence(hit, deps, degraded) {
  const get = await callGbrain("get", [hit.slug], deps, degraded);
  const page = get.stdout || hit.snippet || "";
  const canonicalPath = inferCanonicalPath(hit.slug, page);
  const sourceInfo = canonicalPath
    ? await deps.getSourceInfo(canonicalPath, { repoRoot: deps.repoRoot })
    : null;
  const indexedAt = timestampFromPage(page);
  let freshness = indexedAt ? "unknown" : "unknown";
  const staleWarnings = [];
  if (sourceInfo && indexedAt) {
    const pageMs = normalizeDateMs(indexedAt);
    const sourceMs = normalizeDateMs(sourceInfo.lastUpdatedAt || sourceInfo.mtimeMs);
    if (Number.isFinite(pageMs) && Number.isFinite(sourceMs) && pageMs < sourceMs) {
      freshness = "stale";
      staleWarnings.push({
        source: `gbrain:${hit.slug}`,
        warning: `Indexed page says ${indexedAt}, source file says ${sourceInfo.lastUpdatedAt || sourceInfo.mtimeIso}.`,
      });
    } else {
      freshness = "current";
    }
  }
  const pointer = canonicalPath || `gbrain get ${hit.slug}`;
  const sourceClaims = Array.isArray(sourceInfo?.claims) ? sourceInfo.claims : [];
  const pageClaims = extractClaimsFromText(page, hit.slug, `gbrain:${hit.slug}`);
  return {
    evidence: {
      title: titleFromPage(hit.slug, page),
      source: `gbrain:${hit.slug}`,
      canonical_pointer: pointer,
      why_relevant: `Matched ${hit.source_command} for this dispatch context.`,
      freshness,
      confidence: hit.score >= 0.85 ? "HIGH" : hit.score >= 0.65 ? "MEDIUM" : "LOW",
      excerpt: compactText(page || hit.snippet, 550),
    },
    canonicalPointer: pointer,
    staleWarnings,
    pageClaims,
    sourceClaims,
  };
}

function detectConflicts(allPageClaims, allCanonicalClaims) {
  const conflicts = [];
  const canonicalByKey = new Map();
  for (const claim of allCanonicalClaims) {
    const key = `${String(claim.topic).toLowerCase()}|${String(claim.field || "value").toLowerCase()}`;
    canonicalByKey.set(key, claim);
  }
  for (const claim of allPageClaims) {
    const key = `${String(claim.topic).toLowerCase()}|${String(claim.field || "value").toLowerCase()}`;
    const current = canonicalByKey.get(key);
    if (!current) continue;
    if (String(current.value) === String(claim.value)) continue;
    conflicts.push({
      topic: claim.topic,
      older_evidence: `${claim.evidence} says ${claim.field || "value"} ${claim.value}.`,
      current_evidence: `${current.evidence || "current source"} says ${current.field || "value"} ${current.value}.`,
    });
  }
  return conflicts;
}

function dedupeStrings(items) {
  return [...new Set(items.filter(Boolean).map(String))];
}

function dedupeObjects(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function capEvidence(evidence, excluded, maxEvidenceUnits, maxContextChars) {
  const kept = [];
  let chars = 0;
  for (const ev of evidence) {
    const size = JSON.stringify(ev).length;
    if (kept.length >= maxEvidenceUnits || chars + size > maxContextChars) {
      excluded.push({
        source: ev.source,
        reason: "bounded evidence or context character cap reached",
      });
      continue;
    }
    kept.push(ev);
    chars += size;
  }
  return kept;
}

export async function retrieveDispatchContext(
  { issue, targetRole, taskKind, mentionedPaths = [], now } = {},
  depsIn = {},
) {
  const generatedAt = isoNow(now);
  const querySummary = `pre-dispatch context for ${issueName(issue)}`;
  const bundle = makeEmptyBundle({ generatedAt, querySummary });
  const degraded = [];
  const queryText = buildQueryText({ issue, targetRole, taskKind, mentionedPaths });
  const deps = {
    repoRoot: depsIn.repoRoot || ROOT,
    graphifyPath: depsIn.graphifyPath || GRAPHIFY_ACTIVE,
    gbrainHome: depsIn.gbrainHome || process.env.GBRAIN_HOME || "",
    runGbrain: depsIn.runGbrain || runGbrainReal,
    readGraphify: depsIn.readGraphify,
    getSourceInfo: depsIn.getSourceInfo || defaultGetSourceInfo,
    timeoutMs: depsIn.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxEvidenceUnits: depsIn.maxEvidenceUnits || DEFAULT_MAX_EVIDENCE_UNITS,
    maxContextChars: depsIn.maxContextChars || DEFAULT_MAX_CONTEXT_CHARS,
    canonicalClaims: Array.isArray(depsIn.canonicalClaims) ? depsIn.canonicalClaims : [],
  };

  if (!deps.gbrainHome) {
    degraded.push({
      source: "gbrain",
      reason: "GBRAIN_HOME is required and was not provided",
    });
  }

  const evidence = [];
  const canonicalPointers = [];
  const staleWarnings = [];
  const pageClaims = [];
  const canonicalClaims = [...deps.canonicalClaims];
  const excludedHits = [];

  if (deps.gbrainHome) {
    const [queryOut, searchOut, statsOut] = await Promise.all([
      callGbrain("query", [queryText, "--no-expand"], deps, degraded),
      callGbrain("search", [queryText], deps, degraded),
      callGbrain("stats", [], deps, degraded),
    ]);
    const hits = mergeHits(
      parseGbrainHits(queryOut.stdout, "query"),
      parseGbrainHits(searchOut.stdout, "search"),
    );
    const topHits = hits.slice(0, deps.maxEvidenceUnits);
    for (const hit of topHits) {
      const normalized = await normalizeGbrainEvidence(hit, deps, degraded);
      evidence.push(normalized.evidence);
      canonicalPointers.push(normalized.canonicalPointer);
      staleWarnings.push(...normalized.staleWarnings);
      pageClaims.push(...normalized.pageClaims);
      canonicalClaims.push(...normalized.sourceClaims);
      await callGbrain("graph", [hit.slug, "--depth", "1"], deps, degraded);
    }
    for (const hit of hits.slice(deps.maxEvidenceUnits)) {
      excludedHits.push({
        source: `gbrain:${hit.slug}`,
        reason: "bounded evidence cap reached",
      });
    }

  }

  const graph = await loadGraphify(deps, degraded);
  const graphMatches = graphifyPointers(graph, { queryText, mentionedPaths }, 3);
  evidence.push(...graphMatches.evidence);
  canonicalPointers.push(...graphMatches.pointers);
  excludedHits.push(...graphMatches.excluded);

  const conflicts = detectConflicts(pageClaims, canonicalClaims);
  const selectedEvidence = capEvidence(
    evidence,
    excludedHits,
    deps.maxEvidenceUnits,
    deps.maxContextChars,
  );

  bundle.evidence = selectedEvidence;
  bundle.canonical_pointers = dedupeStrings(canonicalPointers).slice(0, 12);
  bundle.stale_warnings = dedupeObjects(staleWarnings);
  bundle.conflicts = dedupeObjects(conflicts);
  bundle.excluded_hits = dedupeObjects([
    ...excludedHits,
    ...degraded.map((d) => ({
      source: d.source,
      reason: d.reason,
    })),
  ]);

  if (bundle.conflicts.length) bundle.status = "conflicted";
  else if (degraded.length) bundle.status = "degraded";
  else if (bundle.evidence.length || bundle.canonical_pointers.length) bundle.status = "ok";
  else bundle.status = "empty";

  return bundle;
}

function parseCliArgs(argv) {
  const out = {
    once: false,
    issue: null,
    targetRole: "AHMAD",
    taskKind: "status",
    mentionedPaths: [],
    gbrainHome: process.env.GBRAIN_HOME || "",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--once") out.once = true;
    else if (a === "--issue") out.issue = argv[++i] || null;
    else if (a === "--target-role") out.targetRole = argv[++i] || out.targetRole;
    else if (a === "--task-kind") out.taskKind = argv[++i] || out.taskKind;
    else if (a === "--path") out.mentionedPaths.push(argv[++i]);
    else if (a === "--gbrain-home") out.gbrainHome = argv[++i] || "";
  }
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (!args.once) {
    console.error("Usage: node ops-watcher/ahmad-context-retrieval.mjs --issue KOL-xx --once [--gbrain-home <path>]");
    process.exitCode = 2;
    return;
  }
  const bundle = await retrieveDispatchContext({
    issue: { identifier: args.issue || "manual", title: args.issue || "manual retrieval" },
    targetRole: args.targetRole,
    taskKind: args.taskKind,
    mentionedPaths: args.mentionedPaths.filter(Boolean),
    now: new Date(),
  }, {
    gbrainHome: args.gbrainHome,
  });
  console.log(JSON.stringify(bundle, null, 2));
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
    console.error("fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}


