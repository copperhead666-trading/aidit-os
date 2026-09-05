// ops-watcher/owner-gate.mjs
// E3 — no path reaches the owner without passing the brief gate.
//
// === WHY HE SEES BARE TITLES ===
// decision-brief.mjs validates five slots and refuses an escalation that lacks
// them. Exactly TWO files route through it — ahmad-escalate.mjs and
// raise-decision.mjs. Every other producer adds OWNER_REQUIRED itself and the
// card goes out with whatever the issue happened to say, which is why the owner
// has been approving titles.
//
// This module is the gate the other producers call. It does NOT re-implement
// escalation: it validates with the same validateDecisionBrief, writes the same
// [DECISION BRIEF] comment body, and records the same refusal. The producer
// keeps its own labelling, because each one already has label logic with its
// own read-back and error handling that must not be forked.
//
// The rule for a producer that cannot fill a slot is not "omit it" — that is
// how the slots became empty in the first place. It writes the fact IN the
// slot, in the owner's language, naming who could not fill it and why. He can
// then see that the system does not know, which is itself an answer.

import { buildDecisionBriefCommentBody, renderRefusal, validateDecisionBrief } from "./decision-brief.mjs";

/**
 * A slot a producer genuinely cannot fill, written so the owner reads a fact
 * rather than a blank. Deliberately a full sentence: the validator requires
 * substance, and "n/a" is exactly the empty-in-disguise it already refuses.
 */
export function unknownSlot(producer, why) {
  const p = String(producer || "sistem").trim();
  const w = String(why || "tidak ada keterangan").trim().replace(/\.$/, "");
  return `Belum diketahui oleh ${p}: ${w}. Keterangan ini ditulis apa adanya, bukan dikosongkan.`;
}

/**
 * Validate a producer's brief. Returns { ok, brief, commentBody } or
 * { ok:false, missing, reasons, refusal, refusalComment }.
 *
 * The refusal text is the same one AHMAD gets, so a producer's bad brief is
 * diagnosed the same way whoever wrote it.
 */
export function gateOwnerEscalation(brief, { producer = "sistem" } = {}) {
  const verdict = validateDecisionBrief(brief);
  if (!verdict.ok) {
    const refusal = renderRefusal(verdict);
    return {
      ok: false,
      missing: verdict.missing || [],
      reasons: verdict.reasons || [],
      refusal,
      refusalComment: `ESCALATION REFUSED (${producer}) — brief incomplete, so this was NOT put in front of the owner.\n${refusal}`,
    };
  }
  return { ok: true, brief: verdict.brief, commentBody: buildDecisionBriefCommentBody(verdict.brief) };
}

/**
 * Validate, then write. Posts the brief on success and the refusal on failure,
 * so both outcomes are on the record. Never throws.
 *
 * `postComment(base, issueId, body, opts)` is the caller's own client, injected
 * so this module owns no transport.
 */
export async function postGatedBrief({ base, issueId, brief, producer = "sistem", postComment, log = () => {} }) {
  const gated = gateOwnerEscalation(brief, { producer });
  const body = gated.ok ? gated.commentBody : gated.refusalComment;
  let res = null;
  try {
    res = await postComment(base, issueId, body, { authorType: "user" });
  } catch (err) {
    log(`owner-gate: ${producer} brief post threw (${err && err.message}) — the escalation is NOT gated`);
    return { ...gated, posted: false, error: String((err && err.message) || err) };
  }
  const posted = !!res && !res.networkError && (res.status === undefined || (res.status >= 200 && res.status < 300));
  if (!posted) log(`owner-gate: ${producer} brief comment did not land — the escalation is NOT gated`);
  if (!gated.ok) log(`owner-gate: ${producer} REFUSED its own escalation — missing: ${gated.missing.join(", ") || "(shape)"}`);
  return { ...gated, posted };
}
