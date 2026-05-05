import type {
  GridLayout,
  MeterBehavior,
  MomentaryBehavior,
  NoteKeyboardBehavior,
  RadioBehavior,
  RangeBehavior,
  Region,
  StepSequencerBehavior,
  ToggleBehavior,
} from './types.ts';
import { emitHeader } from './header.ts';
import { emitMeter } from './recipes/meter.ts';
import { emitMomentary } from './recipes/momentary.ts';
import { emitNoteKeyboard } from './recipes/note-keyboard.ts';
import { emitRadio } from './recipes/radio.ts';
import { emitRange } from './recipes/range.ts';
import { emitStepSequencer } from './recipes/step-sequencer.ts';
import { emitToggle } from './recipes/toggle.ts';

/**
 * Compile a GridLayout to an iii Lua script.
 *
 * Pure function: same input always yields byte-identical output. Output
 * stability is part of the public contract — see vault
 * `notes/engineering-kickoff.md` "Project-specific addenda".
 *
 * Step 8 (v0 complete): all seven recipes are implemented —
 *   momentary, toggle, radio, range, meter, note_keyboard, step_sequencer
 * The dispatch is an exhaustive switch with a `never` check, so adding
 * a new behavior kind without a matching case fails type-check.
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
  const initLines: string[] = [];

  for (const region of page.regions) {
    let frags;
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
      default: {
        // Exhaustive check — adding a new behavior kind without a case
        // here fails type-check.
        const _exhaustive: never = region.behavior;
        throw new Error(
          `Unhandled behavior kind: ${(_exhaustive as { kind: string }).kind}`,
        );
      }
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
    if (frags.initLines) initLines.push(...frags.initLines);
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
    declarations.join('\n\n'),
    '',
    '-- ---- LED draw ----',
    'local function redraw()',
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
    'grid_led_all(0)',
    ...initLines,
    'redraw()',
    '',
  ].join('\n');
}
