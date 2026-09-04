// ops-watcher/ahmad-notify.mjs
// Sends ONE free-form completion/status message straight to the OWNER's
// Telegram. This exists because ops-watcher/telegram-notify.mjs is scoped
// specifically to OWNER_REQUIRED decision requests (5 fixed buttons: APPROVE/
// REJECT/DETAILS/DEFER, a "[TELEGRAM SENT]" dedupe marker) and cannot send an
// arbitrary "AHMAD finished X" result — see its header comment. Headless
// AHMAD (ops-watcher/ahmad-dispatch.mjs's spawned `claude -p` session) needs a
// real way to put a completion message on the OWNER's phone (P0 mission
// acceptance criterion #6), so this thin wrapper around telegram-client.mjs's
// sendMessage is that mechanism — added to ahmad-mcp-server.mjs's
// ALLOWED_SCRIPTS so it is the only way headless AHMAD can reach Telegram.
//
// No buttons, no dedupe marker, no Paperclip read/write — this script does
// exactly one thing: relay free-form text to OWNER_CHAT_ID via the Telegram
// Bot API. Crash-proof (never throws): a send failure is reported and the
// process exits non-zero so the caller (headless AHMAD via run_command) can
// see the failure in its tool result and retry/report accordingly.
//
//   node ops-watcher/ahmad-notify.mjs "<message text>"

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { sendMessage } from "./telegram-client.mjs";

const require = createRequire(import.meta.url);
const loadEnvLocal = require("./load-env-local.cjs");

// Dependency-injected for offline testing (ahmad-notify.regression.test.mjs).
export async function runNotify(text, { sendMessageFn = sendMessage } = {}) {
  const trimmed = String(text == null ? "" : text).trim();
  if (!trimmed) return { sent: false, reason: "empty message" };
  return sendMessageFn(trimmed, {});
}

function parseMessage(argv) {
  return argv.slice(2).join(" ").trim();
}

async function main() {
  const text = parseMessage(process.argv);
  if (!text) {
    console.error('usage: node ops-watcher/ahmad-notify.mjs "<message text>"');
    process.exit(2);
  }
  loadEnvLocal();
  const r = await runNotify(text);
  if (r.sent) {
    console.log(`ahmad-notify: sent message_id=${r.result && r.result.message_id}`);
    process.exit(0);
  } else {
    const why = r.networkError
      ? `network error: ${r.networkErrorMessage}`
      : (r.reason || r.error || "unknown failure");
    console.error(`ahmad-notify: send FAILED (${why})`);
    process.exit(1);
  }
}

const isEntry = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main().catch((err) => {
    console.error("ahmad-notify fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
