// ops-watcher/load-env-local.cjs
// Shared .env.local loader for CommonJS PM2 shims and ES module callers.
//
// ESM usage note:
//   import { createRequire } from "node:module";
//   const require = createRequire(import.meta.url);
//   const loadEnvLocal = require("./load-env-local.cjs");

const fs = require("node:fs");
const path = require("node:path");

function stripMatchingQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function loadEnvLocal({
  file = path.join(__dirname, "..", ".env.local"),
  env = process.env,
  _fs = fs,
} = {}) {
  let text;
  try {
    text = _fs.readFileSync(file, "utf8");
  } catch {
    return { loaded: [], skipped: [], file, found: false };
  }

  const loaded = [];
  const skipped = [];

  for (const line of String(text).split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    const value = stripMatchingQuotes(line.slice(eq + 1).trim());
    if (hasOwn(env, key)) {
      skipped.push(key);
      continue;
    }

    env[key] = value;
    loaded.push(key);
  }

  return { loaded, skipped, file, found: true };
}

module.exports = loadEnvLocal;
