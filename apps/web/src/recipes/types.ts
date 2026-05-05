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

export type ParamSchema = IntParamSchema | EnumParamSchema;

// ---------- Recipe meta ----------

export type RecipeMeta = {
  id: BehaviorKind;
  label: string;
  description: string;
  modes: ReadonlyArray<{ id: RegionMode; label: string }>;
  /** Defaults for every param key the recipe might use. */
  defaultValues: Record<string, unknown>;
  paramsFor: (
    values: Record<string, unknown>,
    ctx: { selectionSize: number },
  ) => ParamSchema[];
  build: (mode: RegionMode, values: Record<string, unknown>) => Behavior;
};

// ---------- Helpers for builders ----------

export function asInt(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
