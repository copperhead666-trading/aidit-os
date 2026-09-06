// ops-watcher/windows-hide.mjs
// The owner's standing rule, as code: nothing Aidit OS runs may put a window on
// his screen.
//
// === WHY A SCANNER AND NOT A REVIEW ===
// The rule was already written down, and it was still broken. On 2026-09-05
// lane-worktree.mjs:59 ran `execFileSync("git", args, { cwd, encoding,
// maxBuffer })` on EVERY lane dispatch with no windowsHide, and the owner saw
// terminal flashes on the Lenovo. The file that contained it was not careless —
// it simply had one call site nobody re-read.
//
// That is the point of auditing CALL SITES rather than files: a file that sets
// windowsHide in one function proves nothing about the call three functions
// down. The unit of the rule is the call, so the unit of the check is the call.
//
// This module finds the call sites. windows-hide.regression.test.mjs fails on
// any that omits windowsHide, so a NEW omission fails the suite instead of
// decaying quietly the way the argv lesson did.

import { promises as fsp } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// The child_process entry points. Any of these, under any local alias, starts a
// process — and on Windows a process started without windowsHide can flash a
// console window.
export const SPAWN_FUNCTIONS = Object.freeze([
  "spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork",
]);

// Directories that are ours to fix. node_modules, .paperclip session logs and
// sibling worktrees are not first-party source.
export const SCAN_DIRS = Object.freeze(["ops-watcher", "scripts", "hatta", "cockpit", "agents", ".claude"]);
const SCAN_EXTENSIONS = Object.freeze([".mjs", ".cjs", ".js"]);
export const PM2_ECOSYSTEM_RELATIVE = "ops-watcher/ecosystem.config.cjs";
const SKIP_DIR_NAMES = new Set([
  "node_modules", ".git", ".paperclip", "worktrees", "graphify-out", "e2e-soak",
  // Build output is generated, not written here. Auditing it would report
  // minified module loaders (`a(9510)`) as spawn calls forever.
  ".next", "dist", "build", "out", "coverage",
]);

// Call sites that may omit windowsHide, each with a reason. A bare path is not
// enough: "it was like that already" is how a rule stops being a rule.
// Key: "<repo-relative path>:<line-independent callee>" — line numbers move.
export const ALLOWED_WITHOUT_WINDOWS_HIDE = Object.freeze({});

// ---- source scanning -------------------------------------------------------

// Blank out comments and string/template contents, preserving every offset and
// newline, so a `spawn(` inside a comment or a log message is not a call site
// and a `)` inside a string does not close an argument list.
export function blankNonCode(src) {
  const out = Array.from(String(src));
  const n = out.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  while (i < n) {
    const ch = out[i], next = out[i + 1];
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < n && out[j] !== "\n") j++;
      blank(i, j); i = j; continue;
    }
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(out[j] === "*" && out[j + 1] === "/")) j++;
      blank(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (out[j] === "\\") { j += 2; continue; }
        if (out[j] === quote) break;
        j++;
      }
      blank(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join("");
}

// Local names that reach a child_process spawner: the imports themselves, any
// `as` alias, and the injection seams this repo uses
// (`const _exec = deps._exec || execFileSync`, `{ _exec = execFileSync } = {}`).
export function spawnAliases(code) {
  const names = new Set(SPAWN_FUNCTIONS);
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'`]?node:child_process/g)) {
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.split(/\s+as\s+/).map((s) => s.trim());
      if (SPAWN_FUNCTIONS.includes(orig)) names.add(alias || orig);
    }
  }
  // Any binding that HOLDS a spawner rather than its result:
  //   const _exec = deps._exec || execFileSync;      alias
  //   const execFileAsync = promisify(execFile);     alias
  //   const out = execFileSync("git", ...);          NOT an alias (a result)
  // The spawner must therefore appear without a "(" right after it, and must
  // not be a property read (`re.exec(x)` is RegExp.exec, not child_process).
  let grew = true;
  while (grew) {
    grew = false;
    const alt = [...names].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    // The initialiser stops at a comma so each binding in a destructured
    // parameter list (`{ cwd = ".", _exec = execFileSync }`) is examined on its
    // own; otherwise the first binding swallows the rest of the line and the
    // seam that actually holds the spawner is never seen.
    const re = new RegExp("([A-Za-z_$][\\w$]*)\\s*=\\s*([^;,\\n]*)", "g");
    const holds = new RegExp("(?<![.\\w$])(?:" + alt + ")\\s*(?![\\w$(])");
    for (const m of code.matchAll(re)) {
      if (names.has(m[1])) continue;
      if (!holds.test(m[2])) continue;
      names.add(m[1]); grew = true;
    }
  }
  return names;
}

// Namespace imports of child_process, so `cp.spawn(...)` is still a call site
// while `re.exec(...)` and `str.slice(...)` are not.
export function childProcessNamespaces(code) {
  const names = new Set();
  for (const m of code.matchAll(/import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*["'`]node:child_process/g)) names.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["'`](?:node:)?child_process/g)) names.add(m[1]);
  return names;
}

// The text of a call's argument list, starting at the "(" index.
function argumentText(code, openParen) {
  let depth = 0;
  for (let i = openParen; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return code.slice(openParen + 1, i);
    }
  }
  return code.slice(openParen + 1);
}

const lineOf = (code, index) => code.slice(0, index).split("\n").length;

function optionsObjectFor(code, name) {
  const decl = new RegExp("\\b(?:const|let|var)\\s+" + name + "\\s*=\\s*\\{").exec(code);
  if (!decl) return null;
  return argumentText(code, code.indexOf("{", decl.index));
}

/**
 * Every call site in `source` that starts a process, with whether the call
 * passes windowsHide. Options held in a named constant of the same file, or
 * spread from one, count as passing it.
 */
export function findSpawnCallSites(source, { file = "" } = {}) {
  const raw = String(source);
  const code = blankNonCode(raw);
  const aliases = spawnAliases(code);
  const namespaces = childProcessNamespaces(code);
  const sites = [];

  const alt = [...aliases].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!alt) return sites;
  const callRe = new RegExp("\\b(" + alt + ")\\s*\\(", "g");

  for (const m of code.matchAll(callRe)) {
    const openParen = m.index + m[0].length - 1;
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    // A declaration (`function spawn(`) is not a call site.
    if (/\b(function|class)\s+$/.test(before)) continue;
    // A property read is only a spawner when the object is child_process
    // itself: `cp.spawn(...)` counts, `re.exec(...)` and `s.slice(...)` do not.
    const dotted = /([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(before);
    if (dotted && !namespaces.has(dotted[1])) continue;
    if (/[.]\s*$/.test(before) && !dotted) continue;
    const args = argumentText(code, openParen);
    const argsRaw = raw.slice(openParen + 1, openParen + 1 + args.length);

    let hasWindowsHide = /\bwindowsHide\s*:/.test(args);
    let via = hasWindowsHide ? "inline" : null;

    if (!hasWindowsHide) {
      for (const idm of args.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:,|$)/g)) {
        const body = optionsObjectFor(code, idm[1]);
        if (body && /\bwindowsHide\s*:/.test(body)) { hasWindowsHide = true; via = "const " + idm[1]; break; }
      }
    }
    if (!hasWindowsHide) {
      for (const sm of args.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
        const body = optionsObjectFor(code, sm[1]);
        if (body && /\bwindowsHide\s*:/.test(body)) { hasWindowsHide = true; via = "spread " + sm[1]; break; }
      }
    }

    sites.push({
      file,
      callee: m[1],
      line: lineOf(raw, openParen),
      hasWindowsHide,
      via,
      snippet: argsRaw.replace(/\s+/g, " ").trim().slice(0, 120),
    });
  }
  return sites;
}

// ---- repository walk -------------------------------------------------------

async function walk(dir, out = []) {
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (SCAN_EXTENSIONS.includes(path.extname(e.name))) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(REPO_ROOT, file).replace(/\\/g, "/");

/** Every first-party call site, in repo order. */
export async function auditRepo({ repoRoot = REPO_ROOT, dirs = SCAN_DIRS } = {}) {
  const sites = [];
  for (const d of dirs) {
    for (const file of await walk(path.join(repoRoot, d))) {
      const src = await fsp.readFile(file, "utf8");
      sites.push(...findSpawnCallSites(src, { file: relative(file) }));
    }
  }
  return sites;
}

/** Call sites that break the rule and are not allowlisted. */
export function offenders(sites, allowed = ALLOWED_WITHOUT_WINDOWS_HIDE) {
  return sites.filter((s) => !s.hasWindowsHide && !((s.file + ":" + s.callee) in allowed));
}

// PM2 v7.0.4 on this machine validates and stores the camelCase schema field
// `windowsHide`, and ForkMode reads pm2_env.windowsHide before spawning. The
// snake_case ecosystem name would be a guess here, so the audit requires the
// field proven by the installed PM2 source.
function pm2AppRecord(app, index) {
  const name = app && typeof app.name === "string" && app.name.trim()
    ? app.name
    : "<unnamed #" + (index + 1) + ">";
  const hasWindowsHide = !!(app && typeof app === "object" && app.windowsHide === true);
  return {
    name,
    hasWindowsHide,
    reason: hasWindowsHide
      ? ""
      : "missing windowsHide: true; installed PM2 v7.0.4 reads pm2_env.windowsHide",
  };
}

/**
 * PM2 app declarations in the ecosystem file, with parse/read errors captured
 * as findings instead of thrown. A missing or malformed ecosystem config must
 * never make the call-site audit silently pass.
 */
export async function auditPm2Ecosystem({
  repoRoot = REPO_ROOT,
  ecosystemFile = path.join(repoRoot, PM2_ECOSYSTEM_RELATIVE),
} = {}) {
  const file = path.resolve(ecosystemFile);
  const displayFile = path.relative(repoRoot, file).replace(/\\/g, "/");

  try {
    await fsp.access(file);
  } catch (e) {
    return {
      file: displayFile,
      apps: [],
      errors: [{ file: displayFile, reason: "ecosystem config not found: " + (e.code || e.message) }],
    };
  }

  let config;
  try {
    const resolved = require.resolve(file);
    delete require.cache[resolved];
    config = require(resolved);
  } catch (e) {
    return {
      file: displayFile,
      apps: [],
      errors: [{ file: displayFile, reason: "ecosystem config could not be parsed: " + (e.message || String(e)) }],
    };
  }

  if (!config || !Array.isArray(config.apps)) {
    return {
      file: displayFile,
      apps: [],
      errors: [{ file: displayFile, reason: "ecosystem config does not export an apps array" }],
    };
  }

  return {
    file: displayFile,
    apps: config.apps.map(pm2AppRecord),
    errors: [],
  };
}

export function pm2Offenders(result) {
  return [
    ...(result.errors || []).map((e) => ({
      name: result.file || e.file || PM2_ECOSYSTEM_RELATIVE,
      hasWindowsHide: false,
      reason: e.reason,
    })),
    ...(result.apps || []).filter((app) => !app.hasWindowsHide),
  ];
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const sites = await auditRepo();
  const bad = offenders(sites);
  const pm2 = await auditPm2Ecosystem();
  const pm2Bad = pm2Offenders(pm2);
  for (const s of sites) {
    const mark = s.hasWindowsHide ? "ok  " : "MISS";
    const suffix = s.via && s.via !== "inline" ? " [via " + s.via + "]" : "";
    console.log(mark + " " + s.file + ":" + s.line + " " + s.callee + "(" + s.snippet + ")" + suffix);
  }
  console.log("\n" + sites.length + " call sites, " + bad.length + " without windowsHide");
  for (const app of pm2.apps) {
    const mark = app.hasWindowsHide ? "ok  " : "MISS";
    console.log(mark + " PM2 app " + app.name + (app.reason ? " (" + app.reason + ")" : ""));
  }
  for (const e of pm2.errors) {
    console.log("MISS PM2 ecosystem " + pm2.file + " (" + e.reason + ")");
  }
  console.log(pm2.apps.length + " PM2 apps, " + pm2Bad.length + " without windowsHide");
  process.exit(bad.length || pm2Bad.length ? 1 : 0);
}
