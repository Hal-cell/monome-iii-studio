/**
 * Schema for recipe parameter forms. The UI renders a form from the
 * schema; the recipe's `build` function converts form values back into
 * a typed `Behavior` for the codegen.
 *
 * Two layers per recipe:
 *   - schema (paramsFor) — describes which fields to render right now
 *     (may branch on current values, e.g. note vs CC)
 *   - builder (build)    — assembles a typed Behavior from the values
 */

import type { Behavior, RegionMode } from '@monome-iii-studio/codegen';

export type BehaviorKind = Behavior['kind'];

// ---------- Param schemas ----------

export type IntParamSchema = {
  kind: 'int';
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  help?: string;
};

export type EnumParamSchema = {
  kind: 'enum';
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  default: string;
};

/**
 * A horizontal row of bounded ints. Length is resolved at paramsFor()
 * time (not part of the static schema) — recipes that want one entry
 * per row in the user's selection compute `length: ctx.numRows` there.
 *
 * Storage in the values store is a plain `number[]`. ParamEditor builds
 * a fresh array on every edit so unset slots fill with `default`.
 */
export type IntArrayParamSchema = {
  kind: 'int_array';
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  length: number;
  help?: string;
};

export type ParamSchema =
  | IntParamSchema
  | EnumParamSchema
  | IntArrayParamSchema;

// ---------- Recipe meta ----------

/**
 * Geometry the user's selection must satisfy before the recipe can be
 * applied. Optional — recipes that work on any non-empty selection
 * (most of them) leave this off.
 *
 * `rectangleRequired` means: the selection's bounding box must be
 * fully filled (every cell in the rectangle is selected). This matters
 * for recipes like wake_sequencer that index into (col, row) within
 * a fixed grid.
 */
export type ShapeConstraint = {
  minCols?: number;
  minRows?: number;
  rectangleRequired?: boolean;
};

export type RecipeMeta = {
  id: BehaviorKind;
  label: string;
  description: string;
  modes: ReadonlyArray<{ id: RegionMode; label: string }>;
  /** Defaults for every param key the recipe might use. */
  defaultValues: Record<string, unknown>;
  paramsFor: (
    values: Record<string, unknown>,
    ctx: ParamContext,
  ) => ParamSchema[];
  build: (mode: RegionMode, values: Record<string, unknown>) => Behavior;
  /**
   * Optional selection-shape requirements. The UI checks this before
   * letting the user click "Add Region" and surfaces an explanatory
   * notice if the selection doesn't fit.
   */
  shape?: ShapeConstraint;
};

export type ParamContext = {
  selectionSize: number;
  /** Number of distinct y values in the current selection. */
  numRows: number;
  /** Number of distinct x values in the current selection. */
  numCols: number;
};

// ---------- Helpers for builders ----------

export function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
