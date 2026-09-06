# PACKET-VENDOR-IS-READ-ONLY — a reference tree nobody can edit

Role: lane executor. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

One rule, one function. Read the file once, make the edit, run the suite.

---

## Why this exists

`vendor/founderos-demo/` is a vendored copy of Bennett's FounderOS, kept so Aidit
OS can be compared against the code its benchmark came from. Its whole value is
that a diff against upstream stays readable. The moment a lane edits it, that
value is gone and nobody notices, because the tree still looks plausible.

Every adoption packet says in prose "do not edit anything under vendor/". Prose
is not a guard. Measured just now:

```
checkForbiddenPaths({ changedFiles: ["vendor/founderos-demo/lib/ledger.ts"] })  -> allowed
checkForbiddenPaths({ changedFiles: [".env.local"] })                           -> BLOCKED
checkForbiddenPaths({ changedFiles: ["ventures/caveman-trading-os/x.ts"] })     -> BLOCKED
```

`ventures/` is already protected for exactly this reason: it is someone else's
repository and a lane has no business writing there. `vendor/` is the same shape
of thing -- someone else's code, present to be read.

## Files you may edit - no others

- `ops-watcher/merge-steward.mjs`
- `ops-watcher/merge-steward.regression.test.mjs`

Only `checkForbiddenPaths`. Leave every other check alone, `checkSecretShapedLiterals`
included -- it was changed twice tonight and is where it should be.

## What to change

Add `vendor/` to the forbidden path set, alongside `ventures/`.

Match the shape of the existing `ventures/` rule rather than inventing a second
mechanism; find how that one is written before you write this one. If the two
end up expressed differently, say why in your report.

The refusal message should say what makes vendor different from a normal
directory: it is an unmodified upstream copy, and an edit there destroys the
comparison it exists for. A path refusal that only says "forbidden" teaches
nothing to the next reader.

## What NOT to do

- Do not block reading. Lanes must read `vendor/` freely; that is the point of
  vendoring it rather than gitignoring it. This is a check on CHANGED FILES in a
  diff, not on access.
- Do not add an override flag.
- Do not touch the `.env` or `ventures/` rules while you are in there.

## Tests - required

Must be BLOCKED:
1. `vendor/founderos-demo/lib/ledger.ts`
2. `vendor/founderos-demo/VENDORED.md` -- the provenance file is not an exception.
3. A new file created under `vendor/`, for example
   `vendor/founderos-demo/lib/our-additions.ts`.

Must still be ALLOWED:
4. `ops-watcher/routing.mjs`
5. `docs/adoption/A-orchestration.md`
6. A path that merely CONTAINS the word vendor without being under the directory,
   for example `ops-watcher/vendor-report.mjs`. Choose the exact string yourself
   and say which you chose -- a prefix rule and a substring rule differ here, and
   the substring one is wrong.

Must still be BLOCKED, unchanged from today:
7. `.env.local`
8. `ventures/caveman-trading-os/x.ts`

9. Every case already asserted in `merge-steward.regression.test.mjs` still
   passes. It is 23 passed 0 failed and must grow, not shrink.

If any case here cannot be satisfied, LEAVE IT FAILING and say so. Do not
substitute a case that passes.

## Verify, and paste what you actually saw

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/merge-steward.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

run-all-tests is 86/86 and must stay there.

## Deliver

1. The rule as you wrote it, and whether it matches the shape of the `ventures/`
   rule or differs and why.
2. The nine cases above, each with BLOCKED or allowed as you measured it.
3. The exact test output, pasted.

Do not commit. Do not push.
