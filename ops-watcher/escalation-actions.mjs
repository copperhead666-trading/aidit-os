// ops-watcher/escalation-actions.mjs
// E2 — four actions, DECLARED PER ESCALATION.
//
// === WHY THE BUTTONS NEVER CHANGED ===
// The card renders a fixed keyboard: SETUJUI / TOLAK / DETAIL / TUNDA, the same
// four on every issue whatever the issue is. The owner's complaint is exactly
// this: "the buttons never change, and there is no way to disagree."
//
// langchain-ai/agent-inbox (MIT, 1,087 stars, verified 2026-09-05) answers it by
// having the SENDER declare which actions its interrupt supports —
// allow_accept / allow_edit / allow_respond / allow_ignore — and the surface
// renders only those. That is why their buttons change and ours do not: not a
// better template, a different owner of the decision.
//
//   accept    approve as proposed                     (exists today: SETUJUI)
//   edit      revise the arguments, then approve      (new: UBAH)
//   response  reply in the owner's own words          (new: BALAS)
//   ignore    decline without inventing a reason      (exists today: TOLAK)
//
// What we take: the four action types and the per-escalation flags. What we do
// not take: their transport and UI. Storage stays the house convention — a
// marker line and ONE JSON object in a comment body, the same shape
// [DECISION BRIEF] and [DECISION OPTIONS] already use. No second scheme.

export const ESCALATION_ACTIONS_MARKER = "[ESCALATION ACTIONS]";

// The marker a card writes when the owner asks to revise the plan, and the one
// his revision is stored under. Same convention: marker line, one JSON object.
export const EDIT_REQUESTED_MARKER = "[ESCALATION EDIT REQUESTED]";
export const OWNER_REVISION_MARKER = "[OWNER PLAN REVISION]";

export const ACTION_FLAGS = Object.freeze([
  "allow_accept", "allow_edit", "allow_respond", "allow_ignore",
]);

/**
 * What an escalation supports when it declares nothing.
 *
 * Today's card, exactly: approve or decline. A producer that has not been
 * taught to declare must not silently LOSE the two buttons the owner already
 * has, and must not silently GAIN two it has no handling for.
 */
export const DEFAULT_ACTIONS = Object.freeze({
  allow_accept: true,
  allow_edit: false,
  allow_respond: false,
  allow_ignore: true,
});

function asBool(v) {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/**
 * Validate a declaration. Returns { ok, actions } or { ok:false, reasons }.
 *
 * A declaration that allows NOTHING is refused: a card with no action is a
 * notification pretending to be a decision, and the owner would be left tapping
 * DETAIL forever.
 */
export function validateEscalationActions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reasons: ["escalation_actions bukan objek"] };
  }
  const reasons = [];
  const actions = {};
  for (const flag of ACTION_FLAGS) {
    if (input[flag] === undefined) { actions[flag] = DEFAULT_ACTIONS[flag]; continue; }
    const b = asBool(input[flag]);
    if (b === null) { reasons.push(`${flag}: bukan boolean`); continue; }
    actions[flag] = b;
  }
  if (reasons.length) return { ok: false, reasons };
  if (!ACTION_FLAGS.some((f) => actions[f])) {
    return { ok: false, reasons: ["tidak ada aksi yang diizinkan — kartu tanpa aksi bukan keputusan"] };
  }
  return { ok: true, actions };
}

/** The comment body a producer posts to declare its actions. */
export function buildEscalationActionsCommentBody(input) {
  const v = validateEscalationActions(input);
  if (!v.ok) throw new Error(`invalid escalation actions: ${v.reasons.join("; ")}`);
  return `${ESCALATION_ACTIONS_MARKER} ${JSON.stringify({ escalation_actions: v.actions })}`;
}

/**
 * The declaration on an issue, or null.
 *
 * Comments arrive NEWEST FIRST from Paperclip and this scans in the order
 * given, so a re-escalation's declaration supersedes the one before it — the
 * same rule parseDecisionBriefFromComments follows, for the same reason.
 */
export function parseEscalationActionsFromComments(comments) {
  if (!Array.isArray(comments)) return null;
  for (const c of comments) {
    const body = typeof c?.body === "string" ? c.body : "";
    if (!body.trimStart().startsWith(ESCALATION_ACTIONS_MARKER)) continue;
    const json = body.slice(body.indexOf(ESCALATION_ACTIONS_MARKER) + ESCALATION_ACTIONS_MARKER.length).trim();
    let parsed;
    try { parsed = JSON.parse(json); } catch { continue; }
    const v = validateEscalationActions(parsed && parsed.escalation_actions);
    if (v.ok) return v.actions;
  }
  return null;
}

/**
 * The buttons an escalation's declaration asks for.
 *
 * DETAIL and TUNDA are not among the four: DETAIL only reads, and deferring is
 * always available because "not now" is always a truthful answer. Everything
 * that CHANGES the issue is declared.
 */
export function buttonsForActions(shortId, actions = DEFAULT_ACTIONS) {
  const rows = [];
  if (actions.allow_accept) rows.push([{ text: "SETUJUI", callback_data: `a:${shortId}` }]);
  if (actions.allow_edit) rows.push([{ text: "UBAH RENCANA", callback_data: `e:${shortId}` }]);
  if (actions.allow_respond) rows.push([{ text: "BALAS", callback_data: `b:${shortId}` }]);
  if (actions.allow_ignore) rows.push([{ text: "TOLAK", callback_data: `r:${shortId}` }]);
  rows.push([{ text: "DETAIL", callback_data: `d:${shortId}` }]);
  rows.push([{ text: "TUNDA", callback_data: `z:${shortId}` }]);
  return rows;
}

/** The pending edit request for a card, or null. Newest first, like the rest. */
export function pendingEditRequest(comments, cardMessageId) {
  if (!Array.isArray(comments)) return null;
  for (const c of comments) {
    const body = typeof c?.body === "string" ? c.body : "";
    const trimmed = body.trimStart();
    // A revision CONSUMES the request that came before it, so a reply is turned
    // into a plan exactly once.
    if (trimmed.startsWith(OWNER_REVISION_MARKER)) return null;
    if (!trimmed.startsWith(EDIT_REQUESTED_MARKER)) continue;
    const json = body.slice(body.indexOf(EDIT_REQUESTED_MARKER) + EDIT_REQUESTED_MARKER.length).trim();
    let parsed;
    try { parsed = JSON.parse(json); } catch { continue; }
    const req = parsed && parsed.edit_requested;
    if (!req || typeof req !== "object") continue;
    if (cardMessageId != null && req.message_id != null && String(req.message_id) !== String(cardMessageId)) continue;
    return req;
  }
  return null;
}

/** The comment body recording that the owner asked to revise the plan. */
export function buildEditRequestedCommentBody({ shortId, messageId, at }) {
  return `${EDIT_REQUESTED_MARKER} ${JSON.stringify({
    edit_requested: { short_id: shortId || null, message_id: messageId ?? null, at: at || new Date().toISOString() },
  })}`;
}

/** The comment body carrying the owner's revision, verbatim. */
export function buildOwnerRevisionCommentBody({ shortId, revision, at }) {
  return `${OWNER_REVISION_MARKER} ${JSON.stringify({
    owner_revision: { short_id: shortId || null, revision: String(revision || ""), at: at || new Date().toISOString() },
  })}`;
}
