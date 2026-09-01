// ops-watcher/paperclip-issue-exporter.mjs
// P2 COGNITIVE CORE — PHASE 2 STEP 4: read-only Paperclip issue exporter.
//
// Produces CURATED markdown summaries of issues from the live canonical
// Paperclip company, suitable for later GBrain ingestion. This script does NOT
// call any gbrain command; its job ends at writing markdown files to disk.
//
// Curation rules (matching knowledge/COGNITIVE-CORE-V1-PHASE1-DESIGN.md):
//   - One markdown file per issue under knowledge/paperclip-issues/.
//   - Each file contains: identifier, title, status, labels, a ONE-LINE
//     description excerpt, the FINAL verdict/outcome only, and timestamps.
//   - The full comment thread is NOT dumped. Only the last VERDICT: comment is
//     kept; if none exists, the terminal status/labels are recorded.
//   - OWNER_REQUIRED issues are explicitly excluded (awaiting owner decision).
//   - Throwaway/selftest issues (title matches SELFTEST) are excluded.
//   - Cancelled demo probes/seeds (title matches PROBE/SEED) are excluded.
//
//   node ops-watcher/paperclip-issue-exporter.mjs --once
//
// Dependency-injected core: runExportOnce({ base, companyId, outDir,
//   listIssues, httpGet, log, now, _fs }). Not wired into heartbeat.mjs.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverPaperclipPort,
  httpGet as defaultHttpGet,
  listIssues as defaultListIssues,
  CANONICAL_COMPANY_ID,
} from "./paperclip-write-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "knowledge", "paperclip-issues");
const EXPORT_VERSION = 1;

const EXCLUDED_BY_TITLE_RE = /SELFTEST/i;
const EXCLUDED_CANCELLED_RE = /PROBE|SEED|DEMO/i;

function iso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

// One-line excerpt: collapse whitespace and cap to a readable length.
// Matches the heartbeat.mjs excerpt() convention.
function excerpt(text, max = 200) {
  const oneLine = String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max) + " …[truncated]";
}

// Longer-field cap with a byte count. Matches the ahmad-mcp-server.mjs cap().
function cap(text, max = 1000) {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max) + `\n...[truncated ${s.length - max} bytes]` : s;
}

function deriveLabelNames(it) {
  const labels = it?.labels || [];
  return labels
    .map((l) => (typeof l === "string" ? l : l && l.name ? l.name : ""))
    .filter(Boolean);
}

function hasLabel(it, name) {
  const want = String(name).toUpperCase();
  return deriveLabelNames(it).some((n) => String(n).toUpperCase() === want);
}

function isExcluded(it) {
  const title = String(it.title || "");
  const status = String(it.status || "").toLowerCase();

  // Owner-blocker: nothing durable to summarize yet.
  if (hasLabel(it, "OWNER_REQUIRED")) return { excluded: true, reason: "OWNER_REQUIRED" };

  // Throwaway selftest probes (AHMAD's KOL-2/KOL-9 finding).
  if (EXCLUDED_BY_TITLE_RE.test(title)) return { excluded: true, reason: "SELFTEST title" };

  // Cancelled demo/seed noise.
  if (status === "cancelled" && EXCLUDED_CANCELLED_RE.test(title)) {
    return { excluded: true, reason: "cancelled demo/seed" };
  }

  return { excluded: false, reason: null };
}

function findFinalVerdict(comments) {
  const verdicts = (comments || [])
    .filter((c) => /VERDICT\s*:/i.test(String(c.body || "")))
    .sort((a, b) => {
      const ta = String(b.createdAt || b.created_at || "");
      const tb = String(a.createdAt || a.created_at || "");
      return ta.localeCompare(tb); // newest first
    });
  return verdicts[0] ? verdicts[0].body : null;
}

function sanitizeFilename(identifier) {
  const base = String(identifier || "unknown").trim();
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function buildIssueMarkdown(it, comments, nowMs) {
  const ident = it.identifier || it.id;
  const title = String(it.title || "");
  const status = String(it.status || "");
  const labelNames = deriveLabelNames(it);
  const descriptionExcerpt = excerpt(it.description);
  const finalVerdict = findFinalVerdict(comments);
  const verdictOrOutcome = finalVerdict
    ? cap(finalVerdict)
    : `No VERDICT comment. Current state: status=${status}, labels=${labelNames.join(", ") || "(none)"}.`;
  const createdAt = it.createdAt || it.created_at || null;
  const updatedAt = it.updatedAt || it.updated_at || null;

  const tags = ["paperclip", ident, ...labelNames];

  return [
    "---",
    `type: note`,
    `title: "${ident}: ${title.replace(/"/g, '\\"')}"`,
    `tags: ${JSON.stringify(tags)}`,
    `source_system: paperclip`,
    `issue_id: ${it.id}`,
    `issue_identifier: ${ident}`,
    `issue_status: ${status}`,
    `issue_labels: ${JSON.stringify(labelNames)}`,
    `exporter_version: ${EXPORT_VERSION}`,
    `generated_at: ${iso(nowMs)}`,
    "---",
    "",
    `# ${ident}: ${title}`,
    "",
    `- **Status:** ${status}`,
    `- **Labels:** ${labelNames.join(", ") || "(none)"}`,
    "",
    `## Description excerpt`,
    "",
    descriptionExcerpt || "(no description)",
    "",
    `## Final verdict / outcome`,
    "",
    verdictOrOutcome,
    "",
    `## Timestamps`,
    "",
    `- Created: ${createdAt || "unknown"}`,
    `- Updated: ${updatedAt || "unknown"}`,
    "",
  ].join("\n");
}

export async function runExportOnce(deps = {}) {
  const {
    base,
    companyId = CANONICAL_COMPANY_ID,
    outDir = DEFAULT_OUT_DIR,
    listIssues = defaultListIssues,
    httpGet = defaultHttpGet,
    log = (m) => console.log(m),
    now = Date.now,
    _fs = fs,
  } = deps;

  const summary = {
    exported: 0,
    excluded: 0,
    errors: [],
    files: [],
    outDir,
  };

  if (!base) {
    log("paperclip-issue-exporter: no Paperclip base resolved (instance not running)");
    summary.errors.push("no Paperclip base resolved");
    return summary;
  }

  const listRes = await listIssues(base, companyId);
  if (listRes.networkError) {
    const msg = `issues list network error: ${listRes.networkErrorMessage}`;
    log(`paperclip-issue-exporter: ${msg}`);
    summary.errors.push(msg);
    return summary;
  }
  if (listRes.authRequired) {
    const msg = "issues list auth required";
    log(`paperclip-issue-exporter: ${msg}`);
    summary.errors.push(msg);
    return summary;
  }

  const issues = Array.isArray(listRes.issues) ? listRes.issues : [];
  log(`paperclip-issue-exporter: ${issues.length} issue(s) listed`);

  await _fs.mkdir(outDir, { recursive: true });

  for (const it of issues) {
    const ident = it.identifier || it.id;
    const exclusion = isExcluded(it);
    if (exclusion.excluded) {
      log(`paperclip-issue-exporter: ${ident} excluded (${exclusion.reason})`);
      summary.excluded += 1;
      continue;
    }

    let comments = [];
    const commentsUrl = `${base}/api/issues/${it.id}/comments`;
    const commentsRes = await httpGet(commentsUrl);
    if (commentsRes.networkError) {
      log(`paperclip-issue-exporter: ${ident} comments fetch network error (${commentsRes.networkErrorMessage})`);
      summary.errors.push(`${ident}: comments network error`);
    } else if (Array.isArray(commentsRes.body)) {
      comments = commentsRes.body;
    }

    const md = buildIssueMarkdown(it, comments, now());
    const fileName = `${sanitizeFilename(ident)}.md`;
    const filePath = path.join(outDir, fileName);
    try {
      await _fs.writeFile(filePath, md, "utf8");
      summary.exported += 1;
      summary.files.push(path.relative(REPO_ROOT, filePath));
      log(`paperclip-issue-exporter: wrote ${path.relative(REPO_ROOT, filePath)}`);
    } catch (err) {
      const msg = `${ident}: failed to write ${fileName}: ${err && err.message}`;
      log(`paperclip-issue-exporter: ${msg}`);
      summary.errors.push(msg);
    }
  }

  return summary;
}

function parseArgs(argv) {
  const out = { once: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--once") out.once = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.once) {
    console.error("usage: node ops-watcher/paperclip-issue-exporter.mjs --once");
    process.exit(2);
  }
  const port = await discoverPaperclipPort();
  const base = port ? `http://127.0.0.1:${port}` : null;
  const summary = await runExportOnce({ base, log: (m) => console.log(m) });
  console.log(
    `paperclip-issue-exporter --once: exported=${summary.exported} excluded=${summary.excluded} errors=${summary.errors.length}`,
  );
  for (const f of summary.files) console.log(`  wrote ${f}`);
  for (const e of summary.errors) console.log(`  error: ${e}`);
  process.exit(summary.errors.length > 0 ? 1 : 0);
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
    console.error("paperclip-issue-exporter fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
