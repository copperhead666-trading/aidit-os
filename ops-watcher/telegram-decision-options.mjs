// Shared validation + storage for dynamic Telegram decision-card options.
//
// STORAGE NOTE (real bug fix, 2026-08-30): the first version of this file
// stored options on `issue.metadata.decision_options` and PATCHed that onto
// the Paperclip issue. Verified live against the real Paperclip instance
// AFTER shipping: Paperclip's issue schema has no `metadata` field at all --
// PATCH silently accepts and drops unknown fields (HTTP 200, `changes: {}`),
// so the whole feature never actually worked in production even though its
// regression suite passed (the suite only ever ran against an in-memory mock
// that trivially echoes back any property you set on it). Comments DO
// support a real `metadata` field, but it is strictly schema-validated to a
// presentation shape (`{version:1, sections:[...]}`, confirmed by a live 400
// when a `decision_options` key was attempted there too) -- not a free-form
// store either. The only place free-form structured data reliably survives a
// round trip through the real API is a comment BODY (already proven by the
// pre-existing "[TELEGRAM SENT]" marker-comment convention), so options are
// now encoded as JSON inside a marker-prefixed comment instead.

export const MIN_DECISION_OPTIONS = 2;
export const MAX_DECISION_OPTIONS = 5;
export const DECISION_OPTIONS_MARKER = "[DECISION OPTIONS]";

export function normalizeDecisionOptions(value) {
  if (!Array.isArray(value)) return { ok: false, reason: "not an array" };
  if (value.length < MIN_DECISION_OPTIONS) return { ok: false, reason: `expected ${MIN_DECISION_OPTIONS}-${MAX_DECISION_OPTIONS} options, got ${value.length}` };
  if (value.length > MAX_DECISION_OPTIONS) return { ok: false, reason: `expected ${MIN_DECISION_OPTIONS}-${MAX_DECISION_OPTIONS} options, got ${value.length}` };

  const options = [];
  for (let i = 0; i < value.length; i += 1) {
    const it = value[i];
    if (!it || typeof it !== "object" || Array.isArray(it)) return { ok: false, reason: `option ${i} is not an object` };
    const key = String(it.key == null ? "" : it.key).trim();
    const label = String(it.label == null ? "" : it.label).trim();
    if (!key) return { ok: false, reason: `option ${i} is missing key` };
    if (!label) return { ok: false, reason: `option ${i} is missing label` };
    options.push({ key, label });
  }

  return { ok: true, options };
}

// Build the comment BODY text to POST (as a normal issue comment) to attach
// decision_options to an issue. Throws on invalid input (caller's bug, not a
// runtime condition to degrade on).
export function buildDecisionOptionsCommentBody(options) {
  const normalized = normalizeDecisionOptions(options);
  if (!normalized.ok) throw new TypeError(`invalid decision_options: ${normalized.reason}`);
  return `${DECISION_OPTIONS_MARKER}\n${JSON.stringify({ decision_options: normalized.options })}`;
}

// Scan an issue's comments (as returned by GET /api/issues/:id/comments) for
// the most recent DECISION_OPTIONS_MARKER comment and return its validated
// options. Comments are expected in creation order; the LAST matching one
// wins, so a corrected/re-sent card (see the KOL-65/66 incident) always
// takes precedence over an older, possibly-since-stale one. Never throws.
export function parseDecisionOptionsFromComments(comments) {
  const list = Array.isArray(comments) ? comments : [];
  let raw = null;
  for (const c of list) {
    const body = String((c && c.body) || "");
    if (body.startsWith(DECISION_OPTIONS_MARKER)) {
      raw = body.slice(DECISION_OPTIONS_MARKER.length).replace(/^\n/, "");
    }
  }
  if (raw == null) return { ok: false, reason: "no decision-options comment found" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `decision-options comment is not valid JSON: ${e.message}` };
  }
  return normalizeDecisionOptions(parsed && parsed.decision_options);
}
