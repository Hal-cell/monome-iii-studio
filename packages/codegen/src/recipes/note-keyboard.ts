import type { Cell, NoteKeyboardBehavior, Region } from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import { SCALE_INTERVALS, SCALE_NAMES, noteAtDegree } from '../scales.ts';
import type { EmittedFragments } from './momentary.ts';

type NKRegion = Region & { behavior: NoteKeyboardBehavior };

/**
 * Diatonic chord progression graph used by the harmony-coach mode.
 * Generic across 7-note scales — chord quality (M/m/dim) follows
 * from the scale's interval pattern automatically.
 */
const NEXT_CHORD_DEGREE: Record<number, number[]> = {
  1: [2, 3, 4, 5, 6, 7],
  2: [5, 7],
  3: [4, 6],
  4: [1, 5, 7],
  5: [1, 6],
  6: [2, 4, 5],
  7: [1, 3],
};

// LED brightness levels for runtime modes.
const LED_CHORD_HI = 13;
const LED_CHORD_LO = 6;
const LED_PICKER_ACTIVE = 12;
const LED_PICKER_INACTIVE = 4;
const LED_PICKER_UNUSED = 1;
const COACH_BLINK_S = 0.25;

// Maximum voicings per chord. Live-scale mode multiplies the data by
// 8 scales, so we use a tighter cap there to keep the script under
// iii's 32 KB upload buffer (SCRIPT_BUFFER_SIZE in repl.c).
const MAX_VOICINGS_LIVE = 3;
const MAX_VOICINGS_STATIC = 6;

// Hard cap on a voicing's pitch span. Triads should sit within an
// octave so the blinking cells stay close together — the user
// explicitly asked us to stop sampling spread-octave voicings, and
// instead get variety from inversions (which all fit within ~7
// semitones of root).
const MAX_PITCH_SPAN = 12;

// iii grid is always 16 cells wide. Hard-coding it here lets us
// pre-evaluate cell keys to single integers for the voicing tables,
// which is much smaller than emitting `[3 + 6*W]=true` literals.
const W_RUNTIME = 16;

/**
 * Cell key as a precomputed integer (1-indexed): matches what the
 * runtime computes via `x + y*W` for any cell, since W=16 on iii.
 */
function cellKeyInt(c: Cell): number {
  return c.x + 1 + (c.y + 1) * W_RUNTIME;
}

export function emitNoteKeyboard(region: NKRegion): EmittedFragments {
  const { yTop, height, xLeft } = analyzeSelection(region.cells);
  const safeName = luaIdent(region.name);
  const handlerName = `handle_${safeName}`;
  const params = region.behavior.params;
  const stateSlot = `${safeName}_held`;
  const noteTable = `_${safeName}_note`;

  const useLiveScale = params.live_scale_select === true;
  // Coach is meaningful only when a non-chromatic scale can be
  // active at runtime: live-scale mode unlocks the picker, static
  // mode picks the scale at codegen time. Static + chromatic =
  // silently disabled, no coach data emitted.
  const useCoach =
    params.harmony_coach === true &&
    (useLiveScale || params.scale !== 'chromatic');
  const usePixel = useCoach || useLiveScale;
  const maxVoicings = useLiveScale
    ? MAX_VOICINGS_LIVE
    : MAX_VOICINGS_STATIC;

  // Right-most column of the selection becomes the scale picker when
  // live_scale_select is on. Other cells are the playable keyboard.
  const xRight = Math.max(...region.cells.map((c) => c.x));
  const isPickerCell = (c: Cell) => useLiveScale && c.x === xRight;

  // ---- compute MIDI note for each KEYBOARD cell ----
  const keyboardCells = region.cells.filter((c) => !isPickerCell(c));
  const cellsWithNote = keyboardCells.map((c) => {
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

  // ---- rectangularity detection ----
  // When the keyboard cells form a complete rectangle AND every
  // cell's note is in MIDI range, we can emit the note table /
  // routes / LED draw as nested for-loops instead of per-cell
  // lines. Saves ~10 KB on a full 16×8 layout vs per-cell emit.
  const xLkb = keyboardCells.length
    ? Math.min(...keyboardCells.map((c) => c.x))
    : 0;
  const xRkb = keyboardCells.length
    ? Math.max(...keyboardCells.map((c) => c.x))
    : 0;
  const yTkb = keyboardCells.length
    ? Math.min(...keyboardCells.map((c) => c.y))
    : 0;
  const yBkb = keyboardCells.length
    ? Math.max(...keyboardCells.map((c) => c.y))
    : 0;
  const wKb = xRkb - xLkb + 1;
  const hKb = yBkb - yTkb + 1;
  const isRectKb =
    keyboardCells.length > 0 &&
    keyboardCells.length === wKb * hKb &&
    inRange.length === keyboardCells.length;

  // Note formula for the loop body:
  //   note = root_note + (height + yTop - y) * row_interval
  //                    + (x - 1 - xLeft) * col_interval
  // where y, x are 1-indexed grid coords (matching the loop var).
  const noteFormulaA = height + yTop;
  const noteFormulaB = -1 - xLeft;
  function noteFormulaFor(xVar: string, yVar: string): string {
    const xCore =
      noteFormulaB === 0
        ? xVar
        : noteFormulaB > 0
          ? `(${xVar}+${noteFormulaB})`
          : `(${xVar}-${-noteFormulaB})`;
    const xExpr =
      params.column_interval === 1
        ? xCore
        : `${xCore}*${params.column_interval}`;
    const yCore = `(${noteFormulaA}-${yVar})`;
    const yExpr =
      params.row_interval === 1 ? yCore : `${yCore}*${params.row_interval}`;
    return `${params.root_note} + ${yExpr} + ${xExpr}`;
  }

  const noteLines = isRectKb
    ? [
        `for y = ${yTkb + 1}, ${yBkb + 1} do`,
        `  for x = ${xLkb + 1}, ${xRkb + 1} do`,
        `    ${noteTable}[x + y*W] = ${noteFormulaFor('x', 'y')}`,
        '  end',
        'end',
      ].join('\n')
    : inRange
        .map(({ cell, note }) => `${noteTable}[${luaKey(cell)}] = ${note}`)
        .join('\n');

  // ---- scale-membership table (only when useLiveScale) ----
  // Built as a single literal for compactness. Each scale is a
  // sparse `{[pc]=true,...}` set; the pixel function indexes by pc
  // (0..11) to decide led_idle vs led_offscale.
  const scaleMemberInit = useLiveScale
    ? `local ${scaleMemberTable(safeName)} = {${SCALE_NAMES.map((name) => {
        const intervals = SCALE_INTERVALS[name];
        return `{${intervals.map((pc) => `[${pc}]=true`).join(',')}}`;
      }).join(',')}}`
    : '';

  // ---- harmony-coach voicings ----
  // Voicings live as flat integer-array tuples (cellKeyInt) to keep
  // the emit compact. Pixel function does a 3-element linear scan
  // (cv[1]==k or cv[2]==k or cv[3]==k); negligible runtime cost.
  //
  //   live mode:   _voicing[scale_idx][chord_d] = {{k1,k2,k3}, ...}
  //   static mode: _voicing[chord_d] = {{k1,k2,k3}, ...}
  type VoicingTuple = number[]; // up to 3 cell-keys

  let voicingsByScale: Record<number, VoicingTuple[][]> | null = null;
  if (useCoach) {
    if (useLiveScale) {
      voicingsByScale = buildAllScaleVoicings(
        inRange,
        params.root_note,
        maxVoicings,
      );
    } else if (params.scale !== 'chromatic') {
      const idx = scaleNameToIdx(params.scale);
      voicingsByScale = {
        [idx]: buildVoicingsForScale(
          inRange,
          params.root_note,
          params.scale,
          maxVoicings,
        ),
      };
    }
  }

  // Voicing table emitted as a single literal: live-scale builds a
  // 2D table (8 scales × 7 chords); static builds a flat 7-chord
  // array. Empty chord slots are `{}` placeholders so 1-based
  // indexing stays correct. Voicing tuples are space-free
  // (`{99,82,115}` not `{99, 82, 115}`) — saves ~3 chars per
  // voicing and adds up across the live-scale table.
  function emitChordsFor(perChord: number[][][]): string {
    return (
      '{' +
      perChord
        .map((voicings) =>
          voicings.length === 0
            ? '{}'
            : '{' + voicings.map((v) => `{${v.join(',')}}`).join(',') + '}',
        )
        .join(',') +
      '}'
    );
  }
  let voicingTableInit = '';
  if (useCoach) {
    if (useLiveScale) {
      const allScales = SCALE_NAMES.map((_n, i) => {
        const idx = i + 1;
        const perChord =
          voicingsByScale?.[idx] ?? Array.from({ length: 7 }, () => []);
        return emitChordsFor(perChord);
      });
      voicingTableInit = `local ${voicingTable(safeName)} = {${allScales.join(',')}}`;
    } else {
      const idx = scaleNameToIdx(params.scale);
      const perChord =
        voicingsByScale?.[idx] ?? Array.from({ length: 7 }, () => []);
      voicingTableInit = `local ${voicingTable(safeName)} = ${emitChordsFor(perChord)}`;
    }
  }

  const nextChordTableLua = useCoach
    ? `local ${nextChordTable(safeName)} = {${Object.entries(NEXT_CHORD_DEGREE)
        .map(([d, opts]) => `[${d}]={${opts.join(',')}}`)
        .join(',')}}`
    : '';

  // ---- scale-picker cells (rightmost column) ----
  // Picker cells are by construction a contiguous 1-D vertical run
  // (`x = xRight`, sorted by y) so they're always loop-emittable.
  const pickerCellsAll = region.cells
    .filter((c) => isPickerCell(c))
    .sort((a, b) => a.y - b.y); // top → bottom = scale_idx 1..N
  const pickerCells = pickerCellsAll.slice(0, SCALE_NAMES.length);
  const pickerExtraCells = pickerCellsAll.slice(SCALE_NAMES.length);
  const pickerYTop = pickerCells.length ? pickerCells[0]!.y : 0;
  const pickerXcol = useLiveScale ? xRight + 1 : 0; // 1-indexed picker col

  // Loop emit: `_keys_picker[xcol + y*W] = y - yTop`. Same indexing
  // convention as luaKey so the route table aligns. yTop=0 case
  // simplifies the value to just `y`.
  const yToScaleIdx = pickerYTop === 0 ? 'y' : `y - ${pickerYTop}`;
  const pickerTargetLines =
    useLiveScale && pickerCells.length > 0
      ? [
          `for y = ${pickerYTop + 1}, ${pickerYTop + pickerCells.length} do`,
          `  ${pickerTable(safeName)}[${pickerXcol} + y*W] = ${yToScaleIdx}`,
          'end',
        ].join('\n')
      : '';

  // ---- handlers ----
  // On full release (no keys held) the coach walks to the next
  // chord-degree, then `_<n>_revoice()` picks a voicing and applies
  // common-tone substitution from the previous one.
  const releaseInner = useCoach
    ? (() => {
        const indent = useLiveScale ? '        ' : '      ';
        const lines: string[] = [
          `${indent}local opts = ${nextChordTable(safeName)}[state.${coachChordSlot(safeName)}]`,
          `${indent}if opts then`,
          `${indent}  state.${coachChordSlot(safeName)} = opts[math.random(1, #opts)]`,
          `${indent}end`,
          `${indent}${revoiceName(safeName)}()`,
        ];
        return lines.join('\n');
      })()
    : '';

  const handlerCoachRelease = useCoach
    ? [
        `    if next(state.${stateSlot}) == nil then`,
        '      -- All keys released — user has finished this chord. Walk.',
        ...(useLiveScale
          ? [
              `      if state.${scaleIdxSlot(safeName)} ~= 1 then`,
              releaseInner,
              '      end',
            ]
          : [releaseInner]),
        '    end',
      ].join('\n')
    : '';

  const keyboardHandler = [
    `local function ${handlerName}(x, y, z)`,
    `  local note = ${noteTable}[x + y*W]`,
    '  if not note then return end',
    '  if z == 1 then',
    `    midi_note_on(note, ${params.velocity}, ${params.channel})`,
    `    state.${stateSlot}[x + y*W] = true`,
    '  else',
    `    midi_note_off(note, 0, ${params.channel})`,
    `    state.${stateSlot}[x + y*W] = nil`,
    handlerCoachRelease,
    '  end',
    'end',
  ]
    .filter((l) => l !== '')
    .join('\n');

  // Picker handler: switch active scale + reseed coach voicing for
  // the new scale. Clear coach_voicing first so the revoice doesn't
  // try to common-tone-substitute against the old scale's voicing
  // (the user explicitly switched scales — voice-leading across
  // that boundary doesn't really make sense).
  const pickerCoachReseed = useCoach
    ? [
        `  state.${coachChordSlot(safeName)} = 1`,
        `  state.${coachVoicingSlot(safeName)} = nil`,
        `  ${revoiceName(safeName)}()`,
      ].join('\n')
    : '';

  const pickerHandlerName = `handle_${safeName}_picker`;
  const pickerHandler = useLiveScale
    ? [
        `local function ${pickerHandlerName}(x, y, z)`,
        '  if z ~= 1 then return end',
        `  local target = ${pickerTable(safeName)}[x + y*W]`,
        '  if not target then return end',
        `  if target == state.${scaleIdxSlot(safeName)} then return end`,
        `  state.${scaleIdxSlot(safeName)} = target`,
        pickerCoachReseed,
        'end',
      ]
        .filter((l) => l !== '')
        .join('\n')
    : '';

  // ---- pixel function (when usePixel) ----
  // Computes brightness without separate pc/idle tables; pulls the
  // pitch class inline from `_<region>_note[k]` so we don't have to
  // duplicate that data on the device.
  const pixelLines: string[] = [];
  if (usePixel) {
    pixelLines.push(`local function ${pixelName(safeName)}(k)`);
    pixelLines.push(
      `  if state.${stateSlot}[k] then return ${params.led_held} end`,
    );
    if (useCoach) {
      // Coach overlay. The walk + revoice logic already gates by
      // scale_idx (live) and emits nothing for static+chromatic
      // (useCoach is false there), so here we just need to read
      // state.<n>_coach_voicing directly. Linear-scan check covers
      // 1/2/3-cell voicings — extra cv[i] slots are nil and won't
      // match k.
      pixelLines.push(
        `  local cv = state.${coachVoicingSlot(safeName)}`,
      );
      pixelLines.push(
        `  if cv and (cv[1] == k or cv[2] == k or cv[3] == k) then`,
      );
      pixelLines.push(
        `    return state.${coachBlinkSlot(safeName)} == 0 and ${LED_CHORD_HI} or ${LED_CHORD_LO}`,
      );
      pixelLines.push('  end');
    }
    // Compute pc inline. Lua `(neg) % 12` returns non-negative on 5.x.
    pixelLines.push(`  local note = ${noteTable}[k]`);
    pixelLines.push(`  if not note then return 0 end`);
    pixelLines.push(`  local pc = (note - ${params.root_note}) % 12`);
    pixelLines.push(`  if pc == 0 then return ${params.led_octave} end`);
    if (useLiveScale) {
      pixelLines.push(
        `  if state.${scaleIdxSlot(safeName)} == 1 then return ${params.led_idle} end`,
      );
      pixelLines.push(
        `  local member = ${scaleMemberTable(safeName)}[state.${scaleIdxSlot(safeName)}]`,
      );
      pixelLines.push(
        `  return (member and member[pc]) and ${params.led_idle} or ${params.led_offscale}`,
      );
    } else if (params.scale === 'chromatic') {
      pixelLines.push(`  return ${params.led_idle}`);
    } else {
      const intervals = SCALE_INTERVALS[params.scale];
      const entries = intervals.map((p) => `[${p}]=true`).join(', ');
      pixelLines.push(`  local in_scale = {${entries}}`);
      pixelLines.push(
        `  return in_scale[pc] and ${params.led_idle} or ${params.led_offscale}`,
      );
    }
    pixelLines.push('end');
  }

  // ---- blink metro (coach only) ----
  const blinkMetro = useCoach
    ? [
        '',
        `local function ${blinkTickName(safeName)}()`,
        `  state.${coachBlinkSlot(safeName)} = 1 - state.${coachBlinkSlot(safeName)}`,
        '  redraw()',
        'end',
        `local ${blinkMetroName(safeName)} = metro.init(${blinkTickName(safeName)}, ${COACH_BLINK_S})`,
        `${blinkMetroName(safeName)}:start()`,
      ].join('\n')
    : '';

  // ---- coach revoice helper (handler/picker/init all call it) ----
  const revoiceFn = useCoach
    ? buildRevoiceFn(safeName, useLiveScale, params.root_note)
    : '';

  // ---- declarations assembled ----
  const declarations = [
    `-- ---- region: ${safeName} ----`,
    `local ${noteTable} = {}`,
    noteLines,
    ...(useLiveScale
      ? [
          '',
          scaleMemberInit,
          '',
          `local ${pickerTable(safeName)} = {}`,
          pickerTargetLines,
        ]
      : []),
    ...(useCoach
      ? ['', voicingTableInit, '', nextChordTableLua, '', revoiceFn]
      : []),
    '',
    keyboardHandler,
    ...(useLiveScale ? ['', pickerHandler] : []),
    ...(usePixel ? ['', ...pixelLines] : []),
    blinkMetro,
  ]
    .filter((l) => l !== '')
    .join('\n');

  // ---- LED draw ----
  // For pixel-mode rectangular keyboards, emit a nested for-loop —
  // saves ~30 chars × N cells vs per-cell `grid_led(...)` calls.
  // The non-pixel path keeps per-cell emit because each cell's idle
  // brightness depends on its note's pc (varies per cell).
  let ledKeyboardLines: string[];
  if (usePixel && isRectKb) {
    ledKeyboardLines = [
      `  for y = ${yTkb + 1}, ${yBkb + 1} do`,
      `    for x = ${xLkb + 1}, ${xRkb + 1} do`,
      `      grid_led(x, y, ${pixelName(safeName)}(x + y*W))`,
      '    end',
      '  end',
    ];
  } else if (usePixel) {
    ledKeyboardLines = inRange.map(
      ({ cell }) =>
        `  grid_led(${luaXY(cell)}, ${pixelName(safeName)}(${luaKey(cell)}))`,
    );
  } else {
    ledKeyboardLines = inRange.map(({ cell, note }) => {
      const idleVal = idleBrightnessFor(note, params);
      return `  grid_led(${luaXY(cell)}, state.${stateSlot}[${luaKey(cell)}] and ${params.led_held} or ${idleVal})`;
    });
  }

  // Picker LED draw: contiguous 1-D vertical run, always loopable.
  // The expression `y - <yTop>` maps grid-y back to scale_idx, so
  // we don't need to encode each (y → idx) pairing separately.
  const ledPickerLines: string[] =
    useLiveScale && pickerCells.length > 0
      ? [
          `  for y = ${pickerYTop + 1}, ${pickerYTop + pickerCells.length} do`,
          `    grid_led(${pickerXcol}, y, state.${scaleIdxSlot(safeName)} == ${yToScaleIdx} and ${LED_PICKER_ACTIVE} or ${LED_PICKER_INACTIVE})`,
          '  end',
        ]
      : [];
  if (useLiveScale && pickerExtraCells.length > 0) {
    const eYtop = pickerExtraCells[0]!.y;
    const eYbot = pickerExtraCells[pickerExtraCells.length - 1]!.y;
    ledPickerLines.push(
      `  for y = ${eYtop + 1}, ${eYbot + 1} do`,
      `    grid_led(${pickerXcol}, y, ${LED_PICKER_UNUSED})`,
      '  end',
    );
  }

  const drawBlock = [
    `  -- region: ${safeName}`,
    ...ledKeyboardLines,
    ...ledPickerLines,
  ].join('\n');

  // ---- routes ----
  // Loop-emit when rectangular; the parent emit.ts rewrites
  // `_route[` → `_route_pN[` per page, so a `for...end` here
  // becomes a per-page route loop after rewrite.
  const routeAdditions: string[] = [];
  if (isRectKb) {
    routeAdditions.push(
      `for y = ${yTkb + 1}, ${yBkb + 1} do`,
      `  for x = ${xLkb + 1}, ${xRkb + 1} do`,
      `    _route[x + y*W] = ${handlerName}`,
      '  end',
      'end',
    );
  } else {
    routeAdditions.push(
      ...inRange.map(
        ({ cell }) => `_route[${luaKey(cell)}] = ${handlerName}`,
      ),
    );
  }
  if (useLiveScale && pickerCells.length > 0) {
    routeAdditions.push(
      `for y = ${pickerYTop + 1}, ${pickerYTop + pickerCells.length} do`,
      `  _route[${pickerXcol} + y*W] = ${pickerHandlerName}`,
      'end',
    );
  }

  // ---- state ----
  // coach_voicing starts unset (nil); _<n>_revoice() seeds it during
  // init, and the walk / picker keep it up to date thereafter.
  const stateInitLines = [`${stateSlot} = {},`];
  if (useLiveScale) {
    stateInitLines.push(
      `${scaleIdxSlot(safeName)} = ${scaleNameToIdx(params.scale)},`,
    );
  }
  if (useCoach) {
    stateInitLines.push(
      `${coachChordSlot(safeName)} = 1,`,
      `${coachBlinkSlot(safeName)} = 0,`,
    );
  }

  // Seed RNG once, then prime an initial coach voicing so the user
  // sees a chord suggestion before pressing anything.
  const initLines = useCoach
    ? [
        'math.randomseed(math.floor(get_time() * 1000))',
        `${revoiceName(safeName)}()`,
      ]
    : undefined;

  return {
    stateInit: stateInitLines.join('\n'),
    declarations,
    drawBlock,
    routeAdditions,
    initLines,
  };
}

// ---- helpers ----

const voicingTable = (n: string) => `_${n}_chord_voicing`;
const nextChordTable = (n: string) => `_${n}_next_chord`;
const pixelName = (n: string) => `_${n}_pixel`;
const blinkTickName = (n: string) => `_${n}_blink_tick`;
const blinkMetroName = (n: string) => `_${n}_blink_metro`;
const scaleMemberTable = (n: string) => `_${n}_scale_member`;
const pickerTable = (n: string) => `_${n}_picker`;
const revoiceName = (n: string) => `_${n}_revoice`;
const coachChordSlot = (n: string) => `${n}_coach_chord`;
const coachVoicingSlot = (n: string) => `${n}_coach_voicing`;
const coachBlinkSlot = (n: string) => `${n}_coach_blink`;
const scaleIdxSlot = (n: string) => `${n}_scale_idx`;

function scaleNameToIdx(name: string): number {
  const i = SCALE_NAMES.indexOf(name as (typeof SCALE_NAMES)[number]);
  return i >= 0 ? i + 1 : 1;
}

/**
 * Build the runtime `_<n>_revoice()` Lua function. Picks a fresh
 * voicing for the CURRENT chord (state.<n>_coach_chord) and applies
 * common-tone substitution: any cell in the new voicing whose pitch
 * class also appears in the previous voicing is replaced by the
 * previous voicing's cell of that pc, so shared tones don't visually
 * jump between blinks.
 *
 * Lua structure is shared between live-scale and static modes —
 * only the voicing-table lookup differs (2D vs 1D index).
 */
function buildRevoiceFn(
  safeName: string,
  useLiveScale: boolean,
  rootNote: number,
): string {
  const coachSlot = coachVoicingSlot(safeName);
  const noteT = `_${safeName}_note`;
  const vsLookup = useLiveScale
    ? `${voicingTable(safeName)}[state.${scaleIdxSlot(safeName)}][state.${coachChordSlot(safeName)}]`
    : `${voicingTable(safeName)}[state.${coachChordSlot(safeName)}]`;
  return [
    `local function ${revoiceName(safeName)}()`,
    `  local vs = ${vsLookup}`,
    `  if not vs or #vs == 0 then state.${coachSlot} = nil; return end`,
    `  local base = vs[math.random(1, #vs)]`,
    `  local prev = state.${coachSlot}`,
    `  local n = #base`,
    `  local nv = {}`,
    `  for i = 1, n do nv[i] = base[i] end`,
    `  if prev then`,
    `    for i = 1, n do`,
    `      local nn = ${noteT}[nv[i]]`,
    `      if nn then`,
    `        local npc = (nn - ${rootNote}) % 12`,
    `        for j = 1, #prev do`,
    `          local pc = prev[j]`,
    `          local pn = ${noteT}[pc]`,
    `          if pn and (pn - ${rootNote}) % 12 == npc then`,
    `            nv[i] = pc`,
    `            break`,
    `          end`,
    `        end`,
    `      end`,
    `    end`,
    `  end`,
    `  state.${coachSlot} = nv`,
    `end`,
  ].join('\n');
}

function idleBrightnessFor(
  note: number,
  params: NoteKeyboardBehavior['params'],
): number {
  const pc = ((note - params.root_note) % 12 + 12) % 12;
  if (pc === 0) return params.led_octave;
  if (params.scale === 'chromatic') return params.led_idle;
  const intervals = SCALE_INTERVALS[params.scale];
  return intervals.includes(pc) ? params.led_idle : params.led_offscale ?? 0;
}

type CellNote = { cell: Cell; note: number };
type ScoredVoicing = {
  items: CellNote[];
  /** Manhattan distance bounding-box (visual compactness on grid). */
  span: number;
  /** Inversion class: index in chordPCs of the lowest-pitch cell.
   *  0 = root pos, 1 = first inv, 2 = second inv. -1 if N/A
   *  (e.g. only 1 PC is reachable). */
  inv: number;
};

/**
 * Pick up to N voicings for one chord, optimized for the harmony
 * coach. Voicings are returned as integer-key tuples (cellKeyInt).
 *
 * Goals (per user request):
 *   1. Compact only — blinking cells should sit close together
 *      visually. We sort by Manhattan bounding-box span ascending.
 *   2. No octave-spread randomization — we hard-filter voicings
 *      whose pitch span exceeds one octave.
 *   3. Inversion variety — we explicitly partition voicings by
 *      which chord-PC sits at the bass (root / 3rd / 5th = root /
 *      1st inv / 2nd inv) and round-robin pick from each bucket so
 *      the user hears different rotations as the coach walks.
 *
 * If no voicing fits within MAX_PITCH_SPAN (very narrow keyboards),
 * we fall back to the unfiltered list — better some suggestion than
 * none.
 */
function pickVoicings(
  cellsWithNote: CellNote[],
  chordPCs: number[],
  maxVoicings: number,
): number[][] {
  const byPc = new Map<number, CellNote[]>();
  for (const it of cellsWithNote) {
    const pc = ((it.note % 12) + 12) % 12;
    const arr = byPc.get(pc) ?? [];
    arr.push(it);
    byPc.set(pc, arr);
  }

  const candidatesByPC = chordPCs.map((pc) => byPc.get(pc) ?? []);
  const reachable = candidatesByPC.filter((arr) => arr.length > 0);
  if (reachable.length === 0) return [];
  if (reachable.length === 1) {
    return [[cellKeyInt(reachable[0]![0]!.cell)]];
  }

  // Enumerate every cell-tuple covering the reachable chord-PCs.
  const all: ScoredVoicing[] = [];
  function search(idx: number, current: CellNote[]): void {
    if (idx === reachable.length) {
      const xs = current.map((it) => it.cell.x);
      const ys = current.map((it) => it.cell.y);
      const span =
        Math.max(...xs) -
        Math.min(...xs) +
        (Math.max(...ys) - Math.min(...ys));
      const notes = current.map((it) => it.note);
      // Inversion class = chordPCs index of the bass note's PC.
      let bassNote = notes[0]!;
      for (const n of notes) if (n < bassNote) bassNote = n;
      const bassPc = ((bassNote % 12) + 12) % 12;
      const inv = chordPCs.indexOf(bassPc);
      all.push({ items: [...current], span, inv });
      return;
    }
    for (const c of reachable[idx]!) {
      current.push(c);
      search(idx + 1, current);
      current.pop();
    }
  }
  search(0, []);

  // Dedupe by cell-set (the search produces permutation duplicates
  // when several PCs share a cell-set — e.g. when reachable is
  // smaller than chordPCs.length).
  const seen = new Set<string>();
  const unique: ScoredVoicing[] = [];
  for (const v of all) {
    const key = v.items
      .map((it) => `${it.cell.x},${it.cell.y}`)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v);
  }

  // Hard-filter octave-spanning voicings. Use pitchSpan (in
  // semitones) computed from the actual note values — that's what
  // the user actually hears.
  const compact = unique.filter((v) => {
    const ns = v.items.map((it) => it.note);
    return Math.max(...ns) - Math.min(...ns) <= MAX_PITCH_SPAN;
  });

  const pool = compact.length > 0 ? compact : unique;

  // Partition by inversion class.
  const byInv: Record<number, ScoredVoicing[]> = { 0: [], 1: [], 2: [] };
  const stray: ScoredVoicing[] = [];
  for (const v of pool) {
    if (v.inv === 0 || v.inv === 1 || v.inv === 2) {
      byInv[v.inv]!.push(v);
    } else {
      stray.push(v);
    }
  }
  for (const k of [0, 1, 2] as const) {
    byInv[k]!.sort((a, b) => a.span - b.span);
  }

  // Round-robin: iterate inversion classes and take the next
  // most-compact voicing from each, until we've collected K. This
  // guarantees inversion variety as long as each inversion has at
  // least one compact voicing.
  const picked: ScoredVoicing[] = [];
  let depth = 0;
  while (picked.length < maxVoicings) {
    let added = false;
    for (const inv of [0, 1, 2] as const) {
      if (
        depth < byInv[inv]!.length &&
        picked.length < maxVoicings
      ) {
        picked.push(byInv[inv]![depth]!);
        added = true;
      }
    }
    if (!added) break;
    depth++;
  }

  // If round-robin didn't fill (some inversion was empty), top up
  // with strays sorted by span.
  if (picked.length < maxVoicings && stray.length > 0) {
    stray.sort((a, b) => a.span - b.span);
    for (const v of stray) {
      if (picked.length >= maxVoicings) break;
      picked.push(v);
    }
  }

  return picked.map((v) => v.items.map((it) => cellKeyInt(it.cell)));
}

function buildVoicingsForScale(
  cellsWithNote: Array<{ cell: Cell; note: number }>,
  rootNote: number,
  scale: (typeof SCALE_NAMES)[number],
  maxVoicings: number,
): number[][][] {
  return Array.from({ length: 7 }, (_, di) => {
    const d = di + 1;
    const pcs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const note = noteAtDegree(rootNote, scale, (d - 1) + i * 2);
      pcs.push(((note % 12) + 12) % 12);
    }
    return pickVoicings(cellsWithNote, pcs, maxVoicings);
  });
}

function buildAllScaleVoicings(
  cellsWithNote: Array<{ cell: Cell; note: number }>,
  rootNote: number,
  maxVoicings: number,
): Record<number, number[][][]> {
  const result: Record<number, number[][][]> = {};
  SCALE_NAMES.forEach((scaleName, i) => {
    const idx = i + 1;
    if (scaleName === 'chromatic') {
      result[idx] = Array.from({ length: 7 }, () => []);
    } else {
      result[idx] = buildVoicingsForScale(
        cellsWithNote,
        rootNote,
        scaleName,
        maxVoicings,
      );
    }
  });
  return result;
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
