// ops-watcher/verify-file.mjs
// Reusable local verifier for directive plans that only need to prove file
// content. This duplicates validatePlanScope's path deny-list because importing
// directive-runner.mjs would pull in operational dependencies and side effects
// that this tiny verifier should not need.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const HARD_DENY = new Set([
  "ops-watcher/heartbeat.mjs",
  "ops-watcher/telegram-listener.mjs",
  "ops-watcher/telegram-notify.mjs",
  "ops-watcher/ahmad-dispatch.mjs",
  "ops-watcher/ahmad-escalate.mjs",
  "ops-watcher/steward.mjs",
  "ops-watcher/directive-runner.mjs",
]);

function normalizeRepoPath(raw) {
  const p = String(raw || "").trim();
  const norm = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\.\/+/, "");
  const low = norm.toLowerCase();
  const parts = norm.split("/").filter(Boolean);
  if (!p) return { ok: false, reason: "path is empty" };
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\")) return { ok: false, reason: "absolute path refused" };
  if (parts.includes("..") || low.startsWith("../")) return { ok: false, reason: "path escapes repository" };
  if (["ventures", ".git", ".paperclip", "node_modules", "graphify-out"].some((x) => low === x || low.startsWith(`${x}/`))) {
    return { ok: false, reason: "denied directory refused" };
  }
  if (parts.some((seg) => /^\.env/i.test(seg))) return { ok: false, reason: "env file refused" };
  if (HARD_DENY.has(low)) return { ok: false, reason: "hard-deny operational file refused" };
  return { ok: true, path: norm };
}

export function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const out = { path: null, matches: null, contains: null };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--path") out.path = args[++i];
    else if (key === "--matches") out.matches = args[++i];
    else if (key === "--contains") out.contains = args[++i];
    else return { ok: false, reason: `unknown argument ${key}` };
  }
  if (!out.path) return { ok: false, reason: "missing --path" };
  const hasMatches = out.matches != null;
  const hasContains = out.contains != null;
  if (hasMatches === hasContains) return { ok: false, reason: "provide exactly one of --matches or --contains" };
  return { ok: true, ...out };
}

export async function verifyFile(options, deps = {}) {
  const parsed = options && options.ok === true ? options : { ok: true, ...options };
  if (!parsed.ok) return { ok: false, reason: parsed.reason || "invalid arguments" };
  const checked = normalizeRepoPath(parsed.path);
  if (!checked.ok) return { ok: false, reason: checked.reason };

  const root = deps.repoRoot || REPO_ROOT;
  const readFile = deps.readFile || fs.readFile;
  const fullPath = path.resolve(root, checked.path);
  const relCheck = path.relative(root, fullPath);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) return { ok: false, reason: "path escapes repository" };

  let text;
  try {
    text = await readFile(fullPath, "utf8");
  } catch (err) {
    const code = err && err.code ? ` (${err.code})` : "";
    return { ok: false, reason: `missing or unreadable file ${checked.path}${code}` };
  }

  const bytes = Buffer.byteLength(String(text), "utf8");
  if (parsed.contains != null) {
    if (String(text).includes(String(parsed.contains))) return { ok: true, path: checked.path, bytes };
    return { ok: false, reason: `substring not found in ${checked.path}` };
  }

  let re;
  try {
    re = new RegExp(String(parsed.matches));
  } catch (err) {
    return { ok: false, reason: `invalid regex: ${String((err && err.message) || err)}` };
  }
  if (re.test(String(text))) return { ok: true, path: checked.path, bytes };
  return { ok: false, reason: `regex did not match ${checked.path}` };
}

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    const result = await verifyFile(parsed);
    if (result.ok) {
      console.log(`VERIFY OK ${result.path} (${result.bytes} bytes)`);
      process.exit(0);
    }
    console.error(`VERIFY FAILED ${result.reason || "unknown reason"}`);
    process.exit(1);
  } catch (err) {
    console.error(`VERIFY FAILED ${String((err && err.message) || err)}`);
    process.exit(1);
  }
}

const isEntry = (() => {
  try { return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isEntry) main();