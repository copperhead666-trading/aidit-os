// ops-watcher/cockpit-url.regression.test.mjs
// The cockpit address the owner is handed must be this machine's, and reading
// it must never be able to take the Telegram command surface down.
//
//   node ops-watcher/cockpit-url.regression.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import { readCockpitUrl } from "./cockpit-url.mjs";

let passed = 0;
let failed = 0;
const failures = [];
function ok(name) { console.log(`PASS: ${name}`); passed++; }
function bad(name, err) {
  console.log(`FAIL: ${name}`);
  if (err) console.log(String(err && err.stack ? err.stack : err).split("\n").map((l) => "       " + l).join("\n"));
  failures.push(name); failed++;
}

const MACHINE = JSON.parse(fs.readFileSync(new URL("../config/machine.json", import.meta.url), "utf8"));

// Two live paths handed the owner "https://asus-gray.tailc7b60e.ts.net/" after
// the ASUS went dark: the /cockpit reply and the Telegram menu button. Both are
// links he taps. A link that cannot open teaches him the system does not know
// where his own dashboard is.
function c1_urlComesFromMachineJson() {
  const name = "C1 the cockpit URL is this machine's public base, not a hardcoded host";
  try {
    const expected = MACHINE.cockpit.public_base.replace(/\/?$/, "/");
    assert.equal(readCockpitUrl(), expected);
    // telegram-setup.mjs is deliberately NOT imported: importing it runs its
    // dry-run main and prints the whole command menu into the suite output.
    // Read it as text instead and assert no tailnet host is typed into it.
    for (const file of ["telegram-setup.mjs", "telegram-commands.mjs"]) {
      const src = fs.readFileSync(new URL(file, import.meta.url), "utf8");
      assert.equal(src.includes(".ts.net"), false,
        `${file} must read the cockpit host from machine.json, not hardcode a tailnet hostname`);
      assert.ok(src.includes("readCockpitUrl("),
        `${file} must resolve the cockpit URL through readCockpitUrl`);
    }
    ok(name);
  } catch (err) { bad(name, err); }
}

function c2_missingOrBrokenFileDegradesToLocal() {
  const name = "C2 an unreadable or malformed machine.json degrades to the local base, never throws";
  try {
    assert.equal(readCockpitUrl({ readFile: () => { throw new Error("ENOENT"); } }), "http://127.0.0.1:4200/");
    assert.equal(readCockpitUrl({ readFile: () => "{not json" }), "http://127.0.0.1:4200/");
    assert.equal(readCockpitUrl({ readFile: () => "{}" }), "http://127.0.0.1:4200/");
    ok(name);
  } catch (err) { bad(name, err); }
}

function c3_localBaseUsedWhenNoPublicBase() {
  const name = "C3 a machine with no funnel falls back to its own local base, with a trailing slash";
  try {
    const json = JSON.stringify({ cockpit: { local_base: "http://127.0.0.1:9999" } });
    assert.equal(readCockpitUrl({ readFile: () => json }), "http://127.0.0.1:9999/");
    const withSlash = JSON.stringify({ cockpit: { public_base: "https://example.ts.net/" } });
    assert.equal(readCockpitUrl({ readFile: () => withSlash }), "https://example.ts.net/", "an existing slash is not doubled");
    ok(name);
  } catch (err) { bad(name, err); }
}

// A non-URL value is a configuration mistake, not an address. Handing it to the
// owner as a link would be the same failure in a new shape.
function c4_nonUrlValueIsRejected() {
  const name = "C4 a value that is not an http(s) URL is refused rather than handed over as a link";
  try {
    assert.equal(readCockpitUrl({ readFile: () => JSON.stringify({ cockpit: { public_base: "lenovo-black" } }) }), "http://127.0.0.1:4200/");
    ok(name);
  } catch (err) { bad(name, err); }
}

c1_urlComesFromMachineJson();
c2_missingOrBrokenFileDegradesToLocal();
c3_localBaseUsedWhenNoPublicBase();
c4_nonUrlValueIsRejected();

console.log("");
console.log(`COCKPIT-URL REGRESSION RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of failures) console.log(`  FAILED: ${f}`); process.exit(1); }
