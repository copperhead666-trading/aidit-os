import fs from "node:fs";
import path from "node:path";

const IS_WIN = process.platform === "win32";

function pathDelimiterFor(platform) {
  return platform === "win32" ? ";" : ":";
}

function expandShimRelativePath(raw, shimDir, pathMod) {
  const withoutDp0 = raw.replace(/^%dp0%[\\/]?/i, "");
  return pathMod.resolve(shimDir, withoutDp0);
}

export function resolveHermesEntry(deps = {}) {
  try {
    const platform = deps.platform || process.platform;
    if (platform !== "win32") return null;

    const fsMod = deps.fs || fs;
    const pathMod = deps.path || path;
    const envPath = deps.envPath === undefined ? process.env.PATH || "" : String(deps.envPath || "");
    const dirs = envPath.split(pathDelimiterFor(platform));

    for (const dir of dirs) {
      if (!dir) continue;
      const shim = pathMod.join(dir, "hermes.cmd");
      let text;
      try {
        text = fsMod.readFileSync(shim, "utf8");
      } catch {
        continue;
      }

      const match = String(text).match(/(?:%dp0%[\\/]?)?node_modules[\\/][^\s"]*hermes\.js/i);
      if (!match) continue;

      const entry = expandShimRelativePath(match[0], dir, pathMod);
      try {
        fsMod.accessSync(entry);
      } catch {
        continue;
      }
      return entry;
    }
  } catch {
    return null;
  }
  return null;
}

export function buildHermesInvocation(args, deps = {}) {
  try {
    const platform = deps.platform || process.platform;
    const entry = deps.hermesJs === undefined ? resolveHermesEntry(deps) : deps.hermesJs;
    const safeArgs = Array.isArray(args) ? args : [];

    if (entry) {
      return {
        file: deps.nodePath || process.execPath,
        args: [entry, ...safeArgs],
        options: { shell: false, windowsHide: true },
      };
    }

    if (platform !== "win32") {
      return {
        file: "hermes",
        args: safeArgs,
        options: { shell: false, windowsHide: true },
      };
    }
  } catch {
    return null;
  }
  return null;
}
