import type { Cell, MeterBehavior, Region } from '../types.ts';
import { lua1, luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import type { EmittedFragments } from './momentary.ts';

type MeterRegion = Region & { behavior: MeterBehavior };

export function emitMeter(region: MeterRegion): EmittedFragments {
  const { columns, yTop, height } = analyzeSelection(region.cells);
  const safeName = luaIdent(region.name);
  const handlerName = `handle_${safeName}`;
  const params = region.behavior.params;
  const stateSlot = `${safeName}_h`;
  const colTable = `_${safeName}_col`;
  const valuesTable = `_${safeName}_values`;

  // Cell → column-index-within-selection (0..numCols-1).
  // Each column has the same N cells (the full selection height).
  const colLines = region.cells
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((c) => `${colTable}[${luaKey(c)}] = ${columns.indexOf(c.x)}`)
    .join('\n');

  // Pre-compute the height → CC value table. height=0 → 0;
  // height=h → floor(h * 127 / H). height=H → 127.
  const values = computeMeterValues(height);
  const valuesEntries = values.map((v, i) => `[${i}]=${v}`).join(', ');

  // Initial state: all columns at height 1 (the bottom row of each
  // column lights up at script load, giving the user a visible baseline
  // before any interaction). The matching MIDI CC is also sent at init
  // so the DAW's parameter agrees with the LED state — see initLines
  // below.
  const stateInitEntries = columns
    .map((_, i) => `[${i}]=1`)
    .join(', ');

  const declarations = [
    `-- ---- region: ${safeName} ----`,
    `local ${colTable} = {}`,
    colLines,
    `local ${valuesTable} = {${valuesEntries}}`,
    '',
    `local function ${handlerName}(x, y, z)`,
    '  if z ~= 1 then return end',
    `  local col = ${colTable}[x + y*W]`,
    // y is 1-indexed at runtime (iii convention). yTop is 0-indexed in
    // our data model, so shift by +1 to compute the same height value.
    `  local h = ${height} - (y - ${lua1(yTop)})`,
    `  state.${stateSlot}[col] = h`,
    `  midi_cc(${params.base_cc} + col, ${valuesTable}[h], ${params.channel})`,
    'end',
  ].join('\n');

  // LED draw: per cell, ON iff its "distance from bottom" is < height.
  // Cell at (x, y) is at distance (yBottom - y) from the bottom; lit iff
  // state.<region>_h[col] > distance.
  const yBottom = yTop + height - 1;
  const ledLines = region.cells
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((c) => {
      const col = columns.indexOf(c.x);
      const distance = yBottom - c.y;
      return `  grid_led(${luaXY(c)}, state.${stateSlot}[${col}] > ${distance} and ${params.led_on} or ${params.led_off})`;
    })
    .join('\n');

  const drawBlock = [`  -- region: ${safeName}`, ledLines].join('\n');

  const routeAdditions = region.cells
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((c) => `_route[${luaKey(c)}] = ${handlerName}`);

  const stateInit = `${stateSlot} = {${stateInitEntries}},`;

  // Init MIDI: publish the height=1 CC for every column so the DAW's
  // parameter matches the visual state at boot.
  const initLines = columns.map(
    (_, i) =>
      `midi_cc(${params.base_cc + i}, ${valuesTable}[1], ${params.channel})`,
  );

  return {
    stateInit,
    declarations,
    drawBlock,
    routeAdditions,
    initLines,
  };
}

/**
 * Inspect the selection's geometry. Returns the sorted list of column
 * x-coordinates, the topmost y, and the column height (number of rows).
 *
 * No validation: the emitter assumes the UI has already enforced a
 * rectangular selection (every column has the same y range).
 */
function analyzeSelection(cells: Cell[]): {
  columns: number[];
  yTop: number;
  height: number;
} {
  const xs = Array.from(new Set(cells.map((c) => c.x))).sort((a, b) => a - b);
  const ys = cells.map((c) => c.y);
  const yTop = Math.min(...ys);
  const yBottom = Math.max(...ys);
  return {
    columns: xs,
    yTop,
    height: yBottom - yTop + 1,
  };
}

/**
 * Map height 0..H to MIDI CC values 0..127. height=0 → 0,
 * height=H → 127, intermediate values evenly spaced.
 */
function computeMeterValues(maxHeight: number): number[] {
  if (maxHeight <= 0) return [0];
  return Array.from({ length: maxHeight + 1 }, (_, h) =>
    Math.floor((h * 127) / maxHeight),
  );
}
