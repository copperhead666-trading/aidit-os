// Ops/Infra loop (PRD v5 s3.6, s2.13): every 15 minutes probe the lanes and
// check disk/RAM; below thresholds it cleans old worktrees/workspaces and
// caches, and alerts the owner once per day. PM2 process "ops".
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE, loadEnvLocal, readJson, writeJson, ledgerAppend, machineHealth, run, wibParts } from './lib.mjs';
import { probeLanes } from './lanes.mjs';
import { alert } from './owner.mjs';

loadEnvLocal();
const ONCE = process.argv.includes('--once');
const ALARM_FILE = path.join(STATE, 'ops-alarms.json');
const DISK_MIN_GB = 10;
const RAM_MIN_MB = 1024;

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

export async function tick() {
  const probe = await probeLanes().catch((e) => ({ error: e.message }));
  const m = await machineHealth();
  const alarms = readJson(ALARM_FILE, {});
  const today = wibParts().date;
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
  ledgerAppend({ kind: 'ops.tick', machine: m, probe });
  return { machine: m, probe, low, removed: removed.length };
}

const r = await tick();
console.log(JSON.stringify(r));
if (!ONCE) setInterval(() => tick().then((x) => console.log(JSON.stringify(x))).catch((e) => ledgerAppend({ kind: 'ops.error', error: e.message })), 15 * 60000);
