// ops-watcher/escalation-sec.mjs
// Clerical ESCALATION-SEC sweep for Paperclip issues that are blocked and have
// not yet been routed to the OWNER. This consumes the watcher.mjs
// blocked-unnotified signal at the state level: add OWNER_REQUIRED, post a
// visible ESCALATION-SEC NOTIFIED marker comment, then set
// blockedOwnerNotifiedAt so watcher.mjs stops re-emitting the same signal.
//
//   node ops-watcher/escalation-sec.mjs --once

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { buildHermesInvocation } from "./hermes-entry.mjs";
import {
  discoverPaperclipPort,
  httpGet,
  ensureLabel,
  patchIssue,
  postComment,
} from "./paperclip-write-client.mjs";
import { isUnusableModelOutput } from "./lane-guard.mjs";
import { postGatedBrief, unknownSlot } from "./owner-gate.mjs";
import { parseDecisionBriefFromComments } from "./decision-brief.mjs";
import { buildEscalationActionsCommentBody } from "./escalation-actions.mjs";

export const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OWNER_REQUIRED_COLOR = "#b91c1c";
const NOTIFIED_MARKER = "ESCALATION-SEC NOTIFIED";
// The --in workspace handed to the hermes CLI. DERIVED from this module's own
// location (escalation-sec.mjs lives in <repo>/ops-watcher/), never hardcoded.
const HERMES_WORKSPACE = path.resolve(__dirname, "..");
const HERMES_PROVIDER = "nous";
const HERMES_MODEL = "upstage/solar-pro4:free";
const HERMES_TIMEOUT_MS = 10 * 60 * 1000;

const iso = () => new Date().toISOString();

// ---- Hermes dispatch (real). Returns { ok, stdout, stderr, timedOut, error }. ----
// Deliberately mirrors review-runner.mjs's hermes one-shot shape:
// hermes -z <prompt> --provider nous -m upstage/solar-pro4:free --in <workspace>
export function dispatchHermesReal(prompt, {
  timeoutMs = HERMES_TIMEOUT_MS,
  buildInvocation = buildHermesInvocation,
  spawnFn = spawn,
} = {}) {
  return new Promise((resolve) => {
    const hermesArgs = ["-z", prompt, "--provider", HERMES_PROVIDER, "-m", HERMES_MODEL, "--in", HERMES_WORKSPACE];
    const invocation = buildInvocation(hermesArgs);
    let child = null;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    if (!invocation) {
      finish({ ok: false, stdout, stderr: `${stderr}\nhermes executable not found (resolved no runnable entry)`, timedOut, error: "enoent" });
      return;
    }

    try {
      child = spawnFn(invocation.file, invocation.args, {
        stdio: ["ignore", "pipe", "pipe"],
        ...invocation.options,
      });
    } catch (err) {
      finish({ ok: false, stdout, stderr: stderr + `\nspawn(${invocation.file}) threw: ${err && err.message}`, timedOut, error: String(err && err.code || err && err.message || err) });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, stderr: stderr + String(err && err.message), timedOut, error: String(err && err.code || err && err.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0 && !timedOut, stdout, stderr, timedOut, error: timedOut ? "timeout" : code === 0 ? null : `exit_${code}` });
    });
  });
}

function buildPrompt(it) {
  return [
    "You are ESCALATION-SEC, a clerical worker for FounderOS-Aidit.",
    "Given this issue's title/description and its unblock descriptor (a JSON object describing what's blocking it), write a SHORT (2-4 sentences), clear explanation IN BAHASA INDONESIA for the OWNER of what is blocked and what's needed to unblock it.",
    "Output ONLY the explanation text, no preamble, no markdown.",
    "",
    `Issue identifier: ${it.identifier || it.id}`,
    `Title: ${it.title || "(untitled)"}`,
    "",
    "Description:",
    String(it.description || "(no description)"),
    "",
    "Unblock descriptor JSON:",
    JSON.stringify(it.unblockDescriptor || null),
  ].join("\n");
}

function fallbackExplanation(it) {
  return `Issue ini terblokir: ${JSON.stringify(it.unblockDescriptor || null)}. Perlu tindakan Anda untuk melanjutkan.`;
}

// E2. A blocked issue has no proposal attached, so there is nothing to accept.
// What helps is his instruction in his own words, or a decision to close it.
export const BLOCKED_ISSUE_ACTIONS = Object.freeze({
  allow_accept: false,
  allow_edit: false,
  allow_respond: true,
  allow_ignore: true,
});

/**
 * E3. The five slots for a blocked issue, filled from what this sweep actually
 * knows — and saying so, in the slot, where it does not.
 *
 * This sweep detects that an issue is BLOCKED. It does not diagnose why, and it
 * must not pretend to: the recommendation's reasoning states plainly that the
 * cause has not been analysed, which is a fact the owner can act on ("someone
 * look at this") rather than a confident guess he cannot check.
 */
export function blockedIssueBrief(issue, explanation) {
  const ident = issue?.identifier || issue?.id || "issue ini";
  const status = String(issue?.status || "tidak diketahui");
  const said = String(explanation || "").trim();
  return {
    pertanyaan: `Issue ${ident} terhenti dan tidak dapat dilanjutkan otomatis. Apa yang Anda ingin dilakukan terhadapnya?`,
    yang_sudah_ada: [
      {
        kutipan: said || `Issue ${ident} berstatus ${status} dan ditandai terblokir, tanpa keterangan lain.`,
        sumber: `Paperclip issue ${ident} (status ${status}), dibaca oleh escalation-sec`,
      },
      {
        kutipan: `Belum ada satu pun lane yang mengerjakan ${ident} selama issue ini masih terblokir.`,
        sumber: "ops-watcher/escalation-sec.mjs — sapuan blocked-unnotified",
      },
    ],
    pilihan: [
      {
        key: "buka_blokir",
        label: "Hapus hambatannya, lanjutkan pekerjaan",
        konsekuensi: "Pekerjaan berjalan lagi, tetapi hambatan yang sama dapat muncul kembali jika penyebabnya tidak diperbaiki.",
      },
      {
        key: "tutup",
        label: "Tutup issue ini",
        konsekuensi: "Pekerjaan berhenti secara permanen dan tidak ada lane yang akan mengambilnya lagi.",
      },
      {
        key: "biarkan",
        label: "Biarkan dulu, putuskan nanti",
        konsekuensi: "Issue tetap terhenti dan akan muncul lagi di ringkasan harian Anda.",
      },
    ],
    rekomendasi: {
      pilihan: "buka_blokir",
      alasan: unknownSlot(
        "escalation-sec",
        "sapuan ini hanya mendeteksi bahwa issue terblokir dan tidak menganalisis penyebabnya, sehingga saran ini adalah default dan bukan hasil pemeriksaan",
      ),
    },
    kalau_didiamkan: `Tidak ada yang berubah: ${ident} tetap terhenti, tidak ada lane yang mengerjakannya, dan kartu ini akan muncul lagi.`,
  };
}

function toIsoTimestamp(now) {
  const v = typeof now === "function" ? now() : now;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  if (typeof v === "string") return Number.isNaN(Date.parse(v)) ? iso() : new Date(v).toISOString();
  return iso();
}

function okResponse(r) {
  if (!r || r.networkError || r.authRequired) return false;
  if (typeof r.status === "number") return r.status >= 200 && r.status < 300;
  return true;
}

function markerPresent(comments) {
  return comments.some((c) => String(c.body || "").trim().startsWith(NOTIFIED_MARKER));
}

// Core, dependency-injected for testability. deps: { base, companyId, httpGet,
// httpPost, ensureLabel, patchIssue, postComment, dispatchHermes, log, now }
export async function runEscalationSecOnce(deps = {}) {
  const {
    base,
    companyId = COMPANY_ID,
    httpGet: _get = httpGet,
    ensureLabel: _ensureLabel = ensureLabel,
    patchIssue: _patchIssue = patchIssue,
    postComment: _postComment = postComment,
    dispatchHermes: _dispatchHermes = dispatchHermesReal,
    log = (m) => console.log(m),
    now = () => new Date(),
  } = deps;
  const results = [];

  if (!base) {
    log("escalation-sec: no Paperclip base resolved (instance not running)");
    return { results, error: "no-base" };
  }

  let issuesRes;
  try {
    issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
  } catch (err) {
    const reason = `issues list threw: ${err && err.message || err}`;
    log(`escalation-sec: ${reason}`);
    return { results: [{ outcome: "failed", step: "issues-list", reason }], error: "network" };
  }
  if (issuesRes.networkError) {
    const reason = `issues list network error: ${issuesRes.networkErrorMessage}`;
    log(`escalation-sec: ${reason}`);
    return { results: [{ outcome: "failed", step: "issues-list", reason }], error: "network" };
  }
  const issues = Array.isArray(issuesRes.body) ? issuesRes.body : [];
  log(`escalation-sec: ${issues.length} issues in company; scanning for blocked owner notifications`);

  for (const it of issues) {
    const id = it.id;
    const ident = it.identifier || id;
    if ((it.status || "").toLowerCase() !== "blocked") continue;
    if (it.blockedOwnerNotifiedAt) continue;

    try {
      const cRes = await _get(`${base}/api/issues/${id}/comments`);
      if (cRes.networkError) {
        const reason = `comments list network error: ${cRes.networkErrorMessage}`;
        log(`escalation-sec: ${ident} ${reason}`);
        results.push({ id, identifier: ident, outcome: "failed", step: "comments-list", reason });
        continue;
      }
      const comments = Array.isArray(cRes.body) ? cRes.body : [];
      if (markerPresent(comments)) {
        log(`escalation-sec: ${ident} already has an ${NOTIFIED_MARKER} marker -> skip`);
        continue;
      }

      let explanation = "";
      const prompt = buildPrompt(it);
      try {
        const h = await _dispatchHermes(prompt);
        if (h && h.ok) {
          const unusable = isUnusableModelOutput(h.stdout);
          if (!unusable.unusable) {
            explanation = String(h.stdout || "").trim();
            log(`escalation-sec: ${ident} hermes-composed owner explanation`);
          } else {
            explanation = fallbackExplanation(it);
            log(`escalation-sec: ${ident} fallback owner explanation (hermes ${unusable.reason})`);
          }
        } else {
          const reason = h && h.timedOut ? "timeout" : h && h.error ? h.error : "hermes-failed";
          explanation = fallbackExplanation(it);
          log(`escalation-sec: ${ident} fallback owner explanation (hermes ${reason})`);
        }
      } catch (err) {
        explanation = fallbackExplanation(it);
        log(`escalation-sec: ${ident} fallback owner explanation (hermes threw: ${err && err.message || err})`);
      }

      // E3. THE BRIEF GATE, BEFORE THE LABEL.
      //
      // This sweep used to add OWNER_REQUIRED and post a one-paragraph
      // explanation, so the card the owner received carried a title and four
      // buttons. Now it goes through the SAME validator ahmad-escalate uses,
      // and the brief lands on the issue before the label does. A brief that
      // does not validate is a defect in the template below, and it refuses
      // rather than putting another bare card in front of him.
      // A valid brief already on the issue is not re-posted: a sweep that fails
      // at the label step runs again five minutes later, and a second identical
      // brief would be litter on the owner's own issue.
      // E2: what he can do about a blocked issue. There is no proposal to
      // accept — the useful answers are "here is what to do about it" and
      // "close it", so those are the actions this escalation declares.
      const existingBrief = parseDecisionBriefFromComments(comments);
      if (!existingBrief) {
        const decl = await _postComment(base, id, buildEscalationActionsCommentBody(BLOCKED_ISSUE_ACTIONS), { authorType: "user" });
        if (!okResponse(decl)) log(`escalation-sec: ${ident} action declaration did not land — the card falls back to the default buttons`);
      }
      const gated = existingBrief
        ? { ok: true, posted: true, brief: existingBrief, reused: true }
        : await postGatedBrief({
          base,
          issueId: id,
          brief: blockedIssueBrief(it, explanation),
          producer: "escalation-sec",
          postComment: _postComment,
          log,
        });
      if (!gated.ok) {
        log(`escalation-sec: ${ident} REFUSED by the brief gate — missing: ${gated.missing.join(", ") || "(shape)"}; no label added, no card sent`);
        results.push({ id, identifier: ident, outcome: "brief-refused", missing: gated.missing, reasons: gated.reasons });
        continue;
      }
      if (!gated.posted) {
        log(`escalation-sec: ${ident} brief comment did not land — refusing to label, because the card would carry nothing`);
        results.push({ id, identifier: ident, outcome: "failed", step: "post-brief", reason: "brief comment did not land" });
        continue;
      }

      const labelRes = await _ensureLabel(base, companyId, "OWNER_REQUIRED", OWNER_REQUIRED_COLOR);
      if (labelRes.networkError) {
        const reason = `ensureLabel network error: ${labelRes.networkErrorMessage}`;
        log(`escalation-sec: ${ident} ${reason}`);
        results.push({ id, identifier: ident, outcome: "failed", step: "ensure-label", reason });
        continue;
      }
      if (!labelRes.id) {
        const reason = `could not ensure OWNER_REQUIRED label (status ${labelRes.status})`;
        log(`escalation-sec: ${ident} ${reason}`);
        results.push({ id, identifier: ident, outcome: "failed", step: "ensure-label", reason });
        continue;
      }

      const existingLabelIds = Array.isArray(it.labelIds) ? it.labelIds : [];
      const merged = Array.from(new Set([...existingLabelIds, labelRes.id]));
      const labelPatch = await _patchIssue(base, id, { labelIds: merged });
      if (!okResponse(labelPatch)) {
        const reason = labelPatch && labelPatch.networkError
          ? `patchIssue network error: ${labelPatch.networkErrorMessage}`
          : `patchIssue failed (status ${labelPatch && labelPatch.status})`;
        log(`escalation-sec: ${ident} ${reason}`);
        results.push({ id, identifier: ident, outcome: "failed", step: "patch-labels", reason });
        continue;
      }

      const body = `${NOTIFIED_MARKER}: ${explanation}`;
      const commentRes = await _postComment(base, id, body, { authorType: "user" });
      if (!okResponse(commentRes)) {
        const reason = commentRes && commentRes.networkError
          ? `postComment network error: ${commentRes.networkErrorMessage}`
          : `postComment failed (status ${commentRes && commentRes.status})`;
        log(`escalation-sec: ${ident} ${reason}`);
        results.push({ id, identifier: ident, outcome: "failed", step: "post-comment", reason });
        continue;
      }

      const ts = toIsoTimestamp(now);
      const notifiedPatch = await _patchIssue(base, id, { blockedOwnerNotifiedAt: ts });
      if (!okResponse(notifiedPatch)) {
        const reason = notifiedPatch && notifiedPatch.networkError
          ? `patchIssue network error: ${notifiedPatch.networkErrorMessage}`
          : `patchIssue failed (status ${notifiedPatch && notifiedPatch.status})`;
        log(`escalation-sec: ${ident} ${reason}`);
        results.push({ id, identifier: ident, outcome: "failed", step: "patch-notified-at", reason });
        continue;
      }

      log(`escalation-sec: ${ident} OWNER_REQUIRED + notification recorded`);
      results.push({ id, identifier: ident, outcome: "notified", blockedOwnerNotifiedAt: ts });
    } catch (err) {
      const msg = (err && err.stack) ? err.stack : String(err);
      log(`escalation-sec: ${ident} UNEXPECTED ERROR (continuing sweep): ${msg}`);
      results.push({ id, identifier: ident, outcome: "failed", step: "unexpected", reason: String(err && err.message || err) });
    }
  }

  return { results };
}

// ---- CLI ----
function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) if (argv[i] === "--once") out.once = true;
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/escalation-sec.mjs --once");
    process.exit(2);
  }
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  const r = await runEscalationSecOnce({ base, log: (m) => console.log(m) });
  const notified = r.results.filter((x) => x.outcome === "notified").length;
  const failed = r.results.filter((x) => x.outcome === "failed").length;
  const skippedOther = r.results.length - notified - failed;
  console.log(`escalation-sec --once: notified=${notified} failed=${failed} skipped/other=${skippedOther} (error=${r.error || "none"})`);
  for (const x of r.results) console.log(`  - ${x.identifier || x.id || x.step}: ${x.outcome}${x.step ? " (" + x.step + ")" : ""}`);
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
    console.error("escalation-sec fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
