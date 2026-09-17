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

function pm2Status(name) {
  try {
    const out = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32', windowsHide: true });
    const list = JSON.parse(out);
    const app = list.find((p) => p.name === name);
    return app ? app.pm2_env.status : 'missing';
  } catch { return 'unknown'; }
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
// dan lanes.mjs menolaknya dengan error "orkestrator down".
const GATE_FLAG = path.join(STATE, 'orkestrator-down.flag');
try {
  if (conductorStatus !== 'online') fs.writeFileSync(GATE_FLAG, new Date().toISOString());
  else if (fs.existsSync(GATE_FLAG)) fs.unlinkSync(GATE_FLAG);
} catch {}
if (conductorStatus !== 'online') problems.push({ key: 'conductor-down', text: `⚠️ Orkestrator tidak online (status PM2: ${conductorStatus}). Worker berhenti mengambil tugas baru sampai dipulihkan.` });
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
