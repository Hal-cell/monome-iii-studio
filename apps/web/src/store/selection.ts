/**
 * Selection store: which cells the user has chosen + an in-progress
 * drag-select gesture.
 *
 * Cells are encoded as `"x,y"` strings inside the `Set<string>` so we
 * can rely on Set semantics. Helpers convert back to {x, y} when the
 * codegen consumer needs structured cells.
 */

import { createSignal } from 'solid-js';
import type { Cell } from '@monome-iii-studio/codegen';

// Grid hardware: 16x8 hardwired for v0. (Grid 64 / 8x8 support is a
// follow-up.)
export const COLS = 16;
export const ROWS = 8;

// ---------- key encoding ----------

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function keyToCell(key: string): Cell {
  const [x, y] = key.split(',').map(Number);
  return { x: x ?? 0, y: y ?? 0 };
}

// ---------- selection ----------

export const [selection, setSelection] = createSignal<Set<string>>(new Set());

export function isCellSelected(x: number, y: number): boolean {
  return selection().has(cellKey(x, y));
}

export function clearSelection(): void {
  setSelection(new Set<string>());
}

// ---------- drag gesture ----------

type DragState = {
  start: Cell;
  current: Cell;
  /** Whether the gesture started with the shift key — additive vs replace. */
  shift: boolean;
};

export const [drag, setDrag] = createSignal<DragState | null>(null);

function dragRect(d: DragState): { x1: number; x2: number; y1: number; y2: number } {
  return {
    x1: Math.min(d.start.x, d.current.x),
    x2: Math.max(d.start.x, d.current.x),
    y1: Math.min(d.start.y, d.current.y),
    y2: Math.max(d.start.y, d.current.y),
  };
}

export function isCellInDrag(x: number, y: number): boolean {
  const d = drag();
  if (!d) return false;
  const r = dragRect(d);
  return x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
}

export function dragRectCells(d: DragState): Cell[] {
  const r = dragRect(d);
  const out: Cell[] = [];
  for (let y = r.y1; y <= r.y2; y++) {
    for (let x = r.x1; x <= r.x2; x++) {
      out.push({ x, y });
    }
  }
  return out;
}

export function startDrag(x: number, y: number, shift: boolean): void {
  setDrag({ start: { x, y }, current: { x, y }, shift });
}

export function updateDrag(x: number, y: number): void {
  const d = drag();
  if (!d) return;
  if (d.current.x === x && d.current.y === y) return;
  setDrag({ ...d, current: { x, y } });
}

export function commitDrag(): void {
  const d = drag();
  if (!d) return;
  const cells = dragRectCells(d);
  setSelection((prev) => {
    if (d.shift) {
      // Additive toggle: if every cell in the rect is already selected,
      // remove them; otherwise add them all.
      const allSelected = cells.every((c) => prev.has(cellKey(c.x, c.y)));
      const next = new Set(prev);
      for (const c of cells) {
        const k = cellKey(c.x, c.y);
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    }
    // Non-shift: replace selection with the rect. Single-cell click
    // on the lone selected cell deselects it.
    if (
      cells.length === 1 &&
      prev.size === 1 &&
      prev.has(cellKey(cells[0]!.x, cells[0]!.y))
    ) {
      return new Set<string>();
    }
    return new Set<string>(cells.map((c) => cellKey(c.x, c.y)));
  });
  setDrag(null);
}
