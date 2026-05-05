/**
 * iii's Lua API uses 1-indexed grid coordinates: x ∈ 1..W, y ∈ 1..H.
 * Our TypeScript data model uses 0-indexed cells (matching CSS / SVG /
 * the serialosc protocol convention) because that's what the UI works
 * in. We shift by +1 only at emit time, so the runtime Lua sees a
 * consistent 1-indexed scheme that matches what `event_grid` and
 * `grid_led` expect.
 *
 * Verified empirically on Grid 128 (2025) running iii firmware:
 *   grid_led(0, 0, 15)  → no LED lit (x=0 invalid)
 *   grid_led(15, 0, 15) → no LED lit (y=0 invalid)
 *   grid_led(15, 7, 15) → lights at hardware "column 15, row 7"
 *                         which the user reads as "15 from left,
 *                         2 from bottom" — confirming x ∈ 1..16,
 *                         y ∈ 1..8.
 *
 * Use these helpers anywhere a cell coord is interpolated into emitted
 * Lua. Internal selection-local indices (row/col within a region,
 * step counters, etc.) are NOT shifted — they stay 0-indexed because
 * they never reach the iii API.
 */

import type { Cell } from './types.ts';

/**
 * Lua expression for the route / state / lookup-table key for `cell`.
 * Used as `${luaKey(c)}` inside template literals.
 */
export function luaKey(cell: Cell): string {
  return `${cell.x + 1} + ${cell.y + 1}*W`;
}

/**
 * Lua coords for `grid_led(x, y, ...)`. Used as `grid_led(${luaXY(c)}, …)`.
 */
export function luaXY(cell: Cell): string {
  return `${cell.x + 1}, ${cell.y + 1}`;
}

/** Shift a single grid axis to its 1-indexed Lua value. */
export function lua1(coord: number): number {
  return coord + 1;
}
