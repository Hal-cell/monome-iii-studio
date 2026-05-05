/**
 * Catalogue of all 7 v0 recipes with their UI schema and Behavior
 * builders. Adding a new recipe to the codegen means adding an entry
 * here too — the UI will pick it up automatically.
 */

import type { Behavior } from '@monome-iii-studio/codegen';
import type { BehaviorKind, ParamSchema, RecipeMeta } from './types.ts';
import { asInt, asString } from './types.ts';

// ---------- Momentary ----------

const momentary: RecipeMeta = {
  id: 'momentary',
  label: 'Momentary',
  description: 'press = on, release = off',
  modes: [
    { id: 'per_cell', label: 'per cell' },
    { id: 'group', label: 'group' },
  ],
  defaultValues: {
    output_type: 'note',
    channel: 1,
    note: 36,
    cc: 20,
    velocity: 100,
    led_held: 12,
    led_idle: 3,
  },
  paramsFor: (values) => {
    const head: ParamSchema[] = [
      {
        kind: 'enum',
        key: 'output_type',
        label: 'Output',
        options: [
          { value: 'note', label: 'Note' },
          { value: 'cc', label: 'CC' },
        ],
        default: 'note',
      },
      { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    ];
    const tail: ParamSchema[] = [
      { kind: 'int', key: 'led_held', label: 'LED held', min: 0, max: 15, default: 12 },
      { kind: 'int', key: 'led_idle', label: 'LED idle', min: 0, max: 15, default: 3 },
    ];
    if (values.output_type === 'cc') {
      return [
        ...head,
        { kind: 'int', key: 'cc', label: 'CC #', min: 0, max: 127, default: 20 },
        ...tail,
      ];
    }
    return [
      ...head,
      { kind: 'int', key: 'note', label: 'Base Note', min: 0, max: 127, default: 36 },
      { kind: 'int', key: 'velocity', label: 'Velocity', min: 0, max: 127, default: 100 },
      ...tail,
    ];
  },
  build: (_mode, v): Behavior => {
    const channel = asInt(v.channel, 1);
    const led_held = asInt(v.led_held, 12);
    const led_idle = asInt(v.led_idle, 3);
    if (asString(v.output_type, 'note') === 'note') {
      return {
        kind: 'momentary',
        params: {
          output_type: 'note',
          channel,
          note: asInt(v.note, 36),
          velocity: asInt(v.velocity, 100),
          led_held,
          led_idle,
        },
      };
    }
    return {
      kind: 'momentary',
      params: {
        output_type: 'cc',
        channel,
        cc: asInt(v.cc, 20),
        led_held,
        led_idle,
      },
    };
  },
};

// ---------- Toggle ----------

const toggle: RecipeMeta = {
  id: 'toggle',
  label: 'Toggle',
  description: 'press flips state, sends CC',
  modes: [
    { id: 'per_cell', label: 'per cell' },
    { id: 'group', label: 'group' },
  ],
  defaultValues: {
    channel: 1,
    cc: 20,
    on_value: 127,
    off_value: 0,
    led_on: 15,
    led_off: 3,
  },
  paramsFor: () => [
    { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    { kind: 'int', key: 'cc', label: 'CC #', min: 0, max: 127, default: 20 },
    { kind: 'int', key: 'on_value', label: 'ON value', min: 0, max: 127, default: 127 },
    { kind: 'int', key: 'off_value', label: 'OFF value', min: 0, max: 127, default: 0 },
    { kind: 'int', key: 'led_on', label: 'LED on', min: 0, max: 15, default: 15 },
    { kind: 'int', key: 'led_off', label: 'LED off', min: 0, max: 15, default: 3 },
  ],
  build: (_mode, v): Behavior => ({
    kind: 'toggle',
    params: {
      channel: asInt(v.channel, 1),
      cc: asInt(v.cc, 20),
      on_value: asInt(v.on_value, 127),
      off_value: asInt(v.off_value, 0),
      led_on: asInt(v.led_on, 15),
      led_off: asInt(v.led_off, 3),
    },
  }),
};

// ---------- Radio ----------

const radio: RecipeMeta = {
  id: 'radio',
  label: 'Radio',
  description: 'mutually-exclusive selection, CC mapped to 0..127',
  modes: [{ id: 'group', label: 'group' }],
  defaultValues: {
    channel: 1,
    cc: 30,
    initial_index: 0,
    led_on: 15,
    led_off: 3,
  },
  paramsFor: (_v, ctx) => [
    { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    { kind: 'int', key: 'cc', label: 'CC #', min: 0, max: 127, default: 30 },
    {
      kind: 'int',
      key: 'initial_index',
      label: 'Initial position',
      min: 0,
      max: Math.max(0, ctx.selectionSize - 1),
      default: 0,
    },
    { kind: 'int', key: 'led_on', label: 'LED on', min: 0, max: 15, default: 15 },
    { kind: 'int', key: 'led_off', label: 'LED off', min: 0, max: 15, default: 3 },
  ],
  build: (_mode, v): Behavior => ({
    kind: 'radio',
    params: {
      channel: asInt(v.channel, 1),
      cc: asInt(v.cc, 30),
      initial_index: asInt(v.initial_index, 0),
      led_on: asInt(v.led_on, 15),
      led_off: asInt(v.led_off, 3),
    },
  }),
};

// ---------- Range ----------

const range: RecipeMeta = {
  id: 'range',
  label: 'Range',
  description: 'two-point range, sends low + high CC',
  modes: [{ id: 'group', label: 'group' }],
  defaultValues: {
    channel: 1,
    cc_low: 40,
    cc_high: 41,
    led_in_range: 12,
    led_out_range: 3,
  },
  paramsFor: () => [
    { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    { kind: 'int', key: 'cc_low', label: 'CC low', min: 0, max: 127, default: 40 },
    { kind: 'int', key: 'cc_high', label: 'CC high', min: 0, max: 127, default: 41 },
    { kind: 'int', key: 'led_in_range', label: 'LED in range', min: 0, max: 15, default: 12 },
    { kind: 'int', key: 'led_out_range', label: 'LED out', min: 0, max: 15, default: 3 },
  ],
  build: (_mode, v): Behavior => ({
    kind: 'range',
    params: {
      channel: asInt(v.channel, 1),
      cc_low: asInt(v.cc_low, 40),
      cc_high: asInt(v.cc_high, 41),
      led_in_range: asInt(v.led_in_range, 12),
      led_out_range: asInt(v.led_out_range, 3),
    },
  }),
};

// ---------- Meter ----------

const meter: RecipeMeta = {
  id: 'meter',
  label: 'Meter',
  description: 'multi-column visual fader',
  modes: [{ id: 'group', label: 'group' }],
  defaultValues: {
    channel: 1,
    base_cc: 16,
    led_on: 12,
    led_off: 3,
  },
  paramsFor: () => [
    { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    { kind: 'int', key: 'base_cc', label: 'Base CC', min: 0, max: 127, default: 16 },
    { kind: 'int', key: 'led_on', label: 'LED on', min: 0, max: 15, default: 12 },
    { kind: 'int', key: 'led_off', label: 'LED off', min: 0, max: 15, default: 3 },
  ],
  build: (_mode, v): Behavior => ({
    kind: 'meter',
    params: {
      channel: asInt(v.channel, 1),
      base_cc: asInt(v.base_cc, 16),
      led_on: asInt(v.led_on, 12),
      led_off: asInt(v.led_off, 3),
    },
  }),
};

// ---------- Note keyboard ----------

const noteKeyboard: RecipeMeta = {
  id: 'note_keyboard',
  label: 'Note keyboard',
  description: 'isomorphic keyboard with configurable intervals',
  modes: [{ id: 'per_cell', label: 'per cell' }],
  defaultValues: {
    channel: 1,
    root_note: 36,
    column_interval: 1,
    row_interval: 5,
    velocity: 100,
    led_held: 12,
    led_idle: 3,
    led_octave: 6,
  },
  paramsFor: () => [
    { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    { kind: 'int', key: 'root_note', label: 'Root note', min: 0, max: 127, default: 36 },
    {
      kind: 'int',
      key: 'column_interval',
      label: 'Column interval',
      min: 0,
      max: 24,
      default: 1,
      help: 'semitones per cell within a row (1 = chromatic)',
    },
    {
      kind: 'int',
      key: 'row_interval',
      label: 'Row interval',
      min: 0,
      max: 24,
      default: 5,
      help: '5 = fourths, 7 = fifths, 12 = octaves',
    },
    { kind: 'int', key: 'velocity', label: 'Velocity', min: 0, max: 127, default: 100 },
    { kind: 'int', key: 'led_held', label: 'LED held', min: 0, max: 15, default: 12 },
    { kind: 'int', key: 'led_idle', label: 'LED idle', min: 0, max: 15, default: 3 },
    {
      kind: 'int',
      key: 'led_octave',
      label: 'LED octave marker',
      min: 0,
      max: 15,
      default: 6,
      help: 'cells whose note shares the root pitch class (every 12 semitones); set equal to LED idle to disable',
    },
  ],
  build: (_mode, v): Behavior => ({
    kind: 'note_keyboard',
    params: {
      channel: asInt(v.channel, 1),
      root_note: asInt(v.root_note, 36),
      column_interval: asInt(v.column_interval, 1),
      row_interval: asInt(v.row_interval, 5),
      velocity: asInt(v.velocity, 100),
      led_held: asInt(v.led_held, 12),
      led_idle: asInt(v.led_idle, 3),
      led_octave: asInt(v.led_octave, 6),
    },
  }),
};

// ---------- Step sequencer ----------

const stepSequencer: RecipeMeta = {
  id: 'step_sequencer',
  label: 'Step sequencer',
  description: 'metro-driven, per-row tracks',
  modes: [{ id: 'group', label: 'group' }],
  defaultValues: {
    output_mode: 'note_per_row',
    channel: 1,
    base_note: 36,
    base_cc: 20,
    velocity: 100,
    on_value: 127,
    off_value: 0,
    bpm: 120,
    steps_per_beat: 4,
    led_current_on: 15,
    led_current_off: 8,
    led_not_current_on: 5,
    led_not_current_off: 2,
  },
  paramsFor: (values) => {
    const head: ParamSchema[] = [
      {
        kind: 'enum',
        key: 'output_mode',
        label: 'Output',
        options: [
          { value: 'note_per_row', label: 'Note per row' },
          { value: 'cc_per_row', label: 'CC per row' },
        ],
        default: 'note_per_row',
      },
      { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    ];
    const tail: ParamSchema[] = [
      { kind: 'int', key: 'bpm', label: 'BPM', min: 1, max: 300, default: 120 },
      {
        kind: 'int',
        key: 'steps_per_beat',
        label: 'Steps per beat',
        min: 1,
        max: 16,
        default: 4,
        help: '4 = sixteenth notes',
      },
      { kind: 'int', key: 'led_current_on', label: 'LED step+on', min: 0, max: 15, default: 15 },
      { kind: 'int', key: 'led_current_off', label: 'LED step+off', min: 0, max: 15, default: 8 },
      { kind: 'int', key: 'led_not_current_on', label: 'LED on', min: 0, max: 15, default: 5 },
      { kind: 'int', key: 'led_not_current_off', label: 'LED off', min: 0, max: 15, default: 2 },
    ];
    if (values.output_mode === 'cc_per_row') {
      return [
        ...head,
        { kind: 'int', key: 'base_cc', label: 'Base CC', min: 0, max: 127, default: 20 },
        { kind: 'int', key: 'on_value', label: 'ON value', min: 0, max: 127, default: 127 },
        { kind: 'int', key: 'off_value', label: 'OFF value', min: 0, max: 127, default: 0 },
        ...tail,
      ];
    }
    return [
      ...head,
      { kind: 'int', key: 'base_note', label: 'Base note', min: 0, max: 127, default: 36 },
      { kind: 'int', key: 'velocity', label: 'Velocity', min: 0, max: 127, default: 100 },
      ...tail,
    ];
  },
  build: (_mode, v): Behavior => {
    const common = {
      channel: asInt(v.channel, 1),
      bpm: asInt(v.bpm, 120),
      steps_per_beat: asInt(v.steps_per_beat, 4),
      led_current_on: asInt(v.led_current_on, 15),
      led_current_off: asInt(v.led_current_off, 8),
      led_not_current_on: asInt(v.led_not_current_on, 5),
      led_not_current_off: asInt(v.led_not_current_off, 2),
    };
    if (asString(v.output_mode, 'note_per_row') === 'cc_per_row') {
      return {
        kind: 'step_sequencer',
        params: {
          output_mode: 'cc_per_row',
          base_cc: asInt(v.base_cc, 20),
          on_value: asInt(v.on_value, 127),
          off_value: asInt(v.off_value, 0),
          ...common,
        },
      };
    }
    return {
      kind: 'step_sequencer',
      params: {
        output_mode: 'note_per_row',
        base_note: asInt(v.base_note, 36),
        velocity: asInt(v.velocity, 100),
        ...common,
      },
    };
  },
};

// ---------- Catalogue ----------

export const RECIPES: Record<BehaviorKind, RecipeMeta> = {
  momentary,
  toggle,
  radio,
  range,
  meter,
  note_keyboard: noteKeyboard,
  step_sequencer: stepSequencer,
};

/**
 * Display order. The selector renders recipes in this order so the
 * simple ones come first.
 */
export const RECIPE_ORDER: BehaviorKind[] = [
  'momentary',
  'toggle',
  'radio',
  'range',
  'meter',
  'note_keyboard',
  'step_sequencer',
];
