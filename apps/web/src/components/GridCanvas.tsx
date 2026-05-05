import { For, onCleanup } from 'solid-js';
import {
  ACTIVE_FILL,
  findRegionForCell,
  regionColor,
} from '../store/regions.ts';
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

// Visual constants. monome aesthetic: matte black background. Cells are
// either dim (idle, #1a1a1a) or warm-amber (active editing). Saved
// regions get their own pastel palette colour so the user can see at a
// glance which cells belong to which region.
const CELL_SIZE = 36;
const CELL_GAP = 4;
const CELL_RADIUS = 4;

const SVG_W = COLS * CELL_SIZE + (COLS - 1) * CELL_GAP;
const SVG_H = ROWS * CELL_SIZE + (ROWS - 1) * CELL_GAP;

const CELLS: { x: number; y: number }[] = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    CELLS.push({ x, y });
  }
}

const FILL_IDLE = '#1a1a1a';
const FILL_DRAG_PREVIEW = '#5a5240';

function fillFor(x: number, y: number): string {
  // 1. Drag preview (highest priority while a gesture is in progress).
  const d = drag();
  if (d && isCellInDrag(x, y)) {
    if (d.shift) {
      // Additive gesture: already-selected cells stay amber; cells
      // about to be added glow medium so the preview is distinguishable.
      return isCellSelected(x, y) ? ACTIVE_FILL : FILL_DRAG_PREVIEW;
    }
    return ACTIVE_FILL;
  }
  // 2. Active editing selection (overrides saved regions so the user
  //    can see what they're working on, even if some cells overlap a
  //    saved region — those will be auto-excluded on Add Region).
  if (isCellSelected(x, y)) {
    return ACTIVE_FILL;
  }
  // 3. Saved region — the cell shows its region's palette colour.
  const region = findRegionForCell(x, y);
  if (region) {
    return regionColor(region);
  }
  return FILL_IDLE;
}

export function GridCanvas() {
  // Commit the drag on pointer up *anywhere* on the page — listening
  // on the window, not the wrapper, means the gesture survives the
  // user briefly leaving the grid (and re-entering) mid-drag, and
  // still finishes cleanly if they release the mouse outside.
  // Cancellation events (pointercancel) also commit; the in-progress
  // rect snapshot is what we want to keep in that case anyway.
  const onWindowUp = () => {
    if (drag()) commitDrag();
  };
  window.addEventListener('pointerup', onWindowUp);
  window.addEventListener('pointercancel', onWindowUp);
  onCleanup(() => {
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('pointercancel', onWindowUp);
  });

  return (
    <div class="select-none touch-none">
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
              fill={fillFor(c.x, c.y)}
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
