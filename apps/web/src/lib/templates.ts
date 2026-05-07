/**
 * Layout templates — one-click starter layouts for common iii uses.
 *
 * Each template is a `LayoutExport`: it loads through `loadLayout()`
 * exactly like a user-imported `.layout.json` file, so there's no
 * separate code path. Templates are stored as plain data here, no
 * runtime computation, so the bundle stays small.
 *
 * Cell coordinates are 0-indexed, "x,y" string keys to match the
 * `cellKey()` format the rest of the app uses.
 */

import { VERSION as TOOL_VERSION } from '@monome-iii-studio/codegen';
import type { LayoutExport, SavedRegionJSON } from './persist.ts';

export type LayoutTemplate = {
  /** Stable id for UI / URL — also used as the React-style key. */
  id: string;
  /** User-facing label in the picker. */
  label: string;
  /** One-line description shown under the label. */
  description: string;
  /** Lazy builder so we only construct the LayoutExport when picked. */
  build: () => LayoutExport;
};

const FORMAT_VERSION = 1;

function cells(coords: ReadonlyArray<readonly [number, number]>): string[] {
  return coords.map(([x, y]) => `${x},${y}`);
}

function rect(x0: number, y0: number, w: number, h: number): string[] {
  const out: string[] = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      out.push(`${x},${y}`);
    }
  }
  return out;
}

// ---------- Drum pad 8×4 ----------
//
// 32 momentary cells in the bottom half of the grid, arranged in 4
// rows × 8 cols. Per-cell mode → each cell sends its own MIDI note,
// numbered ascending from `note` (the codegen orders cells by
// (y, x) and increments). Bottom-left = note 36, top-right of the
// pad = note 67.
function drumPad8x4(): LayoutExport {
  const region: SavedRegionJSON = {
    id: 'r-drum',
    name: 'pads',
    cellKeys: rect(0, 4, 8, 4),
    mode: 'per_cell',
    recipeKind: 'momentary',
    values: {
      output_type: 'note',
      channel: 10, // GM drum channel
      note: 36,
      velocity: 100,
      led_held: 12,
      led_idle: 3,
    },
    colorIndex: 0,
    pageIndex: 0,
  };
  return {
    format_version: FORMAT_VERSION,
    tool_version: TOOL_VERSION,
    layoutName: 'drum-pad-8x4',
    regions: [region],
    pageNames: ['main'],
  };
}

// ---------- Step sequencer 16×8 ----------
//
// One full-grid step_sequencer region. 8 rows = 8 tracks playing
// scale degrees, 16 cols = 16 steps. step_sequencer is always
// 'group' mode and has its own param vocabulary (base_note,
// on_value, etc.).
function stepSeq16x8(): LayoutExport {
  const region: SavedRegionJSON = {
    id: 'r-stepseq',
    name: 'seq',
    cellKeys: rect(0, 0, 16, 8),
    mode: 'group',
    recipeKind: 'step_sequencer',
    values: {
      output_mode: 'note_per_row',
      channel: 1,
      base_note: 48,
      base_cc: 20,
      scale: 'major',
      velocity: 100,
      on_value: 127,
      off_value: 0,
      bpm: 120,
      steps_per_beat: 4,
      direction: 'forward',
      gate_length: 1,
      mono: 'poly',
      divs: [1, 1, 1, 1, 1, 1, 1, 1],
      led_current_on: 15,
      led_current_off: 8,
      led_not_current_on: 5,
      led_not_current_off: 2,
    },
    colorIndex: 1,
    pageIndex: 0,
  };
  return {
    format_version: FORMAT_VERSION,
    tool_version: TOOL_VERSION,
    layoutName: 'step-seq-16x8',
    regions: [region],
    pageNames: ['main'],
  };
}

// ---------- Synth keyboard 15×8 + scale picker ----------
//
// Standard "iii synth" layout: a chromatic 15×8 keyboard with the
// rightmost column reserved as the live scale picker. Harmony coach
// is on so the user gets blinking chord suggestions while playing.
function synthKeyboard(): LayoutExport {
  const region: SavedRegionJSON = {
    id: 'r-keys',
    name: 'keys',
    cellKeys: rect(0, 0, 16, 8), // full grid; rightmost col turns into picker via live_scale_select
    mode: 'per_cell',
    recipeKind: 'note_keyboard',
    values: {
      channel: 1,
      root_note: 36,
      column_interval: 1,
      row_interval: 5,
      scale: 'major',
      velocity: 100,
      led_held: 12,
      led_idle: 4,
      led_octave: 9,
      led_offscale: 0,
      harmony_coach: 'on',
      live_scale_select: 'on',
    },
    colorIndex: 2,
    pageIndex: 0,
  };
  return {
    format_version: FORMAT_VERSION,
    tool_version: TOOL_VERSION,
    layoutName: 'synth-keyboard',
    regions: [region],
    pageNames: ['main'],
  };
}

// ---------- Public template list ----------

export const TEMPLATES: ReadonlyArray<LayoutTemplate> = [
  {
    id: 'drum-pad',
    label: 'Drum pad 8×4',
    description: '32 momentary triggers, GM drum channel, notes 36–67',
    build: drumPad8x4,
  },
  {
    id: 'step-seq',
    label: 'Step seq 16×8',
    description: '16-step sequencer, 8 tracks (rows), C major',
    build: stepSeq16x8,
  },
  {
    id: 'synth-kbd',
    label: 'Synth keyboard',
    description:
      '15×8 chromatic keyboard + live scale picker; harmony coach on',
    build: synthKeyboard,
  },
];

// Used by `cells()` exported helper for callers that want to build
// custom templates inline.
export { cells };
