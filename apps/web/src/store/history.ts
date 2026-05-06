/**
 * Undo / redo history. We snapshot only the *committed* layout state
 * (layout name + regions) — not the in-progress editor state
 * (selection, recipe kind, in-progress param values), because those
 * are "drafts" the user hasn't actually committed yet. Each region
 * add / delete / rename / re-colour pushes a new snapshot via the
 * tracking effect in App.tsx.
 *
 * `applyHistorySnapshot` writes a snapshot back to the underlying
 * stores. We guard against the resulting effect re-pushing the same
 * snapshot via the `_applying` flag.
 */

import { createSignal } from 'solid-js';
import type { SavedRegionJSON } from '../lib/persist.ts';

export type LayoutSnapshot = {
  layoutName: string;
  regions: SavedRegionJSON[];
};

const MAX_HISTORY = 50;

const [_history, _setHistory] = createSignal<LayoutSnapshot[]>([]);
const [_cursor, _setCursor] = createSignal(-1);

let _applying = false;

export const canUndo = () => _cursor() > 0;
export const canRedo = () => _cursor() < _history().length - 1;
export const isApplying = () => _applying;

/**
 * Push a snapshot. No-op if currently applying a history snapshot
 * (avoids the "undo immediately re-records the same state" loop) or
 * if the new snapshot is identical to the head.
 */
export function captureSnapshot(snap: LayoutSnapshot): void {
  if (_applying) return;

  const stack = _history();
  const cursor = _cursor();

  // Compare to the current top by serialised form. JSON is fine here:
  // snapshots top out at maybe a few KB and capture happens at human
  // editing speed, not in a hot loop.
  const top = stack[cursor];
  if (top && JSON.stringify(top) === JSON.stringify(snap)) return;

  // If the user undid and is now making a new change, drop the
  // forward-redo branch — the new edit becomes the new tip.
  const truncated = stack.slice(0, cursor + 1);
  truncated.push(snap);

  // Cap the stack so history can't grow unboundedly. Drop oldest.
  while (truncated.length > MAX_HISTORY) truncated.shift();

  _setHistory(truncated);
  _setCursor(truncated.length - 1);
}

export function undo(): LayoutSnapshot | null {
  if (!canUndo()) return null;
  const next = _cursor() - 1;
  _setCursor(next);
  return _history()[next] ?? null;
}

export function redo(): LayoutSnapshot | null {
  if (!canRedo()) return null;
  const next = _cursor() + 1;
  _setCursor(next);
  return _history()[next] ?? null;
}

/**
 * Mark the start of a history-applied mutation. Wrap the actual
 * setLayoutName / replaceAllRegions calls between begin and end.
 * The flag suppresses re-capture while Solid effects fire.
 */
export function beginApply(): void {
  _applying = true;
}

export function endApply(): void {
  // Effects fire synchronously on signal changes in Solid, but defer
  // the flag reset to a microtask so any batched effects have a
  // chance to run with the flag still set.
  queueMicrotask(() => {
    _applying = false;
  });
}

/**
 * Reset the history to a single starting snapshot (initial app load
 * or after import / new layout). Called from App.tsx after the
 * session has been restored.
 */
export function resetHistory(initial: LayoutSnapshot): void {
  _setHistory([initial]);
  _setCursor(0);
}
