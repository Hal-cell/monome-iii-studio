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

const SCALE_OPTIONS = [
  { value: 'chromatic', label: 'Chromatic' },
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'dorian', label: 'Dorian' },
  { value: 'phrygian', label: 'Phrygian' },
  { value: 'lydian', label: 'Lydian' },
  { value: 'mixolydian', label: 'Mixolydian' },
  { value: 'locrian', label: 'Locrian' },
] as const;

type ScaleName =
  | 'chromatic'
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian';

function asScale(v: unknown): ScaleName {
  const s = asString(v, 'chromatic');
  return SCALE_OPTIONS.some((o) => o.value === s) ? (s as ScaleName) : 'chromatic';
}

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
    scale: 'chromatic',
    velocity: 100,
    led_held: 12,
    led_idle: 3,
    led_octave: 6,
    led_offscale: 0,
    harmony_coach: 'off',
  },
  paramsFor: (values) => [
    { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    { kind: 'int', key: 'root_note', label: 'Root note', min: 0, max: 127, default: 36 },
    {
      kind: 'enum',
      key: 'scale',
      label: 'Scale',
      options: SCALE_OPTIONS,
      default: 'chromatic',
      help:
        values.scale === 'chromatic' || values.scale === undefined
          ? 'note layout is always chromatic (semitones); pick a 7-note scale to highlight only those cells visually'
          : 'note layout is chromatic; in-scale cells show at LED idle, off-scale cells at LED off-scale (root always at LED octave marker)',
    },
    {
      kind: 'int',
      key: 'column_interval',
      label: 'Column interval',
      min: 0,
      max: 24,
      default: 1,
      help: 'semitones per cell along a row (1 = chromatic)',
    },
    {
      kind: 'int',
      key: 'row_interval',
      label: 'Row interval',
      min: 0,
      max: 24,
      default: 5,
      help: 'semitones between rows (5 = fourths, 7 = fifths, 12 = octaves)',
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
    // led_offscale only matters when scale is non-chromatic (chromatic
    // has no off-scale notes). Hide for chromatic to keep the panel
    // tidy; otherwise show it right after the scale picker.
    ...(values.scale !== 'chromatic' && values.scale !== undefined
      ? ([
          {
            kind: 'int' as const,
            key: 'led_offscale',
            label: 'LED off-scale',
            min: 0,
            max: 15,
            default: 0,
            help: 'brightness for cells whose note is OUT of the chosen scale; 0 hides them entirely',
          },
        ] as ParamSchema[])
      : []),
    {
      kind: 'enum',
      key: 'harmony_coach',
      label: 'Harmony coach',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      default: 'off',
      help:
        values.scale === 'chromatic'
          ? 'no-op for chromatic scale — pick a 7-note scale (major / minor / dorian / …) to use'
          : 'cells of the next suggested chord blink; each press walks the progression graph (I → ii / iii / IV / V / vi / vii° etc.)',
    },
  ],
  build: (_mode, v): Behavior => ({
    kind: 'note_keyboard',
    params: {
      channel: asInt(v.channel, 1),
      root_note: asInt(v.root_note, 36),
      column_interval: asInt(v.column_interval, 1),
      row_interval: asInt(v.row_interval, 5),
      scale: asScale(v.scale),
      velocity: asInt(v.velocity, 100),
      led_held: asInt(v.led_held, 12),
      led_idle: asInt(v.led_idle, 3),
      led_octave: asInt(v.led_octave, 6),
      led_offscale: asInt(v.led_offscale, 0),
      harmony_coach: asString(v.harmony_coach, 'off') === 'on',
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
    scale: 'chromatic',
    velocity: 100,
    on_value: 127,
    off_value: 0,
    bpm: 120,
    steps_per_beat: 4,
    direction: 'forward',
    gate_length: 1,
    mono: 'poly',
    // Pre-fill enough entries for a full-grid selection so the value
    // store has a concrete array on day one. The emitter pads anyway,
    // but this keeps the UI store predictable.
    divs: [1, 1, 1, 1, 1, 1, 1, 1],
    led_current_on: 15,
    led_current_off: 8,
    led_not_current_on: 5,
    led_not_current_off: 2,
  },
  paramsFor: (values, ctx) => {
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
      {
        kind: 'enum',
        key: 'direction',
        label: 'Direction',
        options: [
          { value: 'forward', label: 'Forward' },
          { value: 'reverse', label: 'Reverse' },
          { value: 'pingpong', label: 'Pingpong' },
        ],
        default: 'forward',
      },
      {
        kind: 'int',
        key: 'gate_length',
        label: 'Gate length (master ticks)',
        min: 1,
        max: 16,
        default: 1,
        help: '1 = blip; higher values sustain across multiple master ticks (retriggers if same row hits again before gate expires)',
      },
      ...(ctx.numRows > 0
        ? ([
            {
              kind: 'int_array' as const,
              key: 'divs',
              label: 'Per-row div',
              min: 1,
              max: 16,
              default: 1,
              length: ctx.numRows,
              help: 'master ticks per step, per row. all 1s = synchronous; different values = polyrhythm',
            },
          ] satisfies ParamSchema[])
        : []),
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
      {
        kind: 'int',
        key: 'base_note',
        label: 'Base note',
        min: 0,
        max: 127,
        default: 36,
        help: 'BOTTOM row of the selection plays this note (top row = highest pitch)',
      },
      {
        kind: 'enum',
        key: 'scale',
        label: 'Scale',
        options: SCALE_OPTIONS,
        default: 'chromatic',
      },
      { kind: 'int', key: 'velocity', label: 'Velocity', min: 0, max: 127, default: 100 },
      {
        kind: 'enum',
        key: 'mono',
        label: 'Polyphony',
        options: [
          { value: 'poly', label: 'Poly' },
          { value: 'mono', label: 'Mono' },
        ],
        default: 'poly',
      },
      ...tail,
    ];
  },
  build: (_mode, v): Behavior => {
    const directionRaw = asString(v.direction, 'forward');
    const direction: 'forward' | 'reverse' | 'pingpong' =
      directionRaw === 'reverse' || directionRaw === 'pingpong'
        ? directionRaw
        : 'forward';
    const rawDivs = Array.isArray(v.divs) ? (v.divs as unknown[]) : [];
    const divs = rawDivs.map((d) =>
      typeof d === 'number' && d >= 1 ? Math.floor(d) : 1,
    );
    const common = {
      channel: asInt(v.channel, 1),
      bpm: asInt(v.bpm, 120),
      steps_per_beat: asInt(v.steps_per_beat, 4),
      direction,
      gate_length: asInt(v.gate_length, 1),
      divs,
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
        scale: asScale(v.scale),
        velocity: asInt(v.velocity, 100),
        mono: asString(v.mono, 'poly') === 'mono',
        ...common,
      },
    };
  },
};

// ---------- LFO ----------

const LFO_WAVEFORMS = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'saw', label: 'Saw' },
  { value: 'square', label: 'Square' },
] as const;

type LfoWaveformName = 'sine' | 'triangle' | 'saw' | 'square';

function asWaveform(v: unknown): LfoWaveformName {
  const s = asString(v, 'sine');
  return LFO_WAVEFORMS.some((o) => o.value === s)
    ? (s as LfoWaveformName)
    : 'sine';
}

const lfo: RecipeMeta = {
  id: 'lfo',
  label: 'LFO',
  description: 'cyclic CC modulation, visualised as a meter',
  modes: [{ id: 'group', label: 'group' }],
  defaultValues: {
    channel: 1,
    cc: 50,
    waveform: 'sine',
    // period needs decimal precision (0.1s = 10 Hz). The int-param
    // schema doesn't do floats, so we store period as 100ths of a
    // second under a separate key and convert on build.
    period_centiseconds: 100, // 1.0 s
    center: 64,
    depth: 96,
    led_bright: 12,
    led_dim: 3,
  },
  paramsFor: () => [
    { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    { kind: 'int', key: 'cc', label: 'CC #', min: 0, max: 127, default: 50 },
    {
      kind: 'enum',
      key: 'waveform',
      label: 'Waveform',
      options: LFO_WAVEFORMS,
      default: 'sine',
    },
    {
      kind: 'int',
      key: 'period_centiseconds',
      label: 'Period (×0.01s)',
      min: 10,
      max: 3000,
      default: 100,
      help: 'cycle length in hundredths of a second; 100 = 1 s, 50 = 0.5 s, 1000 = 10 s',
    },
    {
      kind: 'int',
      key: 'center',
      label: 'Center',
      min: 0,
      max: 127,
      default: 64,
      help: 'midpoint of the output range',
    },
    {
      kind: 'int',
      key: 'depth',
      label: 'Depth',
      min: 0,
      max: 127,
      default: 96,
      help: 'peak-to-peak amplitude; 0 = no modulation (CC stays at center)',
    },
    { kind: 'int', key: 'led_bright', label: 'LED on', min: 0, max: 15, default: 12 },
    { kind: 'int', key: 'led_dim', label: 'LED off', min: 0, max: 15, default: 3 },
  ],
  build: (_mode, v): Behavior => ({
    kind: 'lfo',
    params: {
      channel: asInt(v.channel, 1),
      cc: asInt(v.cc, 50),
      waveform: asWaveform(v.waveform),
      period_seconds: asInt(v.period_centiseconds, 100) / 100,
      center: asInt(v.center, 64),
      depth: asInt(v.depth, 96),
      led_bright: asInt(v.led_bright, 12),
      led_dim: asInt(v.led_dim, 3),
    },
  }),
};

// ---------- Page select (global) ----------

const pageSelect: RecipeMeta = {
  id: 'page_select',
  label: 'Page select',
  description: 'cells that switch the active page (global — visible on every page)',
  modes: [{ id: 'group', label: 'group' }],
  defaultValues: {
    led_active: 12,
    led_inactive: 4,
    led_unused: 1,
  },
  paramsFor: () => [
    { kind: 'int', key: 'led_active', label: 'LED active', min: 0, max: 15, default: 12 },
    { kind: 'int', key: 'led_inactive', label: 'LED inactive', min: 0, max: 15, default: 4 },
    { kind: 'int', key: 'led_unused', label: 'LED unused', min: 0, max: 15, default: 1 },
  ],
  build: (_mode, v): Behavior => ({
    kind: 'page_select',
    params: {
      led_active: asInt(v.led_active, 12),
      led_inactive: asInt(v.led_inactive, 4),
      led_unused: asInt(v.led_unused, 1),
    },
  }),
};

// ---------- Wake sequencer ----------

const wakeSequencer: RecipeMeta = {
  id: 'wake_sequencer',
  label: 'Wake sequencer',
  description: 'per-step parameters across paged "tracks"',
  modes: [{ id: 'group', label: 'group' }],
  defaultValues: {
    channel: 1,
    root_note: 60,
    scale: 'major',
    bpm: 120,
    steps_per_beat: 4,
  },
  // Selection must be a filled rectangle of at least 6 cols (room
  // for the 6 page selectors in the function row — PITCH, OCT, VEL,
  // DURATION, LENGTH, CLK) and 2 rows (1 fn row + at least 1 body
  // row). The CLK page is most useful with bodyHeight ≥ 3 (so it
  // can fit scale picker + run/stop + a BPM meter row), but we
  // don't enforce that — smaller selections silently lose the
  // unreachable controls.
  shape: { minCols: 6, minRows: 2, rectangleRequired: true },
  paramsFor: () => [
    { kind: 'int', key: 'channel', label: 'Channel', min: 1, max: 16, default: 1 },
    {
      kind: 'int',
      key: 'root_note',
      label: 'Root note',
      min: 0,
      max: 127,
      default: 60,
      help: 'MIDI note for scale-degree 0 in octave 0',
    },
    {
      kind: 'enum',
      key: 'scale',
      label: 'Scale',
      options: SCALE_OPTIONS,
      default: 'major',
    },
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
  ],
  build: (_mode, v): Behavior => ({
    kind: 'wake_sequencer',
    params: {
      channel: asInt(v.channel, 1),
      root_note: asInt(v.root_note, 60),
      scale: asScale(v.scale),
      bpm: asInt(v.bpm, 120),
      steps_per_beat: asInt(v.steps_per_beat, 4),
    },
  }),
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
  wake_sequencer: wakeSequencer,
  lfo,
  page_select: pageSelect,
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
  'lfo',
  'note_keyboard',
  'step_sequencer',
  'wake_sequencer',
  'page_select',
];
