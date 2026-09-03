---
version: 1
name: Aidit-OS-house-style
description: The interface standard for Aidit OS — a night instrument panel for one reader. Cool blue-black ground (`#0c0f14`), a single sodium-brass accent (`#e2a04b`), Public Sans as the working face, Azeret Mono for figures and identifiers, and Source Serif 4 rationed to datelines and case subjects. The surface is a queue of cases, not a dashboard: the first screen carries work, not statistics. English is the frame; Indonesian is the substance.

colors:
  primary: "#e2a04b"
  primary-hover: "#efb164"
  on-primary: "#17130c"
  canvas: "#0c0f14"
  canvas-soft: "#10141a"
  surface: "#151a21"
  surface-raised: "#1e252e"
  surface-high: "#262e38"
  border: "#242c36"
  border-strong: "#38424e"
  hairline: "#1f262f"
  ink: "#e9ebee"
  body: "#a3adb8"
  mute: "#8a95a0"
  ok: "#5ab98a"
  warn: "#d6a447"
  err: "#d9584a"
  light-canvas: "#fffefb"
  light-surface: "#f8f4f0"
  light-ink: "#201515"
  light-primary: "#ff4f00"

typography:
  dateline:
    fontFamily: Source Serif 4, Georgia, serif
    fontSize: 22px
    fontWeight: 400
    lineHeight: 26px
    letterSpacing: -0.22px
  case-subject:
    fontFamily: Source Serif 4, Georgia, serif
    fontSize: 24px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.36px
  case-subject-card:
    fontFamily: Source Serif 4, Georgia, serif
    fontSize: 22px
    fontWeight: 600
    lineHeight: 26px
    letterSpacing: -0.26px
  case-subject-row:
    fontFamily: Source Serif 4, Georgia, serif
    fontSize: 19px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: -0.23px
  page-title:
    fontFamily: Public Sans, system-ui, sans-serif
    fontSize: 24px
    fontWeight: 800
    lineHeight: 28px
    letterSpacing: -0.48px
  section-title:
    fontFamily: Public Sans, system-ui, sans-serif
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
    letterSpacing: -0.16px
  figure:
    fontFamily: Azeret Mono, ui-monospace, monospace
    fontSize: 19px
    fontWeight: 600
    lineHeight: 19px
  figure-lg:
    fontFamily: Azeret Mono, ui-monospace, monospace
    fontSize: 32px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.96px
  slot-value:
    fontFamily: Public Sans, system-ui, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
  body:
    fontFamily: Public Sans, system-ui, sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  control:
    fontFamily: Public Sans, system-ui, sans-serif
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
  meta:
    fontFamily: Azeret Mono, ui-monospace, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
  slot-label:
    fontFamily: Azeret Mono, ui-monospace, monospace
    fontSize: 10px
    fontWeight: 500
    lineHeight: 14px
    letterSpacing: 1.5px
  strip-label:
    fontFamily: Public Sans, system-ui, sans-serif
    fontSize: 10px
    fontWeight: 400
    lineHeight: 14px
    letterSpacing: 0.8px

radii:
  pill: 6px
  card: 12px

spacing:
  base: 4px
  scale: [4, 6, 8, 12, 14, 18, 20, 24, 32, 40]
---

## Overview

Aidit OS has one reader. He is not an engineer, he owns the business the system
works on, and he opens this at six in the morning on an iPhone 12 Pro, usually
in an unlit room. Every rule below follows from those four facts.

The surface is **a queue of cases, not a dashboard.** An analytics app exists so
you can look at numbers. This exists so that fourteen waiting decisions become
answered ones. Copying an analytics skeleton onto that was the original design
error, and the four 168px tiles that used to open the home screen were its
symptom: on an iPhone 12 Pro in Safari there are 390 × 664 points of live
screen, and the tiles spent 384 of them before the first answerable thing
appeared.

The tone is a chief of staff briefing a principal. It states, it recommends,
and it never asks him to decide something it has not shown him.

## Language

Two languages, one boundary. **If it is a label, a state or a control, it is
English. If it is a sentence he reads in order to understand his own business,
it is Indonesian** — formal Indonesian, addressing him as *Anda*, never *lo*.

| English — the frame | Indonesian — the substance |
| --- | --- |
| Navigation, column headers, section labels | The subject line of every case |
| State words, badges, figures, ages, identifiers | The question being put to him |
| Controls: Approve, Decline, Defer, Revise, Open | What already exists, and its figures |
| Card slot labels | The options, the recommendation, the cost of waiting |

Two consequences. **Quoted material is never translated** — a commit message, a
log line or an error is reproduced exactly as written, because a translated
quote stops being evidence. And **technical terms stay technical**: commit,
repo, endpoint, quota, service are left alone inside Indonesian prose.

The vocabulary lives in `cockpit/lib/kata.ts`. Nothing outside that file invents
a state word or a sentence.

### Register rules

- **State, don't narrate.** "14 awaiting you", never "Morning, Adit! Lots for
  you today."
- **Recommend, always.** Every item put to him carries a stated recommendation
  and the reasoning for it — or an explicit, visible admission that none was
  written.
- **Never apologise in the interface.** A failure reports what failed, since
  when, and what it costs.
- **One word per state, forever.** The word on screen is the word in Telegram is
  the word in the ledger.

### The five states

`Awaiting you` · `In progress` · `Blocked` · `Done` · `Dropped`. There is no
sixth, and no synonym. "Macet" and "nyangkut" were the same state in two words;
both are Blocked.

### Machine keys that look like prose

`OWNER MENYETUJUI via Telegram` and `OWNER MENOLAK via Telegram` are matched
literally by `ops-watcher/directive-runner.mjs`. The wire values `SETUJU`,
`REVISI`, `TOLAK`, `NANTI` are the contract of `app/api/decision/route.ts`.
None of these are copy. They are never translated, reworded or renamed; only
what is printed beside them is house copy.

## Colors

The default skin is `dark`, and it is the night instrument panel. The bare
`:root` alias must sit on the same CSS block as `DEFAULT_THEME` in
`cockpit/lib/theme.ts`, or a no-JS load flashes a different skin.

### Ground and surface

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0c0f14` | the page |
| `--bg-2` | `#10141a` | topbar, rail, code wells |
| `--surface` | `#151a21` | cards, lists |
| `--surface-2` | `#1e252e` | hover, secondary controls |
| `--surface-3` | `#262e38` | rare third level |

### Line

`--border` `#242c36` outlines an object. `--border-strong` `#38424e` is for a
control that must read as pressable. `--hairline` `#1f262f` separates rows
inside one object and nothing else.

### Text

`--text` `#e9ebee` · `--text-2` `#a3adb8` · `--text-3` `#8a95a0`. The dim step
is deliberately lighter than the artwork value it came from, because it still
has to clear 4.5:1 on `--surface`. A dim token that cannot be read is
decoration pretending to be information.

### Accent and semantics

One accent: `--accent` `#e2a04b`, sodium brass. It marks the state of the thing
being waited on and the single primary control on a screen — nowhere else. The
hue is not a preference: it is the colour of night instrument panels, chosen so
a just-woken eye is not shocked.

Semantic colour is separate from the accent and never decorative: `--ok`
`#5ab98a`, `--warn` `#d6a447`, `--err` `#d9584a`. Colour never carries a meaning
alone — the word beside it always says the same thing.

## Typography

Three faces, each with one job.

- **Public Sans** — the working face. Labels, body, controls. It is the
  vernacular of official briefs, which is what this is.
- **Azeret Mono** — figures, identifiers, ages, slot labels. Anything that lines
  up in a column gets `tabular-nums`.
- **Source Serif 4** — rationed to exactly two places: the dateline, and a case
  subject. That ration is what makes a case read as a document rather than a
  row. A third serif use dilutes it to decoration.

The ramp is the `typography:` block above. Sizes outside it are drift, not
design; add a step to the ramp rather than reaching past it.

Uppercase is reserved for slot labels and strip labels, always with tracking,
never above 10px, never on a sentence.

## Layout

### The first-fold budget

The phone is the deciding surface. Of 664 live points in Safari:

| Element | Points |
| --- | --- |
| Topbar | 52 |
| Dateline + clock | 46 |
| Instrument strip | 62 |
| Section heading | 40 |
| **First case begins at** | **~200** |

The old tiles put it at ~530. Any change that pushes the first case past 200
points has to justify itself against this table.

The cockpit is worth adding to the Home Screen: in standalone mode Safari's
chrome disappears and 664 becomes 763.

### The strip, not tiles

Four figures on one 62-point line, each linking to the list that produced it.
A figure that cannot be traced back to its own rows is not shown. A source that
cannot be read renders as an em dash and says so — never as zero.

### Spacing

4px base. The steps in `spacing:` above are the whole vocabulary. Sibling
groups are laid out with flex/grid `gap`, not per-element margins.

### Breakpoints

| Name | Width | What changes |
| --- | --- | --- |
| base | 390 | one column, rail off-canvas |
| `sm` | 640 | roomier padding |
| `lg` | 1024 | two columns: queue and evidence |
| `wide` | 1800 | wider measure |
| `ultra` | 2200 | full bleed |

At `lg` the desk earns its name: the queue on the left, and the record of the
case at the head of it on the right, with its answer buttons. That side-by-side
is the entire reason to open a laptop rather than answer from bed.

### Touch targets

44 points minimum, always. List rows are 46.

## The case record

The one component the whole product exists for. Eight slots, in this order:

1. **Subject** — plain words, Indonesian. The identifier is a small tag, never
   the headline.
2. **The question** — what exactly is being settled.
3. **What already exists** — the actual thing that was built, quoted.
4. **The proposed plan** — verbatim, in mono, when one exists.
5. **Your options** — each with what it will do.
6. **My recommendation** — which one, and why.
7. **If you do nothing** — the cost of waiting.
8. **Source and history** — where it came from, so it can be checked.

**A slot with nothing behind it says so.** It is never filled with a plausible
sentence. A recommendation nobody reasoned to is worse than a visible gap,
because he would act on it. This is the rule that turns a missing data source
into a visible defect instead of an invisible lie.

The closed card in the queue carries **no answer buttons**. Answering happens
inside the opened case, with the record in front of him. A closed card that
could be approved is a card inviting a decision made without reading it.

## Components

### Marks

One mark per real item — not a sparkline, not a trend, no invented series.
Fifteen marks under "15/15" are the fifteen checks, and a red one is a check
that failed. When there is nothing real to count the row is not drawn. This
contract predates the redesign and survives it unchanged.

### Buttons

12px radius, 44 minimum height, sentence case. One primary per screen, filled
with the accent on `--accent-ink`. Everything else is an outline on
`--border-strong`. Labels say what happens: "Approve", then a line that says
"Disetujui."

### Cards and lists

Card: `--surface`, 1px `--border`, 12px radius. Rows inside a card are divided
by `--hairline` only. Border, fill, radius and shadow each say "separate
object" — they are spent by role, not stamped on every block.

### Navigation

Four destinations in the rail: Brief, Decisions, Work, System. The other seven
views live behind one "More" disclosure — still routable, still in the command
palette. A rail is a place to go, not an index of everything that exists.

Under the rail: what each lane consumed this week, with its role beside its
name. A bare roster of names tells him nothing, so no lane is ever named
without its role.

### Proof of life

A standing "Last check N ago · 15/15" in the topbar, red on its own when the
heartbeat is stale or unreadable. Silence and death look identical without it,
and this stack has died with a terminal session before.

## Do's and Don'ts

### Do

- Put work on the first screen and statistics on the second line.
- Make every figure traceable to the rows it counted.
- Show a missing source as missing.
- Give every case a recommendation, or admit in the interface that it has none.
- Keep the serif rationed to two places.

### Don't

- Don't greet him. A dateline says when this was true; a greeting says nothing.
- Don't put a number on a screen without a way to check it.
- Don't invent a recommendation, a trend line, or a series.
- Don't add a sixth state word or a synonym for an existing one.
- Don't translate a quote, a wire value, or a comment prefix.
- Don't put an approve button on a card that does not show what is being
  approved.

<!-- Generated copy. cockpit/package.json makes this directory its own project
     root, so the design detector cannot see the DESIGN.md at the repo root and
     silently skips every design-system rule for files under cockpit/. Edit the
     root file; this one is a mirror. -->
