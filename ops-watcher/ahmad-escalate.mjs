// ops-watcher/ahmad-escalate.mjs
// Headless AHMAD's ONLY way to escalate a Paperclip issue to the OWNER.
// AHMAD's run_command tool (ops-watcher/ahmad-mcp-server.mjs) is scoped to a
// fixed script allowlist with NO generic Paperclip-write capability — none of
// the other allowed scripts can add the OWNER_REQUIRED label. This script fills
// that gap: given an issue identifier and a reason (already in Bahasa Indonesia,
// written by the caller), it adds the OWNER_REQUIRED label to the issue and
// posts an "AHMAD ESCALATION: <reason>" comment so the OWNER sees it via the
// existing telegram-notify.mjs OWNER_REQUIRED card flow. Idempotent on the
// label (a second escalation attempt with a new reason still posts a NEW
// comment so repeated reasons aren't silently lost).
//
//   node ops-watcher/ahmad-escalate.mjs "<issueIdentifier>" "<reason text>"

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverPaperclipPort,
  httpGet,
  ensureLabel,
  postComment,
  patchIssue,
} from "./paperclip-write-client.mjs";
import { judgeWrite } from "./write-delivery.mjs";
import {
  validateDecisionBrief,
  buildDecisionBriefCommentBody,
  renderRefusal,
} from "./decision-brief.mjs";
import { buildDecisionOptionsCommentBody } from "./telegram-decision-options.mjs";

export const COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";
const OWNER_REQUIRED_COLOR = "#b91c1c";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Core, dependency-injected for testability (same pattern as telegram-notify.mjs
// / ahmad-dispatch.mjs). deps: { base, companyId, issueIdentifier, reason,
//   httpGet, ensureLabel, postComment, patchIssue, log }
export async function runEscalateOnce(deps) {
  const {
    base,
    companyId = COMPANY_ID,
    issueIdentifier,
    reason,
    httpGet: _get = httpGet,
    ensureLabel: _ensureLabel = ensureLabel,
    postComment: _postComment = postComment,
    patchIssue: _patchIssue = patchIssue,
    log = (m) => console.log(m),
    brief = null,
    recordRefusal = true,
  } = deps;

  if (!base) {
    const out = { ok: false, reason: "no Paperclip base resolved (instance not running)" };
    log(`ahmad-escalate: ${out.reason}`);
    return out;
  }
  if (!issueIdentifier) {
    const out = { ok: false, reason: "missing issueIdentifier" };
    log(`ahmad-escalate: ${out.reason}`);
    return out;
  }

  // 1. List company issues, find the one whose .identifier matches exactly.
  const issuesRes = await _get(`${base}/api/companies/${companyId}/issues`);
  if (issuesRes.networkError) {
    const out = { ok: false, reason: `issues list network error: ${issuesRes.networkErrorMessage}` };
    log(`ahmad-escalate: ${out.reason}`);
    return out;
  }
  const issues = Array.isArray(issuesRes.body) ? issuesRes.body : [];
  const it = issues.find((i) => i.identifier === issueIdentifier);
  if (!it) {
    const out = { ok: false, reason: `issue not found: ${issueIdentifier}` };
    log(`ahmad-escalate: ${out.reason}`);
    return out;
  }

  // THE GATE. Checked before any write, so a refused escalation leaves the
  // board exactly as it found it: no label, no interrupt.
  //
  // Why refuse at all, when the whole point of this script is that escalations
  // must not be lost: because an escalation that names a topic is already lost.
  // KOL-67 has been sitting labelled and card-sent for days and the owner still
  // cannot act on it, because it never said what the current rules are, what the
  // options are, or what waiting costs. A card he cannot answer is not reach.
  //
  // The refusal is not silence. It is written back onto the issue as a comment,
  // so the attempt is on the record and the issue stays visible in the daily
  // digest, and it names the missing slots so AHMAD can send a real one.
  const verdict = validateDecisionBrief(brief);
  if (!verdict.ok) {
    const refusal = renderRefusal(verdict);
    log(`ahmad-escalate: ${issueIdentifier} REFUSED — missing: ${verdict.missing.join(", ") || "(shape)"}`);
    if (recordRefusal) {
      const rec = await _postComment(
        base,
        it.id,
        `AHMAD ESCALATION REFUSED (brief incomplete)\n${refusal}`,
        { authorType: "user" },
      );
      if (!judgeWrite(rec).ok) {
        log(`ahmad-escalate: ${issueIdentifier} refusal comment did not land — the attempt is unrecorded`);
      }
    }
    return {
      ok: false,
      reason: "brief-incomplete",
      identifier: issueIdentifier,
      escalated: false,
      missing: verdict.missing,
      reasons: verdict.reasons,
      refusal,
    };
  }

  // 2. ensureLabel for OWNER_REQUIRED (color "#b91c1c" — same color used in
  //    telegram-notify.mjs's LABEL_SPECS so the label stays visually consistent).
  const labelRes = await _ensureLabel(base, companyId, "OWNER_REQUIRED", OWNER_REQUIRED_COLOR);
  if (labelRes.networkError) {
    const out = { ok: false, reason: `ensureLabel network error: ${labelRes.networkErrorMessage}` };
    log(`ahmad-escalate: ${out.reason}`);
    return out;
  }
  if (!labelRes.id) {
    const out = { ok: false, reason: `could not ensure OWNER_REQUIRED label (status ${labelRes.status})` };
    log(`ahmad-escalate: ${out.reason}`);
    return out;
  }
  const labelId = labelRes.id;

  // 3. If the issue's labelIds already includes that id, skip the PATCH
  //    (idempotent — already escalated) but still post the comment so a second
  //    escalation attempt with a new reason still gets recorded.
  const existingLabelIds = Array.isArray(it.labelIds) ? it.labelIds : [];
  if (!existingLabelIds.includes(labelId)) {
    const merged = Array.from(new Set([...existingLabelIds, labelId]));
    const patchRes = await _patchIssue(base, it.id, { labelIds: merged });
    // A 401/403 or a 4xx from Paperclip arrives with networkError false. Read
    // only that flag and an escalation the owner never sees reports itself as
    // escalated — the KOL-68 shape: an escalation comment with no label.
    const patched = judgeWrite(patchRes);
    if (!patched.ok) {
      const out = { ok: false, reason: `patchIssue did not land (${patched.reason})` };
      log(`ahmad-escalate: ${out.reason}`);
      return out;
    }

    // READ BACK. judgeWrite reads the response; it cannot see whether the row
    // actually changed. On 2026-09-04 three escalations reported "label added"
    // with HTTP 200 and left the issue with labelIds: [] — the KOL-68 shape
    // this file's own comment above warns about, produced by the file itself.
    // The same PATCH replayed by hand a minute later persisted, so the loss is
    // timing: the issue had just been created and the write raced it.
    //
    // A 200 is not evidence. ledger.mjs settled this argument already —
    // verifyAndSettle appends and then re-reads. Same discipline here: an
    // escalation that cannot prove its label is a failure, loudly, because a
    // silent one leaves the owner with a decision that never reaches a card.
    const confirm = await _get(`${base}/api/issues/${it.id}`);
    const confirmedIds = Array.isArray(confirm?.body?.labelIds) ? confirm.body.labelIds : [];
    if (!confirmedIds.includes(labelId)) {
      const out = {
        ok: false,
        reason: "label PATCH returned success but the label is not on the issue",
        identifier: issueIdentifier,
        escalated: false,
      };
      log(`ahmad-escalate: ${issueIdentifier} ${out.reason} — NOT escalated, nothing else written`);
      return out;
    }
    log(`ahmad-escalate: ${issueIdentifier} OWNER_REQUIRED label added and confirmed on re-read`);
  } else {
    log(`ahmad-escalate: ${issueIdentifier} already has OWNER_REQUIRED — skipping PATCH (idempotent), still posting comment`);
  }

  // 4. POST a comment with the verbatim reason text (already in Bahasa
  //    Indonesia because the caller writes it that way; this script does not
  //    translate or modify the reason).
  const commentBody = `AHMAD ESCALATION: ${reason}`;
  const commentRes = await _postComment(base, it.id, commentBody, { authorType: "user" });
  const commented = judgeWrite(commentRes);
  if (!commented.ok) {
    const out = { ok: false, reason: `postComment did not land (${commented.reason})` };
    log(`ahmad-escalate: ${out.reason}`);
    return out;
  }
  log(`ahmad-escalate: ${issueIdentifier} escalation comment posted`);

  // The brief itself, as structured data the cockpit can read back into the
  // decision record's five empty slots. Posted after the human-readable reason
  // so a person reading only Paperclip sees the sentence first.
  const briefRes = await _postComment(base, it.id, buildDecisionBriefCommentBody(verdict.brief), {
    authorType: "user",
  });
  const briefLanded = judgeWrite(briefRes);
  if (!briefLanded.ok) {
    // The label and the reason ARE on the board, so the owner is reached; only
    // the structure is missing. Reporting that as a full failure would invite a
    // retry that double-escalates, so it is reported as what it is.
    const out = {
      ok: false,
      reason: `brief comment did not land (${briefLanded.reason})`,
      identifier: issueIdentifier,
      escalated: true,
      briefPosted: false,
    };
    log(`ahmad-escalate: ${out.reason} — escalation itself DID land, do not re-run blindly`);
    return out;
  }
  log(`ahmad-escalate: ${issueIdentifier} decision brief posted`);

  // THE OPTIONS THE BRIEF ALREADY NAMES MUST BE THE BUTTONS THE OWNER TAPS.
  //
  // The gate has required 2-5 real `pilihan` since it was written — each with a
  // key, a label, and the consequence of choosing it. None of that ever reached
  // the owner's phone. telegram-notify.mjs's buildButtons reads ONE thing, the
  // "[DECISION OPTIONS]" marker comment, and nothing on this path ever wrote
  // it. So every escalation raised through the proper gate arrived as generic
  // SETUJUI / TOLAK / DETAIL / TUNDA, and the owner was asked to approve or
  // reject a question that was never yes-or-no. Two lists, one of them unread.
  //
  // Posted LAST on purpose. If this write fails the escalation still stands:
  // label, sentence and brief are on the board and buildButtons falls back to
  // the generic card, which is worse but not silent. A missing button set is
  // reported as its own fact rather than folded into the brief's.
  const optionsRes = await _postComment(base, it.id, buildDecisionOptionsCommentBody(
    verdict.brief.pilihan.map((option) => ({ key: option.key, label: option.label })),
  ), { authorType: "user" });
  const optionsLanded = judgeWrite(optionsRes);
  if (!optionsLanded.ok) {
    log(`ahmad-escalate: ${issueIdentifier} decision OPTIONS did not land (${optionsLanded.reason}) — the card will fall back to generic buttons`);
    return { ok: true, identifier: issueIdentifier, escalated: true, briefPosted: true, optionsPosted: false };
  }
  log(`ahmad-escalate: ${issueIdentifier} decision options posted (${verdict.brief.pilihan.length} buttons)`);

  return { ok: true, identifier: issueIdentifier, escalated: true, briefPosted: true, optionsPosted: true };
}

// ---- CLI ----
// The third argument is the brief: either inline JSON or a path to a .json
// file. A path is offered because a full brief is long, and HATTA's harness
// word-splits multi-word arguments on Windows — a caller that can write a file
// and pass its path never has to fight the shell.
async function readBriefArg(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    try {
      return JSON.parse(s);
    } catch (err) {
      return { __parseError: err && err.message ? err.message : String(err) };
    }
  }
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(s, "utf8"));
  } catch (err) {
    return { __parseError: `could not read brief file ${s}: ${err && err.message ? err.message : err}` };
  }
}

async function main() {
  const issueIdentifier = process.argv[2];
  const reason = process.argv[3];
  const briefArg = process.argv[4];
  if (!issueIdentifier || !reason) {
    console.error('usage: node ops-watcher/ahmad-escalate.mjs "<issueIdentifier>" "<reason text>" \'<brief JSON>\' | <path/to/brief.json>');
    process.exit(2);
  }
  const brief = await readBriefArg(briefArg);
  if (brief && brief.__parseError) {
    console.error(`ahmad-escalate: brief could not be read — ${brief.__parseError}`);
    process.exit(2);
  }
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  const r = await runEscalateOnce({ base, issueIdentifier, reason, brief, log: (m) => console.log(m) });
  if (r.reason === "brief-incomplete") console.error(r.refusal);
  console.log(JSON.stringify({ ...r, refusal: undefined }));
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
    console.error("ahmad-escalate fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}