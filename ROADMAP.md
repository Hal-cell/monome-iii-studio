# monome-iii-studio — Roadmap & Status

> **Current baseline tag**: `v7-ux-batch` (this commit) — region color picker, drag-reorder, use-as-template, and layout template library (B4–B7).

This file is the **canonical, public** roadmap. It mirrors a private vault note used for day-to-day editing; both are kept in sync via commits to this repo.

---

## 🔔 Subscribing to updates

Two ways for collaborators to stay current.

### Option A — GitHub built-in (zero setup)

1. Go to **<https://github.com/Hal-cell/monome-iii-studio>** and click **Watch → Custom**.
2. Tick **Releases** (low-volume — only milestone tags) or **All activity** (every commit, more noise).
3. GitHub emails you on every matching event.

You can also bookmark the file's commit history (only events that touched this file): <https://github.com/Hal-cell/monome-iii-studio/commits/main/ROADMAP.md>

### Option B — AI assistant polling (real-time, hands-off)

If you're working with Claude Code, Claude.ai, or any agent that can call `WebFetch` / `curl`, point it at one of these URLs:

| What | URL |
|---|---|
| **Atom feed** (commits touching this file only) | `https://github.com/Hal-cell/monome-iii-studio/commits/main/ROADMAP.md.atom` |
| **Raw markdown** (full content) | `https://raw.githubusercontent.com/Hal-cell/monome-iii-studio/main/ROADMAP.md` |
| **GitHub API** (last commit on file) | `https://api.github.com/repos/Hal-cell/monome-iii-studio/commits?path=ROADMAP.md&per_page=1` |

**Suggested polling pattern (paste this into your assistant's setup):**

> Poll the atom feed at `https://github.com/Hal-cell/monome-iii-studio/commits/main/ROADMAP.md.atom` every 30 minutes. The latest `<entry><id>...</id>` is a commit SHA — cache it. When a new entry appears, fetch the raw markdown at `https://raw.githubusercontent.com/Hal-cell/monome-iii-studio/main/ROADMAP.md`, diff against your cached copy, and tell me what changed (which task IDs flipped status, which were added). Don't notify me on no-op changes.

GitHub serves the atom feed without auth and respects HTTP caching headers, so polling is cheap.

---

## A. Functional features

| # | Task | Effort | Type | Status | Notes |
|---|---|---|---|---|---|
| **A1** | Multi-page layout | ⭐⭐⭐⭐ ½–1 day | feature | ✅ `881f23d` (v2-multipage-shipped) | emit.ts multi-page; new `page_select` global recipe; UI page tab bar |
| **A2** | LFO recipe (periodic CC modulation) | ⭐⭐ 1–2 h | feature | ✅ `5b93bb7` | sine/tri/saw/square; meter-style fill LED viz |
| **A3** | Chord trigger recipe (single-cell chord) | ⭐⭐ 1–2 h | feature | ❌ deleted | cancelled |
| **A4** | Euclidean rhythm recipe | ⭐⭐⭐ 2–3 h | feature | | N steps / K hits / rotation; very monome-like |
| **A5** | Arpeggiator recipe | ⭐⭐⭐ 2–3 h | feature | ❌ deleted | depended on A8 which is also deleted |
| **A6** | Step-sequencer swing | ⭐ 30 min | feature | ❌ deleted | cancelled |
| **A7** | wake_sequencer CLK page (live BPM / run-stop / scale) | ⭐⭐⭐ ½ day | feature | ✅ `544789d` | rr=1 scale picker (8 cells), rr=2 run/stop, rr=3+ BPM meter (60..300); live BPM via `_metro.time = X` |
| **A8** | MIDI input handling (`event_midi`) | ⭐⭐⭐ ½ day | feature | ❌ deleted | shipped (`af5ee65`) but Logic couldn't trigger it; reverted (`b52f029`); note_monitor deleted too |
| **A9** | note_keyboard harmony coach — **iterated 10 rounds** | ⭐⭐⭐⭐+ multi-day | feature | ✅ `f9ec870` (v5-coach-iterated) | see breakdown below |

### A9 sub-iterations (this session)

| # | Sub-task | Commit | What it did |
|---|---|---|---|
| **A9.1** | scale-highlight overlay on chromatic keyboards | `cec7886` | scale param decoupled from cell layout; LED brightness gets 3 tiers (root / in-scale / off-scale) |
| **A9.2** | always-chromatic layout refactor | `fb850c9` | scale param no longer affects note assignment, just LED highlight |
| **A9.3** | live scale select (rightmost-column picker) | `2f6765c` | rightmost column = 8 scale-switch cells; live-switchable during play |
| **A9.4** | compact emit + loop-based | `6939fb1` | rect-detect → `for y for x` loops instead of per-cell lines; voicings flat literal; whitespace stripped. Worst-case 16×8 dropped from 22 KB → 7.7 KB |
| **A9.5** | iii `LINE_BUFFER` 512-byte fix | `cbd4ce8` | split long literals onto multiple lines; scale_member one-per-line, chord_voicing one-per-chord |
| **A9.6** | bass-pitch stratified sampling | `267205c` | voicings used to pile up at the high register; now stratified across the keyboard's full vertical range |
| **A9.7** | adaptive grid-tightness filter | `a42b800` | Manhattan span filter (min + 2); same-bass dedup keeps only the tightest representative |
| **A9.8** | 7th chords + cadential progression weights | `29672ff` | triads → 4-note 7th chords (Cmaj7 / G7 / Bm7♭5 ...); progression graph weighted toward V→I, ii→V, IV→V, vii°→I |
| **A9.9** | inversions + open / drop voicings | `c3c0243` | pitch constraint relaxed from "total span ≤ octave" to "adjacent gap ≤ octave"; all 4 inversions present, drop-2/drop-3 allowed |
| **A9.10** | common-tone voice leading | `cd3287d` | walk: cells whose PC is shared with the previous voicing keep their prev cell — shared tones don't visually jump |

---

## B. UX polish

| # | Task | Effort | Type | Status | Notes |
|---|---|---|---|---|---|
| **B1** | README + screenshots / GIF | ⭐ 30 min | docs | | repo README is currently empty |
| **B2** | Undo / Redo | ⭐⭐ 1–2 h | UX | ✅ `3febde6` | layout-state history stack (max 50); snapshots region+layoutName, not the editor draft |
| **B3** | Keyboard shortcuts | ⭐ 30–60 min | UX | ✅ `3febde6` | ⌘Z/⌘⇧Z undo/redo, ⌘Y redo (Win), ⌘E export, Esc clear sel |
| **B4** | User-customizable region color | ⭐ 30 min | UX | ✅ (this batch) | click any region's color swatch in the panel — pop-over with the 7 palette colors; pick = `setRegionColor` mutates the region's `colorIndex`. Click-outside dismisses. |
| **B5** | Region drag-reorder | ⭐⭐ 1–2 h | UX | ✅ (this batch) | each region row is HTML5-draggable; the dragged region's id rides through `dataTransfer`, drop calls `reorderRegions(fromId, beforeId)`. List order = display order = emitted-Lua region order. Visuals: dragged row fades to opacity 40%; drop target gets an amber top-border highlight. |
| **B6** | "Use as template" — clone a region's config | ⭐⭐ 1–2 h | UX | ✅ (this batch) | each region row has a ⎘ button. Click → load that region's recipe / mode / values into the editor draft, clear selection, prompt the user to pick cells and Add Region. Lets you configure once, apply to multiple cell groups. |
| **B7** | Layout template library | ⭐⭐ 1–2 h | UX | ✅ (this batch) | new "Templates ▾" dropdown in the Layout section. Three starters: **Drum pad 8×4** (32 momentary cells, GM drum channel, notes 36–67), **Step seq 16×8** (16-step / 8-track, C major), **Synth keyboard** (15×8 chromatic + live scale picker + harmony coach on). Picker confirms before clobbering an existing layout. Templates are plain `LayoutExport` objects in `lib/templates.ts` — adding a fourth is one entry. |

## C. Easter eggs / for fun

| # | Task | Effort | Type | Status | Notes |
|---|---|---|---|---|---|
| **C1** | Conway's Game of Life + sonification | ⭐⭐⭐⭐ ½ day | fun | ✅ `c8f6b68` (v6-gol-sonified) | type "life" anywhere in the web UI; banner offers ▶ run on iii or download `gol.lua`. See breakdown below. |
| **C2** | Lights Out puzzle | ⭐⭐ 1–2 h | fun | | press cell → flip plus-neighbors; goal all dark |
| **C3** | Two-player Pong | ⭐⭐⭐ 2–3 h | fun | | left/right paddles; needs two players to be fun |
| **C4** | Generative ambient mode | ⭐⭐⭐ ½ day | fun | | grid evolves slowly; long-press a cell to perturb |

### C1 sub-iterations

| # | Sub-task | Commit | What it did |
|---|---|---|---|
| **C1.1** | Visual GoL on iii grid + multi-egg framework | `cd27324` | refactored EasterEgg.tsx into a list of `{trigger, label, emoji, scriptName, lua}`; added "life" trigger. 15×8 canvas, right-column controls (pause/step/speed/clear/random sparse/random dense). Toroidal wrap, B3/S23 rules. LED 15/12/5/0 for born/alive/dying/dead |
| **C1.2** | Column-scan sonification + scale picker + sim-rate | `58c97f6` | metro tick = scan one column left-to-right; alive cells trigger MIDI note-on (y → pitch). New (16,4) scale cycle (D Dorian / Aeolian / Phrygian / Major) and (16,8) sim-rate cycle (advance every 1 / 2 / 4 full scans). Pattern shape becomes audible: blinker = two-note alternation, glider = lone note drifting through the pitch range, etc. |
| **C1.3** | Incremental step removes scan-wrap stutter | `7832e44` | wrap tick was running the full Conway step (~2000 table ops), pushing the next tick late; user heard a brief pause as col 15's notes sustained too long. Fix: double-buffer (alive_a / alive_b), compute one row of next state per tick over 8 ticks, atomic O(1) pointer swap at the next wrap. Inlined the inner loop (cached row refs, neighbour count) for ~5× speed-up of the per-row work. |

## D. Bug fixes / hardening

| # | Task | Status | Notes |
|---|---|---|---|
| **D1** | Main page (index 0) is undeletable | ✅ `f6b0b6c` | UI hides delete button when `activePageIndex === 0`; store `removePage` defensively refuses `i === 0`. Combined with the existing "last page is undeletable" rule → there's always at least one page, and that page is always page 0 |

---

## Known iii hardware / firmware constraints

- **Script size limit: 32767 bytes** (`SCRIPT_BUFFER_SIZE` in repl.c). Overflow during `^^f` aborts upload; remaining lines run as REPL commands and fail with "nil value (global 'W')" type errors.
- **Single line limit: 512 bytes** (`LINE_BUFFER_SIZE`). Long lines silently truncate mid-token, producing parse errors like `unexpected symbol near ']'`.
- **Grid is fixed 16×8** — we hard-code `W_RUNTIME = 16` so cellKeyInt can be precomputed at codegen time.

## Recommended next-up (Claude's take)

note_keyboard / harmony coach is mature; B4–B7 done in one batch. Suggested order:

1. **B1** README — repo README is still empty; outsiders bounce on first impression. Screenshots + GIF demo of the flow.
2. **A4** Euclidean rhythm — small, high-impact, very monome-flavoured.
3. **C2 / C3 / C4** — Lights Out / Pong / generative ambient (C1 done).

---

## Conventions

- Branch first (`feat/<task-id>`), merge to main triggers GH Pages deploy.
- Tag before big changes (`v3-coach-iterated` style) as a rollback point.
- Mark completed tasks with ✅ + commit / tag.
- New tasks: add a row, IDs don't have to be strictly sequential (A10, A11 fine).
- **After editing this file, commit + push** so collaborators see the latest.

---

## Milestones (for review / rollback)

- ✅ **v0** — 8 recipes (momentary / toggle / radio / range / meter / note_keyboard / step_sequencer / wake_sequencer)
- ✅ **Web Serial integration** — Connect / Run on iii / file management (`fs_list_files` / `rm` / `^^c` / `^^i`)
- ✅ **GH Pages auto-deploy**
- ✅ **v1-with-snake** (`412e955`) — Snake easter egg + D-minor harmonic progression + cross-script LED clear fix
- ✅ **v1.1-snake-shipped** (`57195ef`) — UI polish (scale options wrap into a grid)
- ✅ **v2-multipage-shipped** (`881f23d`) — B2 / B3 / A2 / A8 / A1 in one go: undo/redo + shortcuts; LFO recipe; MIDI input dispatch + note_monitor; multipage + page_select
- ✅ **Cleanup** (`b52f029`) — LFO LED threshold uses real range; removed A8 (note_monitor + event_midi); page_select switching more stable (`_prev_led = {}` reset + explicit `grid_refresh`)
- ✅ **v3-keyboard-highlight-shipped** (`4f27668`) — scale-highlight LED overlay on chromatic-layout keyboards (A9.1)
- ✅ **v4-always-chromatic-stable** (`4debc13`) — note_keyboard cell layout decoupled from scale param (A9.2)
- ✅ **v5-coach-iterated** (`f9ec870`) — full note_keyboard harmony coach (A9.1–A9.10):
  - 7th chords (Cmaj7 / Dm7 / G7 / Bm7♭5 ...)
  - cadential progression weights (V→I, ii→V→I)
  - all 4 inversions + drop voicings
  - common-tone voice leading
  - register-spread tight voicings
  - live scale select
  - 16×8 full keyboard fits in ~10 KB
- ✅ **v6-gol-sonified** (`c8f6b68`) — Conway's Game of Life easter egg with column-scan sonification (C1.1–C1.3):
  - 15×8 toroidal canvas + right-column control strip
  - column-scan music: alive cells in current column trigger MIDI note-on, y → pitch via D Dorian / Aeolian / Phrygian / Major
  - sim-rate cycle (advance every 1 / 2 / 4 scans)
  - incremental Conway step (1 row / tick + double-buffer) — no scan-wrap stutter
  - multi-egg `EasterEgg` framework; adding a third egg is one entry in the EGGS list
  - bonus D1 fix: main page (index 0) is undeletable
- ✅ **v7-ux-batch** — region UX polish round (B4–B7):
  - **B4** color picker — click any region's swatch → 7-color pop-over
  - **B5** drag-reorder — HTML5 DnD on region rows; list order = emitted-Lua order
  - **B6** use-as-template ⎘ button — clones a region's recipe / mode / params into the editor draft
  - **B7** templates dropdown — three starter layouts (drum pad 8×4, step seq 16×8, synth keyboard)

### Rollback tags

| Tag | Commit | What |
|---|---|---|
| `v0-pre-mobile` | `9f73c82` | pre-Snake tool-only version |
| `v1-with-snake` | `412e955` | Snake shipped |
| `v1.1-snake-shipped` | `57195ef` | UI polish done |
| `v2-multipage-shipped` | `881f23d` | multipage / LFO / page_select shipped |
| `v3-keyboard-highlight-shipped` | `4f27668` | scale-highlight LED overlay (A9.1) |
| `v4-always-chromatic-stable` | `4debc13` | always-chromatic layout (A9.2) |
| `v5-coach-iterated` | `f9ec870` | full note_keyboard coach (A9.1–A9.10) |
| `v6-gol-sonified` | `c8f6b68` | GoL easter egg with column-scan sonification |
| `v7-ux-batch` | (this commit) | **current**; B4–B7 region UX polish |
