import type {
  Cell,
  Region,
  StepSequencerBehavior,
  StepSequencerParams,
} from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import { noteAtDegree } from '../scales.ts';
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
  const divsTable = `_${name}_divs`;
  const stepSlot = `${name}_step`;
  const onSlot = `${name}_on`;
  const gateSlot = `${name}_gate`;
  const dirSlot = `${name}_dir`;
  const tickSlot = `${name}_tick`;
  const metroVar = `_${name}_metro`;
  const valuesTable =
    params.output_mode === 'note_per_row'
      ? `_${name}_notes`
      : `_${name}_ccs`;

  // Master tick rate. Per-row divs slow individual rows down from this.
  const masterTickSeconds = 60 / params.bpm / params.steps_per_beat;

  // Pad / truncate the user-supplied divs array to exactly numRows.
  // Missing entries default to 1 (synchronous play).
  const divs = Array.from({ length: numRows }, (_, r) => {
    const v = params.divs?.[r];
    return typeof v === 'number' && v >= 1 ? v : 1;
  });

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

  // Per-row value table:
  //   note mode: top row = highest pitch (piano-flat convention).
  //              row r → scale-degree (numRows-1-r) above base_note.
  //   cc mode:   row r → base_cc + r (no flip; CC numbers carry no
  //              musical "up/down", and users typically order rows
  //              as labeled tracks).
  const valueForRow = (r: number): number => {
    if (params.output_mode === 'note_per_row') {
      const degree = numRows - 1 - r;
      return noteAtDegree(params.base_note, params.scale, degree);
    }
    return params.base_cc + r;
  };
  const valuesEntries = Array.from(
    { length: numRows },
    (_, r) => `[${r}]=${valueForRow(r)}`,
  ).join(', ');

  const divsEntries = divs.map((d, r) => `[${r}]=${d}`).join(', ');

  const tickBody = buildTickBody(
    params,
    numRows,
    numCols,
    name,
    valuesTable,
    divsTable,
  );

  const declarations = [
    `-- ---- region: ${name} ----`,
    `local ${rowTable} = {}`,
    rowLines,
    `local ${colTable} = {}`,
    colLines,
    `local ${valuesTable} = {${valuesEntries}}`,
    `local ${divsTable} = {${divsEntries}}`,
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
    // Per-row playhead now: pixel reads state.X_step[row]
    `local function ${pixelName}(row, col)`,
    `  local is_step = col == state.${stepSlot}[row]`,
    `  local is_on = state.${onSlot}[row][col]`,
    '  if is_step then',
    `    return is_on and ${params.led_current_on} or ${params.led_current_off}`,
    '  else',
    `    return is_on and ${params.led_not_current_on} or ${params.led_not_current_off}`,
    '  end',
    'end',
    '',
    `local ${metroVar} = metro.init(${tickName}, ${masterTickSeconds})`,
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
  //   step:  per-row playhead. -1 so first forward tick lands on 0;
  //          reverse on numCols-1.
  //   on:    nested per-row table, cells default to nil = off.
  //   gate:  per-row remaining-ticks counter (0 = no note playing).
  //   dir:   per-row pingpong direction (always +1 initially; unused
  //          for forward/reverse but harmless).
  //   tick:  per-row div countdown. When <= 0 the row advances and
  //          the countdown resets to that row's div.
  const stepTableInit = `{${range(numRows, '-1').join(', ')}}`;
  const onTableInit = `{${range(numRows, '{}').join(', ')}}`;
  const gateTableInit = `{${range(numRows, '0').join(', ')}}`;
  const dirTableInit = `{${range(numRows, '1').join(', ')}}`;
  const tickTableInit = `{${divs.map((d, r) => `[${r}]=${d}`).join(', ')}}`;

  const stateInit = [
    `${stepSlot} = ${stepTableInit},`,
    `${onSlot} = ${onTableInit},`,
    `${gateSlot} = ${gateTableInit},`,
    `${dirSlot} = ${dirTableInit},`,
    `${tickSlot} = ${tickTableInit},`,
  ].join('\n');

  return {
    stateInit,
    declarations,
    drawBlock,
    routeAdditions,
  };
}

function range(n: number, value: string): string[] {
  return Array.from({ length: n }, (_, i) => `[${i}]=${value}`);
}

function buildTickBody(
  params: StepSequencerParams,
  numRows: number,
  numCols: number,
  name: string,
  valuesTable: string,
  divsTable: string,
): string[] {
  const stepSlot = `${name}_step`;
  const onSlot = `${name}_on`;
  const gateSlot = `${name}_gate`;
  const dirSlot = `${name}_dir`;
  const tickSlot = `${name}_tick`;

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
    '-- master tick: each row independently checks gate + advances on its own div',
    `for r = 0, ${numRows - 1} do`,
    "  -- 1. tick the row's gate (open notes); close any that just expired",
    `  if state.${gateSlot}[r] > 0 then`,
    `    state.${gateSlot}[r] = state.${gateSlot}[r] - 1`,
    `    if state.${gateSlot}[r] == 0 then`,
    `      ${closeCall}`,
    '    end',
    '  end',
    "  -- 2. tick the row's div countdown; advance + fire only when it hits 0",
    `  state.${tickSlot}[r] = state.${tickSlot}[r] - 1`,
    `  if state.${tickSlot}[r] <= 0 then`,
    `    state.${tickSlot}[r] = ${divsTable}[r]`,
    ...advance.map((l) => '    ' + l),
    `    if state.${onSlot}[r][state.${stepSlot}[r]] then`,
    `      if state.${gateSlot}[r] > 0 then`,
    `        ${closeCall}`,
    '      end',
    `      ${openCall}`,
    `      state.${gateSlot}[r] = ${params.gate_length}`,
    '    end',
    '  end',
    'end',
    '-- repaint so each row\'s playhead is visible',
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
        `state.${stepSlot}[r] = state.${stepSlot}[r] - 1`,
        `if state.${stepSlot}[r] < 0 then state.${stepSlot}[r] = ${numCols - 1} end`,
      ];
    case 'pingpong':
      return [
        `state.${stepSlot}[r] = state.${stepSlot}[r] + state.${dirSlot}[r]`,
        `if state.${stepSlot}[r] >= ${numCols} then`,
        `  state.${stepSlot}[r] = ${numCols - 2}`,
        `  state.${dirSlot}[r] = -1`,
        `elseif state.${stepSlot}[r] < 0 then`,
        `  state.${stepSlot}[r] = 1`,
        `  state.${dirSlot}[r] = 1`,
        'end',
      ];
    case 'forward':
    default:
      return [
        `state.${stepSlot}[r] = (state.${stepSlot}[r] + 1) % ${numCols}`,
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
