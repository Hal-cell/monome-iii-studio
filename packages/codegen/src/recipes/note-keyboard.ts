import type { Cell, NoteKeyboardBehavior, Region } from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import { noteAtDegree } from '../scales.ts';
import type { EmittedFragments } from './momentary.ts';

type NKRegion = Region & { behavior: NoteKeyboardBehavior };

/**
 * Diatonic chord progression graph used by the harmony-coach mode.
 * Keys are scale-degree numbers (1..7). Values are the plausible next
 * chord degrees. The graph is generic — it works for any 7-note scale
 * because chord quality (major / minor / diminished) follows from the
 * scale's intervals automatically.
 *
 * Movements roughly follow the tonic / subdominant / dominant
 * function families:
 *   I (tonic) → anywhere
 *   ii (sub-d) → V or vii°
 *   iii (tonic) → IV or vi
 *   IV (sub-d) → I, V, vii°
 *   V (dom)   → I, vi
 *   vi (tonic-substitute) → ii, IV, V
 *   vii° (dom) → I, iii
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

// Brightness levels for the chord blink (used when harmony_coach is on).
const LED_CHORD_HI = 13;
const LED_CHORD_LO = 6;

// Blink period for the chord-cell animation, in seconds.
const COACH_BLINK_S = 0.25;

export function emitNoteKeyboard(region: NKRegion): EmittedFragments {
  const { yTop, height, xLeft } = analyzeSelection(region.cells);
  const safeName = luaIdent(region.name);
  const handlerName = `handle_${safeName}`;
  const params = region.behavior.params;
  const stateSlot = `${safeName}_held`;
  const noteTable = `_${safeName}_note`;

  // Harmony coach is opt-in AND requires a 7-note scale (chromatic
  // would have all 12 pitch classes in every chord — no useful
  // distinction). Silently disabled for chromatic.
  const useCoach = params.harmony_coach && params.scale !== 'chromatic';

  // Compute the MIDI note for each cell. Drop cells whose note falls
  // outside [0, 127]: they get no note table entry, no LED line, no
  // route — they appear unlit and unresponsive.
  //
  // For chromatic scale, the row/column intervals are semitones —
  // identical to the pre-scale behaviour. For any other scale, they
  // are scale-degree steps; the keyboard becomes scale-aware, with
  // every cell landing on a note IN the scale.
  const cellsWithNote = region.cells.map((c) => {
    const rx = c.x - xLeft;
    const ry = c.y - yTop;
    const degree =
      (height - 1 - ry) * params.row_interval +
      rx * params.column_interval;
    const note = noteAtDegree(params.root_note, params.scale, degree);
    return { cell: c, note };
  });

  const inRange = cellsWithNote
    .filter(({ note }) => note >= 0 && note <= 127)
    .sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x);

  const noteLines = inRange
    .map(({ cell, note }) => `${noteTable}[${luaKey(cell)}] = ${note}`)
    .join('\n');

  // ---- harmony-coach precomputations ----
  //
  // Pitch class set for each chord degree (1..7). We pull triads from
  // scale positions (d-1, d+1, d+3) — the classic "stack two thirds"
  // construction within the user's scale. The actual chord quality
  // (M/m/dim) is determined by the scale's interval pattern.
  const chordPitchClasses = useCoach
    ? Array.from({ length: 7 }, (_, di) => {
        const d = di + 1;
        const pcs = new Set<number>();
        for (let i = 0; i < 3; i++) {
          const note = noteAtDegree(
            params.root_note,
            params.scale,
            (d - 1) + i * 2,
          );
          pcs.add(((note % 12) + 12) % 12);
        }
        return pcs;
      })
    : [];

  // Per-cell match table: for each cell with note N, which chord
  // degrees include pitch class (N mod 12)? Emit only entries that
  // match at least one chord (so the runtime lookup is dense).
  const chordMatchLines = useCoach
    ? inRange
        .map(({ cell, note }) => {
          const cellPc = ((note % 12) + 12) % 12;
          const matches: number[] = [];
          for (let d = 1; d <= 7; d++) {
            if (chordPitchClasses[d - 1]!.has(cellPc)) matches.push(d);
          }
          if (matches.length === 0) return null;
          const entries = matches.map((d) => `[${d}]=true`).join(', ');
          return `${matchTable(safeName)}[${luaKey(cell)}] = {${entries}}`;
        })
        .filter((l): l is string => l !== null)
        .join('\n')
    : '';

  // Idle brightness lookup per cell (used by the pixel function in
  // coach mode). Octave markers — cells whose note matches the root
  // pitch class — get `led_octave`; others get `led_idle`.
  const idleLines = useCoach
    ? inRange
        .map(({ cell, note }) => {
          const isOctave = (note - params.root_note) % 12 === 0;
          const v = isOctave ? params.led_octave : params.led_idle;
          return `${idleTable(safeName)}[${luaKey(cell)}] = ${v}`;
        })
        .join('\n')
    : '';

  // Transition-graph table.
  const nextChordTableLua = useCoach
    ? `local ${nextChordTable(safeName)} = {${Object.entries(NEXT_CHORD_DEGREE)
        .map(([d, opts]) => `[${d}]={${opts.join(', ')}}`)
        .join(', ')}}`
    : '';

  // ---- handler ----
  const handlerCoachAdvance = useCoach
    ? [
        '    -- harmony coach: walk to the next plausible chord degree',
        `    local opts = ${nextChordTable(safeName)}[state.${coachChordSlot(safeName)}]`,
        `    if opts then`,
        `      state.${coachChordSlot(safeName)} = opts[math.random(1, #opts)]`,
        `    end`,
      ].join('\n')
    : '';

  const handler = [
    `local function ${handlerName}(x, y, z)`,
    `  local note = ${noteTable}[x + y*W]`,
    '  if not note then return end',
    '  if z == 1 then',
    `    midi_note_on(note, ${params.velocity}, ${params.channel})`,
    `    state.${stateSlot}[x + y*W] = true`,
    handlerCoachAdvance,
    '  else',
    `    midi_note_off(note, 0, ${params.channel})`,
    `    state.${stateSlot}[x + y*W] = nil`,
    '  end',
    'end',
  ]
    .filter((l) => l !== '')
    .join('\n');

  // ---- pixel function (coach mode only) ----
  const pixelFn = useCoach
    ? [
        '',
        `local function ${pixelName(safeName)}(k)`,
        `  if state.${stateSlot}[k] then return ${params.led_held} end`,
        `  local m = ${matchTable(safeName)}[k]`,
        `  if m and m[state.${coachChordSlot(safeName)}] then`,
        `    return state.${coachBlinkSlot(safeName)} == 0 and ${LED_CHORD_HI} or ${LED_CHORD_LO}`,
        '  end',
        `  return ${idleTable(safeName)}[k] or 0`,
        'end',
      ].join('\n')
    : '';

  // ---- blink metro (coach mode only) ----
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

  const declarations = [
    `-- ---- region: ${safeName} ----`,
    `local ${noteTable} = {}`,
    noteLines,
    ...(useCoach
      ? [
          '',
          `local ${matchTable(safeName)} = {}`,
          chordMatchLines,
          '',
          `local ${idleTable(safeName)} = {}`,
          idleLines,
          '',
          nextChordTableLua,
        ]
      : []),
    '',
    handler,
    pixelFn,
    blinkMetro,
  ]
    .filter((l) => l !== '')
    .join('\n');

  // ---- LED draw ----
  const ledLines = useCoach
    ? // Coach mode: defer to pixel function so chord blink + held +
      // octave + idle are all decided at runtime.
      inRange
        .map(
          ({ cell }) =>
            `  grid_led(${luaXY(cell)}, ${pixelName(safeName)}(${luaKey(cell)}))`,
        )
        .join('\n')
    : // Non-coach: existing inline expression with octave brightness
      // baked in at compile time. Faster, no function call.
      inRange
        .map(({ cell, note }) => {
          const isOctave = (note - params.root_note) % 12 === 0;
          const idleVal = isOctave ? params.led_octave : params.led_idle;
          return `  grid_led(${luaXY(cell)}, state.${stateSlot}[${luaKey(cell)}] and ${params.led_held} or ${idleVal})`;
        })
        .join('\n');

  const drawBlock = [`  -- region: ${safeName}`, ledLines].join('\n');

  const routeAdditions = inRange.map(
    ({ cell }) => `_route[${luaKey(cell)}] = ${handlerName}`,
  );

  // State init: existing held set, plus coach state if enabled.
  const stateInitLines = [`${stateSlot} = {},`];
  if (useCoach) {
    stateInitLines.push(
      `${coachChordSlot(safeName)} = 1,`,
      `${coachBlinkSlot(safeName)} = 0,`,
    );
  }

  // Init lines: seed math.random for the chord walk.
  const initLines = useCoach
    ? ['math.randomseed(math.floor(get_time() * 1000))']
    : undefined;

  return {
    stateInit: stateInitLines.join('\n'),
    declarations,
    drawBlock,
    routeAdditions,
    initLines,
  };
}

// Identifier helpers — keep all the coach-only locals namespaced under
// the region name so multiple note_keyboard regions don't collide.
const matchTable = (n: string) => `_${n}_chord_match`;
const idleTable = (n: string) => `_${n}_idle`;
const nextChordTable = (n: string) => `_${n}_next_chord`;
const pixelName = (n: string) => `_${n}_pixel`;
const blinkTickName = (n: string) => `_${n}_blink_tick`;
const blinkMetroName = (n: string) => `_${n}_blink_metro`;
const coachChordSlot = (n: string) => `${n}_coach_chord`;
const coachBlinkSlot = (n: string) => `${n}_coach_blink`;

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
