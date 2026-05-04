import type { Component } from 'solid-js';
import { VERSION as CODEGEN_VERSION } from '@monome-iii-studio/codegen';

const App: Component = () => {
  return (
    <main class="min-h-screen flex items-center justify-center p-8">
      <div class="max-w-xl text-center space-y-4">
        <h1 class="text-3xl font-semibold tracking-tight">monome-iii-studio</h1>
        <p class="text-neutral-400">
          Scaffold ready. Step 1 done — workspace, build, test, and Tailwind
          all live. The Grid canvas, behavior panel, and parameter editor land
          in Steps 3 and 4.
        </p>
        <p class="text-xs text-neutral-600 font-mono">
          codegen v{CODEGEN_VERSION}
        </p>
      </div>
    </main>
  );
};

export default App;
