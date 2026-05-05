import type { Cell, NoteKeyboardBehavior, Region } from '../types.ts';
import type { EmittedFragments } from './momentary.ts';

type NKRegion = Region & { behavior: NoteKeyboardBehavior };

export function emitNoteKeyboard(region: NKRegion): EmittedFragments {
  const { yTop, height, xLeft } = analyzeSelection(region.cells);
  const handlerName = `handle_${region.name}`;
  const params = region.behavior.params;
  const stateSlot = `${region.name}_held`;
  const noteTable = `_${region.name}_note`;

  // Compute the MIDI note for each cell. Drop cells whose note falls
  // outside [0, 127] (decision B): they get no note table entry, no
  // LED line, no route — they appear unlit and unresponsive.
  const cellsWithNote = region.cells.map((c) => {
    const rx = c.x - xLeft;
    const ry = c.y - yTop;
    const note =
      params.root_note +
      (height - 1 - ry) * params.row_interval +
      rx * params.column_interval;
    return { cell: c, note };
  });

  const inRange = cellsWithNote
    .filter(({ note }) => note >= 0 && note <= 127)
    .sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x);

  const noteLines = inRange
    .map(({ cell, note }) => `${noteTable}[${cell.x} + ${cell.y}*W] = ${note}`)
    .join('\n');

  const declarations = [
    `-- ---- region: ${region.name} ----`,
    `local ${noteTable} = {}`,
    noteLines,
    '',
    `local function ${handlerName}(x, y, z)`,
    `  local note = ${noteTable}[x + y*W]`,
    '  if not note then return end',
    '  if z == 1 then',
    `    midi_note_on(note, ${params.velocity}, ${params.channel})`,
    `    state.${stateSlot}[x + y*W] = true`,
    '  else',
    `    midi_note_off(note, 0, ${params.channel})`,
    `    state.${stateSlot}[x + y*W] = nil`,
    '  end',
    'end',
  ].join('\n');

  const ledLines = inRange
    .map(
      ({ cell }) =>
        `  grid_led(${cell.x}, ${cell.y}, state.${stateSlot}[${cell.x} + ${cell.y}*W] and ${params.led_held} or ${params.led_idle})`,
    )
    .join('\n');

  const drawBlock = [`  -- region: ${region.name}`, ledLines].join('\n');

  const routeAdditions = inRange.map(
    ({ cell }) => `_route[${cell.x} + ${cell.y}*W] = ${handlerName}`,
  );

  return {
    stateInit: `${stateSlot} = {},`,
    declarations,
    drawBlock,
    routeAdditions,
  };
}

function analyzeSelection(cells: Cell[]): {
  xLeft: number;
  yTop: number;
  height: number;
} {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const xLeft = Math.min(...xs);
  const yTop = Math.min(...ys);
  const yBottom = Math.max(...ys);
  return { xLeft, yTop, height: yBottom - yTop + 1 };
}
