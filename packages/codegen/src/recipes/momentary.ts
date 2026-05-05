import type {
  Cell,
  MomentaryBehavior,
  MomentaryParams,
  Region,
} from '../types.ts';
import { luaKey, luaXY } from '../lua-coords.ts';

/**
 * Lua source fragments contributed by a single region.
 * The orchestrator (emit.ts) interleaves fragments from all regions into
 * the final script.
 */
export type EmittedFragments = {
  /** Single line for the `state` table init, e.g. `notes_held = {},` */
  stateInit: string;
  /** Module-scope declarations: per-region idx table + handler fn */
  declarations: string;
  /** Lines that go inside redraw() for this region's LED pass */
  drawBlock: string;
  /** `_route[…] = handle_<name>` lines, one per cell */
  routeAdditions: string[];
};

type MomentaryRegion = Region & { behavior: MomentaryBehavior };

export function emitMomentary(region: MomentaryRegion): EmittedFragments {
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
  params: MomentaryParams,
): Omit<EmittedFragments, 'routeAdditions'> {
  const stateSlot = `${name}_held`;
  const idxTable = `_${name}_idx`;

  const idxLines = cells
    .map((c, i) => `${idxTable}[${luaKey(c)}] = ${i}`)
    .join('\n');

  const handlerBody = perCellHandlerBody(stateSlot, params)
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');

  const declarations = [
    `-- ---- region: ${name} ----`,
    `local ${idxTable} = {}`,
    idxLines,
    '',
    `local function ${handlerName}(x, y, z)`,
    `  local idx = ${idxTable}[x + y*W]`,
    handlerBody,
    'end',
  ].join('\n');

  const ledLines = cells
    .map(
      (c) =>
        `  grid_led(${luaXY(c)}, state.${stateSlot}[${luaKey(c)}] and ${params.led_held} or ${params.led_idle})`,
    )
    .join('\n');

  const drawBlock = [`  -- region: ${name}`, ledLines].join('\n');

  return {
    stateInit: `${stateSlot} = {},`,
    declarations,
    drawBlock,
  };
}

function perCellHandlerBody(stateSlot: string, params: MomentaryParams): string {
  const onLine =
    params.output_type === 'note'
      ? `midi_note_on(${params.note} + idx, ${params.velocity}, ${params.channel})`
      : `midi_cc(${params.cc} + idx, 127, ${params.channel})`;
  const offLine =
    params.output_type === 'note'
      ? `midi_note_off(${params.note} + idx, 0, ${params.channel})`
      : `midi_cc(${params.cc} + idx, 0, ${params.channel})`;

  return [
    'if z == 1 then',
    `  ${onLine}`,
    `  state.${stateSlot}[x + y*W] = true`,
    'else',
    `  ${offLine}`,
    `  state.${stateSlot}[x + y*W] = nil`,
    'end',
  ].join('\n');
}

// ---------- group ----------

function emitGroup(
  name: string,
  cells: Cell[],
  handlerName: string,
  params: MomentaryParams,
): Omit<EmittedFragments, 'routeAdditions'> {
  const stateSlot = `${name}_count`;

  const onLine =
    params.output_type === 'note'
      ? `midi_note_on(${params.note}, ${params.velocity}, ${params.channel})`
      : `midi_cc(${params.cc}, 127, ${params.channel})`;
  const offLine =
    params.output_type === 'note'
      ? `midi_note_off(${params.note}, 0, ${params.channel})`
      : `midi_cc(${params.cc}, 0, ${params.channel})`;

  const declarations = [
    `-- ---- region: ${name} ----`,
    `local function ${handlerName}(x, y, z)`,
    '  if z == 1 then',
    `    state.${stateSlot} = state.${stateSlot} + 1`,
    `    if state.${stateSlot} == 1 then`,
    `      ${onLine}`,
    '    end',
    '  else',
    `    state.${stateSlot} = state.${stateSlot} - 1`,
    `    if state.${stateSlot} == 0 then`,
    `      ${offLine}`,
    '    end',
    '  end',
    'end',
  ].join('\n');

  const ledLines = cells
    .map((c) => `    grid_led(${luaXY(c)}, lit)`)
    .join('\n');

  const drawBlock = [
    `  -- region: ${name}`,
    '  do',
    `    local lit = state.${stateSlot} > 0 and ${params.led_held} or ${params.led_idle}`,
    ledLines,
    '  end',
  ].join('\n');

  return {
    stateInit: `${stateSlot} = 0,`,
    declarations,
    drawBlock,
  };
}
