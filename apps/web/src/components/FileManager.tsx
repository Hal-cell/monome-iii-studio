/**
 * iii on-device file manager. Lists files via `fs_list_files()`,
 * lets the user run / delete each one, and exposes a free-form
 * "send command" input for arbitrary REPL invocations — the browser
 * equivalent of diii's `list`, `do`, and the manual `first(...)` /
 * `fs_remove(...)` calls.
 */

import { For, Show, createEffect, createSignal, onMount } from 'solid-js';
import {
  deleteFile,
  deviceStatus,
  fileListVersion,
  isProtectedFile,
  listFiles,
  runFile,
  sendCommand,
} from '../lib/iii-device.ts';

export function FileManager() {
  const [files, setFiles] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [cmd, setCmd] = createSignal('');
  const [cmdOutput, setCmdOutput] = createSignal<string[]>([]);

  const ready = () => deviceStatus().kind === 'connected';

  async function refresh() {
    if (!ready()) return;
    setBusy(true);
    setError(null);
    try {
      setFiles(await listFiles());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRun(name: string) {
    if (!ready()) return;
    setBusy(true);
    setError(null);
    try {
      await runFile(name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(name: string) {
    if (!ready()) return;
    if (isProtectedFile(name)) return;
    if (!confirm(`Delete "${name}" from the iii device?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteFile(name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
    // Refresh outside the busy gate so the spinner updates correctly
    // and we always reflect the post-delete state, even on failure.
    await refresh();
  }

  async function onSendCmd(e: Event) {
    e.preventDefault();
    const line = cmd().trim();
    if (!line || !ready()) return;
    setBusy(true);
    setError(null);
    try {
      const out = await sendCommand(line);
      setCmdOutput(out);
      setCmd('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Auto-refresh once when the component mounts and the device is
  // already connected.
  onMount(() => {
    if (ready()) void refresh();
  });

  // Auto-refresh whenever something else in the app reports the file
  // list might have changed (Run-on-iii uploads a new file, etc.).
  // Skip the initial firing — onMount above already covers that.
  let firstVersion = true;
  createEffect(() => {
    fileListVersion();
    if (firstVersion) {
      firstVersion = false;
      return;
    }
    if (ready()) void refresh();
  });

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] text-neutral-500 font-mono">
          {files().length === 0
            ? '— empty —'
            : `${files().length} file${files().length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={!ready() || busy()}
          class="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded border border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 disabled:text-neutral-700 disabled:cursor-not-allowed"
        >
          {busy() ? '…' : 'Refresh'}
        </button>
      </div>

      <Show when={files().length > 0}>
        <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
          <For each={files()}>
            {(name) => {
              const protectedFile = isProtectedFile(name);
              return (
                <div class="flex items-center gap-1 px-2 py-1 bg-neutral-900/50 rounded border border-transparent hover:border-neutral-800">
                  <span
                    class={`flex-1 text-xs font-mono truncate ${
                      protectedFile ? 'text-neutral-500 italic' : 'text-neutral-300'
                    }`}
                    title={
                      protectedFile
                        ? `${name} — core file, cannot be removed`
                        : name
                    }
                  >
                    {name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRun(name)}
                    disabled={busy()}
                    class="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded border border-amber-200/30 text-amber-100 hover:bg-amber-100/10 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={`first("${name}")`}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(name)}
                    disabled={busy() || protectedFile}
                    class="text-neutral-700 hover:text-rose-400 text-base leading-none px-1 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-neutral-700"
                    title={
                      protectedFile
                        ? `${name} is a core file`
                        : `delete ${name}`
                    }
                  >
                    ×
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <form onSubmit={onSendCmd} class="space-y-1">
        <div class="flex gap-1">
          <input
            type="text"
            value={cmd()}
            onInput={(e) => setCmd(e.currentTarget.value)}
            placeholder="send Lua…"
            disabled={!ready() || busy()}
            class="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-200 font-mono focus:outline-none focus:border-neutral-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!ready() || busy() || cmd().trim().length === 0}
            class="px-2 py-1 text-[10px] uppercase tracking-wider rounded border border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700 disabled:text-neutral-700 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>

      <Show when={cmdOutput().length > 0}>
        <pre class="text-[10px] text-neutral-500 font-mono bg-neutral-950 border border-neutral-900 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">
          {cmdOutput().join('\n')}
        </pre>
      </Show>

      <Show when={error()}>
        <p class="text-[10px] text-rose-400 italic leading-relaxed">
          {error()}
        </p>
      </Show>
    </div>
  );
}
