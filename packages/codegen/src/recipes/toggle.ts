import type { Cell, Region, ToggleBehavior, ToggleParams } from '../types.ts';
import { luaKey, luaXY } from '../lua-coords.ts';
import type { EmittedFragments } from './momentary.ts';

type ToggleRegion = Region & { behavior: ToggleBehavior };

export function emitToggle(region: ToggleRegion): EmittedFragments {
  const sortedCells = sortCells(region.cells);
  const handlerName = `handle_${region.name}`;

  const routeAdditions = sortedCells.map(
    (c) => `_route[${luaKey(c)}] = ${handlerName}`,
  );

  const fragments =
    region.mode === 'per_cell'
      ? emitPerCell(region.name, sortedCells, handlerName, region.behavior.params)
      : emitGroup(region.name, sortedCells, handlerName, region.behavior.params);

  return { ...fragments, routeAdditions };
}

function sortCells(cells: Cell[]): Cell[] {
  return [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
}

// ---------- per_cell ----------

function emitPerCell(
  name: string,
  cells: Cell[],
  handlerName: string,
  params: ToggleParams,
): Omit<EmittedFragments, 'routeAdditions'> {
  const stateSlot = `${name}_on`;
  const idxTable = `_${name}_idx`;

  const idxLines = cells
    .map((c, i) => `${idxTable}[${luaKey(c)}] = ${i}`)
    .join('\n');

  const declarations = [
    `-- ---- region: ${name} ----`,
    `local ${idxTable} = {}`,
    idxLines,
    '',
    `local function ${handlerName}(x, y, z)`,
    '  if z ~= 1 then return end',
    `  local idx = ${idxTable}[x + y*W]`,
    `  state.${stateSlot}[x + y*W] = not state.${stateSlot}[x + y*W]`,
    `  midi_cc(${params.cc} + idx, state.${stateSlot}[x + y*W] and ${params.on_value} or ${params.off_value}, ${params.channel})`,
    'end',
  ].join('\n');

  const ledLines = cells
    .map(
      (c) =>
        `  grid_led(${luaXY(c)}, state.${stateSlot}[${luaKey(c)}] and ${params.led_on} or ${params.led_off})`,
    )
    .join('\n');

  const drawBlock = [`  -- region: ${name}`, ledLines].join('\n');

  return {
    stateInit: `${stateSlot} = {},`,
    declarations,
    drawBlock,
  };
}

// ---------- group ----------

function emitGroup(
  name: string,
  cells: Cell[],
  handlerName: string,
  params: ToggleParams,
): Omit<EmittedFragments, 'routeAdditions'> {
  const stateSlot = `${name}_on`;

  const declarations = [
    `-- ---- region: ${name} ----`,
    `local function ${handlerName}(x, y, z)`,
    '  if z ~= 1 then return end',
    `  state.${stateSlot} = not state.${stateSlot}`,
    `  midi_cc(${params.cc}, state.${stateSlot} and ${params.on_value} or ${params.off_value}, ${params.channel})`,
    'end',
  ].join('\n');

  const ledLines = cells
    .map((c) => `    grid_led(${luaXY(c)}, lit)`)
    .join('\n');

  const drawBlock = [
    `  -- region: ${name}`,
    '  do',
    `    local lit = state.${stateSlot} and ${params.led_on} or ${params.led_off}`,
    ledLines,
    '  end',
  ].join('\n');

  return {
    stateInit: `${stateSlot} = false,`,
    declarations,
    drawBlock,
  };
}
