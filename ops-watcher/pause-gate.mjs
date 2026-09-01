// ops-watcher/pause-gate.mjs
//
// Single source of truth for whether FounderOS is allowed to do actuator work.
// This module only answers the pause question and records the owner's intent;
// process control, PM2, Telegram, and actuator behavior belong to callers.

import realFs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PAUSE_FILE = path.join(__dirname, "PAUSED");

const NOTE = "FounderOS sedang PAUSED; file ini adalah emergency stop pemilik, dan menghapus file ini akan me-resume sistem.";

function defaultState() {
  return { paused: false, reason: "", atIso: null, by: null };
}

function unreadableState(err) {
  const detail = err && err.message ? `: ${err.message}` : "";
  return {
    paused: true,
    reason: `Pause flag could not be read at ${PAUSE_FILE}${detail}`,
    atIso: null,
    by: null,
  };
}

function pickFs(deps) {
  return deps && deps.fs ? deps.fs : realFs;
}

function callNow(now) {
  return typeof now === "function" ? now() : now;
}

function toIso(value) {
  const raw = callNow(value ?? Date.now);
  const date = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function cleanText(value, fallback = "") {
  const text = value == null ? "" : String(value).trim();
  return text || fallback;
}

export function readPause(deps = {}) {
  try {
    const fs = pickFs(deps);
    let exists;
    try {
      exists = fs.existsSync(PAUSE_FILE);
    } catch (err) {
      // Fail closed: if we cannot determine the emergency-stop flag state, we
      // report PAUSED. A spurious halt costs one /resume; ignoring a real stop
      // could cost far more.
      return unreadableState(err);
    }

    if (!exists) return defaultState();

    let raw;
    try {
      raw = fs.readFileSync(PAUSE_FILE, "utf8");
    } catch (err) {
      return unreadableState(err);
    }

    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch (err) {
      return unreadableState(err);
    }

    return {
      paused: true,
      reason: cleanText(parsed.reason, "Owner pause flag is set."),
      atIso: cleanText(parsed.atIso) || null,
      by: cleanText(parsed.by) || null,
    };
  } catch (err) {
    return unreadableState(err);
  }
}

export function isPaused(deps = {}) {
  try {
    return Boolean(readPause(deps).paused);
  } catch {
    return true;
  }
}

export function setPaused({ reason, by, now } = {}, deps = {}) {
  try {
    const atIso = toIso(now ?? deps.now ?? Date.now);
    const payload = {
      reason: cleanText(reason, "Owner requested emergency pause."),
      by: cleanText(by, "owner"),
      atIso,
      note: NOTE,
    };
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    pickFs(deps).writeFileSync(PAUSE_FILE, body, "utf8");
    return {
      ok: true,
      wrote: true,
      state: { paused: true, reason: payload.reason, atIso: payload.atIso, by: payload.by },
    };
  } catch (err) {
    return { ok: false, wrote: false, state: unreadableState(err) };
  }
}

export function clearPause(deps = {}) {
  try {
    const fs = pickFs(deps);
    let exists;
    try {
      exists = fs.existsSync(PAUSE_FILE);
    } catch (err) {
      return { ok: false, cleared: false, error: `Pause flag could not be checked at ${PAUSE_FILE}: ${err.message || err}` };
    }

    if (!exists) return { ok: true, cleared: false };

    try {
      fs.unlinkSync(PAUSE_FILE);
      return { ok: true, cleared: true };
    } catch (err) {
      return { ok: false, cleared: false, error: `Pause flag could not be cleared at ${PAUSE_FILE}: ${err.message || err}` };
    }
  } catch (err) {
    return { ok: false, cleared: false, error: `Pause flag clear failed: ${err.message || err}` };
  }
}

export function pauseBanner(state) {
  try {
    if (!state || !state.paused) return "";
    const at = state.atIso || "waktu tidak diketahui";
    const by = state.by || "pemilik tidak diketahui";
    const reason = cleanText(state.reason, "tanpa alasan tertulis");
    return `FounderOS PAUSED sejak ${at} oleh ${by}: ${reason}`;
  } catch {
    return "FounderOS PAUSED: status pause tidak bisa ditampilkan dengan lengkap.";
  }
}
