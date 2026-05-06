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
const MAX_VOICINGS_STATIC = 5;

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
  const useCoach = params.harmony_coach === true;
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
  const noteLines = inRange
    .map(({ cell, note }) => `${noteTable}[${luaKey(cell)}] = ${note}`)
    .join('\n');

  // ---- scale-membership table (only when useLiveScale) ----
  // 8 entries (one per scale), each a {[pc]=true} set of in-scale
  // pitch classes. The pixel function uses this to decide
  // led_idle vs led_offscale per cell when `state.scale_idx`
  // changes. ~1 KB total.
  const scaleMemberLines = useLiveScale
    ? SCALE_NAMES.map((name, idx) => {
        const intervals = SCALE_INTERVALS[name];
        const entries = intervals.map((pc) => `[${pc}]=true`).join(', ');
        return `${scaleMemberTable(safeName)}[${idx + 1}] = {${entries}}`;
      }).join('\n')
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

  const voicingTableInit = useCoach
    ? useLiveScale
      ? [
          `local ${voicingTable(safeName)} = {}`,
          ...SCALE_NAMES.map(
            (_n, i) => `${voicingTable(safeName)}[${i + 1}] = {}`,
          ),
        ].join('\n')
      : `local ${voicingTable(safeName)} = {}`
    : '';

  const voicingTableLines = voicingsByScale
    ? Object.entries(voicingsByScale)
        .flatMap(([scaleIdxStr, perChord]) => {
          const scaleIdx = Number(scaleIdxStr);
          return perChord
            .map((voicings, di) => {
              const d = di + 1;
              if (voicings.length === 0) return null;
              const inner = voicings
                .map((v) => `{${v.join(', ')}}`)
                .join(', ');
              return useLiveScale
                ? `${voicingTable(safeName)}[${scaleIdx}][${d}] = {${inner}}`
                : `${voicingTable(safeName)}[${d}] = {${inner}}`;
            })
            .filter((l): l is string => l !== null);
        })
        .join('\n')
    : '';

  const nextChordTableLua = useCoach
    ? `local ${nextChordTable(safeName)} = {${Object.entries(NEXT_CHORD_DEGREE)
        .map(([d, opts]) => `[${d}]={${opts.join(', ')}}`)
        .join(', ')}}`
    : '';

  // ---- scale-picker cells (rightmost column) ----
  const pickerCellsAll = region.cells
    .filter((c) => isPickerCell(c))
    .sort((a, b) => a.y - b.y); // top → bottom = scale_idx 1..N
  const pickerCells = pickerCellsAll.slice(0, SCALE_NAMES.length);
  const pickerExtraCells = pickerCellsAll.slice(SCALE_NAMES.length);

  const pickerTargetLines = useLiveScale
    ? pickerCells
        .map((c, i) => `${pickerTable(safeName)}[${luaKey(c)}] = ${i + 1}`)
        .join('\n')
    : '';

  // ---- handlers ----
  // The "walk to next chord" block lives inside `if next(held) == nil`,
  // which already provides a scope, so static mode emits the body
  // directly. Live mode adds an extra `state.scale_idx ~= 1` guard so we
  // don't walk while the user has chromatic selected.
  const releaseInner = useCoach
    ? (() => {
        const indent = useLiveScale ? '        ' : '      ';
        const lines: string[] = [
          `${indent}local opts = ${nextChordTable(safeName)}[state.${coachChordSlot(safeName)}]`,
          `${indent}if opts then`,
          `${indent}  state.${coachChordSlot(safeName)} = opts[math.random(1, #opts)]`,
          `${indent}end`,
          useLiveScale
            ? `${indent}local vs = ${voicingTable(safeName)}[state.${scaleIdxSlot(safeName)}][state.${coachChordSlot(safeName)}]`
            : `${indent}local vs = ${voicingTable(safeName)}[state.${coachChordSlot(safeName)}]`,
          `${indent}if vs and #vs > 0 then`,
          `${indent}  state.${coachVoicingIdxSlot(safeName)} = math.random(1, #vs)`,
          `${indent}end`,
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

  // Picker handler: switch active scale + reseed coach voicing for new
  // scale.
  const pickerCoachReseed = useCoach
    ? [
        `  state.${coachChordSlot(safeName)} = 1`,
        `  if state.${scaleIdxSlot(safeName)} ~= 1 then`,
        `    local vs = ${voicingTable(safeName)}[state.${scaleIdxSlot(safeName)}][1]`,
        `    if vs and #vs > 0 then`,
        `      state.${coachVoicingIdxSlot(safeName)} = math.random(1, #vs)`,
        '    end',
        '  end',
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
      // Coach overlay. Live-scale mode wraps the lookup in a
      // `state.scale_idx ~= 1` guard so chromatic mode shows no
      // suggestion. Static-scale mode only emits the block at all when
      // the chosen scale isn't chromatic (in chromatic mode there's no
      // diatonic chord set), so no guard is needed there.
      const emitCoachBlock =
        useLiveScale || params.scale !== 'chromatic';
      if (emitCoachBlock) {
        const indent = useLiveScale ? '    ' : '  ';
        const vsLookup = useLiveScale
          ? `${voicingTable(safeName)}[state.${scaleIdxSlot(safeName)}]`
          : voicingTable(safeName);
        if (useLiveScale) {
          pixelLines.push(
            `  if state.${scaleIdxSlot(safeName)} ~= 1 then`,
          );
        }
        pixelLines.push(
          `${indent}local v = ${vsLookup}[state.${coachChordSlot(safeName)}]`,
        );
        pixelLines.push(`${indent}if v then`);
        pixelLines.push(
          `${indent}  local cv = v[state.${coachVoicingIdxSlot(safeName)}]`,
        );
        pixelLines.push(
          `${indent}  if cv and (cv[1] == k or cv[2] == k or cv[3] == k) then`,
        );
        pixelLines.push(
          `${indent}    return state.${coachBlinkSlot(safeName)} == 0 and ${LED_CHORD_HI} or ${LED_CHORD_LO}`,
        );
        pixelLines.push(`${indent}  end`);
        pixelLines.push(`${indent}end`);
        if (useLiveScale) {
          pixelLines.push('  end');
        }
      }
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

  // ---- declarations assembled ----
  const declarations = [
    `-- ---- region: ${safeName} ----`,
    `local ${noteTable} = {}`,
    noteLines,
    ...(useLiveScale
      ? [
          '',
          `local ${scaleMemberTable(safeName)} = {}`,
          scaleMemberLines,
          '',
          `local ${pickerTable(safeName)} = {}`,
          pickerTargetLines,
        ]
      : []),
    ...(useCoach
      ? ['', voicingTableInit, voicingTableLines, '', nextChordTableLua]
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
  const ledKeyboardLines = usePixel
    ? inRange.map(
        ({ cell }) =>
          `  grid_led(${luaXY(cell)}, ${pixelName(safeName)}(${luaKey(cell)}))`,
      )
    : inRange.map(({ cell, note }) => {
        const idleVal = idleBrightnessFor(note, params);
        return `  grid_led(${luaXY(cell)}, state.${stateSlot}[${luaKey(cell)}] and ${params.led_held} or ${idleVal})`;
      });

  const ledPickerLines = useLiveScale
    ? [
        ...pickerCells.map(
          (c, i) =>
            `  grid_led(${luaXY(c)}, state.${scaleIdxSlot(safeName)} == ${i + 1} and ${LED_PICKER_ACTIVE} or ${LED_PICKER_INACTIVE})`,
        ),
        ...pickerExtraCells.map(
          (c) => `  grid_led(${luaXY(c)}, ${LED_PICKER_UNUSED})`,
        ),
      ]
    : [];

  const drawBlock = [
    `  -- region: ${safeName}`,
    ...ledKeyboardLines,
    ...ledPickerLines,
  ].join('\n');

  // ---- routes ----
  const routeAdditions = [
    ...inRange.map(
      ({ cell }) => `_route[${luaKey(cell)}] = ${handlerName}`,
    ),
    ...(useLiveScale
      ? pickerCells.map(
          (c) => `_route[${luaKey(c)}] = ${pickerHandlerName}`,
        )
      : []),
  ];

  // ---- state ----
  const stateInitLines = [`${stateSlot} = {},`];
  if (useLiveScale) {
    stateInitLines.push(
      `${scaleIdxSlot(safeName)} = ${scaleNameToIdx(params.scale)},`,
    );
  }
  if (useCoach) {
    stateInitLines.push(
      `${coachChordSlot(safeName)} = 1,`,
      `${coachVoicingIdxSlot(safeName)} = 1,`,
      `${coachBlinkSlot(safeName)} = 0,`,
    );
  }

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

// ---- helpers ----

const voicingTable = (n: string) => `_${n}_chord_voicing`;
const nextChordTable = (n: string) => `_${n}_next_chord`;
const pixelName = (n: string) => `_${n}_pixel`;
const blinkTickName = (n: string) => `_${n}_blink_tick`;
const blinkMetroName = (n: string) => `_${n}_blink_metro`;
const scaleMemberTable = (n: string) => `_${n}_scale_member`;
const pickerTable = (n: string) => `_${n}_picker`;
const coachChordSlot = (n: string) => `${n}_coach_chord`;
const coachVoicingIdxSlot = (n: string) => `${n}_coach_voicing_idx`;
const coachBlinkSlot = (n: string) => `${n}_coach_blink`;
const scaleIdxSlot = (n: string) => `${n}_scale_idx`;

function scaleNameToIdx(name: string): number {
  const i = SCALE_NAMES.indexOf(name as (typeof SCALE_NAMES)[number]);
  return i >= 0 ? i + 1 : 1;
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

/**
 * Pick up to N voicings for one chord on the current keyboard,
 * returned as integer-key tuples (precomputed cellKeyInt). The
 * sampling logic is the same as before — enumerate every
 * (root, third, fifth) tuple, dedupe, sort by Manhattan span,
 * sample evenly across the span range to cover tight → spread.
 */
function pickVoicings(
  cellsWithNote: Array<{ cell: Cell; note: number }>,
  chordPCs: number[],
  maxVoicings: number,
): number[][] {
  const byPc = new Map<number, Cell[]>();
  for (const { cell, note } of cellsWithNote) {
    const pc = ((note % 12) + 12) % 12;
    const arr = byPc.get(pc) ?? [];
    arr.push(cell);
    byPc.set(pc, arr);
  }

  const candidates = chordPCs.map((pc) => byPc.get(pc) ?? []);
  const reachable = candidates.filter((arr) => arr.length > 0);
  if (reachable.length === 0) return [];
  if (reachable.length === 1) return [[cellKeyInt(reachable[0]![0]!)]];

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
  all.sort((a, b) => a.span - b.span);

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

  const N = unique.length;
  const K = Math.min(maxVoicings, N);
  if (K <= 1) {
    return unique.slice(0, K).map((v) => v.cells.map(cellKeyInt));
  }
  const picked: number[][] = [];
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
    picked.push(v.cells.map(cellKeyInt));
  }
  return picked;
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
