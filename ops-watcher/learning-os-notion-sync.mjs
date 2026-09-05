// ops-watcher/learning-os-notion-sync.mjs
// Crash-proof Notion sync client for Learning OS topic records.
//
// This module is deliberately NOT wired into heartbeat yet. It is a bounded,
// dependency-injected Notion API client that can create/reuse one OWNER-editable
// database and upsert/read Learning OS topic rows by Topic ID.
//
//   node ops-watcher/learning-os-notion-sync.mjs --once
//
// SCOPE (owner decision KOL-84, accepted 2026-09-05, ledger D45): Notion is
// scoped to Learning OS ONLY. It is not a second reading surface for Aidit OS
// output — that surface is the Cockpit plus Telegram. Do not widen this sync
// to issues, decisions, or lane output without a new owner decision; a second
// surface costs synchronisation debt before the first one is finished.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLearningState } from "./learning-os.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const NOTION_API_VERSION = "2026-03-11";
export const NOTION_API_BASE = "https://api.notion.com/v1";
export const NOTION_DATABASE_TITLE = "Learning OS Topics";
export const NOTION_STATE_FILE = path.join(__dirname, "learning-os-notion-sync-state.json");
export const DEFAULT_TIMEOUT_MS = 5000;

export const PROPERTIES = {
  topic: "Topic",
  topicId: "Topic ID",
  domain: "Domain",
  understand: "Understand",
  apply: "Apply",
  produce: "Produce",
  oralReasoning: "Oral Reasoning",
  fullMatterSim: "Full Matter Sim",
  weakAreas: "Weak Areas",
  nextReview: "Next Review",
  lastUpdated: "Last Updated",
};

const MASTERY_FIELDS = [
  ["understand", PROPERTIES.understand],
  ["apply", PROPERTIES.apply],
  ["produce", PROPERTIES.produce],
  ["oral_reasoning", PROPERTIES.oralReasoning],
  ["full_matter_sim", PROPERTIES.fullMatterSim],
];

function isoNow(now) {
  if (typeof now === "function") return isoNow(now());
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "number") return new Date(now).toISOString();
  if (typeof now === "string" && now.trim()) return now;
  return new Date().toISOString();
}

function text(content) {
  return [{ type: "text", text: { content: String(content || "") } }];
}

function plainText(richText) {
  if (!Array.isArray(richText)) return "";
  return richText.map((r) => r?.plain_text ?? r?.text?.content ?? "").join("");
}

function titleOf(obj) {
  return plainText(obj?.title);
}

function compactText(s, n = 1800) {
  const oneLine = String(s || "").replace(/\s+/g, " ").trim();
  return oneLine.length > n ? oneLine.slice(0, n - 3).trimEnd() + "..." : oneLine;
}

function normalizeId(id) {
  return String(id || "").replace(/-/g, "").toLowerCase();
}

function parentPageMatches(obj, parentPageId) {
  const parent = obj?.parent;
  return parent?.type === "page_id" && normalizeId(parent.page_id) === normalizeId(parentPageId);
}

function defaultGetEnv(name) {
  return process.env[name] || "";
}

function getEnv(deps, name) {
  try {
    if (typeof deps.getEnv === "function") return deps.getEnv(name) || "";
    if (deps.env && Object.hasOwn(deps.env, name)) return deps.env[name] || "";
    return defaultGetEnv(name);
  } catch {
    return "";
  }
}

function resolveConfig(deps = {}) {
  const token = String(getEnv(deps, "NOTION_TOKEN") || "").trim();
  const parentPageId = String(getEnv(deps, "NOTION_PARENT_PAGE_ID") || "").trim();
  const missing = [];
  if (!token) missing.push("NOTION_TOKEN");
  if (!parentPageId) missing.push("NOTION_PARENT_PAGE_ID");
  return {
    token,
    parentPageId,
    missing,
    apiBase: deps.apiBase || NOTION_API_BASE,
    timeoutMs: Number.isFinite(deps.timeoutMs) ? deps.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function missingCredentialsResult(action, missing) {
  return {
    ok: false,
    configured: false,
    action,
    reason: `${missing.join(" and ")} not set -- Notion sync is not configured yet`,
    missing,
  };
}

function isOkStatus(status) {
  return status >= 200 && status < 300;
}

async function boundedCall(label, fn, timeoutMs, ctrl) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      try { ctrl?.abort?.(); } catch { /* ignore */ }
      resolve({
        ok: false,
        timedOut: true,
        error: `${label} timed out after ${timeoutMs}ms`,
        value: null,
      });
    }, timeoutMs);
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      timeout,
    ]);
    clearTimeout(timer);
    if (value && value.ok === false && value.timedOut) return value;
    return { ok: true, timedOut: false, error: null, value };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false,
      timedOut: false,
      error: `${label} failed: ${err && err.message ? err.message : err}`,
      value: null,
    };
  }
}

async function notionRequest(method, endpoint, body, deps = {}) {
  const cfg = resolveConfig(deps);
  if (cfg.missing.length) return missingCredentialsResult(`${method} ${endpoint}`, cfg.missing);
  const fetchImpl = deps.fetch || fetch;
  const ctrl = new AbortController();
  const url = `${String(cfg.apiBase).replace(/\/$/, "")}${endpoint}`;
  const headers = {
    authorization: `Bearer ${cfg.token}`,
    "notion-version": NOTION_API_VERSION,
  };
  if (body !== undefined) headers["content-type"] = "application/json";

  const r = await boundedCall(
    `notion ${method} ${endpoint}`,
    () => fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    }),
    cfg.timeoutMs,
    ctrl,
  );
  if (!r.ok) {
    return {
      ok: false,
      configured: true,
      status: 0,
      body: null,
      networkError: true,
      timedOut: r.timedOut,
      reason: r.error,
    };
  }

  const res = r.value;
  const status = Number(res?.status || 0);
  let parsed = null;
  try {
    const ct = res.headers?.get?.("content-type") || "";
    parsed = ct.includes("json") ? await res.json() : await res.text();
  } catch (err) {
    return {
      ok: false,
      configured: true,
      status,
      body: null,
      networkError: true,
      reason: err && err.message ? err.message : "response parse failed",
    };
  }
  return {
    ok: isOkStatus(status),
    configured: true,
    status,
    body: parsed,
    networkError: false,
    authRequired: status === 401 || status === 403,
    reason: isOkStatus(status) ? null : compactText(parsed?.message || parsed?.code || `HTTP ${status}`, 300),
  };
}

export async function httpGet(endpoint, deps = {}) {
  return notionRequest("GET", endpoint, undefined, deps);
}

export async function httpPost(endpoint, body, deps = {}) {
  return notionRequest("POST", endpoint, body, deps);
}

export async function httpPatch(endpoint, body, deps = {}) {
  return notionRequest("PATCH", endpoint, body, deps);
}

function notionSchema() {
  return {
    [PROPERTIES.topic]: { title: {} },
    [PROPERTIES.topicId]: { rich_text: {} },
    [PROPERTIES.domain]: { select: {} },
    [PROPERTIES.understand]: { number: { format: "percent" } },
    [PROPERTIES.apply]: { number: { format: "percent" } },
    [PROPERTIES.produce]: { number: { format: "percent" } },
    [PROPERTIES.oralReasoning]: { number: { format: "percent" } },
    [PROPERTIES.fullMatterSim]: { number: { format: "percent" } },
    [PROPERTIES.weakAreas]: { rich_text: {} },
    [PROPERTIES.nextReview]: { date: {} },
    [PROPERTIES.lastUpdated]: { date: {} },
  };
}

async function readCache(deps = {}) {
  const stateFile = deps.notionStateFile || deps.cacheFile || NOTION_STATE_FILE;
  const fsp = deps.fs || fs;
  try {
    const raw = await fsp.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeCache(cache, deps = {}) {
  const stateFile = deps.notionStateFile || deps.cacheFile || NOTION_STATE_FILE;
  const fsp = deps.fs || fs;
  try {
    await fsp.writeFile(stateFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `cache write failed: ${err && err.message ? err.message : err}`,
    };
  }
}

function dataSourceIdFromDatabase(database, preferredDataSourceId = null) {
  const dataSources = Array.isArray(database?.data_sources) ? database.data_sources : [];
  const preferred = dataSources.find((d) => normalizeId(d?.id) === normalizeId(preferredDataSourceId));
  const first = preferred || dataSources[0] || null;
  return first?.id || database?.data_source_id || null;
}

async function retrieveDatabase(databaseId, deps, preferredDataSourceId = null) {
  if (!databaseId) return { ok: false, reason: "database_id missing" };
  const r = await httpGet(`/databases/${encodeURIComponent(databaseId)}`, deps);
  if (!r.ok) return { ...r, database: null, data_source_id: null };
  return {
    ...r,
    database: r.body,
    data_source_id: dataSourceIdFromDatabase(r.body, preferredDataSourceId),
  };
}

async function findDatabaseBySearch(deps, parentPageId) {
  const r = await httpPost("/search", {
    query: NOTION_DATABASE_TITLE,
    page_size: 10,
    filter: { property: "object", value: "data_source" },
    sort: { timestamp: "last_edited_time", direction: "descending" },
  }, deps);
  if (!r.ok) return { ...r, found: false, database: null, data_source_id: null };
  for (const item of Array.isArray(r.body?.results) ? r.body.results : []) {
    if (item?.object === "data_source") {
      if (titleOf(item) !== NOTION_DATABASE_TITLE) continue;
      if (item.database_parent?.type === "page_id" && normalizeId(item.database_parent.page_id) !== normalizeId(parentPageId)) continue;
      const databaseId = item.parent?.database_id || item.database_id || null;
      if (!databaseId) continue;
      const db = await retrieveDatabase(databaseId, deps, item.id);
      if (!db.ok) return { ...db, found: false };
      return {
        ok: true,
        configured: true,
        found: true,
        database: db.database,
        database_id: databaseId,
        data_source_id: db.data_source_id,
        source: "search",
      };
    }

    if (item?.object !== "database") continue;
    if (titleOf(item) !== NOTION_DATABASE_TITLE) continue;
    if (!parentPageMatches(item, parentPageId)) continue;
    const db = await retrieveDatabase(item.id, deps);
    if (!db.ok) return { ...db, found: false };
    return {
      ok: true,
      configured: true,
      found: true,
      database: db.database,
      database_id: item.id,
      data_source_id: db.data_source_id,
      source: "search",
    };
  }
  return { ok: true, configured: true, found: false, database: null, data_source_id: null };
}

async function createDatabase(deps, parentPageId) {
  const r = await httpPost("/databases", {
    parent: { type: "page_id", page_id: parentPageId },
    title: text(NOTION_DATABASE_TITLE),
    description: text("OWNER-editable Learning OS topic progress synced from local FounderOS state."),
    is_inline: true,
    initial_data_source: {
      title: text(NOTION_DATABASE_TITLE),
      properties: notionSchema(),
    },
  }, deps);
  if (!r.ok) return { ...r, database: null, data_source_id: null };
  const databaseId = r.body?.id;
  const db = await retrieveDatabase(databaseId, deps);
  if (!db.ok) return { ...db, database_id: databaseId, created: true };
  return {
    ok: true,
    configured: true,
    created: true,
    database: db.database,
    database_id: databaseId,
    data_source_id: db.data_source_id,
    source: "created",
  };
}

export async function ensureNotionDatabase(deps = {}) {
  try {
    const cfg = resolveConfig(deps);
    if (cfg.missing.length) return missingCredentialsResult("ensureNotionDatabase", cfg.missing);

    const cache = await readCache(deps);
    if (cache.database_id) {
      const cached = await retrieveDatabase(cache.database_id, deps);
      if (cached.ok && cached.data_source_id) {
        const nextCache = {
          schema_version: 1,
          database_title: NOTION_DATABASE_TITLE,
          parent_page_id: cfg.parentPageId,
          database_id: cached.database.id,
          data_source_id: cached.data_source_id,
          updated_at: isoNow(deps.now),
        };
        const cacheWrite = await writeCache(nextCache, deps);
        return {
          ok: true,
          configured: true,
          created: false,
          reused: true,
          source: "cache",
          database_id: cached.database.id,
          data_source_id: cached.data_source_id,
          cacheWarning: cacheWrite.ok ? null : cacheWrite.reason,
        };
      }
      if (cached.networkError || cached.authRequired || (cached.status && cached.status !== 404)) {
        return {
          ok: false,
          configured: true,
          created: false,
          reused: false,
          reason: cached.reason || "cached Notion database lookup failed",
          status: cached.status,
          networkError: !!cached.networkError,
          authRequired: !!cached.authRequired,
        };
      }
    }

    const found = await findDatabaseBySearch(deps, cfg.parentPageId);
    if (!found.ok) {
      return {
        ok: false,
        configured: true,
        created: false,
        reused: false,
        reason: found.reason || "Notion database search failed",
        status: found.status,
        networkError: !!found.networkError,
        authRequired: !!found.authRequired,
      };
    }
    if (found.found && found.data_source_id) {
      const cacheWrite = await writeCache({
        schema_version: 1,
        database_title: NOTION_DATABASE_TITLE,
        parent_page_id: cfg.parentPageId,
        database_id: found.database_id,
        data_source_id: found.data_source_id,
        updated_at: isoNow(deps.now),
      }, deps);
      return {
        ok: true,
        configured: true,
        created: false,
        reused: true,
        source: "search",
        database_id: found.database_id,
        data_source_id: found.data_source_id,
        cacheWarning: cacheWrite.ok ? null : cacheWrite.reason,
      };
    }

    const made = await createDatabase(deps, cfg.parentPageId);
    if (!made.ok) {
      return {
        ok: false,
        configured: true,
        created: false,
        reused: false,
        reason: made.reason || "Notion database create failed",
        status: made.status,
        networkError: !!made.networkError,
        authRequired: !!made.authRequired,
      };
    }
    const cacheWrite = await writeCache({
      schema_version: 1,
      database_title: NOTION_DATABASE_TITLE,
      parent_page_id: cfg.parentPageId,
      database_id: made.database_id,
      data_source_id: made.data_source_id,
      updated_at: isoNow(deps.now),
    }, deps);
    return {
      ok: true,
      configured: true,
      created: true,
      reused: false,
      source: "created",
      database_id: made.database_id,
      data_source_id: made.data_source_id,
      cacheWarning: cacheWrite.ok ? null : cacheWrite.reason,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      reason: err && err.message ? err.message : String(err),
      networkError: false,
    };
  }
}

function percentNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function dateProp(value) {
  if (!value) return { date: null };
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return { date: null };
  return { date: { start: new Date(ms).toISOString() } };
}

function weakAreasSummary(topicRecord) {
  const weakAreas = Array.isArray(topicRecord?.weak_areas) ? topicRecord.weak_areas : [];
  if (!weakAreas.length) return "";
  return weakAreas
    .slice(-8)
    .map((w) => {
      const skill = w?.skill ? `${w.skill}: ` : "";
      const sub = w?.sub_topic || w?.subTopic || "unknown";
      const ev = w?.evidence ? ` (${compactText(w.evidence, 120)})` : "";
      return `${skill}${sub}${ev}`;
    })
    .join("; ");
}

function propertiesFromTopic(topicRecord, now = undefined) {
  const mastery = topicRecord?.mastery || {};
  const props = {
    [PROPERTIES.topic]: { title: text(topicRecord?.topic || topicRecord?.id || "Untitled topic") },
    [PROPERTIES.topicId]: { rich_text: text(topicRecord?.id || "") },
    [PROPERTIES.domain]: topicRecord?.domain
      ? { select: { name: String(topicRecord.domain) } }
      : { select: null },
    [PROPERTIES.weakAreas]: { rich_text: text(weakAreasSummary(topicRecord)) },
    [PROPERTIES.nextReview]: dateProp(topicRecord?.reviews?.next_review_at),
    [PROPERTIES.lastUpdated]: dateProp(topicRecord?.provenance?.updated_at || now || isoNow()),
  };
  for (const [field, name] of MASTERY_FIELDS) {
    props[name] = { number: percentNumber(mastery[field]) };
  }
  return props;
}

async function findTopicPage(dataSourceId, topicId, deps) {
  const r = await httpPost(`/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
    page_size: 1,
    filter: {
      property: PROPERTIES.topicId,
      rich_text: { equals: String(topicId || "") },
    },
  }, deps);
  if (!r.ok) return { ...r, page: null };
  const page = Array.isArray(r.body?.results) ? r.body.results[0] || null : null;
  return { ok: true, configured: true, page, status: r.status };
}

export async function syncTopicToNotion(topicRecord, deps = {}) {
  try {
    if (!topicRecord || !topicRecord.id) {
      return { ok: false, configured: true, reason: "topicRecord.id is required" };
    }
    const ensured = await ensureNotionDatabase(deps);
    if (!ensured.ok) return { ...ensured, action: "syncTopicToNotion" };
    const found = await findTopicPage(ensured.data_source_id, topicRecord.id, deps);
    if (!found.ok) {
      return {
        ok: false,
        configured: true,
        action: "syncTopicToNotion",
        reason: found.reason || "Notion topic query failed",
        status: found.status,
        networkError: !!found.networkError,
        authRequired: !!found.authRequired,
      };
    }

    const properties = propertiesFromTopic(topicRecord, deps.now);
    if (found.page?.id) {
      const updated = await httpPatch(`/pages/${encodeURIComponent(found.page.id)}`, { properties }, deps);
      if (!updated.ok) {
        return {
          ok: false,
          configured: true,
          action: "syncTopicToNotion",
          operation: "update",
          reason: updated.reason || "Notion page update failed",
          status: updated.status,
          networkError: !!updated.networkError,
          authRequired: !!updated.authRequired,
        };
      }
      return {
        ok: true,
        configured: true,
        action: "syncTopicToNotion",
        operation: "update",
        page_id: found.page.id,
        database_id: ensured.database_id,
        data_source_id: ensured.data_source_id,
      };
    }

    const created = await httpPost("/pages", {
      parent: { type: "data_source_id", data_source_id: ensured.data_source_id },
      properties,
    }, deps);
    if (!created.ok) {
      return {
        ok: false,
        configured: true,
        action: "syncTopicToNotion",
        operation: "create",
        reason: created.reason || "Notion page create failed",
        status: created.status,
        networkError: !!created.networkError,
        authRequired: !!created.authRequired,
      };
    }
    return {
      ok: true,
      configured: true,
      action: "syncTopicToNotion",
      operation: "create",
      page_id: created.body?.id || null,
      database_id: ensured.database_id,
      data_source_id: ensured.data_source_id,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      action: "syncTopicToNotion",
      reason: err && err.message ? err.message : String(err),
    };
  }
}

function readNumberProp(page, name) {
  const v = page?.properties?.[name]?.number;
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function readTextProp(page, name) {
  const p = page?.properties?.[name];
  if (!p) return "";
  if (Array.isArray(p.title)) return plainText(p.title);
  if (Array.isArray(p.rich_text)) return plainText(p.rich_text);
  if (p.select?.name) return p.select.name;
  if (p.date?.start) return p.date.start;
  return "";
}

function topicRecordFromPage(page, topicId) {
  return {
    id: readTextProp(page, PROPERTIES.topicId) || topicId,
    topic: readTextProp(page, PROPERTIES.topic),
    domain: readTextProp(page, PROPERTIES.domain),
    mastery: {
      understand: readNumberProp(page, PROPERTIES.understand),
      apply: readNumberProp(page, PROPERTIES.apply),
      produce: readNumberProp(page, PROPERTIES.produce),
      oral_reasoning: readNumberProp(page, PROPERTIES.oralReasoning),
      full_matter_sim: readNumberProp(page, PROPERTIES.fullMatterSim),
    },
    weak_areas_summary: readTextProp(page, PROPERTIES.weakAreas),
    reviews: {
      next_review_at: readTextProp(page, PROPERTIES.nextReview) || null,
    },
    notion: {
      page_id: page?.id || null,
      last_updated: readTextProp(page, PROPERTIES.lastUpdated) || null,
    },
  };
}

export async function pullTopicFromNotion(topicId, deps = {}) {
  try {
    if (!topicId) return { ok: false, configured: true, reason: "topicId is required" };
    const ensured = await ensureNotionDatabase(deps);
    if (!ensured.ok) return { ...ensured, action: "pullTopicFromNotion" };
    const found = await findTopicPage(ensured.data_source_id, topicId, deps);
    if (!found.ok) {
      return {
        ok: false,
        configured: true,
        action: "pullTopicFromNotion",
        reason: found.reason || "Notion topic query failed",
        status: found.status,
        networkError: !!found.networkError,
        authRequired: !!found.authRequired,
      };
    }
    if (!found.page) {
      return {
        ok: true,
        configured: true,
        action: "pullTopicFromNotion",
        found: false,
        topic: null,
      };
    }
    return {
      ok: true,
      configured: true,
      action: "pullTopicFromNotion",
      found: true,
      topic: topicRecordFromPage(found.page, topicId),
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      action: "pullTopicFromNotion",
      reason: err && err.message ? err.message : String(err),
    };
  }
}

export async function runOnce(deps = {}) {
  try {
    const cfg = resolveConfig(deps);
    if (cfg.missing.length) {
      return {
        ...missingCredentialsResult("runOnce", cfg.missing),
        synced: 0,
        total: 0,
        results: [],
      };
    }
    const state = await (typeof deps.readLearningState === "function" ? deps.readLearningState(deps) : readLearningState(deps));
    const records = Array.isArray(state.records) ? state.records : [];
    const results = [];
    for (const rec of records) {
      results.push(await syncTopicToNotion(rec, deps));
    }
    return {
      ok: results.every((r) => r.ok),
      configured: true,
      synced: results.filter((r) => r.ok).length,
      total: records.length,
      results,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      synced: 0,
      total: 0,
      reason: err && err.message ? err.message : String(err),
      results: [],
    };
  }
}

function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--once") out.once = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/learning-os-notion-sync.mjs --once");
    process.exitCode = 2;
    return;
  }
  const report = await runOnce();
  if (!report.configured) {
    const reason = report.results.find((r) => r?.configured === false)?.reason || "Notion sync is not configured yet";
    console.log(`learning-os-notion-sync --once: ${reason}`);
    process.exitCode = 0;
    return;
  }
  console.log(`learning-os-notion-sync --once: synced=${report.synced}/${report.total}`);
  for (const r of report.results) {
    if (r.ok) console.log(`topic ${r.page_id || "unknown"} ${r.operation || r.source || "ok"}`);
    else console.log(`topic sync degraded: ${r.reason || "unknown error"}`);
  }
  if (!report.ok) process.exitCode = 1;
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
    console.error("learning-os-notion-sync fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
