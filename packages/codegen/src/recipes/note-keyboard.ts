import type { Cell, NoteKeyboardBehavior, Region } from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import { type ScaleName, SCALE_INTERVALS, noteAtDegree } from '../scales.ts';
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
  // Pitch class triads for each chord degree (1..7). We pull triads
  // from scale positions (d-1, d+1, d+3) — the classic "stack two
  // thirds" construction within the user's scale. The actual chord
  // quality (M/m/dim) is determined by the scale's interval pattern.
  const chordPitchClasses = useCoach
    ? Array.from({ length: 7 }, (_, di) => {
        const d = di + 1;
        const pcs: number[] = [];
        for (let i = 0; i < 3; i++) {
          const note = noteAtDegree(
            params.root_note,
            params.scale,
            (d - 1) + i * 2,
          );
          pcs.push(((note % 12) + 12) % 12);
        }
        return pcs;
      })
    : [];

  // Per-chord voicings: pick MULTIPLE specific voicings (3 cells
  // each, one per chord tone) covering the span range from tight
  // (closed) to spread (open). At runtime the script rolls a fresh
  // random voicing index each time the chord-suggestion advances,
  // so repeated visits to chord I show different shapes — including
  // open voicings whenever the keyboard is large enough.
  const chordVoicings = useCoach
    ? chordPitchClasses.map((pcs) => pickVoicings(inRange, pcs))
    : [];

  // Lua emit: for each chord degree, an array of voicings; each
  // voicing is a {[cell_key]=true,...} set of 3 cells.
  const chordVoicingLines = useCoach
    ? chordVoicings.map((voicings, di) => {
        const d = di + 1;
        if (voicings.length === 0) {
          return `${voicingTable(safeName)}[${d}] = {}`;
        }
        const inner = voicings
          .map((v) => {
            const entries = v.map((c) => `[${luaKey(c)}]=true`).join(', ');
            return `{${entries}}`;
          })
          .join(', ');
        return `${voicingTable(safeName)}[${d}] = {${inner}}`;
      })
    : [];

  // Idle brightness lookup per cell (used by the pixel function in
  // coach mode). Three tiers, in priority order:
  //   1. Octave marker (cell pitch class == root)        → led_octave
  //   2. In highlight_scale (only meaningful in chromatic) → led_idle
  //   3. Out of highlight_scale                           → led_offscale
  // When highlight_scale is 'none' or scale is non-chromatic, every
  // non-root cell is treated as in-scale (collapses to led_idle).
  const idleLines = useCoach
    ? inRange
        .map(({ cell, note }) => {
          const v = idleBrightnessFor(note, params);
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
  // Coach mode: walk the progression graph only when the held set
  // transitions from non-empty to empty (i.e. the user has finished
  // playing this chord and lifted all keys). Walking on every press
  // would advance 3+ times for a single triad — extremely confusing.
  // After advancing the chord we also re-roll a random voicing index
  // so repeated visits to the same chord show different shapes
  // (closed → open) — that's how open voicings appear over time.
  const handlerCoachRelease = useCoach
    ? [
        `    if next(state.${stateSlot}) == nil then`,
        '      -- All keys released — user has finished this chord. Walk.',
        `      local opts = ${nextChordTable(safeName)}[state.${coachChordSlot(safeName)}]`,
        `      if opts then`,
        `        state.${coachChordSlot(safeName)} = opts[math.random(1, #opts)]`,
        '      end',
        `      local vs = ${voicingTable(safeName)}[state.${coachChordSlot(safeName)}]`,
        `      if vs and #vs > 0 then`,
        `        state.${coachVoicingIdxSlot(safeName)} = math.random(1, #vs)`,
        '      end',
        '    end',
      ].join('\n')
    : '';

  const handler = [
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

  // ---- pixel function (coach mode only) ----
  // Voicing structure changed: voicings[chord] is now a list of
  // voicings (each a {[cell_key]=true,...} set). The currently-shown
  // voicing is voicings[chord][coach_voicing_idx].
  const pixelFn = useCoach
    ? [
        '',
        `local function ${pixelName(safeName)}(k)`,
        `  if state.${stateSlot}[k] then return ${params.led_held} end`,
        `  local vs = ${voicingTable(safeName)}[state.${coachChordSlot(safeName)}]`,
        `  if vs then`,
        `    local v = vs[state.${coachVoicingIdxSlot(safeName)}]`,
        `    if v and v[k] then`,
        `      return state.${coachBlinkSlot(safeName)} == 0 and ${LED_CHORD_HI} or ${LED_CHORD_LO}`,
        '    end',
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
          `local ${voicingTable(safeName)} = {}`,
          ...chordVoicingLines,
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
    : // Non-coach: inline expression with idle brightness baked in
      // at compile time (octave / in-scale / off-scale tier). Faster,
      // no function call.
      inRange
        .map(({ cell, note }) => {
          const idleVal = idleBrightnessFor(note, params);
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
      `${coachVoicingIdxSlot(safeName)} = 1,`,
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

/**
 * Compute the per-cell "not held" brightness for a given note,
 * honouring the four-tier visual hierarchy:
 *
 *   held cell                            → led_held    (handled separately)
 *   pitch class matches root             → led_octave
 *   pitch class is in highlight_scale    → led_idle
 *   pitch class is OUT of highlight_scale → led_offscale
 *
 * If `highlight_scale` is 'none' or the keyboard's `scale` already
 * filters to a non-chromatic set, the highlight is a no-op and
 * every non-root cell collapses to `led_idle`.
 */
function idleBrightnessFor(
  note: number,
  params: NoteKeyboardBehavior['params'],
): number {
  const pc = ((note - params.root_note) % 12 + 12) % 12;
  if (pc === 0) return params.led_octave;
  // Highlight only meaningful for chromatic keyboards. Non-chromatic
  // already constrain cells to in-scale notes. Older layout files
  // (pre-highlight_scale) leave the field undefined, which we treat
  // as 'none' for backward compatibility.
  const hi = params.highlight_scale;
  const highlightActive =
    hi !== undefined &&
    hi !== 'none' &&
    params.scale === 'chromatic' &&
    hi in SCALE_INTERVALS;
  if (!highlightActive) return params.led_idle;
  const intervals = SCALE_INTERVALS[hi as ScaleName];
  return intervals.includes(pc) ? params.led_idle : params.led_offscale ?? 0;
}

// Identifier helpers — keep all the coach-only locals namespaced under
// the region name so multiple note_keyboard regions don't collide.
const voicingTable = (n: string) => `_${n}_chord_voicing`;
const idleTable = (n: string) => `_${n}_idle`;
const nextChordTable = (n: string) => `_${n}_next_chord`;
const pixelName = (n: string) => `_${n}_pixel`;
const blinkTickName = (n: string) => `_${n}_blink_tick`;
const blinkMetroName = (n: string) => `_${n}_blink_metro`;
const coachChordSlot = (n: string) => `${n}_coach_chord`;
const coachVoicingIdxSlot = (n: string) => `${n}_coach_voicing_idx`;
const coachBlinkSlot = (n: string) => `${n}_coach_blink`;

/**
 * Maximum number of distinct voicings emitted per chord. The runtime
 * picks one of them at random each time the chord becomes the
 * suggestion, so the user sees varied voicings — closed, medium,
 * spread (a.k.a. "open") — instead of always the tightest 3 cells.
 *
 * 5 is a balance between Lua data size and visible variety. On a
 * keyboard small enough that fewer than 5 unique voicings exist,
 * we just emit however many do.
 */
const MAX_VOICINGS_PER_CHORD = 5;

/**
 * Pick up to N voicings for a chord on the current keyboard.
 *
 * Given the chord's pitch classes (root / third / fifth) and the
 * cells in the keyboard, enumerate every (root_cell, third_cell,
 * fifth_cell) combination, dedupe by cell set, sort by Manhattan
 * bounding-box span, then sample evenly across the span range so
 * the picked voicings cover tight → spread (open) shapes. The
 * runtime pixel function blinks one of these per chord visit.
 *
 * If the keyboard doesn't contain all three pitch classes we fall
 * back to whatever is reachable (or empty if none). The pixel
 * function silently shows no hint when a chord's voicing array is
 * empty.
 */
function pickVoicings(
  cellsWithNote: Array<{ cell: Cell; note: number }>,
  chordPCs: number[],
): Cell[][] {
  const byPc = new Map<number, Cell[]>();
  for (const { cell, note } of cellsWithNote) {
    const pc = ((note % 12) + 12) % 12;
    const arr = byPc.get(pc) ?? [];
    arr.push(cell);
    byPc.set(pc, arr);
  }

  const candidates = chordPCs.map((pc) => byPc.get(pc) ?? []);
  // Drop chord tones with no cells; we'll voice with whatever's left.
  const reachable = candidates.filter((arr) => arr.length > 0);
  if (reachable.length === 0) return [];
  if (reachable.length === 1) return [[reachable[0]![0]!]];

  // Enumerate every full-chord combination across the reachable
  // tones. With ≤ 3 tones and at most a dozen cells per tone, this
  // is at most a few hundred combos — runs at codegen time.
  type Voicing = { cells: Cell[]; span: number };
  const all: Voicing[] = [];
  function search(idx: number, current: Cell[]): void {
    if (idx === reachable.length) {
      const xs = current.map((c) => c.x);
      const ys = current.map((c) => c.y);
      const span =
        Math.max(...xs) -
        Math.min(...xs) +
        (Math.max(...ys) - Math.min(...ys));
      all.push({ cells: [...current], span });
      return;
    }
    for (const candidate of reachable[idx]!) {
      current.push(candidate);
      search(idx + 1, current);
      current.pop();
    }
  }
  search(0, []);

  // Sort by span ascending (tight → wide).
  all.sort((a, b) => a.span - b.span);

  // Dedupe by sorted cell-set (some 3-tuples differ only in tone
  // order; same physical voicing).
  const seen = new Set<string>();
  const unique: Voicing[] = [];
  for (const v of all) {
    const key = v.cells
      .map((c) => `${c.x},${c.y}`)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(v);
  }

  // Sample evenly across the span-sorted unique list so the picked
  // voicings cover the available range, not just the tightest few.
  const N = unique.length;
  const K = Math.min(MAX_VOICINGS_PER_CHORD, N);
  if (K <= 1) return unique.slice(0, K).map((v) => v.cells);
  const picked: Cell[][] = [];
  const pickedKeys = new Set<string>();
  for (let i = 0; i < K; i++) {
    const idx = Math.floor((i * (N - 1)) / (K - 1));
    const v = unique[idx]!;
    const key = v.cells
      .map((c) => `${c.x},${c.y}`)
      .sort()
      .join('|');
    if (pickedKeys.has(key)) continue;
    pickedKeys.add(key);
    picked.push(v.cells);
  }
  return picked;
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
