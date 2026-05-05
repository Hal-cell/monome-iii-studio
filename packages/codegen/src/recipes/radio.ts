import type { Cell, RadioBehavior, Region } from '../types.ts';
import { luaKey, luaXY } from '../lua-coords.ts';
import type { EmittedFragments } from './momentary.ts';

type RadioRegion = Region & { behavior: RadioBehavior };

export function emitRadio(region: RadioRegion): EmittedFragments {
  const sortedCells = sortCells(region.cells);
  const handlerName = `handle_${region.name}`;
  const stateSlot = `${region.name}_index`;
  const idxTable = `_${region.name}_idx`;
  const valuesTable = `_${region.name}_values`;
  const params = region.behavior.params;

  const idxLines = sortedCells
    .map((c, i) => `${idxTable}[${luaKey(c)}] = ${i}`)
    .join('\n');

  const values = computeRadioValues(sortedCells.length);
  const valuesEntries = values.map((v, i) => `[${i}]=${v}`).join(', ');

  const declarations = [
    `-- ---- region: ${region.name} ----`,
    `local ${idxTable} = {}`,
    idxLines,
    `local ${valuesTable} = {${valuesEntries}}`,
    '',
    `local function ${handlerName}(x, y, z)`,
    '  if z ~= 1 then return end',
    `  state.${stateSlot} = ${idxTable}[x + y*W]`,
    `  midi_cc(${params.cc}, ${valuesTable}[state.${stateSlot}], ${params.channel})`,
    'end',
  ].join('\n');

  const ledLines = sortedCells
    .map(
      (c, i) =>
        `  grid_led(${luaXY(c)}, state.${stateSlot} == ${i} and ${params.led_on} or ${params.led_off})`,
    )
    .join('\n');

  const drawBlock = [`  -- region: ${region.name}`, ledLines].join('\n');

  const routeAdditions = sortedCells.map(
    (c) => `_route[${luaKey(c)}] = ${handlerName}`,
  );

  return {
    stateInit: `${stateSlot} = ${params.initial_index},`,
    declarations,
    drawBlock,
    routeAdditions,
  };
}

function sortCells(cells: Cell[]): Cell[] {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Map N evenly-spaced selection indices to MIDI CC values 0..127.
 *
 * N=1: [0]            (degenerate)
 * N=2: [0, 127]
 * N=4: [0, 42, 85, 127]
 * N=8: [0, 18, 36, 54, 72, 90, 108, 127]
 * N=16: [0, 8, 16, 25, 33, 42, 50, 59, 67, 76, 84, 93, 101, 110, 118, 127]
 *
 * Formula: floor(i * 127 / (N - 1)). Endpoints land exactly on 0 and 127.
 */
export function computeRadioValues(n: number): number[] {
  if (n <= 1) return [0];
  return Array.from({ length: n }, (_, i) => Math.floor((i * 127) / (n - 1)));
}
