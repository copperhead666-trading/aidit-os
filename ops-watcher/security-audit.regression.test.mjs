// ops-watcher/security-audit.regression.test.mjs
// Unit tests for the PURE secret-scanning logic exported from
// ops-watcher/security-audit.mjs (scanTextForSecrets / classifyHit). The rest of
// the audit script is I/O + judgment calls against live files, so it is not
// unit-tested here — it is exercised end-to-end by running
// `node ops-watcher/security-audit.mjs` directly.
//
// IMPORTANT: this file deliberately contains NO real secrets. Every token-shaped
// value used as a "REAL-classification" probe is built by array-concatenation so
// that no contiguous token-shaped string appears in THIS source file (the regex
// cannot match across `" + "`). The only literal token-shaped strings present
// are the KNOWN_FAKES, which classify as FAKE. This keeps the audit from
// flagging its own test file as a REAL finding — and the final self-scan test
// below enforces that invariant going forward.
//
//   node ops-watcher/security-audit.regression.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scanTextForSecrets, classifyHit, redactSecretText } from "./security-audit.mjs";

const __filename = fileURLToPath(import.meta.url);

let passed = 0;
let failed = 0;
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, e) { console.log(`FAIL: ${name}`); if (e) console.log(`  ${e && e.stack ? e.stack : e}`); failed++; }
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e); } }

// Synthetic, non-real token-shaped values assembled at runtime (no contiguous
// match in source). Used to exercise REAL classification without embedding any
// real credential in this tracked test file.
const synthTelegram = ["7777777777", ":", "ZZZsynthetic_real_classification_probe_xxxxxxxxx"].join("");
const synthGithub = ["github_pat_", "AAAA0synthetic0test0token0xxxxxxxxxxxxxxxx"].join("");
const synthNotion = ["ntn_", "AAAA0synthetic0test0token0xxxxxxxxxxxx"].join("");
const synthCloudflare = ["cfut_", "AAAA0synthetic0test0token0xxxxxxxxxxxxxxxxxx"].join("");
const synthPcp = ["pcp_", "aaaa0synthetic0test0key0xxxxxxxxxxxxxxxxxxxxxxxx"].join("");

// ---- classifyHit ----
check("classifyHit: known fake telegram token -> FAKE", () => {
  const r = classifyHit("999999999:AAAtest_fake_token_for_selftest_only_xx", "telegram-bot-token", "// fake token", "");
  assert.equal(r.verdict, "FAKE");
});

check("classifyHit: synthetic telegram token, no fake context -> REAL", () => {
  const r = classifyHit(synthTelegram, "telegram-bot-token", "TOKEN=" + synthTelegram, ".env.local");
  assert.equal(r.verdict, "REAL");
});

check("classifyHit: telegram example in a comment -> FAKE (known example)", () => {
  const r = classifyHit("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", "telegram-bot-token", '// tokens look like "123456789:AAH..."', "");
  assert.equal(r.verdict, "FAKE");
});

check("classifyHit: pcp_ in a .key file -> REAL_BUT_IGNORED", () => {
  const r = classifyHit(synthPcp, "paperclip-pcp", "pcp_aaaa...", "ops-watcher/gibran-api.key");
  assert.equal(r.verdict, "REAL_BUT_IGNORED");
});

check("classifyHit: pcp_ outside a .key file -> REAL", () => {
  const r = classifyHit(synthPcp, "paperclip-pcp", "key=" + synthPcp, "config/something.json");
  assert.equal(r.verdict, "REAL");
});

check("classifyHit: JWT that decodes to JSON session blob -> INFO_NOT_SECRET", () => {
  // eyJuYW1lIjoieH0= decodes to {"name":"x"}  -> starts with '{'
  const jwt = "eyJuYW1lIjoieH0=.sigpart";
  const r = classifyHit(jwt, "jwt", '"runtimeSessionName": "acpx:v2:eyJu...', "fresh-restore.sql");
  assert.equal(r.verdict, "INFO_NOT_SECRET");
});

check("classifyHit: signed Supabase-style JWT also decodes to JSON -> INFO (honest classifier limitation; real .env keys are caught by .gitignore coverage, not by content classification)", () => {
  // A Supabase service_role JWT's header decodes to {"alg":"HS256","typ":"JWT"}.
  // The classifier cannot distinguish a real signed key from a session blob by
  // content alone — documented here so it is not a silent gap. The audit's
  // defense-in-depth for .env files is the .gitignore .env.* rule, verified in
  // check [2], not this content classifier.
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.sig";
  const r = classifyHit(jwt, "jwt", "SJS_SUPABASE_SERVICE_ROLE_KEY=" + jwt, ".env.local");
  assert.equal(r.verdict, "INFO_NOT_SECRET");
});

// ---- scanTextForSecrets ----
check("scanTextForSecrets: finds the known fake telegram tokens", () => {
  const src = [
    '// Telegram bot tokens look like "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"',
    'const FAKE = "999999999:AAAtest_fake_token_for_selftest_only_xx";',
  ].join("\n");
  const hits = scanTextForSecrets(src, "ops-watcher/telegram-client.mjs");
  assert.equal(hits.length, 2);
  assert.equal(hits.every((h) => h.verdict === "FAKE"), true);
});

check("scanTextForSecrets: flags a synthetic real-shaped telegram line as REAL", () => {
  const src = "TELEGRAM_BOT_TOKEN_AHMAD=" + synthTelegram;
  const hits = scanTextForSecrets(src, ".env.local");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].verdict, "REAL");
  assert.equal(hits[0].pattern, "telegram-bot-token");
});

check("scanTextForSecrets: detects github_pat, notion ntn_, cloudflare cfut_ prefixes", () => {
  const src = [
    "GITHUB_TOKEN=" + synthGithub,
    "NOTION_API_KEY=" + synthNotion,
    "CLOUDFLARE_API_TOKEN=" + synthCloudflare,
  ].join("\n");
  const hits = scanTextForSecrets(src, ".env.local");
  const ids = hits.map((h) => h.pattern).sort();
  assert.deepEqual(ids, ["cloudflare-cfut", "github-pat", "notion-ntn"]);
  assert.ok(hits.every((h) => h.verdict === "REAL"));
});

check("scanTextForSecrets: empty / clean input -> no hits", () => {
  assert.equal(scanTextForSecrets("", "x").length, 0);
  assert.equal(scanTextForSecrets("just normal code with no secrets here", "x").length, 0);
});

check("scanTextForSecrets: line number is reported correctly", () => {
  const src = "line1\nline2\nFAKE=999999999:AAAtest_fake_token_for_selftest_only_xx\nline4";
  const hits = scanTextForSecrets(src, "x");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
});
check("redaction: REAL and REAL_BUT_IGNORED matches/previews never retain raw token text", () => {
  const src = "PAPERCLIP_KEY=" + synthPcp;
  const hits = scanTextForSecrets(src, "ops-watcher/gibran-api.key");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].verdict, "REAL_BUT_IGNORED");
  assert.ok(!hits[0].match.includes(synthPcp));
  assert.ok(!hits[0].linePreview.includes(synthPcp));
  assert.ok(redactSecretText("x " + synthTelegram + " y").includes("[REDACTED_SECRET:"));
});

check("scanTextForSecrets: this very test file scans to ZERO REAL findings (self-cleanliness)", () => {
  // Read this file's own source and scan it. The only token-shaped literals are
  // the KNOWN_FAKES (-> FAKE); every synthetic probe is concatenated so no
  // contiguous match exists. This guards against accidentally re-introducing a
  // real secret into the test file.
  const self = readFileSync(__filename, "utf8");
  const hits = scanTextForSecrets(self, __filename);
  const real = hits.filter((h) => h.verdict === "REAL");
  assert.equal(real.length, 0, `self-scan found REAL hits (real secret leaked into test file!): ${JSON.stringify(real)}`);
});

console.log("");
console.log(`SECURITY-AUDIT REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
