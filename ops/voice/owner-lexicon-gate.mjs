// ops-watcher/owner-lexicon-gate.mjs
// Pure lexicon gate: checks owner-facing text for forbidden technical jargon.
// PRD v3 §5.3 — plain-language lexicon gate.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dirname, join } from 'node:path';

const DEFAULT_LEXICON_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'persona', 'lexicon.json');
const DEFAULT_REGISTER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'persona', 'register.yaml');

let _cached = null;

function loadLexicon(path) {
  if (_cached && !path) return _cached;
  const raw = JSON.parse(readFileSync(path || DEFAULT_LEXICON_PATH, 'utf8'));
  const entries = Array.isArray(raw) ? raw : (raw.forbidden || []);
  _cached = entries.map(e => {
    const pattern = e.pattern || (typeof e === 'string' ? e : '');
    return {
      token: e.token || pattern,
      pattern: new RegExp(pattern, 'gi'),
      say: e.say || ''
    };
  });
  return _cached;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadRegisterEntries() {
  let raw = '';
  try { raw = readFileSync(DEFAULT_REGISTER_PATH, 'utf8'); } catch { return []; }
  const say = {
    tentu: 'langsung jawab tanpa filler',
    'dengan senang hati': 'langsung jawab tanpa filler',
    'jangan ragu': 'sebutkan tindakan berikutnya',
    'mari kita': 'gunakan kalimat aktif',
    sangat: 'hapus penguat yang tidak perlu',
    'semoga membantu': 'hapus penutup AI',
    'silakan hubungi': 'sebutkan kanal atau tindakan jelas',
    Sir: 'Bapak',
    'Done:': 'Selesai:',
    'Waiting on you': 'Menunggu Bapak',
    'Stuck:': 'Macet:',
    'Good morning': 'Selamat pagi',
  };
  const entries = [];
  let section = '';
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    const h = /^([A-Za-z0-9_-]+):\s*$/.exec(t);
    if (h) { section = h[1]; continue; }
    const m = /^-\s*(.+?)\s*$/.exec(t);
    if (!m || (section !== 'forbidden_ai_fillers' && section !== 'forbidden_english_leftovers')) continue;
    const phrase = m[1].replace(/^['"]|['"]$/g, '');
    // Whole-word match: "Sir" must not reject "kasir", "sangat" must not
    // reject "sangatlah"-free text like "pemasangan" (v5 fix, 2026-09-14).
    const word = /^[\p{L}\p{N}]/u.test(phrase) && /[\p{L}\p{N}]$/u.test(phrase);
    const src = word ? `(?<![\\p{L}\\p{N}])${escapeRe(phrase)}(?![\\p{L}\\p{N}])` : escapeRe(phrase);
    entries.push({ token: phrase, pattern: new RegExp(src, 'giu'), say: say[phrase] || 'ganti dengan Bahasa Indonesia formal', isEnglish: section === 'forbidden_english_leftovers' });
  }
  return entries;
}

/**
 * Check owner-facing text for forbidden technical jargon.
 * @param {string} text  The text to check.
 * @param {{ lexicon?: Array }} opts  Optional lexicon override (for tests).
 * @returns {{ ok: boolean, hits: Array<{token:string, say:string, index:number, match:string}> }}
 */
export function checkOwnerText(text, { lexicon, channel } = {}) {
  const entries = lexicon || [...loadLexicon(), ...loadRegisterEntries()];
  const allowDecisionIssueRef = /^(Ditutup atas keputusan\s+KOL-\d+\s+\([^)]+\):|\[DECISION EXECUTED key=[^\]]+\])/.test(String(text || ""));
  const hits = [];
  for (const e of entries) {
    // English entries are allowed on the spoken channel (JARVIS addresses the owner as "Sir")
    if (channel === 'spoken' && e.isEnglish) continue;
    // Reset lastIndex for global regex
    e.pattern.lastIndex = 0;
    const m = e.pattern.exec(text);
    if (m) {
      if (allowDecisionIssueRef && e.token === "KOL-\\d+") continue;
      hits.push({ token: e.token, say: e.say, index: m.index, match: m[0] });
    }
  }
  return { ok: hits.length === 0, hits };
}

/**
 * Build a one-line hint from hits: "pm2 → the engine; KOL-248 → the task"
 * @param {Array<{token:string, say:string}>} hits
 * @returns {string}
 */
export function rewriteHint(hits) {
  if (!hits || !hits.length) return '';
  return hits.map(h => `${h.match || h.token} → ${h.say}`).join('; ');
}

// CLI: node ops-watcher/owner-lexicon-gate.mjs "<text>"
// Exit 1 on hits, exit 0 on clean text.
// Only when THIS file is the entry point. Guarding on process.argv[2] alone made
// every importer (telegram-client, department-dispatch, heartbeat steps run
// with --once) print OK and exit 0 before doing anything - a silent no-op
// regression on 2026-09-13.
const isEntry = (() => { try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isEntry && process.argv[2]) {
  const text = process.argv.slice(2).join(' ');
  const { ok, hits } = checkOwnerText(text);
  if (!ok) {
    console.error(rewriteHint(hits));
    process.exit(1);
  } else {
    console.log('OK');
    process.exit(0);
  }
}
