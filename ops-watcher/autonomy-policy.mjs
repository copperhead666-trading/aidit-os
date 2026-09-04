// ops-watcher/autonomy-policy.mjs
//
// One question, one answer: may this piece of work run unattended, or does it
// go to the owner?
//
// WHY IT IS A SEPARATE FILE. The same question is already answered in three
// places by three different rules — that is the disease this whole migration
// exists to end. This is the single predicate. Everything that wants to know
// asks here.
//
// THE HOLE THIS CLOSES FIRST. Reviewed blind by SOEKARNO on 2026-09-04, the
// first draft of the rule was: reversible, inside the repo, has a passing
// verify command, touches no hard stop. Its answer:
//
//   "Verify command lie. Agent picks or writes the verify command itself —
//    narrow test, `|| true`, skipped suite, stale cache — so 'has passing
//    verify' passes while work actually unchecked."
//
// It is right, and it is fatal. A plan that supplies its own success criterion
// has not been checked; it has been asked to mark its own paper. So a verify
// command is only accepted when it appears in an ALLOW-LIST the agent cannot
// write — config/ventures.json for a venture, or the repo-wide default below.
// A proposal may choose FROM the list. It may never add to it.
//
// SHAPE OF THE ANSWER. Never a bare boolean. { autonomous, reasons[] } — the
// reasons are what an owner reads on the card when the answer is no, and what a
// developer reads when the answer is yes and should not have been.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { hardStopsFor, ownerDecisionRequiredFor, ventureForPath } from "./ventures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Verify commands this repo trusts regardless of venture. Every one of them
// runs the WHOLE suite or a whole named suite — a verify that can pass while
// most of the system is untested is the failure SOEKARNO named.
export const DEFAULT_VERIFY_ALLOWLIST = Object.freeze([
  "node ops-watcher/run-all-tests.mjs",
  "node ops-watcher/reconcile.mjs --once",
  "node scripts/audit-cockpit.mjs",
]);

// Paths an autonomous change may never touch, whatever else is true. These are
// the lines from the owner's autonomy contract (decision-ledger D40) expressed
// as paths, plus the two stores whose single-writer discipline the whole ledger
// migration rests on.
export const NEVER_AUTONOMOUS_PATHS = Object.freeze([
  ".env",
  ".claude/settings.json",
  ".claude/settings.local.json",
  "config/decision-ledger.json",
  "docs/standards/agent-autonomy.md",
  "state/ledger.jsonl",
  ".paperclip/",
  "ops-watcher/PAUSED",
]);

// Shell metacharacters that turn one command into two. A verify that can chain
// is a verify that can end in `|| true`.
const CHAINING = /[;&|]|\$\(|`|\n/;

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalise(p) {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Is this verify command one the agent was ALLOWED to choose, rather than one
 * it wrote? Exact match against the list — not "starts with", because
 * "node ops-watcher/run-all-tests.mjs || true" starts with an allowed command
 * and checks nothing.
 */
export function verifyIsPreApproved(verify, allowlist = DEFAULT_VERIFY_ALLOWLIST) {
  const v = String(verify || "").trim();
  if (!v) return { ok: false, reason: "no verify command" };
  if (CHAINING.test(v)) return { ok: false, reason: "verify command chains or redirects" };
  if (!allowlist.includes(v)) {
    return { ok: false, reason: `verify command is not on the pre-approved list: ${JSON.stringify(v)}` };
  }
  return { ok: true };
}

/** Does this path fall under a prefix, on a directory boundary? */
export function underPrefix(file, prefix) {
  const f = normalise(file);
  const p = normalise(prefix);
  if (!f || !p) return false;
  if (p.endsWith("/")) return f.startsWith(p);
  return f === p || f.startsWith(p + "/");
}

/**
 * Decide. Returns { autonomous, reasons } — reasons is ALWAYS populated when
 * autonomous is false, and empty when it is true.
 *
 * proposal: { files[], verify, reversible, taskClass, ventureId, origin }
 */
export async function decideAutonomy(proposal = {}, deps = {}) {
  const reasons = [];
  const files = asArray(proposal.files).map(normalise).filter(Boolean);

  // 1. Reversibility is claimed by the proposer, so it is necessary but never
  //    sufficient. Everything below assumes the claim could be wrong.
  if (proposal.reversible !== true) {
    reasons.push("the change does not declare itself reversible");
  }

  // 2. Nothing to change is not the same as a safe change. A proposal touching
  //    no files cannot be verified by a file-scoped rollback either.
  if (files.length === 0) {
    reasons.push("the proposal names no files, so nothing can be snapshotted or rolled back");
  }

  // 3. Inside the repo. A relative path that climbs out is the oldest trick.
  for (const f of files) {
    if (f.startsWith("..") || /^[a-zA-Z]:/.test(f) || f.startsWith("/")) {
      reasons.push(`file leaves the repository: ${f}`);
    }
  }

  // 4. The contract's own untouchables.
  for (const f of files) {
    for (const never of NEVER_AUTONOMOUS_PATHS) {
      if (underPrefix(f, never)) reasons.push(`${f} is never changed autonomously (${never})`);
    }
  }

  // 5. The verify command must have been CHOSEN from a list, not written.
  const venture = proposal.ventureId
    ? { id: proposal.ventureId }
    : (files.length ? await ventureForPath(files[0], deps) : null);
  const allowlist = deps.verifyAllowlist
    || (venture && Array.isArray(venture.verifyAllowlist) ? venture.verifyAllowlist : null)
    || DEFAULT_VERIFY_ALLOWLIST;
  const verdict = verifyIsPreApproved(proposal.verify, allowlist);
  if (!verdict.ok) reasons.push(verdict.reason);

  // 6. Venture hard stops and the always-his list.
  const ventureId = (venture && venture.id) || proposal.ventureId || null;
  if (ventureId) {
    const stops = await hardStopsFor(ventureId, deps);
    const always = await ownerDecisionRequiredFor(ventureId, deps);
    if (stops.length === 0 && always.length === 0) {
      // An unknown venture is not a permissive one.
      reasons.push(`venture ${ventureId} declares no hard stops, so nothing is known to be safe in it`);
    }
    for (const s of asArray(proposal.touchesHardStops)) {
      reasons.push(`touches a declared hard stop: ${s}`);
    }
    for (const a of asArray(proposal.touchesOwnerDecisions)) {
      reasons.push(`this is always the owner's in ${ventureId}: ${a}`);
    }
  }

  return { autonomous: reasons.length === 0, reasons, ventureId };
}
