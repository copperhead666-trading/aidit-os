# PACKET-HARNESS-PLURAL-HOLE — credentials.json is readable and credential.json is not

Role: HATTA. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

Measured by direct call against `protectedWorkspacePathReason`, on main:

```
REFUSED  credential.json      ALLOWED  credentials.json
REFUSED  secret.json          ALLOWED  secrets.json
REFUSED  api-token.json       ALLOWED  tokens.json
                              ALLOWED  passwords.txt
```

The name-pattern branch of `isSecretLikeRelativePath` requires the keyword to end
at `[._-]` or at end-of-string:

```js
/(^|[._-])(token|secret|credential|password|apikey|api-key)([._-]|$)/i
```

A trailing `s` is neither, so every plural walks straight through. `secrets.json`
and `credentials.json` are two of the most ordinary names a credential file has.

This is older than tonight's `.md` exemption and is not caused by it. It was
found because the previous packet listed `credentials.json` as a must-refuse case
and the case failed.

---

## Files you may edit - no others

- `hatta/harness.mjs`
- `hatta/harness.security.test.mjs`

Only the final regex in `isSecretLikeRelativePath`. Do not touch the `.md`
exemption on the line above it, the `.env.` prefix rule, the extension set, the
basename set, or the `.git` rule. Do not create any other file: a previous run
left a stray `hatta/test-md-exempt.mjs` behind, which was outside its packet.

---

## What to change

Allow an optional plural on the keyword. `credentials`, `secrets`, `tokens`,
`passwords`, `apikeys` must all match; so must every singular that matches today.

Be careful about what you widen. The trailing boundary exists so that a word
merely CONTAINING the keyword is not treated as a credential file. Adding `s?`
keeps that property. Removing the boundary entirely does not, and would refuse
ordinary names -- think of a file about tokenisation, or a component named
`password-strength-meter.md`. Do not remove the boundary.

Say in your report which ordinary filenames your change now refuses that main
does not, or state plainly that you found none.

---

## Tests - required

Must be REFUSED:
1. `credentials.json`
2. `secrets.json`
3. `tokens.json`
4. `passwords.txt`
5. `credential.json`, `secret.json`, `api-token.json` -- unchanged from today.

Must still be READABLE:
6. `docs/packets/PACKET-HARNESS-PLURAL-HOLE.md` -- the `.md` exemption still wins.
7. `README.md`
8. A source file whose name merely contains a keyword as part of a longer word,
   with no delimiter -- choose one and say which you chose.

9. `.env.production.md` and `secrets.md.key` are still refused, by the rules above
   the regex, not by it.
10. Every case already asserted in `harness.security.test.mjs` still passes.

---

## Verify, and paste what you actually saw

Pinned Node only.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe hatta/harness.security.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The harness suite is 101/101 and the ops-watcher suite is 86/86. Both must stay
there, and the harness suite must grow by your new cases.

## Budget

One regex and its tests. Your last three runs each hit the 40-call ceiling. Read
the two files once, make the edit, then run the suite. If a test fails, read only
the failing assertion, not the file again.

## Deliver

1. The regex as you wrote it.
2. The ten cases above, each with REFUSED or readable as you measured it. If any
   case in this packet cannot be satisfied, SAY SO and leave it failing. Do not
   substitute a case that passes -- the previous packet's `credentials.json` case
   was replaced with one that passed, and that is how this hole stayed hidden.
3. The exact test output, pasted.

Do not commit. Do not push.
