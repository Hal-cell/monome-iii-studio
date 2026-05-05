import type { Component } from 'solid-js';
import { VERSION as CODEGEN_VERSION } from '@monome-iii-studio/codegen';
import { GridCanvas } from './components/GridCanvas.tsx';
import { selection } from './store/selection.ts';

const App: Component = () => {
  return (
    <main class="min-h-screen flex flex-col items-center justify-center gap-10 p-8">
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
          <span class="text-neutral-300">shift + drag</span> add to selection&nbsp;
          <span class="text-neutral-700">·</span>&nbsp;
          <span class="text-neutral-300">click selected</span> deselect
        </p>
        <p class="text-neutral-600">
          {selection().size} cell{selection().size === 1 ? '' : 's'} selected
        </p>
      </section>

      <p class="absolute bottom-4 right-6 text-[10px] text-neutral-700 font-mono">
        codegen v{CODEGEN_VERSION}
      </p>
    </main>
  );
};

export default App;
