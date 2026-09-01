// ops-watcher/lane-guard.mjs
// Small dispatch-wrapper guard around routing.mjs lane health state.
// Dependency-injected for offline tests; failures never block real work.

import {
  shouldSkipLane as defaultShouldSkipLane,
  recordFailure as defaultRecordFailure,
  recordQuotaExhausted as defaultRecordQuotaExhausted,
  clearFailure as defaultClearFailure,
  isQuotaFailureText as defaultIsQuotaFailureText,
} from "./routing.mjs";

export const LANE_KEYS = {
  corleone: "codex",
  sjahrir: "kimi",
  hatta: "ollama",
  "hatta-flash": "ollama",
};

function resolveLaneKey(laneName) {
  return LANE_KEYS[laneName] || laneName;
}

function first200(value) {
  return String(value || "").slice(0, 200);
}

export async function guardLaneStart(laneName, deps = {}) {
  const laneKey = resolveLaneKey(laneName);
  try {
    const shouldSkipLane = deps.shouldSkipLane || defaultShouldSkipLane;
    const result = await shouldSkipLane(laneKey, deps);
    return {
      skip: result && result.skip === true,
      reason: result && result.reason != null ? result.reason : null,
      remainingMs: result && Number.isFinite(result.remainingMs) ? result.remainingMs : 0,
      laneKey,
    };
  } catch {
    return { skip: false, reason: null, remainingMs: 0, laneKey };
  }
}

export async function recordLaneOutcome(laneName, result = {}, deps = {}) {
  const laneKey = resolveLaneKey(laneName);
  try {
    if (result && result.ok === true) {
      const clearFailure = deps.clearFailure || defaultClearFailure;
      await clearFailure(laneKey, deps);
      return { recorded: true, kind: "success", laneKey };
    }

    const stdout = result && result.stdout != null ? String(result.stdout) : "";
    const stderr = result && result.stderr != null ? String(result.stderr) : "";
    const text = `${stdout}\n${stderr}`;
    const isQuotaFailureText = deps.isQuotaFailureText || defaultIsQuotaFailureText;
    if (isQuotaFailureText(text)) {
      const recordQuotaExhausted = deps.recordQuotaExhausted || defaultRecordQuotaExhausted;
      await recordQuotaExhausted(laneKey, first200(text), deps);
      return { recorded: true, kind: "quota", laneKey };
    }

    const recordFailure = deps.recordFailure || defaultRecordFailure;
    await recordFailure(laneKey, first200(text), deps);
    return { recorded: true, kind: "failure", laneKey };
  } catch {
    return { recorded: false, kind: "error", laneKey };
  }
}
