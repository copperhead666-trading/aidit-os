# PACKET-STEWARD-LITERAL-SHAPES — the credential check is wrong in both directions

Role: HATTA. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

`checkSecretShapedLiterals` in `ops-watcher/merge-steward.mjs` decides whether a
lane diff may be merged. Measured against real lines, it is wrong in both
directions at once.

Flags a git revision as a credential -- this is KOL-92 and KOL-94:

```
FLAG  +const base = "ad9b8b3f2c1e4d5a6b7c8d9e0f1a2b3c4d5e6f70";
```

Passes two real secrets:

```
pass  +TELEGRAM_TOKEN=1234567890abcdefghijklmnopqrstuvwxyzABCDEF
pass  +API_KEY=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789
```

The miss and the false alarm have different causes and both must be fixed.

**The miss.** `assignedSecretName` opens with `\b(token|secret|key|password)\b`.
`\b` is a boundary between a word character and a non-word character, and `_` is
a word character. So `\btoken\b` never matches inside `TELEGRAM_TOKEN`, and
`\bkey\b` never matches inside `apiKey`. Those are the two ways a secret is
actually named in this repository. The other two patterns do not save it:
`longLiteral` requires quotes and an env line has none, and `prefixed` only
knows `ghp_`, `sk-`, `pcp_`.

A check that reports "no secret shaped literals found" over a line containing a
live Telegram token is worse than no check, because a reader trusts it.

**The false alarm.** `longLiteral` matches any quoted run of 32 or more hex
characters. A git sha is 40 hex characters. This repository writes shas into
source, tests and fixtures constantly, so the steward blocks its own ordinary
work.

---

## Files you may edit - no others

- `ops-watcher/merge-steward.mjs`
- `ops-watcher/merge-steward.regression.test.mjs`

---

## What to change

Only `checkSecretShapedLiterals` and its tests. Leave every other check alone.

### 1. Name matching must survive `_` and camelCase

Replace the `\b`-delimited name group with matching that finds the keyword
inside an identifier: `TELEGRAM_TOKEN`, `apiKey`, `db_password`,
`SUPABASE_SERVICE_KEY` must all match. Keep it case-insensitive.

Do not simply delete the boundaries and match the bare substring everywhere --
that turns every line containing the word "key" into a candidate. The keyword
must still be part of the identifier being assigned, immediately left of the
assignment.

### 2. The value may be unquoted

An env-style line has no quotes: `NAME=value`, no spaces. Accept an unquoted
value as well as a quoted one. Accept both `=` and `:` as the assignment, since
YAML and JSON configuration use `:`.

### 3. A git revision is not a credential

A run of hex characters whose length is exactly a git object id (40 for sha-1,
64 for sha-256) or an abbreviation of one (7 to 12 hex) is a revision, not a
secret -- **unless** the line also carries a secret-shaped name, in which case
rule 1 flags it and that must still win.

Be precise about "exactly". A 40-character hex string is a sha. A 41-character
one is not, and a 48-character one is not. Length-anchored matching is the point;
do not exempt "hex, roughly that long".

Note that hex is a subset of `[A-Za-z0-9+/=]`, so the two branches of
`longLiteral` overlap. Work out which branch a 40-hex literal reaches before
changing either, and say in your report what you found.

### 4. Comment lines

The existing loop skips lines starting `//`, `/*`, `*`, `#`. Leave that as it
is. Do not widen it.

---

## Tests - required

Every one of these is a line as it would appear in a diff, leading `+` included.

Must FLAG:
1. `+TELEGRAM_TOKEN=1234567890abcdefghijklmnopqrstuvwxyzABCDEF`
2. `+API_KEY=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789`
3. `+const apiKey = "pcp_abcdefghijklmnopqrstuvwxyz012345";`
4. `+  db_password: "s3cr3ts3cr3ts3cr3ts3cr3ts3cr3t99";`
5. `+GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz01`
6. `+const SESSION_SECRET = "ad9b8b3f2c1e4d5a6b7c8d9e0f1a2b3c4d5e6f70";`
   -- 40 hex, but named a secret. Rule 1 beats rule 3.

Must PASS:
7. `+const base = "ad9b8b3f2c1e4d5a6b7c8d9e0f1a2b3c4d5e6f70";`
8. `+  const short = "8abe558";`
9. `+expect(commit).toBe("ad9b8b3f2c1e4d5a6b7c8d9e0f1a2b3c4d5e6f70");`
10. `+// TELEGRAM_TOKEN=1234567890abcdefghijklmnopqrstuvwxyzABCDEF` -- a comment.
11. A line with the word `key` in prose and no assignment.

12. Every other exported check in the file behaves exactly as it does now. Do
    not rewrite their tests; just confirm the file's existing cases still pass.

---

## Verify, and paste what you actually saw

Pinned Node only. `--only` filters on the BASE FILENAME.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/merge-steward.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The suite is 86/86 and must stay there.

**The suite is not the whole proof.** Run the steward over a real lane diff and
paste its `secret-shaped-literals` line:

```
node ops-watcher/merge-steward.mjs --lane sjahrir --no-suite
```

## Budget

One function and its tests. If the budget runs short, land rules 1 and 2 -- the
miss is the security half and matters more than the false alarm -- say plainly
that rule 3 is not done, and stop.

## Deliver

1. The eleven cases above, each with FLAG or pass as you measured it.
2. The exact test output, pasted.
3. What you found about the two overlapping branches of `longLiteral`.
4. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
