import type {
  Cell,
  Region,
  StepSequencerBehavior,
  StepSequencerParams,
} from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import type { EmittedFragments } from './momentary.ts';

type StepSeqRegion = Region & { behavior: StepSequencerBehavior };

export function emitStepSequencer(region: StepSeqRegion): EmittedFragments {
  const { xLeft, yTop, height, numCols } = analyzeRect(region.cells);
  const numRows = height;
  const params = region.behavior.params;
  const name = luaIdent(region.name);

  const handlerName = `handle_${name}`;
  const tickName = `_${name}_tick`;
  const pixelName = `_${name}_pixel`;
  const rowTable = `_${name}_row`;
  const colTable = `_${name}_col`;
  const stepSlot = `${name}_step`;
  const onSlot = `${name}_on`;
  const gateSlot = `${name}_gate`;
  const dirSlot = `${name}_dir`;
  const metroVar = `_${name}_metro`;
  const valuesTable =
    params.output_mode === 'note_per_row'
      ? `_${name}_notes`
      : `_${name}_ccs`;
  const baseValue =
    params.output_mode === 'note_per_row' ? params.base_note : params.base_cc;

  const tickSeconds = 60 / params.bpm / params.steps_per_beat;

  // Sort cells row-major for emission consistency.
  const sortedCells = [...region.cells].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );

  const rowLines = sortedCells
    .map((c) => `${rowTable}[${luaKey(c)}] = ${c.y - yTop}`)
    .join('\n');
  const colLines = sortedCells
    .map((c) => `${colTable}[${luaKey(c)}] = ${c.x - xLeft}`)
    .join('\n');

  const valuesEntries = Array.from(
    { length: numRows },
    (_, r) => `[${r}]=${baseValue + r}`,
  ).join(', ');

  const tickBody = buildTickBody(
    params,
    numRows,
    numCols,
    name,
    valuesTable,
  );

  const declarations = [
    `-- ---- region: ${name} ----`,
    `local ${rowTable} = {}`,
    rowLines,
    `local ${colTable} = {}`,
    colLines,
    `local ${valuesTable} = {${valuesEntries}}`,
    '',
    `local function ${tickName}()`,
    ...tickBody.map((l) => `  ${l}`),
    'end',
    '',
    `local function ${handlerName}(x, y, z)`,
    '  if z ~= 1 then return end',
    `  local r = ${rowTable}[x + y*W]`,
    `  local c = ${colTable}[x + y*W]`,
    `  state.${onSlot}[r][c] = not state.${onSlot}[r][c]`,
    'end',
    '',
    `local function ${pixelName}(row, col)`,
    `  local is_step = col == state.${stepSlot}`,
    `  local is_on = state.${onSlot}[row][col]`,
    '  if is_step then',
    `    return is_on and ${params.led_current_on} or ${params.led_current_off}`,
    '  else',
    `    return is_on and ${params.led_not_current_on} or ${params.led_not_current_off}`,
    '  end',
    'end',
    '',
    `local ${metroVar} = metro.init(${tickName}, ${tickSeconds})`,
    `${metroVar}:start()`,
  ].join('\n');

  const ledLines = sortedCells
    .map((c) => {
      const row = c.y - yTop;
      const col = c.x - xLeft;
      return `  grid_led(${luaXY(c)}, ${pixelName}(${row}, ${col}))`;
    })
    .join('\n');

  const drawBlock = [`  -- region: ${name}`, ledLines].join('\n');

  const routeAdditions = sortedCells.map(
    (c) => `_route[${luaKey(c)}] = ${handlerName}`,
  );

  // State init:
  //   step:  -1 so first forward tick lands on 0; reverse on numCols-1
  //   on:    nested per-row table, cells default to nil = off
  //   gate:  per-row remaining-ticks counter (0 = no note playing)
  //   dir:   pingpong walk direction (always +1 initially; unused for
  //          forward/reverse but harmless)
  const onTableInit = `{${Array.from(
    { length: numRows },
    (_, r) => `[${r}]={}`,
  ).join(', ')}}`;
  const gateTableInit = `{${Array.from(
    { length: numRows },
    (_, r) => `[${r}]=0`,
  ).join(', ')}}`;

  const stateInit = [
    `${stepSlot} = -1,`,
    `${onSlot} = ${onTableInit},`,
    `${gateSlot} = ${gateTableInit},`,
    `${dirSlot} = 1,`,
  ].join('\n');

  return {
    stateInit,
    declarations,
    drawBlock,
    routeAdditions,
  };
}

function buildTickBody(
  params: StepSequencerParams,
  numRows: number,
  numCols: number,
  name: string,
  valuesTable: string,
): string[] {
  const stepSlot = `${name}_step`;
  const onSlot = `${name}_on`;
  const gateSlot = `${name}_gate`;
  const dirSlot = `${name}_dir`;

  const closeCall =
    params.output_mode === 'note_per_row'
      ? `midi_note_off(${valuesTable}[r], 0, ${params.channel})`
      : `midi_cc(${valuesTable}[r], ${params.off_value}, ${params.channel})`;

  const openCall =
    params.output_mode === 'note_per_row'
      ? `midi_note_on(${valuesTable}[r], ${params.velocity}, ${params.channel})`
      : `midi_cc(${valuesTable}[r], ${params.on_value}, ${params.channel})`;

  const advance = buildAdvance(params.direction, numCols, stepSlot, dirSlot);

  return [
    '-- 1. tick down each row\'s gate; close any that just expired',
    `for r = 0, ${numRows - 1} do`,
    `  if state.${gateSlot}[r] > 0 then`,
    `    state.${gateSlot}[r] = state.${gateSlot}[r] - 1`,
    `    if state.${gateSlot}[r] == 0 then`,
    `      ${closeCall}`,
    '    end',
    '  end',
    'end',
    '-- 2. advance the playhead',
    ...advance,
    '-- 3. fire any rows that are on at the new step (retrigger if the gate is still open)',
    `for r = 0, ${numRows - 1} do`,
    `  if state.${onSlot}[r][state.${stepSlot}] then`,
    `    if state.${gateSlot}[r] > 0 then`,
    `      ${closeCall}`,
    '    end',
    `    ${openCall}`,
    `    state.${gateSlot}[r] = ${params.gate_length}`,
    '  end',
    'end',
    '-- 4. repaint so the playhead position is visible on the grid',
    'redraw()',
  ];
}

function buildAdvance(
  direction: StepSequencerParams['direction'],
  numCols: number,
  stepSlot: string,
  dirSlot: string,
): string[] {
  switch (direction) {
    case 'reverse':
      return [
        `state.${stepSlot} = state.${stepSlot} - 1`,
        `if state.${stepSlot} < 0 then state.${stepSlot} = ${numCols - 1} end`,
      ];
    case 'pingpong':
      return [
        `state.${stepSlot} = state.${stepSlot} + state.${dirSlot}`,
        `if state.${stepSlot} >= ${numCols} then`,
        `  state.${stepSlot} = ${numCols - 2}`,
        `  state.${dirSlot} = -1`,
        `elseif state.${stepSlot} < 0 then`,
        `  state.${stepSlot} = 1`,
        `  state.${dirSlot} = 1`,
        'end',
      ];
    case 'forward':
    default:
      return [
        `state.${stepSlot} = (state.${stepSlot} + 1) % ${numCols}`,
      ];
  }
}

function analyzeRect(cells: Cell[]): {
  xLeft: number;
  yTop: number;
  height: number;
  numCols: number;
} {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const xLeft = Math.min(...xs);
  const xRight = Math.max(...xs);
  const yTop = Math.min(...ys);
  const yBottom = Math.max(...ys);
  return {
    xLeft,
    yTop,
    height: yBottom - yTop + 1,
    numCols: xRight - xLeft + 1,
  };
}
