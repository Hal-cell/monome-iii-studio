# monome-iii-studio

Browser-based visual configurator for the [monome Grid](https://monome.org/docs/grid/) running the [iii](https://monome.org/docs/iii/) Lua scripting environment.

Drag a selection on a 16×8 grid, pick a behaviour (toggle, sequencer, LFO, …), and the matching Lua script is generated for you. Plug in your iii over USB and one-click upload — no command-line tooling required.

🌐 **[Try it live →](https://hal-cell.github.io/monome-iii-studio/)**

<!--
TODO: drop a screenshot at docs/screenshot.png and uncomment the line below.
A short GIF showing "drag selection → pick recipe → Run on iii" sells the
project at a glance.
-->
<!-- ![screenshot](docs/screenshot.png) -->

## What you can build

A layout is one or more **regions** on the grid, each running a different recipe. Multiple regions coexist; cells outside any region stay dark.

| Recipe              | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| **Momentary**       | Press = on, release = off. Per-cell or group mode                                              |
| **Toggle**          | Press flips state, sends CC                                                                    |
| **Radio**           | Mutually-exclusive selection across cells, sends CC mapped 0..127                              |
| **Range**           | Two-point range slider, sends low + high CC                                                    |
| **Meter**           | Multi-column visual fader                                                                      |
| **LFO**             | Cyclic CC modulation (sine / triangle / saw / square), meter-style visualisation               |
| **Note keyboard**   | Isomorphic MIDI keyboard with configurable row / column intervals + scale                      |
| **Step sequencer**  | Per-row tracks with polyrhythmic divs, gate length, scale support, mono / poly                 |
| **Wake sequencer**  | Wake-style sequencer with 5 paged per-step parameters (PITCH / OCT / VEL / DURATION / LENGTH)  |
| **Page select**     | Cells that switch the active page on the grid                                                  |

**Multi-page layouts** let the same physical grid host completely different region setups, switched live via dedicated `page_select` cells.

**Undo / redo** with `⌘Z` / `⌘⇧Z`, autosave to localStorage, JSON export / import for sharing layouts, and a built-in file manager for files already on the iii.

## How it works

1. **Open the [web app](https://hal-cell.github.io/monome-iii-studio/)** in Chrome / Edge / Arc / Brave (any Chromium ≥ 89 — see [Browser support](#browser-support) for why).
2. **Drag** a rectangular selection on the visual grid. Hold ⇧ to add to an existing selection.
3. **Pick a recipe** in the side panel and tweak its parameters.
4. Click **➕ Add Region**. That slice of the grid is now committed; cells turn into a region colour.
5. Repeat for more regions. Optionally `+ page` for a second / third / … page.
6. Plug in your iii via USB, click **Connect**, then **▶ Run on iii**. The script uploads, the iii VM soft-resets, your layout starts running. No reboot, no boot animation.

If you don't have an iii handy, use **⬇ Download .lua** and `diii upload` it manually later. Same Lua either way.

### Keyboard shortcuts

| Shortcut         | Action            |
| ---------------- | ----------------- |
| ⌘ / ctrl + Z     | Undo              |
| ⌘ / ctrl + ⇧ + Z | Redo              |
| ⌘ / ctrl + Y     | Redo (Windows)    |
| ⌘ / ctrl + E     | Export layout JSON |
| Esc              | Clear selection   |

### Browser support

The "Run on iii" button uses the **Web Serial API**, which today only ships in Chromium-based browsers.

| Browser                         | Design layout | Download .lua | Run on iii |
| ------------------------------- | :-----------: | :-----------: | :--------: |
| Chrome / Edge / Arc / Brave     |       ✅       |       ✅       |     ✅      |
| Firefox / Safari (incl. iOS)    |       ✅       |       ✅       |     ❌      |
| Mobile (general)                | not yet adapted | — | — |

If your browser can't talk to USB, design + Download .lua works fine — drag the file into [diii](https://github.com/monome/diii) on a desktop with Chromium.

### Easter egg 🐍

Type `snake` anywhere in the web UI (outside an input field). A floating banner appears — click it to deploy a fully-playable snake game on your iii grid.

- D-pad in the bottom-right corner (4 cells, classic + cross)
- Each apple eaten plays the next chord in a random walk over a D-minor harmonic progression graph (i / ii° / III / iv / v / V / VI / VII)
- Death plays a sustained tonic Dm
- Auto-restart after the death-flash animation

## Install for development

The repo is a small pnpm monorepo:

```
monome-iii-studio/
├── apps/web/          # SolidJS + Vite + Tailwind front-end
└── packages/codegen/  # Pure-TypeScript Lua emitter (zero browser deps)
```

```bash
pnpm install           # install all workspace deps
pnpm dev               # start the web app on http://localhost:5173
pnpm test              # run all tests in all packages (golden Lua fixtures)
pnpm typecheck         # tsc --noEmit across everything
pnpm build             # production build (apps/web → static site)
```

The `codegen` package is **independent** — you can compile a `GridLayout` JSON into iii Lua programmatically without the web UI:

```ts
import { emit } from '@monome-iii-studio/codegen';

const lua = emit({
  version: 1,
  tool_version: '0.0.0',
  name: 'my-layout',
  width: 16,
  height: 8,
  active_page_index: 0,
  pages: [{ id: 'p1', name: 'main', regions: [/* … */] }],
});
```

### Testing

The codegen suite uses golden Lua fixtures: `__fixtures__/golden/*.input.json` →
`*.expected.lua`. Any change to emit output requires regenerating the affected
fixture and reviewing the diff:

```bash
cd packages/codegen
pnpm regen-fixture <fixture-name>     # e.g. pnpm regen-fixture lfo-sine-row
pnpm test                             # 30+ fixtures should still match
```

## Project notes

Internal design docs / decisions / discussions live in an Obsidian vault, not in this repo:

```
~/Documents/TestVault/10-projects/monome-iii-studio/
```

If you're contributing and want context for *why* something is built a certain way, that's where to look. The vault's engineering kickoff note describes the working agreements: think before acting, plan before executing, real tools over guessing.

## Hardware

- **monome Grid** — the original tactile button matrix. <https://monome.org/docs/grid/>
- **iii** — the Lua scripting environment that runs on a small Pi Pico daughterboard plugged into the Grid. Source: <https://codeberg.org/tehn/iii>. Filesystem API used by this project: `ls()`, `cat(file)`, `rm(file)`, `first(name)`, plus the `^^s` / `^^f` / `^^w` / `^^i` REPL commands documented in iii's `repl.c`.
- **diii** — the official Python REPL / uploader. monome-iii-studio reimplements its upload protocol in TypeScript so the browser can talk to the device directly. <https://github.com/monome/diii>

## Acknowledgements

monome (<https://monome.org>) for the hardware and the iii / diii open-source code we read while reverse-engineering the upload protocol.
