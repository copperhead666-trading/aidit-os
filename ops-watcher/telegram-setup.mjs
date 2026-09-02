// ops-watcher/telegram-setup.mjs
// Register the OWNER bot slash command menu and Mini App menu button.
//
// Default mode is dry-run. The live bot is only changed when AHMAD runs:
//   node ops-watcher/telegram-setup.mjs --apply

import { COMMANDS } from "./telegram-commands.mjs";
import * as tg from "./telegram-client.mjs";

// Must match the `tailscale funnel` target so the Telegram Mini App URL and
// the published cockpit endpoint cannot drift silently.
export const COCKPIT_URL = "https://asus-gray.tailc7b60e.ts.net/";

export const MENU_BUTTON = Object.freeze({
  type: "web_app",
  text: "Cockpit",
  web_app: { url: COCKPIT_URL },
});

const TOKEN_SHAPED = /\b\d{8,12}:[A-Za-z0-9_-]{30,64}\b|\/bot\d{8,12}:[A-Za-z0-9_-]{30,64}\//g;

function safeText(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const redacted = typeof tg.redact === "function" ? tg.redact(raw) : raw;
  return redacted.replace(TOKEN_SHAPED, "[REDACTED_TOKEN]");
}

function printReport(lines) {
  const report = safeText(lines.join("\n"));
  if (TOKEN_SHAPED.test(report)) {
    console.error("LAPORAN DIBATALKAN: pola token bot terdeteksi setelah redaksi.");
    process.exitCode = 1;
    return;
  }
  console.log(report);
}

function resultOk(result) {
  return !!(result && (result.sent === true || result.ok === true));
}

function ownErrorText(result) {
  if (!result || typeof result !== "object") return "hasil kosong dari wrapper Telegram";
  if (typeof result.error === "string" && result.error) {
    try {
      const parsed = JSON.parse(result.error);
      if (parsed && typeof parsed.description === "string") return parsed.description;
    } catch {
      // The wrapper may already return Telegram's error as plain text.
    }
    return result.error;
  }
  if (typeof result.reason === "string" && result.reason) return result.reason;
  if (typeof result.networkErrorMessage === "string" && result.networkErrorMessage) {
    return result.networkErrorMessage;
  }
  return "tidak ada teks error dari API";
}

function appendCallReport(lines, name, result) {
  if (resultOk(result)) {
    lines.push(`${name}: SUKSES`);
    lines.push(`Return: ${safeText(result)}`);
    return true;
  }

  lines.push(`${name}: GAGAL`);
  lines.push(`Error: ${safeText(ownErrorText(result))}`);
  lines.push(`Return: ${safeText(result)}`);
  return false;
}

function appendTokenAssertion(lines) {
  lines.push("ASSERT: token bot tidak pernah dicetak, di-log, atau di-echo oleh script ini.");
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const lines = [];

  if (!apply) {
    lines.push("Mode: dry-run (tidak mengubah Telegram).");
    lines.push("WOULD CALL setMyCommands dengan COMMANDS:");
    lines.push(safeText(COMMANDS));
    lines.push("WOULD CALL setChatMenuButton dengan tombol Mini App:");
    lines.push(safeText(MENU_BUTTON));
    appendTokenAssertion(lines);
    printReport(lines);
    return;
  }

  lines.push("Mode: apply (mengubah Telegram).");

  if (typeof tg.setMyCommands !== "function" || typeof tg.setChatMenuButton !== "function") {
    lines.push(
      "BERHENTI: wrapper Telegram belum mengekspor setMyCommands dan setChatMenuButton lengkap.",
    );
    lines.push("setMyCommands: tidak dipanggil");
    lines.push("setChatMenuButton: tidak dipanggil");
    lines.push("Tidak ada registrasi setengah jalan yang dijalankan.");
    appendTokenAssertion(lines);
    printReport(lines);
    process.exitCode = 1;
    return;
  }

  const commandsResult = await tg.setMyCommands(COMMANDS);
  if (!appendCallReport(lines, "setMyCommands", commandsResult)) {
    lines.push("BERHENTI: setChatMenuButton tidak dipanggil karena setMyCommands gagal.");
    appendTokenAssertion(lines);
    printReport(lines);
    process.exitCode = 1;
    return;
  }

  const menuResult = await tg.setChatMenuButton(MENU_BUTTON);
  if (!appendCallReport(lines, "setChatMenuButton", menuResult)) {
    lines.push("BERHENTI: tombol Mini App belum berhasil didaftarkan.");
    appendTokenAssertion(lines);
    printReport(lines);
    process.exitCode = 1;
    return;
  }

  appendTokenAssertion(lines);
  printReport(lines);
}

main().catch((err) => {
  printReport([
    "telegram-setup: GAGAL tak terduga.",
    `Error: ${err && err.message ? err.message : String(err)}`,
    "ASSERT: token bot tidak pernah dicetak, di-log, atau di-echo oleh script ini.",
  ]);
  process.exitCode = 1;
});
