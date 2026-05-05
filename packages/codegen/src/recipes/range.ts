import type { Cell, RangeBehavior, Region } from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import type { EmittedFragments } from './momentary.ts';
import { computeRadioValues } from './radio.ts';

type RangeRegion = Region & { behavior: RangeBehavior };

export function emitRange(region: RangeRegion): EmittedFragments {
  const sortedCells = sortCells(region.cells);
  const safeName = luaIdent(region.name);
  const handlerName = `handle_${safeName}`;
  const params = region.behavior.params;
  const stateHeld = `${safeName}_held`;
  const stateCount = `${safeName}_count`;
  const stateLo = `${safeName}_lo`;
  const stateHi = `${safeName}_hi`;
  const stateSet = `${safeName}_set`;
  const idxTable = `_${safeName}_idx`;
  const valuesTable = `_${safeName}_values`;

  const idxLines = sortedCells
    .map((c, i) => `${idxTable}[${luaKey(c)}] = ${i}`)
    .join('\n');

  // Reuse Radio's 0..127 mapping. Range and Radio share the same
  // "N positions across the MIDI range" semantics.
  const values = computeRadioValues(sortedCells.length);
  const valuesEntries = values.map((v, i) => `[${i}]=${v}`).join(', ');

  const declarations = [
    `-- ---- region: ${safeName} ----`,
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
        `    grid_led(${luaXY(c)}, set and lo <= ${i} and ${i} <= hi and ${params.led_in_range} or ${params.led_out_range})`,
    )
    .join('\n');

  const drawBlock = [
    `  -- region: ${safeName}`,
    '  do',
    `    local set = state.${stateSet}`,
    `    local lo, hi = state.${stateLo}, state.${stateHi}`,
    ledLines,
    '  end',
  ].join('\n');

  const routeAdditions = sortedCells.map(
    (c) => `_route[${luaKey(c)}] = ${handlerName}`,
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
