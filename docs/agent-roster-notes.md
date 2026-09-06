# agency-agents — what is installed, and what is deliberately not

Source: `https://github.com/msitarzewski/agency-agents` (MIT), cloned to
`D:\AI\agency-agents`. 274 agents across 19 divisions.

## What these actually are

Claude Code **subagent definitions**, installed to `C:\Users\ASUS\.claude\agents\`.
They run inside a Claude Code session on the owner's Claude account, as
subagents of the main assistant.

**They are not lane workers.** HATTA, CORLEONE, SJAHRIR and GIBRAN are separate
CLI processes with their own model subscriptions (ollama, codex, kimi), dispatched
by `ops-watcher/*-dispatch.mjs`. Installing more personas adds specialist
prompting; it adds no worker capacity and no lane minutes. Anyone reading this
expecting "more agents = more throughput" should stop here — the two things are
unrelated.

## The reason this file exists: a standing per-turn cost

Every installed agent appears in the agent listing on **every turn, in every
project on this machine**. Measured across the full roster on 2026-09-03:

| Scope | Agents | Listing chars | ~tokens / turn |
|---|---|---|---|
| Everything | 274 | 68,773 | ~19,100 |
| Installed today | 28 | ~5,600 | ~1,620 |

Roughly 17,500 tokens per turn saved by not installing the rest. That is the
whole argument for curating: not tidiness, cost that recurs forever.

## Installed (28)

**Testing** — the discipline this repo already runs on: mutation-checked tests,
live proof over green suites.
`evidence-collector` · `reality-checker` · `test-automation-engineer` ·
`test-results-analyzer`

**Engineering** — what the work here actually is.
`multi-agent-systems-architect` (this system, described) · `minimal-change-engineer` ·
`backend-architect` · `software-architect` · `code-reviewer` · `senior-developer` ·
`devops-automator` · `sre-site-reliability-engineer` · `git-workflow-master`

**Security** — both of these have already come up: a live API key pasted into
chat, and a login loop that needed forensics.
`secrets-credential-hygiene-engineer` · `application-security-engineer` ·
`incident-responder`

**Design** — installed at the owner's instruction on 2026-09-03, after three
rejected visual directions. The owner's word for the output was "slop"; the
cockpit visual work is handed off in
`handoffs/ahmad/COCKPIT-VISUAL-HANDOFF-2026-09-03.md`.
`ui-designer` · `ux-architect` · `ux-researcher` · `ui-finish-gate-reviewer` ·
`brand-guardian` · `visual-storyteller` · `inclusive-visuals-specialist` ·
`persona-walkthrough-specialist` · `image-prompt-engineer` · `whimsy-injector`

**Prioritising** — `sprint-prioritizer` · `project-shepherd`

## Worth installing when the work reaches them

Not installed yet, with the trigger that should cause it:

| Division | Agents | Install when |
|---|---|---|
| `marketing` | 36 | SJS SuperApps or Caveman Trading needs go-to-market. Largest division after specialized; consider installing selectively rather than whole. |
| `sales` | 9 | SJS has something to sell. |
| `finance` | 5 | Pricing, unit economics, or the paid-AI restructuring decision. |
| `support` | 6 | A venture has real users. |
| `strategy` | 16 | Company-level direction, not feature-level. |
| `specialized` | 58 | Case by case only. Biggest listing cost of any division (~4,400 tokens/turn); never install whole. |

Deliberately out of scope for this business: `gis`, `game-development`,
`healthcare`, `academic`, `spatial-computing`, `paid-media`.

## Installing more

```bash
node <scratchpad>/install-division.mjs marketing        # a whole division
```

Or copy individual files from `D:\AI\agency-agents\<division>\*.md` into
`C:\Users\ASUS\.claude\agents\<slug>.md`. The vendor installer
(`scripts/install.sh --tool claude-code --agents-file <list>`) also works in
principle but hung past five minutes on this machine, apparently waiting on
input, so the direct copy is the tested path here.

The installer was read before anything was run: 1,392 lines, no network fetch,
no `sudo`, no package install, no dynamic execution; its three `rm -rf` calls
are scoped to its own destination directory.

## One naming trap

Slugs drop the division prefix, and an ampersand in a name is **removed**, not
expanded. `Secrets & Credential Hygiene Engineer` becomes
`secrets-credential-hygiene-engineer`, not `secrets-and-credential-...`. A
slugifier that expands `&` to `and` silently fails to find it.

## Which lane suits which shape of task — measured 2026-09-06/07

Not a preference. These are the runs, and they were consistent enough to route
on.

**CORLEONE (codex) is the lane for wide-read work.** It produced adoption survey
C -- six upstream files against six of ours, four structured sections, a file and
line number on both sides of every claim -- in ONE turn. It also landed the
five-file refusal-honouring change with tests in one run. Codex batches its
reads; a task whose cost is "open twelve files and hold them together" fits it
and almost nothing else here.

**HATTA is the lane for narrow edits.** On `kimi-k2.7-code:cloud` it landed a
one-regex fix in 32 turns and an orchestration survey in 26. Given the same
knowledge survey that CORLEONE finished in one turn, it spent all forty tool
calls and wrote nothing. The ceiling is 40 (`HATTA_MAX_ITER`, hard 40); reading
twelve files and writing a report does not fit inside it, and no model choice
changes that arithmetic.

**SJAHRIR (kimi CLI) is the lane for multi-rule implementation with tests.** It
landed the content-hash executor fix, the runtime-state split and the steward
false-alarm work, each several hundred lines with new tests. Its wall is time,
not tool calls: 480s, and three runs this week had the code written and the suite
green when it hit.

The practical rule: **count the files a packet must OPEN before choosing a lane.**
Over about six, send it to CORLEONE. Under three with tests, HATTA. In between,
or where the work is one module and a test file, SJAHRIR.

Two quota facts that go with this. SJAHRIR's kimi CLI has a five-hour window and
returns `403 ... 5-hour usage limit`; the dispatcher refuses without spawning and
says how many minutes remain. HATTA's kimi runs through Ollama and is a
DIFFERENT pool -- measured 2026-09-07, the Ollama endpoint answered 200 in 2.4s
while the CLI was rate-limited. The two lanes do not fail together.
