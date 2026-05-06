import { For, Show, type JSX, createSignal } from 'solid-js';
import { unwrap } from 'solid-js/store';
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
  activePageIndex,
  addPage,
  addRegion,
  findRegionForCell,
  layoutName,
  pageNames,
  regionColor,
  regions,
  removePage,
  removeRegion,
  renamePage,
  renameRegion,
  setActivePageIndex,
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
  applyLayoutSnapshot,
  loadLayout,
  newLayout,
  snapshotLayout,
} from '../store/session.ts';
import {
  canRedo,
  canUndo,
  redo as historyRedo,
  undo as historyUndo,
} from '../store/history.ts';
import { exportLayout, importLayoutFile } from '../lib/persist.ts';
import {
  connectDevice,
  deviceStatus,
  disconnectDevice,
  isProtectedFile,
  isSerialSupported,
  uploadAndRun,
} from '../lib/iii-device.ts';
import { FileManager } from './FileManager.tsx';
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

  /**
   * Returns null if the selection satisfies the recipe's shape
   * constraint, or a human-readable explanation if it doesn't. Recipes
   * with no `shape` field always return null.
   */
  const shapeViolation = (): string | null => {
    const r = recipe();
    if (!r || !r.shape) return null;
    if (selectionSize() === 0) return null; // separate "select something" message
    const { numRows, numCols } = selectionGeometry();
    const { minCols, minRows, rectangleRequired } = r.shape;
    if (typeof minCols === 'number' && numCols < minCols) {
      return `${r.label.toLowerCase()} needs ≥ ${minCols} cols × ${
        minRows ?? 1
      } rows (have ${numCols} × ${numRows})`;
    }
    if (typeof minRows === 'number' && numRows < minRows) {
      return `${r.label.toLowerCase()} needs ≥ ${minCols ?? 1} cols × ${minRows} rows (have ${numCols} × ${numRows})`;
    }
    if (rectangleRequired && selectionSize() !== numRows * numCols) {
      return `${r.label.toLowerCase()} needs a filled rectangle (have ${selectionSize()} of ${numRows * numCols} cells)`;
    }
    return null;
  };

  const canAdd = () =>
    selectionSize() > 0 && recipe() !== null && shapeViolation() === null;

  // Region list filter: show regions on the active page, plus
  // page_select regions (which are always globally visible).
  const visibleRegions = () =>
    regions().filter(
      (r) =>
        r.pageIndex === activePageIndex() || r.recipeKind === 'page_select',
    );
  const downloadName = () => (layoutName().trim() || 'untitled');
  // Layout name "init" or "lib" would clobber iii's core files
  // (init.lua / lib.lua) on upload — block it before the user gets
  // there. Case-insensitive so "Init", "LIB" etc. are blocked too.
  const reservedName = () => isProtectedFile(`${downloadName()}.lua`);
  const canDownload = () => regions().length > 0 && !reservedName();

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
      // Deep snapshot. `{ ...values }` is a shallow copy of a Solid store
      // proxy — array params (like `divs`) and any nested object would be
      // shared by reference, so a later edit to the editor's state would
      // silently mutate the saved region's params. unwrap() peels the
      // proxy; structuredClone() deep-copies the plain data underneath.
      values: structuredClone(unwrap(values)),
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

  function buildLayout(): GridLayout {
    const toRegion = (r: SavedRegion): Region => {
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
    };
    // Partition regions by pageIndex into the per-page arrays the
    // codegen expects. pageNames is the canonical "how many pages
    // exist" list — even an empty page (no regions) gets emitted so
    // the page_select dispatch table covers the right indices.
    const pages = pageNames().map((name, i) => ({
      id: `p${i + 1}`,
      name,
      regions: regions().filter((r) => r.pageIndex === i).map(toRegion),
    }));
    return {
      version: 1,
      tool_version: '0.0.0',
      name: downloadName(),
      width: COLS,
      height: ROWS,
      active_page_index: 0,
      pages,
    };
  }

  function onDownload() {
    if (!canDownload()) return;
    downloadText(`${downloadName()}.lua`, emit(buildLayout()));
  }

  async function onRun() {
    if (!canDownload()) return;
    const status = deviceStatus();
    if (status.kind !== 'connected') return;
    const filename = `${downloadName()}.lua`;
    if (isProtectedFile(filename)) {
      setNotice(
        `"${filename}" is a core iii file — pick a different layout name`,
      );
      return;
    }
    try {
      setNotice(`uploading ${filename}…`);
      await uploadAndRun(filename, emit(buildLayout()));
      setNotice(`running ${filename} on iii`);
    } catch (err) {
      setNotice(`upload failed: ${(err as Error).message}`);
    }
  }

  async function onConnect() {
    await connectDevice();
    const s = deviceStatus();
    if (s.kind === 'error') setNotice(`connect failed: ${s.message}`);
    else if (s.kind === 'connected') setNotice('connected to iii');
  }

  async function onDisconnect() {
    await disconnectDevice();
    setNotice('disconnected from iii');
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

  function onUndo() {
    const snap = historyUndo();
    if (snap) applyLayoutSnapshot(snap);
  }
  function onRedo() {
    const snap = historyRedo();
    if (snap) applyLayoutSnapshot(snap);
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
            class={`w-full bg-neutral-900 border rounded px-2 py-1 text-sm text-neutral-200 font-mono focus:outline-none ${
              reservedName()
                ? 'border-rose-500/60 focus:border-rose-400'
                : 'border-neutral-800 focus:border-neutral-600'
            }`}
          />
          <Show when={reservedName()}>
            <p class="text-[10px] text-rose-400 italic leading-relaxed">
              "{downloadName()}" conflicts with a core iii file
              ({downloadName()}.lua). Pick a different name.
            </p>
          </Show>
          <div class="flex gap-1">
            <SmallButton onClick={onImportClick}>Import</SmallButton>
            <SmallButton onClick={onExport} disabled={regions().length === 0}>
              Export
            </SmallButton>
            <SmallButton onClick={onNew} disabled={!hasContent()}>
              New
            </SmallButton>
          </div>
          <div class="flex gap-1">
            <SmallButton onClick={onUndo} disabled={!canUndo()}>
              ↶ Undo
            </SmallButton>
            <SmallButton onClick={onRedo} disabled={!canRedo()}>
              ↷ Redo
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
        <Show when={shapeViolation()}>
          <p class="text-[10px] text-amber-200/70 italic leading-relaxed">
            {shapeViolation()}
          </p>
        </Show>
        <Show when={notice()}>
          <p class="text-[10px] text-neutral-500 italic leading-relaxed">
            {notice()}
          </p>
        </Show>
      </div>

      <Section title="Pages">
        <PageTabBar />
      </Section>

      <Show when={visibleRegions().length > 0}>
        <Section title={`Regions on ${pageNames()[activePageIndex()]}`}>
          <div class="space-y-1">
            <For each={visibleRegions()}>{(r) => <RegionRow region={r} />}</For>
          </div>
        </Section>
      </Show>

      <Show
        when={
          deviceStatus().kind === 'connected' ||
          deviceStatus().kind === 'busy' ||
          deviceStatus().kind === 'reconnecting'
        }
      >
        <Section title="Files on iii">
          <FileManager />
        </Section>
      </Show>

      <div class="mt-auto pt-4 border-t border-neutral-900 space-y-2">
        <DeviceRow
          onConnect={onConnect}
          onDisconnect={onDisconnect}
        />
        <Show when={deviceStatus().kind === 'connected'}>
          <button
            type="button"
            onClick={onRun}
            disabled={!canDownload() || deviceStatus().kind !== 'connected'}
            class={`w-full py-2 text-sm rounded border font-mono tracking-wider ${
              canDownload()
                ? 'border-amber-200/60 bg-amber-100/10 text-amber-100 hover:bg-amber-100/20'
                : 'border-neutral-900 text-neutral-700 cursor-not-allowed'
            }`}
          >
            ▶ Run on iii
          </button>
        </Show>
        <button
          type="button"
          onClick={onDownload}
          disabled={!canDownload()}
          class={`w-full py-2 text-sm rounded border font-mono tracking-wider ${
            canDownload()
              ? deviceStatus().kind === 'connected'
                ? 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-900'
                : 'border-amber-200/40 bg-amber-100/5 text-amber-100 hover:bg-amber-100/10'
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
        {regionSummary(props.region)}
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

function regionSummary(region: SavedRegion): string {
  const recipe = RECIPES[region.recipeKind].label.toLowerCase();
  const v = region.values;
  // Surface settings the user can't tell apart at a glance from the
  // grid colour alone: scale (note keyboard, step seq note mode),
  // direction (step seq), output mode (step seq).
  const tags: string[] = [];
  if (region.recipeKind === 'note_keyboard') {
    const scale = typeof v.scale === 'string' ? v.scale : 'chromatic';
    if (scale !== 'chromatic') tags.push(scale);
  }
  if (region.recipeKind === 'step_sequencer') {
    if (v.output_mode === 'cc_per_row') tags.push('cc');
    if (v.output_mode === 'note_per_row') {
      const scale = typeof v.scale === 'string' ? v.scale : 'chromatic';
      if (scale !== 'chromatic') tags.push(scale);
      // mono is stored as a string enum 'poly'/'mono' in the editor
      // values; the codegen normalises to boolean. Either form means
      // mono for tagging purposes.
      if (v.mono === 'mono' || v.mono === true) tags.push('mono');
    }
    if (typeof v.direction === 'string' && v.direction !== 'forward') {
      tags.push(v.direction);
    }
  }
  const tagStr = tags.length > 0 ? ` ${tags.join('/')}` : '';
  return `${recipe}${tagStr} · ${region.cellKeys.size}`;
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

function PageTabBar() {
  const [editing, setEditing] = createSignal<number | null>(null);
  const [draft, setDraft] = createSignal('');

  function commitRename(i: number) {
    const next = draft().trim();
    if (next) renamePage(i, next);
    setEditing(null);
  }

  // Warn if the page_select region's cell count doesn't match the
  // page count: too few cells = unreachable pages, too many = inert
  // (dim) cells. A user-visible reminder is the cleanest fix —
  // auto-resizing page_select would have to invent a placement
  // strategy and surprise the user.
  const pageSelectStatus = (): {
    cells: number;
    pages: number;
    issue: 'short' | 'extra' | null;
  } | null => {
    const ps = regions().find((r) => r.recipeKind === 'page_select');
    if (!ps) return null;
    const cells = ps.cellKeys.size;
    const pages = pageNames().length;
    if (cells === pages) return { cells, pages, issue: null };
    return { cells, pages, issue: cells < pages ? 'short' : 'extra' };
  };

  return (
    <div class="space-y-2">
      <div class="flex flex-wrap gap-1">
        <For each={pageNames()}>
          {(name, i) => {
            const active = () => activePageIndex() === i();
            return (
              <Show
                when={editing() === i()}
                fallback={
                  <button
                    type="button"
                    onClick={() => setActivePageIndex(i())}
                    onDblClick={() => {
                      setDraft(name);
                      setEditing(i());
                    }}
                    class={`px-2 py-1 text-xs rounded border font-mono ${
                      active()
                        ? 'border-amber-200/60 bg-amber-100/10 text-amber-100'
                        : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                    }`}
                    title={`switch to ${name} (double-click to rename)`}
                  >
                    {i() + 1}. {name}
                  </button>
                }
              >
                <input
                  type="text"
                  value={draft()}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                  onBlur={() => commitRename(i())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  ref={(el) => setTimeout(() => el?.focus(), 0)}
                  class="w-20 bg-neutral-950 border border-neutral-700 rounded px-1 py-1 text-xs text-neutral-200 font-mono focus:outline-none"
                />
              </Show>
            );
          }}
        </For>
        <button
          type="button"
          onClick={() => addPage()}
          class="px-2 py-1 text-xs rounded border border-neutral-800 bg-neutral-950 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700 font-mono"
          title="add page"
        >
          + page
        </button>
      </div>
      <Show when={pageNames().length > 1 && activePageIndex() > 0}>
        <div class="flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (
                confirm(
                  `Delete page ${activePageIndex() + 1} "${pageNames()[activePageIndex()]}" and its regions?`,
                )
              ) {
                removePage(activePageIndex());
              }
            }}
            class="text-[10px] text-neutral-700 hover:text-rose-400 italic"
            title="delete current page"
          >
            delete current page
          </button>
        </div>
      </Show>
      <Show when={pageSelectStatus()?.issue === 'short'}>
        <p class="text-[10px] text-amber-200/70 italic leading-relaxed">
          page_select has {pageSelectStatus()!.cells} cell
          {pageSelectStatus()!.cells === 1 ? '' : 's'} but{' '}
          {pageSelectStatus()!.pages} pages exist — pages{' '}
          {pageSelectStatus()!.cells + 1} and up will be unreachable
          from the grid. Re-create page_select with at least{' '}
          {pageSelectStatus()!.pages} cells.
        </p>
      </Show>
      <Show when={pageSelectStatus()?.issue === 'extra'}>
        <p class="text-[10px] text-neutral-500 italic leading-relaxed">
          page_select has {pageSelectStatus()!.cells} cells but only{' '}
          {pageSelectStatus()!.pages} pages exist — the extra{' '}
          {pageSelectStatus()!.cells - pageSelectStatus()!.pages} cell
          {pageSelectStatus()!.cells - pageSelectStatus()!.pages === 1
            ? ''
            : 's'}{' '}
          will render dim and be inert.
        </p>
      </Show>
      <p class="text-[10px] text-neutral-600 leading-relaxed">
        click a tab to switch · double-click to rename · regions added
        on the current page only show on that page (except{' '}
        <span class="text-neutral-400">page_select</span>, which shows
        on every page)
      </p>
    </div>
  );
}

function DeviceRow(props: {
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const status = deviceStatus;
  const label = () => {
    const s = status();
    switch (s.kind) {
      case 'unsupported':
        return 'web serial unsupported';
      case 'disconnected':
        return 'iii not connected';
      case 'connecting':
        return 'connecting…';
      case 'connected':
        return 'iii connected';
      case 'reconnecting':
        return 'iii rebooted, reconnecting…';
      case 'busy':
        return s.action;
      case 'error':
        return s.message;
    }
  };
  const dot = () => {
    const k = status().kind;
    if (k === 'connected') return 'bg-amber-200';
    if (k === 'busy') return 'bg-amber-200 animate-pulse';
    if (k === 'connecting' || k === 'reconnecting')
      return 'bg-neutral-400 animate-pulse';
    if (k === 'error') return 'bg-rose-400';
    return 'bg-neutral-700';
  };
  const showConnect = () =>
    status().kind === 'disconnected' || status().kind === 'error';
  const showDisconnect = () =>
    status().kind === 'connected' ||
    status().kind === 'busy' ||
    status().kind === 'reconnecting';
  const supported = isSerialSupported();
  return (
    <div class="flex items-center gap-2 text-[10px]">
      <span class={`w-2 h-2 rounded-full flex-shrink-0 ${dot()}`} />
      <span class="flex-1 text-neutral-500 font-mono truncate">
        {label()}
      </span>
      <Show when={supported && showConnect()}>
        <button
          type="button"
          onClick={props.onConnect}
          class="px-2 py-1 text-[10px] uppercase tracking-wider rounded border border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
        >
          Connect
        </button>
      </Show>
      <Show when={showDisconnect()}>
        <button
          type="button"
          onClick={props.onDisconnect}
          class="px-2 py-1 text-[10px] uppercase tracking-wider rounded border border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700"
        >
          Disconnect
        </button>
      </Show>
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
