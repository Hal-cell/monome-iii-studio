import { For, Show, type JSX, createSignal } from 'solid-js';
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
import {
  type SavedRegion,
  addRegion,
  findRegionForCell,
  layoutName,
  regionColor,
  regions,
  removeRegion,
  renameRegion,
  setLayoutName,
  totalRegionCells,
} from '../store/regions.ts';
import {
  COLS,
  ROWS,
  cellKey,
  clearSelection,
  keyToCell,
  selection,
} from '../store/selection.ts';
import {
  loadLayout,
  newLayout,
  snapshotLayout,
} from '../store/session.ts';
import { exportLayout, importLayoutFile } from '../lib/persist.ts';
import { ParamEditor } from './ParamEditor.tsx';
import { RecipeSelector } from './RecipeSelector.tsx';

export function BehaviorPanel() {
  const [notice, setNotice] = createSignal<string | null>(null);

  const recipe = () => {
    const k = recipeKind();
    return k ? RECIPES[k] : null;
  };
  const selectionSize = () => selection().size;
  const selectionGeometry = () => {
    let numRows = 0;
    let numCols = 0;
    if (selection().size > 0) {
      const ys = new Set<number>();
      const xs = new Set<number>();
      for (const k of selection()) {
        const c = keyToCell(k);
        ys.add(c.y);
        xs.add(c.x);
      }
      numRows = ys.size;
      numCols = xs.size;
    }
    return { selectionSize: selection().size, numRows, numCols };
  };
  const schema = () => {
    const r = recipe();
    if (!r) return [];
    return r.paramsFor(values, selectionGeometry());
  };
  const canAdd = () => selectionSize() > 0 && recipe() !== null;
  const canDownload = () => regions().length > 0;
  const downloadName = () => (layoutName().trim() || 'untitled');

  function onAddRegion() {
    if (!canAdd()) return;
    const r = recipe()!;

    // Auto-exclude cells that are already in another saved region.
    const fresh: string[] = [];
    let claimed = 0;
    for (const k of selection()) {
      const c = keyToCell(k);
      if (findRegionForCell(c.x, c.y)) {
        claimed += 1;
      } else {
        fresh.push(k);
      }
    }

    if (fresh.length === 0) {
      setNotice(
        `all ${claimed} cell${claimed === 1 ? '' : 's'} already in another region; nothing added`,
      );
      return;
    }

    const region = addRegion({
      cellKeys: new Set(fresh),
      mode: mode(),
      recipeKind: r.id,
      values: { ...values }, // snapshot
    });

    if (claimed > 0) {
      setNotice(
        `added ${region.name} (${fresh.length} cells); ${claimed} skipped (already claimed)`,
      );
    } else {
      setNotice(`added ${region.name} (${fresh.length} cells)`);
    }
    clearSelection();
  }

  function onDownload() {
    if (!canDownload()) return;
    const regionList: Region[] = regions().map((r) => {
      const cells = Array.from(r.cellKeys)
        .map(keyToCell)
        .sort((a, b) => a.y - b.y || a.x - b.x);
      const meta = RECIPES[r.recipeKind];
      return {
        id: r.id,
        name: r.name,
        cells,
        mode: r.mode,
        behavior: meta.build(r.mode, r.values),
      };
    });
    const layout: GridLayout = {
      version: 1,
      tool_version: '0.0.0',
      name: downloadName(),
      width: COLS,
      height: ROWS,
      active_page_index: 0,
      pages: [{ id: 'p1', name: 'main', regions: regionList }],
    };
    downloadText(`${downloadName()}.lua`, emit(layout));
  }

  let fileInputRef: HTMLInputElement | undefined;

  const hasContent = () => regions().length > 0 || selectionSize() > 0;

  function onExport() {
    if (regions().length === 0) {
      setNotice('nothing to export — add a region first');
      return;
    }
    exportLayout(snapshotLayout());
    setNotice(`exported ${layoutName() || 'untitled'}.layout.json`);
  }

  function onImportClick() {
    if (
      hasContent() &&
      !confirm('Import will replace your current layout. Continue?')
    ) {
      return;
    }
    fileInputRef?.click();
  }

  async function onFileChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const layout = await importLayoutFile(file);
      loadLayout(layout);
      setNotice(
        `imported ${layout.layoutName || 'untitled'} (${layout.regions.length} regions)`,
      );
    } catch (err) {
      setNotice(`import failed: ${(err as Error).message}`);
    }
  }

  function onNew() {
    if (hasContent() && !confirm('Discard the current layout?')) return;
    newLayout();
    setNotice('new layout');
  }

  return (
    <div class="flex flex-col gap-6 h-full">
      <Section title="Layout">
        <div class="space-y-2">
          <input
            type="text"
            value={layoutName()}
            onInput={(e) => setLayoutName(e.currentTarget.value)}
            placeholder="untitled"
            class="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-200 font-mono focus:outline-none focus:border-neutral-600"
          />
          <div class="flex gap-1">
            <SmallButton onClick={onImportClick}>Import</SmallButton>
            <SmallButton onClick={onExport} disabled={regions().length === 0}>
              Export
            </SmallButton>
            <SmallButton onClick={onNew} disabled={!hasContent()}>
              New
            </SmallButton>
          </div>
          <input
            ref={(el) => (fileInputRef = el)}
            type="file"
            accept=".json,application/json"
            onChange={onFileChosen}
            style={{ display: 'none' }}
          />
        </div>
      </Section>

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

      <div class="space-y-2">
        <button
          type="button"
          onClick={onAddRegion}
          disabled={!canAdd()}
          class={`w-full py-2 text-xs rounded border font-mono tracking-wider ${
            canAdd()
              ? 'border-neutral-600 bg-neutral-900 text-neutral-200 hover:bg-neutral-800'
              : 'border-neutral-900 text-neutral-700 cursor-not-allowed'
          }`}
        >
          + Add Region
        </button>
        <Show when={notice()}>
          <p class="text-[10px] text-neutral-500 italic leading-relaxed">
            {notice()}
          </p>
        </Show>
      </div>

      <Show when={regions().length > 0}>
        <Section title="Regions">
          <div class="space-y-1">
            <For each={regions()}>{(r) => <RegionRow region={r} />}</For>
          </div>
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
          {regions().length === 0
            ? 'add a region to enable download'
            : `${downloadName()}.lua · ${regions().length} region${
                regions().length === 1 ? '' : 's'
              } · ${totalRegionCells()} cells`}
        </p>
      </div>
    </div>
  );
}

function RegionRow(props: { region: SavedRegion }) {
  const [editing, setEditing] = createSignal(false);
  const [draftName, setDraftName] = createSignal(props.region.name);

  function commitName() {
    const next = draftName().trim();
    if (next && next !== props.region.name) {
      renameRegion(props.region.id, next);
    } else {
      setDraftName(props.region.name);
    }
    setEditing(false);
  }

  return (
    <div class="flex items-center gap-2 px-2 py-1.5 bg-neutral-900/50 rounded border border-transparent hover:border-neutral-800">
      <span
        class="w-3 h-3 rounded-sm flex-shrink-0"
        style={{ 'background-color': regionColor(props.region) }}
      />
      <Show
        when={editing()}
        fallback={
          <button
            type="button"
            onClick={() => {
              setDraftName(props.region.name);
              setEditing(true);
            }}
            class="flex-1 text-left text-xs text-neutral-200 font-mono truncate hover:text-neutral-50"
            title="click to rename"
          >
            {props.region.name}
          </button>
        }
      >
        <input
          type="text"
          value={draftName()}
          onInput={(e) => setDraftName(e.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraftName(props.region.name);
              setEditing(false);
            }
          }}
          ref={(el) => setTimeout(() => el?.focus(), 0)}
          class="flex-1 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-xs text-neutral-200 font-mono focus:outline-none"
        />
      </Show>
      <span class="text-[10px] text-neutral-600 font-mono whitespace-nowrap">
        {RECIPES[props.region.recipeKind].label.toLowerCase()} · {props.region.cellKeys.size}
      </span>
      <button
        type="button"
        onClick={() => removeRegion(props.region.id)}
        class="text-neutral-700 hover:text-neutral-300 text-base leading-none px-1"
        title="delete region"
      >
        ×
      </button>
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

function SmallButton(props: {
  children: JSX.Element;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class={`flex-1 px-2 py-1 text-[10px] uppercase tracking-wider rounded border ${
        props.disabled
          ? 'border-neutral-900 text-neutral-700 cursor-not-allowed'
          : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
      }`}
    >
      {props.children}
    </button>
  );
}
