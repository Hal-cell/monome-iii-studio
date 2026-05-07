/**
 * Layout templates — one-click starter layouts for common iii uses.
 *
 * Two flavours coexist in the panel's Templates dropdown:
 *   1. Starters (this file's `TEMPLATES` array) — hardcoded
 *      LayoutExports for drum pad, step seq, synth keyboard.
 *      Always present, never deletable.
 *   2. User templates — user-saved snapshots of whatever layout is
 *      currently in the editor. Persisted in localStorage under
 *      USER_TEMPLATES_KEY. Reactive signal so the dropdown
 *      auto-refreshes on save / delete.
 *
 * Each template is a `LayoutExport`: it loads through `loadLayout()`
 * exactly like a user-imported `.layout.json` file, so there's no
 * separate code path. Templates are stored as plain data, no runtime
 * computation, so the bundle stays small.
 *
 * Cell coordinates are 0-indexed, "x,y" string keys to match the
 * `cellKey()` format the rest of the app uses.
 */

import { createSignal } from 'solid-js';
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

// ---------- User templates (persisted) ----------
//
// Stored in localStorage under USER_TEMPLATES_KEY as a JSON array
// of UserTemplate. We keep the structure flat (no nesting under a
// version envelope) — if the schema ever changes, bump the key.

export type UserTemplate = {
  /** Stable id, generated as `t-<timestamp>`. */
  id: string;
  /** User-provided label shown in the dropdown. */
  label: string;
  /** Snapshot of the layout at save time. */
  layout: LayoutExport;
  /** ISO timestamp of save time, used for sorting + the sub-label. */
  savedAt: string;
};

const USER_TEMPLATES_KEY = 'monome-iii-studio:user-templates-v1';
const MAX_USER_TEMPLATES = 30;

function readFromStorage(): UserTemplate[] {
  try {
    const raw = localStorage.getItem(USER_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Trust-but-verify each entry; drop malformed ones rather than
    // throw, so a single bad record doesn't blow away the whole
    // template list.
    return parsed.filter(
      (t): t is UserTemplate =>
        t &&
        typeof t.id === 'string' &&
        typeof t.label === 'string' &&
        typeof t.savedAt === 'string' &&
        t.layout &&
        typeof t.layout === 'object' &&
        Array.isArray(t.layout.regions),
    );
  } catch {
    return [];
  }
}

function writeToStorage(list: UserTemplate[]): void {
  try {
    localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(list));
  } catch {
    // Quota exceeded / private mode — silent best-effort. Saved
    // template will exist in memory until reload.
  }
}

const [_userTemplates, _setUserTemplates] = createSignal<UserTemplate[]>(
  readFromStorage(),
);

/** Reactive list of user-saved templates, sorted newest-first. */
export const userTemplates = _userTemplates;

/**
 * Persist a fresh template. Returns the saved record. If a template
 * with the same label already exists, this OVERWRITES it (keyed by
 * label so re-saving "my drum kit" doesn't accumulate duplicates —
 * users typically iterate on a layout and re-save under the same
 * name). Otherwise prepends to the list.
 *
 * Hard-caps at MAX_USER_TEMPLATES; oldest entry is dropped on
 * overflow.
 */
export function saveUserTemplate(
  label: string,
  layout: LayoutExport,
): UserTemplate {
  const trimmed = label.trim();
  const finalLabel = trimmed.length > 0 ? trimmed : 'untitled';
  const existing = _userTemplates().find((t) => t.label === finalLabel);
  const record: UserTemplate = {
    id: existing?.id ?? `t-${Date.now()}`,
    label: finalLabel,
    layout,
    savedAt: new Date().toISOString(),
  };
  let next: UserTemplate[];
  if (existing) {
    next = _userTemplates().map((t) => (t.id === existing.id ? record : t));
  } else {
    next = [record, ..._userTemplates()];
  }
  if (next.length > MAX_USER_TEMPLATES) {
    next = next.slice(0, MAX_USER_TEMPLATES);
  }
  _setUserTemplates(next);
  writeToStorage(next);
  return record;
}

export function deleteUserTemplate(id: string): void {
  const next = _userTemplates().filter((t) => t.id !== id);
  _setUserTemplates(next);
  writeToStorage(next);
}

/** Convenience: check if a label is already taken. */
export function userTemplateLabelExists(label: string): boolean {
  const trimmed = label.trim();
  return _userTemplates().some((t) => t.label === trimmed);
}
