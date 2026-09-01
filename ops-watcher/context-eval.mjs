// ops-watcher/context-eval.mjs
// FOS-14 step 1: a measurable baseline for context retrieval.
//
// This harness measures what ops-watcher/ahmad-context-retrieval.mjs's
// retrieveDispatchContext ALREADY returns against a hand-authored ground-truth
// question set (ops-watcher/context-eval-questions.json). It never mutates
// GBrain, Graphify, Paperclip, or any existing file. A poor baseline is the
// expected, useful outcome — the point is to have a recorded ruler before
// improving the thing it measures.
//
//   node ops-watcher/context-eval.mjs --run [--json] [--only <id>] [--baseline]
//
// Exit 0 always when the harness itself worked (a low score is DATA, not a
// process failure). Exit 1 only when the harness could not run — for example
// GBRAIN_HOME is unset on a real (non-injected) run. Never tunes the retrieval
// module; this file only measures.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retrieveDispatchContext } from "./ahmad-context-retrieval.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUESTIONS_FILE = path.join(__dirname, "context-eval-questions.json");
const BASELINE_FILE = path.join(__dirname, "context-eval-baseline.json");

// ---- Normalisation & matching ---------------------------------------------
//
// A real bundle from retrieveDispatchContext has these top-level keys:
//   status, evidence, canonical_pointers, stale_warnings, conflicts,
//   excluded_hits — there is NO `degraded` array. The harness below measures
// the real shape, not an invented one.
//
// A real evidence unit's source LABEL looks like `graphify:active`,
// `graphify:active:<node_id>`, or `gbrain:<slug>`. Ground truth is expressed
// as repo paths (`ops-watcher/heartbeat.mjs`) and GBrain slugs
// (`agent-registry`), so comparing only against the label made a match
// structurally impossible. We instead build a haystack from every
// identity-carrying field on each evidence unit and each canonical pointer,
// normalise (lowercase + backslash->forward slash), and match a ground-truth
// entry when it OR its basename appears as a substring of any collected
// string.

// Identity-carrying fields on an evidence unit (and on canonical pointer
// objects when they are objects). The source label is always present; the
// rest are collected only when present.
const IDENTITY_FIELDS = [
  "source",
  "source_file",
  "file",
  "path",
  "slug",
  "id",
  "node_id",
  "label",
  "title",
  "uri",
  "canonical_pointer",
];
// The unit's free-text / snippet field, when it has one.
const TEXT_FIELDS = ["excerpt", "snippet", "text"];

function normalize(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\\/g, "/");
}

function basenameOf(normPath) {
  const i = normPath.lastIndexOf("/");
  return i >= 0 ? normPath.slice(i + 1) : normPath;
}

function stemOf(base) {
  // Strip a single extension so `heartbeat.mjs` -> `heartbeat`. This is what
  // lets a ground-truth path like `ops-watcher/heartbeat.mjs` match a graph
  // node id such as `heartbeat_steps` (the node id contains the stem).
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

// A ground-truth entry counts as matched when, after normalisation, it appears
// as a substring of any collected haystack string, OR when its basename does,
// OR when its stem (basename without extension) does. The stem check is what
// makes `ops-watcher/heartbeat.mjs` match a unit carrying only
// `heartbeat.mjs`, a node id `heartbeat_steps`, or a slug-bearing label.
function entryMatches(entry, haystack) {
  const e = normalize(entry);
  if (!e) return false;
  const base = basenameOf(e);
  const stem = stemOf(base);
  for (const h of haystack) {
    if (!h) continue;
    if (h.includes(e)) return true;
    if (base && base !== e && h.includes(base)) return true;
    if (stem && stem !== base && stem !== e && h.includes(stem)) return true;
  }
  return false;
}

function countArray(a) {
  return Array.isArray(a) ? a.length : 0;
}

// ---- Pure scoring ----------------------------------------------------------
//
// scoreBundle is PURE: it never performs I/O and never throws. It inspects the
// bundle's evidence + canonical_pointers for the presence of each
// must_include_any entry (hit) and each must_not_include entry (falsePositive).
export function scoreBundle(caseDef, bundle) {
  const mustIncludeAny = Array.isArray(caseDef.must_include_any) ? caseDef.must_include_any : [];
  const mustNotInclude = Array.isArray(caseDef.must_not_include) ? caseDef.must_not_include : [];

  const haystack = bundleToHaystack(bundle);
  const unitsReturned = Array.isArray(bundle?.evidence) ? bundle.evidence.length : 0;

  const matchedSources = mustIncludeAny.filter((entry) => entry && entryMatches(entry, haystack));
  const hit = mustIncludeAny.length > 0 && matchedSources.length > 0;

  const falsePositiveHits = mustNotInclude.filter((entry) => entry && entryMatches(entry, haystack));
  const falsePositive = falsePositiveHits.length > 0;

  const missedExpected = mustIncludeAny.filter((entry) => entry && !entryMatches(entry, haystack));

  const sourceKinds = extractSourceKinds(bundle);

  return {
    id: caseDef.id,
    hit,
    falsePositive,
    unitsReturned,
    matchedSources,
    missedExpected,
    sourceKinds,
    staleWarnings: countArray(bundle?.stale_warnings),
    conflicts: countArray(bundle?.conflicts),
    excludedHits: countArray(bundle?.excluded_hits),
    status: bundle && bundle.status != null ? bundle.status : null,
    falsePositiveHits: falsePositiveHits.length ? falsePositiveHits : undefined,
  };
}

// Build the list of normalised identity strings from every evidence unit and
// every canonical pointer. Both must_include_any and must_not_include match
// against this SAME haystack so a false positive is measured on exactly what
// the retrieval surfaced.
function bundleToHaystack(bundle) {
  const out = [];
  if (!bundle || typeof bundle !== "object") return out;
  if (Array.isArray(bundle.evidence)) {
    for (const ev of bundle.evidence) {
      if (!ev) continue;
      for (const f of IDENTITY_FIELDS) {
        if (ev[f] != null && ev[f] !== "") out.push(normalize(ev[f]));
      }
      for (const f of TEXT_FIELDS) {
        if (ev[f] != null && ev[f] !== "") out.push(normalize(ev[f]));
      }
    }
  }
  if (Array.isArray(bundle.canonical_pointers)) {
    for (const p of bundle.canonical_pointers) {
      if (p == null) continue;
      if (typeof p === "object") {
        for (const f of IDENTITY_FIELDS) {
          if (p[f] != null && p[f] !== "") out.push(normalize(p[f]));
        }
      } else {
        out.push(normalize(p));
      }
    }
  }
  return out.filter((s) => s !== "");
}

// Sorted unique list of the prefix of every evidence source label before the
// first `:`. A run that returns only graph nodes reports ["graphify"]; one
// that also used GBrain reports ["gbrain","graphify"]. This is the number
// that tells us whether GBrain is contributing at all.
function extractSourceKinds(bundle) {
  const kinds = new Set();
  if (bundle && Array.isArray(bundle.evidence)) {
    for (const ev of bundle.evidence) {
      if (!ev || typeof ev.source !== "string") continue;
      const i = ev.source.indexOf(":");
      kinds.add(i > 0 ? ev.source.slice(0, i) : ev.source);
    }
  }
  return [...kinds].sort();
}

// The canonical empty/error score shape. Used by both evaluateCase (retrieval
// threw) and runEval (evaluateCase itself threw) so a `--only` run produces
// exactly the same per-case shape as a full run.
function makeErrorScore(caseDef) {
  return {
    id: caseDef.id,
    hit: false,
    falsePositive: false,
    unitsReturned: 0,
    matchedSources: [],
    missedExpected: Array.isArray(caseDef.must_include_any) ? caseDef.must_include_any.filter(Boolean) : [],
    sourceKinds: [],
    staleWarnings: 0,
    conflicts: 0,
    excludedHits: 0,
    status: null,
  };
}

// ---- Per-case evaluation ---------------------------------------------------
//
// evaluateCase calls the (injectable) retrieveContext, measures latency, and
// scores the returned bundle. A rejecting/throwing retrieval is recorded as an
// error — the case is still included in the run so the aggregate is honest.
export async function evaluateCase(caseDef, deps = {}) {
  const retrieveContext = deps.retrieveContext || defaultRetrieveContext;
  const now = typeof deps.now === "function" ? deps.now : Date.now;

  const input = {
    issue: caseDef.issue,
    targetRole: caseDef.targetRole,
    taskKind: caseDef.taskKind,
    mentionedPaths: Array.isArray(caseDef.mentionedPaths) ? caseDef.mentionedPaths : [],
    now: new Date(now()).toISOString(),
  };

  const start = now();
  let bundle = null;
  let error = null;
  try {
    bundle = await retrieveContext(input, deps.retrievalDeps || {});
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  const latencyMs = now() - start;

  const score = bundle ? scoreBundle(caseDef, bundle) : makeErrorScore(caseDef);

  return {
    id: caseDef.id,
    question: caseDef.question,
    bundle,
    score,
    latencyMs,
    error,
  };
}

// The default retrieval path: the real retrieveDispatchContext from
// ahmad-context-retrieval.mjs. deps.gbrainHome (or process.env.GBRAIN_HOME) is
// forwarded so a real run can find the GBrain store.
async function defaultRetrieveContext(input, retrievalDeps = {}) {
  return retrieveDispatchContext(input, {
    gbrainHome: retrievalDeps.gbrainHome || process.env.GBRAIN_HOME || "",
    ...retrievalDeps,
  });
}

// ---- Aggregate run ---------------------------------------------------------
export async function runEval(deps = {}) {
  const cases = Array.isArray(deps.cases) ? deps.cases : await loadCases();
  const only = deps.only || null;
  const now = typeof deps.now === "function" ? deps.now : Date.now;

  const filtered = only ? cases.filter((c) => c.id === only) : cases;

  const startedAt = now();
  const caseResults = [];
  for (const caseDef of filtered) {
    // A throwing evaluateCase itself would be a harness bug, but we guard so
    // one bad case never aborts the whole run.
    let result;
    try {
      result = await evaluateCase(caseDef, deps);
    } catch (err) {
      result = {
        id: caseDef.id,
        question: caseDef.question,
        bundle: null,
        score: makeErrorScore(caseDef),
        latencyMs: 0,
        error: err && err.message ? err.message : String(err),
      };
    }
    caseResults.push(result);
  }
  const finishedAt = now();

  const total = caseResults.length;
  const hits = caseResults.filter((r) => r.score && r.score.hit).length;
  const falsePositives = caseResults.filter((r) => r.score && r.score.falsePositive).length;
  const validLatencies = caseResults.filter((r) => Number.isFinite(r.latencyMs) && r.latencyMs >= 0);
  const avgUnits = total > 0
    ? round2(caseResults.reduce((s, r) => s + (r.score ? r.score.unitsReturned : 0), 0) / total)
    : 0;
  const avgLatencyMs = validLatencies.length > 0
    ? round2(validLatencies.reduce((s, r) => s + r.latencyMs, 0) / validLatencies.length)
    : 0;
  const errors = caseResults.filter((r) => r.error).length;

  // Real bundle health fields (replaces the invented `degraded` metric).
  const staleRuns = caseResults.filter((r) => r.score && r.score.staleWarnings > 0).length;
  const conflictRuns = caseResults.filter((r) => r.score && r.score.conflicts > 0).length;
  const statusCounts = {};
  for (const r of caseResults) {
    const st = r.score && r.score.status != null ? r.score.status : "error";
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  }

  return {
    startedAt,
    finishedAt,
    total,
    hits,
    hitRate: total > 0 ? round2(hits / total) : 0,
    falsePositives,
    avgUnits,
    avgLatencyMs,
    staleRuns,
    conflictRuns,
    statusCounts,
    errors,
    cases: caseResults,
  };
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ---- Question file loading -------------------------------------------------
export async function loadCases(file = QUESTIONS_FILE) {
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.cases)) {
    throw new Error(`context-eval: questions file ${file} has no cases array`);
  }
  return parsed.cases;
}

// ---- CLI -------------------------------------------------------------------
function parseCliArgs(argv) {
  const out = { run: false, json: false, only: null, baseline: false, gbrainHome: process.env.GBRAIN_HOME || "" };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--run") out.run = true;
    else if (a === "--json") out.json = true;
    else if (a === "--only") out.only = argv[++i] || null;
    else if (a === "--baseline") out.baseline = true;
    else if (a === "--gbrain-home") out.gbrainHome = argv[++i] || "";
  }
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (!args.run) {
    console.error("usage: node ops-watcher/context-eval.mjs --run [--json] [--only <id>] [--baseline]");
    process.exit(2);
    return;
  }

  // A real (non-injected) run needs GBRAIN_HOME to actually query GBrain.
  // Without it the retrieval degrades to graphify-only and the baseline is
  // not a meaningful measurement of the real retrieval path. Say so plainly
  // and exit 1 — this is a "harness could not run" condition, not a low score.
  if (!args.gbrainHome) {
    console.error(
      "context-eval: GBRAIN_HOME is not set. The real retrieval path requires it to query GBrain.\n" +
      "Set GBRAIN_HOME the way ahmad-context-retrieval.mjs expects (the GBrain store home directory)\n" +
      "and re-run, or inject a mock retrieveContext for offline testing."
    );
    process.exit(1);
    return;
  }

  const result = await runEval({
    only: args.only,
    retrievalDeps: { gbrainHome: args.gbrainHome },
  });

  if (args.baseline) {
    const baseline = {
      schema_version: "1.0.0",
      recorded_at: new Date().toISOString(),
      gbrain_home: args.gbrainHome,
      ...result,
    };
    await fs.writeFile(BASELINE_FILE, JSON.stringify(baseline, null, 2) + "\n", "utf8");
    if (!args.json) {
      console.log(`context-eval: baseline written to ${path.relative(process.cwd(), BASELINE_FILE)}`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanSummary(result);
  }

  // Exit 0 always when the harness itself worked — a low score is DATA.
  process.exit(0);
}

function printHumanSummary(result) {
  const statusCounts = Object.entries(result.statusCounts || {})
    .map(([k, v]) => `${k}=${v}`).join(" ") || "(none)";
  console.log(
    `context-eval --run: total=${result.total} hits=${result.hits} hitRate=${result.hitRate} falsePositives=${result.falsePositives} avgUnits=${result.avgUnits} avgLatencyMs=${result.avgLatencyMs} staleRuns=${result.staleRuns} conflictRuns=${result.conflictRuns} statusCounts=${statusCounts} errors=${result.errors}`
  );
  for (const c of result.cases) {
    const tag = c.error ? "ERROR" : (c.score.hit ? "HIT  " : "MISS ");
    const fp = c.score.falsePositive ? " [FALSE-POSITIVE]" : "";
    const kinds = c.score.sourceKinds && c.score.sourceKinds.length ? ` kinds=[${c.score.sourceKinds.join(",")}]` : "";
    const matched = c.score.matchedSources && c.score.matchedSources.length ? ` matched=[${c.score.matchedSources.join(",")}]` : "";
    const missed = c.score.missedExpected && c.score.missedExpected.length ? ` missed=[${c.score.missedExpected.join(",")}]` : "";
    console.log(`  ${tag} ${c.id} units=${c.score.unitsReturned} lat=${c.latencyMs}ms status=${c.score.status}${kinds}${matched}${missed}${fp}${c.error ? " err=" + c.error : ""}`);
  }
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
    console.error("context-eval fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}