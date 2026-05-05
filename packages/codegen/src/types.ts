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

// ---------- Pending recipes (Steps 5+) ----------

export type PendingBehavior = {
  kind: 'range' | 'meter' | 'note_keyboard' | 'step_sequencer';
  params: unknown;
};

export type Behavior =
  | MomentaryBehavior
  | ToggleBehavior
  | RadioBehavior
  | PendingBehavior;

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
