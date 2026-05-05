/**
 * Browser-side iii uploader. Replaces the diii CLI tool by talking
 * directly to the iii hardware over USB serial via the Web Serial API
 * (Chrome / Edge / Arc / Brave / any Chromium ≥ 89).
 *
 * Protocol mirrors the Python diii tool's `upload()`:
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
 * script, matching the manual REPL invocation users do today.
 *
 * Source for the protocol: https://github.com/monome/diii
 *   src/diii/iii.py:upload(), src/diii/cli.py:upload command.
 */

import { createSignal } from 'solid-js';

// USB descriptor reported by iii hardware (from diii's
// `find_serial_port('USB VID:PID=CAFE:1101')`).
const VID = 0xcafe;
const PID = 0x1101;
const BAUD = 115200;

// Pacing constants. The Python tool sleeps 0.1 s between control
// commands and 0.001 s between content lines; mirror that so we don't
// outrun the device's small serial buffer.
const CMD_DELAY_MS = 100;
const LINE_DELAY_MS = 1;
const FINAL_FLUSH_MS = 200;

export type DeviceStatus =
  | { kind: 'unsupported' }
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'busy'; action: string }
  | { kind: 'error'; message: string };

let _port: SerialPort | null = null;

const initialStatus: DeviceStatus =
  typeof navigator !== 'undefined' && 'serial' in navigator
    ? { kind: 'disconnected' }
    : { kind: 'unsupported' };

const [_status, _setStatus] = createSignal<DeviceStatus>(initialStatus);
export const deviceStatus = _status;

export function isSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Prompt the user to pick the iii device and open it. Filtering by the
 * known VID/PID makes only iii devices show up in the picker.
 */
export async function connectDevice(): Promise<void> {
  if (!isSerialSupported()) {
    _setStatus({ kind: 'unsupported' });
    return;
  }
  _setStatus({ kind: 'connecting' });
  try {
    const port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: VID, usbProductId: PID }],
    });
    await port.open({ baudRate: BAUD });
    _port = port;
    _setStatus({ kind: 'connected' });

    // Auto-update status if the device is unplugged.
    const onDisconnect = () => {
      if (_port === port) {
        _port = null;
        _setStatus({ kind: 'disconnected' });
        navigator.serial.removeEventListener('disconnect', onDisconnect);
      }
    };
    navigator.serial.addEventListener('disconnect', onDisconnect);
  } catch (err) {
    // User cancelled the picker → quietly drop back to disconnected;
    // any other error surfaces.
    const msg = (err as Error).message ?? String(err);
    if (/no port selected/i.test(msg) || /cancelled/i.test(msg)) {
      _setStatus({ kind: 'disconnected' });
    } else {
      _setStatus({ kind: 'error', message: msg });
    }
  }
}

export async function disconnectDevice(): Promise<void> {
  if (_port) {
    try {
      await _port.close();
    } catch {
      // best-effort
    }
    _port = null;
  }
  _setStatus({ kind: 'disconnected' });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function writeLine(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  line: string,
): Promise<void> {
  // diii pads buffers that are exactly 64 bytes long with an extra
  // newline to avoid USB packet boundary edge-cases. Mirror that.
  let payload = line + '\n';
  if (payload.length % 64 === 0) payload += '\n';
  await writer.write(new TextEncoder().encode(payload));
}

/**
 * Upload `lua` to the device under `filename` and start it via
 * `first(...)`. `filename` should NOT include a path — diii uses just
 * the basename and so do we.
 */
export async function uploadAndRun(
  filename: string,
  lua: string,
): Promise<void> {
  if (!_port) {
    throw new Error('not connected to iii device');
  }
  const writable = _port.writable;
  if (!writable) {
    throw new Error('iii port is not writable (closed or locked)');
  }
  _setStatus({ kind: 'busy', action: 'uploading' });

  const writer = writable.getWriter();
  try {
    // Outer "select file" priming (cli.py does this before upload()).
    await writeLine(writer, '^^s');
    await sleep(CMD_DELAY_MS);
    await writeLine(writer, filename);
    await sleep(CMD_DELAY_MS);
    await writeLine(writer, '^^f');
    await sleep(CMD_DELAY_MS);

    // Inner upload (mirrors iii.py upload()).
    await writeLine(writer, '^^s');
    await sleep(CMD_DELAY_MS);
    await writeLine(writer, filename);
    await sleep(CMD_DELAY_MS);
    await writeLine(writer, '^^f');
    await sleep(CMD_DELAY_MS);
    await writeLine(writer, '^^s');
    await sleep(CMD_DELAY_MS);

    // File body, line by line. \r is stripped to keep behaviour
    // deterministic across platforms (the emitter only writes \n
    // anyway, but be defensive).
    const lines = lua.split('\n').map((l) => l.replace(/\r$/, ''));
    for (const line of lines) {
      await writeLine(writer, line);
      if (LINE_DELAY_MS > 0) await sleep(LINE_DELAY_MS);
    }
    await sleep(CMD_DELAY_MS);

    await writeLine(writer, '^^w');
    await sleep(FINAL_FLUSH_MS);

    // Now start it. `first("name.lua")` is what users normally type at
    // the diii REPL after `upload`. Sending it on the same connection
    // gives the same effect.
    _setStatus({ kind: 'busy', action: 'running' });
    await writeLine(writer, `first("${filename}")`);
    await sleep(CMD_DELAY_MS);

    _setStatus({ kind: 'connected' });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    _setStatus({ kind: 'error', message: msg });
    throw err;
  } finally {
    writer.releaseLock();
  }
}
