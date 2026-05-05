/**
 * @monome-iii-studio/codegen
 *
 * Pure-TypeScript compiler from a `GridLayout` configuration object to an
 * iii Lua script.
 *
 * See the vault for design context:
 *   ~/Documents/TestVault/10-projects/monome-iii-studio/spec/v0-design.md
 *   ~/Documents/TestVault/10-projects/monome-iii-studio/docs-reference/grid-recipes-taxonomy.md
 */

export { emit } from './emit.ts';
export { VERSION } from './version.ts';
export type {
  Behavior,
  Cell,
  GridLayout,
  MomentaryBehavior,
  MomentaryCCParams,
  MomentaryNoteParams,
  MomentaryParams,
  Page,
  Region,
  RegionMode,
  MeterBehavior,
  MeterParams,
  NoteKeyboardBehavior,
  NoteKeyboardParams,
  RadioBehavior,
  RadioParams,
  RangeBehavior,
  RangeParams,
  StepSequencerBehavior,
  StepSequencerCCParams,
  StepSequencerNoteParams,
  StepSequencerParams,
  ToggleBehavior,
  ToggleParams,
} from './types.ts';
