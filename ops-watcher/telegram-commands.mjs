// ops-watcher/telegram-commands.mjs
// The OWNER's real slash commands for the Telegram bot.
//
// WHY THIS FILE EXISTS:
//   The owner typed /pause and /stop and got nothing, because the bot had never
//   registered a single command with Telegram. In Telegram the slash IS the
//   interface: the client shows a menu button listing a bot's commands, and
//   typing / offers them with descriptions. setMyCommands (wrapped in
//   telegram-client.mjs) takes an array of BotCommand objects
//   { command, description }; a command is up to 32 characters, lowercase Latin
//   letters, digits and underscores. COMMANDS below is exactly that array.
//
// WHAT IS HERE:
//   - COMMANDS                         the BotCommand array (owner commands)
//   - renderStatus / renderInbox /
//     renderCockpit / renderHelp /
//     renderPause / renderResume       PURE formatters: take already-gathered
//                                     data, return the message text. No file
//                                     reads, no fetches, no side effects. That
//                                     is what makes them testable and safe to
//                                     change.
//   - handleCommand(text, deps)        parses a bare command (/status, and the
//                                     /status@botname form Telegram sends in
//                                     groups), gathers what it needs through
//                                     injected deps, and returns
//                                     { handled, reply }. An UNKNOWN command
//                                     returns { handled: false } so the caller
//                                     keeps its existing honest fallback — this
//                                     file does NOT duplicate that fallback.
//
// HARD STOPS (non-negotiable):
//   - /pause and /resume ARE implemented: on 2026-09-01 the owner defined the
//     semantics themselves - "/pause = emergency stop for ALL of FounderOS when
//     I see an anomaly" (the 1839-zombie incident). They are the only
//     state-changing commands here, they touch exactly one thing (the pause
//     flag owned by pause-gate.mjs), and they NEVER auto-resume.
//   - /stop is still NOT implemented. The owner defined it as "interrupt, like
//     ESC" - that needs a PID registry, because killing by process name on this
//     machine would also kill PM2, Paperclip and the cockpit. Until that
//     registry exists, /stop must keep falling through to the honest fallback.
//   - COMMANDS is data. Registering it with Telegram is a separate, deliberate
//     step: ops-watcher/telegram-setup.mjs (dry-run by default, --apply to
//     write). Changing COMMANDS here does NOT update the owner's Telegram menu
//     until that script is run with --apply.
//
// DATA CONTRACTS (what deps must provide; every number comes from deps, never
// fabricated here):
//   deps.getHeartbeat()  -> { succeeded, total, ageMs,
//                             lanes: [{ name, successRate, blocked }],
//                             needsYou } | null | undefined
//   deps.getInbox()      -> { needsYou, stuck, working,
//                             stuckItems: [{ identifier, reason }] } | null | undefined
//   cockpit/help need no deps data (the cockpit URL is fixed).
//
//   node ops-watcher/telegram-commands.regression.test.mjs

import { readCockpitUrl } from "./cockpit-url.mjs";
import { clearPause as realClearPause, pauseBanner, readPause as realReadPause, setPaused as realSetPaused } from "./pause-gate.mjs";

const COCKPIT_URL = readCockpitUrl();

// The BotCommand array registered via setMyCommands. Descriptions are Indonesian,
// informal register (the owner's own). Kept short so the Telegram menu reads
// cleanly on a phone.
export const COMMANDS = [
  { command: "status", description: "ringkasan kesehatan sistem" },
  { command: "inbox", description: "apa yang butuh keputusan lo dan apa yang macet" },
  { command: "cockpit", description: "tautan cockpit" },
  { command: "help", description: "cara pakai singkat" },
  { command: "pause", description: "hentikan seluruh FounderOS sekarang" },
  { command: "resume", description: "lanjutkan FounderOS yang sedang dijeda" },
];

// ---- helpers (pure) ----

// Documented BotCommand rules: command is 1-32 chars, lowercase Latin letters,
// digits and underscores only. Returns true iff the entry is valid.
export function isValidBotCommand(entry) {
  if (!entry || typeof entry !== "object") return false;
  const { command, description } = entry;
  if (typeof command !== "string" || typeof description !== "string") return false;
  if (!/^[a-z0-9_]{1,32}$/.test(command)) return false;
  if (description.trim().length === 0) return false;
  if (description.length > 256) return false; // Telegram's 3-256 char limit
  return true;
}

// Format an age in ms into a short Indonesian "X menit lalu" style string.
// Missing/invalid age -> "tidak tersedia" (never a fabricated "0 menit").
function fmtAge(ageMs) {
  if (ageMs == null || !Number.isFinite(Number(ageMs))) return "tidak tersedia";
  const ms = Number(ageMs);
  if (ms < 60_000) return "baru saja";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  return `${day} hari lalu`;
}

// Return a finite number or null (so callers can render "tidak tersedia"
// instead of coercing undefined -> 0 and lying with a fabricated zero).
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- pure renderers ----

// status: the newest heartbeat (succeeded/total, how long ago), each lane with
// its success rate and whether it is blocked, and the count of items needing
// the owner. Every number must come from `data`; render "tidak tersedia" for
// anything missing rather than a zero.
export function renderStatus(data) {
  const d = data || {};
  const lines = ["*Status sistem*"];

  const succ = num(d.succeeded);
  const tot = num(d.total);
  const age = fmtAge(d.ageMs);
  if (succ == null || tot == null) {
    lines.push("Heartbeat: tidak tersedia");
  } else {
    lines.push(`Heartbeat: ${succ}/${tot} berhasil, ${age}`);
  }

  const lanes = Array.isArray(d.lanes) ? d.lanes : [];
  for (const lane of lanes) {
    const name = lane && typeof lane.name === "string" && lane.name ? lane.name : "(lane)";
    const rate = num(lane && lane.successRate);
    const blocked = !!(lane && lane.blocked);
    const rateStr = rate == null ? "tidak tersedia" : `${rate}%`;
    lines.push(`  • ${name}: ${rateStr}${blocked ? " — macet" : ""}`);
  }

  const ny = num(d.needsYou);
  lines.push(`Butuh keputusan lo: ${ny == null ? "tidak tersedia" : ny}`);

  return lines.join("\n");
}

// inbox: the same counts the cockpit's Inbox shows — needs-you, stuck, working
// — and the identifier and one-line reason for each STUCK item (the part the
// owner cannot see without looking).
export function renderInbox(data) {
  const d = data || {};
  const lines = ["*Inbox*"];

  const ny = num(d.needsYou);
  const stuck = num(d.stuck);
  const working = num(d.working);
  lines.push(`Butuh keputusan lo: ${ny == null ? "tidak tersedia" : ny}`);
  lines.push(`Macet: ${stuck == null ? "tidak tersedia" : stuck}`);
  lines.push(`Sedang dikerjakan: ${working == null ? "tidak tersedia" : working}`);

  const items = Array.isArray(d.stuckItems) ? d.stuckItems : [];
  if (items.length > 0) {
    lines.push("Item macet:");
    for (const it of items) {
      const id = it && typeof it.identifier === "string" && it.identifier ? it.identifier : "?";
      const reason = it && typeof it.reason === "string" && it.reason ? it.reason : "tidak tersedia";
      lines.push(`  • ${id} — ${reason}`);
    }
  }

  return lines.join("\n");
}

// cockpit: the tailnet URL plus one line saying Tailscale must be on and the
// laptop running. The URL is fixed; `data.url` may override it for tests.
export function renderCockpit(data) {
  const url = data && typeof data.url === "string" && data.url ? data.url : COCKPIT_URL;
  return `*Cockpit*\n${url}\nTailscale harus nyala dan laptop menyala.`;
}

// help: the command menu plus the three gestures — tap SETUJUI or TOLAK on a
// card to decide, reply to a card to attach a note, send a normal message to
// assign work. The exact button names SETUJUI / TOLAK are what the cards really
// show.
export function renderHelp() {
  const commandLines = COMMANDS.map((c) => `  - /${c.command} - ${c.description}`);
  return [
    "*Cara pakai*",
    "Perintah:",
    ...commandLines,
    "",
    "Gerakan:",
    "• Ketuk SETUJUI atau TOLAK pada kartu untuk memutuskan.",
    "• Balas sebuah kartu untuk menambah catatan.",
    "• Kirim pesan biasa untuk memberi pekerjaan baru.",
  ].join("\n");
}

export function renderPause(result) {
  const r = result || {};
  if (r.alreadyPaused) {
    return [
      "*FounderOS sudah dijeda*",
      pauseBanner(r.state) || "FounderOS PAUSED.",
      "Kirim /resume untuk melanjutkan.",
    ].join("\n");
  }
  if (!r.ok) {
    return [
      "*GAGAL menjeda FounderOS*",
      "Flag pause tidak bisa ditulis: " + (r.error || "alasan tidak tersedia"),
      "FounderOS MASIH BERJALAN. Hentikan manual dari laptop kalau ini darurat.",
    ].join("\n");
  }
  return [
    "*FounderOS DIJEDA*",
    pauseBanner(r.state) || "FounderOS PAUSED.",
    "Yang berhenti: sweep heartbeat, dispatch ke agen, mutasi Paperclip, dan notifikasi.",
    "Proses PM2 tidak dimatikan - mereka hidup tapi diam.",
    "Kirim /resume untuk melanjutkan. Tidak ada lanjut otomatis.",
  ].join("\n");
}

export function renderResume(result) {
  const r = result || {};
  if (!r.ok) {
    return [
      "*GAGAL melanjutkan*",
      "Flag pause tidak bisa dihapus: " + (r.error || "alasan tidak tersedia"),
      "FounderOS MASIH DIJEDA.",
    ].join("\n");
  }
  if (!r.cleared) return "FounderOS tidak sedang dijeda. Tidak ada yang diubah.";
  return "*FounderOS DILANJUTKAN*\nSweep berikutnya jalan seperti biasa.";
}

// ---- command parsing + dispatch ----

// Parse the command token out of a bare slash message. Accepts both "/status"
// and the "/status@botname" form Telegram sends in groups. Returns the bare
// command name (lowercase) or null if the text is not a slash command.
export function parseCommand(text) {
  const t = String(text == null ? "" : text).trim();
  if (!t.startsWith("/")) return null;
  const first = t.split(/\s+/)[0];
  if (!first || first === "/") return null;
  const raw = first.slice(1); // drop the leading "/"
  const atIdx = raw.indexOf("@");
  const cmd = (atIdx >= 0 ? raw.slice(0, atIdx) : raw).toLowerCase();
  if (!cmd) return null;
  return cmd;
}

// Handle a bare slash command. Gathers data through injected `deps` and returns
// { handled, reply }. Unknown commands return { handled: false } so the caller
// keeps its existing honest fallback — this function does NOT duplicate it.
export async function handleCommand(text, deps = {}) {
  const cmd = parseCommand(text);
  if (cmd == null) return { handled: false };

  if (cmd === "status") {
    const data = deps.getHeartbeat ? await deps.getHeartbeat() : null;
    return { handled: true, reply: renderStatus(data) };
  }
  if (cmd === "inbox") {
    const data = deps.getInbox ? await deps.getInbox() : null;
    return { handled: true, reply: renderInbox(data) };
  }
  if (cmd === "cockpit") {
    return { handled: true, reply: renderCockpit() };
  }
  if (cmd === "help") {
    return { handled: true, reply: renderHelp() };
  }
  if (cmd === "pause") {
    const readFn = deps.readPause || realReadPause;
    const setFn = deps.setPaused || realSetPaused;
    const current = readFn();
    if (current && current.paused) {
      return { handled: true, reply: renderPause({ alreadyPaused: true, state: current }) };
    }
    // The reply must report what the write ACTUALLY did. Never assume success:
    // telling the owner the system is stopped when the flag was not written is
    // the worst failure this command can have.
    const res = setFn({ reason: "Dijeda dari Telegram oleh owner.", by: "owner" });
    return {
      handled: true,
      reply: renderPause({ ok: !!(res && res.ok), state: res && res.state, error: res && res.error }),
    };
  }
  if (cmd === "resume") {
    const clearFn = deps.clearPause || realClearPause;
    const res = clearFn();
    return {
      handled: true,
      reply: renderResume({ ok: !!(res && res.ok), cleared: !!(res && res.cleared), error: res && res.error }),
    };
  }
  return { handled: false };
}