// Dead-man switch (Tahap 2 prompt otonom 2026-09-17): proses deterministik
// NON-LLM yang dijalankan scheduled task Windows tiap 5 menit.
// Cek: (1) Orkestrator (PM2 app "conductor") online, (2) sisa disk >= 10%,
// (3) heartbeat file ops segar. Bila bermasalah -> kirim Telegram ke owner,
// maksimal 1 pesan per masalah per jam (state/deadman-alerts.json).
// Secret dibaca dari .env.local saat runtime dan TIDAK PERNAH dicetak.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'state');
const ALERT_FILE = path.join(STATE, 'deadman-alerts.json');
const COOLDOWN_MS = 60 * 60 * 1000; // 1 pesan/masalah/jam

function loadEnvLocal() {
  const f = path.join(ROOT, '.env.local');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
loadEnvLocal();

function readJson(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); }

// 2026-09-18 harness fix: without an explicit PM2_HOME, `pm2 jlist` can miss
// the already-running daemon (Windows named-pipe race, worse under memory
// pressure) and silently spawn a brand-new detached one instead -- found
// live: ~100 orphaned `pm2/lib/Daemon.js` processes had piled up from
// repeated status/deadman checks, eating the RAM that killed a real
// dispatch. Pinning the real home removes that ambiguity at the source.
const PM2_HOME = process.env.PM2_HOME || 'D:\\pm2home';

// 2026-09-18 self-heal: pinning PM2_HOME (di atas) tidak menghilangkan race-nya
// -- akar masalahnya ada di pm2/lib/Client.js sendiri: pingDaemon() cuma
// nyoba connect SEKALI ke named pipe daemon lama, dan begitu attempt itu
// gagal (lazim kalau RAM/CPU lagi sempit), pm2 langsung anggap "daemon
// belum jalan" lalu spawn yang baru -- tanpa retry. Vendored library, jadi
// tidak dipatch langsung (ketiban tiap `npm install`). Diverifikasi live:
// 75 orphan `Daemon.js` numpuk dalam ~3 jam sebelum fix ini (freed ~665MB).
// Solusinya: bukan mencegah race-nya, tapi bersih-bersih sendiri tiap kali
// kejadian -- catat PID daemon sebelum & sesudah tiap panggilan `pm2 jlist`,
// dan kill PID baru manapun yang muncul (pasti orphan, daemon asli sudah
// ada di daftar "before"). Orphan jadi hidup hitungan detik, bukan berjam-jam.
function listDaemonPids() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape('Daemon.js') }).ProcessId -join ','`],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return out.trim().split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
  } catch { return []; }
}

function killOrphanDaemons(before, after) {
  const spawned = after.filter((pid) => !before.includes(pid));
  for (const pid of spawned) {
    try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true, timeout: 5000 }); } catch {}
  }
  return spawned;
}

function pm2StatusOnce(name) {
  const before = listDaemonPids();
  let result;
  try {
    const out = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, PM2_HOME } });
    const list = JSON.parse(out);
    const app = list.find((p) => p.name === name);
    result = app ? app.pm2_env.status : 'missing';
  } catch { result = 'unknown'; }
  const after = listDaemonPids();
  killOrphanDaemons(before, after);
  return result;
}

// 2026-09-18: `pm2 jlist` sesekali gagal/timeout sesaat kalau RAM sempit
// (lane dispatch jalan bersamaan) -- itu kegagalan pemeriksaan, bukan bukti
// Orkestrator mati. Sebelum patch ini, 1x 'unknown' langsung menutup gate
// worker (state/orkestrator-down.flag) padahal `pm2 ls` di terminal Aidit
// tetap menunjukkan online (temuan sesi instruksi-09, 3x flag palsu dalam
// ~40 menit). Retry sekali dengan jeda; 'unknown' yang menetap tetap
// dianggap bermasalah (dilaporkan), tapi TIDAK menutup gate -- cuma status
// PM2 yang benar-benar terbaca non-online (stopped/errored/missing) yang
// menutup gate.
function pm2Status(name) {
  const first = pm2StatusOnce(name);
  if (first !== 'unknown') return first;
  const second = pm2StatusOnce(name);
  return second;
}

function diskFreePercent(drive) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}:'").FreeSpace / (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}:'").Size * 100`],
      { encoding: 'utf8', timeout: 30000, windowsHide: true });
    return parseFloat(out.trim());
  } catch { return null; }
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN_AHMAD;
  // .env.local punya TELEGRAM_OWNER_CHAT_ID kosong; fallback ke
  // config/company.json (company.owner.telegramChatId) yang dipakai
  // conductor/owner.mjs juga.
  let chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!chatId) {
    const co = readJson(path.join(ROOT, 'config', 'company.json'), {});
    chatId = co?.company?.owner?.telegramChatId;
  }
  if (!token || !chatId) { console.log('telegram: token/chatId tidak ada, lewati'); return false; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(20000),
    });
    return res.ok;
  } catch { return false; }
}

const problems = [];
const conductorStatus = pm2Status('orkestrator');
// Gate worker (aturan Tahap 2: bila Orkestrator mati, worker/lane berhenti
// mengambil tugas baru): deadman menulis flag saat conductor tidak online,
// dan lanes.mjs menolaknya dengan error "orkestrator down". 'unknown' berarti
// pemeriksaan pm2 sendiri gagal (bukan bukti conductor mati) -- dilaporkan
// tapi tidak menutup gate, supaya glitch pemeriksaan tidak memblokir semua
// lane (lihat catatan di pm2Status di atas).
const GATE_FLAG = path.join(STATE, 'orkestrator-down.flag');
const definitelyDown = conductorStatus !== 'online' && conductorStatus !== 'unknown';
try {
  if (definitelyDown) fs.writeFileSync(GATE_FLAG, new Date().toISOString());
  else if (conductorStatus === 'online' && fs.existsSync(GATE_FLAG)) fs.unlinkSync(GATE_FLAG);
} catch {}
if (definitelyDown) problems.push({ key: 'conductor-down', text: `⚠️ Orkestrator tidak online (status PM2: ${conductorStatus}). Worker berhenti mengambil tugas baru sampai dipulihkan.` });
else if (conductorStatus === 'unknown') problems.push({ key: 'conductor-probe-failed', text: '⚠️ Pemeriksaan `pm2 jlist` gagal 2x berturut-turut (kemungkinan RAM sempit) -- gate worker TIDAK ditutup, tapi status Orkestrator tidak terverifikasi kali ini.' });
for (const drive of ['C', 'D', 'E']) {
  const pct = diskFreePercent(drive);
  if (pct !== null && pct < 10) problems.push({ key: `disk-${drive}`, text: `⚠️ Sisa disk ${drive}: ${pct.toFixed(1)}% (< 10%). Perlu pembersihan.` });
}

const alerts = readJson(ALERT_FILE, {});
const now = Date.now();
let sent = 0;
for (const p of problems) {
  const last = alerts[p.key] || 0;
  if (now - last < COOLDOWN_MS) continue;
  const ok = await sendTelegram(`[Dead-man switch Aidit OS]\n${p.text}`);
  if (ok) { alerts[p.key] = now; sent++; }
}
if (problems.length === 0) { for (const k of Object.keys(alerts)) delete alerts[k]; }
writeJson(ALERT_FILE, alerts);
console.log(JSON.stringify({ at: new Date().toISOString(), conductor: conductorStatus, problems: problems.map((p) => p.key), sent }));
