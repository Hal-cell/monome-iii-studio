import type { Cell, RangeBehavior, Region } from '../types.ts';
import type { EmittedFragments } from './momentary.ts';
import { computeRadioValues } from './radio.ts';

type RangeRegion = Region & { behavior: RangeBehavior };

export function emitRange(region: RangeRegion): EmittedFragments {
  const sortedCells = sortCells(region.cells);
  const handlerName = `handle_${region.name}`;
  const params = region.behavior.params;
  const stateHeld = `${region.name}_held`;
  const stateCount = `${region.name}_count`;
  const stateLo = `${region.name}_lo`;
  const stateHi = `${region.name}_hi`;
  const stateSet = `${region.name}_set`;
  const idxTable = `_${region.name}_idx`;
  const valuesTable = `_${region.name}_values`;

  const idxLines = sortedCells
    .map((c, i) => `${idxTable}[${c.x} + ${c.y}*W] = ${i}`)
    .join('\n');

  // Reuse Radio's 0..127 mapping. Range and Radio share the same
  // "N positions across the MIDI range" semantics.
  const values = computeRadioValues(sortedCells.length);
  const valuesEntries = values.map((v, i) => `[${i}]=${v}`).join(', ');

  const declarations = [
    `-- ---- region: ${region.name} ----`,
    `local ${idxTable} = {}`,
    idxLines,
    `local ${valuesTable} = {${valuesEntries}}`,
    '',
    `local function ${handlerName}(x, y, z)`,
    `  local idx = ${idxTable}[x + y*W]`,
    '  if z == 1 then',
    `    state.${stateHeld}[idx] = true`,
    `    state.${stateCount} = state.${stateCount} + 1`,
    '    local lo, hi',
    `    for i, _ in pairs(state.${stateHeld}) do`,
    '      if not lo or i < lo then lo = i end',
    '      if not hi or i > hi then hi = i end',
    '    end',
    `    state.${stateLo} = lo`,
    `    state.${stateHi} = hi`,
    `    state.${stateSet} = true`,
    `    midi_cc(${params.cc_low}, ${valuesTable}[lo], ${params.channel})`,
    `    midi_cc(${params.cc_high}, ${valuesTable}[hi], ${params.channel})`,
    '  else',
    `    state.${stateHeld}[idx] = nil`,
    `    state.${stateCount} = state.${stateCount} - 1`,
    '  end',
    'end',
  ].join('\n');

  const ledLines = sortedCells
    .map(
      (c, i) =>
        `    grid_led(${c.x}, ${c.y}, set and lo <= ${i} and ${i} <= hi and ${params.led_in_range} or ${params.led_out_range})`,
    )
    .join('\n');

  const drawBlock = [
    `  -- region: ${region.name}`,
    '  do',
    `    local set = state.${stateSet}`,
    `    local lo, hi = state.${stateLo}, state.${stateHi}`,
    ledLines,
    '  end',
  ].join('\n');

  const routeAdditions = sortedCells.map(
    (c) => `_route[${c.x} + ${c.y}*W] = ${handlerName}`,
  );

  const stateInit = [
    `${stateHeld} = {},`,
    `${stateCount} = 0,`,
    `${stateLo} = 0,`,
    `${stateHi} = 0,`,
    `${stateSet} = false,`,
  ].join('\n');

  return {
    stateInit,
    declarations,
    drawBlock,
    routeAdditions,
  };
}

function sortCells(cells: Cell[]): Cell[] {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}
