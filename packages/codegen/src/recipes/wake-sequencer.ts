import type { Cell, Region, WakeSequencerBehavior } from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import { SCALE_NAMES, noteAtDegree } from '../scales.ts';
import type { EmittedFragments } from './momentary.ts';

/**
 * v2 page set. Indices match `state.<region>_page`.
 *
 *   Pages 0..3 (PITCH / OCT / VEL / DURATION) use
 *     `state.<region>_data[page][col]` — per-step values.
 *   Page 4 (LENGTH) uses the scalar `state.<region>_length`.
 *   Page 5 (CLK) is a live-control panel that mutates global script
 *     state: BPM, run/stop, scale index. Layout (top of body
 *     downward): rr=1 = scale picker (8 cells), rr=2 = run/stop
 *     (col 0 = stop, col 1 = run), rr=3..bodyHeight = BPM meter
 *     (2D, top-left = MIN_BPM, bottom-right = MAX_BPM).
 */
const NUM_PAGES = 6;
const PAGE_LENGTH = 4;
const PAGE_CLK = 5;

// CLK page tunables.
const MIN_BPM = 60;
const MAX_BPM = 300;

/**
 * Sub-step resolution. The metro runs `STEP_TICKS` times per step so the
 * DURATION page can express sub-step note lengths (true staccato), not
 * just multiples of the step duration. With STEP_TICKS=8, V=1 can be a
 * 1/8-step note while the previous design (one tick per step) made
 * every value clamp to ≥ 1 step in dense sequences.
 */
const STEP_TICKS = 8;

// LED brightness levels:
const LED_FN_ACTIVE = 12;
const LED_FN_INACTIVE = 6;
const LED_FN_EXTRA = 1;
const LED_VALUE = 12;
const LED_VALUE_ON_PLAYHEAD = 15;
const LED_VALUE_INACTIVE = 4; // lit body cell in a column past the active length
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
  const scalesTable = `_${name}_scales`; // 2D: [scale_idx][pitch] → semitones
  const velocityTable = `_${name}_vel`;
  const durationTable = `_${name}_dur`;
  const stepSlot = `${name}_step`;
  const pageSlot = `${name}_page`;
  const dataSlot = `${name}_data`;
  const lengthSlot = `${name}_length`;
  const runningSlot = `${name}_running`;
  const bpmSlot = `${name}_bpm`;
  const scaleIdxSlot = `${name}_scale_idx`;
  const activeNoteSlot = `${name}_active_note`;
  const activeDurSlot = `${name}_active_dur`;
  const subTickSlot = `${name}_sub`;
  const metroVar = `_${name}_metro`;

  // master tick = a fraction of one step, so duration values can
  // express sub-step note lengths.
  const stepSeconds = 60 / params.bpm / params.steps_per_beat;
  const masterTickSeconds = stepSeconds / STEP_TICKS;

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

  // Scale offsets, indexed by scale index (1..#SCALE_NAMES) then
  // pitch value (1..bodyHeight). The CLK page lets the user switch
  // scales live by changing `state.<region>_scale_idx`; we precompute
  // every scale's offsets at codegen time so the tick body just does
  // a 2D lookup.
  //
  // Emitted with one scale per source line: iii's repl.c uses a
  // 512-byte LINE_BUFFER and silently truncates anything longer.
  // 8 scales × bodyHeight entries on one line approaches that
  // limit fast.
  const scaleLines = SCALE_NAMES.map((scaleName, sIdx) => {
    const offsets = Array.from(
      { length: bodyHeight },
      (_, i) => `[${i + 1}]=${noteAtDegree(0, scaleName, i)}`,
    ).join(',');
    return `  [${sIdx + 1}]={${offsets}},`;
  });

  // Initial scale index (1-based) — derived from the panel's `scale`
  // param, so the first run sounds like the user configured.
  const initialScaleIdx = SCALE_NAMES.indexOf(params.scale) + 1 || 1;

  // Velocity mapping: 0..bodyHeight → 0..127, linear, with 0 → 0.
  const velocityEntries = Array.from({ length: bodyHeight + 1 }, (_, v) => {
    const vel = v === 0 ? 0 : Math.floor((v * 127) / bodyHeight);
    return `[${v}]=${vel}`;
  }).join(', ');

  // Duration mapping: V (1..bodyHeight) → master-tick count. Linear
  // interpolation in seconds across [MIN_DURATION_S, MAX_DURATION_S];
  // V=1 = MIN_DURATION_S, V=bodyHeight = MAX_DURATION_S. Voice-stealing
  // in dense mono sequences will still clamp longer durations to the
  // next firing time — that's a property of monophonic playback, not
  // of this curve.
  const MIN_DURATION_S = 0.5;
  const MAX_DURATION_S = 3;
  const durationEntries = Array.from({ length: bodyHeight + 1 }, (_, v) => {
    if (v === 0) return `[0]=0`;
    const seconds =
      bodyHeight === 1
        ? MAX_DURATION_S
        : MIN_DURATION_S +
          ((v - 1) / (bodyHeight - 1)) * (MAX_DURATION_S - MIN_DURATION_S);
    const ticks = Math.max(1, Math.round(seconds / masterTickSeconds));
    return `[${v}]=${ticks}`;
  }).join(', ');

  // ---- state init ----

  // OCT page is centred on the middle body row. Value V (1..bodyHeight)
  // maps to octave shift `V - octaveCenter`, so the default cell sits
  // at "no shift" and pressing higher / lower cells transposes up /
  // down. With bodyHeight=7 → centre=4 → shifts run -3..+3.
  const octaveCenter = Math.floor(bodyHeight / 2) + 1;

  // Per-page initial value:
  //   PITCH    (0): empty — every step starts silent until the user
  //                 sets a degree.
  //   OCT      (1): centre — see above.
  //   VEL      (2): bodyHeight — max velocity, top cell lit. Without
  //                 this every step is silent and the other pages have
  //                 no audible effect.
  //   DURATION (3): bodyHeight — longest duration, top cell lit. Same
  //                 rationale as VEL.
  const PAGE_DEFAULTS = [0, octaveCenter, bodyHeight, bodyHeight];

  // data: 4 pages (PITCH/OCT/VEL/DUR), each is a {col → value
  // 0..bodyHeight} table. Page 4 (LENGTH) is stored separately as a
  // scalar in `state.<region>_length`, not in this table.
  //
  // Emitted with one page per source line so the entire literal
  // stays under iii's 512-byte LINE_BUFFER even on a full 16-col
  // sequencer (4 pages × 16 cols × ~7 chars/entry would push past
  // 500 chars on a single line otherwise).
  const dataPageLines = Array.from({ length: PAGE_LENGTH }, (_, p) => {
    const def = PAGE_DEFAULTS[p];
    const cols = Array.from(
      { length: numCols },
      (_, c) => `[${c}]=${def}`,
    ).join(',');
    return `    [${p}]={${cols}},`;
  });
  const dataInit = ['{', ...dataPageLines, '  }'].join('\n');

  const stateInit = [
    `${stepSlot} = -1,`,
    `${pageSlot} = 0,`,
    `${dataSlot} = ${dataInit},`,
    // active step count. Defaults to numCols (the whole region plays);
    // the user can shorten it on the LENGTH page (page 4).
    `${lengthSlot} = ${numCols},`,
    // CLK page state. running=1 → playhead advances + audio; 0 →
    // metro keeps ticking but tick body short-circuits. bpm and
    // scale_idx are mutated live by the CLK page handler.
    `${runningSlot} = 1,`,
    `${bpmSlot} = ${params.bpm},`,
    `${scaleIdxSlot} = ${initialScaleIdx},`,
    `${activeNoteSlot} = -1,`,
    `${activeDurSlot} = 0,`,
    // sub-tick counter: how many master ticks since the last step
    // advance. Step advances when this reaches STEP_TICKS.
    `${subTickSlot} = 0,`,
  ].join('\n');

  // ---- declarations: helper tables, tick, handler, pixel, metro ----

  // ---- BPM meter geometry on CLK page ----
  // Body rows reserved on CLK page (1-indexed within body):
  //   rr=1: scale picker
  //   rr=2: run/stop
  //   rr=3..bodyHeight: BPM meter (numCols cols × (bodyHeight-2) rows)
  const bpmRowsTotal = Math.max(0, bodyHeight - 2);
  const bpmCellsTotal = bpmRowsTotal * numCols;

  const declarations = [
    `-- ---- region: ${name} ----`,
    `local ${colTable} = {}`,
    colLines,
    `local ${rrTable} = {}`,
    rrLines,
    `local ${scalesTable} = {`,
    ...scaleLines,
    `}`,
    `local ${velocityTable} = {${velocityEntries}}`,
    `local ${durationTable} = {${durationEntries}}`,
    '',
    // Forward-declare the metro so the press handler (defined below
    // but lexically before the metro.init call) can capture it as an
    // upvalue. CLK page mutations need to call _metro.time = X to
    // change BPM live.
    `local ${metroVar}`,
    '',
    // ---- tick ----
    `local function ${tickName}()`,
    "  -- 0. running gate. CLK page can stop playback; we still let the",
    "  -- metro fire so the page can be repainted on press, but skip",
    "  -- all the audio + step machinery. Any active note is killed",
    "  -- once on stop (handled in the press handler).",
    `  if state.${runningSlot} == 0 then return end`,
    "  -- 1. tick down active note duration; close any voice that just expired",
    `  if state.${activeDurSlot} > 0 then`,
    `    state.${activeDurSlot} = state.${activeDurSlot} - 1`,
    `    if state.${activeDurSlot} == 0 and state.${activeNoteSlot} >= 0 then`,
    `      midi_note_off(state.${activeNoteSlot}, 0, ${params.channel})`,
    `      state.${activeNoteSlot} = -1`,
    '    end',
    '  end',
    `  -- 2. only advance the playhead every ${STEP_TICKS} master ticks`,
    `  state.${subTickSlot} = state.${subTickSlot} + 1`,
    `  if state.${subTickSlot} < ${STEP_TICKS} then return end`,
    `  state.${subTickSlot} = 0`,
    "  -- playhead wraps at the user-controlled length (LENGTH page),",
    "  -- not the static numCols, so columns past length never play",
    `  state.${stepSlot} = (state.${stepSlot} + 1) % state.${lengthSlot}`,
    "  -- 3. compute and fire the new step's note (if it has one)",
    `  local pitch = state.${dataSlot}[0][state.${stepSlot}]`,
    `  local oct = state.${dataSlot}[1][state.${stepSlot}]`,
    `  local v = state.${dataSlot}[2][state.${stepSlot}]`,
    `  local d = state.${dataSlot}[3][state.${stepSlot}]`,
    "  -- pitch / v / d all > 0 required for the step to sound. v=0",
    "  -- (cleared on VEL page) and d=0 (cleared on DURATION page)",
    "  -- both silence the step the same way pitch=0 does.",
    '  if pitch > 0 and v > 0 and d > 0 then',
    `    if state.${activeNoteSlot} >= 0 then`,
    `      midi_note_off(state.${activeNoteSlot}, 0, ${params.channel})`,
    '    end',
    "    -- Scale offsets are looked up via state.scale_idx so the CLK",
    "    -- page can switch scales live without recompiling the script.",
    `    local note = ${params.root_note} + ${scalesTable}[state.${scaleIdxSlot}][pitch] + 12 * (oct - ${octaveCenter})`,
    `    midi_note_on(note, ${velocityTable}[v], ${params.channel})`,
    `    state.${activeNoteSlot} = note`,
    `    state.${activeDurSlot} = ${durationTable}[d]`,
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
    "    -- body cell. Behaviour depends on which page is active.",
    `    if state.${pageSlot} == ${PAGE_LENGTH} then`,
    "      -- LENGTH page: any body row of column c sets active step",
    "      -- count to c+1 (1..numCols). Clamp the playhead so it",
    "      -- doesn't render in a now-inactive column for one frame.",
    `      state.${lengthSlot} = c + 1`,
    `      if state.${stepSlot} >= state.${lengthSlot} then`,
    `        state.${stepSlot} = -1`,
    '      end',
    `    elseif state.${pageSlot} == ${PAGE_CLK} then`,
    "      -- CLK page. Dispatch by body-row:",
    "      --   rr=1: scale picker (col 0..7 = 8 scales, 1-based idx)",
    "      --   rr=2: run/stop (col 0 = stop, col 1 = run)",
    "      --   rr=3..bodyHeight: BPM meter (press to set live BPM)",
    `      if rr == 1 then`,
    `        if c >= 0 and c < ${SCALE_NAMES.length} then`,
    `          state.${scaleIdxSlot} = c + 1`,
    '        end',
    `      elseif rr == 2 then`,
    `        if c == 0 then`,
    "          -- stop: kill any voice + freeze the playhead",
    `          state.${runningSlot} = 0`,
    `          if state.${activeNoteSlot} >= 0 then`,
    `            midi_note_off(state.${activeNoteSlot}, 0, ${params.channel})`,
    `            state.${activeNoteSlot} = -1`,
    '          end',
    `          state.${activeDurSlot} = 0`,
    `        elseif c == 1 then`,
    `          state.${runningSlot} = 1`,
    '        end',
    bpmCellsTotal > 0
      ? [
          `      else`,
          `        -- BPM meter. Cell index is read in row-major order`,
          `        -- (top-to-bottom of the meter, left-to-right within`,
          `        -- each row), so top-left = MIN_BPM and bottom-right`,
          `        -- = MAX_BPM. Press to set state.bpm and recompute`,
          `        -- the metro period; if the metro is running the live`,
          `        -- update kicks in via metro_set under the hood.`,
          `        local bpm_row = rr - 3`,
          `        local idx = bpm_row * ${numCols} + c`,
          `        if idx >= 0 and idx < ${bpmCellsTotal} then`,
          `          local bpm = ${MIN_BPM} + math.floor((idx + 1) * ${MAX_BPM - MIN_BPM} / ${bpmCellsTotal})`,
          `          if bpm < ${MIN_BPM} then bpm = ${MIN_BPM} end`,
          `          if bpm > ${MAX_BPM} then bpm = ${MAX_BPM} end`,
          `          state.${bpmSlot} = bpm`,
          `          local new_period = 60 / bpm / ${params.steps_per_beat} / ${STEP_TICKS}`,
          `          if ${metroVar} ~= nil then ${metroVar}.time = new_period end`,
          `        end`,
        ].join('\n')
      : '',
    `      end`,
    '    else',
    `      local body_row = rr - 1`,
    `      local value = ${bodyHeight} - body_row`,
    `      local cur = state.${dataSlot}[state.${pageSlot}][c]`,
    "      -- OCT (page 1) is centred and must always show one cell",
    "      -- lit; pressing the lit cell is a no-op (no toggle-off).",
    `      if state.${pageSlot} == 1 then`,
    `        state.${dataSlot}[1][c] = value`,
    '      elseif cur == value then',
    `        state.${dataSlot}[state.${pageSlot}][c] = 0`,
    '      else',
    `        state.${dataSlot}[state.${pageSlot}][c] = value`,
    '      end',
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
    `  local active_col = (col < state.${lengthSlot})`,
    `  local on_step = (col == state.${stepSlot})`,
    `  if state.${pageSlot} == ${PAGE_LENGTH} then`,
    "    -- LENGTH page: every body cell of an active column is lit",
    "    -- (whole-column meter); inactive columns are dark.",
    '    if active_col then',
    `      return on_step and ${LED_VALUE_ON_PLAYHEAD} or ${LED_VALUE}`,
    '    end',
    `    return ${LED_OFF}`,
    '  end',
    `  if state.${pageSlot} == ${PAGE_CLK} then`,
    "    -- CLK page. rr=1 scale picker, rr=2 run/stop, rr>=3 BPM meter.",
    `    if rr == 1 then`,
    "      -- scale picker: 8 cells, active scale at LED_VALUE, others",
    "      -- LED_VALUE_INACTIVE; cells past 8 are LED_OFF.",
    `      if col >= ${SCALE_NAMES.length} then return ${LED_OFF} end`,
    `      return (state.${scaleIdxSlot} == col + 1) and ${LED_VALUE} or ${LED_VALUE_INACTIVE}`,
    '    end',
    `    if rr == 2 then`,
    "      -- run/stop: col 0 = stop indicator (bright when stopped),",
    "      -- col 1 = run indicator (bright when running). Others off.",
    `      if col == 0 then return state.${runningSlot} == 0 and ${LED_VALUE} or ${LED_VALUE_INACTIVE} end`,
    `      if col == 1 then return state.${runningSlot} == 1 and ${LED_VALUE} or ${LED_VALUE_INACTIVE} end`,
    `      return ${LED_OFF}`,
    '    end',
    bpmCellsTotal > 0
      ? [
          "    -- BPM meter: cell idx 0..bpmCellsTotal-1 in reading order",
          "    -- (rr=3 row first). Cell lit if its threshold ≤ current BPM.",
          `    local bpm_row = rr - 3`,
          `    local idx = bpm_row * ${numCols} + col`,
          `    if idx < 0 or idx >= ${bpmCellsTotal} then return ${LED_OFF} end`,
          `    local threshold = ${MIN_BPM} + math.floor((idx + 1) * ${MAX_BPM - MIN_BPM} / ${bpmCellsTotal})`,
          `    return state.${bpmSlot} >= threshold and ${LED_VALUE} or ${LED_VALUE_INACTIVE}`,
        ].join('\n')
      : `    return ${LED_OFF}`,
    '  end',
    "  -- normal value pages: single lit cell per column for the data",
    "  -- value, dimmed if the column is past the active length so the",
    "  -- user can see which programmed notes won't fire.",
    `  local body_row = rr - 1`,
    `  local target = ${bodyHeight} - body_row`,
    `  local v = state.${dataSlot}[state.${pageSlot}][col]`,
    '  if v == target then',
    '    if active_col then',
    `      return on_step and ${LED_VALUE_ON_PLAYHEAD} or ${LED_VALUE}`,
    '    end',
    `    return ${LED_VALUE_INACTIVE}`,
    '  end',
    `  return on_step and ${LED_PLAYHEAD} or ${LED_OFF}`,
    'end',
    '',
    `${metroVar} = metro.init(${tickName}, ${masterTickSeconds})`,
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
