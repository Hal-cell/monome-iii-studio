import type {
  GridLayout,
  LfoBehavior,
  MeterBehavior,
  MomentaryBehavior,
  NoteKeyboardBehavior,
  NoteMonitorBehavior,
  PageSelectBehavior,
  RadioBehavior,
  RangeBehavior,
  Region,
  StepSequencerBehavior,
  ToggleBehavior,
  WakeSequencerBehavior,
} from './types.ts';
import { emitHeader } from './header.ts';
import { emitLfo } from './recipes/lfo.ts';
import { emitMeter } from './recipes/meter.ts';
import { emitMomentary } from './recipes/momentary.ts';
import { emitNoteKeyboard } from './recipes/note-keyboard.ts';
import { emitNoteMonitor } from './recipes/note-monitor.ts';
import { emitPageSelect } from './recipes/page-select.ts';
import { emitRadio } from './recipes/radio.ts';
import { emitRange } from './recipes/range.ts';
import { emitStepSequencer } from './recipes/step-sequencer.ts';
import { emitToggle } from './recipes/toggle.ts';
import { emitWakeSequencer } from './recipes/wake-sequencer.ts';

/**
 * Compile a GridLayout to an iii Lua script.
 *
 * Pure function: same input always yields byte-identical output.
 * Output stability is part of the public contract.
 *
 * Supports any number of pages. Each region is either page-scoped
 * (rendered + dispatched only when its page is active) or global
 * (always active, regardless of state.page). page_select is the
 * sole global recipe today — it's the mechanism for switching
 * pages. State.page tracks the active page index; on press of a
 * page_select cell the per-page route table changes and the LED
 * delta cache is invalidated for a clean repaint.
 */
export function emit(layout: GridLayout): string {
  if (layout.pages.length < 1) {
    throw new Error('layout must have at least one page');
  }
  const numPages = layout.pages.length;

  // Per-region output collectors.
  const stateInits: string[] = [];
  const declarations: string[] = [];
  const initLines: string[] = [];
  const midiHandlerNames: string[] = [];

  // Globally-scoped (rendered + dispatched on every page).
  const globalDrawBlocks: string[] = [];
  const globalRouteLines: string[] = [];

  // Page-scoped: parallel arrays indexed by page index.
  const pageDrawBlocks: string[][] = Array.from({ length: numPages }, () => []);
  const pageRouteLines: string[][] = Array.from({ length: numPages }, () => []);

  for (let pi = 0; pi < numPages; pi++) {
    const page = layout.pages[pi]!;
    for (const region of page.regions) {
      let frags;
      let isGlobal = false;
      switch (region.behavior.kind) {
        case 'momentary':
          frags = emitMomentary(region as Region & { behavior: MomentaryBehavior });
          break;
        case 'toggle':
          frags = emitToggle(region as Region & { behavior: ToggleBehavior });
          break;
        case 'radio':
          frags = emitRadio(region as Region & { behavior: RadioBehavior });
          break;
        case 'range':
          frags = emitRange(region as Region & { behavior: RangeBehavior });
          break;
        case 'meter':
          frags = emitMeter(region as Region & { behavior: MeterBehavior });
          break;
        case 'note_keyboard':
          frags = emitNoteKeyboard(
            region as Region & { behavior: NoteKeyboardBehavior },
          );
          break;
        case 'step_sequencer':
          frags = emitStepSequencer(
            region as Region & { behavior: StepSequencerBehavior },
          );
          break;
        case 'wake_sequencer':
          frags = emitWakeSequencer(
            region as Region & { behavior: WakeSequencerBehavior },
          );
          break;
        case 'lfo':
          frags = emitLfo(region as Region & { behavior: LfoBehavior });
          break;
        case 'note_monitor':
          frags = emitNoteMonitor(
            region as Region & { behavior: NoteMonitorBehavior },
          );
          break;
        case 'page_select':
          frags = emitPageSelect(
            region as Region & { behavior: PageSelectBehavior },
            numPages,
          );
          isGlobal = true;
          break;
        default: {
          const _exhaustive: never = region.behavior;
          throw new Error(
            `Unhandled behavior kind: ${(_exhaustive as { kind: string }).kind}`,
          );
        }
      }
      // stateInit may be multi-line; indent each line for the
      // top-level state table.
      if (frags.stateInit) {
        stateInits.push(
          frags.stateInit
            .split('\n')
            .map((l) => `  ${l}`)
            .join('\n'),
        );
      }
      declarations.push(frags.declarations);
      if (frags.initLines) initLines.push(...frags.initLines);
      if (frags.midiHandler) midiHandlerNames.push(frags.midiHandler);

      if (isGlobal) {
        globalDrawBlocks.push(frags.drawBlock);
        globalRouteLines.push(...frags.routeAdditions);
      } else {
        pageDrawBlocks[pi]!.push(frags.drawBlock);
        // Recipes write their route lines as `_route[k] = handler`;
        // we rename them per-page so each page has its own route
        // table. page_select uses `_route_global` directly and is
        // not rewritten here (it goes through the isGlobal branch).
        pageRouteLines[pi]!.push(
          ...frags.routeAdditions.map((l) =>
            l.replace(/_route\[/g, `_route_p${pi}[`),
          ),
        );
      }
    }
  }

  // ---- assemble output ----

  // Initial state always includes `page = 0` so multi-page logic
  // below has a defined starting point. Single-page layouts pay one
  // unused field, which is fine.
  const stateBlock = ['local state = {', `  page = 0,`, ...stateInits, '}'].join('\n');

  // Per-page draw functions. Each one is a closure that paints just
  // its own regions; the master redraw() calls the active one.
  const perPageDrawFunctions = pageDrawBlocks
    .map((blocks, pi) => {
      const body = blocks.length > 0 ? blocks.join('\n') : '  -- (no regions)';
      return [`local function _draw_p${pi}()`, body, 'end'].join('\n');
    })
    .join('\n\n');

  // Master redraw: paint global cells (page_select), then dispatch
  // to the active page's draw function, then refresh.
  const redrawDispatch =
    numPages > 1
      ? pageDrawBlocks
          .map((_, pi) =>
            pi === 0
              ? `  if state.page == 0 then _draw_p0()`
              : `  elseif state.page == ${pi} then _draw_p${pi}()`,
          )
          .join('\n') + '\n  end'
      : `  _draw_p0()`;

  const redrawBlock = [
    'redraw = function()',
    globalDrawBlocks.length > 0 ? globalDrawBlocks.join('\n') : '',
    redrawDispatch,
    '  grid_refresh()',
    'end',
  ]
    .filter((s) => s !== '')
    .join('\n');

  // Per-page route tables.
  const perPageRouteTables = pageRouteLines
    .map((lines, pi) => {
      return [`local _route_p${pi} = {}`, ...lines].join('\n');
    })
    .join('\n');

  // Global route table (page_select cells).
  const globalRouteTable = [
    `local _route_global = {}`,
    ...globalRouteLines,
  ].join('\n');

  // event_grid dispatch: global table first (page_select takes
  // priority — pressing a page-switch cell while on the same page
  // is intercepted by the page_select handler's own no-op check).
  // Then look up in the active page's route table.
  const routeArrayDecl =
    numPages > 1
      ? `local _routes = {[0]=_route_p0` +
        Array.from({ length: numPages - 1 }, (_, i) => `, [${i + 1}]=_route_p${i + 1}`).join('') +
        '}'
      : `local _routes = {[0]=_route_p0}`;

  const eventGridFn = [
    'function event_grid(x, y, z)',
    '  local k = x + y*W',
    '  -- global (page_select) handlers run first; they may switch state.page',
    '  local h = _route_global[k]',
    '  if h then',
    '    h(x, y, z)',
    '    redraw()',
    '    return',
    '  end',
    '  -- per-page dispatch',
    '  local route = _routes[state.page]',
    '  if route then',
    '    h = route[k]',
    '    if h then h(x, y, z) end',
    '  end',
    '  redraw()',
    'end',
  ].join('\n');

  // Optional MIDI dispatch — same as before.
  const midiDispatch =
    midiHandlerNames.length > 0
      ? [
          '',
          '-- ---- MIDI input dispatch ----',
          '-- iii calls event_midi(d1, d2, d3) on every incoming MIDI byte',
          '-- triple. Fan out to each region that registered a handler;',
          '-- redraw afterwards so any LED state mutations show up.',
          'function event_midi(d1, d2, d3)',
          ...midiHandlerNames.map((n) => `  ${n}(d1, d2, d3)`),
          '  redraw()',
          'end',
        ].join('\n')
      : '';

  return [
    emitHeader(layout),
    '',
    'local W, H = grid_size_x(), grid_size_y()',
    '',
    '-- ---- state ----',
    stateBlock,
    '',
    '-- ---- differential LED writes ----',
    "-- Wrap iii's grid_led so unchanged brightness is skipped. Calling",
    '-- grid_led_all(0) on every redraw makes the whole grid flicker dark',
    '-- when several keys are pressed in quick succession; instead we',
    '-- clear once at init and only push deltas after that. _prev_led is',
    '-- keyed the same way as our route table (1-indexed x + y*W). nil',
    '-- entries are treated as 0 so the first redraw skips zero-fills.',
    'local _real_grid_led = grid_led',
    'local _prev_led = {}',
    'local function grid_led(x, y, v)',
    '  local k = x + y*W',
    '  if (_prev_led[k] or 0) ~= v then',
    '    _real_grid_led(x, y, v)',
    '    _prev_led[k] = v',
    '  end',
    'end',
    '',
    '-- ---- forward declaration ----',
    '-- `redraw` is defined further down but is referenced from metro tick',
    '-- callbacks inside the region declarations below. Forward-declaring it',
    '-- here as a local makes each tick closure capture it as an upvalue, so',
    '-- the tick resolves the reference via the upvalue (which holds the',
    '-- assigned function once the script finishes loading) instead of',
    '-- falling through to a non-existent global.',
    'local redraw',
    '',
    declarations.join('\n\n'),
    '',
    '-- ---- per-page LED draw ----',
    perPageDrawFunctions,
    '',
    '-- ---- master redraw ----',
    redrawBlock,
    '',
    '-- ---- dispatch ----',
    globalRouteTable,
    '',
    perPageRouteTables,
    '',
    routeArrayDecl,
    '',
    eventGridFn,
    ...(midiDispatch ? [midiDispatch] : []),
    '',
    '-- ---- init ----',
    'grid_led_all(0)',
    ...initLines,
    'redraw()',
    '',
  ].join('\n');
}
