/**
 * Saved regions: each represents a fully-configured slice of the grid
 * (cells + recipe + mode + params). The user freezes their current
 * editing state into a SavedRegion via the "Add Region" button. The
 * Download flow walks `regions()` to produce a multi-region GridLayout.
 *
 * Color: each region gets a `colorIndex` into REGION_PALETTE, picked
 * sequentially on creation. The Grid canvas paints saved-region cells
 * in their region's color so the user can see at a glance which cells
 * belong to which region.
 *
 * The active editing selection (whatever the user is currently picking)
 * paints in ACTIVE_FILL (amber). It always wins over saved-region
 * colors so the user can see what they're working on.
 */

import { createMemo, createSignal } from 'solid-js';
import type { RegionMode } from '@monome-iii-studio/codegen';
import type { BehaviorKind } from '../recipes/types.ts';
import { cellKey } from './selection.ts';

/** Soft pastel palette tuned to read well on monome's matte black. */
export const REGION_PALETTE: ReadonlyArray<string> = [
  '#9fd5d3', // teal
  '#c8b8e8', // lavender
  '#e8c5b0', // peach
  '#b0d4a8', // sage
  '#d8a8c8', // rose
  '#a8c5e8', // sky
  '#d8d4a0', // pale yellow
];

/** "Currently editing" colour — kept distinct from saved regions. */
export const ACTIVE_FILL = '#fbf2d4'; // amber, monome's warm-white LED

export type SavedRegion = {
  id: string;
  name: string;
  cellKeys: Set<string>;
  mode: RegionMode;
  recipeKind: BehaviorKind;
  /** Snapshot of the param form values at the moment Add Region was clicked. */
  values: Record<string, unknown>;
  colorIndex: number;
  /**
   * Which page this region lives on. Default 0. The codegen treats
   * page_select regions as globally active regardless of this value;
   * for every other recipe kind, the region is only active when its
   * pageIndex matches state.page.
   */
  pageIndex: number;
};

const [_regions, _setRegions] = createSignal<SavedRegion[]>([]);
export const regions = _regions;

const [_layoutName, _setLayoutName] = createSignal<string>('untitled');
export const layoutName = _layoutName;
export const setLayoutName = _setLayoutName;

// ---------- Pages ----------
//
// pageNames is the canonical source of "how many pages exist". The
// active page index is tracked separately so it can persist across
// session restores. Each region carries its own pageIndex; region
// list display is filtered by activePageIndex (with page_select
// regions always shown).

const [_pageNames, _setPageNames] = createSignal<string[]>(['main']);
export const pageNames = _pageNames;

const [_activePageIndex, _setActivePageIndex] = createSignal<number>(0);
export const activePageIndex = _activePageIndex;
export function setActivePageIndex(i: number): void {
  if (i < 0 || i >= _pageNames().length) return;
  _setActivePageIndex(i);
}

export function addPage(name?: string): number {
  const next = _pageNames().length;
  const auto = name ?? `p${next + 1}`;
  _setPageNames([..._pageNames(), auto]);
  _setActivePageIndex(next);
  return next;
}

export function renamePage(i: number, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  _setPageNames(_pageNames().map((n, k) => (k === i ? trimmed : n)));
}

/**
 * Remove a page and any regions that lived on it. Active page falls
 * back to 0 if the deleted page was active. Refuses to delete the
 * last remaining page, AND refuses to delete page 0 (the "main"
 * page) — keeping a fixed anchor at index 0 means region/page
 * indices never reshuffle out from under saved layouts.
 */
export function removePage(i: number): void {
  const names = _pageNames();
  if (names.length <= 1) return;
  if (i === 0) return;
  if (i < 0 || i >= names.length) return;
  // Drop regions on this page; shift later regions' pageIndex down.
  _setRegions((prev) =>
    prev
      .filter((r) => r.pageIndex !== i)
      .map((r) =>
        r.pageIndex > i ? { ...r, pageIndex: r.pageIndex - 1 } : r,
      ),
  );
  _setPageNames(names.filter((_, k) => k !== i));
  if (_activePageIndex() >= _pageNames().length) {
    _setActivePageIndex(_pageNames().length - 1);
  } else if (_activePageIndex() > i) {
    _setActivePageIndex(_activePageIndex() - 1);
  }
}

export function setPageNames(names: string[]): void {
  _setPageNames(names.length > 0 ? names : ['main']);
  if (_activePageIndex() >= _pageNames().length) {
    _setActivePageIndex(0);
  }
}

let _idCounter = 1;

/**
 * Auto-name the next region. Scans the current region list for default
 * names matching `region_N` and picks the smallest N not in use, so
 * deleting a region frees its number for re-use rather than letting the
 * counter monotonically climb. User-renamed regions still participate
 * in the scan — we won't shadow `region_5` even if a user renamed
 * something to that.
 */
function nextDefaultName(): string {
  const used = new Set<number>();
  for (const r of regions()) {
    const m = /^region_(\d+)$/.exec(r.name);
    if (m) used.add(parseInt(m[1]!, 10));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `region_${n}`;
}

export function addRegion(input: {
  cellKeys: Set<string>;
  mode: RegionMode;
  recipeKind: BehaviorKind;
  values: Record<string, unknown>;
  /** Which page to add this region to. Defaults to the active page. */
  pageIndex?: number;
}): SavedRegion {
  const region: SavedRegion = {
    id: `r-${_idCounter++}`,
    // Default name uses underscore so it lands in Lua as a valid
    // identifier without sanitization. The codegen sanitizes anyway
    // (defensive), but a clean default avoids the surprise of
    // `region-1` becoming `region_1` only after download.
    name: nextDefaultName(),
    cellKeys: input.cellKeys,
    mode: input.mode,
    recipeKind: input.recipeKind,
    values: input.values,
    colorIndex: regions().length % REGION_PALETTE.length,
    pageIndex: input.pageIndex ?? _activePageIndex(),
  };
  _setRegions((prev) => [...prev, region]);
  return region;
}

export function removeRegion(id: string): void {
  _setRegions((prev) => prev.filter((r) => r.id !== id));
}

/**
 * Replace the entire region list. Used by session restore and layout
 * import. Bumps the internal id counter past the largest value present
 * so future regions don't collide with imported ones. Names auto-fill
 * gaps so they don't need a counter.
 */
export function replaceAllRegions(newRegions: SavedRegion[]): void {
  _setRegions(newRegions);
  for (const r of newRegions) {
    const idMatch = /^r-(\d+)$/.exec(r.id);
    if (idMatch) {
      _idCounter = Math.max(_idCounter, parseInt(idMatch[1]!, 10) + 1);
    }
  }
}

/** Clear the entire region list and reset the id counter. */
export function clearAllRegions(): void {
  _setRegions([]);
  _idCounter = 1;
  _setPageNames(['main']);
  _setActivePageIndex(0);
}

export function renameRegion(id: string, name: string): void {
  _setRegions((prev) =>
    prev.map((r) => (r.id === id ? { ...r, name } : r)),
  );
}

/**
 * O(1) cell → region lookup, refreshed on every regions or active-page
 * change. Filters to regions on the active page, plus page_select
 * regions (which are globally visible — they're meant to always show
 * so the user can switch pages from anywhere). Cells that belong to
 * an inactive page's region appear empty on the canvas, just like
 * they will on the iii grid hardware once the layout runs.
 */
const cellOwnership = createMemo(() => {
  const map = new Map<string, SavedRegion>();
  const activePage = _activePageIndex();
  for (const r of regions()) {
    if (r.recipeKind !== 'page_select' && r.pageIndex !== activePage) continue;
    for (const k of r.cellKeys) {
      map.set(k, r);
    }
  }
  return map;
});

export function findRegionForCell(
  x: number,
  y: number,
): SavedRegion | undefined {
  return cellOwnership().get(cellKey(x, y));
}

export function regionColor(region: SavedRegion): string {
  return REGION_PALETTE[region.colorIndex % REGION_PALETTE.length]!;
}

export function totalRegionCells(): number {
  let n = 0;
  for (const r of regions()) n += r.cellKeys.size;
  return n;
}
