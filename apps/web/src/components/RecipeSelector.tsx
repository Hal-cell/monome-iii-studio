import { For } from 'solid-js';
import { RECIPES, RECIPE_ORDER } from '../recipes/schemas.ts';
import type { BehaviorKind } from '../recipes/types.ts';

type Props = {
  value: BehaviorKind | null;
  onChange: (k: BehaviorKind) => void;
};

export function RecipeSelector(props: Props) {
  return (
    <div class="space-y-1">
      <For each={RECIPE_ORDER}>
        {(kind) => {
          const recipe = RECIPES[kind];
          const active = () => props.value === kind;
          return (
            <button
              type="button"
              onClick={() => props.onChange(kind)}
              class={`w-full text-left px-3 py-2 rounded border transition-colors ${
                active()
                  ? 'border-neutral-500 bg-neutral-800/50'
                  : 'border-neutral-900 hover:border-neutral-700 bg-transparent'
              }`}
            >
              <div
                class={`text-sm ${
                  active() ? 'text-neutral-100' : 'text-neutral-300'
                }`}
              >
                {recipe.label}
              </div>
              <div class="text-[10px] text-neutral-600 mt-0.5">
                {recipe.description}
              </div>
            </button>
          );
        }}
      </For>
    </div>
  );
}
