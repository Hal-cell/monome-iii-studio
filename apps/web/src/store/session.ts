/**
 * Bridge between the in-memory stores (regions / selection / behavior)
 * and the JSON-shaped persistence layer in `lib/persist.ts`.
 *
 * Snapshot direction: stores → SessionState / LayoutExport.
 * Restore direction:  SessionState / LayoutExport → stores.
 *
 * Sets (cellKeys, selection) marshal as plain arrays in JSON.
 */

import { reconcile, unwrap } from 'solid-js/store';
import {
  type LayoutExport,
  type SavedRegionJSON,
  type SessionState,
  makeLayoutExport,
} from '../lib/persist.ts';
import {
  type SavedRegion,
  clearAllRegions,
  layoutName,
  regions,
  replaceAllRegions,
  setLayoutName,
} from './regions.ts';
import {
  mode,
  recipeKind,
  setMode,
  setRecipeKind,
  setValues,
  values,
} from './behavior.ts';
import { selection, setSelection } from './selection.ts';
import { beginApply, endApply, type LayoutSnapshot } from './history.ts';

export function serializeRegion(r: SavedRegion): SavedRegionJSON {
  return {
    id: r.id,
    name: r.name,
    cellKeys: Array.from(r.cellKeys),
    mode: r.mode,
    recipeKind: r.recipeKind,
    values: r.values,
    colorIndex: r.colorIndex,
  };
}

function deserializeRegion(r: SavedRegionJSON): SavedRegion {
  return {
    id: r.id,
    name: r.name,
    cellKeys: new Set(r.cellKeys),
    mode: r.mode,
    recipeKind: r.recipeKind,
    values: r.values,
    colorIndex: r.colorIndex,
  };
}

export function snapshotSession(): SessionState {
  return {
    ...makeLayoutExport(layoutName(), regions().map(serializeRegion)),
    selection: Array.from(selection()),
    recipeKind: recipeKind(),
    mode: mode(),
    // Deep clone via unwrap (drop proxy) + structuredClone (independent copy).
    // localStorage doesn't care, but keeping this consistent with addRegion.
    values: structuredClone(unwrap(values)),
  };
}

export function snapshotLayout(): LayoutExport {
  return makeLayoutExport(layoutName(), regions().map(serializeRegion));
}

export function restoreSession(saved: SessionState): void {
  setLayoutName(saved.layoutName);
  replaceAllRegions(saved.regions.map(deserializeRegion));
  setSelection(new Set<string>(saved.selection));
  setRecipeKind(saved.recipeKind);
  setMode(saved.mode);
  if (saved.values && Object.keys(saved.values).length > 0) {
    setValues(reconcile(saved.values));
  }
}

export function loadLayout(layout: LayoutExport): void {
  setLayoutName(layout.layoutName);
  replaceAllRegions(layout.regions.map(deserializeRegion));
  // Discard any in-progress editing state — imported layout starts
  // fresh from the user's perspective.
  setSelection(new Set<string>());
  setRecipeKind(null);
}

export function newLayout(): void {
  setLayoutName('untitled');
  clearAllRegions();
  setSelection(new Set<string>());
  setRecipeKind(null);
}

/**
 * Apply a history (undo / redo) snapshot back to the underlying
 * stores. Touches only the layout state — selection, recipe kind,
 * and in-progress param values are intentionally left alone, because
 * those represent the user's *current* draft, not the history line.
 *
 * Wrapped in beginApply/endApply so the auto-capture effect can tell
 * "this signal change is from undo, don't record it again".
 */
export function applyLayoutSnapshot(snap: LayoutSnapshot): void {
  beginApply();
  try {
    setLayoutName(snap.layoutName);
    replaceAllRegions(snap.regions.map(deserializeRegion));
  } finally {
    endApply();
  }
}
