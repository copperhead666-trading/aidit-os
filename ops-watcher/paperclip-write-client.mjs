// ops-watcher/paperclip-write-client.mjs
// Crash-proof write helpers for the Paperclip REST API, mirroring the
// never-throw style of watcher.mjs's httpGet. Any fetch-level failure
// (ECONNREFUSED, timeout, DNS, abort, malformed JSON) is reported as a clean
// { networkError: true, networkErrorMessage } result instead of propagating as
// an uncaught exception. 401/403 are reported as { authRequired: true } so the
// caller can resolve a bearer token and retry (we do NOT silently hardcode any
// token).
//
// Exports:
//   httpPost(url, body, opts)      -> { status, body, authRequired, networkError, networkErrorMessage }
//   httpPatch(url, body, opts)     -> same shape
//   resolvePaperclipToken()        -> string|null  (board/owner bearer token from the
//                                    Paperclip secrets dir, same pattern as watcher.mjs)
//   resolveGibranToken({ base, agentId, keyFile, keyName })
//                                  -> string|null  (per-agent API key for GIBRAN comment
//                                    attribution; created on first use and cached to a
//                                    local gitignored *.key file)
//   discoverPaperclipPort, httpGet -> re-exported from watcher.mjs so consumers can
//                                    import everything write-related from one place.
//   listLabels / findLabelId / ensureLabel / postComment / patchIssue
//                                  -> convenience domain helpers composing the above
//                                    into the common Paperclip operations the
//                                    ops-watcher runners (review-runner, telegram-*,
//                                    test-runner) need. Crash-proof result objects.
//
//   node ops-watcher/paperclip-write-client.mjs --selftest   # offline smoke of POST/PATCH
//
// NOTE on auth: this Paperclip instance runs in `local_trusted` deployment mode
// and the REST endpoints used here currently answer 200 with NO bearer token.
// The token paths exist purely for robustness / forward compatibility (if the
// instance is ever reconfigured to require BoardApiKeyAuth / AgentBearerAuth,
// these helpers already do the right thing).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverPaperclipPort, httpGet } from "./watcher.mjs";

export { discoverPaperclipPort, httpGet };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRETS_DIR = "D:\\AI\\Active FounderOS-Aidit\\.paperclip\\instances\\default\\secrets";

// ---- Board/owner token resolution (reuses watcher.mjs's secrets-dir pattern) ----
// watcher.mjs keeps resolvePaperclipToken() private; rather than duplicate the
// logic and risk drift, we re-implement the identical pattern here (it is tiny and
// the secrets-dir layout is a stable contract of this instance). Returns null on
// any failure — never throws.
export async function resolvePaperclipToken() {
  let entries;
  try {
    entries = await fs.readdir(SECRETS_DIR);
  } catch {
    return null;
  }
  const pick =
    entries.find((f) => /token/i.test(f)) ||
    entries.find((f) => !f.startsWith("."));
  if (!pick) return null;
  try {
    return (await fs.readFile(path.join(SECRETS_DIR, pick), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

// ---- Per-agent API key (for agent-attributed comments) ----
// Paperclip attributes a comment to an agent ONLY when the request carries that
// agent's own API key as `Authorization: Bearer <pcp_...>` AND (for cross-issue
// writes) a valid `X-Paperclip-Run-Id` header. The plaintext key is returned exactly
// once by POST /api/agents/{id}/keys (field `token`); the list endpoint only
// exposes metadata. So we create the key once, cache the plaintext to a local
// gitignored file (matched by .gitignore's `*.key` rule), and reuse it. If a write
// with the cached key ever comes back 401/403, the caller should delete the file
// and call this again to mint a fresh key.
export async function resolveGibranToken({
  base,
  agentId,
  keyFile = path.join(__dirname, "gibran-api.key"),
  keyName = "ops-watcher-review-runner-phase2",
} = {}) {
  // 1. Try cached plaintext.
  try {
    const cached = (await fs.readFile(keyFile, "utf8")).trim();
    if (cached) return cached;
  } catch {
    /* fall through to mint */
  }
  if (!base || !agentId) return null;
  // 2. Mint a new key.
  const res = await httpPost(`${base}/api/agents/${agentId}/keys`, {
    name: keyName,
    scope: { kind: "standard" },
  });
  if (res.networkError || !res.body) return null;
  const token = res.body.token || res.body.key || res.body.apiKey || res.body.plaintext;
  if (!token) return null;
  try {
    await fs.writeFile(keyFile, String(token), "utf8");
  } catch {
    /* caching is best-effort; the in-memory token still works this run */
  }
  return String(token);
}

// Invalidate a cached agent key (called when a 401/403 suggests revocation).
export async function invalidateGibranToken(
  keyFile = path.join(__dirname, "gibran-api.key"),
) {
  try {
    await fs.unlink(keyFile);
  } catch {
    /* already gone */
  }
}

// ---- Crash-proof POST / PATCH ----
// Result shape (matches the documented contract above): on any non-throwing
// outcome we include `networkError` (false unless a fetch-level failure
// occurred) so callers can uniformly test `if (r.networkError)`.
async function writeRequest(method, url, body, { token, headers } = {}) {
  const hdrs = { "content-type": "application/json" };
  if (token) hdrs.authorization = `Bearer ${token}`;
  if (headers) Object.assign(hdrs, headers);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: hdrs,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const cause =
      (err && err.cause && err.cause.code) ||
      (err && err.cause && err.cause.message);
    return {
      status: 0,
      body: null,
      authRequired: false,
      networkError: true,
      networkErrorMessage: cause || (err && err.message) || "fetch failed",
    };
  }
  if (res.status === 401 || res.status === 403)
    return { status: res.status, body: null, authRequired: true, networkError: false };
  const ct = res.headers.get("content-type") || "";
  try {
    const parsed = ct.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body: parsed, authRequired: false, networkError: false };
  } catch (err) {
    return {
      status: res.status,
      body: null,
      authRequired: false,
      networkError: true,
      networkErrorMessage: (err && err.message) || "response parse failed",
    };
  }
}

export async function httpPost(url, body, opts = {}) {
  return writeRequest("POST", url, body, opts);
}
export async function httpPatch(url, body, opts = {}) {
  return writeRequest("PATCH", url, body, opts);
}

// ---- Convenience domain helpers (labels / comments / issues), crash-proof ----
// These compose httpGet/httpPost/httpPatch into the common Paperclip operations
// the ops-watcher runners need. Every helper returns a result object and NEVER
// throws (same contract as httpGet/httpPost). A network-level failure is
// reported as { networkError: true, networkErrorMessage }.
//
//   listLabels(base, companyId)               -> { labels:[], networkError, networkErrorMessage?, reason? }
//   findLabelId(base, companyId, name)        -> string|null  (case-insensitive match; null if missing/unreachable)
//   ensureLabel(base, companyId, name, color) -> { id, created, networkError?, networkErrorMessage?, status? }
//   postComment(base, issueId, body, opts)    -> { comment, status, networkError?, authRequired?, networkErrorMessage? }
//   patchIssue(base, issueId, patch, opts)    -> { issue, status, networkError?, authRequired?, networkErrorMessage? }
export async function listLabels(base, companyId) {
  if (!base) return { labels: [], networkError: false, reason: "no-base" };
  const r = await httpGet(`${base}/api/companies/${companyId}/labels`);
  if (r.networkError)
    return { labels: [], networkError: true, networkErrorMessage: r.networkErrorMessage };
  if (r.authRequired) return { labels: [], networkError: false, authRequired: true };
  return { labels: Array.isArray(r.body) ? r.body : [], networkError: false };
}

export async function findLabelId(base, companyId, name) {
  const { labels } = await listLabels(base, companyId);
  const up = String(name).toUpperCase();
  const found = labels.find((l) => String(l.name).toUpperCase() === up);
  return found ? found.id : null;
}

export async function ensureLabel(base, companyId, name, color) {
  const id = await findLabelId(base, companyId, name);
  if (id) return { id, created: false };
  const r = await httpPost(`${base}/api/companies/${companyId}/labels`, { name, color });
  if (r.networkError)
    return { id: null, created: false, networkError: true, networkErrorMessage: r.networkErrorMessage };
  if (r.body && r.body.id) return { id: r.body.id, created: true };
  return { id: null, created: false, networkError: false, status: r.status };
}

export async function postComment(base, issueId, body, opts = {}) {
  const payload = { body, authorType: opts.authorType || "user" };
  if (opts.presentation) payload.presentation = opts.presentation;
  if (opts.metadata) payload.metadata = opts.metadata;
  const r = await httpPost(`${base}/api/issues/${issueId}/comments`, payload, {
    token: opts.token,
    headers: opts.headers,
  });
  if (r.networkError)
    return { comment: null, networkError: true, networkErrorMessage: r.networkErrorMessage };
  return { comment: r.body, status: r.status, networkError: false, authRequired: r.authRequired };
}

export async function patchIssue(base, issueId, patch, opts = {}) {
  const r = await httpPatch(`${base}/api/issues/${issueId}`, patch, {
    token: opts.token,
    headers: opts.headers,
  });
  if (r.networkError)
    return { issue: null, networkError: true, networkErrorMessage: r.networkErrorMessage };
  return { issue: r.body, status: r.status, networkError: false, authRequired: r.authRequired };
}

// ---- Canonical company id + issue listing (additive, PHASE 6 cockpit reuse) ----
// CANONICAL_COMPANY_ID is the single company this ops-watcher org operates on
// (matches the COMPANY_ID constants held locally by telegram-notify.mjs and
// review-runner.mjs; centralized here so new read-only consumers like the
// cockpit do not re-hardcode it). listIssues is the read-side companion to
// listLabels: a crash-proof GET of /api/companies/{companyId}/issues that
// returns { issues, networkError, ... } and never throws (same contract as
// listLabels). Additive only — no existing export or runner behaviour changed.
export const CANONICAL_COMPANY_ID = "a7011f31-8891-4581-b8fb-bbda8ac6a890";

export async function listIssues(base, companyId, opts = {}) {
  if (!base) return { issues: [], networkError: false, reason: "no-base" };
  const r = await httpGet(`${base}/api/companies/${companyId}/issues`, { token: opts.token });
  if (r.networkError)
    return { issues: [], networkError: true, networkErrorMessage: r.networkErrorMessage };
  if (r.authRequired) return { issues: [], networkError: false, authRequired: true };
  return { issues: Array.isArray(r.body) ? r.body : [], networkError: false, status: r.status };
}

// ---- Offline selftest (no network; exercises POST/PATCH against a local mock) ----
async function runSelftest() {
  const http = await import("node:http");
  const assert = (await import("node:assert/strict")).default;
  const calls = [];
  const server = http.createServer((req, res) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, body: buf });
      res.setHeader("content-type", "application/json");
      if (req.url === "/boom") {
        res.destroy();
        return;
      }
      res.statusCode = req.method === "POST" ? 201 : 200;
      res.end(JSON.stringify({ ok: true, echoed: buf }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const failures = [];
  const check = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  const post = await httpPost(`${base}/api/x`, { a: 1 });
  check(post.status === 201 && post.body && post.body.ok === true, "POST happy path");
  check(!post.networkError, "POST must not flag networkError on success");

  const patch = await httpPatch(`${base}/api/y`, { b: 2 }, { token: "t", headers: { "x-paperclip-run-id": "r" } });
  check(patch.status === 200, "PATCH happy path");
  check(calls[1].body === JSON.stringify({ b: 2 }), "PATCH sent correct body");

  const auth = await httpPost(`${base}/api/forbidden`, {});
  // simulate 403
  return new Promise(async (resolve) => {
    // second mini-server for 403
    const s2 = http.createServer((req, res) => {
      res.statusCode = 403;
      res.end();
    });
    await new Promise((r) => s2.listen(0, "127.0.0.1", r));
    const p2 = s2.address().port;
    const f = await httpPost(`http://127.0.0.1:${p2}/x`, {});
    check(f.status === 403 && f.authRequired === true, "403 -> authRequired");

    const boom = await httpPost(`${base}/boom`, {});
    check(boom.networkError === true, "network error -> networkError, no throw");

    server.close();
    s2.close();
    if (failures.length) {
      console.error("WRITE-CLIENT SELFTEST FAIL:");
      for (const f2 of failures) console.error("  - " + f2);
      process.exitCode = 1;
    } else {
      console.log("WRITE-CLIENT SELFTEST OK");
    }
    resolve();
  });
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  const arg = process.argv[2];
  if (arg === "--selftest") runSelftest();
}