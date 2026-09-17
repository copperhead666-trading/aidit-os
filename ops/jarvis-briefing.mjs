// Jarvis briefing (Tahap 5, 2026-09-17): laporan deterministik NON-LLM.
// Dipanggil scheduled task Windows:
//   node ops/jarvis-briefing.mjs pagi   -> briefing 07:00 WIB
//   node ops/jarvis-briefing.mjs malam  -> ringkasan 19:00 WIB
//   node ops/jarvis-briefing.mjs biaya  -> laporan biaya mingguan (Senin 07:00)
// Sumber data: pm2 jlist, machine health, state/ledger.jsonl (tail), Paperclip.
// Pesan <= 10 baris, Bahasa Indonesia baku, HANYA ke chatId owner
// (company.json). Token dari .env.local; tidak pernah dicetak.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, 'state');
const MODE = process.argv[2] || 'pagi';

function readJson(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }

function loadEnvLocal() {
  const f = path.join(ROOT, '.env.local');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
loadEnvLocal();

function pm2() {
  try {
    const out = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' });
    return JSON.parse(out).map((p) => ({ name: p.name, status: p.pm2_env.status }));
  } catch { return []; }
}

function disk() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { '{0} {1:N1}' -f $_.DeviceID, ($_.FreeSpace/1GB) }"],
      { encoding: 'utf8', timeout: 30000 });
    return out.trim().split(/\r?\n/).filter(Boolean).join(' · ');
  } catch { return '?'; }
}

// ledger tail tanpa baca file penuh (pola ledgerTail lib.mjs)
function ledgerTail(n) {
  const file = path.join(STATE, 'ledger.jsonl');
  if (!fs.existsSync(file)) return [];
  const size = fs.statSync(file).size;
  const CHUNK = Math.min(size, 512 * 1024);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(CHUNK);
  fs.readSync(fd, buf, 0, CHUNK, size - CHUNK);
  fs.closeSync(fd);
  let text = buf.toString('utf8');
  const nl = text.indexOf('\n');
  if (size > CHUNK && nl >= 0) text = text.slice(nl + 1);
  return text.trim().split('\n').filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function paperclipCounts() {
  try {
    const res = await fetch('http://127.0.0.1:3120/api/companies/4adffa70-f825-4e96-ba85-086c93f24b9f/issues', { signal: AbortSignal.timeout(10000) });
    const issues = await res.json();
    const open = issues.filter((i) => !['done', 'canceled', 'cancelled', 'archived'].includes(i.status));
    return { total: issues.length, open: open.length, blocked: open.filter((i) => i.status === 'blocked').length };
  } catch { return null; }
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN_AHMAD;
  const co = readJson(path.join(ROOT, 'config', 'company.json'), {});
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID || co?.company?.owner?.telegramChatId;
  if (!token || !chatId) { console.log('telegram: token/chatId tidak ada'); return false; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(20000),
    });
    return res.ok;
  } catch { return false; }
}

const tail = ledgerTail(200);
const apps = pm2();
const down = apps.filter((a) => a.status !== 'online').map((a) => `${a.name}(${a.status})`);
const pc = await paperclipCounts();

let text;
if (MODE === 'biaya') {
  // Laporan biaya mingguan: agregasi lane.run costUsd 7 hari terakhir dari ledger tail.
  const weekAgo = Date.now() - 7 * 86400000;
  const cost = {};
  let total = 0, calls = 0;
  for (const e of tail) {
    if (e.kind !== 'lane.run') continue;
    const t = Date.parse(e.wib || e.at || 0);
    if (t && t < weekAgo) continue;
    calls++;
    const c = Number(e.costUsd) || 0;
    total += c;
    cost[e.lane] = (cost[e.lane] || 0) + c;
  }
  const lines = Object.entries(cost).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `· ${k}: $${v.toFixed(3)}`);
  text = `📊 Laporan biaya mingguan Jarvis\nTotal OpenRouter (perkiraan dari ledger): $${total.toFixed(3)} dari ${calls} panggilan lane\n${lines.join('\n') || '· belum ada pemakaian tercatat'}\nBatas pool: $1,5/hari (openrouter-paid)\nCatatan: hanya 512 KB ledger terakhir yang terbaca; angka perkiraan bawah.`;
} else if (MODE === 'malam') {
  const ticksOk = tail.filter((e) => e.kind === 'conductor.tick' && e.ok).length;
  const ticksFail = tail.filter((e) => e.kind === 'conductor.tick' && e.ok === false).length;
  const laneFail = {};
  for (const e of tail) if (e.kind === 'lane.run' && !e.ok) laneFail[e.lane] = (laneFail[e.lane] || 0) + 1;
  const failLine = Object.entries(laneFail).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(', ');
  text = `🌙 Ringkasan malam — Aidit OS\nSistem: ${down.length ? '⚠️ mati: ' + down.join(', ') : 'semua layanan online'}\nDisk: ${disk()}\nOrkestrator: ${ticksOk} tick ok, ${ticksFail} gagal (ledger terakhir)\nLane gagal: ${failLine || 'tidak ada'}\nPaperclip: ${pc ? `${pc.open} issue terbuka (${pc.blocked} blocked)` : 'tidak terbaca'}\nSelamat istirahat, Bapak.`;
} else {
  const asks = tail.filter((e) => e.kind === 'owner.ask').slice(-3);
  text = `☀️ Briefing pagi — Aidit OS\nSistem: ${down.length ? '⚠️ mati: ' + down.join(', ') : 'semua layanan online'}\nDisk: ${disk()}\nPaperclip: ${pc ? `${pc.open} issue terbuka (${pc.blocked} blocked), total ${pc.total}` : 'tidak terbaca'}\nButuh keputusan Bapak: ${asks.length ? asks.map((a) => a.title || a.id).join('; ').slice(0, 120) : 'tidak ada'}\nRencana hari ini: Orkestrator melanjutkan issue terbuka sesuai prioritas lane.`;
}

const ok = await sendTelegram(text);
console.log(JSON.stringify({ mode: MODE, sent: ok, chars: text.length }));
if (!ok) process.exitCode = 1;
