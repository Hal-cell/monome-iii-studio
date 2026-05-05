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

// ---------- Pending recipes (Steps 3+) ----------

export type PendingBehavior = {
  kind:
    | 'toggle'
    | 'radio'
    | 'range'
    | 'meter'
    | 'note_keyboard'
    | 'step_sequencer';
  params: unknown;
};

export type Behavior = MomentaryBehavior | PendingBehavior;

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
