import {
  type Component,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { VERSION as CODEGEN_VERSION } from '@monome-iii-studio/codegen';
import { BehaviorPanel } from './components/BehaviorPanel.tsx';
import { EasterEgg } from './components/EasterEgg.tsx';
import { GridCanvas } from './components/GridCanvas.tsx';
import { exportLayout, loadSession, saveSession } from './lib/persist.ts';
import {
  applyLayoutSnapshot,
  restoreSession,
  serializeRegion,
  snapshotLayout,
  snapshotSession,
} from './store/session.ts';
import {
  captureSnapshot,
  canRedo,
  canUndo,
  redo,
  resetHistory,
  undo,
} from './store/history.ts';
import { layoutName, regions } from './store/regions.ts';
import { clearSelection, selection } from './store/selection.ts';

const App: Component = () => {
  // `hydrated` gates the auto-save effect so it doesn't write the
  // empty default state over a saved session before restore runs.
  const [hydrated, setHydrated] = createSignal(false);

  onMount(() => {
    const saved = loadSession();
    if (saved) restoreSession(saved);
    setHydrated(true);
    // Seed history with the post-restore state so the very first
    // user edit becomes step 2 — there's always something to undo to.
    resetHistory({
      layoutName: layoutName(),
      regions: regions().map(serializeRegion),
    });
  });

  // Auto-save on every store change. The createEffect tracks all the
  // signals snapshotSession() reads, so any user edit triggers a write.
  // localStorage writes are sync and small (<10 KB even with many
  // regions), so we don't bother debouncing.
  createEffect(() => {
    if (!hydrated()) return;
    saveSession(snapshotSession());
  });

  // Auto-capture history on layout state changes. Tracks just the
  // committed layout (name + regions list), not the in-progress
  // editor state — that's transient draft data, not history-worthy.
  // The captureSnapshot helper itself dedupes against the head and
  // suppresses pushes triggered by undo/redo applying a snapshot.
  createEffect(() => {
    if (!hydrated()) return;
    captureSnapshot({
      layoutName: layoutName(),
      regions: regions().map(serializeRegion),
    });
  });

  // Global keyboard shortcuts: undo / redo / export / esc. Skip when
  // an input or contenteditable has focus so the user's typing isn't
  // hijacked. Mod key is ⌘ on macOS, Ctrl elsewhere.
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const isModKey = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);
  const isInputTarget = (t: EventTarget | null) => {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return t.isContentEditable;
  };

  function doUndo() {
    const snap = undo();
    if (snap) applyLayoutSnapshot(snap);
  }
  function doRedo() {
    const snap = redo();
    if (snap) applyLayoutSnapshot(snap);
  }
  function doExport() {
    if (regions().length === 0) return;
    exportLayout(snapshotLayout());
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo. We intercept these
    // even inside inputs because the browser's native undo only
    // covers the focused input's text, not the layout state.
    if (isModKey(e) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) {
        if (canRedo()) doRedo();
      } else {
        if (canUndo()) doUndo();
      }
      return;
    }
    // Cmd/Ctrl+Y = alternate redo (Windows convention)
    if (isModKey(e) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (canRedo()) doRedo();
      return;
    }

    // The rest only fire outside text inputs.
    if (isInputTarget(e.target)) return;

    if (isModKey(e) && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      doExport();
      return;
    }
    if (e.key === 'Escape') {
      if (selection().size > 0) {
        e.preventDefault();
        clearSelection();
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return (
    // h-screen + overflow-hidden on the outer flex pins both columns
    // to the viewport so they scroll INDEPENDENTLY rather than growing
    // the whole page. The grid panel rarely overflows, but does on
    // small windows; the behavior panel almost always overflows when
    // a region is being edited and the file manager is open.
    <main class="h-screen flex overflow-hidden">
      <div class="flex-1 flex flex-col items-center justify-center gap-10 p-8 overflow-y-auto">
        <h1 class="text-2xl font-light tracking-[0.2em] text-neutral-300">
          monome-iii-studio
        </h1>

        <GridCanvas />

        <section class="text-xs text-neutral-500 font-mono max-w-2xl text-center leading-relaxed space-y-2">
          <p>
            <span class="text-neutral-300">click</span> select cell&nbsp;
            <span class="text-neutral-700">·</span>&nbsp;
            <span class="text-neutral-300">drag</span> box-select&nbsp;
            <span class="text-neutral-700">·</span>&nbsp;
            <span class="text-neutral-300">shift + drag</span> add&nbsp;
            <span class="text-neutral-700">·</span>&nbsp;
            <span class="text-neutral-300">click selected</span> deselect
          </p>
          <p>
            <span class="text-neutral-300">{isMac ? '⌘' : 'ctrl'}Z</span> undo
            &nbsp;<span class="text-neutral-700">·</span>&nbsp;
            <span class="text-neutral-300">{isMac ? '⌘⇧' : 'ctrl+shift+'}Z</span> redo
            &nbsp;<span class="text-neutral-700">·</span>&nbsp;
            <span class="text-neutral-300">{isMac ? '⌘' : 'ctrl'}E</span> export
            &nbsp;<span class="text-neutral-700">·</span>&nbsp;
            <span class="text-neutral-300">esc</span> clear selection
          </p>
          <p class="text-neutral-600">
            {selection().size} cell{selection().size === 1 ? '' : 's'} selected
          </p>
        </section>
      </div>

      <aside class="w-80 shrink-0 border-l border-neutral-900 p-6 overflow-y-auto">
        <BehaviorPanel />
      </aside>

      <p class="absolute bottom-2 left-4 text-[10px] text-neutral-700 font-mono pointer-events-none">
        codegen v{CODEGEN_VERSION}
      </p>

      <EasterEgg />
    </main>
  );
};

export default App;
