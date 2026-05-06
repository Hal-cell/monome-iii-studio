/**
 * Easter-egg trigger.
 *
 * Listens for the user typing one of the registered trigger words
 * anywhere on the page (except inside an input / textarea /
 * contenteditable). On match it pops a floating banner with a
 * single primary action: Run on iii if a device is connected,
 * otherwise Download <name>.lua.
 *
 * Add a new egg by appending to the EGGS list — no other plumbing
 * needed. Each entry generates its Lua via a callback so heavy
 * scripts stay lazy.
 *
 * ESC dismisses the banner.
 */

import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { downloadText } from '../lib/download.ts';
import { deviceStatus, uploadAndRun } from '../lib/iii-device.ts';
import { snakeLua } from '../lib/snake-lua.ts';
import { golLua } from '../lib/gol-lua.ts';

type Egg = {
  /** Lowercase keyword to detect in the keystroke buffer. */
  trigger: string;
  /** Banner heading, shown when this egg unlocks. */
  label: string;
  /** Emoji shown next to the heading. */
  emoji: string;
  /** Filename used for upload + download. */
  scriptName: string;
  /** Lua source generator — called only when the user activates. */
  lua: () => string;
};

const EGGS: ReadonlyArray<Egg> = [
  {
    trigger: 'snake',
    label: 'snake unlocked',
    emoji: '🐍',
    scriptName: 'snake.lua',
    lua: snakeLua,
  },
  {
    trigger: 'life',
    label: "conway's life unlocked",
    emoji: '🧬',
    scriptName: 'gol.lua',
    lua: golLua,
  },
];

const MAX_TRIGGER_LEN = EGGS.reduce(
  (m, e) => Math.max(m, e.trigger.length),
  0,
);

export function EasterEgg() {
  const [active, setActive] = createSignal<Egg | null>(null);
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
      setActive(null);
      return;
    }
    if (isInputTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const k = e.key.toLowerCase();
    if (k.length !== 1 || !/[a-z]/.test(k)) return;

    buffer = (buffer + k).slice(-MAX_TRIGGER_LEN);
    for (const egg of EGGS) {
      if (buffer.endsWith(egg.trigger)) {
        setActive(egg);
        setError(null);
        buffer = '';
        return;
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const connected = () => deviceStatus().kind === 'connected';

  async function onActivate() {
    const egg = active();
    if (!egg) return;
    setRunning(true);
    setError(null);
    const lua = egg.lua();
    try {
      if (connected()) {
        await uploadAndRun(egg.scriptName, lua);
      } else {
        downloadText(egg.scriptName, lua);
      }
      setActive(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Show when={active()} keyed>
      {(egg) => (
        <div
          class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-lg border border-amber-200/40 bg-neutral-950/95 backdrop-blur shadow-2xl shadow-amber-200/10 font-mono"
          role="dialog"
          aria-label={egg.label}
        >
          <span class="text-2xl leading-none">{egg.emoji}</span>
          <div class="flex flex-col leading-tight">
            <span class="text-sm text-amber-100 tracking-wider uppercase">
              {egg.label}
            </span>
            <span class="text-[10px] text-neutral-500">
              {connected()
                ? 'press ▶ to deploy on iii'
                : `iii not connected — will download ${egg.scriptName} instead`}
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
                : `⬇ download ${egg.scriptName}`}
          </button>
          <button
            type="button"
            onClick={() => setActive(null)}
            class="text-neutral-600 hover:text-neutral-300 text-lg leading-none px-1"
            aria-label="Dismiss"
            title="dismiss (esc)"
          >
            ×
          </button>
        </div>
      )}
    </Show>
  );
}
