#!/usr/bin/env node
// Tahap 2 venture sweep: propose at most one DIRECTIVE issue for genuinely new
// venture work. Execution remains exclusively owned by directive-runner.mjs.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeVentures, hardStopsFor, ownerDecisionRequiredFor, hasStatedMetric } from "./ventures.mjs";
import { append, lastSeq } from "./ledger.mjs";
import { CANONICAL_COMPANY_ID, discoverPaperclipPort, ensureLabel, httpPost, listIssues } from "./paperclip-write-client.mjs";
import { DIRECTIVE_LABEL } from "./projections.mjs";
import { resolveSpecialistsForPacket } from "./specialists.mjs";
import { ACTIVE_GRAPH, repoFingerprint } from "./graphify-refresh.mjs";

export const PLANNER_EVENT_KIND = "venture.planner.directive_proposed";
export const PLANNER_MARKER = "VENTURE_PLANNER_KEY";
export const DIRECTIVE_LABEL_COLOR = "#7c3aed";
export const PAPERCLIP_DISCOVERY_OPTS = Object.freeze({ attempts: 3, retryDelayMs: 1500 });
export const STALE_GRAPH_REASON = "stale-knowledge-graph";
export const GRAPH_STAMP_SUFFIX = ".commit.stamp";

const execFileAsync = promisify(execFile);
const TERMINAL_STATUSES = new Set(["done", "closed", "cancelled", "canceled", "archived", "completed"]);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const PLANNER_STATE_FILE = join(MODULE_DIR, "venture-planner-state.json");

function asArray(value) { return Array.isArray(value) ? value : []; }
function nonBlank(value) { return String(value || "").trim(); }

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const s = nonBlank(value);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  }
  return value;
}

function hashObject(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 20); }
function safeVentureId(venture) { return nonBlank(venture?.id).replace(/[^A-Za-z0-9._-]/g, "_") || "unknown"; }
export function lockPathForVenture(venture) { return join(MODULE_DIR, `venture-planner.${safeVentureId(venture)}.lock`); }
export function eventsFromLedger(raw) { return Array.isArray(raw) ? raw : asArray(raw?.events); }

export function normalizeFingerprint(value) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return JSON.stringify(stable(value));
}

export function fingerprintIndicatesDirtyRepo(value) {
  if (value && typeof value === "object") {
    if (value.dirty === true) return true;
    if (value.clean === true || value.isClean === true) return false;
    const status = value.status ?? value.porcelain ?? value.gitStatus ?? value.workingTreeStatus;
    if (status != null) return nonBlank(status).length > 0;
  }

  const text = normalizeFingerprint(value);
  if (!text) return false;
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  if (lines.length > 1) return true;
  if (/\bdirty\b/i.test(text)) return true;
  if (/\bclean\b/i.test(text)) return false;
  return /^[ MADRCU?!]{1,2}\s+\S/m.test(text);
}

// GUARD: refuse to propose on a stale knowledge graph. The graph is stamped
// with the repo commit it was built at; the sweep re-reads that stamp and
// compares it against the current HEAD. Any mismatch (or a missing/unknown
// commit on either side) is a hard refusal, never a warning: a stale graph
// understates blast radius, which weakens the hard stops this proposal
// carries into directive-runner.
export function graphStampPath() { return `${ACTIVE_GRAPH}${GRAPH_STAMP_SUFFIX}`; }

export async function readGraphCommit(deps = {}) {
  if (typeof deps.readGraphCommit === "function") return deps.readGraphCommit(deps);
  try {
    return nonBlank(await readFile(graphStampPath(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

// Called by the graph build step (graphify-refresh) when the graph is built,
// recording the commit it was built at. The planner never stamps on its own:
// a stamp written at proposal time would falsely claim the graph is fresh.
export async function stampGraphCommit(commit, deps = {}) {
  if (typeof deps.stampGraphCommit === "function") return deps.stampGraphCommit(commit, deps);
  const value = nonBlank(commit);
  if (!value) throw new Error("cannot stamp graph without a commit");
  await writeFile(graphStampPath(), `${value}\n`, "utf8");
  return value;
}

export async function currentRepoCommit(deps = {}) {
  if (typeof deps.repoCommit === "function") return deps.repoCommit(deps);
  const cwd = nonBlank(deps.cwd) || nonBlank(deps.repoPath) || MODULE_DIR;
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
  return nonBlank(stdout);
}

export async function verifyGraphFreshness(venture, deps = {}) {
  let graphCommit = "";
  try {
    graphCommit = nonBlank(await readGraphCommit(deps));
  } catch {
    graphCommit = "";
  }
  let repoCommit = "";
  try {
    repoCommit = nonBlank(await currentRepoCommit({ ...deps, venture, cwd: venture?.repoPath, repoPath: venture?.repoPath }));
  } catch {
    repoCommit = "";
  }
  return {
    fresh: Boolean(graphCommit) && Boolean(repoCommit) && graphCommit === repoCommit,
    graphCommit: graphCommit || "unstamped",
    repoCommit: repoCommit || "unknown",
  };
}

export function staleGraphReason(graphCommit, repoCommit) { return `${STALE_GRAPH_REASON}: graph built at ${graphCommit}, repo at ${repoCommit}`; }

async function acquireVentureLock(venture) {
  const path = lockPathForVenture(venture);
  try {
    await writeFile(path, `${process.pid}\n${new Date().toISOString()}\n`, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }
  return {
    path,
    async release() {
      try {
        await unlink(path);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    },
  };
}

export function proposalKeyFor(venture, fingerprint) {
  return `venture:${venture.id}:${hashObject({
    id: venture.id,
    repoPath: venture.repoPath,
    tujuan: venture.tujuan,
    tujuan_sumber: venture.tujuan_sumber,
    metrik: venture.metrik,
    metrik_sumber: venture.metrik_sumber,
    fingerprint: normalizeFingerprint(fingerprint),
  })}`;
}

export function markerForProposal(proposalKey) { return `${PLANNER_MARKER}: ${proposalKey}`; }

export function venturePlannerSignature({ repoCommit, ledgerHeadSeq, openDirectiveIssueIdentifiers }) {
  return hashObject({ repoCommit: normalizeFingerprint(repoCommit), ledgerHeadSeq: String(ledgerHeadSeq ?? ""), openDirectiveIssueIdentifiers: uniq(asArray(openDirectiveIssueIdentifiers)).sort() });
}

function isActiveVenture(venture) { return String(venture?.status || "").toLowerCase() === "active"; }
function hasRepoPath(venture) { return Boolean(nonBlank(venture?.repoPath)); }
function hasStatedGoal(venture) { return Boolean(nonBlank(venture?.tujuan) && nonBlank(venture?.tujuan_sumber)); }
function hasMetricSource(venture) { return Boolean(nonBlank(venture?.metrik_sumber)); }

function issueLabels(issue) {
  return asArray(issue?.labels).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
}

function issueHasDirectiveLabel(issue) { return issueLabels(issue).some((name) => String(name).toUpperCase() === String(DIRECTIVE_LABEL).toUpperCase()); }

function issueText(issue) {
  return [issue?.identifier, issue?.title, issue?.description, issue?.body].map((v) => String(v || "")).join("\n");
}

function isTerminalIssue(issue) { return TERMINAL_STATUSES.has(String(issue?.status || "").toLowerCase()); }

function openDirectiveIssueIdentifiers(issues) {
  return uniq(asArray(issues)
    .filter((issue) => issueHasDirectiveLabel(issue) && !isTerminalIssue(issue))
    .map((issue) => issue?.identifier || issue?.id))
    .sort();
}

async function ledgerHeadSeq(deps) { return (deps.lastSeq || lastSeq)(deps); }

async function readPlannerState(deps) {
  try {
    const raw = typeof deps.readPlannerState === "function"
      ? await deps.readPlannerState(deps)
      : await readFile(PLANNER_STATE_FILE, "utf8");
    if (raw && typeof raw === "object") return raw;
    return JSON.parse(String(raw || "{}"));
  } catch {
    return {};
  }
}

async function writePlannerState(signature, deps) {
  try {
    const state = { signature };
    if (typeof deps.writePlannerState === "function") {
      await deps.writePlannerState(state, deps);
    } else {
      await writeFile(PLANNER_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    }
    return null;
  } catch (error) {
    return { ok: false, created: false, reason: "planner-state-write-failed", error };
  }
}

export function paperclipIssueAlreadyOpen(issues, ventureId, proposalKey) {
  for (const issue of asArray(issues)) {
    if (!issueHasDirectiveLabel(issue) || isTerminalIssue(issue)) continue;
    const text = issueText(issue);
    if (text.includes(markerForProposal(proposalKey))) return true;
    if (text.includes(`VENTURE_ID: ${ventureId}`)) return true;
    if (text.includes(`[venture:${ventureId}]`)) return true;
  }
  return false;
}

function buildTaskText(venture) {
  return [
    `Tahap 2 venture directive for ${venture.id}.`,
    `Goal: ${nonBlank(venture.tujuan) || "unknown"}.`,
    `Metric: ${nonBlank(venture.metrik)}.`,
    `Repo: ${nonBlank(venture.repoPath) || "unknown"}.`,
  ].join(" ");
}

export function buildDirectiveIssue({ venture, fingerprint, proposalKey, hardStops, specialistPacket }) {
  const title = `DIRECTIVE: Venture next step - ${venture.id}`;
  const specialist = specialistPacket || {};
  const lines = [
    markerForProposal(proposalKey), `VENTURE_ID: ${venture.id}`, `REPO: ${nonBlank(venture.repoPath) || "unknown"}`,
    `FINGERPRINT: ${normalizeFingerprint(fingerprint) || "unknown"}`, "", "OBJECTIVE:",
    "Propose and implement the next smallest verifiable step that advances this venture goal and metric.", "",
    "VENTURE GOAL:", nonBlank(venture.tujuan) || "unknown", `Source: ${nonBlank(venture.tujuan_sumber) || "unknown"}`, "",
    "VENTURE METRIC:", nonBlank(venture.metrik), `Source: ${nonBlank(venture.metrik_sumber) || "unknown"}`, "",
    "EXECUTION BOUNDARY:", "- This issue is a DIRECTIVE only.",
    "- venture-planner must not execute, spawn, dispatch, or modify venture files.",
    "- The only execution pipeline is ops-watcher/directive-runner.mjs after owner approval.",
    "- Do not invent goals, metrics, or owner decisions.", "", "HARD STOPS:",
    ...(hardStops.length ? hardStops.map((s) => `- ${s}`) : ["- None stated."]), "", "SPECIALIST ROUTING:",
    `taskClass: ${nonBlank(specialist.taskClass) || "unclassified"}`, `specialists: ${asArray(specialist.specialists).join(", ") || "none"}`,
    `requiredStandards: ${asArray(specialist.requiredStandards).join(", ") || "none"}`, `requiredSkills: ${asArray(specialist.requiredSkills).join(", ") || "none"}`,
    `compactContextRule: ${nonBlank(specialist.compactContextRule) || "none"}`, `preferredMaker: ${nonBlank(specialist.preferredMaker) || "none"}`,
    `preferredReviewer: ${nonBlank(specialist.preferredReviewer) || "none"}`, "", "SPECIALIST SECTION:",
    nonBlank(specialist.section) || "None.", "", "GRAPH CONTEXT:", `Use the active graph if needed: ${ACTIVE_GRAPH}`,
  ];

  return { title, description: lines.join("\n") };
}

async function getFingerprint(venture, deps) {
  return (deps.repoFingerprint || repoFingerprint)({ ...deps, venture, cwd: venture.repoPath, repoPath: venture.repoPath });
}

async function resolveBase(deps) {
  if (deps.base) return deps.base;
  const discover = deps.discoverPaperclipPort || discoverPaperclipPort;
  const resolved = await discover(null, PAPERCLIP_DISCOVERY_OPTS);
  if (typeof resolved === "string" && /^https?:\/\//i.test(resolved)) return resolved;
  return `http://127.0.0.1:${resolved}`;
}

async function prepareCandidate(venture, deps) {
  const ownerDecisions = uniq([
    ...asArray(venture.owner_decision_required),
    ...asArray(await (deps.ownerDecisionRequiredFor || ownerDecisionRequiredFor)(venture.id, deps)),
  ]);
  if (ownerDecisions.length) return { venture, skip: true, reason: "owner-decision-required", ownerDecisions };

  if (!(deps.hasStatedMetric || hasStatedMetric)(venture)) {
    return { venture, skip: true, reason: "missing-stated-metric" };
  }
  if (!hasMetricSource(venture)) {
    return { venture, skip: true, reason: "missing-stated-metric-source" };
  }

  const registryHardStops = uniq([
    ...asArray(venture.hardStops),
    ...asArray(await (deps.hardStopsFor || hardStopsFor)(venture.id, deps)),
  ]);
  const fingerprint = await getFingerprint(venture, deps);
  if (fingerprintIndicatesDirtyRepo(fingerprint)) {
    return { venture, skip: true, reason: "dirty-repo", fingerprint };
  }
  const graph = await verifyGraphFreshness(venture, deps);
  if (!graph.fresh) {
    return {
      venture,
      skip: true,
      reason: STALE_GRAPH_REASON,
      detail: staleGraphReason(graph.graphCommit, graph.repoCommit),
      graphCommit: graph.graphCommit,
      repoCommit: graph.repoCommit,
    };
  }
  const proposalKey = proposalKeyFor(venture, fingerprint);
  return { venture, skip: false, proposalKey, fingerprint, registryHardStops };
}

async function prepareDirective(candidate, deps) {
  const { venture, fingerprint, proposalKey } = candidate;
  const taskText = buildTaskText(venture);
  const specialistPacket = await (deps.resolveSpecialistsForPacket || resolveSpecialistsForPacket)(taskText, deps);
  const hardStops = uniq([...asArray(candidate.registryHardStops), ...asArray(specialistPacket?.hardStops)]);
  const issue = buildDirectiveIssue({ venture, fingerprint, proposalKey, hardStops, specialistPacket });
  return { ...candidate, hardStops, specialistPacket, issue };
}

export async function runVenturePlannerOnce(deps = {}) {
  const heldLocks = [];
  const releaseLock = async (lock) => {
    const idx = heldLocks.indexOf(lock);
    if (idx >= 0) heldLocks.splice(idx, 1);
    await lock.release();
  };

  try {
    const ventures = await (deps.activeVentures || activeVentures)(deps);
    const candidates = [];
    const skipped = [];
    for (const venture of asArray(ventures)) {
      if (!isActiveVenture(venture)) {
        skipped.push({ venture, skip: true, reason: "inactive-venture" });
        continue;
      }
      if (!hasRepoPath(venture)) {
        skipped.push({ venture, skip: true, reason: "missing-repo-path" });
        continue;
      }
      if (!hasStatedGoal(venture)) {
        skipped.push({ venture, skip: true, reason: "missing-stated-goal" });
        continue;
      }

      const lock = await acquireVentureLock(venture);
      if (!lock) {
        skipped.push({ venture, skip: true, reason: "venture-lock-held" });
        continue;
      }
      heldLocks.push(lock);

      const candidate = await prepareCandidate(venture, deps);
      if (candidate.skip) {
        skipped.push(candidate);
        await releaseLock(lock);
      } else {
        candidates.push({ ...candidate, lock });
      }
    }
    if (!candidates.length) {
      const stale = skipped.find((s) => s?.reason === STALE_GRAPH_REASON);
      if (stale) {
        return {
          ok: false,
          created: false,
          reason: stale.detail || staleGraphReason(stale.graphCommit, stale.repoCommit),
          graphCommit: stale.graphCommit,
          repoCommit: stale.repoCommit,
          skipped,
        };
      }
      return { ok: true, created: false, reason: "no-new-venture-directive", skipped };
    }

    const base = await resolveBase(deps);
    const companyId = deps.companyId || CANONICAL_COMPANY_ID;
    let listed;
    try {
      listed = await (deps.listIssues || listIssues)(base, companyId, { label: DIRECTIVE_LABEL });
    } catch (error) {
      return { ok: false, created: false, reason: "paperclip-list-failed", error, skipped };
    }
    const issues = asArray(listed?.issues || listed);
    let signature;
    try {
      signature = venturePlannerSignature({
        repoCommit: candidates[0]?.fingerprint,
        ledgerHeadSeq: await ledgerHeadSeq(deps),
        openDirectiveIssueIdentifiers: openDirectiveIssueIdentifiers(issues),
      });
    } catch (error) {
      return { ok: false, created: false, reason: "planner-signature-failed", error, skipped };
    }
    const previousState = await readPlannerState(deps);
    if (previousState?.signature === signature) {
      return { ok: true, created: false, reason: "unchanged-venture-planner-signature", signature, skipped };
    }

    const candidate = candidates.find((c) => !paperclipIssueAlreadyOpen(issues, c.venture.id, c.proposalKey));
    if (!candidate) {
      const stateFailure = await writePlannerState(signature, deps);
      if (stateFailure) return { ...stateFailure, skipped };
      return { ok: true, created: false, reason: "open-paperclip-directive-exists", signature, skipped };
    }

    for (const other of candidates) {
      if (other !== candidate) await releaseLock(other.lock);
    }
    const directive = await prepareDirective(candidate, deps);

    let label;
    try {
      label = await (deps.ensureLabel || ensureLabel)(base, companyId, DIRECTIVE_LABEL, DIRECTIVE_LABEL_COLOR);
    } catch (error) {
      return { ok: false, created: false, reason: "paperclip-label-failed", error, skipped };
    }
    const labelId = label?.id || label?.label?.id || label?.body?.id;
    if (!labelId) {
      return { ok: false, created: false, reason: "paperclip-label-missing", response: label, skipped };
    }
    const body = {
      title: directive.issue.title,
      description: directive.issue.description,
      status: "todo",
      labelIds: labelId ? [labelId] : [],
      labels: [DIRECTIVE_LABEL],
    };
    const posted = await (deps.httpPost || httpPost)(`${base}/api/companies/${companyId}/issues`, body);
    if (posted?.networkError || (posted?.status && (posted.status < 200 || posted.status >= 300))) {
      return { ok: false, created: false, reason: "paperclip-write-failed", response: posted };
    }

    const made = posted?.body || posted?.issue || {};
    await (deps.append || append)({
      kind: PLANNER_EVENT_KIND,
      subject: made.identifier || made.id || candidate.proposalKey,
      actor: "ops-watcher/venture-planner",
      source: "venture-planner",
      data: {
        ventureId: candidate.venture.id,
        proposalKey: candidate.proposalKey,
        fingerprint: normalizeFingerprint(candidate.fingerprint),
        issueId: made.id || null,
        issueIdentifier: made.identifier || null,
        title: directive.issue.title,
        label: DIRECTIVE_LABEL,
      },
    }, deps);

    const stateFailure = await writePlannerState(signature, deps);
    if (stateFailure) return { ...stateFailure, created: true, issue: made, ventureId: candidate.venture.id, proposalKey: candidate.proposalKey, skipped };

    return {
      ok: true,
      created: true,
      issue: made,
      ventureId: candidate.venture.id,
      proposalKey: candidate.proposalKey,
      signature,
      skipped,
    };
  } finally {
    while (heldLocks.length) {
      await heldLocks.pop().release();
    }
  }
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  if (!argv.includes("--once")) {
    console.error("usage: node ops-watcher/venture-planner.mjs --once");
    return 2;
  }
  const result = await runVenturePlannerOnce(deps);
  const log = deps.log || console.log;
  log(result.created
    ? `venture-planner: created ${result.issue?.identifier || result.issue?.id || "DIRECTIVE"} for ${result.ventureId}`
    : `venture-planner: ${result.reason}`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error("venture-planner crashed:", error);
    process.exit(1);
  });
}
