import {
  type Component,
  createEffect,
  createSignal,
  onMount,
} from 'solid-js';
import { VERSION as CODEGEN_VERSION } from '@monome-iii-studio/codegen';
import { BehaviorPanel } from './components/BehaviorPanel.tsx';
import { GridCanvas } from './components/GridCanvas.tsx';
import { loadSession, saveSession } from './lib/persist.ts';
import { restoreSession, snapshotSession } from './store/session.ts';
import { selection } from './store/selection.ts';

const App: Component = () => {
  // `hydrated` gates the auto-save effect so it doesn't write the
  // empty default state over a saved session before restore runs.
  const [hydrated, setHydrated] = createSignal(false);

  onMount(() => {
    const saved = loadSession();
    if (saved) restoreSession(saved);
    setHydrated(true);
  });

  // Auto-save on every store change. The createEffect tracks all the
  // signals snapshotSession() reads, so any user edit triggers a write.
  // localStorage writes are sync and small (<10 KB even with many
  // regions), so we don't bother debouncing.
  createEffect(() => {
    if (!hydrated()) return;
    saveSession(snapshotSession());
  });

  return (
    <main class="min-h-screen flex">
      <div class="flex-1 flex flex-col items-center justify-center gap-10 p-8">
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
          <p class="text-neutral-600">
            {selection().size} cell{selection().size === 1 ? '' : 's'} selected
          </p>
        </section>
      </div>

      <aside class="w-80 border-l border-neutral-900 p-6 overflow-y-auto">
        <BehaviorPanel />
      </aside>

      <p class="absolute bottom-2 left-4 text-[10px] text-neutral-700 font-mono">
        codegen v{CODEGEN_VERSION}
      </p>
    </main>
  );
};

export default App;
