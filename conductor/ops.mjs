// Ops/Infra loop (PRD v5 s3.6, s2.13): every 15 minutes probe the lanes and
// check disk/RAM; below thresholds it cleans old worktrees/workspaces and
// caches, and alerts the owner once per day. PM2 process "ops".
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE, loadEnvLocal, readJson, writeJson, ledgerAppend, machineHealth, run, wibParts, graphifyUpdate } from './lib.mjs';
import { probeLanes } from './lanes.mjs';
import { alert } from './owner.mjs';
import { maybeSelfImprove } from './self-improve.mjs';

loadEnvLocal();
const ONCE = process.argv.includes('--once');
const ALARM_FILE = path.join(STATE, 'ops-alarms.json');
const DISK_MIN_GB = 10;
const RAM_MIN_MB = 1024;
const GRAPH_SHA_FILE = path.join(STATE, 'graphify-sha.json');
const SELF_IMPROVE_FILE = path.join(STATE, 'self-improve-run.json');
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:4200/api/orchestrator/status';
const TG_HEARTBEAT_FILE = path.join(STATE, 'telegram-heartbeat.json');

// head.mjs already calls graphifyUpdate() after a venture-ticket commit, but
// this session's own direct commits (conductor/*.mjs, app/*, etc. -- not
// routed through a head's workspace) never triggered it: found live
// 2026-09-15, graph.json was 2+ hours and many commits behind HEAD. This
// tick is the catch-all -- SHA-gated so it only re-runs graphify when the
// repo actually moved, same idea as Bagian 5's planned auto-deploy check.
async function maybeUpdateGraph() {
  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT, timeoutMs: 10000 });
  const sha = head.stdout.trim();
  if (!sha) return { updated: false };
  const last = readJson(GRAPH_SHA_FILE, {}).sha;
  if (sha === last) return { updated: false, sha };
  graphifyUpdate(ROOT); // fire-and-forget, same as head.mjs's own call
  writeJson(GRAPH_SHA_FILE, { sha, at: new Date().toISOString() });
  return { updated: true, sha };
}

async function cleanup() {
  const removed = [];
  // git worktrees whose issue is no longer open: prune anything older than 3 days
  const wsInternal = path.join(STATE, 'workspaces', 'internal');
  if (fs.existsSync(wsInternal)) {
    for (const d of fs.readdirSync(wsInternal)) {
      const full = path.join(wsInternal, d);
      const age = (Date.now() - fs.statSync(full).mtimeMs) / 86400000;
      if (age > 3) { await run('git', ['worktree', 'remove', '--force', full], { cwd: ROOT }); removed.push(full); }
    }
    await run('git', ['worktree', 'prune'], { cwd: ROOT });
  }
  // stale conductor raw dumps and old logs
  for (const f of ['state/conductor/last-raw.json']) { try { fs.unlinkSync(path.join(ROOT, f)); } catch {} }
  const tmp = process.env.TEMP;
  if (tmp && fs.existsSync(tmp)) {
    for (const d of fs.readdirSync(tmp)) {
      if (!/^(npm-|tmp-|claude-|codex-)/i.test(d)) continue;
      const full = path.join(tmp, d);
      try { if ((Date.now() - fs.statSync(full).mtimeMs) / 86400000 > 2) { fs.rmSync(full, { recursive: true, force: true }); removed.push(full); } } catch {}
    }
  }
  return removed;
}

// PRD "Personal Assistant" Bagian 8: score already names its own drags --
// once/day is enough to turn them into tickets (score is a same-day
// snapshot, dedup by title in self-improve.mjs stops repeat spam anyway).
async function maybeRunSelfImprove(today) {
  const last = readJson(SELF_IMPROVE_FILE, {}).date;
  if (last === today) return { acted: false, skipped: 'already-ran-today' };
  const r = await maybeSelfImprove();
  writeJson(SELF_IMPROVE_FILE, { date: today, ...r });
  return r;
}

// AID-35: detection-only health probes for the dashboard (port 4200, never
// probed from conductor/ before) and the Telegram poll loop's heartbeat
// file. No auto-restart or alerting here -- that's a separate ticket.
export async function probeDashboard(url = DASHBOARD_URL) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 160) };
  }
}

export function checkTelegramHeartbeat(file = TG_HEARTBEAT_FILE) {
  const hb = readJson(file, null);
  if (!hb?.ts) return { ok: false, ageSec: null, error: 'no heartbeat' };
  const ms = Date.now() - new Date(hb.ts).getTime();
  if (!Number.isFinite(ms)) return { ok: false, ageSec: null, error: 'invalid timestamp' };
  return { ok: true, ageSec: Math.round(ms / 1000) };
}

export async function tick() {
  const probe = await probeLanes().catch((e) => ({ error: e.message }));
  const graph = await maybeUpdateGraph().catch((e) => ({ updated: false, error: e.message }));
  const m = await machineHealth();
  const alarms = readJson(ALARM_FILE, {});
  const today = wibParts().date;
  const selfImprove = await maybeRunSelfImprove(today).catch((e) => ({ acted: false, error: e.message }));
  const dashboard = await probeDashboard();
  const telegramHeartbeat = checkTelegramHeartbeat();
  const platformHealth = { kind: 'ops.platform-health', dashboard, telegramHeartbeat };
  const low = [];
  if (m.freeDiskGb != null && m.freeDiskGb < DISK_MIN_GB) low.push(`disk ${m.freeDiskGb} GB`);
  if (m.freeRamMb < RAM_MIN_MB) low.push(`ram ${m.freeRamMb} MB`);
  let removed = [];
  if (low.length) {
    removed = await cleanup();
    const after = await machineHealth();
    ledgerAppend({ kind: 'ops.low', low, removed: removed.length, after });
    if (alarms[today] !== 'sent') {
      await alert({ what: `Ruang di komputer Lenovo menipis (${after.freeDiskGb ?? '?'} GB tersisa, memori ${after.freeRamMb} MB).`, done: `pembersihan otomatis menghapus ${removed.length} berkas sementara.`, needsOwner: false });
      alarms[today] = 'sent'; writeJson(ALARM_FILE, alarms);
    }
  }
  ledgerAppend({ kind: 'ops.tick', machine: m, probe, graph, selfImprove, platformHealth });
  return { machine: m, probe, low, removed: removed.length, graph, selfImprove, platformHealth };
}

if (!process.env.VITEST) {
  const r = await tick();
  console.log(JSON.stringify(r));
  if (!ONCE) setInterval(() => tick().then((x) => console.log(JSON.stringify(x))).catch((e) => ledgerAppend({ kind: 'ops.error', error: e.message })), 15 * 60000);
}
