# PACKET-HARNESS-PATH-FILTER — a markdown file is not a credential store

Role: HATTA. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

You hit this yourself. Dispatched to carry out a packet, you reported:

```
read_file  {"path":"docs/packets/PACKET-STEWARD-SECRET-SHAPES.md"}
           Refused credential/secret-like path.
```

and correctly refused to guess the contents rather than route around the
guardrail. That was the right call and this packet exists because of it.

`isSecretLikeRelativePath` in `hatta/harness.mjs` ends with:

```js
return /(^|[._-])(token|secret|credential|password|apikey|api-key)([._-]|$)/i.test(base);
```

Matched against the basename, a hyphen counts as a delimiter, so any document
whose title happens to contain one of those words is refused. A packet
describing a credential-detection bug cannot be read by the lane assigned to fix
it.

The rule itself is sound and the other three checks above it are sound. Keep all
of them. The defect is only that a documentation file is treated as a possible
credential store, and a markdown file cannot be one: nothing in this system reads
a `.md` as configuration, and a token pasted into prose is a leak whether the
harness opens the file or not.

---

## Files you may edit - no others

- `hatta/harness.mjs`
- `hatta/harness.security.test.mjs`

Only `isSecretLikeRelativePath`. Do not touch `protectedWorkspacePathReason`,
the `.git` refusal, `PROTECTED_SECRET_BASENAMES`, `PROTECTED_SECRET_EXTENSIONS`,
the `.env.` prefix rule, or the package-mutation rule.

---

## What to change

Exempt documentation from the **name-pattern branch only**.

- The exemption applies to `.md` files, and to nothing else. Not `.txt`: this
  repository already treats `.txt` as risky, and `env.local..txt` appears in the
  harness's own ripgrep exclusion list.
- The exemption applies ONLY to the final regex. A file named `secrets.md.key`
  still has extension `.key` and must still be refused by
  `PROTECTED_SECRET_EXTENSIONS`. A basename in `PROTECTED_SECRET_BASENAMES` must
  still be refused whatever its extension. Order the checks so the exemption
  cannot reach past its own branch.
- `.env.something.md` must still be refused: the `.env.` prefix rule runs before
  the regex and stays authoritative.

Write the reason in a comment, in the style already used in this file: what the
rule protects and why the exemption does not weaken it.

---

## Tests - required

Must be READABLE (no refusal):
1. `docs/packets/PACKET-STEWARD-SECRET-SHAPES.md`
2. `docs/token-rotation-runbook.md`
3. `README.md`

Must still be REFUSED:
4. `.env.local`
5. `.env.production.md` -- the `.env.` prefix rule still wins.
6. `config/api-token.json`
7. `secrets.md.key` -- extension `.key`, not a markdown file.
8. `credentials.json`
9. Any basename in `PROTECTED_SECRET_BASENAMES`, whatever its extension.
10. A path containing `.git`, which is a different rule and must be untouched.

11. Every other case already asserted in `harness.security.test.mjs` still
    passes unchanged.

---

## Verify, and paste what you actually saw

Pinned Node only. `--only` filters on the BASE FILENAME.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe hatta/harness.security.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

Both suites must stay green. Report both counts.

## Budget

One function and its tests. Small.

## Deliver

1. The ten cases above, each with readable or refused as you measured it.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong -- including any path you
   found that the exemption opens up which this packet did not anticipate. Say so
   plainly if you find one; that matters more than finishing.

Do not commit. Do not push.
