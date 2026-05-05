import { createEffect, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { RegionMode } from '@monome-iii-studio/codegen';
import type { BehaviorKind } from '../recipes/types.ts';
import { RECIPES } from '../recipes/schemas.ts';

export const [recipeKind, setRecipeKind] = createSignal<BehaviorKind | null>(
  null,
);
export const [mode, setMode] = createSignal<RegionMode>('per_cell');

// Form values for the current recipe. Solid `createStore` gives
// fine-grained reactivity per key, so the ParamEditor only re-renders
// the input that changed.
export const [values, setValues] = createStore<Record<string, unknown>>({});

// When the user picks a different recipe, replace values with that
// recipe's defaults and clamp the mode to one the recipe supports.
createEffect(() => {
  const k = recipeKind();
  if (!k) return;
  const recipe = RECIPES[k];
  setValues(reconcile(recipe.defaultValues));
  if (!recipe.modes.some((m) => m.id === mode())) {
    setMode(recipe.modes[0]!.id);
  }
});
