// ops-watcher/cockpit-url.mjs
// The cockpit's public address is a per-machine fact, so it is read from
// config/machine.json — the one file allowed to know things about the physical
// machine — rather than typed into each caller.
//
// This exists because two live paths (telegram-commands.mjs and
// telegram-setup.mjs) still handed the owner
// "https://asus-gray.tailc7b60e.ts.net/" after the ASUS went dark. The /cockpit
// command and the Telegram menu button both pointed at a machine that
// `tailscale status` reports as offline, while the funnel on this machine
// already served the cockpit at lenovo-black. A link the owner taps and cannot
// open is worse than no link: it teaches him the system is lying about where
// his own dashboard is.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Never throws: a missing or malformed machine.json degrades to the local base,
// which is correct on the machine that runs this and merely useless elsewhere.
// Failing loudly here would take the whole Telegram command surface down with
// it, and the owner would lose /status and /inbox over a cosmetic URL.
export function readCockpitUrl(deps = {}) {
  const readFile = deps.readFile || ((p) => fs.readFileSync(p, "utf8"));
  const file = deps.file || path.join(ROOT, "config", "machine.json");
  try {
    const machine = JSON.parse(readFile(file));
    const base = machine && machine.cockpit && machine.cockpit.public_base;
    if (typeof base === "string" && /^https?:\/\//.test(base)) {
      return base.endsWith("/") ? base : base + "/";
    }
    const local = machine && machine.cockpit && machine.cockpit.local_base;
    if (typeof local === "string" && /^https?:\/\//.test(local)) {
      return local.endsWith("/") ? local : local + "/";
    }
  } catch { /* fall through to the local default */ }
  return "http://127.0.0.1:4200/";
}

export const COCKPIT_URL = readCockpitUrl();
