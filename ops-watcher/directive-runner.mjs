// ops-watcher/directive-runner.mjs
// Stage 2 directive lifecycle runner: classify Paperclip DIRECTIVE issues,
// generate a bounded approval plan, post that plan/refusal, and deliver the
// plan to the owner as a Telegram decision card (approve/reject). A stalled
// directive in todo/backlog is re-plannable; a stalled directive in
// in_progress is report-only (never trampled). No execution in this stage —
// an approved directive is only reported; stage 3 adds the executor.
//
// Outbound seams (all injectable for offline tests):
//   - Paperclip reads/writes: httpGet / httpPost (from paperclip-write-client)
//   - plan generation:        dispatchPlan (defaults to corleone-dispatch spawn)
//   - context retrieval:      retrieveContext (ahmad-context-retrieval)
//   - decision card delivery: sendDecisionCard (defaults to the real Telegram
//                             path via telegram-client.sendMessage, reusing the
//                             telegram-notify callback_data scheme a:<shortId> /
//                             r:<shortId> — no second scheme, no second sender)
//   - execution (stage 3):    execute (default no-op; NEVER called in stage 2)

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const STATE_FILE = path.join(__dirname, "directive-runner-state.json");

export const PLAN_MARKER = "DIRECTIVE PLAN";
export const APPROVED_MARKER = "DIRECTIVE PLAN APPROVED";
export const REJECTED_MARKER = "DIRECTIVE PLAN REJECTED";
export const RESULT_MARKER = "DIRECTIVE RESULT";
export const REFUSED_MARKER = "PLAN_REFUSED";
export const DISPATCH_MARKER = "AHMAD DISPATCH";
export const DEFAULT_STALLED_AFTER_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_MAX_PLANS_PER_SWEEP = 1;
export const DEFAULT_MAX_PLAN_ATTEMPTS = 2;
const PLAN_TIMEOUT_MS = 12 * 60 * 1000;
const CONTEXT_TIMEOUT_MS = 6000;
const OUTPUT_CAP = 8000;

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
    const norm = p.replace(/\\/g, "/").replace(/^\.\/+/, "");
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

async function loadState(file, _fs) {
  try {
    const st = JSON.parse(await _fs.readFile(file, "utf8"));
    return st && typeof st === "object" ? { attempts: st.attempts || {} } : { attempts: {} };
  } catch { return { attempts: {} }; }
}
async function saveState(file, st, _fs) {
  try { await _fs.writeFile(file, JSON.stringify(st, null, 2), "utf8"); } catch { /* best-effort */ }
}
function attemptsKey(issue) { return String(issue?.id || issue?.identifier || "unknown"); }
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

function refusalComment(violations) {
  return [
    `${REFUSED_MARKER} (${iso()}): rencana ditolak otomatis sebelum dikirim ke owner.`,
    "Alasan: rencana menyentuh path yang berada di luar batas aman directive-runner tahap 1.",
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

// ---- Stage 2: deliver the plan to the owner as a decision card -------------
// Builds the phone-screen summary card text in professional Indonesian: issue
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

export async function runDirectiveSweepOnce(deps = {}) {
  const summary = {
    scanned: 0, planned: 0, refused: 0,
    stalled: [], awaitingApproval: [], approved: [], rejected: [],
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
    stateFile = STATE_FILE,
    _fs = fs,
    now = Date.now,
    stalledAfterMs = DEFAULT_STALLED_AFTER_MS,
    maxPlansPerSweep = DEFAULT_MAX_PLANS_PER_SWEEP,
    maxPlanAttempts = DEFAULT_MAX_PLAN_ATTEMPTS,
    dryRun = false,
    log = () => {},
  } = deps;
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
    const state = dryRun ? { attempts: {} } : await loadState(stateFile, _fs);
    let plannedThisSweep = 0;

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
        // Stage 2: report only. The executor arrives in stage 3.
        summary.approved.push({ id: issue.id, identifier: ident, lastCommentAt: cls.lastCommentAt, reason: cls.reason, approvedAt: cls.approvedAt });
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
        const attempt = prior + 1;
        state.attempts[key] = attempt;
        await saveState(stateFile, state, _fs);
        const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: parseFailureComment(parsed.error, attempt, maxPlanAttempts), authorType: "user" });
        if (post.networkError) summary.errors.push(`${ident}: parse-failure comment network error: ${post.networkErrorMessage}`);
        plannedThisSweep += 1;
        continue;
      }
      const scope = validatePlanScope(parsed);
      if (!scope.ok) {
        const post = await _post(`${base}/api/issues/${issue.id}/comments`, { body: refusalComment(scope.violations), authorType: "user" });
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
    return summary;
  } catch (err) {
    summary.errors.push(err && err.stack ? err.stack : String(err));
    return summary;
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
  const summary = await runDirectiveSweepOnce({ dryRun: args.dry, log: (m) => console.log(m) });
  console.log(
    `directive-runner ${args.dry ? "--dry" : "--once"}: ` +
    `scanned=${summary.scanned} planned=${summary.planned} refused=${summary.refused} ` +
    `stalled=${summary.stalled.length} awaiting=${summary.awaitingApproval.length} ` +
    `approved=${summary.approved.length} rejected=${summary.rejected.length} errors=${summary.errors.length}`,
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