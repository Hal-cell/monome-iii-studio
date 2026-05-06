/**
 * Snake easter egg trigger.
 *
 * Listens for the user typing "snake" anywhere on the page (except
 * inside an input / textarea / contenteditable). On match it pops a
 * floating banner with a single primary action: Run on iii if a
 * device is connected, otherwise Download snake.lua.
 *
 * The game itself is generated in lib/snake-lua.ts. ESC dismisses
 * the banner.
 */

import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { downloadText } from '../lib/download.ts';
import { deviceStatus, uploadAndRun } from '../lib/iii-device.ts';
import { snakeLua } from '../lib/snake-lua.ts';

const TRIGGER = 'snake';

export function EasterEgg() {
  const [active, setActive] = createSignal(false);
  const [running, setRunning] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let buffer = '';

  function isInputTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return t.isContentEditable;
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setActive(false);
      return;
    }
    if (isInputTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const k = e.key.toLowerCase();
    if (k.length !== 1 || !/[a-z]/.test(k)) return;

    buffer = (buffer + k).slice(-TRIGGER.length);
    if (buffer === TRIGGER) {
      setActive(true);
      setError(null);
      buffer = '';
    }
  };

  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const connected = () => deviceStatus().kind === 'connected';

  async function onActivate() {
    setRunning(true);
    setError(null);
    const lua = snakeLua();
    try {
      if (connected()) {
        await uploadAndRun('snake.lua', lua);
      } else {
        downloadText('snake.lua', lua);
      }
      setActive(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Show when={active()}>
      <div
        class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-lg border border-amber-200/40 bg-neutral-950/95 backdrop-blur shadow-2xl shadow-amber-200/10 font-mono"
        role="dialog"
        aria-label="Snake easter egg"
      >
        <span class="text-2xl leading-none">🐍</span>
        <div class="flex flex-col leading-tight">
          <span class="text-sm text-amber-100 tracking-wider uppercase">
            snake unlocked
          </span>
          <span class="text-[10px] text-neutral-500">
            {connected()
              ? 'press ▶ to deploy on iii'
              : 'iii not connected — will download instead'}
          </span>
          <Show when={error()}>
            <span class="text-[10px] text-rose-400 italic mt-1">
              {error()}
            </span>
          </Show>
        </div>
        <button
          type="button"
          onClick={onActivate}
          disabled={running()}
          class="ml-2 px-3 py-1.5 text-xs uppercase tracking-wider rounded border border-amber-200/60 bg-amber-100/10 text-amber-100 hover:bg-amber-100/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running()
            ? '…'
            : connected()
              ? '▶ run on iii'
              : '⬇ download snake.lua'}
        </button>
        <button
          type="button"
          onClick={() => setActive(false)}
          class="text-neutral-600 hover:text-neutral-300 text-lg leading-none px-1"
          aria-label="Dismiss"
          title="dismiss (esc)"
        >
          ×
        </button>
      </div>
    </Show>
  );
}
