# PACKET-ADOPT-D-HANDS — the connector layer nobody surveyed

Role: CORLEONE. **READ ONLY except for the one report file named below.**
Do not commit. Do not push. Do not edit any Aidit OS source file.

Write plain ASCII hyphens (`-`, `--`). Do not type the em-dash character.

---

## Why this exists, and why it is a correction

Three surveys ran against the vendored upstream and none of them opened
`vendor/founderos-demo/lib/connectors/`. On the strength of survey C -- which
correctly found that upstream's `ledger.ts` is a bank-statement table -- the
integrator concluded upstream was "a business dashboard, not an agentic system"
and reported that to the owner. The owner rejected it, and he was right.

What was never opened: twenty-four connectors, a 531-line agent roster, 751 lines
of SOP playbooks, forty-two API routes including `agents/[id]/run`,
`agents/broadcast` and `conductor/context`. The judgement was made from the least
agentic corner of the repository.

This packet covers the Hands layer -- layer 05 of the benchmark -- properly.

Three things already visible from the file headers, so you can go deeper rather
than rediscover them:

- `lib/connectors/types.ts` defines `ConnectorState = 'connected' |
  'not_configured' | 'error'`.
- `lib/connectors/llm.ts` says in its own header: "Status stays honest: no
  AI_GATEWAY_API_KEY implies not_configured, never a fake connected." It also
  carries a `stub` provider, `LLM_PROVIDER=stub`, deterministic and making NO
  network call, so the agent-chat stack is testable offline.
- `lib/connectors/gbrain.ts` shells out to a `gbrain` binary -- the same tool
  Aidit OS uses. That is a direct integration point, not an analogy.

## Read upstream

```
vendor/founderos-demo/lib/connectors/types.ts
vendor/founderos-demo/lib/connectors/index.ts
vendor/founderos-demo/lib/connectors/llm.ts
vendor/founderos-demo/lib/connectors/gbrain.ts
vendor/founderos-demo/lib/connectors/local-stack.ts
vendor/founderos-demo/lib/creds.ts
```

Then skim the remaining connectors only far enough to say whether they share one
shape or each invents its own.

## Compare against ours

```
ops-watcher/mcp-probe.mjs
ops-watcher/routing.mjs            (its lane-reachability probes)
.mcp.json
CLAUDE.md                          (the section on registered/configured/reachable/healthy/authorized)
```

## The one file you may write

`docs/adoption/D-hands.md`. Create it. Nothing else.

## What the report must contain

The same four named sections and the same discipline as your survey C -- a file
and a line number on both sides of every claim. That report was the most useful
thing produced tonight and the reason is that every sentence could be checked.

1. **ADOPT** -- what upstream has that we do not.

   Give the offline `stub` provider its own subsection and treat it as the
   headline unless you find it is not what it appears to be. Every lane run costs
   real quota; SJAHRIR is quota-blocked as this is written and two dispatches
   tonight were refused for that reason alone. A deterministic offline provider
   would let the harness, the dispatchers and the directive loop be exercised
   without spending anything. Say concretely what it would take to have the same
   thing against our Ollama endpoint: what the seam is upstream, and whether our
   `hatta/harness.mjs` has an equivalent seam or would need one.

2. **CONVERGE** -- `ConnectorState` against our probe vocabulary. CLAUDE.md
   already insists that registered, configured, reachable, healthy and authorized
   are five separate facts. Does `mcp-probe.mjs` implement that, or does it
   answer a narrower question? Which vocabulary is better, and say why rather
   than asserting.

3. **KEEP** -- what we do that upstream does not. Our `.mcp.json` is restricted
   to two named repositories and forbidden for broker credentials; check whether
   upstream's connector layer has any equivalent scoping or whether a connector
   is simply on or off.

4. **CONFLICT** -- upstream reads credentials through `lib/creds.ts`. Read how.
   Our rule is that `.env.local` is never read into tracked files and the
   Paperclip token resolver deliberately refuses to use a signing or master key
   as a bearer token. Say plainly if adopting upstream's credential path would
   loosen that.

## Rules

- Quote what you actually read. Do not describe a file you did not open.
- Do not edit anything under `vendor/`.
- Do not edit any Aidit OS source file in this run.

## Deliver

The report, plus in your final message: the single most valuable thing upstream
has that we lack, and anything in this packet that turned out to be wrong --
including if the stub provider is less useful than it looks from its header.
