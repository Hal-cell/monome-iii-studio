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

async function handleDisconnect(staleSince: SerialPort): Promise<void> {
  // Idempotency: if another disconnect already fired we just keep
  // whatever state the prior call settled on.
  if (_port !== staleSince && _port !== null) return;
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

async function writeRaw(payload: string): Promise<void> {
  if (!_port?.writable) {
    throw new Error('not connected to iii device');
  }
  // diii pads buffers that are exactly 64 bytes long with an extra
  // newline to avoid USB packet boundary edge-cases. Mirror that.
  let body = payload;
  if (body.length % 64 === 0) body += '\n';
  const writer = _port.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(body));
  } finally {
    writer.releaseLock();
  }
}

const writeLineRaw = (line: string) => writeRaw(line + '\n');

async function writeLineHeld(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  line: string,
): Promise<void> {
  let body = line + '\n';
  if (body.length % 64 === 0) body += '\n';
  await writer.write(new TextEncoder().encode(body));
}

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
 * Upload `lua` to the device under `filename` and start it via
 * `first(...)`. `filename` should NOT include a path.
 */
export async function uploadAndRun(
  filename: string,
  lua: string,
): Promise<void> {
  if (!_port) throw new Error('not connected to iii device');
  const writable = _port.writable;
  if (!writable) throw new Error('iii port is not writable (closed or locked)');
  _setStatus({ kind: 'busy', action: 'uploading' });

  const writer = writable.getWriter();
  try {
    // Outer "select file" priming (cli.py does this before upload()).
    await writeLineHeld(writer, '^^s');
    await sleep(CMD_DELAY_MS);
    await writeLineHeld(writer, filename);
    await sleep(CMD_DELAY_MS);
    await writeLineHeld(writer, '^^f');
    await sleep(CMD_DELAY_MS);
    // Inner upload (mirrors iii.py upload()).
    await writeLineHeld(writer, '^^s');
    await sleep(CMD_DELAY_MS);
    await writeLineHeld(writer, filename);
    await sleep(CMD_DELAY_MS);
    await writeLineHeld(writer, '^^f');
    await sleep(CMD_DELAY_MS);
    await writeLineHeld(writer, '^^s');
    await sleep(CMD_DELAY_MS);

    const lines = lua.split('\n').map((l) => l.replace(/\r$/, ''));
    for (const line of lines) {
      await writeLineHeld(writer, line);
      if (LINE_DELAY_MS > 0) await sleep(LINE_DELAY_MS);
    }
    await sleep(CMD_DELAY_MS);

    await writeLineHeld(writer, '^^w');
    await sleep(FINAL_FLUSH_MS);

    _setStatus({ kind: 'busy', action: 'running' });
    await writeLineHeld(writer, `first("${filename}")`);
    await sleep(CMD_DELAY_MS);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    _setStatus({ kind: 'error', message: msg });
    throw err;
  } finally {
    try {
      writer.releaseLock();
    } catch {
      /* noop */
    }
  }
  // first() typically triggers a USB re-enum. Hand off to the
  // disconnect / reconnect path so the status flips through
  // "reconnecting" and back to "connected" automatically. If the
  // device DIDN'T re-enum, just keep the connected status.
  if (deviceStatus().kind === 'busy') {
    _setStatus({ kind: 'connected' });
  }
}

/**
 * Start an existing file on the device. Same effect as typing
 * `first("name")` in the diii REPL.
 */
export async function runFile(filename: string): Promise<void> {
  if (!_port) throw new Error('not connected to iii device');
  _setStatus({ kind: 'busy', action: `running ${filename}` });
  try {
    await writeLineRaw(`first("${filename}")`);
    await sleep(CMD_DELAY_MS);
  } finally {
    if (deviceStatus().kind === 'busy') {
      _setStatus({ kind: 'connected' });
    }
  }
}

/**
 * Ask the device for its file list and parse the names out of the
 * response. Sends the same Lua snippet diii's `list` command sends.
 */
export async function listFiles(): Promise<string[]> {
  if (!_port) throw new Error('not connected to iii device');
  const cmd = 'for _,x in pairs(fs_list_files()) do print(x) end';
  const lines = await sendAndCollect(cmd, 400, 3000);
  // The REPL echoes each character of the command back as we type it,
  // so the response begins with garbled echoes of `cmd`. Filter to
  // plausible filenames: non-empty, no special markers, not the
  // command itself.
  const names = new Set<string>();
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.includes('^^')) continue;
    if (l.includes('fs_list_files')) continue;
    if (l.startsWith('>') || l.startsWith('for ')) continue;
    // Filename heuristic: keep things that look like a single token
    // (no spaces) — iii filenames are usually `something.lua`.
    if (/\s/.test(l)) continue;
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
 * Delete a file from the device. iii's filesystem API exposes
 * `fs_remove(name)`; we send that and capture the (usually empty)
 * response.
 */
export async function deleteFile(filename: string): Promise<void> {
  if (!_port) throw new Error('not connected to iii device');
  await sendAndCollect(`fs_remove("${filename}")`, 200, 1500);
}
