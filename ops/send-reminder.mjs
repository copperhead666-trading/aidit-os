// One-shot Telegram reminder, fired by a Windows Scheduled Task (instruksi-06
// s5.4 — siklus hidup langganan). Usage: node ops/send-reminder.mjs <key>
// Each key maps to a fixed, short, plain-language message. Reuses the same
// telegram-client.mjs sendMessage() the rest of Aidit OS uses (token from
// TELEGRAM_BOT_TOKEN_AHMAD via loadEnvLocal(), never printed).
import { loadEnvLocal } from '../conductor/lib.mjs';
import { sendMessage } from '../conductor/telegram-client.mjs';

loadEnvLocal();

const REMINDERS = {
  '2026-09-19-claude-adityainofficial': 'Pengingat: besok (20 Sep) langganan Claude pusatberasmurah berhenti. Siapkan login adityainofficial ke profil khusus D:\\aidit-claude-machine hari ini kalau belum — lihat docs/guides/TRANSISI_AKUN_CLAUDE.md.',
  '2026-09-20-claude-cutover': 'Hari ini: langganan Claude pusatberasmurah berhenti. Pastikan sudah login adityainofficial ke profil khusus, lalu kembalikan ecosystem.config.cjs + pm2 restart orkestrator ops — lihat docs/guides/TRANSISI_AKUN_CLAUDE.md.',
  '2026-09-21-ollama-cancel': 'Pengingat: berhenti langganan Ollama hari ini bila belum (tagihan 22 Sep). Ollama sudah dilepas dari sistem sejak 17 Sep.',
  '2026-09-26-kimi-billing': 'Pengingat: Kimi Moderato ditagih besok (27 Sep). Cek dulu apakah masih mau dilanjutkan.',
  '2026-10-03-codex-billing': 'Pengingat: ChatGPT Plus (Codex) diperpanjang besok (4 Okt).',
  '2026-10-10-claude-expiry': 'Pengingat: akun Claude adityainofficial berakhir 12 Okt. Putuskan langkah selanjutnya (perpanjang / ganti akun / lainnya) sebelum itu.',
};

const key = process.argv[2];
const text = REMINDERS[key];
if (!text) { console.error(`ops/send-reminder.mjs: key tidak dikenal: ${key}`); process.exit(2); }
const r = await sendMessage(text, { allowTechnical: true });
console.log(JSON.stringify({ key, sent: r.sent, reason: r.sent ? null : (r.reason || r.hint || r.networkErrorMessage) }));
process.exit(r.sent ? 0 : 1);
