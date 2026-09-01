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
//   - issue patch (3b):       patchIssue (defaults to httpPost /api/issues/:id)
//   - issue label (3b):       addIssueLabel (defaults to httpPost /api/issues/:id/labels)
//   - label map (3b):         labelMap (default { doneVerified: "DONE_VERIFIED" })

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  discoverPaperclipPort,
  httpGet,
  httpPost,
  listIssues,
  CANONICAL_COMPANY_ID,
} from "./paperclip-write-client.mjs";
import { retrieveDispatchContext } from "./ahmad-context-retrieval.mjs";
import { sendMessage as telegramSendMessage } from "./telegram-client.mjs";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const STATE_FILE = path.join(__dirname, "directive-runner-state.json");

export const PLAN_MARKER = "DIRECTIVE PLAN";
export const APPROVED_MARKER = "DIRECTIVE PLAN APPROVED";
export const REJECTED_MARKER = "DIRECTIVE PLAN REJECTED";
export const RESULT_MARKER = "DIRECTIVE RESULT";
export const REFUSED_MARKER = "PLAN_REFUSED";
export const DISPATCH_MARKER = "AHMAD DISPATCH";
const ATTEMPT_CAP_MARKER = "DIRECTIVE OWNER REQUIRED";
const OWNER_REQUIRED_LABEL = "OWNER_REQUIRED";
export const DEFAULT_STALLED_AFTER_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_MAX_PLANS_PER_SWEEP = 1;
export const DEFAULT_MAX_PLAN_ATTEMPTS = 2;
// Stage 3b: at most this many approved directives are executed per sweep. A
// directive execution is one real lane dispatch (same cost shape as a repair
// drill), so the cap stays at 1 to keep the sweep bounded and auditable.
export const MAX_EXECUTIONS_PER_SWEEP = 1;
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
function findLastIndex(comments, pred) {
  for (let i = (comments || []).length - 1; i >= 0; i--) if (pred(comments[i])) return i;
  return -1;
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
    const body = bodyOf(c);
    if (body.startsWith(DECISION_APPROVE_PREFIX) || body.includes(APPROVED_MARKER)) {
      return { decision: "approved", at: new Date(t).toISOString(), raw: body };
    }
    if (body.startsWith(DECISION_REJECT_PREFIX) || body.includes(REJECTED_MARKER) || /\bREJECT(?:ED)?\b/i.test(body)) {
      return { decision: "rejected", at: new Date(t).toISOString(), raw: body };
    }
  }
  return { decision: null, at: null, raw: null };
}

export function classifyDirective(issue, comments, { now = Date.now, stalledAfterMs = DEFAULT_STALLED_AFTER_MS } = {}) {
  const cmts = Array.isArray(comments) ? comments : [];
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

export function buildPlanPrompt(issue, contextBundle) {
  const ident = issue?.identifier || issue?.id || "unknown";
  return [
    "You are the planning lane for FounderOS-Aidit directive-runner stage 1.",
    "Produce a short approval plan only. Do not execute anything.",
    "Your response MUST be exactly this shape and nothing else:",
    "OBJECTIVE: <one sentence>",
    "FILES: <comma-separated repo-relative paths this plan will touch, or NONE>",
    "STEPS:",
    "- <step>",
    "- <step>",
    "VERIFY: <the exact command(s) that prove it worked>",
    "OUT OF SCOPE: <what this deliberately will not do>",
    "RISK: low | medium | high",
    "",
    "Hard boundary: repo-relative paths only; nothing under ventures/, .git/, .paperclip/; no .env* files; no network; no message to anyone but the owner; no package installs.",
    "VERIFY contract: the VERIFY line MUST be a single command starting with node ops-watcher/.",
    "Allowed VERIFY for code changes: node ops-watcher/run-all-tests.mjs --only <suite-file>",
    "Allowed VERIFY for file-content directives: node ops-watcher/verify-file.mjs --path <file> --matches <regex>",
    "PowerShell, cmd, bash, git, or any other command will be rejected before the owner sees the plan.",
    "Scope is only this repository: D:\\AI\\Active FounderOS-Aidit.",
    "Write OBJECTIVE, STEPS, VERIFY, and OUT OF SCOPE in professional Bahasa Indonesia. Keep file paths and commands verbatim.",
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

export function validatePlanScope(plan) {
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
    if (["ventures", ".git", ".paperclip", "node_modules", "graphify-out"].some((x) => low === x || low.startsWith(`${x}/`))) add("denied directory");
    if (parts.some((seg) => /^\.env/i.test(seg))) add("denied env file");
    if (HARD_DENY.has(low)) add("hard-deny operational file");
  }
  return { ok: violations.length === 0, violations };
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

async function loadState(file, _fs) {
  try {
    const st = JSON.parse(await _fs.readFile(file, "utf8"));
    return st && typeof st === "object"
      ? {
        attempts: st.attempts || {},
        lastPlanFailures: st.lastPlanFailures && typeof st.lastPlanFailures === "object" ? st.lastPlanFailures : {},
        lastSweepMs: Number(st.lastSweepMs) || 0,
      }
      : { attempts: {}, lastPlanFailures: {}, lastSweepMs: 0 };
  } catch { return { attempts: {}, lastPlanFailures: {}, lastSweepMs: 0 }; }
}
async function saveState(file, st, _fs) {
  try { await _fs.writeFile(file, JSON.stringify(st, null, 2), "utf8"); } catch { /* best-effort */ }
}
function attemptsKey(issue) { return String(issue?.id || issue?.identifier || "unknown"); }
function recordPlanFailureAttempt(state, key, prior, failure) {
  const attempt = prior + 1;
  state.attempts[key] = attempt;
  state.lastPlanFailures = state.lastPlanFailures && typeof state.lastPlanFailures === "object" ? state.lastPlanFailures : {};
  state.lastPlanFailures[key] = { ...failure, attempt, at: iso() };
  return attempt;
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
export function buildDecisionCardText(issue, plan) {
  const ident = issue?.identifier || issue?.id || "unknown";
  const title = String(issue?.title || "(tanpa judul)");
  const objective = String(plan?.objective || "");
  const fileCount = Array.isArray(plan?.files) ? plan.files.length : 0;
  const verify = String(plan?.verify || "");
  const risk = String(plan?.risk || "low");
  return [
    "📋 Rencana directive butuh keputusan Anda",
    "",
    `${ident} — ${title}`,
    "",
    `Tujuan: ${objective}`,
    `Jumlah file: ${fileCount}`,
    `Verifikasi: ${verify}`,
    `Risiko: ${risk}`,
    "",
    "Ketuk SETUJUI untuk melanjutkan atau TOLAK untuk membatalkan.",
  ].join("\n");
}

// Reuses telegram-notify.mjs's documented callback_data scheme exactly:
//   APPROVE -> "a:<shortId>"   REJECT -> "r:<shortId>"
// No second scheme, no second sender — the existing telegram-listener already
// maps these back to the issue and writes the decision comment findPlanDecision
// reads.
export function buildDecisionCardButtons(shortId) {
  return [
    [{ text: "SETUJUI", callback_data: `a:${shortId}` }],
    [{ text: "TOLAK", callback_data: `r:${shortId}` }],
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
function failureTelegramText({ identifier, outcome, reason }) {
  return `Directive ${identifier} tidak dapat diselesaikan (${outcome}): ${reason || "tidak diketahui"}. Status tetap approved; tidak ada perubahan yang dipertahankan.`;
}

export async function runDirectiveSweepOnce(deps = {}) {
  const summary = {
    scanned: 0, planned: 0, refused: 0,
    stalled: [], awaitingApproval: [], approved: [], rejected: [],
    executed: 0, reverted: 0, noop: 0, refused: 0,
    errors: [],
  };
  const {
    base: injectedBase,
    companyId = CANONICAL_COMPANY_ID,
    listIssues: listIssuesFn = listIssues,
    httpGet: _get = httpGet,
    httpPost: _post = httpPost,
    retrieveContext = retrieveDispatchContext,
    dispatchPlan = dispatchPlanReal,
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
  } = deps;

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
    const addOwnerRequiredLabelFn = addIssueLabel || (async (iss, label) => _post(`${base}/api/issues/${iss.id}/labels`, { label }));
    let plannedThisSweep = 0;
    // Approved directives captured here (issue + parsed plan) for the stage 3b
    // execution pass that runs AFTER the planning loop. Only directives whose
    // plan comment parses to a valid plan are eligible for execution.
    const approvedForExecution = [];

    for (const issue of issues) {
      if (!hasLabel(issue, "DIRECTIVE")) continue;
      const ident = issue.identifier || issue.id;
      summary.scanned += 1;
      let comments = [];
      try {
        const cRes = await _get(`${base}/api/issues/${issue.id}/comments`);
        if (cRes.networkError) {
          summary.errors.push(`${ident}: comments network error: ${cRes.networkErrorMessage}`);
          continue;
        }
        comments = Array.isArray(cRes.body) ? cRes.body : [];
      } catch (err) {
        summary.errors.push(`${ident}: comments fetch threw: ${err && err.message ? err.message : err}`);
        continue;
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
        continue;
      } else if (cls.state === "approved") {
        summary.approved.push({ id: issue.id, identifier: ident, lastCommentAt: cls.lastCommentAt, reason: cls.reason, approvedAt: cls.approvedAt });
        // Stage 3b: capture the parsed plan from the plan comment for the
        // execution pass below. The plan comment body is
        // `${PLAN_MARKER} (iso):\n[<stalled note>\n]<planText>`; we slice from
        // the OBJECTIVE line so the stalled note (if any) is skipped.
        if (!dryRun) {
          const planIdx = findLastIndex(comments, isPlanComment);
          if (planIdx >= 0) {
            const planBody = bodyOf(comments[planIdx]);
            const objIdx = planBody.indexOf("OBJECTIVE: ");
            if (objIdx >= 0) {
              const parsedPlan = parsePlan(planBody.slice(objIdx));
              if (parsedPlan.ok) approvedForExecution.push({ issue, plan: parsedPlan, identifier: ident });
            }
          }
        }
        continue;
      } else if (cls.state === "rejected") {
        summary.rejected.push({ id: issue.id, identifier: ident, lastCommentAt: cls.lastCommentAt, reason: cls.reason });
        continue;
      } else if (cls.state !== "new") {
        // done, ignored, etc.
        continue;
      }

      // Plannable: cls.state is "new" or a plannable "stalled".
      if (plannedThisSweep >= maxPlansPerSweep) continue;
      const key = attemptsKey(issue);
      const prior = Number(state.attempts[key] || 0);
      if (prior >= maxPlanAttempts) {
        log(`directive-runner: ${ident} reached plan attempt cap (${prior}/${maxPlanAttempts})`);
        const alreadyEscalated = hasLabel(issue, OWNER_REQUIRED_LABEL) || comments.some(isAttemptCapEscalationComment);
        if (!dryRun && !alreadyEscalated) {
          let labelOk = false;
          try {
            const labelRes = await addOwnerRequiredLabelFn(issue, OWNER_REQUIRED_LABEL);
            if (labelRes && labelRes.networkError) {
              summary.errors.push(`${ident}: owner-required label network error: ${labelRes.networkErrorMessage}`);
            } else {
              labelOk = true;
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
            if (post.networkError) summary.errors.push(`${ident}: owner-required comment network error: ${post.networkErrorMessage}`);
          }
        }
        continue;
      }
      const stalledRePlan = cls.state === "stalled";

      if (dryRun) {
        log(`directive-runner --dry: would retrieve context, generate plan, and send decision card for ${ident}${stalledRePlan ? " (stalled re-plan)" : ""}`);
        summary.planned += 1;
        plannedThisSweep += 1;
        continue;
      }

      const ctx = await bounded("context retrieval", () => retrieveContext({ issue, targetRole: "CORLEONE", taskKind: "directive-plan", now }), CONTEXT_TIMEOUT_MS);
      const prompt = buildPlanPrompt(issue, ctx.ok ? ctx.value : { status: "degraded", error: ctx.error });
      const out = await dispatchPlan(prompt, { issue, timeoutMs: PLAN_TIMEOUT_MS });
      const text = cap(out && out.stdout ? out.stdout : out && out.text ? out.text : "");
      const parsed = parsePlan(text);
      if (!parsed.ok) {
        const attempt = recordPlanFailureAttempt(state, key, prior, { reason: "parse-failed", detail: parsed.error });
        await saveState(stateFile, state, _fs);
        const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: parseFailureComment(parsed.error, attempt, maxPlanAttempts), authorType: "user" });
        if (post.networkError) summary.errors.push(`${ident}: parse-failure comment network error: ${post.networkErrorMessage}`);
        plannedThisSweep += 1;
        continue;
      }
      const scope = validatePlanScope(parsed);
      if (!scope.ok) {
        const reason = "file-scope-out-of-scope";
        const attempt = recordPlanFailureAttempt(state, key, prior, { reason, violations: scope.violations });
        await saveState(stateFile, state, _fs);
        const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: refusalComment(scope.violations, attempt, maxPlanAttempts, reason), authorType: "user" });
        if (post.networkError) summary.errors.push(`${ident}: refusal comment network error: ${post.networkErrorMessage}`);
        else summary.refused += 1;
        plannedThisSweep += 1;
        continue;
      }
      const verifyScope = validateVerifyCommand(parsed.verify);
      if (!verifyScope.ok) {
        const reason = "verify-out-of-scope";
        const attempt = recordPlanFailureAttempt(state, key, prior, { reason, detail: verifyScope.reason });
        await saveState(stateFile, state, _fs);
        const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: refusalComment([`VERIFY: ${verifyScope.reason}`], attempt, maxPlanAttempts, reason), authorType: "user" });
        if (post.networkError) summary.errors.push(`${ident}: refusal comment network error: ${post.networkErrorMessage}`);
        else summary.refused += 1;
        plannedThisSweep += 1;
        continue;
      }
      const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: planComment(text, { stalled: stalledRePlan }), authorType: "user" });
      if (post.networkError) {
        summary.errors.push(`${ident}: plan comment network error: ${post.networkErrorMessage}`);
      } else {
        summary.planned += 1;
        state.attempts[key] = 0;
        await saveState(stateFile, state, _fs);
        // Deliver the plan to the owner as a decision card. If the card cannot
        // be sent, the plan comment still stands and the sweep records
        // `card-failed` — never leave the owner with an approved-looking state
        // that was never actually shown to them.
        let card;
        try {
          card = await sendDecisionCard({ issue, plan: parsed, telegramBase });
        } catch (err) {
          card = { sent: false, error: err && err.message ? err.message : String(err) };
        }
        if (!card || !card.sent) {
          const why = card && (card.reason || card.error) ? ` (${card.reason || card.error})` : "";
          summary.errors.push(`${ident}: card-failed${why}`);
          log(`directive-runner: ${ident} decision card failed to send${why} — plan comment still stands`);
        }
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
      const patchIssueFn = patchIssue || (async (iss, patch) => _post(`${base}/api/issues/${iss.id}`, patch));
      const addLabelFn = addIssueLabel || (async (iss, label) => _post(`${base}/api/issues/${iss.id}/labels`, { label }));
      const nowMs = asMs(now);
      const toExecute = approvedForExecution.slice(0, MAX_EXECUTIONS_PER_SWEEP);
      for (const item of toExecute) {
        const { issue: exIssue, plan: exPlan, identifier: exIdent } = item;
        let result;
        try {
          result = await execFn(exIssue, exPlan, executeDirectiveDeps || { now });
        } catch (err) {
          result = { outcome: "aborted", reason: `executor-threw: ${String((err && err.message) || err)}` };
        }
        if (!result || !result.outcome) {
          summary.errors.push(`${exIdent}: execution returned no outcome`);
          continue;
        }
        const outcome = result.outcome;

        if (outcome === "done") {
          const body = doneResultComment({
            filesChanged: result.filesChanged,
            verifyCmd: String((exPlan && exPlan.verify) || ""),
            verifyTail: result.verifyTail,
            outOfScope: String((exPlan && exPlan.outOfScope) || ""),
            nowMs,
          });
          const dpost = await _post(`${base}/api/issues/${exIssue.id}/comments`, { body, authorType: "user" });
          if (dpost.networkError) summary.errors.push(`${exIdent}: result comment network error: ${dpost.networkErrorMessage}`);
          try { await patchIssueFn(exIssue, { status: "done" }); }
          catch (e) { summary.errors.push(`${exIdent}: patch status error: ${e && e.message ? e.message : e}`); }
          if (labelMap && labelMap.doneVerified) {
            try { await addLabelFn(exIssue, labelMap.doneVerified); }
            catch (e) { summary.errors.push(`${exIdent}: add label error: ${e && e.message ? e.message : e}`); }
          }
          summary.executed += 1;
        } else if (outcome === "no-op") {
          const body = noOpComment({ reason: result.reason, nowMs });
          const npost = await _post(`${base}/api/issues/${exIssue.id}/comments`, { body, authorType: "user" });
          if (npost.networkError) summary.errors.push(`${exIdent}: no-op comment network error: ${npost.networkErrorMessage}`);
          // Do NOT patch the status — nothing changed.
          summary.noop += 1;
        } else if (outcome === "reverted" || outcome === "refused" || outcome === "aborted") {
          const reason = Array.isArray(result.violations) && result.violations.length
            ? result.violations.join("; ")
            : String(result.reason || "tidak diketahui");
          const body = failureComment({ outcome, reason, nowMs });
          const fpost = await _post(`${base}/api/issues/${exIssue.id}/comments`, { body, authorType: "user" });
          if (fpost.networkError) summary.errors.push(`${exIdent}: failure comment network error: ${fpost.networkErrorMessage}`);
          // Exactly ONE Telegram message — no retry loop.
          try {
            await sendOwnerMsg(failureTelegramText({ identifier: exIdent, outcome, reason }));
          } catch (e) {
            summary.errors.push(`${exIdent}: telegram send error: ${e && e.message ? e.message : e}`);
          }
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
      await saveState(stateFile, state, _fs);
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

// PURE. Returns the implementation prompt for the lane. Contains, in order: the
// issue identifier and title; the plan's OBJECTIVE; the EXACT file list (the
// only files that may change, one per line); the STEPS; the VERIFY command that
// must pass; and a hard-stop block. Deterministic: same inputs -> same string.
export function buildExecutionPrompt(issue, plan) {
  const ident = issue?.identifier || issue?.id || "unknown";
  const title = String(issue?.title || "");
  const objective = String(plan?.objective || "");
  const files = Array.isArray(plan?.files) ? plan.files : [];
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const verify = String(plan?.verify || "");
  const fileLines = files.length
    ? files.map((f) => `- ${f}`).join("\n")
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
    "  - Nothing under ventures/ may be touched.",
    "  - No network, no HTTP, no Telegram, no Paperclip.",
    "  - No pm2, no git, no shell, no child processes.",
    "  - No package installs; only Node built-ins and existing local modules.",
    "  - Do NOT weaken, skip, comment out, or delete assertions to make the verification pass.",
  ].join("\n");
}

// Splits a "node ops-watcher/..." command string into argv, replacing the
// leading "node" with the real executable path for a shell:false spawn.
function nodeCommandToArgv(cmd) {
  const parts = String(cmd || "").trim().split(/\s+/).filter(Boolean);
  if (parts[0] === "node") parts.shift();
  return parts;
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
    const scope = validatePlanScope(plan);
    if (!scope.ok) {
      return emit({ outcome: "refused", violations: scope.violations });
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
    const prompt = buildExecutionPrompt(issue, plan);
    const dispatchFn = deps.dispatchExecution || makeDefaultDispatchExecution(lane && lane.wrapper);
    const dispatch = await dispatchFn(prompt);
    await recordOutcomeFn(lane && lane.guardName, {
      ok: !!(dispatch && dispatch.ok),
      stdout: dispatch && dispatch.stdout,
      stderr: dispatch && dispatch.stderr,
    }, deps.recordOutcomeDeps || {});

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
    `errors=${summary.errors.length}`,
  );
  for (const s of summary.stalled) console.log(`  stalled: ${s.identifier || s.id} lastCommentAt=${s.lastCommentAt || "none"} reason=${s.reason}`);
  for (const a of summary.awaitingApproval) console.log(`  awaiting: ${a.identifier || a.id} lastCommentAt=${a.lastCommentAt || "none"}`);
  for (const a of summary.approved) console.log(`  approved: ${a.identifier || a.id} approvedAt=${a.approvedAt || "none"}`);
  for (const r of summary.rejected) console.log(`  rejected: ${r.identifier || r.id}`);
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