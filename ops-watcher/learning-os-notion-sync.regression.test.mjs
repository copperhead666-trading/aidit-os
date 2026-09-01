// ops-watcher/learning-os-notion-sync.regression.test.mjs
// Offline regression tests for Learning OS -> Notion sync.
// Uses dependency-injected fetch fixtures only; never calls the real Notion API.
//
//   node ops-watcher/learning-os-notion-sync.regression.test.mjs

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTION_API_VERSION,
  NOTION_DATABASE_TITLE,
  PROPERTIES,
  ensureNotionDatabase,
  pullTopicFromNotion,
  syncTopicToNotion,
  runOnce,
} from "./learning-os-notion-sync.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_CACHE = path.join(__dirname, "learning-os-notion-sync.regression.state.tmp.json");

let pass = 0;
const ok = (label) => { pass += 1; console.log(`OK  ${label}`); };
const cleanup = () => fs.unlink(TMP_CACHE).catch(() => {});

function response(status, body) {
  return {
    status,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "application/json" : "" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function env(overrides = {}) {
  return {
    NOTION_TOKEN: "secret_test",
    NOTION_PARENT_PAGE_ID: "parent-page",
    ...overrides,
  };
}

function deps(fetch, overrides = {}) {
  return {
    env: env(overrides.env),
    fetch,
    notionStateFile: TMP_CACHE,
    timeoutMs: overrides.timeoutMs || 50,
    now: "2026-08-30T00:00:00.000Z",
  };
}

function routeFetch(routes, calls = []) {
  return async (url, opts = {}) => {
    calls.push({
      url,
      method: opts.method,
      headers: opts.headers,
      body: opts.body ? JSON.parse(opts.body) : null,
    });
    assert.equal(opts.headers["notion-version"], NOTION_API_VERSION);
    assert.equal(opts.headers.authorization, "Bearer secret_test");
    const pathName = new URL(url).pathname;
    const key = `${opts.method} ${pathName}`;
    const handler = routes[key];
    if (!handler) return response(404, { object: "error", message: `unmocked ${key}` });
    return typeof handler === "function" ? handler(url, opts, calls) : handler;
  };
}

function database(id = "db-1", dataSourceId = "ds-1") {
  return {
    object: "database",
    id,
    parent: { type: "page_id", page_id: "parent-page" },
    title: [{ plain_text: NOTION_DATABASE_TITLE }],
    data_sources: [{ id: dataSourceId, name: "Learning OS Topics data source" }],
  };
}


function dataSource(id = "ds-1", databaseId = "db-1") {
  return {
    object: "data_source",
    id,
    parent: { type: "database_id", database_id: databaseId },
    database_parent: { type: "page_id", page_id: "parent-page" },
    title: [{ plain_text: NOTION_DATABASE_TITLE }],
    properties: {},
  };
}
function topic(overrides = {}) {
  return {
    id: "civillaw.perikatan.obligations",
    topic: "Perikatan / Obligations",
    domain: "civil_law",
    mastery: {
      understand: 0.25,
      apply: 0.5,
      produce: 0.75,
      oral_reasoning: 0.1,
      full_matter_sim: 0,
    },
    weak_areas: [{ skill: "apply", sub_topic: "sources_of_obligation", evidence: "fixture evidence" }],
    reviews: { next_review_at: "2026-09-01T00:00:00.000Z" },
    provenance: { updated_at: "2026-08-30T00:00:00.000Z" },
    ...overrides,
  };
}

function page(id = "page-1") {
  const rec = topic();
  return {
    object: "page",
    id,
    properties: {
      [PROPERTIES.topic]: { title: [{ plain_text: rec.topic }] },
      [PROPERTIES.topicId]: { rich_text: [{ plain_text: rec.id }] },
      [PROPERTIES.domain]: { select: { name: rec.domain } },
      [PROPERTIES.understand]: { number: rec.mastery.understand },
      [PROPERTIES.apply]: { number: rec.mastery.apply },
      [PROPERTIES.produce]: { number: rec.mastery.produce },
      [PROPERTIES.oralReasoning]: { number: rec.mastery.oral_reasoning },
      [PROPERTIES.fullMatterSim]: { number: rec.mastery.full_matter_sim },
      [PROPERTIES.weakAreas]: { rich_text: [{ plain_text: "apply: sources_of_obligation" }] },
      [PROPERTIES.nextReview]: { date: { start: rec.reviews.next_review_at } },
      [PROPERTIES.lastUpdated]: { date: { start: rec.provenance.updated_at } },
    },
  };
}

async function t1_databaseCreationWhenNoneExists() {
  await cleanup();
  const calls = [];
  const fetch = routeFetch({
    "POST /v1/search": response(200, { object: "list", results: [] }),
    "POST /v1/databases": response(200, { object: "database", id: "db-created" }),
    "GET /v1/databases/db-created": response(200, database("db-created", "ds-created")),
  }, calls);
  const r = await ensureNotionDatabase(deps(fetch));
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.data_source_id, "ds-created");
  const createCall = calls.find((c) => c.method === "POST" && c.url.endsWith("/databases"));
  assert.equal(createCall.body.parent.page_id, "parent-page");
  assert.equal(createCall.body.initial_data_source.title[0].text.content, NOTION_DATABASE_TITLE);
  assert.deepEqual(Object.keys(createCall.body.initial_data_source.properties), Object.values(PROPERTIES));
  const cache = JSON.parse(await fs.readFile(TMP_CACHE, "utf8"));
  assert.equal(cache.database_id, "db-created");
  assert.equal(cache.data_source_id, "ds-created");
  ok("T1: ensureNotionDatabase creates the database and discovers data_source_id via retrieve database");
}

async function t2_databaseReuseWhenAlreadyExists() {
  await cleanup();
  const calls = [];
  const fetch = routeFetch({
    "POST /v1/search": response(200, { object: "list", results: [dataSource("ds-existing", "db-existing")] }),
    "GET /v1/databases/db-existing": response(200, database("db-existing", "ds-existing")),
  }, calls);
  const r = await ensureNotionDatabase(deps(fetch));
  assert.equal(r.ok, true);
  assert.equal(r.reused, true);
  assert.equal(r.source, "search");
  assert.equal(r.database_id, "db-existing");
  assert.equal(r.data_source_id, "ds-existing");
  assert.equal(calls.some((c) => c.method === "POST" && c.url.endsWith("/databases")), false);
  ok("T2: ensureNotionDatabase reuses an existing Notion database by title under the parent page");
}

async function t3_upsertUpdatePath() {
  await cleanup();
  await fs.writeFile(TMP_CACHE, JSON.stringify({ database_id: "db-1" }), "utf8");
  const calls = [];
  const fetch = routeFetch({
    "GET /v1/databases/db-1": response(200, database("db-1", "ds-1")),
    "POST /v1/data_sources/ds-1/query": response(200, { object: "list", results: [page("page-existing")] }),
    "PATCH /v1/pages/page-existing": response(200, page("page-existing")),
  }, calls);
  const r = await syncTopicToNotion(topic(), deps(fetch));
  assert.equal(r.ok, true);
  assert.equal(r.operation, "update");
  const patch = calls.find((c) => c.method === "PATCH");
  assert.equal(patch.body.properties[PROPERTIES.topicId].rich_text[0].text.content, "civillaw.perikatan.obligations");
  assert.equal(patch.body.properties[PROPERTIES.apply].number, 0.5);
  ok("T3: syncTopicToNotion updates an existing Notion row found by Topic ID");
}

async function t4_upsertCreatePathAndPullReadPath() {
  await cleanup();
  await fs.writeFile(TMP_CACHE, JSON.stringify({ database_id: "db-1" }), "utf8");
  const calls = [];
  let queryCount = 0;
  const fetch = routeFetch({
    "GET /v1/databases/db-1": response(200, database("db-1", "ds-1")),
    "POST /v1/data_sources/ds-1/query": () => {
      queryCount += 1;
      return queryCount === 1
        ? response(200, { object: "list", results: [] })
        : response(200, { object: "list", results: [page("page-created")] });
    },
    "POST /v1/pages": response(200, { object: "page", id: "page-created" }),
  }, calls);
  const synced = await syncTopicToNotion(topic(), deps(fetch));
  assert.equal(synced.ok, true);
  assert.equal(synced.operation, "create");
  const created = calls.find((c) => c.method === "POST" && c.url.endsWith("/pages"));
  assert.equal(created.body.parent.type, "data_source_id");
  assert.equal(created.body.parent.data_source_id, "ds-1");

  const pulled = await pullTopicFromNotion("civillaw.perikatan.obligations", deps(fetch));
  assert.equal(pulled.ok, true);
  assert.equal(pulled.found, true);
  assert.equal(pulled.topic.mastery.produce, 0.75);
  ok("T4: syncTopicToNotion creates missing rows and pullTopicFromNotion reads OWNER-editable fields back");
}

async function t5_notionApiTimeoutGracefulNoCrash() {
  await cleanup();
  const fetch = async () => new Promise(() => {});
  const r = await ensureNotionDatabase(deps(fetch, { timeoutMs: 5 }));
  assert.equal(r.ok, false);
  assert.equal(r.configured, true);
  assert.equal(r.networkError, true);
  assert.match(r.reason, /timed out/);
  ok("T5: Notion API timeout degrades cleanly without throwing");
}

async function t6_missingCredentialsClearReportedState() {
  await cleanup();
  let called = false;
  const fetch = async () => { called = true; return response(200, {}); };
  const r = await ensureNotionDatabase(deps(fetch, { env: { NOTION_TOKEN: "", NOTION_PARENT_PAGE_ID: "" } }));
  assert.equal(r.ok, false);
  assert.equal(r.configured, false);
  assert.deepEqual(r.missing, ["NOTION_TOKEN", "NOTION_PARENT_PAGE_ID"]);
  assert.match(r.reason, /NOTION_TOKEN and NOTION_PARENT_PAGE_ID not set/);
  assert.equal(called, false);
  ok("T6: missing credentials are reported clearly and do not call Notion");
}

async function t7_runOnceZeroRecordsMissingCredentialsReportsConfiguredFalse() {
  await cleanup();
  const fetch = async () => ({ status: 200, headers: { get: () => "" }, json: async () => ({}), text: async () => "" });
  const d = deps(fetch, { env: { NOTION_TOKEN: "", NOTION_PARENT_PAGE_ID: "" } });
  d.readLearningState = async () => ({ records: [] });
  const r = await runOnce(d);
  assert.equal(r.ok, false);
  assert.equal(r.configured, false);
  assert.deepEqual(r.missing, ["NOTION_TOKEN", "NOTION_PARENT_PAGE_ID"]);
  assert.equal(r.synced, 0);
  assert.equal(r.total, 0);
  ok("T7: runOnce with zero records and missing credentials reports configured:false");
}

async function t8_runOnceZeroRecordsPresentCredentialsIsOkNoOp() {
  await cleanup();
  const fetch = async () => ({ status: 200, headers: { get: () => "" }, json: async () => ({}), text: async () => "" });
  const d = deps(fetch);
  d.readLearningState = async () => ({ records: [] });
  const r = await runOnce(d);
  assert.equal(r.ok, true);
  assert.equal(r.configured, true);
  assert.equal(r.synced, 0);
  assert.equal(r.total, 0);
  ok("T8: runOnce with zero records and present credentials is ok:true no-op");
}

async function main() {
  const tests = [
    t1_databaseCreationWhenNoneExists,
    t2_databaseReuseWhenAlreadyExists,
    t3_upsertUpdatePath,
    t4_upsertCreatePathAndPullReadPath,
    t5_notionApiTimeoutGracefulNoCrash,
    t6_missingCredentialsClearReportedState,
    t7_runOnceZeroRecordsMissingCredentialsReportsConfiguredFalse,
    t8_runOnceZeroRecordsPresentCredentialsIsOkNoOp,
  ];
  try {
    for (const t of tests) await t();
    console.log(`\nlearning-os-notion-sync.regression.test.mjs: ${pass}/${tests.length} passed`);
    if (pass !== tests.length) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async (err) => {
  await cleanup();
  console.error("learning-os-notion-sync regression runner crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
