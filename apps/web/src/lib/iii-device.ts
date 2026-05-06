/**
 * Browser-side iii uploader + file manager. Replaces the diii CLI tool
 * by talking directly to the iii hardware over USB serial via the Web
 * Serial API (Chrome / Edge / Arc / Brave / any Chromium ≥ 89).
 *
 * The upload protocol mirrors the Python diii tool's `iii.upload()`:
 *
 *     ^^s              start string-receive
 *     <basename>       filename
 *     ^^f              commit filename context
 *     ^^s              start string-receive again
 *     <basename>
 *     ^^f
 *     ^^s              start receiving file body
 *     <line 1>
 *     <line 2>
 *     ...
 *     ^^w              write to flash
 *
 * After a successful upload we send `first("<filename>")` to start the
 * script.
 *
 * Auto-reconnect: iii reboots its Lua VM on `first(...)` and may
 * re-enumerate USB. The original SerialPort object becomes stale — the
 * Python diii tool catches read errors and silently re-opens a fresh
 * port via `find_serial_port`. We do the same: on `disconnect` event
 * (or any read/write error), poll `navigator.serial.getPorts()` for the
 * iii to come back and re-open it. The user sees a brief
 * "reconnecting…" status instead of having to click Connect again.
 *
 * Source for the protocol: https://github.com/monome/diii
 *   src/diii/iii.py:upload(), src/diii/cli.py.
 */

import { createSignal } from 'solid-js';

// USB descriptor reported by iii hardware.
const VID = 0xcafe;
const PID = 0x1101;
const BAUD = 115200;

// Pacing constants. The Python tool sleeps 0.1 s between control
// commands and 0.001 s between content lines; mirror that so we don't
// outrun the device's small serial buffer.
const CMD_DELAY_MS = 100;
const LINE_DELAY_MS = 1;
const FINAL_FLUSH_MS = 200;

// Reconnect tuning. iii typically comes back within ~1 s of a soft
// reset; we poll for up to ~6 s before giving up.
const RECONNECT_POLL_MS = 250;
const RECONNECT_MAX_ATTEMPTS = 24;

export type DeviceStatus =
  | { kind: 'unsupported' }
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'reconnecting' }
  | { kind: 'busy'; action: string }
  | { kind: 'error'; message: string };

let _port: SerialPort | null = null;
// Shared writer for the lifetime of the connection. Acquired lazily on
// first write, released on disconnect or after a failed write. Holding
// one writer (rather than acquire/release per call) avoids the
// "Cannot create writer when WritableStream is locked" race we get if
// two paths — say uploadAndRun in flight, FileManager refresh firing —
// both call getWriter() at once. WritableStreamDefaultWriter.write()
// already queues internally, so concurrent callers serialise safely.
let _writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let _readerLoopAbort: AbortController | null = null;
let _readListeners: ((line: string) => void)[] = [];
let _readBuffer = '';
let _disconnectHandler: ((event: Event) => void) | null = null;

const initialStatus: DeviceStatus =
  typeof navigator !== 'undefined' && 'serial' in navigator
    ? { kind: 'disconnected' }
    : { kind: 'unsupported' };

const [_status, _setStatus] = createSignal<DeviceStatus>(initialStatus);
export const deviceStatus = _status;

/**
 * Bump whenever the device's file list might have changed (after
 * upload or delete). Components subscribe to this to auto-refresh
 * their cached lists. We use an integer counter rather than firing the
 * list itself so subscribers that aren't currently visible don't pay
 * the cost.
 */
const [_fileListVersion, _setFileListVersion] = createSignal(0);
export const fileListVersion = _fileListVersion;
function bumpFileList(): void {
  _setFileListVersion((v) => v + 1);
}

export function isSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isOurPort(p: SerialPort): boolean {
  const info = p.getInfo();
  return info.usbVendorId === VID && info.usbProductId === PID;
}

async function findGrantedIii(): Promise<SerialPort | null> {
  const ports = await navigator.serial.getPorts();
  return ports.find(isOurPort) ?? null;
}

/**
 * Open the supplied port and start the background reader. Side-effect:
 * sets `_port` and the connected status.
 */
async function openAndAttach(port: SerialPort): Promise<void> {
  await port.open({ baudRate: BAUD });
  _port = port;
  _setStatus({ kind: 'connected' });
  startReader();
  installDisconnectHandler();
}

/**
 * Start the background reader loop — pulls bytes off the port, splits
 * them into lines, and dispatches each line to whatever listeners
 * `sendAndCollect` has registered. Runs until aborted (disconnect or
 * new connect).
 */
function startReader(): void {
  if (_readerLoopAbort) {
    _readerLoopAbort.abort();
    _readerLoopAbort = null;
  }
  if (!_port?.readable) return;
  const port = _port;
  const abort = new AbortController();
  _readerLoopAbort = abort;

  void (async () => {
    const reader = port.readable!.getReader();
    const decoder = new TextDecoder();
    _readBuffer = '';
    try {
      while (!abort.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        _readBuffer += decoder.decode(value, { stream: true });
        // emit complete lines
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const nl = _readBuffer.indexOf('\n');
          if (nl < 0) break;
          const line = _readBuffer.slice(0, nl).replace(/\r$/, '');
          _readBuffer = _readBuffer.slice(nl + 1);
          for (const l of _readListeners) l(line);
        }
      }
    } catch {
      // Read errors fall through to disconnect handling below.
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* noop */
      }
    }
    // If the reader exited unexpectedly while we still thought we were
    // connected, treat that as a disconnect and try to recover.
    if (!abort.signal.aborted && _port === port) {
      void handleDisconnect(port);
    }
  })();
}

function installDisconnectHandler(): void {
  if (_disconnectHandler) {
    navigator.serial.removeEventListener('disconnect', _disconnectHandler);
  }
  const handler = (event: Event) => {
    // The disconnect event's `target` is the SerialPort itself; cast
    // through unknown because lib.dom types it as plain EventTarget.
    const target = event.target as unknown as SerialPort | null;
    if (target && target === _port) {
      void handleDisconnect(target);
    }
  };
  _disconnectHandler = handler;
  navigator.serial.addEventListener('disconnect', handler);
}

function releaseWriter(): void {
  if (_writer) {
    try {
      _writer.releaseLock();
    } catch {
      /* writer is already detached; nothing to do */
    }
    _writer = null;
  }
}

async function handleDisconnect(staleSince: SerialPort): Promise<void> {
  // Idempotency: if another disconnect already fired we just keep
  // whatever state the prior call settled on.
  if (_port !== staleSince && _port !== null) return;
  releaseWriter();
  _port = null;
  if (_readerLoopAbort) {
    _readerLoopAbort.abort();
    _readerLoopAbort = null;
  }
  _setStatus({ kind: 'reconnecting' });
  await reconnectLoop();
}

async function reconnectLoop(): Promise<void> {
  for (let attempt = 0; attempt < RECONNECT_MAX_ATTEMPTS; attempt++) {
    await sleep(RECONNECT_POLL_MS);
    if (_port !== null) return; // user beat us to it
    const port = await findGrantedIii();
    if (!port) continue;
    try {
      await openAndAttach(port);
      return;
    } catch {
      // Port might still be busy from the soft reset; retry.
    }
  }
  _setStatus({ kind: 'disconnected' });
}

/**
 * Prompt the user to pick the iii device and open it. Reuses an
 * already-granted port if one exists (avoids the picker on subsequent
 * connects).
 */
export async function connectDevice(): Promise<void> {
  if (!isSerialSupported()) {
    _setStatus({ kind: 'unsupported' });
    return;
  }
  _setStatus({ kind: 'connecting' });
  try {
    let port = await findGrantedIii();
    if (!port) {
      port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: VID, usbProductId: PID }],
      });
    }
    await openAndAttach(port);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/no port selected/i.test(msg) || /cancelled/i.test(msg)) {
      _setStatus({ kind: 'disconnected' });
    } else {
      _setStatus({ kind: 'error', message: msg });
    }
  }
}

export async function disconnectDevice(): Promise<void> {
  if (_disconnectHandler) {
    navigator.serial.removeEventListener('disconnect', _disconnectHandler);
    _disconnectHandler = null;
  }
  if (_readerLoopAbort) {
    _readerLoopAbort.abort();
    _readerLoopAbort = null;
  }
  releaseWriter();
  if (_port) {
    try {
      await _port.close();
    } catch {
      /* best-effort */
    }
    _port = null;
  }
  _setStatus({ kind: 'disconnected' });
}

// -------- writing helpers --------

/**
 * Lazily acquire the per-connection writer. Throws if the port isn't
 * open. Subsequent calls reuse the same writer until releaseWriter()
 * is called (on error or disconnect).
 */
function getOrCreateWriter(): WritableStreamDefaultWriter<Uint8Array> {
  if (_writer) return _writer;
  if (!_port?.writable) {
    throw new Error('not connected to iii device');
  }
  _writer = _port.writable.getWriter();
  return _writer;
}

async function writeRaw(payload: string): Promise<void> {
  // diii pads buffers that are exactly 64 bytes long with an extra
  // newline to avoid USB packet boundary edge-cases. Mirror that.
  let body = payload;
  if (body.length % 64 === 0) body += '\n';
  const writer = getOrCreateWriter();
  try {
    await writer.write(new TextEncoder().encode(body));
  } catch (err) {
    // The writer is now in an errored state — drop it so the next
    // write reacquires a fresh one (or fails cleanly if the port is
    // gone). Without this, subsequent writes silently fail forever.
    releaseWriter();
    throw err;
  }
}

const writeLineRaw = (line: string) => writeRaw(line + '\n');

/**
 * Send a single command and collect everything the device prints in
 * response, returning once the device has been quiet for `quietMs` (or
 * after `maxMs`, whichever comes first). The REPL echoes commands back
 * so the result will include the original `cmd` followed by the output.
 */
async function sendAndCollect(
  cmd: string,
  quietMs = 250,
  maxMs = 2500,
): Promise<string[]> {
  const lines: string[] = [];
  let lastAt = Date.now();
  const listener = (l: string) => {
    lines.push(l);
    lastAt = Date.now();
  };
  _readListeners.push(listener);
  try {
    await writeLineRaw(cmd);
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(50);
      if (Date.now() - lastAt > quietMs) break;
    }
    return lines;
  } finally {
    _readListeners = _readListeners.filter((l) => l !== listener);
  }
}

// -------- public commands --------

/**
 * Upload `lua` to the device under `filename` and run it.
 *
 * iii firmware semantics (per codeberg.org/tehn/iii):
 *   - ^^w (REPL_CMD_END_WRITE) only persists the buffer to flash —
 *     it does NOT execute the script.
 *   - first(name) is a Lua function defined in lib.lua that writes
 *     `init.lua` containing `fs_run_file('name')`. Just sets the
 *     next-init script — also does NOT execute anything.
 *   - Actually starting the script requires re-initialising the VM
 *     so init.lua runs again. The soft path is ^^i (REPL_CMD_INIT),
 *     which calls vm_deinit(); vm_init(true). The hard path is
 *     ^^r (watchdog_reboot), which replays the boot animation —
 *     we deliberately avoid that here.
 *
 * So the right sequence is upload + first() + ^^i: write the file,
 * point init.lua at it, then re-init the VM cleanly.
 */
export async function uploadAndRun(
  filename: string,
  lua: string,
): Promise<void> {
  if (!_port) throw new Error('not connected to iii device');
  _setStatus({ kind: 'busy', action: 'uploading' });

  try {
    // 1. Stop whatever script is currently running before we start
    //    pushing tens of KB of new Lua over USB. ^^c is REPL_CMD_CLEAN
    //    in iii's repl.c — vm_deinit() + vm_init(false) — which kills
    //    all metros (including, e.g., the snake easter egg's 50 Hz
    //    redraw loop) and gives us a quiet VM to upload into.
    //
    //    Side effect: vm_init(false) skips lib.lua, so the Lua-side
    //    `first()` helper is NOT available between this ^^c and the
    //    final ^^i. We work around that below by writing init.lua
    //    directly via the fs_write_file C primitive.
    await writeLineRaw('^^c');
    await sleep(CMD_DELAY_MS);

    // 2. Blank the grid LEDs. With no script running, nothing will
    //    fight us by re-drawing the previous frame, so the
    //    transition from old → new script looks clean even if the
    //    new script's grid_led_all(0) happens to be deferred.
    await writeLineRaw('grid_led_all(0); grid_refresh()');
    await sleep(CMD_DELAY_MS);

    // 3. Upload (mirrors iii.py upload()).
    await writeLineRaw('^^s');
    await sleep(CMD_DELAY_MS);
    await writeLineRaw(filename);
    await sleep(CMD_DELAY_MS);
    await writeLineRaw('^^f');
    await sleep(CMD_DELAY_MS);
    await writeLineRaw('^^s');
    await sleep(CMD_DELAY_MS);
    await writeLineRaw(filename);
    await sleep(CMD_DELAY_MS);
    await writeLineRaw('^^f');
    await sleep(CMD_DELAY_MS);
    await writeLineRaw('^^s');
    await sleep(CMD_DELAY_MS);

    const lines = lua.split('\n').map((l) => l.replace(/\r$/, ''));
    for (const line of lines) {
      await writeLineRaw(line);
      if (LINE_DELAY_MS > 0) await sleep(LINE_DELAY_MS);
    }
    await sleep(CMD_DELAY_MS);

    await writeLineRaw('^^w');
    await sleep(FINAL_FLUSH_MS);

    _setStatus({ kind: 'busy', action: 'running' });
    // 4. Point init.lua at the freshly uploaded file. We can't call
    //    lib.lua's first(name) helper here because lib.lua hasn't
    //    been loaded since the ^^c above. Inline the body of first()
    //    using the fs_write_file C primitive directly — same effect.
    await writeLineRaw(
      `fs_write_file("init.lua", "fs_run_file('${filename}')")`,
    );
    await sleep(CMD_DELAY_MS);

    // 5. Soft re-init with run_script=true → vm_init runs lib.lua
    //    AND init.lua, which now boots the new file. No hardware
    //    reboot, no boot animation.
    await writeLineRaw('^^i');
    await sleep(CMD_DELAY_MS);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    _setStatus({ kind: 'error', message: msg });
    throw err;
  }
  if (deviceStatus().kind === 'busy') {
    _setStatus({ kind: 'connected' });
  }
  bumpFileList();
}

/**
 * Run an existing file on the device. We set it as the boot script
 * via `first(...)` and then issue `^^i` (REPL_CMD_INIT in iii's
 * repl.c — `vm_deinit(); vm_init(true);`) to re-init the Lua VM and
 * launch the boot script. This is a *soft* reset: it tears down the
 * old VM (so we don't pile new metros / handlers on top of whatever
 * was running) but does NOT trigger the hardware watchdog reboot
 * (^^r / ^^reboot), which would replay the boot animation.
 *
 * Source for the command set: codeberg.org/tehn/iii repl.c
 *   REPL_CMD_CLEAN = 'C'  -- vm_deinit(); vm_init(false)
 *   REPL_CMD_INIT  = 'I'  -- vm_deinit(); vm_init(true)   ← what we want
 *   REPL_CMD_RESET = 'R'  -- watchdog_reboot() (full HW reboot)
 *
 * The VM re-init may briefly drop USB; the existing reconnect loop
 * picks the device back up automatically.
 */
export async function runFile(filename: string): Promise<void> {
  if (!_port) throw new Error('not connected to iii device');
  _setStatus({ kind: 'busy', action: `running ${filename}` });
  try {
    // Same pattern as uploadAndRun: ^^c kills the currently running
    // script (so its metros don't bleed into the new boot), we
    // explicitly blank the grid, write init.lua via the fs_write_file
    // primitive (since lib.lua isn't loaded after vm_init(false)),
    // then ^^i to reload lib + init and start the target file.
    await writeLineRaw('^^c');
    await sleep(CMD_DELAY_MS);
    await writeLineRaw('grid_led_all(0); grid_refresh()');
    await sleep(CMD_DELAY_MS);
    await writeLineRaw(
      `fs_write_file("init.lua", "fs_run_file('${filename}')")`,
    );
    await sleep(CMD_DELAY_MS);
    await writeLineRaw('^^i');
    await sleep(CMD_DELAY_MS);
  } finally {
    if (deviceStatus().kind === 'busy') {
      _setStatus({ kind: 'connected' });
    }
  }
}

/**
 * Ask the device for its file list. We use the diii-style for-loop
 * incantation (`fs_list_files`) rather than the docs' `ls()` helper —
 * `ls()` is defined in lib.lua, which the user can modify or
 * temporarily delete (it auto-rebuilds on next boot but only on the
 * NEXT boot). `fs_list_files` is a built-in primitive and is always
 * available.
 *
 * To know when the listing has finished we bracket it with a print()
 * of a unique sentinel marker; that's much more reliable than the
 * "quiet for N ms" heuristic, which times out unhelpfully if the
 * device prints anything else (e.g. script log lines).
 */
export async function listFiles(): Promise<string[]> {
  if (!_port) throw new Error('not connected to iii device');
  const MARKER = '__III_LIST_END__';
  const lines: string[] = [];
  let done = false;
  const listener = (l: string) => {
    if (l.includes(MARKER)) {
      done = true;
      return;
    }
    lines.push(l);
  };
  _readListeners.push(listener);
  try {
    await writeLineRaw('for _,x in pairs(fs_list_files()) do print(x) end');
    await writeLineRaw(`print("${MARKER}")`);
    const start = Date.now();
    while (!done && Date.now() - start < 3000) {
      await sleep(50);
    }
  } finally {
    _readListeners = _readListeners.filter((l) => l !== listener);
  }
  // Filter to plausible filenames: non-empty, no whitespace, no
  // REPL-prompt or control-marker noise, no echoed command tokens.
  const names = new Set<string>();
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('>')) continue;
    if (l.includes('^^')) continue;
    if (/\s/.test(l)) continue;
    // Filter echoed command tokens — the REPL echoes our request back.
    if (l.includes('fs_list_files') || l.includes('pairs')) continue;
    if (l.startsWith('for') || l === 'do' || l === 'end') continue;
    if (l.startsWith('print')) continue;
    names.add(l);
  }
  return Array.from(names).sort();
}

/**
 * Send an arbitrary Lua line and return whatever the device prints
 * back. Useful for diagnostics ("send command" in diii).
 */
export async function sendCommand(line: string): Promise<string[]> {
  if (!_port) throw new Error('not connected to iii device');
  return sendAndCollect(line, 300, 3000);
}

/**
 * Names of files the iii firmware treats as core / auto-rebuilt. We
 * refuse to delete these from the UI side. (`lib.lua` IS technically
 * removable — iii rebuilds it on the next boot — but removing it
 * mid-session usually breaks scripts that depend on it.)
 */
export const PROTECTED_FILES: readonly string[] = ['init.lua', 'lib.lua'];

export function isProtectedFile(name: string): boolean {
  // iii treats filenames case-insensitively for these core files —
  // uploading "Init.lua" would still clobber init.lua. Compare lower.
  const lower = name.toLowerCase();
  return PROTECTED_FILES.includes(lower);
}

/**
 * Delete a file from the device. iii exposes the shell-style `rm(file)`
 * helper for this. Refuses to delete protected (core) files.
 */
export async function deleteFile(filename: string): Promise<void> {
  if (!_port) throw new Error('not connected to iii device');
  if (isProtectedFile(filename)) {
    throw new Error(`${filename} is a core file and cannot be removed`);
  }
  await sendAndCollect(`rm("${filename}")`, 250, 2000);
  bumpFileList();
}
