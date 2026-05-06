import type { PageSelectBehavior, Region } from '../types.ts';
import { luaIdent, luaKey, luaXY } from '../lua-coords.ts';
import type { EmittedFragments } from './momentary.ts';

type PageSelectRegion = Region & { behavior: PageSelectBehavior };

/**
 * page_select — a "global" region that lives outside the per-page
 * region grouping. Its cells are routed and rendered on EVERY page
 * (so the user can always switch back), and their behaviour is to
 * change `state.page`.
 *
 * Cells map to page indices by their natural sort order
 * (top-to-bottom, left-to-right). Cells whose target index is past
 * the end of the layout's page list render at `led_unused` and
 * silently no-op on press. The active page's cell is `led_active`;
 * other valid pages render at `led_inactive`.
 *
 * The actual `state.page` mutation, _prev_led / grid_led_all reset,
 * and redraw call all happen inside the helper this region declares;
 * see emit.ts for how the per-page route + draw blocks are wired.
 */
export function emitPageSelect(
  region: PageSelectRegion,
  numPages: number,
): EmittedFragments {
  const params = region.behavior.params;
  const name = luaIdent(region.name);
  const handlerName = `handle_${name}`;
  const targetTable = `_${name}_target`;

  const sortedCells = [...region.cells].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );

  // Per-cell target page index. We always store the index even for
  // out-of-range cells so the renderer can check it; the handler
  // gates on `target < numPages` to ignore presses on unused cells.
  const targetLines = sortedCells
    .map((c, i) => `${targetTable}[${luaKey(c)}] = ${i}`)
    .join('\n');

  const declarations = [
    `-- ---- region: ${name} (page_select) ----`,
    `local ${targetTable} = {}`,
    targetLines,
    '',
    `local function ${handlerName}(x, y, z)`,
    '  if z ~= 1 then return end',
    `  local target = ${targetTable}[x + y*W]`,
    `  if target == nil or target >= ${numPages} then return end`,
    `  if target == state.page then return end`,
    `  state.page = target`,
    "  -- Force a full repaint on the new page. We need to (a) clear",
    "  -- the LED delta cache so cells from the OLD page that the NEW",
    "  -- page doesn't paint are detected as deltas the next time",
    "  -- something writes them, and (b) blank the actual hardware",
    "  -- LEDs so cells the new page never touches are dark.",
    "  --",
    "  -- Reassigning _prev_led to a fresh table is safer across iii",
    "  -- Lua versions than mutating during pairs() iteration; the",
    "  -- closure inside grid_led picks up the new table via upvalue.",
    "  -- grid_refresh() is called after grid_led_all(0) to push the",
    "  -- blank state to hardware in case grid_led_all is buffered.",
    `  _prev_led = {}`,
    `  grid_led_all(0)`,
    `  grid_refresh()`,
    `  redraw()`,
    'end',
  ].join('\n');

  // LED draw: per cell, brightness depends on whether its target
  // index matches state.page (active), is a valid other page
  // (inactive), or is past the end (unused).
  const ledLines = sortedCells
    .map((c, i) => {
      if (i >= numPages) {
        return `  grid_led(${luaXY(c)}, ${params.led_unused})`;
      }
      return `  grid_led(${luaXY(c)}, state.page == ${i} and ${params.led_active} or ${params.led_inactive})`;
    })
    .join('\n');

  const drawBlock = [`  -- region: ${name}`, ledLines].join('\n');

  // Routing: all cells dispatch to handlerName.
  const routeAdditions = sortedCells.map(
    (c) => `_route_global[${luaKey(c)}] = ${handlerName}`,
  );

  // No state init — page_select uses state.page which lives at the
  // top-level state declaration in emit.ts.
  const stateInit = '';

  return {
    stateInit,
    declarations,
    drawBlock,
    routeAdditions,
  };
}
