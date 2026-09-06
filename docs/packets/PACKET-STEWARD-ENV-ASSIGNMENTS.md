# PACKET-STEWARD-ENV-ASSIGNMENTS — the steward passes a live token

Role: HATTA. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

One rule, one function, one reason. Read the two files once, make the edit, run
the suite.

---

## Why this exists

`checkSecretShapedLiterals` in `ops-watcher/merge-steward.mjs` decides whether a
lane diff may be merged. Measured against the real exported function:

```
pass  +TELEGRAM_TOKEN=1234567890abcdefghijklmnopqrstuvwxyzABCDEF
pass  +API_KEY=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789
```

The steward reports `no secret shaped literals found` over a line carrying a live
token, and a reader trusts it. That is worse than having no check.

The cause is in `assignedSecretName`:

```js
/\b(token|secret|key|password)\b[^=\n]{0,80}=\s*(["'`])?([A-Za-z0-9+/=]{32,}|...)/i
```

`\b` is a boundary between a word character and a non-word character, and `_` is
a word character. So `\btoken\b` never matches inside `TELEGRAM_TOKEN`, and
`\bkey\b` never matches inside `apiKey`. Those are the two ways a secret is
actually named in this repository.

The other two patterns do not save it. `longLiteral` requires quotes and an env
line has none; `prefixed` only knows `ghp_`, `sk-`, `pcp_`.

---

## Files you may edit - no others

- `ops-watcher/merge-steward.mjs`
- `ops-watcher/merge-steward.regression.test.mjs`

Only `checkSecretShapedLiterals`, and within it only `assignedSecretName`. Leave
`longLiteral` and `prefixed` exactly as they are. Leave every other exported
check alone.

---

## What to change

Two things, both inside that one regex.

1. **The name must be found inside an identifier.** `TELEGRAM_TOKEN`, `apiKey`,
   `db_password` and `SUPABASE_SERVICE_KEY` must all match. Case-insensitive.

   Do not simply drop the boundaries and match the bare substring anywhere: that
   turns every line containing the word "key" into a candidate. The keyword must
   still belong to the identifier being assigned, immediately left of the
   assignment.

2. **The value may be unquoted, and the assignment may be `:`.** An env line is
   `NAME=value` with no quotes. YAML and JSON use `:`. Accept quoted and
   unquoted, `=` and `:`.

---

## Tests - required

Each is a diff line, leading `+` included.

Must FLAG:
1. `+TELEGRAM_TOKEN=1234567890abcdefghijklmnopqrstuvwxyzABCDEF`
2. `+API_KEY=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789`
3. `+  db_password: "s3cr3ts3cr3ts3cr3ts3cr3ts3cr3t99"`
4. `+const apiKey = "pcp_abcdefghijklmnopqrstuvwxyz012345";`

Must PASS:
5. `+// TELEGRAM_TOKEN=1234567890abcdefghijklmnopqrstuvwxyzABCDEF` -- a comment.
6. A line with the word `key` in prose and no assignment.

7. Every case already asserted in `merge-steward.regression.test.mjs` still
   passes unchanged.

If any case here cannot be satisfied, LEAVE IT FAILING and say so. Do not
substitute a case that passes. A packet earlier tonight had its
`credentials.json` case quietly replaced with a passing one, and the hole it was
pointing at stayed open for hours.

---

## Known and NOT in scope

The same function flags a quoted 40-character git revision as a credential --
that is KOL-92 and KOL-94. Do not fix it here and do not let it distract you.
Fixing the miss is worth more than fixing the false alarm: one hides a token, the
other blocks a merge loudly.

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/merge-steward.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

run-all-tests is 86/86 and must stay there.

## Deliver

1. The regex as you wrote it.
2. The six cases above, each with FLAG or pass as you measured it.
3. The exact test output, pasted.

Do not commit. Do not push.
