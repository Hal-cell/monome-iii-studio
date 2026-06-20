/**
 * Type definitions for the GridLayout configuration that the emitter consumes.
 *
 * Driven by the design in the vault:
 *   ~/Documents/TestVault/10-projects/monome-iii-studio/spec/v0-design.md
 *
 * Step 2: only the `momentary` behavior is fully typed. The other six recipe
 * kinds are declared as `PendingBehavior` placeholders so the data model is
 * complete from a routing perspective, while emit() throws if it actually
 * encounters one of them. Each subsequent step replaces one slot in
 * PendingBehavior's union with a fully-typed behavior.
 */

export type Cell = { x: number; y: number };

export type RegionMode = 'per_cell' | 'group';

// ---------- Momentary ----------

export type MomentaryNoteParams = {
  output_type: 'note';
  channel: number;
  /**
   * In `per_cell` mode this is the BASE note (sent: `note + cell_index`).
   * In `group` mode this is the SHARED note (sent: `note`).
   */
  note: number;
  velocity: number;
  led_held: number;
  led_idle: number;
};

export type MomentaryCCParams = {
  output_type: 'cc';
  channel: number;
  /**
   * In `per_cell` mode this is the BASE CC (sent: `cc + cell_index`).
   * In `group` mode this is the SHARED CC (sent: `cc`).
   */
  cc: number;
  led_held: number;
  led_idle: number;
};

export type MomentaryParams = MomentaryNoteParams | MomentaryCCParams;

export type MomentaryBehavior = {
  kind: 'momentary';
  params: MomentaryParams;
};

// ---------- Toggle ----------

/**
 * Step 3 ships toggle with CC output only. Note output is a Phase 2
 * stretch (toggling notes requires careful note-off bookkeeping that
 * goes beyond the toggle primitive). Long-press alt-display variant
 * also deferred to Phase 2 (needs hardware metro behavior verified).
 */
export type ToggleParams = {
  channel: number;
  /**
   * In `per_cell` mode this is the BASE CC (sent: `cc + cell_index`).
   * In `group` mode this is the SHARED CC (sent: `cc`).
   */
  cc: number;
  /** Value sent when toggled ON. Default 127. */
  on_value: number;
  /** Value sent when toggled OFF. Default 0. */
  off_value: number;
  led_on: number;
  led_off: number;
};

export type ToggleBehavior = {
  kind: 'toggle';
  params: ToggleParams;
};

// ---------- Radio (Switches) ----------

/**
 * Mutually-exclusive single-selection across N cells. Group-only.
 *
 * CC value mapping: the selected cell's selection-local index (0..N-1)
 * is mapped uniformly to the MIDI CC range 0..127 via
 * `floor(idx * 127 / (N-1))`. This deviates intentionally from the
 * grid-recipes "Switches" pattern (which sends raw idx) — see Step 4
 * commit message for rationale.
 *
 * Note output is a Phase 2 stretch (requires note-off bookkeeping for
 * the previously-selected cell).
 */
export type RadioParams = {
  channel: number;
  cc: number;
  /** Selection index that is active at script boot. 0..N-1. Default 0. */
  initial_index: number;
  led_on: number;
  led_off: number;
};

export type RadioBehavior = {
  kind: 'radio';
  params: RadioParams;
};

// ---------- Range ----------

/**
 * Two-point selection on a single row. Group-only.
 *
 * Press cells to define a range; releases never alter lo/hi (decision
 * (a) — "maintain on release"). New press after all-released starts a
 * fresh range from the new cell. Multi-cell holds extend the range.
 *
 * Sends two CCs (cc_low, cc_high) with values mapped uniformly to
 * 0..127 across the selection's width — same mapping as Radio. No CC
 * is sent until the user makes a first press (LED stays in the
 * `led_out_range` state until then).
 */
export type RangeParams = {
  channel: number;
  cc_low: number;
  cc_high: number;
  led_in_range: number;
  led_out_range: number;
};

export type RangeBehavior = {
  kind: 'range';
  params: RangeParams;
};

// ---------- Meter ----------

/**
 * Multi-column visual fader. Group-only.
 *
 * Selection must be a rectangular block: N contiguous columns × full
 * column height (the full vertical span of the selection). Each column
 * is an independent fader with its own height (0..H) and its own CC.
 *
 * Press cell (col, y) → that column's height becomes
 * `selection_height - (y - selection_y_top)`. Top row press = full
 * height; bottom row press = height 1. There is no way to set
 * height to 0 after first interaction (matches grid-recipes
 * "Meters" — minimum height after press is 1). Initial height is 0
 * (no LED lit, no CC sent).
 *
 * Each column sends a CC: `cc = base_cc + col_offset`, value mapped
 * uniformly: `floor(height * 127 / max_height)`. height=H → 127.
 */
export type MeterParams = {
  channel: number;
  base_cc: number;
  led_on: number;
  led_off: number;
};

export type MeterBehavior = {
  kind: 'meter';
  params: MeterParams;
};

// Re-export ScaleName for consumers using only the package types.
export type { ScaleName } from './scales.ts';

// ---------- Note keyboard ----------

/**
 * Isomorphic MIDI keyboard with configurable row/column intervals.
 * per_cell-only.
 *
 * Note formula for a cell at selection-relative position (rx, ry)
 * where (0, 0) is the top-left of the bounding box. Intervals are
 * ALWAYS counted in semitones (chromatic):
 *
 *   note = root_note
 *        + (height - 1 - ry) * row_interval   -- bottom row plays lowest
 *        + rx * column_interval
 *
 * Defaults match monome's traditional fourths-tuning layout:
 * row_interval=5 semitones (perfect fourth), column_interval=1
 * (semitone). The `scale` param does NOT change the note layout —
 * it only colours the LEDs (root / in-scale / off-scale tiers) so
 * the player can see which cells fall inside their target key.
 * This matches monome's reference scripts (e.g. `intervals`).
 *
 * Out-of-range behavior: cells whose computed note falls outside
 * [0, 127] are silently dropped — no _<region>_note entry, no LED
 * draw, no _route entry. The cell appears unlit and unresponsive on
 * the Grid.
 */
export type NoteKeyboardParams = {
  channel: number;
  /** MIDI note for the bottom-left cell of the selection. */
  root_note: number;
  /** Semitones per cell along the horizontal axis. Default 1. */
  column_interval: number;
  /**
   * Semitones per cell along the vertical axis. Default 5 (perfect
   * fourth — monome's traditional fourths-tuning layout).
   */
  row_interval: number;
  /**
   * Scale used purely for visual highlighting (and harmony-coach
   * chord computation). The keyboard layout is always chromatic;
   * this field decides which cells light at `led_idle` (in-scale)
   * vs `led_offscale` (out-of-scale). 'chromatic' disables the
   * highlight — every non-root cell shows at `led_idle`.
   */
  scale: import('./scales.ts').ScaleName;
  velocity: number;
  led_held: number;
  led_idle: number;
  /**
   * Brightness for cells whose note shares the root's pitch class
   * (i.e. note ≡ root_note mod 12). These are the "octave markers"
   * that let the player navigate by sight. Default 6 (between idle
   * and held). Set equal to `led_idle` to disable highlighting.
   */
  led_octave: number;
  /**
   * Brightness for cells whose pitch class is OUT of `scale`.
   * Default 0 (off — matches the monome `intervals` script's
   * convention of hiding non-scale notes entirely). Has no effect
   * when `scale` is 'chromatic' (every PC is "in scale").
   */
  led_offscale: number;
  /**
   * Harmony coach mode: when on, cells whose pitch class is in the
   * currently-suggested diatonic chord blink between two brightness
   * levels. Each note-on press walks one step along a chord
   * progression graph (I → ii / iii / IV / V / vi / vii° etc.,
   * resolving back through dominant / subdominant families). Helps
   * the player practise harmonic motion in their chosen key.
   *
   * Silently no-op when the active scale is 'chromatic' — diatonic
   * harmony doesn't apply to a 12-note set. Default off so existing
   * layouts keep their pre-coach behaviour.
   */
  harmony_coach: boolean;
  /**
   * Live scale selector — reserves the rightmost column of the
   * keyboard region as scale-picker cells (one cell per scale,
   * top-to-bottom in SCALE_NAMES order). Pressing a cell switches
   * the active scale at runtime, which retunes the LED highlight
   * AND the harmony-coach chord generator. Panel's `scale` becomes
   * the INITIAL value.
   *
   * When off (default), the rightmost column is just more keyboard
   * keys and `scale` is fixed at codegen time.
   *
   * Each picker cell maps to SCALE_NAMES[i] for i in 0..(min(rows,
   * SCALE_NAMES.length)-1) — shorter selections only reach the
   * first N scales.
   */
  live_scale_select: boolean;
};

export type NoteKeyboardBehavior = {
  kind: 'note_keyboard';
  params: NoteKeyboardParams;
};

// ---------- Step sequencer ----------

/**
 * Step sequencer. Group-only. Selection must be a rectangular block:
 * N rows × M columns, where each row is an independent track (sharing
 * the same playhead) and each column is a step.
 *
 * Output:
 *   - `note_per_row`: row R fires note `base_note + R`. Top row = R 0
 *     = base_note. Velocity is the configured `velocity` param.
 *   - `cc_per_row`: row R sends CC `base_cc + R`. Step "on" sends
 *     `on_value`; step "off" (when leaving an on cell) sends
 *     `off_value`.
 *
 * Timing: a metro fires every `60/bpm/steps_per_beat` seconds. Each
 * tick advances the playhead one column (wrapping at the end). At the
 * tick:
 *   1. Send "off" messages for any tracks whose previous step was on
 *      (gate-style note-off / CC release).
 *   2. Advance playhead.
 *   3. Send "on" messages for any tracks whose new step is on.
 *
 * Initial state: all cells off, playhead at -1 (first tick lands on 0).
 *
 * LED: four-level brightness enum
 *   - led_current_on    : on-cell at the playhead
 *   - led_current_off   : off-cell at the playhead (playhead indicator)
 *   - led_not_current_on : on-cell not at the playhead (armed)
 *   - led_not_current_off: off-cell not at the playhead (idle)
 *
 * Hardware: each region uses 1 of iii's 15 available metros.
 */
/** Playhead traversal mode. */
export type StepSequencerDirection = 'forward' | 'reverse' | 'pingpong';

export type StepSequencerCommonParams = {
  channel: number;
  bpm: number;
  /**
   * Subdivision: 4 = sixteenth notes at the given BPM. With per-row
   * divs (see below) this is the MASTER tick rate; effective row step
   * rate = master_rate × divs[row].
   */
  steps_per_beat: number;
  direction: StepSequencerDirection;
  /**
   * Note hold length in master ticks. 1 = blip (note-off on next
   * master tick that this row hits — matches the gate-style behaviour
   * we used to have). Higher values sustain across multiple steps. If
   * a row's next "on" step arrives before the gate expires, the note
   * retriggers (off + on).
   */
  gate_length: number;
  /**
   * Swing 0..75 (percent). 0 = straight time. Positive values
   * lengthen even-indexed steps (0, 2, 4, ...) and shorten odd ones
   * by the same amount, giving a shuffle / dotted-feel. 50 ≈ heavy
   * 3:1 swing; 33 ≈ triplet feel. Average tempo is preserved.
   *
   * When > 0 the emitter runs the metro at 4× the master rate and
   * scales divs / gate_length accordingly so swing has resolution
   * even at the default divs=1. swing=0 emits the same code as
   * before. Odd-numbered loop lengths desync at the wrap.
   */
  swing: number;
  /**
   * Per-row clock division. Length = number of rows in the selection.
   * Each entry is an integer ≥ 1 — how many master ticks elapse
   * between this row's step advances. Default [1, 1, ...] gives
   * synchronous play (matches the old single-rate behaviour).
   *
   * Different values across rows give polyrhythm — wake's defining
   * musical feature. e.g. divs=[1, 2, 3, 4] across 4 rows: row 0 hits
   * every master tick, row 1 every other, row 2 triplet-y, row 3
   * quarter-note-y.
   *
   * Master tick rate = 60 / bpm / steps_per_beat. The emitter pads
   * shorter arrays with 1 and truncates longer ones to numRows.
   */
  divs: number[];
  led_current_on: number;
  led_current_off: number;
  led_not_current_on: number;
  led_not_current_off: number;
};

export type StepSequencerNoteParams = StepSequencerCommonParams & {
  output_mode: 'note_per_row';
  /**
   * BOTTOM row plays this note (matches piano-laid-flat convention:
   * up = higher pitch). Row indices walk UP the scale toward the top.
   */
  base_note: number;
  velocity: number;
  /**
   * Scale used to map row indices to MIDI notes. `chromatic` (default)
   * gives the simple `base_note + (numRows-1-r)` mapping (one
   * semitone per row). Any other scale walks scale degrees instead,
   * so every row lands on a scale tone.
   */
  scale: import('./scales.ts').ScaleName;
  /**
   * Polyphony mode. `false` (default): each row's note plays
   * independently — overlapping rows make chords. `true`: only one
   * voice sounds at a time; whichever row fires last steals the
   * voice (sends note-off for the previous row's note before
   * note-on for the new one). Same-row consecutive hits retrigger
   * regardless of mode.
   *
   * No effect in `cc_per_row` mode (CCs aren't pitched and can run
   * in parallel without "voice-stealing").
   */
  mono: boolean;
};

export type StepSequencerCCParams = StepSequencerCommonParams & {
  output_mode: 'cc_per_row';
  /** Top row sends this CC. Row R sends CC `base_cc + R`. */
  base_cc: number;
  on_value: number;
  off_value: number;
};

export type StepSequencerParams =
  | StepSequencerNoteParams
  | StepSequencerCCParams;

export type StepSequencerBehavior = {
  kind: 'step_sequencer';
  params: StepSequencerParams;
};

// ---------- LFO ----------

/**
 * Low-frequency oscillator. Group-only. Selection cells are passive
 * meter-style indicators of the current LFO output (no press
 * handlers); the LFO continuously runs at `period_seconds` and
 * outputs a CC scaled around `center` with peak-to-peak amplitude
 * `depth`. Output is clamped to [0, 127].
 *
 * Useful for live performance — assign the CC to a synth parameter
 * (filter cutoff, etc.) and watch the visualisation as the value
 * sweeps. Multiple LFO regions can run simultaneously on different
 * CCs / channels.
 */
export type LfoWaveform = 'sine' | 'triangle' | 'saw' | 'square';

export type LfoParams = {
  channel: number;
  cc: number;
  waveform: LfoWaveform;
  /** Cycle length in seconds. 0.1 (10 Hz) up to 30 s. */
  period_seconds: number;
  /** Midpoint of the output range, 0..127. Default 64. */
  center: number;
  /**
   * Peak-to-peak depth in MIDI CC units. Output ranges over
   * [center - depth/2, center + depth/2], clamped to [0, 127].
   * 0 = no modulation (CC stays at center).
   */
  depth: number;
  /** Brightness for cells inside the current fill level. */
  led_bright: number;
  /** Brightness for cells outside the current fill level. */
  led_dim: number;
};

export type LfoBehavior = {
  kind: 'lfo';
  params: LfoParams;
};

// ---------- Page select ----------

/**
 * Global page-switching cells. Group-only, lives OUTSIDE the per-page
 * region grouping — these cells are rendered and dispatched on every
 * page so the user can always switch back. The cells map to page
 * indices in their natural sort order: cell 0 → page 0, cell 1 →
 * page 1, etc. Cells with no matching page (i.e. index ≥
 * layout.pages.length) are dimmed and inert.
 *
 * On press: state.page is set to the cell's target index, the LED
 * delta cache is cleared, the grid is blanked, and redraw() runs the
 * new page's draw block.
 */
export type PageSelectParams = {
  /** Brightness for the cell of the currently-active page. */
  led_active: number;
  /** Brightness for cells of inactive (but valid) pages. */
  led_inactive: number;
  /** Brightness for cells past the end of the page list. */
  led_unused: number;
};

export type PageSelectBehavior = {
  kind: 'page_select';
  params: PageSelectParams;
};

// ---------- Wake sequencer ----------

/**
 * wake-style step sequencer: one note per column, monophonic by
 * design, with per-step parameters edited via a top-row "page" strip.
 *
 * Selection layout:
 *   - top row of selection = function row (page selectors + dim
 *     unused cells)
 *   - remaining `numRows - 1` rows = "body": each column shows the
 *     current page's value as one lit cell. Top body row = max value;
 *     bottom body row = value 1; no cell lit = value 0 (silent step
 *     when on the PITCH page).
 *
 * Pages (v1):
 *   0 PITCH  scale degree (0 = silent step, 1..body_height = degree).
 *           Default 0 — the user opts steps in.
 *   1 OCT    octave shift, centred on the middle body row. Value V
 *           (1..body_height) maps to shift `V - centre` where
 *           centre = floor(body_height/2) + 1, so the default cell is
 *           "no shift" and pressing higher / lower cells transposes up
 *           or down. This page never toggles off — there is always
 *           exactly one cell lit per column.
 *   2 VEL    velocity bucket (0 = silent step, 1..body_height = 1..127
 *           linearly). Default = body_height (max), so steps fire as
 *           soon as PITCH is set without the user having to touch this
 *           page first.
 *   3 DURATION
 *           note length, linear in seconds across [0.5 s, 3 s].
 *           V=1 = 0.5 s, V=body_height = 3 s, intermediate values
 *           interpolate evenly. V=0 = silent step.
 *           Default = body_height (longest). Voice-stealing in dense
 *           mono sequences will clamp longer values to the next-firing
 *           time — that's a property of monophonic playback, not of
 *           the curve.
 *   4 LENGTH active step count. Pressing any body cell of column c
 *           sets the loop length to c+1 (1..numCols). Display is a
 *           whole-column highlight: cols < length are fully lit, cols
 *           ≥ length are dark. Programmed notes in cols ≥ length are
 *           shown dimmed on the value pages so the user can see which
 *           steps are silenced. Default = numCols (all steps play).
 *           The playhead wraps at length, not numCols.
 *   5 CLK   live-control panel for global script state. Body layout:
 *             rr=1: scale picker — 8 cells (chromatic / major /
 *                   minor / dorian / phrygian / lydian / mixolydian /
 *                   locrian). Active scale at LED_VALUE, others at
 *                   LED_VALUE_INACTIVE. Switches scale live by
 *                   indexing into a precomputed 2D scale table.
 *             rr=2: run/stop — col 0 = stop, col 1 = run. Stopping
 *                   kills any held note and freezes the playhead;
 *                   running resumes from the current position.
 *             rr=3..bodyHeight: BPM meter, top-left = MIN_BPM,
 *                   bottom-right = MAX_BPM in row-major reading
 *                   order. Press to set state.bpm; the metro period
 *                   is recomputed and `_metro.time = X` propagates
 *                   the new period live (per iii's metro_set in C).
 *
 * Selection constraints (enforced by the UI, not the emitter):
 *   - rectangle
 *   - ≥ 6 cols (room for 6 page selectors in the function row)
 *   - ≥ 2 rows (1 function + ≥ 1 body); CLK page works best with
 *     bodyHeight ≥ 3 so the BPM meter has at least one row
 */
export type WakeSequencerParams = {
  channel: number;
  /** MIDI note for scale-degree 0 in octave 0. */
  root_note: number;
  /** Default 'major'. Determines pitch interpretation on the PITCH page. */
  scale: import('./scales.ts').ScaleName;
  bpm: number;
  /** Subdivision of the beat for the master clock tick. */
  steps_per_beat: number;
};

export type WakeSequencerBehavior = {
  kind: 'wake_sequencer';
  params: WakeSequencerParams;
};

// ---------- Behavior union ----------
//
// As of Step 8 the v0 catalogue is complete. There is no PendingBehavior
// fallback; emit.ts uses an exhaustive switch with a `never` check that
// will fail TypeScript compilation if a new behavior kind is introduced
// without a matching case.

export type Behavior =
  | MomentaryBehavior
  | ToggleBehavior
  | RadioBehavior
  | RangeBehavior
  | MeterBehavior
  | NoteKeyboardBehavior
  | StepSequencerBehavior
  | WakeSequencerBehavior
  | LfoBehavior
  | PageSelectBehavior;

// ---------- Region / Page / GridLayout ----------

export type Region = {
  id: string;
  name: string;
  cells: Cell[];
  mode: RegionMode;
  behavior: Behavior;
};

export type Page = {
  id: string;
  name: string;
  regions: Region[];
};

export type GridLayout = {
  version: 1;
  tool_version: string;
  name: string;
  width: 8 | 16;
  height: 8;
  active_page_index: number;
  pages: Page[];
};
