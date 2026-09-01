// ops-watcher/notion-probe.mjs
// Read-only Notion connectivity probe. Prints a SAFE report (no secret value ever).
//
//   node ops-watcher/notion-probe.mjs
//
// What it does:
//   1. GET /v1/users/me        — verifies the token.
//   2. POST /v1/search         — lists exactly the pages shared with the integration.
//
// It performs NO writes (no page creation, no database creation, no updates).
// It never throws. Exit 0 on a completed probe; exit 1 only when the probe
// itself could not run.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv, describeSecretPresence } from "./local-env.mjs";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2026-03-11";
const TIMEOUT_MS = 10000;

function plainText(richText) {
  if (!Array.isArray(richText)) return "";
  return richText.map((r) => r?.plain_text ?? r?.text?.content ?? "").join("");
}

function pageTitle(page) {
  // A page's title lives in the "title"-typed property of its `properties`.
  const props = page?.properties;
  if (!props || typeof props !== "object") return "";
  for (const name of Object.keys(props)) {
    const prop = props[name];
    if (prop && prop.type === "title" && Array.isArray(prop.title)) {
      return plainText(prop.title);
    }
  }
  return "";
}

async function notionFetch(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try { ctrl.abort(); } catch { /* ignore */ }
  }, timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { ok: true, res, aborted: false, error: null };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      res: null,
      aborted,
      error: err && err.message ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  try {
    const ct = res.headers?.get?.("content-type") || "";
    if (ct.includes("json")) return await res.json();
    return await res.text();
  } catch (err) {
    return { __parseError: err && err.message ? err.message : String(err) };
  }
}

function apiErrorMessage(body, status) {
  if (body && typeof body === "object") {
    if (typeof body.message === "string" && body.message) return body.message;
    if (typeof body.code === "string" && body.code) return body.code;
  }
  return `HTTP ${status}`;
}

async function probe() {
  const loadResult = loadLocalEnv(["NOTION_TOKEN", "NOTION_PARENT_PAGE_ID"]);
  const presence = describeSecretPresence(loadResult);
  const token = loadResult.values.NOTION_TOKEN || "";
  const tokenPresent = !!loadResult.found.NOTION_TOKEN;
  const tokenLength = presence.NOTION_TOKEN ? presence.NOTION_TOKEN.length : 0;
  const configuredParentPageId = (loadResult.values.NOTION_PARENT_PAGE_ID || "").trim();

  const report = {
    tokenPresent,
    tokenLength,
    usersMe: null,
    pages: [],
    verdict: null,
  };

  const out = [];
  out.push(`NOTION token: ${tokenPresent ? `found (length ${tokenLength})` : "not found"}`);
  out.push(`NOTION_PARENT_PAGE_ID configured: ${configuredParentPageId ? `yes (id length ${configuredParentPageId.length})` : "no"}`);

  if (!token) {
    report.verdict = "NOTION: token missing/invalid (no token loaded from .env.local or process.env)";
    out.push(report.verdict);
    return { report, lines: out };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_API_VERSION,
  };

  // 1. GET /users/me — verifies the token.
  const meUrl = `${NOTION_API_BASE}/users/me`;
  const meFetch = await notionFetch(meUrl, { method: "GET", headers }, TIMEOUT_MS);
  if (!meFetch.ok) {
    report.verdict = `NOTION: probe could not reach /users/me — ${meFetch.aborted ? "timed out" : "network error"} (${meFetch.error})`;
    out.push(report.verdict);
    return { report, lines: out };
  }
  const meRes = meFetch.res;
  const meStatus = Number(meRes?.status || 0);
  const meBody = await readJson(meRes);

  if (meStatus < 200 || meStatus >= 300) {
    const apiMsg = apiErrorMessage(meBody, meStatus);
    report.verdict = `NOTION: token missing/invalid (${meStatus}) — ${apiMsg}`;
    report.usersMe = { status: meStatus, message: apiMsg };
    out.push(`/users/me: HTTP ${meStatus}`);
    out.push(report.verdict);
    return { report, lines: out };
  }

  const botName = meBody?.name || "(unnamed integration)";
  const workspaceName =
    meBody?.bot?.workspace_name || meBody?.workspace_name || "(unknown workspace)";
  report.usersMe = { status: meStatus, botName, workspaceName };
  out.push(`/users/me: HTTP ${meStatus} — integration "${botName}", workspace "${workspaceName}"`);

  // 2. POST /search — list exactly the pages shared with the integration.
  const searchUrl = `${NOTION_API_BASE}/search`;
  const searchFetch = await notionFetch(searchUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: { value: "page", property: "object" },
      page_size: 20,
    }),
  }, TIMEOUT_MS);

  if (!searchFetch.ok) {
    report.verdict = `NOTION: probe could not reach /search — ${searchFetch.aborted ? "timed out" : "network error"} (${searchFetch.error})`;
    out.push(report.verdict);
    return { report, lines: out };
  }

  const searchRes = searchFetch.res;
  const searchStatus = Number(searchRes?.status || 0);

  if (searchStatus < 200 || searchStatus >= 300) {
    const errBody = await readJson(searchRes);
    const msg = apiErrorMessage(errBody, searchStatus);
    report.verdict = `NOTION: token missing/invalid (${searchStatus}) — ${msg}`;
    out.push(`/search: HTTP ${searchStatus}`);
    out.push(report.verdict);
    return { report, lines: out };
  }

  const searchBody = await readJson(searchRes);
  const results = Array.isArray(searchBody?.results) ? searchBody.results : [];
  const accessiblePages = [];
  for (const page of results) {
    if (page?.object !== "page") continue;
    accessiblePages.push({ id: page.id || "(no id)", title: pageTitle(page) });
  }

  report.pages = accessiblePages;
  out.push(`/search: ${accessiblePages.length} page(s) accessible`);
  for (const p of accessiblePages) {
    out.push(`  - ${p.id}  "${p.title}"`);
  }

  if (accessiblePages.length === 0) {
    report.verdict =
      "NOTION: no pages shared — open the target Notion page, ⋯ menu, Connections, add the integration";
  } else if (accessiblePages.length === 1) {
    const only = accessiblePages[0];
    report.verdict = `NOTION: ready — parent page candidate ${only.id} "${only.title}"`;
  } else {
    report.verdict =
      `NOTION: ambiguous — ${accessiblePages.length} pages accessible, set NOTION_PARENT_PAGE_ID to one of the ids above`;
  }
  out.push(report.verdict);
  return { report, lines: out };
}

async function main() {
  try {
    const { lines } = await probe();
    for (const line of lines) console.log(line);
    // Exit 0 on a completed probe (even when the verdict is "token invalid").
    process.exit(0);
  } catch {
    // The probe itself never throws, but defend against the unexpected without
    // leaking any secret: print only a generic message.
    console.error("NOTION: probe could not run — internal error (no secret disclosed)");
    process.exit(1);
  }
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isEntry) {
  main();
}