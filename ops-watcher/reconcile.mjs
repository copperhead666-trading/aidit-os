// ops-watcher/reconcile.mjs
//
// Standing read-only invariant checker: compare the typed ledger projection
// against the live Paperclip board and make drift loud. This file is a PROBE,
// not an actuator: no comments, no Telegram, no PATCH.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { readAll } from "./ledger.mjs";
import { foldDirectives, project, indexEvents, DIRECTIVE_LABEL } from "./projections.mjs";
import { waitingOnOwner, reachableByCard } from "./needs-owner.mjs";
import { buildDigest } from "./owner-surface.mjs";
import { classifyDirective } from "./directive-runner.mjs";
import {
  discoverPaperclipPort,
  httpGet,
  listIssues,
  CANONICAL_COMPANY_ID,
} from "./paperclip-write-client.mjs";

function asEvents(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.events)) return value.events;
  return [];
}

async function defaultReadLedger() {
  const result = await readAll();
  if (result && result.ok === false) {
    throw new Error(result.reason || "ledger read failed");
  }
  return asEvents(result);
}

async function defaultFetchIssues(deps = {}) {
  const companyId = deps.companyId || CANONICAL_COMPANY_ID;
  const _listIssues = deps.listIssues || listIssues;
  const _httpGet = deps.httpGet || httpGet;
  const base = deps.base !== undefined
    ? deps.base
    : await (async () => {
        const port = await discoverPaperclipPort();
        return port ? `http://127.0.0.1:${port}` : null;
      })();

  if (!base) throw new Error("no Paperclip base resolved");

  const listed = await _listIssues(base, companyId);
  if (listed.networkError) {
    throw new Error(`issues list network error: ${listed.networkErrorMessage}`);
  }
  if (listed.authRequired) throw new Error("issues list auth required");

  const issues = Array.isArray(listed.issues) ? listed.issues : [];
  const out = [];
  for (const issue of issues) {
    let comments = Array.isArray(issue.comments) ? issue.comments : [];
    if (!Array.isArray(issue.comments) && issue && issue.id) {
      const r = await _httpGet(`${base}/api/issues/${issue.id}/comments`);
      if (r.networkError) {
        throw new Error(`${issue.identifier || issue.id}: comments network error: ${r.networkErrorMessage}`);
      }
      comments = Array.isArray(r.body) ? r.body : [];
    }
    out.push({ ...issue, comments });
  }
  return out;
}

function issueId(issue) {
  return String(issue?.identifier || issue?.id || "(unknown)");
}

function labelNames(issue) {
  return (Array.isArray(issue?.labels) ? issue.labels : [])
    .map((label) => (typeof label === "string" ? label : label?.name))
    .filter(Boolean)
    .map(String);
}

function hasLabel(issue, name) {
  const want = String(name).toUpperCase();
  return labelNames(issue).some((label) => label.toUpperCase() === want);
}

function byIdentifier(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function sortedDiff(left, right) {
  const rs = new Set(right);
  return left.filter((id) => !rs.has(id)).sort(byIdentifier);
}

function makeCheck(name, ok, expected, actual, detail) {
  return { name, ok, expected, actual, detail };
}

function failureChecks(message) {
  return [
    makeCheck("owner-surface", false, "inputs readable", "setup-error", [message]),
    makeCheck("projection-vs-parser", false, "inputs readable", "setup-error", [message]),
    makeCheck("fold-determinism", false, "inputs readable", "setup-error", [message]),
  ];
}

// WHAT THIS CHECK ASKS, AND WHY IT CHANGED.
//
// It used to ask "does everyone waiting carry the OWNER_REQUIRED label", and
// answered 17 versus 3. That was the right alarm and it did its job: eight real
// decisions had never been sent. But the fix was never "label all seventeen" —
// owner-surface.mjs already ruled that something escalated on purpose, or a plan
// the runner stopped at, EARNS an interrupt, and everything else belongs in one
// daily summary. Sending a card for `OWNER DIRECTIVE: oke` would be asking the
// owner to approve his own word.
//
// So the invariant is now the one that actually matters: nobody waiting falls
// off BOTH surfaces. A card, or the digest — never silence. Left as a count
// comparison against the label, this check would have failed forever, and a
// check that always fails is noise, which is worse than no check.
function ownerSurfaceCheck(issues, now) {
  const waiting = waitingOnOwner(issues, { now }).map((r) => r.identifier);
  const summary = buildDigest(issues, { now });
  const surfaced = [...summary.cards, ...summary.digest].map((r) => r.identifier);
  const dropped = sortedDiff(waiting, surfaced);
  const orphaned = sortedDiff(surfaced, waiting);

  const detail = [];
  if (dropped.length) detail.push(`waiting-but-on-no-surface: ${dropped.join(", ")}`);
  if (orphaned.length) detail.push(`surfaced-but-not-waiting: ${orphaned.join(", ")}`);
  detail.push(
    `split: ${summary.cards.length} card, ${summary.digest.length} digest` +
      (reachableByCard(issues).length !== summary.cards.length
        ? ` (label-only would have reached ${reachableByCard(issues).length})`
        : ""),
  );

  return makeCheck(
    "owner-surface",
    dropped.length === 0 && orphaned.length === 0,
    waiting.length,
    surfaced.length,
    detail,
  );
}

function projectionVsParserCheck(events, issues, now) {
  const idx = indexEvents(events);
  const folded = foldDirectives(events, { now, index: idx });
  const disagreements = [];

  for (const issue of issues.filter((it) => hasLabel(it, DIRECTIVE_LABEL))) {
    const id = issueId(issue);
    const foldState = folded.get(id)?.state || "(absent)";
    const parserState = classifyDirective(issue, issue.comments || [], { now }).state || "(unknown)";
    if (foldState !== parserState) disagreements.push(`${id}: fold=${foldState} parser=${parserState}`);
  }

  return makeCheck("projection-vs-parser", disagreements.length === 0, 0, disagreements.length, disagreements);
}

function deterministicShuffle(list) {
  const out = list.slice();
  // Deterministic shuffle: this check must be reproducible when it screams.
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 17 + 11) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function stringify(value) {
  return JSON.stringify(value);
}

function firstDifferingSubject(a, b) {
  const am = new Map((a.directives || []).map((d) => [d.subject, d]));
  const bm = new Map((b.directives || []).map((d) => [d.subject, d]));
  const subjects = [...new Set([...am.keys(), ...bm.keys()])].sort(byIdentifier);
  for (const subject of subjects) {
    if (stringify(am.get(subject)) !== stringify(bm.get(subject))) return subject;
  }
  for (const key of Object.keys(a)) {
    if (stringify(a[key]) !== stringify(b[key])) return key;
  }
  for (const key of Object.keys(b)) {
    if (!(key in a)) return key;
  }
  return null;
}

function foldDeterminismCheck(events, now) {
  const shuffled = deterministicShuffle(events).sort((a, b) => (Number(a?.seq) || 0) - (Number(b?.seq) || 0));
  const first = project(events, { now });
  const second = project(shuffled, { now });
  const ok = stringify(first) === stringify(second);
  const differing = ok ? null : firstDifferingSubject(first, second);
  return makeCheck("fold-determinism", ok, "same projection", ok ? "same projection" : "different projection", differing ? [differing] : []);
}

export async function reconcileOnce(deps = {}) {
  const _readLedger = deps._readLedger || defaultReadLedger;
  const _fetchIssues = deps._fetchIssues || (() => defaultFetchIssues(deps));
  const _now = deps._now || Date.now;
  const nowMs = _now();
  const now = () => nowMs;

  let events;
  let issues;
  try {
    events = asEvents(await _readLedger());
    issues = await _fetchIssues();
  } catch (err) {
    const checks = failureChecks(err && err.message ? err.message : String(err));
    return { ok: false, differences: checks.length, checks };
  }

  const checks = [
    ownerSurfaceCheck(Array.isArray(issues) ? issues : [], now),
    projectionVsParserCheck(events, Array.isArray(issues) ? issues : [], now),
    foldDeterminismCheck(events, now),
  ];
  const differences = checks.filter((check) => !check.ok).length;
  return { ok: differences === 0, differences, checks };
}

function parseArgs(argv) {
  return { once: argv.includes("--once") };
}

function formatDetail(detail) {
  if (Array.isArray(detail)) return detail.length ? detail.join("; ") : "none";
  return detail == null || detail === "" ? "none" : String(detail);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/reconcile.mjs --once");
    process.exit(2);
  }
  const result = await reconcileOnce();
  for (const check of result.checks) {
    console.log(
      `reconcile ${check.name}: ${check.ok ? "OK" : "FAIL"} expected=${check.expected} actual=${check.actual} detail=${formatDetail(check.detail)}`,
    );
  }
  process.exit(result.differences === 0 ? 0 : 1);
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) main().catch((err) => {
  console.error("reconcile fatal:", err && err.stack ? err.stack : err);
  process.exit(1);
});
