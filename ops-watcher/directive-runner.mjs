// ops-watcher/directive-runner.mjs
// Directive lifecycle runner: classify Paperclip DIRECTIVE issues, generate a
// bounded approval plan, post that plan/refusal, and deliver the plan to the
// owner as a Telegram decision card (approve/reject). A stalled directive in
// todo/backlog is re-plannable; a stalled directive in in_progress is
// report-only (never trampled). Stage 3b: after the planning pass, up to
// MAX_EXECUTIONS_PER_SWEEP approved directives are executed via
// executeApprovedDirective and the outcome is reported as a Paperclip comment
// (+ status patch + DONE_VERIFIED label for done; one Telegram message for
// reverted/refused/aborted).
//
// Outbound seams (all injectable for offline tests):
//   - Paperclip reads/writes: httpGet / httpPost (from paperclip-write-client)
//   - plan generation:        dispatchPlan (defaults to corleone-dispatch spawn)
//   - context retrieval:      retrieveContext (ahmad-context-retrieval)
//   - decision card delivery: sendDecisionCard (defaults to the real Telegram
//                             path via telegram-client.sendMessage, reusing the
//                             telegram-notify callback_data scheme a:<shortId> /
//                             r:<shortId> — no second scheme, no second sender)
//   - execution (stage 3b):   executeDirective (defaults to executeApprovedDirective)
//   - owner Telegram (3b):    sendOwnerMessage (defaults to telegram-client.sendMessage)
//   - issue patch (3b):       patchIssue (defaults to httpPatch /api/issues/:id)
//   - issue label (3b):       addIssueLabel (defaults to httpPost /api/issues/:id/labels)
//   - label map (3b):         labelMap (default { doneVerified: "DONE_VERIFIED" })

import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  discoverPaperclipPort,
  httpGet,
  httpPost,
  httpPatch,
  listIssues,
  CANONICAL_COMPANY_ID,
  ensureLabel,
  patchIssue,
} from "./paperclip-write-client.mjs";
import { retrieveDispatchContext } from "./ahmad-context-retrieval.mjs";
import { deliverAlert } from "./alert-delivery.mjs";
import { judgeWrite } from "./write-delivery.mjs";
import { escapeMarkdown, sendMessage as telegramSendMessage } from "./telegram-client.mjs";
import { resolveSpecialistsForPacket } from "./specialists.mjs";
// The venture registry answers the ventures fence. This file must not decide
// what a venture is or which paths belong to one — config/ventures.json and
// ops-watcher/ventures.mjs already own that, and a second answer here would
// drift from the first the moment either changed.
import { activeVentures, ventureForPath } from "./ventures.mjs";
// G1-G4: the fences that make the owner's overnight pre-authorization real.
// Each was a sentence in a packet until it was code, which is exactly what
// "nothing under ventures/ may be touched" was before it became a gate.
import {
  NIGHTLY_EXECUTION_CEILING,
  CONSECUTIVE_FAILURE_HALT,
  nightlyCeilingCheck,
  recordNightlyExecution,
  ventureHaltCheck,
  recordVentureOutcome,
  checkUncommittedFiles,
  checkPlanForVentureGitWrites,
  ventureGitPosition,
  compareVentureGitPosition,
} from "./venture-gate.mjs";
// Stage 3 reuse — import, do not rewrite. The snapshot/rollback helpers and the
// lane registry already implement the same shape for the self-repair path; a
// directive execution is the same shape with a different trigger. The lane
// guard and lane-outcome recorder are reused verbatim.
import {
  snapshotFiles,
  restoreFiles,
  REPAIR_LANES,
  appendEvidence as defaultAppendEvidence,
} from "./self-repair-actuator.mjs";
import {
  guardLaneStart as defaultGuardLaneStart,
  recordLaneOutcome as defaultRecordLaneOutcome,
} from "./lane-guard.mjs";
import { parseArgs as parseVerifyFileArgs, verifyFile as verifyFileReal } from "./verify-file.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const STATE_FILE = path.join(__dirname, "directive-runner-state.json");
const ACTIVE_GRAPH_FILE = path.join(REPO_ROOT, "graphify-out", "active", "graph.json");
const GRAPH_ANCHOR_LIMIT_PER_FILE = 6;
// Overall cap across ALL files. The point of anchors is a SMALLER packet; a
// version that makes it bigger has failed even with perfect anchors.
const GRAPH_ANCHOR_LIMIT_TOTAL = 24;
// graphify-refresh.mjs writes the graph commit here, beside the graph itself.
const GRAPH_STAMP_SUFFIX = ".commit.stamp";


// Adds a label the way ahmad-escalate.mjs does — ensureLabel then PATCH labelIds.
// The previous default POSTed /api/issues/:id/labels, which Paperclip answers 404,
// so the escalation silently never fired. Verified live before replacing.
async function addIssueLabelReal(base, companyId, issue, labelName, color) {
  const labelResult = await ensureLabel(base, companyId, labelName, color);
  if (labelResult.id == null) {
    return {
      ok: false,
      networkError: !!labelResult.networkError,
      reason: labelResult.networkErrorMessage || `status ${labelResult.status}`,
    };
  }

  const existingIds = issue.labelIds || (issue.labels || []).map((l) => l.id);
  if (existingIds.includes(labelResult.id)) {
    return { ok: true };
  }

  // Keep existing label ids: patching with only the new id would strip DIRECTIVE (and any other label) off the issue.
  const labelIds = [...existingIds, labelResult.id];
  const patchResult = await patchIssue(base, issue.id, { labelIds });
  if (patchResult.issue == null) {
    return {
      ok: false,
      networkError: !!patchResult.networkError,
      reason: patchResult.networkErrorMessage || `status ${patchResult.status}`,
    };
  }

  return { ok: true };
}

export const PLAN_MARKER = "DIRECTIVE PLAN";
export const APPROVED_MARKER = "DIRECTIVE PLAN APPROVED";
export const REJECTED_MARKER = "DIRECTIVE PLAN REJECTED";
export const RESULT_MARKER = "DIRECTIVE RESULT";
export const REFUSED_MARKER = "PLAN_REFUSED";
export const DISPATCH_MARKER = "AHMAD DISPATCH";
const ATTEMPT_CAP_MARKER = "DIRECTIVE OWNER REQUIRED";
export const EXECUTION_CAP_MARKER = "DIRECTIVE EXECUTION CAP OWNER REQUIRED";
export const UNEXECUTABLE_MARKER = "DIRECTIVE TIDAK DAPAT DIJALANKAN";
const OWNER_REQUIRED_LABEL = "OWNER_REQUIRED";
export const DEFAULT_STALLED_AFTER_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_MAX_PLANS_PER_SWEEP = 1;
export const DEFAULT_MAX_PLAN_ATTEMPTS = 2;
// Stage 3b: at most this many approved directives are executed per sweep. A
// directive execution is one real lane dispatch (same cost shape as a repair
// drill), so the cap stays at 1 to keep the sweep bounded and auditable.
export const MAX_EXECUTIONS_PER_SWEEP = 1;
export const MAX_EXECUTION_ATTEMPTS = 2;
// Sweep throttle for the --once path: planning and executing each cost a real
// lane call while the heartbeat fires every five minutes, so bound back-to-back
// invocations to one sweep per SWEEP_MIN_INTERVAL_MS window.
export const SWEEP_MIN_INTERVAL_MS = 15 * 60 * 1000;
const PLAN_TIMEOUT_MS = 12 * 60 * 1000;
const CONTEXT_TIMEOUT_MS = 6000;
const OUTPUT_CAP = 8000;
// Stage 3a: the execution dispatch + verification timeout. A directive lane
// call is the same cost shape as a self-repair drill (one real lane dispatch
// with a 12-minute timeout), so the constant matches REPAIR's
// DISPATCH_TIMEOUT_MS exactly.
const EXECUTION_TIMEOUT_MS = 12 * 60 * 1000;
const VERIFY_FILE_RED_WITHOUT_FILES_REASON = "verify-file-red-without-files";

// The EXACT decision-comment prefixes telegram-listener.mjs writes when the
// owner taps APPROVE / REJECT on a decision card (DECISION_COMMENT_PREFIX in
// that file). Reused verbatim — do not invent a second wording. findPlanDecision
// recognises these so an awaiting-approval directive resolves to approved /
// rejected without a second listener or a second marker scheme.
const DECISION_APPROVE_PREFIX = "OWNER MENYETUJUI via Telegram";
const DECISION_REJECT_PREFIX = "OWNER MENOLAK via Telegram";

const HARD_DENY = new Set([
  "ops-watcher/heartbeat.mjs",
  "ops-watcher/telegram-listener.mjs",
  "ops-watcher/telegram-notify.mjs",
  "ops-watcher/ahmad-dispatch.mjs",
  "ops-watcher/ahmad-escalate.mjs",
  "ops-watcher/steward.mjs",
  "ops-watcher/directive-runner.mjs",
]);

function iso(ms = Date.now()) { return new Date(ms).toISOString(); }
function asMs(now) {
  const v = typeof now === "function" ? now() : now;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
function bodyOf(c) { return String(c && c.body ? c.body : ""); }
function labelsOf(issue) {
  return (Array.isArray(issue?.labels) ? issue.labels : [])
    .map((l) => (typeof l === "string" ? l : l && l.name))
    .filter(Boolean)
    .map(String);
}
function hasLabel(issue, name) {
  const want = String(name).toUpperCase();
  return labelsOf(issue).some((n) => n.toUpperCase() === want);
}
function commentTime(c) {
  const t = Date.parse(c?.createdAt || c?.created_at || c?.updatedAt || c?.updated_at || "");
  return Number.isFinite(t) ? t : null;
}
function newestComment(comments) {
  let best = null;
  for (const c of Array.isArray(comments) ? comments : []) {
    const t = commentTime(c);
    if (t != null && (!best || t > best.t)) best = { c, t };
  }
  return best;
}
function isPlanComment(c) {
  const b = bodyOf(c);
  return b.includes(PLAN_MARKER) &&
    !b.includes(APPROVED_MARKER) &&
    !b.includes(REJECTED_MARKER) &&
    !b.includes(REFUSED_MARKER);
}
function isAttemptCapEscalationComment(c) {
  return bodyOf(c).trim().startsWith(ATTEMPT_CAP_MARKER);
}
function isExecutionCapEscalationComment(c) {
  const b = bodyOf(c).trim();
  return b.startsWith(EXECUTION_CAP_MARKER) ||
    // One-time bridge for execution-cap reports posted before this marker was split.
    (b.startsWith(ATTEMPT_CAP_MARKER) && b.includes("eksekusi gagal identik"));
}
function isUnexecutableComment(c) {
  return bodyOf(c).trim().startsWith(UNEXECUTABLE_MARKER);
}
// Resolve an approved directive's plan comment into an executable plan, naming
// the reason when it cannot. The three failures need different fixes — no plan
// comment at all, a plan comment with no OBJECTIVE line, and a plan that does
// not parse — so they are reported separately rather than as one "no plan".
export function capturePlanForExecution(rawComments) {
  const comments = commentsOldestFirst(rawComments);
  const planIdx = findLastIndex(comments, isPlanComment);
  if (planIdx < 0) return { ok: false, reason: "plan-comment-missing" };
  const planBody = bodyOf(comments[planIdx]);
  const objIdx = planBody.indexOf("OBJECTIVE: ");
  if (objIdx < 0) return { ok: false, reason: "plan-objective-missing" };
  const parsed = parsePlan(planBody.slice(objIdx));
  if (!parsed.ok) return { ok: false, reason: "plan-parse-failed", detail: parsed.error };
  return { ok: true, plan: parsed };
}
// One report per owner decision. The sweep runs every five minutes, so without
// this the same comment would be posted on every pass for as long as the plan
// stays unreadable. An approval with no timestamp gets exactly one report ever.
function hasUnexecutableReportAfter(comments, approvedAtIso) {
  const cutoff = approvedAtIso ? Date.parse(approvedAtIso) : NaN;
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!isUnexecutableComment(c)) continue;
    if (Number.isNaN(cutoff)) return true;
    const t = commentTime(c);
    if (t != null && t > cutoff) return true;
  }
  return false;
}
// Paperclip's comments endpoint returns NEWEST FIRST. Every helper below that
// reaches for "the last matching comment" assumed the opposite, so on a real
// issue they read the OLDEST plan and the OLDEST decision. That is what kept
// KOL-73 unexecutable: each new plan was posted, approved, and then ignored in
// favour of the 2026-09-01 plan whose multi-line PowerShell VERIFY cannot parse
// — "missing OUT OF SCOPE" every sweep, no matter how good the new plan was.
// The test fixtures all built their arrays oldest-first, which is why no suite
// ever saw it.
//
// Ordering is normalised once, here, so the positional helpers mean what they
// say. If any comment lacks a parsable timestamp the original order is kept
// rather than guessed at.
export function commentsOldestFirst(comments) {
  const list = Array.isArray(comments) ? comments : [];
  if (list.length < 2) return list;
  const decorated = list.map((c, i) => ({ c, i, t: commentTime(c) }));
  if (decorated.some((d) => d.t == null)) return list;
  const sorted = decorated.slice().sort((a, b) => (a.t - b.t) || (a.i - b.i));
  return sorted.map((d) => d.c);
}
function findLastIndex(comments, pred) {
  for (let i = (comments || []).length - 1; i >= 0; i--) if (pred(comments[i])) return i;
  return -1;
}
function decisionFromComment(c) {
  const body = bodyOf(c);
  if (body.startsWith(DECISION_APPROVE_PREFIX) || body.includes(APPROVED_MARKER)) {
    return { decision: "approved", raw: body };
  }
  if (body.startsWith(DECISION_REJECT_PREFIX) || body.includes(REJECTED_MARKER) || /\bREJECT(?:ED)?\b/i.test(body)) {
    return { decision: "rejected", raw: body };
  }
  return null;
}
function newestAttemptCapEscalation(comments) {
  let best = null;
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!isAttemptCapEscalationComment(c)) continue;
    const t = commentTime(c);
    if (t != null && (!best || t > best.t)) best = { c, t };
  }
  return best;
}
function findAttemptCapDecision(comments) {
  const escalation = newestAttemptCapEscalation(comments);
  if (!escalation) return { decision: null, at: null, raw: null, commentId: null, escalationAt: null };
  let best = null;
  for (const c of Array.isArray(comments) ? comments : []) {
    const t = commentTime(c);
    if (t == null || t <= escalation.t) continue;
    const found = decisionFromComment(c);
    if (!found) continue;
    if (!best || t >= best.t) {
      best = { ...found, t, commentId: c?.id || null };
    }
  }
  if (!best) {
    return { decision: null, at: null, raw: null, commentId: null, escalationAt: new Date(escalation.t).toISOString() };
  }
  return {
    decision: best.decision,
    at: new Date(best.t).toISOString(),
    raw: best.raw,
    commentId: best.commentId,
    escalationAt: new Date(escalation.t).toISOString(),
  };
}
function attemptCapDecisionIdentity(d) {
  if (!d || !d.decision || !d.at) return null;
  if (d.commentId) return `id:${d.commentId}`;
  return `at:${d.at}|decision:${d.decision}|raw:${String(d.raw || "")}`;
}
function consumedAttemptCapDecision(state, key, decision) {
  const prior = state?.attemptCapDecisionResets?.[key];
  return !!prior && attemptCapDecisionIdentity(prior) === attemptCapDecisionIdentity(decision);
}
function recordAttemptCapDecisionReset(state, key, decision) {
  state.attemptCapDecisionResets = state.attemptCapDecisionResets && typeof state.attemptCapDecisionResets === "object"
    ? state.attemptCapDecisionResets
    : {};
  state.attemptCapDecisionResets[key] = {
    decision: decision.decision,
    at: decision.at,
    commentId: decision.commentId || null,
    raw: decision.raw || "",
    escalationAt: decision.escalationAt || null,
  };
}
// findPlanDecision returns the OLDEST decision after the plan. A directive the
// owner approved twice - once before the execution cap and once after it, which
// is exactly what KOL-36 did - therefore reports the FIRST approval, and a
// between-the-two test reads false. The question is not which decision the
// classifier picked; it is whether the owner has approved SINCE the cap report.
// So look at the comments directly.
function hasOwnerApprovalAfterExecutionCap(comments, planCommentAt) {
  const planMs = planCommentAt != null ? asMs(planCommentAt) : NaN;
  if (!Number.isFinite(planMs)) return false;
  let capMs = null;
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!isExecutionCapEscalationComment(c)) continue;
    const t = commentTime(c);
    if (t != null && t > planMs && (capMs === null || t > capMs)) capMs = t;
  }
  if (capMs === null) return false;
  for (const c of Array.isArray(comments) ? comments : []) {
    const body = bodyOf(c);
    if (!body.startsWith(DECISION_APPROVE_PREFIX) && !body.includes(APPROVED_MARKER)) continue;
    const t = commentTime(c);
    if (t != null && t > capMs) return true;
  }
  return false;
}

// ---- Stage 2: eligibility -------------------------------------------------
// PURE. A directive is eligible for (re-)planning when its classification state
// is `new` or `stalled` AND its status is todo/backlog. A stalled directive in
// in_progress is report-only (the dead wake marker is evidence of a failed prior
// attempt, but re-planning would trample real work in flight). Everything else
// (awaiting-approval, approved, rejected, done, ignored) is not plannable.
export function isPlannable(issue, state) {
  const status = String(issue?.status || "").toLowerCase();
  const eligibleStatus = status === "todo" || status === "backlog";
  if (state === "new") return eligibleStatus;
  if (state === "stalled") return eligibleStatus;
  return false;
}

// ---- Stage 2: read the owner's answer -------------------------------------
// PURE. Scans comments posted AFTER the plan comment for the owner's decision,
// recognising the EXACT wording telegram-listener.mjs writes when the owner
// taps APPROVE / REJECT on the decision card. Also recognises the legacy
// DIRECTIVE PLAN APPROVED / REJECTED markers for backward compatibility. A
// decision comment whose timestamp predates the plan is ignored. Returns
// { decision: "approved" | "rejected" | null, at, raw }.
export function findPlanDecision(comments, planCommentAt) {
  const cmts = Array.isArray(comments) ? comments : [];
  const planMs = planCommentAt != null ? asMs(planCommentAt) : null;
  for (const c of cmts) {
    const t = commentTime(c);
    if (t == null) continue;
    if (planMs != null && t < planMs) continue; // ignore comments that predate the plan
    const found = decisionFromComment(c);
    if (found) return { ...found, at: new Date(t).toISOString(), commentId: c?.id || null };
  }
  return { decision: null, at: null, raw: null };
}

export function classifyDirective(issue, comments, { now = Date.now, stalledAfterMs = DEFAULT_STALLED_AFTER_MS } = {}) {
  const cmts = commentsOldestFirst(comments);
  const newest = newestComment(cmts);
  const lastCommentAt = newest ? new Date(newest.t).toISOString() : null;
  const status = String(issue?.status || "").toLowerCase();
  const isDirective = hasLabel(issue, "DIRECTIVE");

  if (status === "done" || cmts.some((c) => bodyOf(c).includes(RESULT_MARKER))) {
    return { state: "done", reason: status === "done" ? "status done" : "result marker present", lastCommentAt };
  }
  if (!isDirective) return { state: "ignored", reason: "missing DIRECTIVE label", lastCommentAt };
  if (cmts.some((c) => bodyOf(c).includes(REFUSED_MARKER))) {
    return { state: "rejected", reason: "plan refused marker present", lastCommentAt };
  }

  const planIdx = findLastIndex(cmts, isPlanComment);
  if (planIdx >= 0) {
    const planCommentAt = commentTime(cmts[planIdx]);
    const decision = findPlanDecision(cmts, planCommentAt);
    if (decision.decision === "approved") {
      if (hasOwnerApprovalAfterExecutionCap(cmts, planCommentAt)) {
        return { state: "stalled", reason: "owner approved a re-plan after the execution cap", lastCommentAt, approvedAt: decision.at };
      }
      return { state: "approved", reason: "owner approved via Telegram after plan", lastCommentAt, approvedAt: decision.at };
    }
    if (decision.decision === "rejected") {
      return { state: "rejected", reason: "owner rejected via Telegram after plan", lastCommentAt, approvedAt: decision.at };
    }
    return { state: "awaiting-approval", reason: "plan posted, awaiting owner decision", lastCommentAt };
  }

  const hasWake = cmts.some((c) => bodyOf(c).includes(DISPATCH_MARKER));
  if (hasWake && newest && asMs(now) - newest.t >= stalledAfterMs) {
    return { state: "stalled", reason: "wake marker present and newest comment is stale", lastCommentAt };
  }
  if ((status === "todo" || status === "backlog") && isDirective) {
    return { state: "new", reason: "directive todo/backlog without plan", lastCommentAt };
  }
  return { state: "ignored", reason: `status ${status || "unknown"} is not eligible`, lastCommentAt };
}

function compactJson(v, n = 5000) {
  let s;
  try { s = JSON.stringify(v ?? {}, null, 2); } catch { s = String(v ?? ""); }
  return s.length > n ? s.slice(0, n) + `\n...[truncated ${s.length - n} chars]` : s;
}

function taskTextForIssue(issue) {
  return [issue?.title, issue?.description].map((v) => String(v || "").trim()).filter(Boolean).join("\n\n");
}

async function resolveSpecialistsForIssue(issue, resolver, deps = {}) {
  const log = deps.log || (() => {});
  try {
    return await resolver(taskTextForIssue(issue), deps.specialistDeps || {});
  } catch (err) {
    const ident = issue?.identifier || issue?.id || "unknown";
    log(`directive-runner: specialist resolver failed for ${ident}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

function specialistPromptLines(specialists) {
  const section = String(specialists?.section || "").trim();
  if (!section) return [];
  const hardStops = Array.isArray(specialists?.hardStops) ? specialists.hardStops : [];
  const requiredStandards = Array.isArray(specialists?.requiredStandards) ? specialists.requiredStandards : [];
  return [
    "",
    `Task class: ${specialists?.taskClass || "unclassified"}`,
    "HARD STOPS — do not do these:",
    ...(hardStops.length ? hardStops.map((s) => `- ${s}`) : ["- (none declared)"]),
    "REQUIRED STANDARDS — file paths the plan must obey:",
    ...(requiredStandards.length ? requiredStandards.map((s) => `- ${s}`) : ["- (none declared)"]),
    "",
    section,
  ];
}

export function buildPlanPrompt(issue, contextBundle, lastFailure = null, specialists = null, ventures = []) {
  const ident = issue?.identifier || issue?.id || "unknown";
  const hasLastFailure = lastFailure && typeof lastFailure === "object" && Object.keys(lastFailure).length > 0;
  const previousFailureLines = hasLastFailure
    ? [
      "",
      "PREVIOUS ATTEMPT WAS REJECTED. Read this before writing the new plan:",
      ...(lastFailure.reason != null ? [`- Reason code: ${lastFailure.reason}`] : []),
      ...(lastFailure.detail != null ? [`- Detail: ${lastFailure.detail}`] : []),
      ...(lastFailure.attempt != null ? [`- Attempt: ${lastFailure.attempt}`] : []),
      "Produce a plan that does not repeat this. Do not resubmit the same VERIFY line.",
    ]
    : [];
  return [
    "You are the planning lane for FounderOS-Aidit directive-runner stage 1.",
    "Produce a short approval plan only. Do not execute anything.",
    "Your response MUST be exactly this shape and nothing else:",
    "OBJECTIVE: <one sentence>",
    "FILES: <comma-separated repo-relative paths this plan will touch, or NONE>",
    "STEPS:",
    "- <step>",
    "- <step>",
    "VERIFY: <the single command that proves it worked>",
    "OUT OF SCOPE: <what this deliberately will not do>",
    "RISK: low | medium | high",
    "",
    // The ventures half of this boundary is conditional on the registry. Left
    // unconditional, the planning lane would never propose a venture path and
    // the gate below it would be unreachable — a fence enforced twice, with the
    // outer one making the inner one dead code.
    activeVenturePathsFor(ventures).length
      ? `Hard boundary: repo-relative paths only; under ventures/ ONLY these active venture paths may be touched: ${activeVenturePathsFor(ventures).join(", ")} — anything else under ventures/ is refused; nothing under .git/, .paperclip/; no .env* files; no network; no message to anyone but the owner; no package installs.`
      : "Hard boundary: repo-relative paths only; nothing under ventures/, .git/, .paperclip/; no .env* files; no network; no message to anyone but the owner; no package installs.",
    "VERIFY contract: the VERIFY line MUST be a single command starting with node ops-watcher/.",
    "The VERIFY line must not contain ; & or | - not even inside a quoted argument. Two commands joined by && will be rejected before the owner ever sees the plan.",
    "This applies to the --matches regex too: write a regex without | alternation, or pick a different single command.",
    "Allowed VERIFY for code changes: node ops-watcher/run-all-tests.mjs --only <suite-file>",
    "Allowed VERIFY for file-content directives: node ops-watcher/verify-file.mjs --path <file> --matches <regex>",
    "PowerShell, cmd, bash, git, or any other command will be rejected before the owner sees the plan.",
    "Line contract: VERIFY occupies exactly ONE line, OUT OF SCOPE is the very next line, and RISK the one after that. A VERIFY spread over several lines - a here-string, a backslash continuation, a wrapped command - makes the parser read the continuation where OUT OF SCOPE should be, and the plan is rejected as missing OUT OF SCOPE.",
    "Nothing may follow the RISK line.",
    // REPO_ROOT, not a literal: the prompt tells the lane where the repository
    // physically is, so a stale literal sends it hunting for a folder that does
    // not exist on this machine and it improvises a path instead.
    `Scope is only this repository: ${REPO_ROOT}.`,
    "Write OBJECTIVE, STEPS, VERIFY, and OUT OF SCOPE in professional Bahasa Indonesia. Keep file paths and commands verbatim.",
    ...previousFailureLines,
    ...specialistPromptLines(specialists),
    "",
    `Issue: ${ident}`,
    `Title: ${issue?.title || ""}`,
    "Description:",
    String(issue?.description || ""),
    "",
    "Context bundle:",
    compactJson(contextBundle),
  ].join("\n");
}

export function parsePlan(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").trim().split("\n");
  const fail = (error) => ({ ok: false, error });
  if (lines.length < 6) return fail("plan is too short");
  if (!lines[0].startsWith("OBJECTIVE: ")) return fail("missing OBJECTIVE");
  if (!lines[1].startsWith("FILES: ")) return fail("missing FILES");
  if (lines[2] !== "STEPS:") return fail("missing STEPS");
  const verifyIdx = lines.findIndex((l, i) => i > 2 && l.startsWith("VERIFY: "));
  if (verifyIdx < 0) return fail("missing VERIFY");
  const outIdx = verifyIdx + 1;
  const riskIdx = verifyIdx + 2;
  if (!lines[outIdx] || !lines[outIdx].startsWith("OUT OF SCOPE: ")) return fail("missing OUT OF SCOPE");
  if (!lines[riskIdx] || !lines[riskIdx].startsWith("RISK: ")) return fail("missing RISK");
  if (lines.slice(riskIdx + 1).some((l) => l.trim())) return fail("extra content after RISK");
  const stepLines = lines.slice(3, verifyIdx);
  if (!stepLines.length || stepLines.some((l) => !l.startsWith("- ") || !l.slice(2).trim())) return fail("invalid STEPS");
  const objective = lines[0].slice("OBJECTIVE: ".length).trim();
  const filesRaw = lines[1].slice("FILES: ".length).trim();
  const verify = lines[verifyIdx].slice("VERIFY: ".length).trim();
  const outOfScope = lines[outIdx].slice("OUT OF SCOPE: ".length).trim();
  const risk = lines[riskIdx].slice("RISK: ".length).trim();
  if (!objective) return fail("empty OBJECTIVE");
  if (!filesRaw) return fail("empty FILES");
  if (!verify) return fail("empty VERIFY");
  if (!outOfScope) return fail("empty OUT OF SCOPE");
  if (!/^(low|medium|high)$/.test(risk)) return fail("invalid RISK");
  const files = /^NONE$/i.test(filesRaw) ? [] : filesRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!/^NONE$/i.test(filesRaw) && files.length === 0) return fail("empty file list");
  return { ok: true, objective, files, steps: stepLines.map((l) => l.slice(2).trim()), verify, outOfScope, risk };
}

export function planIdentityKey(plan) {
  const identity = {
    objective: String(plan?.objective || ""),
    files: Array.isArray(plan?.files) ? plan.files.map((f) => String(f)) : [],
    steps: Array.isArray(plan?.steps) ? plan.steps.map((st) => String(st)) : [],
    verify: String(plan?.verify || ""),
    outOfScope: String(plan?.outOfScope || ""),
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 16);
}

// Directories denied ANYWHERE in a path, not only at its head.
//
// This used to be a prefix test, so "ventures" being denied outright also hid a
// hole: ".git" only matched at the start, and a nested "x/.git" or
// "x/node_modules" passed. That hole did not matter while nothing under
// ventures/ was reachable at all. It matters now, because a venture is a whole
// second repository with its own .git and its own node_modules, and the first
// thing a lane reaching into one could otherwise touch is its git directory.
const DENIED_PATH_SEGMENTS = new Set([".git", ".paperclip", "node_modules", "graphify-out"]);

/**
 * The ventures fence, CONDITIONAL on config/ventures.json.
 *
 * The owner approved exactly this: a lane may touch paths under a venture whose
 * status is `active`, and nothing else. It is not a blanket opening of
 * ventures/. A path under ventures/ that resolves to no venture, or to one that
 * is not active, stays denied — and the violation says WHICH, because "denied
 * directory" for both cases is the same answer to two different questions and
 * sends whoever reads it looking in the wrong place.
 *
 * The registry answers this, not a parser here: ops-watcher/ventures.mjs owns
 * what a venture is and which paths belong to it. A second path matcher in this
 * file would be a second source of truth about that.
 *
 * ASYNC because activeVentures/ventureForPath are. The alternative — reading
 * config/ventures.json synchronously in a new place here — is the same second
 * source of truth wearing a different hat. Both callers were already inside
 * async functions, so awaiting costs nothing.
 */
export async function validatePlanScope(plan, deps = {}) {
  const _ventureForPath = deps.ventureForPath || ventureForPath;
  const violations = [];
  for (const raw of Array.isArray(plan?.files) ? plan.files : []) {
    const p = String(raw || "").trim();
    const norm = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\.\/+/, "");
    const low = norm.toLowerCase();
    const parts = norm.split("/").filter(Boolean);
    const add = (why) => violations.push(`${p}: ${why}`);
    if (!p) { add("empty path"); continue; }
    if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\")) add("absolute path");
    if (parts.includes("..") || low.startsWith("../")) add("escapes repository");
    if (parts.some((seg) => DENIED_PATH_SEGMENTS.has(seg.toLowerCase()))) add("denied directory");
    if (low === "ventures" || low.startsWith("ventures/")) {
      // Bare "ventures" itself belongs to no venture and resolves to null, so
      // it is refused as an unknown venture rather than silently allowed.
      const venture = await _ventureForPath(norm, deps);
      if (!venture) add("unknown venture — no venture in config/ventures.json owns this path");
      else if (venture.status !== "active") {
        add(`venture ${venture.id} is not active (status: ${venture.status || "none"})`);
      }
    }
    if (parts.some((seg) => /^\.env/i.test(seg))) add("denied env file");
    if (HARD_DENY.has(low)) add("hard-deny operational file");
  }

  // G3. The venture's uncommitted files are the owner's, and the list is
  // DERIVED at gate time. A literal list would be wrong the moment he commits
  // one of them, and wrong in the dangerous direction.
  const ventures = Array.isArray(deps.ventures) ? deps.ventures : null;
  if (ventures && ventures.length) {
    const uncommitted = (deps.checkUncommittedFiles || checkUncommittedFiles)(
      Array.isArray(plan?.files) ? plan.files : [],
      ventures,
      deps,
    );
    for (const v of uncommitted.violations) violations.push(v);
  }

  // G4, pre-flight half. The half that actually holds is the before/after
  // comparison of the venture's git position, which does not depend on the
  // plan admitting what it intends to do.
  const gitWrites = (deps.checkPlanForVentureGitWrites || checkPlanForVentureGitWrites)(plan);
  for (const v of gitWrites.violations) violations.push(v);

  return { ok: violations.length === 0, violations };
}

// The repo-relative paths a prompt may name, given the resolved active ventures.
// Empty list means the fence is fully closed, which is exactly the behaviour
// before the registry existed — so a caller that does not resolve ventures gets
// the old, closed prompt rather than an accidentally open one.
export function activeVenturePathsFor(ventures) {
  return (Array.isArray(ventures) ? ventures : [])
    .filter((v) => v && v.status === "active")
    .map((v) => String(v.repoPath || "").replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter(Boolean)
    .sort();
}

export function validateVerifyCommand(verify) {
  const raw = String(verify || "");
  const cmd = raw.trim();
  if (!cmd) return { ok: false, reason: "VERIFY is empty" };
  if (/[\r\n]/.test(raw)) return { ok: false, reason: "VERIFY must be a single line" };
  if (!cmd.startsWith("node ops-watcher/")) return { ok: false, reason: "VERIFY must start with node ops-watcher/" };
  if (/[;&|]/.test(cmd)) return { ok: false, reason: "VERIFY must not contain command chaining characters" };
  return { ok: true };
}

function isVerifyFileCommand(verify) {
  const argv = nodeCommandToArgv(verify);
  const script = String(argv[0] || "").replace(/\\/g, "/").replace(/^\.\//, "");
  return script === "ops-watcher/verify-file.mjs";
}

export async function runVerifyFilePreApprovalReal(verify, deps = {}) {
  const argv = nodeCommandToArgv(verify);
  const parsed = parseVerifyFileArgs(argv.slice(1));
  return verifyFileReal(parsed, deps);
}

// A corrupt state file is not the same event as a missing one. Missing is the
// normal first run; corrupt means every attempt counter, plan-failure record and
// consumed-decision marker silently reset to zero, which re-plans directives
// that had already hit their cap and re-fires escalations that were already
// answered. The reset still has to happen — the file is unusable — but it is
// reported now instead of looking like a fresh start.
export function readStateOutcome(err) {
  if (!err) return null;
  if (err.code === "ENOENT") return null;
  return String(err.code || err.message || err);
}
async function loadState(file, _fs) {
  try {
    const st = JSON.parse(await _fs.readFile(file, "utf8"));
    return st && typeof st === "object"
      ? {
        attempts: st.attempts || {},
        lastPlanFailures: st.lastPlanFailures && typeof st.lastPlanFailures === "object" ? st.lastPlanFailures : {},
        executionFailures: st.executionFailures && typeof st.executionFailures === "object" ? st.executionFailures : {},
        attemptCapDecisionResets: st.attemptCapDecisionResets && typeof st.attemptCapDecisionResets === "object" ? st.attemptCapDecisionResets : {},
        pendingCards: st.pendingCards && typeof st.pendingCards === "object" ? st.pendingCards : {},
        lastSweepMs: Number(st.lastSweepMs) || 0,
      }
      : { attempts: {}, lastPlanFailures: {}, executionFailures: {}, attemptCapDecisionResets: {}, pendingCards: {}, lastSweepMs: 0 };
  } catch (err) {
    const empty = { attempts: {}, lastPlanFailures: {}, executionFailures: {}, attemptCapDecisionResets: {}, pendingCards: {}, lastSweepMs: 0 };
    const problem = readStateOutcome(err);
    if (problem) empty.readError = problem;
    return empty;
  }
}
// A swallowed write here is expensive, not merely untidy: attempts[] never
// advances so a directive that has hit maxPlanAttempts is re-planned on every
// sweep — one paid lane call each time — lastSweepMs never persists so the
// --once throttle stops throttling, and attemptCapDecisionResets never persists
// so the escalation idempotency scoping stops working. It reports now, the same
// way the listener surfaces persistError.
async function saveState(file, st, _fs) {
  try {
    await _fs.writeFile(file, JSON.stringify(st, null, 2), "utf8");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: String((err && (err.code || err.message)) || err) };
  }
}
function attemptsKey(issue) { return String(issue?.id || issue?.identifier || "unknown"); }

// ---- Undelivered decision cards -------------------------------------------
// A plan comment that Paperclip stored but whose decision card never reached
// Telegram leaves the directive classified as awaiting-approval while the owner
// has been asked nothing. These three helpers record that gap so a later sweep
// can close it by re-sending the card — the plan is already written, so the
// retry costs no lane call.
function recordPendingCard(state, key, { reason, atMs } = {}) {
  state.pendingCards = state.pendingCards && typeof state.pendingCards === "object" ? state.pendingCards : {};
  const prior = state.pendingCards[key];
  state.pendingCards[key] = {
    reason: reason || "unknown",
    since: prior && prior.since ? prior.since : iso(atMs),
    lastAttemptAt: iso(atMs),
    attempts: (prior && Number(prior.attempts)) ? Number(prior.attempts) + 1 : 1,
  };
  return state.pendingCards[key];
}
function clearPendingCard(state, key) {
  if (state.pendingCards && typeof state.pendingCards === "object") delete state.pendingCards[key];
}
function pendingCardFor(state, key) {
  return state.pendingCards && typeof state.pendingCards === "object" ? state.pendingCards[key] || null : null;
}

// Send a decision card and judge the result in one step. sendDecisionCard is
// crash-proof by contract, but an injected or future sender may still throw,
// and a thrown card must not read differently from a refused one.
async function deliverCard(send) {
  let card;
  try {
    card = await send();
  } catch (err) {
    return { sent: false, reason: String((err && err.message) || err) };
  }
  if (card && card.sent) return { sent: true, reason: null };
  const reason = (card && (card.reason || card.error)) || "sender reported no delivery";
  return { sent: false, reason: String(reason) };
}
function recordPlanFailureAttempt(state, key, prior, failure) {
  const attempt = prior + 1;
  state.attempts[key] = attempt;
  state.lastPlanFailures = state.lastPlanFailures && typeof state.lastPlanFailures === "object" ? state.lastPlanFailures : {};
  state.lastPlanFailures[key] = { ...failure, attempt, at: iso() };
  return attempt;
}
export function recordExecutionFailure(state, issueKey, planKey, { reason, at } = {}) {
  state.executionFailures = state.executionFailures && typeof state.executionFailures === "object" ? state.executionFailures : {};
  const prior = state.executionFailures[issueKey];
  const count = prior && prior.planKey === planKey && Number(prior.count) ? Number(prior.count) + 1 : 1;
  state.executionFailures[issueKey] = {
    planKey,
    reason: reason || "unknown",
    count,
    at: at || iso(),
  };
  return state.executionFailures[issueKey];
}

export function clearExecutionFailures(state, issueKey) {
  if (state.executionFailures && typeof state.executionFailures === "object") delete state.executionFailures[issueKey];
}

export function executionCapReached(state, issueKey, planKey, max = MAX_EXECUTION_ATTEMPTS) {
  const record = state.executionFailures && typeof state.executionFailures === "object" ? state.executionFailures[issueKey] : null;
  return !!record && record.planKey === planKey && Number(record.count) >= max;
}
function cap(s, n = OUTPUT_CAP) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + `\n...[truncated ${s.length - n} chars]` : s;
}

async function bounded(label, fn, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, value: null, error: `${label} timeout` }), timeoutMs);
  });
  try {
    const value = await Promise.race([Promise.resolve().then(fn), timeout]);
    clearTimeout(timer);
    return value && value.ok === false ? value : { ok: true, value, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, value: null, error: err && err.message ? err.message : String(err) };
  }
}

export function dispatchPlanReal(prompt, { timeoutMs = PLAN_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", child, settled = false, timedOut = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    try {
      child = spawn(process.execPath, [path.join(__dirname, "corleone-dispatch.mjs"), prompt], {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      finish({ ok: false, stdout: "", stderr: "", timedOut: false, error: err && err.message ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => { clearTimeout(timer); finish({ ok: false, stdout, stderr, timedOut, error: err && err.message ? err.message : String(err) }); });
    child.on("close", (code) => { clearTimeout(timer); finish({ ok: code === 0 && !timedOut, stdout, stderr, timedOut, error: timedOut ? "timeout" : code === 0 ? null : `exit_${code}` }); });
  });
}

function refusalComment(violations, attempt, max, reason) {
  return [
    `${REFUSED_MARKER} (${iso()}): rencana ditolak otomatis sebelum dikirim ke owner.`,
    `Alasan: rencana gagal validasi aman directive-runner tahap 1 (${reason || "tidak diketahui"}). Percobaan ${attempt}/${max}.`,
    "Pelanggaran:",
    ...violations.map((v) => `- ${v}`),
  ].join("\n");
}
// Stage 2: when re-planning a stalled directive, the plan comment opens with one
// Indonesian line noting that a previous dispatch attempt left no result and this
// is a fresh attempt. The dead wake marker is evidence of a failed previous
// attempt, not a reason to skip.
function planComment(planText, { stalled = false } = {}) {
  const header = `${PLAN_MARKER} (${iso()}):`;
  if (stalled) {
    const note = "Upaya dispatch sebelumnya tidak meninggalkan hasil; ini adalah upaya rencana yang baru.";
    return `${header}\n${note}\n${String(planText || "").trim()}`;
  }
  return `${header}\n${String(planText || "").trim()}`;
}
function parseFailureComment(error, attempt, max) {
  return `DIRECTIVE DRAFT FAILED (${iso()}): rencana belum bisa diproduksi dalam format yang valid (${error}). Percobaan ${attempt}/${max}. Issue tetap menunggu rencana.`;
}
function inferLastPlanFailure(comments) {
  for (let i = (comments || []).length - 1; i >= 0; i--) {
    const b = bodyOf(comments[i]);
    if (b.trim().startsWith("DIRECTIVE DRAFT FAILED")) return { reason: "parse-failed" };
    if (b.includes(REFUSED_MARKER)) {
      return /VERIFY:/i.test(b) ? { reason: "verify-out-of-scope" } : { reason: "file-scope-out-of-scope" };
    }
  }
  return { reason: "unknown" };
}
function plainPlanFailureReason(failure) {
  const reason = String(failure?.reason || failure || "");
  if (reason === "verify-out-of-scope") {
    return "perintah verifikasi di rencana berada di luar bentuk aman yang boleh dijalankan";
  }
  if (reason === "file-scope-out-of-scope") {
    return "daftar file rencana keluar dari batas aman repo atau menyentuh file operasional yang dilarang";
  }
  if (reason === "parse-failed") {
    return "rencana yang dihasilkan belum bisa dibaca dalam format directive yang valid";
  }
  return "rencana terakhir belum bisa melewati validasi aman directive-runner";
}
function attemptCapComment({ attempts, failure, nowMs }) {
  return [
    `${ATTEMPT_CAP_MARKER} (${iso(nowMs)}): directive perlu keputusan owner.`,
    "",
    `Directive ini belum bisa direncanakan atau dijalankan setelah ${attempts} percobaan.`,
    `Alasan terakhir: ${plainPlanFailureReason(failure)}.`,
    "",
    "Owner bisa memberi arahan yang lebih spesifik agar rencana baru dapat dibuat dengan aman, atau menutup issue ini jika sudah tidak perlu dilanjutkan.",
  ].join("\n");
}

// ---- Stage 2: deliver the plan to the owner as a decision card -------------\n// Builds the phone-screen summary card text in professional Indonesian: issue
// identifier + title, the plan's OBJECTIVE, file count, the VERIFY command, and
// the RISK level. The full plan stays in the Paperclip comment; the card is the
// summary plus the two buttons.
// Telegram hard-caps a message at 4096 characters. The card is built to stay
// well inside that on its own, and the pieces that can run long — the file list
// and the steps — are capped item-by-item so a large plan degrades into "and N
// more" instead of failing to send.
const CARD_MAX_FILES = 8;
const CARD_MAX_STEPS = 6;
const CARD_LINE_CAP = 160;

function cardLine(value) {
  const one = String(value ?? "").replace(/\s+/g, " ").trim();
  const capped = one.length > CARD_LINE_CAP ? one.slice(0, CARD_LINE_CAP - 1) + "…" : one;
  return escapeMarkdown(capped);
}

function cardList(items, cap) {
  const list = Array.isArray(items) ? items.filter((x) => String(x ?? "").trim()) : [];
  if (list.length === 0) return ["  (tidak ada)"];
  const shown = list.slice(0, cap).map((x) => `  • ${cardLine(x)}`);
  if (list.length > cap) shown.push(`  • …dan ${list.length - cap} lagi (ketuk LIHAT DETAIL)`);
  return shown;
}

// The owner is being asked to authorise work. An approval gate has to show what
// will change, not how much will change: the previous card sent "Jumlah file: 3"
// and nothing else, so approving it meant approving files the owner could not
// see. Named files, named steps, and the out-of-scope line are the three things
// that make the answer an informed one.
export function buildDecisionCardText(issue, plan) {
  const ident = issue?.identifier || issue?.id || "unknown";
  const title = String(issue?.title || "(tanpa judul)");
  const files = Array.isArray(plan?.files) ? plan.files : [];
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  return [
    "📋 Rencana directive butuh keputusan Anda",
    "",
    `${cardLine(ident)} — ${cardLine(title)}`,
    "",
    `Tujuan: ${cardLine(plan?.objective)}`,
    "",
    `File yang akan diubah (${files.length}):`,
    ...cardList(files, CARD_MAX_FILES),
    "",
    `Langkah (${steps.length}):`,
    ...cardList(steps, CARD_MAX_STEPS),
    "",
    `Sengaja TIDAK dikerjakan: ${cardLine(plan?.outOfScope) || "(tidak dinyatakan)"}`,
    `Verifikasi: ${cardLine(plan?.verify)}`,
    `Risiko: ${cardLine(plan?.risk) || "low"}`,
    "",
    "SETUJUI menjalankan rencana ini. TOLAK meminta rencana baru — Anda akan diminta alasannya.",
  ].join("\n");
}

// Reuses telegram-notify.mjs's documented callback_data scheme exactly:
//   APPROVE -> "a:<shortId>"   REJECT -> "r:<shortId>"
// No second scheme, no second sender — the existing telegram-listener already
// maps these back to the issue and writes the decision comment findPlanDecision
// reads.
// The listener already speaks a richer vocabulary than the card ever offered:
// ACTION_LETTERS in telegram-listener.mjs maps a=APPROVE, r=REJECT, d=DETAILS,
// z=DEFER. The card only ever sent a: and r:, so DETAILS and DEFER existed and
// were unreachable. Four actions, laid out two per row so the destructive one is
// not adjacent to the harmless one.
export function buildDecisionCardButtons(shortId) {
  return [
    [
      { text: "✅ SETUJUI", callback_data: `a:${shortId}` },
      { text: "📄 LIHAT DETAIL", callback_data: `d:${shortId}` },
    ],
    [
      { text: "✏️ TOLAK + ALASAN", callback_data: `r:${shortId}` },
      { text: "🕒 TUNDA", callback_data: `z:${shortId}` },
    ],
  ];
}

// The default decision-card sender: reuses telegram-client.sendMessage (the same
// sender telegram-notify.mjs uses) with the card text + buttons. Returns
// { sent: boolean, ... } (never throws; sendMessage is crash-proof). If the token
// is absent or Telegram is unreachable, sent is false — the caller records
// `card-failed` and the plan comment still stands.
export async function sendDecisionCardReal({ issue, plan, telegramBase } = {}) {
  const shortId = issue?.identifier || issue?.id;
  if (!shortId) return { sent: false, reason: "no identifier" };
  const text = buildDecisionCardText(issue, plan);
  const buttons = buildDecisionCardButtons(shortId);
  return telegramSendMessage(text, { buttons, baseUrl: telegramBase });
}

// ---- Stage 3b: outcome comment builders -----------------------------------
// These build the Paperclip comment bodies for each execution outcome. Only the
// `done` comment carries RESULT_MARKER (which classifyDirective treats as the
// "done" signal on the next sweep); the no-op and failure comments deliberately
// avoid RESULT_MARKER so the directive stays classified as `approved` until the
// owner re-evaluates or a later sweep re-executes.
function doneResultComment({ filesChanged, verifyCmd, verifyTail, outOfScope, nowMs }) {
  const files = Array.isArray(filesChanged) ? filesChanged : [];
  return [
    `${RESULT_MARKER} (${iso(nowMs)}): directive telah dikerjakan dan diverifikasi.`,
    "",
    "File yang berubah:",
    ...(files.length ? files.map((f) => `- ${f}`) : ["- (tidak ada file yang dilaporkan berubah)"]),
    "",
    `Perintah verifikasi: ${verifyCmd}`,
    "Baris terakhir output verifikasi:",
    String(verifyTail || "").trim() || "(tidak ada output)",
    "",
    `Yang sengaja tidak dikerjakan: ${outOfScope || "(tidak dinyatakan)"}`,
  ].join("\n");
}
function noOpComment({ nowMs }) {
  return [
    `DIRECTIVE NO-OP (${iso(nowMs)}): eksekusi directive berjalan namun tidak ada perubahan yang terjadi.`,
    "",
    "Tidak ada file dari daftar rencana yang berubah setelah dispatch dan verifikasi.",
    "Status issue tidak diubah; directive dapat dievaluasi atau direncanakan ulang jika diperlukan.",
  ].join("\n");
}
function failureComment({ outcome, reason, nowMs }) {
  return [
    `DIRECTIVE GAGAL (${iso(nowMs)}): directive tidak dapat diselesaikan (hasil: ${outcome}).`,
    `Alasan: ${reason || "tidak diketahui"}.`,
    "Semua perubahan telah dikembalikan jika ada; status issue tetap tidak diubah.",
  ].join("\n");
}
function unexecutableComment({ reason, detail, nowMs }) {
  return [
    UNEXECUTABLE_MARKER + " (" + iso(nowMs) + "): directive ini sudah OWNER setujui, tetapi rencananya tidak dapat dibaca sehingga eksekusi tidak dijalankan.",
    "Alasan: " + reason + ".",
    detail ? "Detail: " + detail + "." : null,
    "Tidak ada perubahan yang dilakukan dan status issue tidak diubah. Kirim ulang rencana yang valid, lalu setujui kembali.",
  ].filter(Boolean).join("\n");
}
function failureTelegramText({ identifier, outcome, reason }) {
  return `Directive ${identifier} tidak dapat diselesaikan (${outcome}): ${reason || "tidak diketahui"}. Status tetap approved; tidak ada perubahan yang dipertahankan.`;
}

export async function runDirectiveSweepOnce(deps = {}) {
  const summary = {
    scanned: 0, planned: 0, refused: 0,
    stalled: [], awaitingApproval: [], approved: [], rejected: [], unexecutable: [],
    persistError: null, stateReadError: null,
    executed: 0, reverted: 0, noop: 0, refused: 0,
    cardsRetried: 0,
    errors: [],
  };
  // Resolved ONCE per sweep, before any issue is planned. The planning prompt
  // and the scope gate must be told the same thing about which ventures are
  // active; re-reading per issue would let a mid-sweep edit to
  // config/ventures.json give one directive a boundary another never saw.
  const sweepVentures = await (deps.activeVentures || activeVentures)(deps);

  const {
    base: injectedBase,
    companyId = CANONICAL_COMPANY_ID,
    listIssues: listIssuesFn = listIssues,
    httpGet: _get = httpGet,
    httpPost: _post = httpPost,
    httpPatch: _patch = httpPatch,
    retrieveContext = retrieveDispatchContext,
    dispatchPlan = dispatchPlanReal,
    runVerifyFilePreApproval = runVerifyFilePreApprovalReal,
    sendDecisionCard = sendDecisionCardReal,
    telegramBase,
    execute = async () => ({ ok: false, reason: "stage-2-no-execution" }),
    // Stage 3b execution + outbound seams:
    executeDirective,
    sendOwnerMessage,
    patchIssue,
    addIssueLabel,
    labelMap = { doneVerified: "DONE_VERIFIED" },
    executeDirectiveDeps,
    stateFile = STATE_FILE,
    _fs = fs,
    now = Date.now,
    stalledAfterMs = DEFAULT_STALLED_AFTER_MS,
    maxPlansPerSweep = DEFAULT_MAX_PLANS_PER_SWEEP,
    maxPlanAttempts = DEFAULT_MAX_PLAN_ATTEMPTS,
    once = false,
    dryRun = false,
    log = () => {},
    appendEvidence: appendEvidenceFn = defaultAppendEvidence,
    evidenceLogFile,
    resolveSpecialistsForPacket: resolveSpecialists = resolveSpecialistsForPacket,
    specialistDeps,
  } = deps;

  // Evidence seam for the sweep itself. executeApprovedDirective already writes
  // one line per execution outcome; the sweep needs the same for the outcomes
  // that never reach execution.
  const sweepEvidenceDeps = { appendFile: deps.appendFile, now };
  if (evidenceLogFile) sweepEvidenceDeps.file = evidenceLogFile;
  async function emitSweepEvidence(record) {
    try { await appendEvidenceFn(record, sweepEvidenceDeps); }
    catch { /* evidence is best-effort; never let it surface */ }
  }

  // Persist and say so if it did not stick. Reported once per sweep: a failing
  // disk fails every write in the same sweep, and ten identical lines say
  // nothing the first one did not.
  async function persistState(st) {
    const r = await saveState(stateFile, st, _fs);
    if (!r.ok && !summary.persistError) {
      summary.persistError = r.error;
      summary.errors.push(`state write failed: ${r.error} — attempt caps, sweep throttle and escalation dedupe will not persist`);
      log(`directive-runner: STATE WRITE FAILED (${r.error}) — attempt caps and sweep throttle will not persist`);
    }
    return r;
  }

  // Sweep throttle for the --once path: planning and executing each cost a real
  // lane call while the heartbeat fires every five minutes, so a back-to-back
  // invocation within SWEEP_MIN_INTERVAL_MS is a no-op that touches no lane.
  if (once) {
    const throttleState = await loadState(stateFile, _fs);
    const lastSweepMs = Number(throttleState.lastSweepMs) || 0;
    const nowMs = asMs(now);
    if (lastSweepMs && nowMs - lastSweepMs < SWEEP_MIN_INTERVAL_MS) {
      const nextIso = iso(lastSweepMs + SWEEP_MIN_INTERVAL_MS);
      log(`directive-runner: skipped (next run after ${nextIso})`);
      return { skipped: true };
    }
  }

  try {
    const base = injectedBase !== undefined ? injectedBase : await (async () => {
      const port = await discoverPaperclipPort();
      return port ? `http://127.0.0.1:${port}` : null;
    })();
    if (!base) {
      summary.errors.push("no Paperclip base resolved");
      return summary;
    }
    const issuesRes = await listIssuesFn(base, companyId);
    if (issuesRes.networkError) {
      summary.errors.push(`issues list network error: ${issuesRes.networkErrorMessage}`);
      return summary;
    }
    if (issuesRes.authRequired) {
      summary.errors.push("issues list auth required");
      return summary;
    }
    const issues = Array.isArray(issuesRes.issues) ? issuesRes.issues : [];
    const state = dryRun ? { attempts: {}, lastPlanFailures: {} } : await loadState(stateFile, _fs);
    if (state.readError) {
      summary.stateReadError = state.readError;
      summary.errors.push(`state read failed: ${state.readError} — attempt counters and escalation dedupe restarted from empty`);
      log(`directive-runner: STATE READ FAILED (${state.readError}) — counters restarted from empty`);
    }
    const addOwnerRequiredLabelFn = addIssueLabel || (async (iss, label) => addIssueLabelReal(base, companyId, iss, label, "#b91c1c"));
    let plannedThisSweep = 0;
    // Approved directives captured here (issue + parsed plan) for the stage 3b
    // execution pass that runs AFTER the planning loop. Only directives whose
    // plan comment parses to a valid plan are eligible for execution.
    const approvedForExecution = [];

    for (const issue of issues) {
      if (!hasLabel(issue, "DIRECTIVE")) continue;
      const ident = issue.identifier || issue.id;
      const key = attemptsKey(issue);
      summary.scanned += 1;
      let comments = [];
      try {
        const cRes = await _get(`${base}/api/issues/${issue.id}/comments`);
        if (cRes.networkError) {
          summary.errors.push(`${ident}: comments network error: ${cRes.networkErrorMessage}`);
          continue;
        }
        comments = commentsOldestFirst(Array.isArray(cRes.body) ? cRes.body : []);
      } catch (err) {
        summary.errors.push(`${ident}: comments fetch threw: ${err && err.message ? err.message : err}`);
        continue;
      }
      if (!dryRun && Number(state.attempts[key] || 0) >= maxPlanAttempts) {
        const capDecision = findAttemptCapDecision(comments);
        if (capDecision.decision && !consumedAttemptCapDecision(state, key, capDecision)) {
          state.attempts[key] = 0;
          recordAttemptCapDecisionReset(state, key, capDecision);
          await persistState(state);
          log(`directive-runner: ${ident} owner ${capDecision.decision} after attempt-cap escalation; reset plan attempts`);
        }
      }

      const cls = classifyDirective(issue, comments, { now, stalledAfterMs });
      log(`directive-runner: ${ident} -> ${cls.state} (${cls.reason})`);

      // Report-only buckets: no planning, no execution in stage 2.
      if (cls.state === "stalled") {
        // Only in_progress stalled is report-only; todo/backlog stalled is
        // plannable and falls through to the planning path below.
        if (!isPlannable(issue, cls.state)) {
          summary.stalled.push({ id: issue.id, identifier: ident, lastCommentAt: cls.lastCommentAt, reason: cls.reason });
          continue;
        }
      } else if (cls.state === "awaiting-approval") {
        summary.awaitingApproval.push({ id: issue.id, identifier: ident, lastCommentAt: cls.lastCommentAt, reason: cls.reason });
        // "Awaiting the owner's approval" is only true if the owner was ever
        // shown the plan. When a previous sweep's decision card did not go out,
        // this directive is not waiting on him — it is stranded. Re-send the
        // card from the plan comment that already exists. No lane call, no new
        // plan, and the retry stops as soon as one card is delivered.
        if (!dryRun && pendingCardFor(state, key)) {
          const capture = capturePlanForExecution(comments);
          if (!capture.ok) {
            log(`directive-runner: ${ident} card retry skipped — stored plan unreadable (${capture.reason})`);
          } else {
            const retry = await deliverCard(() => sendDecisionCard({ issue, plan: capture.plan, telegramBase }));
            if (retry.sent) {
              clearPendingCard(state, key);
              summary.cardsRetried += 1;
              log(`directive-runner: ${ident} decision card re-sent after an earlier delivery failure`);
            } else {
              recordPendingCard(state, key, { reason: retry.reason, atMs: asMs(now) });
              summary.errors.push(`${ident}: card-retry-failed (${retry.reason})`);
              log(`directive-runner: ${ident} decision card retry failed (${retry.reason}) — still queued`);
            }
            await persistState(state);
          }
        }
        continue;
      } else if (cls.state === "approved") {
        summary.approved.push({ id: issue.id, identifier: ident, lastCommentAt: cls.lastCommentAt, reason: cls.reason, approvedAt: cls.approvedAt });
        // Stage 3b: capture the parsed plan from the plan comment for the
        // execution pass below. The plan comment body starts with PLAN_MARKER
        // and an ISO stamp, optionally followed by a stalled note; we slice
        // from the OBJECTIVE line so that note (if any) is skipped.
        //
        // Every branch that fails to produce a plan must say so. This used to
        // fall through to `continue` with no comment, no evidence and no log
        // line, so an approval the owner had already given simply vanished
        // (KOL-73: a stored plan with a multi-line PowerShell VERIFY fails
        // parsePlan with "missing OUT OF SCOPE"). The capture runs even under
        // dryRun so a dry sweep still reports the problem; only the comment and
        // the evidence write are suppressed.
        const capture = capturePlanForExecution(comments);
        if (capture.ok) {
          approvedForExecution.push({ issue, plan: capture.plan, identifier: ident });
          continue;
        } else {
          summary.unexecutable.push({
            id: issue.id,
            identifier: ident,
            reason: capture.reason,
            detail: capture.detail || null,
            approvedAt: cls.approvedAt || null,
          });
          log(`directive-runner: ${ident} approved but not executable (${capture.reason}${capture.detail ? ": " + capture.detail : ""})`);
          if (!dryRun) {
            await emitSweepEvidence({
              type: "directive-capture-failed",
              identifier: ident,
              reason: capture.reason,
              detail: capture.detail || null,
              approvedAt: cls.approvedAt || null,
            });
            if (!hasUnexecutableReportAfter(comments, cls.approvedAt)) {
              const post = await _post(`${base}/api/issues/${issue.id}/comments`, {
                body: unexecutableComment({ reason: capture.reason, detail: capture.detail, nowMs: asMs(now) }),
                authorType: "user",
              });
              const posted = judgeWrite(post);
              if (!posted.ok) summary.errors.push(`${ident}: unexecutable comment NOT posted (${posted.reason})`);
            }
            // Reporting makes the failure visible; only a new plan finishes the
            // work the owner already approved. So the directive is returned to
            // the ordinary planning path below rather than left reported and
            // stuck forever. That path counts the attempt against
            // maxPlanAttempts and escalates at the cap, so this cannot loop, and
            // the replacement plan goes back to the owner as a fresh decision
            // card — nothing executes on an approval the owner gave to a plan
            // that turned out to be unreadable.
            recordPlanFailureAttempt(state, key, Number(state.attempts[key] || 0), {
              reason: "approved-plan-unparseable",
              detail: capture.detail || capture.reason,
            });
            await persistState(state);
          } else {
            // A dry sweep reports and stops: re-planning costs a paid lane call.
            continue;
          }
        }
      } else if (cls.state === "rejected") {
        summary.rejected.push({ id: issue.id, identifier: ident, lastCommentAt: cls.lastCommentAt, reason: cls.reason });
        continue;
      } else if (cls.state !== "new") {
        // done, ignored, etc.
        continue;
      }

      // Plannable: cls.state is "new", a plannable "stalled", or an
      // "approved" whose stored plan could not be read and was returned
      // here by the branch above.
      const prior = Number(state.attempts[key] || 0);
      if (prior >= maxPlanAttempts) {
        log(`directive-runner: ${ident} reached plan attempt cap (${prior}/${maxPlanAttempts})`);
        // Idempotency is scoped to the owner's most recent decision, not to all
        // time. Once the owner has decided on a previous escalation, the sticky
        // owner-required label and the old escalation comment are evidence of
        // THAT round, not this one — so only an escalation comment newer than
        // the decision may suppress a new one. Without this, an approved retry
        // that fails again goes permanently silent.
        const priorDecision = findAttemptCapDecision(comments);
        const decisionAtMs = priorDecision.at ? Date.parse(priorDecision.at) : NaN;
        const newestEscalation = newestAttemptCapEscalation(comments);
        const alreadyEscalated = Number.isFinite(decisionAtMs)
          ? !!(newestEscalation && newestEscalation.t > decisionAtMs)
          : (hasLabel(issue, OWNER_REQUIRED_LABEL) || !!newestEscalation);
        if (!dryRun && !alreadyEscalated) {
          let labelOk = false;
          try {
            const labelRes = await addOwnerRequiredLabelFn(issue, OWNER_REQUIRED_LABEL);
            // Success must be explicit. The previous form treated anything that
            // was not a *network* error as success, so the 404 from the old
            // label endpoint counted as OK: the escalation comment was posted
            // while the label never landed, which both hid the failure and made
            // the issue look already-escalated forever after. Verified on KOL-68.
            if (labelRes && labelRes.ok === true) {
              labelOk = true;
            } else {
              const why = labelRes && (labelRes.reason || labelRes.networkErrorMessage)
                ? (labelRes.reason || labelRes.networkErrorMessage)
                : "unknown";
              summary.errors.push(`${ident}: owner-required label FAILED (${why}) — no escalation comment posted`);
            }
          } catch (err) {
            summary.errors.push(`${ident}: owner-required label error: ${err && err.message ? err.message : err}`);
          }
          if (labelOk) {
            const failure = state.lastPlanFailures?.[key] || inferLastPlanFailure(comments);
            const post = await _post(`${base}/api/issues/${issue.id}/comments`, {
              body: attemptCapComment({ attempts: prior, failure, nowMs: asMs(now) }),
              authorType: "user",
            });
            const posted = judgeWrite(post);
            if (!posted.ok) summary.errors.push(`${ident}: owner-required comment NOT posted (${posted.reason})`);
          }
        }
        continue;
      }
      // Attempt-cap escalation is cheap owner notification, not a planning
      // dispatch. Keep this budget below the cap check so capped directives
      // cannot be starved forever by earlier issues consuming the plan slot.
      if (plannedThisSweep >= maxPlansPerSweep) continue;
      const stalledRePlan = cls.state === "stalled";

      if (dryRun) {
        log(`directive-runner --dry: would retrieve context, generate plan, and send decision card for ${ident}${stalledRePlan ? " (stalled re-plan)" : ""}`);
        summary.planned += 1;
        plannedThisSweep += 1;
        continue;
      }

      const ctx = await bounded("context retrieval", () => retrieveContext({ issue, targetRole: "CORLEONE", taskKind: "directive-plan", now }), CONTEXT_TIMEOUT_MS);
      const specialists = await resolveSpecialistsForIssue(issue, resolveSpecialists, { log, specialistDeps });
      const prompt = buildPlanPrompt(issue, ctx.ok ? ctx.value : { status: "degraded", error: ctx.error }, state.lastPlanFailures?.[key] || inferLastPlanFailure(comments) || null, specialists, sweepVentures);
      const out = await dispatchPlan(prompt, { issue, timeoutMs: PLAN_TIMEOUT_MS });
      const text = cap(out && out.stdout ? out.stdout : out && out.text ? out.text : "");
      const parsed = parsePlan(text);
      if (!parsed.ok) {
        const attempt = recordPlanFailureAttempt(state, key, prior, { reason: "parse-failed", detail: parsed.error });
        await persistState(state);
        const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: parseFailureComment(parsed.error, attempt, maxPlanAttempts), authorType: "user" });
        const posted = judgeWrite(post);
        if (!posted.ok) summary.errors.push(`${ident}: parse-failure comment NOT posted (${posted.reason})`);
        plannedThisSweep += 1;
        continue;
      }
      const scope = await validatePlanScope(parsed, { ...deps, ventures: sweepVentures });
      if (!scope.ok) {
        const reason = "file-scope-out-of-scope";
        const attempt = recordPlanFailureAttempt(state, key, prior, { reason, violations: scope.violations });
        await persistState(state);
        const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: refusalComment(scope.violations, attempt, maxPlanAttempts, reason), authorType: "user" });
        const posted = judgeWrite(post);
        if (!posted.ok) summary.errors.push(`${ident}: refusal comment NOT posted (${posted.reason})`);
        else summary.refused += 1;
        plannedThisSweep += 1;
        continue;
      }
      const verifyScope = validateVerifyCommand(parsed.verify);
      if (!verifyScope.ok) {
        const reason = "verify-out-of-scope";
        const attempt = recordPlanFailureAttempt(state, key, prior, { reason, detail: verifyScope.reason });
        await persistState(state);
        const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: refusalComment([`VERIFY: ${verifyScope.reason}`], attempt, maxPlanAttempts, reason), authorType: "user" });
        const posted = judgeWrite(post);
        if (!posted.ok) summary.errors.push(`${ident}: refusal comment NOT posted (${posted.reason})`);
        else summary.refused += 1;
        plannedThisSweep += 1;
        continue;
      }
      if (parsed.files.length === 0 && isVerifyFileCommand(parsed.verify)) {
        const preApproval = await runVerifyFilePreApproval(parsed.verify, { issue, plan: parsed, now });
        if (!preApproval || preApproval.ok !== true) {
          const reason = VERIFY_FILE_RED_WITHOUT_FILES_REASON;
          const detail = (preApproval && (preApproval.reason || preApproval.error)) || "verify-file returned red";
          const attempt = recordPlanFailureAttempt(state, key, prior, { reason, detail });
          await persistState(state);
          const post = await _post(`${base}/api/issues/${issue.id}/comments`, {
            body: refusalComment([`VERIFY: ${detail}`], attempt, maxPlanAttempts, reason),
            authorType: "user",
          });
          const posted = judgeWrite(post);
          if (!posted.ok) summary.errors.push(`${ident}: refusal comment NOT posted (${posted.reason})`);
          else summary.refused += 1;
          plannedThisSweep += 1;
          continue;
        }
      }
      const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: planComment(text, { stalled: stalledRePlan }), authorType: "user" });
      // A plan comment is only posted if Paperclip says it stored one. An auth
      // rejection or a 5xx used to read as success here, and everything below
      // — the attempt reset, the decision card, the owner's whole view of this
      // directive — assumed a comment that does not exist.
      const posted = judgeWrite(post);
      if (!posted.ok) {
        summary.errors.push(`${ident}: plan comment NOT posted (${posted.reason})`);
        log(`directive-runner: ${ident} plan comment NOT posted (${posted.reason}) — no card sent, attempt not reset`);
      } else {
        summary.planned += 1;
        state.attempts[key] = 0;
        await persistState(state);
        // Deliver the plan to the owner as a decision card. If the card cannot
        // be sent, the plan comment still stands and the sweep records
        // `card-failed` — never leave the owner with an approved-looking state
        // that was never actually shown to them.
        const delivery = await deliverCard(() => sendDecisionCard({ issue, plan: parsed, telegramBase }));
        if (delivery.sent) {
          clearPendingCard(state, key);
        } else {
          // The directive now classifies as awaiting-approval on a plan the
          // owner never received. Remember that, so the NEXT sweep re-sends the
          // card from the stored plan comment instead of waiting forever for a
          // decision on a question that was never asked. Re-sending costs
          // nothing; re-planning would cost a lane call, so it is not redone.
          recordPendingCard(state, key, { reason: delivery.reason, atMs: asMs(now) });
          summary.errors.push(`${ident}: card-failed (${delivery.reason})`);
          log(`directive-runner: ${ident} decision card failed to send (${delivery.reason}) — plan comment stands, card queued for retry`);
        }
        await persistState(state);
      }
      plannedThisSweep += 1;
    }

    // ---- Stage 3b: execute up to MAX_EXECUTIONS_PER_SWEEP approved directives ----
    // Runs AFTER the planning pass so a single sweep never interleaves planning
    // and execution for the same directive. The executor (executeApprovedDirective)
    // is fully injectable; in production it uses the real snapshot/rollback/lane
    // mechanics. Outbound messaging (comments, Telegram, status patch, label) is
    // owned HERE, not inside the executor.
    if (!dryRun && approvedForExecution.length > 0) {
      const execFn = executeDirective || executeApprovedDirective;
      const sendOwnerMsg = sendOwnerMessage || (async () => ({ sent: false }));
      // PATCH, not POST. The old default POSTed to /api/issues/:id, which is not
      // the update endpoint, and nobody read the reply — so an executed directive
      // got its result comment and its DONE_VERIFIED label while its status
      // stayed 'todo'. Exactly the shape addIssueLabelReal above was already
      // fixed for ("the previous default POSTed /api/issues/:id/labels, which
      // Paperclip answers 404, so the escalation silently never fired"), left
      // behind at this one site. Seen live on KOL-73 at 2026-09-02T06:08Z.
      const patchIssueFn = patchIssue || (async (iss, patch) => _patch(`${base}/api/issues/${iss.id}`, patch));
      const addLabelFn = addIssueLabel || (async (iss, label) => addIssueLabelReal(base, companyId, iss, label, "#b91c1c"));
      const nowMs = asMs(now);
      const executable = [];
      const capped = [];
      for (const item of approvedForExecution) {
        const issueKey = attemptsKey(item.issue);
        const planKey = planIdentityKey(item.plan);
        const enriched = { ...item, issueKey, planKey };
        if (executionCapReached(state, issueKey, planKey, MAX_EXECUTION_ATTEMPTS)) capped.push(enriched);
        else executable.push(enriched);
      }
      for (const item of capped) {
        const { issue: exIssue, identifier: exIdent, issueKey, planKey } = item;
        const record = state.executionFailures && typeof state.executionFailures === "object" ? state.executionFailures[issueKey] : null;
        if (record && record.planKey === planKey && record.capReportedAt) {
          log(`directive-runner: ${exIdent} execution cap already reported (${record.count}/${MAX_EXECUTION_ATTEMPTS})`);
          continue;
        }
        const reason = record && record.reason ? record.reason : "unknown";
        const cpost = await _post(`${base}/api/issues/${exIssue.id}/comments`, {
          body: [
            `${EXECUTION_CAP_MARKER} (${iso(nowMs)}): directive dihentikan setelah ${MAX_EXECUTION_ATTEMPTS} eksekusi gagal identik.`,
            `Alasan terakhir: ${reason}.`,
            "OWNER_REQUIRED ditambahkan agar owner memilih rencana baru, mengubah scope, atau menutup issue.",
          ].join("\n"),
          authorType: "user",
        });
        const cposted = judgeWrite(cpost);
        if (!cposted.ok) summary.errors.push(`${exIdent}: execution-cap comment NOT posted (${cposted.reason})`);
        try {
          const labelAdd = await addLabelFn(exIssue, OWNER_REQUIRED_LABEL);
          if (labelAdd && labelAdd.ok === false) {
            summary.errors.push(`${exIdent}: OWNER_REQUIRED label NOT added (${labelAdd.reason || "unknown"})`);
          }
        } catch (e) { summary.errors.push(`${exIdent}: add owner-required label error: ${e && e.message ? e.message : e}`); }
        if (record && record.planKey === planKey) record.capReportedAt = iso(nowMs);
        await persistState(state);
      }
      // G2. A losing streak stops the night BEFORE anything else is attempted.
      // Two consecutive venture failures halt venture execution until morning,
      // and the halt is a fact that gets said out loud rather than a silence.
      const halt = (deps.ventureHaltCheck || ventureHaltCheck)(state, { now });
      // G1. The nightly ceiling. MAX_EXECUTIONS_PER_SWEEP caps a sweep; the
      // heartbeat runs every five minutes, so it never capped a night.
      const nightly = (deps.nightlyCeilingCheck || nightlyCeilingCheck)(state, { now });

      let toExecute = executable.slice(0, MAX_EXECUTIONS_PER_SWEEP);
      if (halt.halted) {
        // Declined, not dropped. The directives stay approved and executable.
        log(`directive-runner: DECLINING execution — ${halt.reason}`);
        summary.executionDeclined = { kind: "halt", reason: halt.reason, waiting: toExecute.length };
        toExecute = [];
      } else if (!nightly.allowed) {
        log(`directive-runner: DECLINING execution — ${nightly.reason}`);
        summary.executionDeclined = { kind: "nightly-ceiling", reason: nightly.reason, waiting: toExecute.length };
        toExecute = [];
      }

      for (const item of toExecute) {
        const { issue: exIssue, plan: exPlan, identifier: exIdent, issueKey, planKey } = item;
        let result;
        try {
          result = await execFn(exIssue, exPlan, executeDirectiveDeps || { now, resolveSpecialistsForPacket: resolveSpecialists, specialistDeps, log });
        } catch (err) {
          result = { outcome: "aborted", reason: `executor-threw: ${String((err && err.message) || err)}` };
        }
        if (!result || !result.outcome) {
          summary.errors.push(`${exIdent}: execution returned no outcome`);
          continue;
        }
        const outcome = result.outcome;

        // G1 + G2 bookkeeping. Counted whatever the outcome, because an attempt
        // that failed still spent the lane time and the owner's attention the
        // ceiling exists to ration. A no-op is not counted: nothing was tried.
        if (outcome !== "no-op" && outcome !== "skipped") {
          (deps.recordNightlyExecution || recordNightlyExecution)(state, { now });
          const streak = (deps.recordVentureOutcome || recordVentureOutcome)(state, outcome, {
            now,
            reason: `${exIdent} ${outcome}${result.reason ? `: ${result.reason}` : ""}`,
          });
          if (streak.justHalted) {
            log(`directive-runner: VENTURE EXECUTION HALTED — ${streak.reason}`);
            summary.ventureHalt = { reason: streak.reason, consecutiveFailures: streak.consecutiveFailures, identifier: exIdent };
            // The halt is reported to the owner, not left as a log line nobody
            // reads. It is the difference between a system that stopped and a
            // system that went quiet.
            const htg = await deliverAlert(() => sendOwnerMsg(
              `Eksekusi venture DIHENTIKAN sampai pagi: ${streak.consecutiveFailures} kegagalan berturut-turut, terakhir ${exIdent}. Tidak ada directive venture lain yang dijalankan malam ini.`,
            ));
            if (!htg.delivered) summary.errors.push(`${exIdent}: venture-halt telegram NOT sent (${htg.reason})`);
          }
          await persistState(state);
        }

        if (outcome !== "done") {
          recordExecutionFailure(state, issueKey, planKey, {
            reason: `${outcome}${result.reason ? `: ${result.reason}` : ""}`,
            at: iso(nowMs),
          });
          await persistState(state);
        }

        if (outcome === "done") {
          clearExecutionFailures(state, issueKey);
          await persistState(state);
          const body = doneResultComment({
            filesChanged: result.filesChanged,
            verifyCmd: String((exPlan && exPlan.verify) || ""),
            verifyTail: result.verifyTail,
            outOfScope: String((exPlan && exPlan.outOfScope) || ""),
            nowMs,
          });
          const dpost = await _post(`${base}/api/issues/${exIssue.id}/comments`, { body, authorType: "user" });
          const dposted = judgeWrite(dpost);
          if (!dposted.ok) summary.errors.push(`${exIdent}: result comment NOT posted (${dposted.reason})`);
          try {
            const statusPatch = await patchIssueFn(exIssue, { status: "done" });
            const patched = judgeWrite(statusPatch);
            if (!patched.ok) {
              summary.errors.push(`${exIdent}: status NOT set to done (${patched.reason})`);
              log(`directive-runner: ${exIdent} status NOT set to done (${patched.reason}) — the result comment stands`);
            }
          } catch (e) { summary.errors.push(`${exIdent}: patch status error: ${e && e.message ? e.message : e}`); }
          if (labelMap && labelMap.doneVerified) {
            try {
              const labelAdd = await addLabelFn(exIssue, labelMap.doneVerified);
              // addIssueLabelReal reports its own failure as { ok: false, reason }.
              if (labelAdd && labelAdd.ok === false) {
                summary.errors.push(`${exIdent}: DONE_VERIFIED label NOT added (${labelAdd.reason || "unknown"})`);
              }
            } catch (e) { summary.errors.push(`${exIdent}: add label error: ${e && e.message ? e.message : e}`); }
          }
          summary.executed += 1;
        } else if (outcome === "no-op") {
          const body = noOpComment({ reason: result.reason, nowMs });
          const npost = await _post(`${base}/api/issues/${exIssue.id}/comments`, { body, authorType: "user" });
          const nposted = judgeWrite(npost);
          if (!nposted.ok) summary.errors.push(`${exIdent}: no-op comment NOT posted (${nposted.reason})`);
          // Do NOT patch the status — nothing changed.
          summary.noop += 1;
        } else if (outcome === "reverted" || outcome === "refused" || outcome === "aborted") {
          const reason = Array.isArray(result.violations) && result.violations.length
            ? result.violations.join("; ")
            : String(result.reason || "tidak diketahui");
          const body = failureComment({ outcome, reason, nowMs });
          const fpost = await _post(`${base}/api/issues/${exIssue.id}/comments`, { body, authorType: "user" });
          const fposted = judgeWrite(fpost);
          if (!fposted.ok) summary.errors.push(`${exIdent}: failure comment NOT posted (${fposted.reason})`);
          // Exactly ONE Telegram message — no retry loop. sendMessage reports
          // a refused send as { sent: false, reason } instead of throwing, so
          // the catch this replaces covered only a thrown error and a message
          // the API rejected left no trace at all — the owner's single push
          // notification for a failed directive simply never arrived.
          const tg = await deliverAlert(() => sendOwnerMsg(failureTelegramText({ identifier: exIdent, outcome, reason })));
          if (!tg.delivered) summary.errors.push(`${exIdent}: telegram send failed: ${tg.reason}`);
          // Do NOT patch the status. Count by outcome bucket.
          if (outcome === "refused") summary.refused += 1;
          else summary.reverted += 1; // reverted | aborted
        } else if (outcome === "skipped") {
          // Evidence line only: no comment, no message, no status change.
          // executeApprovedDirective already emitted one evidence line internally.
        } else {
          summary.errors.push(`${exIdent}: unknown execution outcome: ${outcome}`);
        }
      }
    }

    // Persist the sweep timestamp so the next --once invocation within
    // SWEEP_MIN_INTERVAL_MS is throttled. Only written for a real (non-dry,
    // once-path) sweep that actually ran.
    if (once && !dryRun) {
      state.lastSweepMs = asMs(now);
      await persistState(state);
    }

    return summary;
  } catch (err) {
    summary.errors.push(err && err.stack ? err.stack : String(err));
    return summary;
  }
}

// ===========================================================================
// Stage 3a — the approved-directive executor.
//
// buildExecutionPrompt is the PURE implementation prompt for the lane.
// executeApprovedDirective is the ordered, never-throwing executor. It reuses
// snapshotFiles / restoreFiles / REPAIR_LANES from the self-repair actuator and
// guardLaneStart / recordLaneOutcome from lane-guard — a directive execution is
// the same snapshot/rollback + two-stage-verify shape as a repair drill, just
// triggered by an owner-approved plan instead of a fault detector.
//
// This function posts NO comments and sends NO Telegram — the sweep (stage 3b)
// owns all outbound messaging. The only side effect here is one evidence line
// per outcome (injectable appendEvidence) and the snapshot/rollback/verify
// mechanics.
// ===========================================================================

function normalizeGraphRepoPath(value) {
  let v = String(value || "").trim().replace(/\\/g, "/");
  if (!v) return "";
  const root = REPO_ROOT.replace(/\\/g, "/");
  if (v.startsWith(`${root}/`)) v = v.slice(root.length + 1);
  if (v.startsWith("./")) v = v.slice(2);
  return v.replace(/^\/+/, "");
}

function graphNodesFromPayload(graph) {
  if (Array.isArray(graph?.nodes)) return graph.nodes;
  if (Array.isArray(graph?.elements?.nodes)) return graph.elements.nodes.map((n) => n?.data || n);
  return [];
}

function graphEdgesFromPayload(graph) {
  if (Array.isArray(graph?.edges)) return graph.edges;
  if (Array.isArray(graph?.links)) return graph.links;
  if (Array.isArray(graph?.elements?.edges)) return graph.elements.edges.map((e) => e?.data || e);
  return [];
}

function compactGraphAnchorText(value, max = 96) {
  const v = String(value || "").replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max - 1)}...` : v;
}

// A LOCATION, OR NOTHING. The fallback chain used to end in node.source_file and
// node.file, so a node carrying no location at all emitted
// `someLabel @ ops-watcher/foo.mjs` — a file path wearing a location's clothes.
// The lane reads that as "here is where to look" and it says nothing of the
// kind. No location is honest; a fake one is not.
export function graphNodeLocation(node) {
  return compactGraphAnchorText(node?.source_location || node?.location || node?.span || "");
}

// First line number in a location string, or null. Handles both shapes the graph
// actually produces: a bare "L46" and a "path/to/file.mjs:17". Untrusted input —
// anything unparseable is null, never a guess.
export function graphAnchorStartLine(location) {
  const text = String(location || "");
  const bare = text.match(/(?:^|[^0-9])L(\d+)/i);
  if (bare) return Number.parseInt(bare[1], 10);
  const colon = text.match(/:(\d+)/);
  if (colon) return Number.parseInt(colon[1], 10);
  return null;
}

// AN ANCHOR NEEDS AN END, NOT JUST A POINT.
//
// A lane handed `L1641` still has to guess how far the symbol runs, so it reads
// a window it picks itself — which is the hunting this feature exists to remove.
// The end is derivable from the graph alone, with no file read: within one file,
// a symbol ends where the next one begins.
//
// Given the sorted distinct start lines of a file, returns "L46-L57" for a
// symbol at 46 whose successor starts at 58. The LAST symbol in a file has no
// successor and keeps its bare start — inventing an end for it would be the
// same dishonesty as the file-path fallback above.
export function graphAnchorRange(location, sortedStarts) {
  const start = graphAnchorStartLine(location);
  if (start === null) return compactGraphAnchorText(location);
  const starts = Array.isArray(sortedStarts) ? sortedStarts : [];
  const next = starts.find((n) => n > start);
  if (!Number.isFinite(next)) return `L${start}`;
  const end = next - 1;
  return end > start ? `L${start}-L${end}` : `L${start}`;
}

// HOW RELEVANT IS THIS ANCHOR TO THE WORK ACTUALLY BEING ASKED FOR?
//
// Selection used to be `a.priority - b.priority || localeCompare`, and nearly
// every node shares a priority, so localeCompare decided. A plan whose title,
// objective and steps ALL named buildExecutionPrompt got __dirname,
// ACTIVE_GRAPH_FILE, addIssueLabelReal, APPROVED_MARKER and asMs — five of six
// clustered at the head of a 2,700-line file, purely for beginning with an
// underscore or the letter A.
//
// Anchors that are merely CORRECT still leave the lane near the work rather than
// on it. Scoring is deterministic, case-insensitive, and deliberately weighted
// so a real name match cannot be outranked by an incidental word.
export const ANCHOR_RELEVANCE_EXACT = 100;
export const ANCHOR_RELEVANCE_SUBSTRING = 60;
export const ANCHOR_RELEVANCE_ALL_PARTS = 40;
export const ANCHOR_RELEVANCE_PER_PART = 8;

/** camelCase / snake_case / kebab-case -> lowercase parts. */
function anchorLabelParts(label) {
  return String(label || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 2);
}

export function scoreAnchorRelevance(label, planText) {
  const name = String(label || "").trim();
  const hay = String(planText || "").toLowerCase();
  if (!name || !hay) return 0;
  const lower = name.toLowerCase();

  // An exact mention wins outright. `buildExecutionPrompt()` in the plan still
  // counts: the trailing parens are stripped by the word-boundary check below.
  const exact = new RegExp(`(^|[^a-z0-9_])${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`);
  if (exact.test(hay)) return ANCHOR_RELEVANCE_EXACT;
  if (hay.includes(lower)) return ANCHOR_RELEVANCE_SUBSTRING;

  // "build execution prompt" should still find buildExecutionPrompt.
  const parts = anchorLabelParts(name);
  if (!parts.length) return 0;
  const hits = parts.filter((p) => hay.includes(p)).length;
  if (hits === 0) return 0;
  if (hits === parts.length) return ANCHOR_RELEVANCE_ALL_PARTS;
  return hits * ANCHOR_RELEVANCE_PER_PART;
}

function graphNodeMatchesFile(node, file) {
  const candidates = [
    node?.source_file,
    node?.file,
    node?.path,
    node?.relative_path,
    node?.source?.file,
    node?.metadata?.source_file,
    node?.metadata?.file,
    node?.source_location,
    node?.location,
  ];
  for (const raw of candidates) {
    const v = normalizeGraphRepoPath(raw);
    if (v === file || v.startsWith(`${file}:`) || v.startsWith(`${file}#`)) return true;
  }
  const id = normalizeGraphRepoPath(node?.id);
  const label = normalizeGraphRepoPath(node?.label || node?.name || node?.title);
  return id === file || label === file;
}

function formatGraphAnchor(node) {
  const label = compactGraphAnchorText(node?.label || node?.name || node?.title || node?.id);
  if (!label) return "";
  const kind = compactGraphAnchorText(node?.type || node?.kind || node?.category, 32);
  const loc = graphNodeLocation(node);
  return [
    label,
    kind ? ` [${kind}]` : "",
    loc ? ` @ ${loc}` : "",
  ].join("");
}

// THE GRAPH MUST BE FRESH, OR IT CONTRIBUTES NOTHING.
//
// graphify-refresh.mjs writes the commit the graph was built at into a stamp
// file beside it. If that stamp does not match the current repo commit, the
// graph describes code that has since moved, and its line numbers point at the
// wrong places.
//
// Anchors that are confidently WRONG are worse than no anchors at all: the lane
// trusts them, edits the wrong location, and nothing anywhere reports that it
// did. A missing or unreadable stamp is treated the same way — an unstamped
// graph is an unknown graph, and treating unknown as fresh is the same bug with
// better manners.
//
// Returns { fresh, graphCommit, repoCommit, reason }. Never throws.
export function graphFreshnessForAnchors(deps = {}) {
  const readText = deps.readText || ((p) => readFileSync(p, "utf8"));
  const graphFile = deps.graphFile || ACTIVE_GRAPH_FILE;
  const stampFile = deps.stampFile || `${graphFile}${GRAPH_STAMP_SUFFIX}`;

  let repoCommit = null;
  try {
    repoCommit = String(deps.repoCommit ?? headCommitForAnchors(deps)).trim() || null;
  } catch {
    repoCommit = null;
  }
  if (!repoCommit) return { fresh: false, graphCommit: null, repoCommit: null, reason: "repo commit unavailable" };

  let graphCommit = null;
  try {
    graphCommit = String(readText(stampFile)).trim() || null;
  } catch {
    return { fresh: false, graphCommit: null, repoCommit, reason: "graph commit stamp missing or unreadable" };
  }
  if (!graphCommit) return { fresh: false, graphCommit: null, repoCommit, reason: "graph commit stamp is empty" };
  if (graphCommit !== repoCommit) {
    return { fresh: false, graphCommit, repoCommit, reason: `graph built at ${graphCommit}, repo is at ${repoCommit}` };
  }
  return { fresh: true, graphCommit, repoCommit, reason: "graph commit matches the repo commit" };
}

function headCommitForAnchors(deps = {}) {
  const exec = deps._exec || execFileSync;
  return String(exec("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" })).trim();
}

function activeGraphAnchorsForFiles(files, deps = {}) {
  if (!files.length) return new Map();
  // Fail CLOSED. Anything other than a proven-fresh graph produces no anchors
  // and the caller falls back to the plain file list, which is exactly today's
  // behaviour and is never wrong, only less helpful.
  const freshness = deps.freshness || graphFreshnessForAnchors(deps);
  if (!freshness.fresh) return new Map();
  const readText = deps.readText || ((p) => readFileSync(p, "utf8"));
  let graph;
  try {
    graph = JSON.parse(readText(deps.graphFile || ACTIVE_GRAPH_FILE));
  } catch {
    return new Map();
  }

  const targets = files.map((f) => normalizeGraphRepoPath(f)).filter(Boolean);
  const anchors = new Map(targets.map((f) => [f, []]));
  const nodes = graphNodesFromPayload(graph);
  const edges = graphEdgesFromPayload(graph);
  const nodeById = new Map(nodes.map((n) => [String(n?.id || ""), n]).filter(([id]) => id));
  const matchingNodeIdsByFile = new Map(targets.map((f) => [f, new Set()]));

  for (const node of nodes) {
    for (const file of targets) {
      if (!graphNodeMatchesFile(node, file)) continue;
      const labelAsPath = normalizeGraphRepoPath(node?.label || node?.name || node?.title);
      const idAsPath = normalizeGraphRepoPath(node?.id);
      const isFileNode = labelAsPath === file || idAsPath === file;
      anchors.get(file).push({ node, priority: isFileNode ? 3 : 0 });
      if (node?.id) matchingNodeIdsByFile.get(file).add(String(node.id));
    }
  }

  for (const edge of edges) {
    const source = String(edge?.source ?? edge?.from ?? "");
    const target = String(edge?.target ?? edge?.to ?? "");
    if (!source || !target) continue;
    for (const file of targets) {
      const matchingIds = matchingNodeIdsByFile.get(file);
      const neighborId = matchingIds.has(source) ? target : matchingIds.has(target) ? source : "";
      const neighbor = neighborId ? nodeById.get(neighborId) : null;
      if (neighbor) anchors.get(file).push({ node: neighbor, priority: 1 });
    }
  }

  const planText = String(deps.planText || "");

  // Every distinct start line per file, ascending. This is what lets an anchor
  // carry an END: within one file a symbol runs until the next one begins, and
  // that is derivable from the graph alone with no file read.
  const startsByFile = new Map();
  for (const file of targets) {
    const set = new Set();
    for (const { node } of anchors.get(file)) {
      const n = graphAnchorStartLine(graphNodeLocation(node));
      if (Number.isFinite(n)) set.add(n);
    }
    startsByFile.set(file, [...set].sort((a, b) => a - b));
  }

  const formatWithRange = (node, file) => {
    const label = compactGraphAnchorText(node?.label || node?.name || node?.title || node?.id);
    if (!label) return "";
    const kind = compactGraphAnchorText(node?.type || node?.kind || node?.category, 32);
    const loc = graphAnchorRange(graphNodeLocation(node), startsByFile.get(file) || []);
    return [label, kind ? ` [${kind}]` : "", loc ? ` @ ${loc}` : ""].join("");
  };

  // Per-file selection, ranked by RELEVANCE first.
  //
  // Precedence: relevance desc, then the existing priority, then localeCompare
  // LAST. That final tiebreak is not optional — an existing test asserts the
  // same inputs produce a byte-identical string, and localeCompare is what keeps
  // equally-scored candidates in a stable order.
  const perFile = new Map();
  for (const file of targets) {
    const seen = new Set();
    const ranked = anchors.get(file)
      .map((entry) => ({
        ...entry,
        text: formatWithRange(entry.node, file),
        score: scoreAnchorRelevance(entry.node?.label || entry.node?.name || entry.node?.title || entry.node?.id, planText),
      }))
      .filter((e) => {
        if (!e.text || seen.has(e.text)) return false;
        seen.add(e.text);
        return true;
      })
      .sort((a, b) => b.score - a.score || a.priority - b.priority || a.text.localeCompare(b.text));

    const nonBare = ranked.filter((e) => normalizeGraphRepoPath(e.text.split(" @ ")[0].replace(/\s+\[[^\]]+\]$/, "")) !== file);
    perFile.set(file, (nonBare.length ? nonBare : ranked).slice(0, GRAPH_ANCHOR_LIMIT_PER_FILE));
  }

  // OVERALL CAP, ENFORCED. GRAPH_ANCHOR_LIMIT_TOTAL was declared with a comment
  // explaining why it matters and referenced NOWHERE, so 20 files produced 120
  // anchors — five times the stated cap. The whole point of anchors is a SMALLER
  // packet; a version that makes it bigger has failed even with perfect anchors.
  //
  // When the budget bites it is spent on the HIGHEST-RANKED anchors across all
  // files, not on whichever files happen to sort first — otherwise the cap
  // silently becomes "the first few files get everything".
  const everything = [];
  for (const file of targets) {
    for (const entry of perFile.get(file)) everything.push({ file, ...entry });
  }
  const keep = new Set(
    everything
      .slice()
      .sort((a, b) => b.score - a.score || a.priority - b.priority || a.text.localeCompare(b.text))
      .slice(0, GRAPH_ANCHOR_LIMIT_TOTAL)
      .map((e) => `${e.file}\0${e.text}`),
  );

  const result = new Map();
  for (const file of targets) {
    result.set(file, perFile.get(file).filter((e) => keep.has(`${file}\0${e.text}`)).map((e) => e.text));
  }
  return result;
}

function formatExecutionFileLine(file, graphAnchors) {
  const normalized = normalizeGraphRepoPath(file);
  const anchors = graphAnchors.get(normalized) || [];
  return anchors.length
    ? `- ${file} (KG anchors from graphify-out/active/graph.json: ${anchors.join("; ")})`
    : `- ${file}`;
}

// Side-effect-free. Returns the implementation prompt for the lane. Contains, in
// order: the issue identifier and title; the plan's OBJECTIVE; the EXACT file
// list (the only files that may change, one per line, with optional anchors from
// graphify-out/active/graph.json); the STEPS; the VERIFY command that must pass;
// and a hard-stop block. Deterministic for the same inputs and graph snapshot.
export function buildExecutionPrompt(issue, plan, specialists = null, ventures = []) {
  const ident = issue?.identifier || issue?.id || "unknown";
  const title = String(issue?.title || "");
  const objective = String(plan?.objective || "");
  const files = Array.isArray(plan?.files) ? plan.files : [];
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const verify = String(plan?.verify || "");
  // The plan text is what makes an anchor RELEVANT rather than merely correct.
  // Passed in, never read from disk and never taken from global state, so
  // buildExecutionPrompt stays pure and deterministic.
  const graphAnchors = activeGraphAnchorsForFiles(files, {
    planText: [title, objective, ...steps].join("\n"),
  });
  const fileLines = files.length
    ? files.map((f) => formatExecutionFileLine(f, graphAnchors)).join("\n")
    : "- (no files declared)";
  const stepLines = steps.length
    ? steps.map((s) => `- ${s}`).join("\n")
    : "- (no steps declared)";
  return [
    `ISSUE: ${ident}`,
    `TITLE: ${title}`,
    "",
    `OBJECTIVE: ${objective}`,
    "",
    "THE EXACT FILES YOU MAY CHANGE (nothing else, listed one per line):",
    fileLines,
    "",
    "STEPS:",
    stepLines,
    "",
    `VERIFY (must pass): ${verify}`,
    "",
    "HARD STOPS — violating any aborts the directive and reverts all changes:",
    "  - No other file may be created, edited, renamed, or deleted besides those listed above.",
    ...(activeVenturePathsFor(ventures).length
      ? [`  - Under ventures/, ONLY these active venture paths may be touched: ${activeVenturePathsFor(ventures).join(", ")}. Anything else under ventures/ aborts the directive.`]
      : ["  - Nothing under ventures/ may be touched."]),
    "  - No network, no HTTP, no Telegram, no Paperclip.",
    "  - No pm2, no git, no shell, no child processes.",
    "  - No package installs; only Node built-ins and existing local modules.",
    "  - Do NOT weaken, skip, comment out, or delete assertions to make the verification pass.",
    ...specialistPromptLines(specialists),
  ].join("\n");
}

// Splits a "node ops-watcher/..." command string into argv, replacing the
// leading "node" with the real executable path for a shell:false spawn.
// Split a VERIFY / execution command into argv.
//
// This used to be split(/\s+/), which shatters any argument containing a space
// and leaves the surrounding quotes attached to the fragments. A real plan hit
// it on 2026-09-02: KOL-73's VERIFY was
//
//   node ops-watcher/verify-file.mjs --path <file> --matches "^AHMAD E2E SOAK TEST PASS - [0-9]{4}..."
//
// and verify-file.mjs received `--matches` followed by `"^AHMAD`, `E2E`,
// `SOAK`, `TEST`, `PASS`, `-`, and the rest as SEVEN separate arguments. The
// pattern never matched, VERIFY went red, and the executor reverted a directive
// whose work was actually correct — the same command passes when run by hand.
//
// Everything here is spawned with shell:false, so nothing downstream interprets
// this string: the only job is grouping. A single- or double-quoted run is ONE
// argument and its surrounding quotes are removed. A backslash is a literal
// character, never an escape, because these commands carry Windows paths.
// An unterminated quote takes the rest of the line rather than dropping it.
export function nodeCommandToArgv(cmd) {
  const src = String(cmd || "");
  const argv = [];
  let cur = "";
  let started = false;
  let quote = null;
  const flush = () => { if (started) argv.push(cur); cur = ""; started = false; };
  for (const ch of src) {
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { flush(); continue; }
    cur += ch;
    started = true;
  }
  flush();
  if (argv[0] === "node") argv.shift();
  return argv;
}

// Shared spawn-with-capture helper used by the default runVerify / runFullSuite
// / dispatchExecution bindings. shell:false, windowsHide:true, a timeout, and
// never throws. Returns { ok, stdout, stderr }.
function spawnCapture(argv, { timeoutMs = EXECUTION_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", timedOut = false, settled = false, child;
    const finish = (r) => { if (settled) return; settled = true; resolve(r); };
    try {
      child = spawn(process.execPath, argv, {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      finish({ ok: false, stdout: "", stderr: String((err && err.message) || err) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* best-effort */ }
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, stderr: stderr + String((err && err.message) || err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0 && !timedOut, stdout, stderr });
    });
  });
}

// Default execution dispatcher factory: spawns process.execPath on the chosen
// lane's wrapper from REPAIR_LANES (repo-relative), shell:false,
// windowsHide:true, 12-minute timeout, never throws. The free-form prompt is
// one argv element.
function makeDefaultDispatchExecution(wrapperRel) {
  return function defaultDispatchExecution(prompt) {
    return spawnCapture([wrapperRel, prompt]);
  };
}

// Default statFile: returns { size, mtimeMs } for a path. Never throws — a
// throw is surfaced as a null entry so the no-op comparison still works.
async function defaultStatFile(file) {
  const st = await fs.stat(file);
  return { size: st.size, mtimeMs: st.mtimeMs };
}

// Ordered. Returns one of the documented outcomes and NEVER throws. Every
// outcome appends exactly one evidence line via the injectable appendEvidence.
// This function posts NO comments and sends NO Telegram.
export async function executeApprovedDirective(issue, plan, deps = {}) {
  const ident = issue?.identifier || issue?.id || "unknown";
  const nowFn = deps.now || Date.now;
  const evidenceDeps = { appendFile: deps.appendFile, now: nowFn };
  if (deps.evidenceLogFile) evidenceDeps.file = deps.evidenceLogFile;
  const appendEvidenceFn = deps.appendEvidence || defaultAppendEvidence;
  const snapshotFn = deps.snapshotFiles || snapshotFiles;
  const restoreFn = deps.restoreFiles || restoreFiles;
  const guardLaneFn = deps.guardLane || defaultGuardLaneStart;
  const recordOutcomeFn = deps.recordOutcome || defaultRecordLaneOutcome;
  const statFileFn = deps.statFile || defaultStatFile;
  const resolveSpecialists = deps.resolveSpecialistsForPacket || resolveSpecialistsForPacket;
  // Resolved ONCE per execution. The registry decides which venture paths this
  // directive may touch, and both the re-validation below and the lane's HARD
  // STOPS must be told the same answer — two reads could disagree mid-run.
  const listVentures = deps.activeVentures || activeVentures;
  const ventures = await listVentures(deps);
  const log = deps.log || (() => {});

  let chosenLane = null;

  async function emit(result) {
    try {
      await appendEvidenceFn({
        type: "directive-execution",
        identifier: ident,
        ...result,
        lane: chosenLane,
      }, evidenceDeps);
    } catch { /* evidence is best-effort; never let it surface */ }
    return result;
  }

  async function statEntry(file) {
    try {
      const st = await statFileFn(file);
      return { file, size: st && st.size, mtimeMs: st && st.mtimeMs };
    } catch {
      return { file, size: null, mtimeMs: null };
    }
  }

  try {
    // 1. Re-validate scope. The plan was written by a model and approved by a
    //    human, and neither is a security boundary.
    const scope = await validatePlanScope(plan, { ...deps, ventures });
    if (!scope.ok) {
      return emit({ outcome: "refused", violations: scope.violations });
    }

    // G4. The venture repository's git position BEFORE anything runs.
    //
    // The "no git" hard stop is prompt text. CORLEONE's workspace-write sandbox
    // and HATTA's path jail happen to cover it; SJAHRIR's compliance is
    // assumed, and assumption is not a fence. Comparing what the repository
    // actually did catches a commit or a push whichever lane made it, and
    // whether or not the plan admitted it would.
    //
    // Only for ventures this plan actually touches — reading git for a venture
    // nobody is editing is cost with no evidence attached.
    const gitPositionFn = deps.ventureGitPosition || ventureGitPosition;
    const planFiles = (Array.isArray(plan?.files) ? plan.files : []).map((f) => String(f || "").replace(/\\/g, "/"));
    const touchedVentures = ventures.filter((v) => {
      const base = String(v?.repoPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
      return base && planFiles.some((f) => f === base || f.startsWith(`${base}/`));
    });
    const gitBefore = touchedVentures.map((v) => ({ venture: v, position: gitPositionFn(v, deps) }));
    for (const entry of gitBefore) {
      if (!entry.position) {
        return emit({
          outcome: "refused",
          violations: [`${entry.venture.id}: cannot read the venture's git position — refusing rather than running unable to prove nothing was committed`],
        });
      }
    }

    // 2. Verify-command guard: VERIFY must start with "node ops-watcher/".
    const verify = String(plan?.verify || "");
    if (!verify.startsWith("node ops-watcher/")) {
      return emit({ outcome: "refused", reason: "verify-out-of-scope" });
    }

    // 3. Lane guard with fallback. Try deps.lane || "corleone"; if it is
    //    skipped, fall back to "hatta". Both unavailable -> skipped.
    const lanePref = deps.lane || "corleone";
    const guardDeps = deps.guardLaneDeps || {};
    chosenLane = lanePref;
    let guard = await guardLaneFn(REPAIR_LANES[lanePref]?.guardName || lanePref, guardDeps);
    if (guard && guard.skip) {
      const fallback = "hatta";
      chosenLane = fallback;
      guard = await guardLaneFn(REPAIR_LANES[fallback]?.guardName || fallback, guardDeps);
      if (guard && guard.skip) {
        return emit({ outcome: "skipped", reason: "lane-" + (guard.reason || "unknown") });
      }
    }
    const lane = REPAIR_LANES[chosenLane];

    // 4. Snapshot the listed files before any dispatch.
    const files = Array.isArray(plan?.files) ? plan.files : [];
    const snapshot = await snapshotFn(files, { now: nowFn, _fs: deps._fs, dir: deps.snapshotDir });
    if (!snapshot || snapshot.ok === false) {
      return emit({ outcome: "aborted", reason: "snapshot-failed" });
    }

    // 5. Capture each listed file's size+mtime BEFORE dispatch.
    const before = [];
    for (const f of files) before.push(await statEntry(f));

    // 6. Dispatch the execution prompt, then record the lane outcome.
    const specialists = await resolveSpecialistsForIssue(issue, resolveSpecialists, { log, specialistDeps: deps.specialistDeps });
    const prompt = buildExecutionPrompt(issue, plan, specialists, ventures);
    const dispatchFn = deps.dispatchExecution || makeDefaultDispatchExecution(lane && lane.wrapper);
    const dispatch = await dispatchFn(prompt);
    await recordOutcomeFn(lane && lane.guardName, {
      ok: !!(dispatch && dispatch.ok),
      stdout: dispatch && dispatch.stdout,
      stderr: dispatch && dispatch.stderr,
    }, deps.recordOutcomeDeps || {});

    // G4, the half that actually holds. Checked BEFORE verify, because a
    // commit or a push to the venture is not something a green suite excuses —
    // it is the one action that leaves this machine, and the snapshot/restore
    // below cannot undo a push.
    const comparePositionFn = deps.compareVentureGitPosition || compareVentureGitPosition;
    for (const entry of gitBefore) {
      const nowPosition = gitPositionFn(entry.venture, deps);
      const cmp = comparePositionFn(entry.position, nowPosition);
      if (!cmp.ok) {
        await restoreFn(snapshot, { _fs: deps._fs });
        return emit({ outcome: "aborted", violations: cmp.violations, reason: "venture-git-write" });
      }
    }

    // 7. Verify stage A: the plan's VERIFY command.
    const runVerifyFn = deps.runVerify || (async (cmd) => spawnCapture(nodeCommandToArgv(cmd)));
    const verifyResult = await runVerifyFn(verify);
    if (!verifyResult || verifyResult.ok !== true) {
      await restoreFn(snapshot, { _fs: deps._fs });
      return emit({ outcome: "reverted", reason: "verify-red" });
    }

    // Verify stage B: the FULL suite.
    const runFullSuiteFn = deps.runFullSuite || (async () => spawnCapture(["ops-watcher/run-all-tests.mjs"]));
    const fullResult = await runFullSuiteFn();
    if (!fullResult || fullResult.ok !== true) {
      await restoreFn(snapshot, { _fs: deps._fs });
      return emit({ outcome: "reverted", reason: "full-suite-red" });
    }

    // 8. Both green but no listed file changed -> no-op. Do not claim work
    //    that did not happen.
    const after = [];
    for (const f of files) after.push(await statEntry(f));
    const filesChanged = [];
    for (let i = 0; i < files.length; i++) {
      const b = before[i], a = after[i];
      if (!b || !a) continue;
      if (b.size !== a.size || b.mtimeMs !== a.mtimeMs) filesChanged.push(files[i]);
    }
    if (filesChanged.length === 0) {
      return emit({ outcome: "no-op" });
    }

    // 9. Done. Report the changed files and the verify tail.
    const verifyOut = String((verifyResult && verifyResult.stdout || "") + (verifyResult && verifyResult.stderr || ""));
    const verifyTail = verifyOut.slice(-400);
    return emit({ outcome: "done", filesChanged, verifyTail });
  } catch (err) {
    // NEVER throws. An unexpected failure is reported as an error outcome with
    // one evidence line; the normal branches above cover the documented shapes.
    return emit({ outcome: "error", reason: String((err && err.message) || err) });
  }
}

function parseArgs(argv) {
  return { once: argv.includes("--once"), dry: argv.includes("--dry") };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once && !args.dry) {
    console.error("usage: node ops-watcher/directive-runner.mjs --once | --dry");
    process.exit(0);
  }
  const summary = await runDirectiveSweepOnce({ dryRun: args.dry, once: args.once, log: (m) => console.log(m) });
  if (summary && summary.skipped) {
    // Throttled: the skip reason was already logged via the log callback.
    process.exit(0);
  }
  console.log(
    `directive-runner ${args.dry ? "--dry" : "--once"}: ` +
    `scanned=${summary.scanned} planned=${summary.planned} refused=${summary.refused} ` +
    `stalled=${summary.stalled.length} awaiting=${summary.awaitingApproval.length} ` +
    `approved=${summary.approved.length} rejected=${summary.rejected.length} ` +
    `executed=${summary.executed} reverted=${summary.reverted} noop=${summary.noop} refused=${summary.refused} ` +
    `unexecutable=${summary.unexecutable.length} cardsRetried=${summary.cardsRetried}`,
    `errors=${summary.errors.length}`,
  );
  for (const s of summary.stalled) console.log(`  stalled: ${s.identifier || s.id} lastCommentAt=${s.lastCommentAt || "none"} reason=${s.reason}`);
  for (const a of summary.awaitingApproval) console.log(`  awaiting: ${a.identifier || a.id} lastCommentAt=${a.lastCommentAt || "none"}`);
  for (const a of summary.approved) console.log(`  approved: ${a.identifier || a.id} approvedAt=${a.approvedAt || "none"}`);
  for (const r of summary.rejected) console.log(`  rejected: ${r.identifier || r.id}`);
  for (const u of summary.unexecutable) console.log(`  unexecutable: ${u.identifier || u.id} reason=${u.reason}${u.detail ? " detail=" + u.detail : ""} approvedAt=${u.approvedAt || "none"}`);
  if (summary.stateReadError) console.log(`  stateReadError: ${summary.stateReadError}`);
  if (summary.persistError) console.log(`  persistError: ${summary.persistError}`);
  for (const e of summary.errors) console.log(`  error: ${e}`);
  process.exit(0);
}

const isEntry = (() => {
  try { return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isEntry) main().catch((err) => {
  console.error("directive-runner fatal:", err && err.stack ? err.stack : err);
  process.exit(0);
});
