import { For, Show, type JSX } from 'solid-js';
import type { GridLayout, Region } from '@monome-iii-studio/codegen';
import { emit } from '@monome-iii-studio/codegen';
import { downloadText } from '../lib/download.ts';
import { RECIPES } from '../recipes/schemas.ts';
import {
  mode,
  recipeKind,
  setMode,
  setRecipeKind,
  setValues,
  values,
} from '../store/behavior.ts';
import { COLS, ROWS, keyToCell, selection } from '../store/selection.ts';
import { ParamEditor } from './ParamEditor.tsx';
import { RecipeSelector } from './RecipeSelector.tsx';

const LAYOUT_NAME = 'monome-iii';

export function BehaviorPanel() {
  const selectionSize = () => selection().size;
  const recipe = () => {
    const k = recipeKind();
    return k ? RECIPES[k] : null;
  };
  const schema = () => {
    const r = recipe();
    if (!r) return [];
    return r.paramsFor(values, { selectionSize: selectionSize() });
  };
  const canDownload = () => selectionSize() > 0 && recipe() !== null;

  function onDownload() {
    if (!canDownload()) return;
    const r = recipe()!;
    const cells = Array.from(selection())
      .map(keyToCell)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const region: Region = {
      id: 'r-1',
      name: 'region',
      cells,
      mode: mode(),
      behavior: r.build(mode(), values),
    };
    const layout: GridLayout = {
      version: 1,
      tool_version: '0.0.0',
      name: LAYOUT_NAME,
      width: COLS,
      height: ROWS,
      active_page_index: 0,
      pages: [{ id: 'p1', name: 'main', regions: [region] }],
    };
    const lua = emit(layout);
    downloadText(`${LAYOUT_NAME}.lua`, lua);
  }

  return (
    <div class="flex flex-col gap-6 h-full">
      <Section title="Behavior">
        <RecipeSelector value={recipeKind()} onChange={setRecipeKind} />
      </Section>

      <Show when={recipe() && recipe()!.modes.length > 1}>
        <Section title="Mode">
          <div class="flex gap-1">
            <For each={recipe()!.modes}>
              {(m) => {
                const active = () => mode() === m.id;
                return (
                  <button
                    type="button"
                    onClick={() => setMode(m.id)}
                    class={`flex-1 px-2 py-1 text-xs rounded border ${
                      active()
                        ? 'border-neutral-400 bg-neutral-800 text-neutral-100'
                        : 'border-neutral-800 bg-neutral-950 text-neutral-500 hover:text-neutral-300'
                    }`}
                  >
                    {m.label}
                  </button>
                );
              }}
            </For>
          </div>
        </Section>
      </Show>

      <Show when={recipe()}>
        <Section title="Parameters">
          <ParamEditor
            schema={schema()}
            values={values}
            onChange={(k, v) => setValues(k, v)}
          />
        </Section>
      </Show>

      <div class="mt-auto pt-4 border-t border-neutral-900 space-y-2">
        <button
          type="button"
          onClick={onDownload}
          disabled={!canDownload()}
          class={`w-full py-2 text-sm rounded border font-mono tracking-wider ${
            canDownload()
              ? 'border-amber-200/40 bg-amber-100/5 text-amber-100 hover:bg-amber-100/10'
              : 'border-neutral-900 text-neutral-700 cursor-not-allowed'
          }`}
        >
          Download .lua
        </button>
        <p class="text-[10px] text-neutral-600 text-center">
          {selectionSize() === 0
            ? 'select cells to begin'
            : !recipe()
            ? 'pick a behavior to continue'
            : `${LAYOUT_NAME}.lua · 1 region · ${selectionSize()} cells`}
        </p>
      </div>
    </div>
  );
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <div class="space-y-2">
      <h2 class="text-[10px] uppercase tracking-[0.2em] text-neutral-600">
        {props.title}
      </h2>
      {props.children}
    </div>
  );
}
