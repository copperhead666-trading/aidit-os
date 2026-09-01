// ops-watcher/paperclip-issue-exporter.regression.test.mjs
// Offline regression tests for the Paperclip issue exporter.
// Fully offline: injected fake Paperclip responses, real filesystem writes to a
// temp directory that is cleaned up. No live Paperclip, no gbrain calls.
//
//   node ops-watcher/paperclip-issue-exporter.regression.test.mjs
//
// Covers:
//   (E1) Curated export: identifier, title, status, labels, timestamps present.
//   (E2) Full comment thread is NOT dumped; only the final VERDICT comment is kept.
//   (E3) OWNER_REQUIRED issues are excluded.
//   (E4) SELFTEST/throwaway issues are excluded.
//   (E5) Last VERDICT comment wins when multiple verdict comments exist.
//   (E6) No-verdict issues fall back to status/label terminal state.
//   (E7) Network errors are reported, not thrown.
//   (E8) Output directory is created automatically.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { runExportOnce } from "./paperclip-issue-exporter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, "fixtures", "_export-test-tmp");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  console.log(`PASS: ${name}`);
  passed++;
}
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name);
  failed++;
}

async function resetTmp() {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
}

function makeIssue(opts = {}) {
  return {
    id: opts.id || `issue-${Math.random().toString(36).slice(2, 10)}`,
    identifier: opts.identifier || "KOL-X",
    title: opts.title || "test issue",
    description: opts.description || "",
    status: opts.status || "todo",
    labels: opts.labels || [],
    labelIds: opts.labelIds || [],
    createdAt: opts.createdAt || "2026-08-01T00:00:00.000Z",
    updatedAt: opts.updatedAt || "2026-08-02T00:00:00.000Z",
  };
}

function makeComment(body, opts = {}) {
  return {
    id: opts.id || `c-${Math.random().toString(36).slice(2, 10)}`,
    body,
    authorType: opts.authorType || "user",
    authorAgentId: opts.authorAgentId || null,
    createdAt: opts.createdAt || "2026-08-01T12:00:00.000Z",
  };
}

function makeDeps(issues, commentsByIssue = {}) {
  return {
    base: "http://mock-paperclip",
    companyId: "mock-company",
    outDir: TMP_DIR,
    listIssues: async () => ({ issues, networkError: false }),
    httpGet: async (url) => {
      const m = url.match(/\/api\/issues\/([^/]+)\/comments$/);
      if (m) {
        const id = m[1];
        return { body: commentsByIssue[id] || [], networkError: false };
      }
      return { body: null, networkError: false };
    },
    log: () => {},
    now: () => 1700000000000,
    _fs: fs,
  };
}

async function readExportedFile(identifier) {
  const filePath = path.join(TMP_DIR, `${identifier}.md`);
  return fs.readFile(filePath, "utf8");
}

async function fileExists(identifier) {
  try {
    await fs.access(path.join(TMP_DIR, `${identifier}.md`));
    return true;
  } catch {
    return false;
  }
}

// =====================================================================
// E1 + E2: curated export of a real issue (verdict present, no raw thread)
// =====================================================================
async function testCuratedExportWithVerdict() {
  const name = "E1/E2 curated export keeps verdict only, no raw comment thread";
  await resetTmp();
  const issue = makeIssue({
    id: "i-real",
    identifier: "KOL-37",
    title: "Fix routing fallback",
    description: "When the provider returns 403, routing.mjs should fall back to k3.\n\nExtra paragraph that should be truncated in the excerpt.",
    status: "done",
    labels: [{ name: "DONE_VERIFIED" }, { name: "DIRECTIVE" }],
  });
  const comments = {
    "i-real": [
      makeComment("Some discussion here that should not appear in the export.", { id: "c1", createdAt: "2026-08-01T10:00:00.000Z" }),
      makeComment("VERDICT: PASS (routing fallback now works, verified live).", { id: "c2", createdAt: "2026-08-01T14:00:00.000Z" }),
    ],
  };
  try {
    const r = await runExportOnce(makeDeps([issue], comments));
    assert.equal(r.exported, 1, "expected 1 export");
    assert.equal(r.excluded, 0);

    const md = await readExportedFile("KOL-37");
    assert.match(md, /issue_identifier: KOL-37/);
    assert.match(md, /issue_status: done/);
    assert.match(md, /DONE_VERIFIED/);
    assert.match(md, /DIRECTIVE/);
    assert.match(md, /## Description excerpt/);
    assert.match(md, /When the provider returns 403/);
    assert.match(md, /## Final verdict \/ outcome/);
    assert.match(md, /VERDICT: PASS/);
    assert.match(md, /Created: 2026-08-01T00:00:00.000Z/);
    assert.match(md, /Updated: 2026-08-02T00:00:00.000Z/);

    // Full comment thread must NOT be present.
    assert.ok(!md.includes("Some discussion here"), "raw discussion comment must be excluded");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// E3: OWNER_REQUIRED issues are excluded
// =====================================================================
async function testExcludesOwnerRequired() {
  const name = "E3 OWNER_REQUIRED issues are excluded";
  await resetTmp();
  const issue = makeIssue({
    id: "i-owner",
    identifier: "KOL-OWN",
    title: "Owner decision needed",
    status: "blocked",
    labels: [{ name: "OWNER_REQUIRED" }],
  });
  try {
    const r = await runExportOnce(makeDeps([issue], {}));
    assert.equal(r.exported, 0);
    assert.equal(r.excluded, 1);
    assert.equal(await fileExists("KOL-OWN"), false);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// E4: SELFTEST throwaway issues are excluded
// =====================================================================
async function testExcludesSelftest() {
  const name = "E4 SELFTEST throwaway issues are excluded";
  await resetTmp();
  const issue = makeIssue({
    id: "i-selftest",
    identifier: "KOL-9",
    title: "SELFTEST probe for comment dedupe",
    status: "cancelled",
    labels: [],
  });
  try {
    const r = await runExportOnce(makeDeps([issue], {}));
    assert.equal(r.exported, 0);
    assert.equal(r.excluded, 1);
    assert.equal(await fileExists("KOL-9"), false);
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// E5: last VERDICT comment wins
// =====================================================================
async function testLastVerdictWins() {
  const name = "E5 last VERDICT comment wins";
  await resetTmp();
  const issue = makeIssue({ id: "i-multi", identifier: "KOL-MULTI", title: "Multi-verdict" });
  const comments = {
    "i-multi": [
      makeComment("VERDICT: REJECT (initial review).", { id: "v1", createdAt: "2026-08-01T10:00:00.000Z" }),
      makeComment("Follow-up work was done.", { id: "v2", createdAt: "2026-08-02T10:00:00.000Z" }),
      makeComment("VERDICT: PASS (re-reviewed and accepted).", { id: "v3", createdAt: "2026-08-03T10:00:00.000Z" }),
    ],
  };
  try {
    await runExportOnce(makeDeps([issue], comments));
    const md = await readExportedFile("KOL-MULTI");
    assert.ok(md.includes("VERDICT: PASS (re-reviewed and accepted)"), "latest PASS verdict must be kept");
    assert.ok(!md.includes("VERDICT: REJECT"), "older REJECT verdict must not appear");
    assert.ok(!md.includes("Follow-up work"), "non-verdict comment must not appear");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// E6: no-verdict issue records terminal state
// =====================================================================
async function testNoVerdictFallback() {
  const name = "E6 no-verdict issue records terminal state";
  await resetTmp();
  const issue = makeIssue({
    id: "i-noverdict",
    identifier: "KOL-NV",
    title: "In-progress task",
    status: "in_progress",
    labels: [{ name: "DIRECTIVE" }],
  });
  const comments = {
    "i-noverdict": [
      makeComment("Just a status update.", { id: "u1" }),
    ],
  };
  try {
    await runExportOnce(makeDeps([issue], comments));
    const md = await readExportedFile("KOL-NV");
    assert.ok(md.includes("No VERDICT comment."), "must note absence of verdict");
    assert.ok(md.includes("status=in_progress"), "must include terminal status");
    assert.ok(!md.includes("Just a status update"), "non-verdict comment must not appear");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// E7: network error does not crash
// =====================================================================
async function testNetworkErrorNoCrash() {
  const name = "E7 network error reports error, does not crash";
  await resetTmp();
  const deps = {
    ...makeDeps([makeIssue({ id: "i-net", identifier: "KOL-NET" })]),
    listIssues: async () => ({ issues: [], networkError: true, networkErrorMessage: "ECONNREFUSED" }),
  };
  try {
    const r = await runExportOnce(deps);
    assert.equal(r.exported, 0);
    assert.ok(r.errors.some((e) => /ECONNREFUSED/.test(e)), "error must mention ECONNREFUSED");
    ok(name);
  } catch (err) { bad(name, err); }
}

// =====================================================================
// E8: output directory is created automatically
// =====================================================================
async function testOutputDirectoryCreated() {
  const name = "E8 output directory is created automatically";
  await resetTmp();
  const nestedDir = path.join(TMP_DIR, "nested", "dir");
  const issue = makeIssue({ id: "i-dir", identifier: "KOL-DIR", title: "Dir test" });
  const deps = { ...makeDeps([issue]), outDir: nestedDir };
  try {
    await runExportOnce(deps);
    const stat = await fs.stat(nestedDir);
    assert.ok(stat.isDirectory(), "nested output directory must exist");
    const md = await fs.readFile(path.join(nestedDir, "KOL-DIR.md"), "utf8");
    assert.ok(md.includes("KOL-DIR"));
    ok(name);
  } catch (err) { bad(name, err); }
}

async function main() {
  console.log("# ops-watcher paperclip-issue-exporter regression tests");
  await testCuratedExportWithVerdict();
  await testExcludesOwnerRequired();
  await testExcludesSelftest();
  await testLastVerdictWins();
  await testNoVerdictFallback();
  await testNetworkErrorNoCrash();
  await testOutputDirectoryCreated();
  await resetTmp();
  console.log("");
  console.log(`REGRESSION RESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("paperclip-issue-exporter regression runner crashed:", err);
  process.exit(1);
});
