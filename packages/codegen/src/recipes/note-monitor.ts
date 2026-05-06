import type { NoteMonitorBehavior, Region } from '../types.ts';
import { luaIdent, luaXY } from '../lua-coords.ts';
import type { EmittedFragments } from './momentary.ts';

type NoteMonitorRegion = Region & { behavior: NoteMonitorBehavior };

/**
 * Note monitor — visualise incoming MIDI note_on / note_off events.
 * Each cell of the selection maps to one MIDI note (base_note + i,
 * where i is the cell's natural sort index — top-to-bottom, left-to-
 * right). Notes outside the cell range are ignored.
 *
 * Lua plumbing:
 *   - Per-region note → cell-index lookup table for O(1) hit-test.
 *   - Per-region cells → MIDI velocity (0 = idle, 1..127 = held)
 *     state vector. event_midi handler updates it; redraw renders.
 *   - The handler is registered with the orchestrator via the
 *     `midiHandler` field of EmittedFragments; emit.ts builds the
 *     single global event_midi dispatcher that fans out to every
 *     region's handler.
 */
export function emitNoteMonitor(region: NoteMonitorRegion): EmittedFragments {
  const params = region.behavior.params;
  const name = luaIdent(region.name);
  const handlerName = `handle_midi_${name}`;
  const noteMapTable = `_${name}_note_map`;
  const heldSlot = `${name}_held`;

  // Sort cells in their natural fill order so cell index → note
  // mapping is intuitive.
  const sortedCells = [...region.cells].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );
  const numCells = sortedCells.length;

  // Compile-time note-to-cell-index lookup table (sparse). At
  // runtime: cell_index = note_map[note] (1-based — Lua nil for
  // notes outside the range).
  const noteMapLines = sortedCells
    .map((_, i) => {
      const note = params.base_note + i;
      return `${noteMapTable}[${note}] = ${i + 1}`;
    })
    .join('\n');

  // Channel filter. 0 = any (we don't check). 1..16 = match the
  // status byte's low nibble (which encodes channel-1, i.e. byte's
  // 0..15 = channel 1..16).
  const channelFilter =
    params.channel === 0
      ? ''
      : `if (d1 & 0x0f) ~= ${params.channel - 1} then return end\n  `;

  const declarations = [
    `-- ---- region: ${name} (note_monitor) ----`,
    `local ${noteMapTable} = {}`,
    noteMapLines,
    '',
    `local function ${handlerName}(d1, d2, d3)`,
    // d1 = status byte, d2 = note, d3 = velocity
    // status & 0xf0: 0x90 = note_on, 0x80 = note_off
    `  ${channelFilter}local status = d1 & 0xf0`,
    `  if status ~= 0x90 and status ~= 0x80 then return end`,
    `  local idx = ${noteMapTable}[d2]`,
    `  if not idx then return end`,
    "  -- note_on with velocity 0 is a note-off in MIDI 1.0 wire",
    "  -- protocol; treat it as such.",
    `  if status == 0x80 or d3 == 0 then`,
    `    state.${heldSlot}[idx] = 0`,
    '  else',
    `    state.${heldSlot}[idx] = d3`,
    '  end',
    'end',
  ].join('\n');

  // LED draw: per cell, brightness depends on whether the
  // corresponding note is held. velocity_responsive ramps the
  // brightness from led_idle to led_held with velocity.
  const ledLines = sortedCells
    .map((c, i) => {
      const idx = i + 1;
      if (params.velocity_responsive) {
        const range = params.led_held - params.led_idle;
        // brightness = led_idle + floor((velocity / 127) * range)
        return `  do
    local v = state.${heldSlot}[${idx}]
    if v > 0 then
      grid_led(${luaXY(c)}, ${params.led_idle} + math.floor(v * ${range} / 127))
    else
      grid_led(${luaXY(c)}, ${params.led_idle})
    end
  end`;
      }
      return `  grid_led(${luaXY(c)}, state.${heldSlot}[${idx}] > 0 and ${params.led_held} or ${params.led_idle})`;
    })
    .join('\n');

  const drawBlock = [`  -- region: ${name}`, ledLines].join('\n');

  // No grid press handlers (this region only listens to MIDI).
  const routeAdditions: string[] = [];

  // State: held-velocity vector, all 0 at boot.
  const heldEntries = Array.from({ length: numCells }, (_, i) => `[${i + 1}]=0`).join(', ');
  const stateInit = `${heldSlot} = {${heldEntries}},`;

  return {
    stateInit,
    declarations,
    drawBlock,
    routeAdditions,
    midiHandler: handlerName,
  };
}
