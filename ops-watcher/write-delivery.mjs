// ops-watcher/write-delivery.mjs
// One judge for "did the Paperclip write actually land?".
//
// paperclip-write-client's writeRequest reports failure by RETURN VALUE, not by
// throwing, and it distinguishes three kinds of failure that callers have been
// collapsing into one:
//
//   fetch failed        -> { status: 0,   networkError: true,  networkErrorMessage }
//   401 / 403 rejected  -> { status: 401, networkError: false, authRequired: true, body: null }
//   4xx / 5xx refused   -> { status: 500, networkError: false, body: <whatever> }
//
// A caller that tests only `if (r.networkError)` therefore treats a rejected
// write as a successful one. That is not a cosmetic mislabel: the comment the
// owner is supposed to read never exists, while the sweep goes on to advance
// state that assumes it does — reset a plan-attempt counter, send a decision
// card, spawn a dispatch, stamp an escalation as delivered.
//
// This was not hypothetical. On 2026-09-02T04:58Z a sweep judged KOL-73's plan
// comment "posted" from a result nobody read, sent the decision card, and reset
// the attempt counter. The issue never received the comment, so the owner was
// left with a directive that looked like it was awaiting his decision on a plan
// he was never shown.
//
// Rule: only a result that positively reports a 2xx counts as written.
// Anything else — a network error, an auth rejection, a non-2xx status, a
// thrown exception, or no result at all — is a failure with a stated reason.

// Judge one write result. Never throws.
export function judgeWrite(result) {
  if (result === null || result === undefined) {
    return { ok: false, reason: "write returned nothing" };
  }
  if (typeof result !== "object") {
    return { ok: false, reason: `write returned ${typeof result}` };
  }
  if (result.networkError) {
    return { ok: false, reason: `network error: ${result.networkErrorMessage || "fetch failed"}` };
  }
  if (result.authRequired) {
    return { ok: false, reason: `rejected (status ${result.status ?? "401/403"}) - auth required` };
  }
  if (typeof result.status === "number") {
    if (result.status >= 200 && result.status < 300) return { ok: true, reason: null };
    return { ok: false, reason: `rejected (status ${result.status})` };
  }
  // No status field at all: the domain helpers (postComment/patchIssue) report
  // their outcome through the returned entity instead. A null entity is a
  // failure; anything else is accepted, because a helper that carried neither a
  // status nor an entity would have set networkError above.
  if ("comment" in result) {
    return result.comment == null
      ? { ok: false, reason: "write returned no comment" }
      : { ok: true, reason: null };
  }
  if ("issue" in result) {
    return result.issue == null
      ? { ok: false, reason: "write returned no issue" }
      : { ok: true, reason: null };
  }
  return { ok: true, reason: null };
}

// Run a write and judge it in one step. Accepts sync or async callers, and
// converts a throw into the same verdict shape so no caller needs its own
// try/catch to stay honest.
export async function deliverWrite(write) {
  let result;
  try {
    result = await write();
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
  return judgeWrite(result);
}
