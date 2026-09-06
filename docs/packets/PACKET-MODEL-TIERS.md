# PACKET-MODEL-TIERS — put HATTA on the tier its work belongs to

Role: SJAHRIR. Implement and test. **Do not commit. Do not push.**

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists

The benchmark this system is measured against, `the-agent-stack.md` layer 03,
says:

> Heavy work runs GLM-5.2, code runs GLM-5.1, light work runs a flash model, and
> Codex on the ChatGPT plan is the second lane.

HATTA's default is `glm-5.3:cloud`. That is neither the heavy tier nor the code
tier. HATTA's own ROLE.md calls it the "primary technical executor" -- it edits
code -- so by the benchmark it belongs on `glm-5.1:cloud`.

Measured on this machine tonight, same task (a two-file edit with tests), same
harness, same budget:

| model | result |
|---|---|
| `glm-5.3:cloud` | failed 3 times, wrote nothing, 19s per turn |
| `glm-5.1:cloud` | wrote both files in 107s, 3s per turn |
| `kimi-k2.7-code:cloud` | wrote both files, suite 12/12, hit the iteration ceiling |

Every tier is reachable from the account already in use. Verified by direct call:

```
glm-5.2:cloud         3853 ms
glm-5.1:cloud         1701 ms
glm-5.3-flash:cloud    803 ms
glm-5.2-flash:cloud   does not exist
glm-5.1-flash:cloud   does not exist
glm-4.7:cloud         retired 2026-07-15
glm-4.6:cloud         retired 2026-06-16
```

Two models were retired inside two months. That matters for the second half of
this packet.

---

## Files you may edit - no others

- `hatta/harness.mjs`
- `hatta/harness.security.test.mjs`
- `ops-watcher/hatta-flash-dispatch.mjs`
- `ops-watcher/hatta-dispatch.regression.test.mjs`

---

## What to change

### 1. The tiers live in one place, named

`hatta/harness.mjs` line 25 currently reads:

```js
const MODEL = process.env.OLLAMA_MODEL_HATTA || "glm-5.3:cloud";
```

and `ops-watcher/hatta-flash-dispatch.mjs` line 32 separately hardcodes
`"glm-5.3-flash:cloud"`. Two files, two literals, no relationship between them.

Export a single named table from `hatta/harness.mjs`:

```js
export const MODEL_TIERS = Object.freeze({
  code: "glm-5.1:cloud",        // HATTA's default: it edits code
  heavy: "glm-5.2:cloud",       // reserved; nothing routes here yet
  light: "glm-5.3-flash:cloud", // the flash lane
});
```

`MODEL` becomes `process.env.OLLAMA_MODEL_HATTA || MODEL_TIERS.code`. The
env override keeps working exactly as it does today -- that is how tonight's
comparison was run and it must stay possible.

`hatta-flash-dispatch.mjs` imports `MODEL_TIERS.light` instead of its own
literal, so the two files can never drift apart again.

Do NOT route anything to `heavy` in this packet. It is declared so the tier
exists and is named; choosing what deserves it is a separate decision.

### 2. A retired model must say so, not look like a timeout

When a model is retired or missing, the endpoint answers with a plain error:

```
{"error":"glm-4.7 was retired at 2026-07-15 00:00:00"}
{"error":"model 'glm-5.1-flash' not found"}
```

`postChat` currently throws on a non-ok response with a generic
`Ollama chat failed: HTTP <status> <body>` message. That is recoverable, but the
run then reports as an ordinary failure and the reason is buried.

Detect these two shapes and surface them as their own error, with the model name
in the message. A lane that dies because its model was retired must say that in
the first line of its failure, not leave a reader diffing timeouts. Given two
retirements in two months, this will happen again.

Keep `postChat`'s existing contract otherwise: it still throws, and
`OllamaChatTimeoutError` still means a timeout and nothing else.

---

## Tests - required

1. `MODEL_TIERS` has exactly the three keys, and each value is a non-empty
   string ending in `:cloud`.
2. With `OLLAMA_MODEL_HATTA` unset, the model used is `MODEL_TIERS.code`.
3. With `OLLAMA_MODEL_HATTA` set, that value wins. This is how a comparison run
   is done and it must not regress.
4. `hatta-flash-dispatch` uses `MODEL_TIERS.light` and does not carry its own
   literal. Assert on the exported/derived value, not on a copy of the string.
5. A response body containing `was retired at` produces an error naming the model
   and the retirement, distinguishable from a timeout.
6. A response body containing `not found` does the same.
7. A genuine timeout still produces `OllamaChatTimeoutError` and is NOT
   classified as a retirement.

---

## Verify, and paste what you actually saw

Pinned Node only. `--only` filters on the BASE FILENAME.

```
D:\aidit-node\node-v22.14.0-win-x64\node.exe hatta/harness.security.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/hatta-dispatch.regression.test.mjs
D:\aidit-node\node-v22.14.0-win-x64\node.exe ops-watcher/run-all-tests.mjs
```

The ops-watcher suite is 86/86 and the harness suite is 85/85; both must stay
that way.

## Budget

Your prompt carries a stated wall and nothing unwritten survives it. You have
landed two packets tonight of about this shape. If it does not fit, land part 1
with tests 1 to 4, say plainly that the retirement detection is not done, and
stop. The tier table is the part that matters tonight.

## Deliver

1. What changed, and which model HATTA will use on its next run.
2. The exact test output, pasted.
3. Anything in this packet that turned out to be wrong.

Do not commit. Do not push.
