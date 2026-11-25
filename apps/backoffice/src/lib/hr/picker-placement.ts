// Where to put a cell's dropdown (the roster shift picker) so ALL of it sits
// inside the visible viewport. The popup scrolls internally, so its max
// height is the room it actually has — never more — which keeps its last
// item (e.g. the custom-hours Save button) reachable. The page behind can't
// scroll while the picker's overlay is open, so anything below the fold
// would be unreachable.
export type PickerPlacement = { top: number; left: number; maxHeight: number };

export function placePicker(
  cell: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
  opts: { width?: number; preferredMax?: number; margin?: number; gap?: number } = {},
): PickerPlacement {
  const width = opts.width ?? 224;
  const margin = opts.margin ?? 8;
  const gap = opts.gap ?? 4;
  const preferred = Math.min(viewport.height * 0.7, opts.preferredMax ?? 480);
  const left = Math.max(margin, Math.min(cell.left, viewport.width - width - margin));
  const spaceBelow = viewport.height - cell.bottom - gap - margin;
  const spaceAbove = cell.top - gap - margin;

  let top: number;
  let maxHeight: number;
  if (spaceBelow < preferred && spaceAbove > spaceBelow) {
    maxHeight = Math.min(preferred, spaceAbove);
    top = cell.top - gap - maxHeight;
  } else {
    top = cell.bottom + gap;
    maxHeight = Math.min(preferred, spaceBelow);
  }
  if (maxHeight < 200) {
    // Little room on either side (cell near an edge of a short screen): pin
    // the popup inside the viewport, over the cell if need be.
    maxHeight = Math.min(preferred, viewport.height - 2 * margin);
    top = Math.min(Math.max(margin, top), viewport.height - margin - maxHeight);
  }
  top = Math.max(margin, top);
  maxHeight = Math.min(maxHeight, viewport.height - margin - top);
  return { top, left, maxHeight };
}
