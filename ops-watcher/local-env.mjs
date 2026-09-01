// ops-watcher/local-env.mjs
// Safe loader for <repoRoot>/.env.local — never prints, logs, or persists a secret value.
//
// Exports:
//   LOCAL_ENV_FILE              absolute path to <repoRoot>/.env.local
//   parseEnvFile(text)          PURE parser -> plain object
//   loadLocalEnv(names, opts)   -> { found, values } for requested names only
//   describeSecretPresence(result) -> SAFE { KEY: { present, length } } summary
//
// Safety guarantees:
//   * loadLocalEnv never mutates the passed `env` object (or process.env).
//   * loadLocalEnv never throws — a missing/unreadable file yields all-false.
//   * No value is ever included in any thrown or logged message.
//   * No interpolation, expansion, or execution of any kind.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const LOCAL_ENV_FILE = path.join(REPO_ROOT, ".env.local");

/**
 * PURE parser for a .env-style file body.
 *
 * Handles: KEY=value, surrounding single or double quotes, `export KEY=value`,
 * blank lines, `#` comments, whitespace around `=`, CRLF, and values that
 * themselves contain `=`. It does NOT interpolate, expand, or execute anything.
 * Malformed lines are silently ignored — it never throws.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  const out = {};
  if (typeof text !== "string" || text.length === 0) return out;
  // Normalize CRLF / CR to LF so line splitting is uniform.
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (const rawLine of lines) {
    let line = rawLine;
    // A full-line comment (first non-whitespace char is #) is skipped. Inline
    // comments after a value are NOT stripped because a value may legitimately
    // contain `#`.
    if (/^\s*#/.test(line)) continue;
    // Optional leading `export `.
    line = line.replace(/^\s*export\s+/, "");
    // Require an `=` to be a valid assignment.
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    // Valid env var name: letters, digits, underscore; must not start with digit.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1);
    // Trim surrounding whitespace (but not interior).
    value = value.replace(/^\s+/, "").replace(/\s+$/, "");
    // Strip one matching pair of surrounding quotes (single or double).
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load requested env names from <repoRoot>/.env.local, preferring an
 * already-set value on the passed `env` (defaults to process.env) over the
 * file value.
 *
 * @param {string[]} names
 * @param {{ file?: string, env?: Record<string,string>, _fs?: any }} [opts]
 * @returns {{ found: Record<string, boolean>, values: Record<string, string> }}
 *
 * Never mutates `env` / process.env. Never throws. Never includes a value in
 * any thrown or logged message. A missing/unreadable file yields all-false.
 */
export function loadLocalEnv(names, { file = LOCAL_ENV_FILE, env = process.env, _fs } = {}) {
  const req = Array.isArray(names) ? names.slice() : [];
  const found = {};
  const values = {};
  for (const n of req) {
    found[n] = false;
    values[n] = "";
  }

  // Prefer an already-set env value (non-empty) over the file.
  for (const n of req) {
    try {
      const existing = env && env[n];
      if (typeof existing === "string" && existing.length > 0) {
        found[n] = true;
        values[n] = existing;
      }
    } catch {
      /* ignore — never throw, never leak */
    }
  }

  // Fill the rest from the file.
  const missingFromFile = req.filter((n) => !found[n]);
  if (missingFromFile.length === 0) {
    return { found, values };
  }

  let fileText = null;
  try {
    const reader = _fs && typeof _fs.readFileSync === "function" ? _fs : fs;
    fileText = reader.readFileSync(file, "utf8");
  } catch {
    // Missing/unreadable file -> all-false for the still-missing names.
    return { found, values };
  }

  if (fileText == null) {
    return { found, values };
  }

  let parsed = {};
  try {
    parsed = parseEnvFile(fileText);
  } catch {
    return { found, values };
  }

  for (const n of missingFromFile) {
    const v = parsed[n];
    if (typeof v === "string" && v.length > 0) {
      found[n] = true;
      values[n] = v;
    }
  }

  return { found, values };
}

/**
 * SAFE summary of a loadLocalEnv result — presence + length ONLY, never the value.
 *
 * @param {{ found: Record<string, boolean>, values: Record<string, string> }} result
 * @returns {Record<string, { present: boolean, length: number }>}
 */
export function describeSecretPresence(result) {
  const summary = {};
  if (!result || typeof result !== "object") return summary;
  const found = result.found || {};
  const values = result.values || {};
  for (const key of Object.keys(found)) {
    const present = !!found[key];
    const length = present && typeof values[key] === "string" ? values[key].length : 0;
    summary[key] = { present, length };
  }
  return summary;
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isEntry) {
  // Tiny CLI: prints only the SAFE presence/length summary, never any value.
  const names = ["NOTION_TOKEN", "NOTION_PARENT_PAGE_ID"];
  const result = loadLocalEnv(names);
  const summary = describeSecretPresence(result);
  console.log(JSON.stringify(summary, null, 2));
}