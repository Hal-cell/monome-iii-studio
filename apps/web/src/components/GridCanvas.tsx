import { For } from 'solid-js';
import {
  COLS,
  ROWS,
  commitDrag,
  drag,
  isCellInDrag,
  isCellSelected,
  startDrag,
  updateDrag,
} from '../store/selection.ts';

// Visual constants. monome aesthetic: matte black background, warm
// amber-white "lit" cells, dark gray "unlit" cells. No borders.
const CELL_SIZE = 36;
const CELL_GAP = 4;
const CELL_RADIUS = 4;

const SVG_W = COLS * CELL_SIZE + (COLS - 1) * CELL_GAP;
const SVG_H = ROWS * CELL_SIZE + (ROWS - 1) * CELL_GAP;

// Pre-compute the cell list (static for v0).
const CELLS: { x: number; y: number }[] = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    CELLS.push({ x, y });
  }
}

const FILL_IDLE = '#1a1a1a';
const FILL_SELECTED = '#fbf2d4';
const FILL_DRAG_PREVIEW = '#5a5240';

function fillFor(selected: boolean, inDrag: boolean, dragShift: boolean): string {
  if (inDrag) {
    if (dragShift) {
      // Additive preview: cells already selected stay bright; others
      // glow midway to suggest "will be added".
      return selected ? FILL_SELECTED : FILL_DRAG_PREVIEW;
    }
    // Non-shift drag previews the rect as the new selection.
    return FILL_SELECTED;
  }
  return selected ? FILL_SELECTED : FILL_IDLE;
}

export function GridCanvas() {
  // Commit the gesture on any pointer release. Also commit if the
  // pointer leaves the SVG entirely so a half-completed gesture does
  // not linger when the user releases outside.
  const onUp = () => commitDrag();

  return (
    <div
      class="select-none touch-none"
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
    >
      <svg
        width={SVG_W}
        height={SVG_H}
        class="block"
        role="application"
        aria-label="monome grid 16 by 8"
      >
        <For each={CELLS}>
          {(c) => (
            <rect
              x={c.x * (CELL_SIZE + CELL_GAP)}
              y={c.y * (CELL_SIZE + CELL_GAP)}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={CELL_RADIUS}
              ry={CELL_RADIUS}
              fill={fillFor(
                isCellSelected(c.x, c.y),
                isCellInDrag(c.x, c.y),
                drag()?.shift ?? false,
              )}
              onPointerDown={(e) => {
                e.preventDefault();
                startDrag(c.x, c.y, e.shiftKey);
              }}
              onPointerEnter={() => updateDrag(c.x, c.y)}
              style={{ cursor: 'pointer' }}
            />
          )}
        </For>
      </svg>
    </div>
  );
}
