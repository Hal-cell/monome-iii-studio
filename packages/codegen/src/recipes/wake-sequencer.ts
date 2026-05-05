import type { Cell, Region, WakeSequencerBehavior } from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import { noteAtDegree } from '../scales.ts';
import type { EmittedFragments } from './momentary.ts';

/**
 * v1 page set. Indices match `state.<region>_page` and
 * `state.<region>_data[page]`.
 */
const NUM_PAGES = 4;
// 0 = PITCH, 1 = OCT, 2 = VEL, 3 = GATE

// LED brightness levels:
const LED_FN_ACTIVE = 12;
const LED_FN_INACTIVE = 6;
const LED_FN_EXTRA = 1;
const LED_VALUE = 12;
const LED_VALUE_ON_PLAYHEAD = 15;
const LED_PLAYHEAD = 4;
const LED_OFF = 0;

type WakeRegion = Region & { behavior: WakeSequencerBehavior };

export function emitWakeSequencer(region: WakeRegion): EmittedFragments {
  const { xLeft, yTop, height, numCols } = analyzeRect(region.cells);
  const numRows = height;
  const bodyHeight = numRows - 1; // top row reserved for the function row
  const params = region.behavior.params;
  const name = luaIdent(region.name);

  // ---- identifiers ----
  const handlerName = `handle_${name}`;
  const tickName = `_${name}_tick`;
  const pixelName = `_${name}_pixel`;
  const colTable = `_${name}_col`;
  const rrTable = `_${name}_rr`;
  const scaleOffsets = `_${name}_scale`;
  const velocityTable = `_${name}_vel`;
  const stepSlot = `${name}_step`;
  const pageSlot = `${name}_page`;
  const dataSlot = `${name}_data`;
  const activeNoteSlot = `${name}_active_note`;
  const activeGateSlot = `${name}_active_gate`;
  const metroVar = `_${name}_metro`;

  const masterTickSeconds = 60 / params.bpm / params.steps_per_beat;

  // ---- compile-time tables ----

  // Cell → column-in-region (0..numCols-1) and row-in-region
  // (0 = function row, 1..bodyHeight = body rows).
  const sortedCells = [...region.cells].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );
  const colLines = sortedCells
    .map((c) => `${colTable}[${luaKey(c)}] = ${c.x - xLeft}`)
    .join('\n');
  const rrLines = sortedCells
    .map((c) => `${rrTable}[${luaKey(c)}] = ${c.y - yTop}`)
    .join('\n');

  // Scale offsets: pitch value 1..bodyHeight → semitone offset from
  // root_note. Walks scale degrees 0..bodyHeight-1; noteAtDegree
  // handles octave wrap so longer body_height keeps climbing the scale.
  const scaleEntries = Array.from(
    { length: bodyHeight },
    (_, i) => `[${i + 1}]=${noteAtDegree(0, params.scale, i)}`,
  ).join(', ');

  // Velocity mapping: 0..bodyHeight → 0..127, linear, with 0 → 0.
  const velocityEntries = Array.from({ length: bodyHeight + 1 }, (_, v) => {
    const vel = v === 0 ? 0 : Math.floor((v * 127) / bodyHeight);
    return `[${v}]=${vel}`;
  }).join(', ');

  // ---- state init ----

  // data: 4 pages, each page is a {col → value 0..bodyHeight} table.
  const dataInit = Array.from({ length: NUM_PAGES }, (_, p) => {
    const cols = Array.from(
      { length: numCols },
      (_, c) => `[${c}]=0`,
    ).join(', ');
    return `[${p}]={${cols}}`;
  }).join(', ');

  const stateInit = [
    `${stepSlot} = -1,`,
    `${pageSlot} = 0,`,
    `${dataSlot} = {${dataInit}},`,
    `${activeNoteSlot} = -1,`,
    `${activeGateSlot} = 0,`,
  ].join('\n');

  // ---- declarations: helper tables, tick, handler, pixel, metro ----

  const declarations = [
    `-- ---- region: ${name} ----`,
    `local ${colTable} = {}`,
    colLines,
    `local ${rrTable} = {}`,
    rrLines,
    `local ${scaleOffsets} = {${scaleEntries}}`,
    `local ${velocityTable} = {${velocityEntries}}`,
    '',
    // ---- tick ----
    `local function ${tickName}()`,
    "  -- 1. tick down active gate; close any voice that just expired",
    `  if state.${activeGateSlot} > 0 then`,
    `    state.${activeGateSlot} = state.${activeGateSlot} - 1`,
    `    if state.${activeGateSlot} == 0 and state.${activeNoteSlot} >= 0 then`,
    `      midi_note_off(state.${activeNoteSlot}, 0, ${params.channel})`,
    `      state.${activeNoteSlot} = -1`,
    '    end',
    '  end',
    "  -- 2. advance the playhead",
    `  state.${stepSlot} = (state.${stepSlot} + 1) % ${numCols}`,
    "  -- 3. compute and fire the new step's note (if it has one)",
    `  local pitch = state.${dataSlot}[0][state.${stepSlot}]`,
    `  local oct = state.${dataSlot}[1][state.${stepSlot}]`,
    `  local v = state.${dataSlot}[2][state.${stepSlot}]`,
    `  local g = state.${dataSlot}[3][state.${stepSlot}]`,
    "  -- pitch>0 and v>0 are both required for the step to sound",
    '  if pitch > 0 and v > 0 then',
    `    if state.${activeNoteSlot} >= 0 then`,
    `      midi_note_off(state.${activeNoteSlot}, 0, ${params.channel})`,
    '    end',
    `    local note = ${params.root_note} + ${scaleOffsets}[pitch] + 12 * oct`,
    `    midi_note_on(note, ${velocityTable}[v], ${params.channel})`,
    `    state.${activeNoteSlot} = note`,
    "    -- gate value of 0 still gets a 1-tick blip; 1..body_height = held ticks",
    `    state.${activeGateSlot} = (g == 0) and 1 or g`,
    '  end',
    '  redraw()',
    'end',
    '',
    // ---- press handler ----
    `local function ${handlerName}(x, y, z)`,
    '  if z ~= 1 then return end',
    `  local c = ${colTable}[x + y*W]`,
    `  local rr = ${rrTable}[x + y*W]`,
    '  if rr == 0 then',
    "    -- function row: page select (extra cells beyond NUM_PAGES are ignored)",
    `    if c < ${NUM_PAGES} then`,
    `      state.${pageSlot} = c`,
    '    end',
    '  else',
    "    -- body cell: set / clear data[page][col]",
    `    local body_row = rr - 1`,
    `    local value = ${bodyHeight} - body_row`,
    `    local cur = state.${dataSlot}[state.${pageSlot}][c]`,
    '    if cur == value then',
    `      state.${dataSlot}[state.${pageSlot}][c] = 0`,
    '    else',
    `      state.${dataSlot}[state.${pageSlot}][c] = value`,
    '    end',
    '  end',
    'end',
    '',
    // ---- pixel function (single helper for fn row + body) ----
    `local function ${pixelName}(col, rr)`,
    '  if rr == 0 then',
    "    -- function row",
    `    if col >= ${NUM_PAGES} then return ${LED_FN_EXTRA} end`,
    `    return (state.${pageSlot} == col) and ${LED_FN_ACTIVE} or ${LED_FN_INACTIVE}`,
    '  end',
    "  -- body row",
    `  local body_row = rr - 1`,
    `  local target = ${bodyHeight} - body_row`,
    `  local v = state.${dataSlot}[state.${pageSlot}][col]`,
    `  local on_step = (col == state.${stepSlot})`,
    '  if v == target then',
    `    return on_step and ${LED_VALUE_ON_PLAYHEAD} or ${LED_VALUE}`,
    '  end',
    `  return on_step and ${LED_PLAYHEAD} or ${LED_OFF}`,
    'end',
    '',
    `local ${metroVar} = metro.init(${tickName}, ${masterTickSeconds})`,
    `${metroVar}:start()`,
  ].join('\n');

  // ---- LED draw ----

  const ledLines = sortedCells
    .map((c) => {
      const col = c.x - xLeft;
      const rr = c.y - yTop;
      return `  grid_led(${luaXY(c)}, ${pixelName}(${col}, ${rr}))`;
    })
    .join('\n');

  const drawBlock = [`  -- region: ${name}`, ledLines].join('\n');

  // ---- route ----

  const routeAdditions = sortedCells.map(
    (c) => `_route[${luaKey(c)}] = ${handlerName}`,
  );

  return {
    stateInit,
    declarations,
    drawBlock,
    routeAdditions,
  };
}

function analyzeRect(cells: Cell[]): {
  xLeft: number;
  yTop: number;
  height: number;
  numCols: number;
} {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  return {
    xLeft: Math.min(...xs),
    yTop: Math.min(...ys),
    height: Math.max(...ys) - Math.min(...ys) + 1,
    numCols: Math.max(...xs) - Math.min(...xs) + 1,
  };
}
