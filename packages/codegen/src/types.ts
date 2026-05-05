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

// ---------- Note keyboard ----------

/**
 * Isomorphic MIDI keyboard with configurable row/column intervals.
 * per_cell-only.
 *
 * Note formula for a cell at selection-relative position (rx, ry)
 * where (0, 0) is the top-left of the bounding box:
 *
 *   note = root_note
 *        + (height - 1 - ry) * row_interval   -- bottom row plays lowest
 *        + rx * column_interval
 *
 * Defaults match monome's traditional fourths-tuning layout:
 * row_interval=5 (perfect fourth), column_interval=1 (chromatic).
 *
 * Out-of-range behavior: cells whose computed note falls outside
 * [0, 127] are silently dropped — no _<region>_note entry, no LED
 * draw, no _route entry. The cell appears unlit and unresponsive on
 * the Grid. (Decision B+B1 from the Step 7 design discussion.)
 */
export type NoteKeyboardParams = {
  channel: number;
  /** MIDI note for the bottom-left cell of the selection. */
  root_note: number;
  /** Semitones between adjacent cells within a row. Default 1 (chromatic). */
  column_interval: number;
  /** Semitones offset between adjacent rows. Default 5 (perfect 4th). */
  row_interval: number;
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
  /** Subdivision: 4 = sixteenth notes at the given BPM. */
  steps_per_beat: number;
  direction: StepSequencerDirection;
  /**
   * Note hold length in step-ticks. 1 = blip (note-off on next step,
   * matches the gate-style behaviour we used to have). Higher values
   * sustain notes across multiple steps. If a row's next "on" step
   * arrives before the gate expires, the note retriggers (off + on).
   */
  gate_length: number;
  led_current_on: number;
  led_current_off: number;
  led_not_current_on: number;
  led_not_current_off: number;
};

export type StepSequencerNoteParams = StepSequencerCommonParams & {
  output_mode: 'note_per_row';
  /** Top row plays this note. Row R plays `base_note + R`. */
  base_note: number;
  velocity: number;
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
  | StepSequencerBehavior;

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
