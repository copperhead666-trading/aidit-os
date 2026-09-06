# PACKET-STEWARD-FALSE-ALARMS — a git revision is not a credential, and neither is a monkey

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

`checkSecretShapedLiterals` in `ops-watcher/merge-steward.mjs` decides whether a
lane diff may be merged. Its miss was closed earlier tonight -- it no longer
passes an unquoted `TELEGRAM_TOKEN=` line. What remains is the other direction:
it blocks merges it should not.

Two false alarms, measured against the exported function on main.

### 1. A git revision (this is KOL-92 and KOL-94)

```
FLAG  +const base = "ad9b8b3f2c1e4d5a6b7c8d9e0f1a2b3c4d5e6f70";
```

`longLiteral` matches any quoted run of 32 or more hex characters, and a git sha
is 40. This repository writes shas into source, tests and fixtures constantly, so
the steward blocks its own ordinary work.

### 2. A word that merely contains a keyword

```
FLAG  +const monkey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
FLAG  +keystone: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Closing the miss replaced `\b(token|secret|key|password)\b` with
`(\w*(?:token|secret|key|password)\w*)`. That finds the keyword inside
`TELEGRAM_TOKEN` and `apiKey`, which was the point -- and also inside `monkey`
and `keystone`, which was not. This is a regression introduced tonight and it was
named in the commit that introduced it rather than left to be discovered.

---

## Files you may edit - no others

- `ops-watcher/merge-steward.mjs`
- `ops-watcher/merge-steward.regression.test.mjs`

Only `checkSecretShapedLiterals`. Every other exported check stays as it is.

---

## What to change

### 1. Match the keyword as a segment of the identifier, not as a substring

An identifier is segmented by `_`, `-`, `.`, and by camelCase transitions. The
keyword must be one of those segments, or the whole identifier.

Must match: `TELEGRAM_TOKEN`, `apiKey`, `db_password`, `SUPABASE_SERVICE_KEY`,
`api-token`, `token`, `secretKey`.

Must not match: `monkey`, `keystone`, `tokenisation`, `passwordless`
(as a bare identifier being assigned -- `passwordless_token` still matches,
because `token` is a segment of it).

Work out the camelCase rule carefully: in `apiKey` the segment boundary is
between `i` and `K` with no delimiter present, so a purely delimiter-based split
will not find it.

### 2. A git revision is not a credential

A quoted run of hex whose length is exactly a git object id -- 40 for sha-1, 64
for sha-256 -- or a common abbreviation of one, 7 to 12 hex, is a revision.

**Unless the line also carries a secret-shaped name.** Rule 1 must still win:
`const SESSION_SECRET = "<40 hex>";` is a credential, not a revision.

Be precise about "exactly". A 40-character hex string is a sha. A 41-character
one is not, and a 48-character one is not. Length-anchored matching is the point;
do not exempt "hex, roughly that long".

Note that hex is a subset of `[A-Za-z0-9+/=]`, so `longLiteral`'s two branches
overlap. Work out which branch a 40-hex literal actually reaches before changing
either, and say in your report what you found.

---

## Tests - required

Must FLAG:
1. `+TELEGRAM_TOKEN=1234567890abcdefghijklmnopqrstuvwxyzABCDEF`
2. `+API_KEY=aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789`
3. `+  db_password: "s3cr3ts3cr3ts3cr3ts3cr3ts3cr3t99"`
4. `+const apiKey = "pcp_abcdefghijklmnopqrstuvwxyz012345";`
5. `+const SESSION_SECRET = "ad9b8b3f2c1e4d5a6b7c8d9e0f1a2b3c4d5e6f70";`
   -- 40 hex, but named a secret. Rule 1 beats rule 2.

Must PASS:
6. `+const base = "ad9b8b3f2c1e4d5a6b7c8d9e0f1a2b3c4d5e6f70";`
7. `+  const short = "8abe558";`
8. `+expect(commit).toBe("ad9b8b3f2c1e4d5a6b7c8d9e0f1a2b3c4d5e6f70");`
9. `+const monkey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";`
10. `+keystone: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`
11. `+// TELEGRAM_TOKEN=1234567890abcdefghijklmnopqrstuvwxyzABCDEF`
12. `+The key master said hello.`

13. Every case already asserted in `merge-steward.regression.test.mjs` still
    passes. It is 21 passed 0 failed today and must grow, not shrink.

If any case here cannot be satisfied, LEAVE IT FAILING and say so plainly. Do not
substitute a case that passes.

---

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/merge-steward.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

run-all-tests is 86/86 and must stay there.

## Budget

Write the code before writing prose about it. Two of your runs tonight had the
work finished and the suite green and were still cut off at the 480s wall while
explaining.

If the budget runs short, land rule 2 with tests 5 to 8, say plainly that rule 1
is not done, and stop. Rule 2 is KOL-92 and KOL-94 and closes two board items.

## Deliver

1. The regex or regexes as you wrote them.
2. The twelve cases above, each with FLAG or pass as you measured it.
3. What you found about the two overlapping branches of `longLiteral`.
4. The exact test output, pasted.

Do not commit. Do not push.
