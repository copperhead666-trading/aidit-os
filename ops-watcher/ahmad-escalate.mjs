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
    if (patchRes.networkError) {
      const out = { ok: false, reason: `patchIssue network error: ${patchRes.networkErrorMessage}` };
      log(`ahmad-escalate: ${out.reason}`);
      return out;
    }
    log(`ahmad-escalate: ${issueIdentifier} OWNER_REQUIRED label added`);
  } else {
    log(`ahmad-escalate: ${issueIdentifier} already has OWNER_REQUIRED — skipping PATCH (idempotent), still posting comment`);
  }

  // 4. POST a comment with the verbatim reason text (already in Bahasa
  //    Indonesia because the caller writes it that way; this script does not
  //    translate or modify the reason).
  const commentBody = `AHMAD ESCALATION: ${reason}`;
  const commentRes = await _postComment(base, it.id, commentBody, { authorType: "user" });
  if (commentRes.networkError) {
    const out = { ok: false, reason: `postComment network error: ${commentRes.networkErrorMessage}` };
    log(`ahmad-escalate: ${out.reason}`);
    return out;
  }
  log(`ahmad-escalate: ${issueIdentifier} escalation comment posted`);

  return { ok: true, identifier: issueIdentifier, escalated: true };
}

// ---- CLI ----
async function main() {
  const issueIdentifier = process.argv[2];
  const reason = process.argv[3];
  if (!issueIdentifier || !reason) {
    console.error('usage: node ops-watcher/ahmad-escalate.mjs "<issueIdentifier>" "<reason text>"');
    process.exit(2);
  }
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  const r = await runEscalateOnce({ base, issueIdentifier, reason, log: (m) => console.log(m) });
  console.log(JSON.stringify(r));
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