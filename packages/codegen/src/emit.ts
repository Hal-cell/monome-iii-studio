import type {
  GridLayout,
  MomentaryBehavior,
  RadioBehavior,
  RangeBehavior,
  Region,
  ToggleBehavior,
} from './types.ts';
import { emitHeader } from './header.ts';
import { emitMomentary } from './recipes/momentary.ts';
import { emitRadio } from './recipes/radio.ts';
import { emitRange } from './recipes/range.ts';
import { emitToggle } from './recipes/toggle.ts';

/**
 * Compile a GridLayout to an iii Lua script.
 *
 * Pure function: same input always yields byte-identical output. Output
 * stability is part of the public contract — see vault
 * `notes/engineering-kickoff.md` "Project-specific addenda".
 *
 * Step 5: `momentary`, `toggle`, `radio`, and `range` recipes are
 * implemented. emit() throws if it encounters any other behavior kind.
 */
export function emit(layout: GridLayout): string {
  if (layout.pages.length !== 1) {
    throw new Error(
      `v0 supports single-page layouts only; got ${layout.pages.length} pages`,
    );
  }
  const page = layout.pages[0]!;

  const stateInits: string[] = [];
  const declarations: string[] = [];
  const drawBlocks: string[] = [];
  const routeLines: string[] = [];

  for (const region of page.regions) {
    let frags;
    if (region.behavior.kind === 'momentary') {
      frags = emitMomentary(region as Region & { behavior: MomentaryBehavior });
    } else if (region.behavior.kind === 'toggle') {
      frags = emitToggle(region as Region & { behavior: ToggleBehavior });
    } else if (region.behavior.kind === 'radio') {
      frags = emitRadio(region as Region & { behavior: RadioBehavior });
    } else if (region.behavior.kind === 'range') {
      frags = emitRange(region as Region & { behavior: RangeBehavior });
    } else {
      throw new Error(
        `Recipe "${region.behavior.kind}" not yet implemented (region "${region.name}")`,
      );
    }
    // stateInit may be multi-line (Range needs 5 state fields).
    // Indent each line for the state table.
    stateInits.push(
      frags.stateInit
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
    declarations.push(frags.declarations);
    drawBlocks.push(frags.drawBlock);
    routeLines.push(...frags.routeAdditions);
  }

  return [
    emitHeader(layout),
    '',
    'local W, H = grid_size_x(), grid_size_y()',
    '',
    '-- ---- state ----',
    'local state = {',
    stateInits.join('\n'),
    '}',
    '',
    declarations.join('\n\n'),
    '',
    '-- ---- LED draw ----',
    'local function redraw()',
    '  grid_led_all(0)',
    drawBlocks.join('\n'),
    '  grid_refresh()',
    'end',
    '',
    '-- ---- dispatch ----',
    'local _route = {}',
    routeLines.join('\n'),
    '',
    'function event_grid(x, y, z)',
    '  local h = _route[x + y*W]',
    '  if h then h(x, y, z) end',
    '  redraw()',
    'end',
    '',
    '-- ---- init ----',
    'redraw()',
    '',
  ].join('\n');
}
