import type { Cell, LfoBehavior, Region } from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import type { EmittedFragments } from './momentary.ts';

type LfoRegion = Region & { behavior: LfoBehavior };

/**
 * LFO: a metro-driven cyclic CC modulation. The selection shows a
 * meter-style fill of the current LFO value (0..127 → 0..N cells lit
 * across the selection in a top-to-bottom, left-to-right order).
 *
 * No grid input — the LFO is purely an output. Group-only.
 *
 * Output: midi_cc(<cc>, value, <channel>) emitted at every tick where
 * the integer value has changed (so DAWs aren't spammed with redundant
 * CC at e.g. 100 Hz tick rate).
 *
 * Waveform is computed from the phase (0..1) per tick:
 *   sine     v = center + depth/2 * sin(2π·phase)
 *   triangle v = center + depth/2 * tri(phase)   tri ramps -1→1→-1
 *   saw      v = center + depth/2 * (2·phase - 1)
 *   square   v = center ± depth/2 depending on which half of the cycle
 *
 * The Lua does the math itself rather than a lookup table — math.sin
 * is already in iii's stdlib and we don't tick fast enough to need
 * pre-computed samples.
 */
export function emitLfo(region: LfoRegion): EmittedFragments {
  const params = region.behavior.params;
  const name = luaIdent(region.name);
  const phaseSlot = `${name}_phase`;
  const lastValueSlot = `${name}_lastv`;
  const tickName = `_${name}_tick`;
  const metroVar = `_${name}_metro`;

  // Render at ~50 Hz: smooth enough for human ears (CC values change
  // every 20 ms) without flooding USB. Could be made tunable later.
  const TICK_S = 0.02;
  const phaseStep = TICK_S / params.period_seconds;

  // Sort cells in a natural fill order: top-to-bottom, left-to-right
  // within each row. For a horizontal-row selection this gives a clean
  // left-to-right meter; for a column it fills top-to-bottom; for a
  // block it fills row by row.
  const sortedCells = [...region.cells].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );
  const numCells = sortedCells.length;

  // Map waveform name to a Lua expression returning value in [-1, 1]
  // for the current phase. Phase is a float in [0, 1).
  const waveExpr = waveformExpression(params.waveform);

  const declarations = [
    `-- ---- region: ${name} (lfo, ${params.waveform}) ----`,
    `local function ${tickName}()`,
    `  state.${phaseSlot} = (state.${phaseSlot} + ${phaseStep}) % 1`,
    `  local p = state.${phaseSlot}`,
    `  local w = ${waveExpr}`,
    `  local v = math.floor(${params.center} + ${params.depth / 2} * w + 0.5)`,
    `  if v < 0 then v = 0 end`,
    `  if v > 127 then v = 127 end`,
    `  if v ~= state.${lastValueSlot} then`,
    `    midi_cc(${params.cc}, v, ${params.channel})`,
    `    state.${lastValueSlot} = v`,
    '    redraw()',
    '  end',
    'end',
    '',
    `local ${metroVar} = metro.init(${tickName}, ${TICK_S})`,
    `${metroVar}:start()`,
  ].join('\n');

  // LED draw: meter-style fill. The fraction of cells lit is
  // last_value / 127 mapped to 0..numCells.
  const ledLines = sortedCells
    .map(
      (c, i) =>
        // i is 0-based; cell #1 lights up first (smallest value), so
        // we light cell #(i+1) when (last_value/127 * numCells) >= i+1.
        `  grid_led(${luaXY(c)}, (state.${lastValueSlot} * ${numCells}) >= (${i + 1} * 127) and ${params.led_bright} or ${params.led_dim})`,
    )
    .join('\n');

  const drawBlock = [`  -- region: ${name}`, ledLines].join('\n');

  // No press handlers — LFO doesn't react to grid input.
  const routeAdditions: string[] = [];

  const stateInit = [
    // Start at phase 0 with whatever the cold value is at phase 0.
    `${phaseSlot} = 0,`,
    `${lastValueSlot} = -1,`,
  ].join('\n');

  // Push the initial CC value so the DAW agrees with the LED state at
  // script boot (matches meter's pattern).
  const initialValue = computeInitialValue(params);
  const initLines = [
    `state.${lastValueSlot} = ${initialValue}`,
    `midi_cc(${params.cc}, ${initialValue}, ${params.channel})`,
  ];

  return {
    stateInit,
    declarations,
    drawBlock,
    routeAdditions,
    initLines,
  };
}

/**
 * Lua expression (over a local `p` in [0, 1)) returning the waveform
 * value in [-1, 1].
 */
function waveformExpression(waveform: LfoBehavior['params']['waveform']): string {
  switch (waveform) {
    case 'sine':
      return 'math.sin(2 * math.pi * p)';
    case 'triangle':
      // 0..0.25 → 0..1, 0.25..0.75 → 1..-1, 0.75..1 → -1..0
      // Or more simply: 4·|p - 0.5| - 1 inverted: tri = 1 - 4·|p - 0.5|
      return '1 - 4 * math.abs(p - 0.5)';
    case 'saw':
      return '2 * p - 1';
    case 'square':
      return '(p < 0.5) and 1 or -1';
  }
}

/**
 * Compute LFO value at phase=0 so init can publish a value that
 * matches what the first tick will emit.
 */
function computeInitialValue(params: LfoBehavior['params']): number {
  const w = (() => {
    switch (params.waveform) {
      case 'sine':
        return Math.sin(0); // 0
      case 'triangle':
        return 1 - 4 * Math.abs(0 - 0.5); // -1
      case 'saw':
        return 2 * 0 - 1; // -1
      case 'square':
        return 0 < 0.5 ? 1 : -1; // 1
    }
  })();
  const v = Math.floor(params.center + (params.depth / 2) * w + 0.5);
  return Math.max(0, Math.min(127, v));
}

// Keep this here for symmetry with other recipes that export it,
// even though we don't use the geometry beyond cell ordering.
export function _analyzeRegion(cells: Cell[]): {
  numCells: number;
} {
  return { numCells: cells.length };
}
