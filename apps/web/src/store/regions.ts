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
};

const [_regions, _setRegions] = createSignal<SavedRegion[]>([]);
export const regions = _regions;

const [_layoutName, _setLayoutName] = createSignal<string>('untitled');
export const layoutName = _layoutName;
export const setLayoutName = _setLayoutName;

let _idCounter = 1;
let _nameCounter = 1;

export function addRegion(input: {
  cellKeys: Set<string>;
  mode: RegionMode;
  recipeKind: BehaviorKind;
  values: Record<string, unknown>;
}): SavedRegion {
  const region: SavedRegion = {
    id: `r-${_idCounter++}`,
    // Default name uses underscore so it lands in Lua as a valid
    // identifier without sanitization. The codegen sanitizes anyway
    // (defensive), but a clean default avoids the surprise of
    // `region-1` becoming `region_1` only after download.
    name: `region_${_nameCounter++}`,
    cellKeys: input.cellKeys,
    mode: input.mode,
    recipeKind: input.recipeKind,
    values: input.values,
    colorIndex: regions().length % REGION_PALETTE.length,
  };
  _setRegions((prev) => [...prev, region]);
  return region;
}

export function removeRegion(id: string): void {
  _setRegions((prev) => prev.filter((r) => r.id !== id));
}

/**
 * Replace the entire region list. Used by session restore and layout
 * import. Bumps the internal id/name counters past the largest values
 * present so future auto-named regions don't collide with imported
 * ones.
 */
export function replaceAllRegions(newRegions: SavedRegion[]): void {
  _setRegions(newRegions);
  for (const r of newRegions) {
    const idMatch = /^r-(\d+)$/.exec(r.id);
    if (idMatch) {
      _idCounter = Math.max(_idCounter, parseInt(idMatch[1]!, 10) + 1);
    }
    const nameMatch = /^region_(\d+)$/.exec(r.name);
    if (nameMatch) {
      _nameCounter = Math.max(_nameCounter, parseInt(nameMatch[1]!, 10) + 1);
    }
  }
}

/** Clear the entire region list and reset the auto-name counters. */
export function clearAllRegions(): void {
  _setRegions([]);
  _idCounter = 1;
  _nameCounter = 1;
}

export function renameRegion(id: string, name: string): void {
  _setRegions((prev) =>
    prev.map((r) => (r.id === id ? { ...r, name } : r)),
  );
}

/** O(1) cell → region lookup, refreshed on every regions change. */
const cellOwnership = createMemo(() => {
  const map = new Map<string, SavedRegion>();
  for (const r of regions()) {
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
