"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, Square, Circle } from "lucide-react";

/**
 * Visual floor-plan table layout editor.
 *
 * Each floor is a canvas; tables are draggable tiles positioned by a normalised
 * (0..1) centre coordinate so the same layout scales to any screen — the POS
 * register renders the identical positions. A table carries a label, optional
 * seats, and a square/round shape.
 *
 * Stored shape (pos_branch_settings.table_layout jsonb):
 *   [{ name: "Indoor", tables: [{ label, seats, x, y, shape }] }]
 * Legacy string `tables` ("1, 2, 3") is auto-migrated to a grid on load.
 */

export type TableShape = "square" | "round";
export type TableOrient = "h" | "v";
export type TableItem = { label: string; seats: number | null; x: number; y: number; shape: TableShape; orientation: TableOrient };
export type Floor = { name: string; tables: TableItem[] };

type RawFloor = { name?: string; tables?: unknown };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 16-cell grid: drags snap to these lines so tables auto-align into neat rows /
 *  columns instead of landing freeform. The faint canvas gridlines match this. */
/** Fine, SQUARE alignment grid (px) — graph-paper cells. Both the drag-snap and
 *  the faint canvas gridlines use this exact size, so what you see is what you
 *  snap to. Square (equal px on both axes), unlike the old 1/16-per-axis grid
 *  that drew wide ~53×29px rectangles and never let tables line up cleanly. */
const CELL = 14;
/** Snap a normalised coord to the px grid for the given canvas span (px). */
const snapNorm = (norm: number, span: number) =>
  span ? (Math.round((norm * span) / CELL) * CELL) / span : norm;
/** Magnetic alignment: while dragging, a table's centre OR an edge snaps to a
 *  sibling's centre / matching edge when within this many px, and a guide line is
 *  drawn. This is what actually makes rows + columns line up across mixed table
 *  sizes — the grid alone can't, since it only snaps to fixed cells. */
const SNAP_PX = 10;

/** Tile size (px) scaled to seat count — a 6-top reads bigger than a 2-top, so
 *  the floor plan shows table CAPACITY at a glance. Mirrors the register. */
function tableDims(seats: number | null, shape: TableShape, orientation: TableOrient): { w: number; h: number; cells: number; vertical: boolean } {
  const s = seats ?? 4;
  if (shape === "round") {
    const d = s <= 2 ? 46 : s <= 4 ? 60 : s <= 6 ? 76 : 92;
    return { w: d, h: d, cells: 1, vertical: false };
  }
  // Square seats render as ATTACHED 2-tops pushed together: a 4-pax = two
  // squares, a 6-pax = three — laid out horizontally or vertically.
  const cells = s <= 2 ? 1 : s <= 4 ? 2 : s <= 6 ? 3 : 4;
  const unit = 44;
  const vertical = orientation === "v";
  return { w: vertical ? unit : unit * cells, h: vertical ? unit * cells : unit, cells, vertical };
}

/** Accept the stored value (positioned objects OR a legacy comma string) and
 *  return clean Floors. Legacy strings get auto-arranged into a grid. */
export function normalizeFloors(value: unknown): Floor[] {
  if (!Array.isArray(value)) return [];
  return (value as RawFloor[]).map((f) => {
    const name = (typeof f?.name === "string" && f.name.trim()) || "Floor";
    let tables: TableItem[] = [];
    if (Array.isArray(f?.tables)) {
      tables = (f.tables as Record<string, unknown>[]).map((t, i) => ({
        label: String(t?.label ?? i + 1),
        seats: Number.isFinite(Number(t?.seats)) && Number(t?.seats) > 0 ? Number(t?.seats) : null,
        x: clamp(Number(t?.x), 0.04, 0.96) || 0.5,
        y: clamp(Number(t?.y), 0.06, 0.94) || 0.5,
        shape: t?.shape === "round" ? "round" : "square",
        orientation: t?.orientation === "v" ? "v" : "h",
      }));
    } else if (typeof f?.tables === "string") {
      // Legacy "1:2, 2:4" → grid them out.
      const toks = f.tables.split(",").map((s) => s.trim()).filter(Boolean);
      const cols = Math.max(1, Math.ceil(Math.sqrt(toks.length)));
      tables = toks.map((tok, i) => {
        const [label, seatsRaw] = tok.split(":");
        const seats = parseInt((seatsRaw ?? "").trim(), 10);
        return {
          label: (label ?? "").trim() || String(i + 1),
          seats: Number.isFinite(seats) && seats > 0 ? seats : null,
          x: clamp(0.12 + (i % cols) * (0.76 / Math.max(1, cols - 1 || 1)), 0.08, 0.92),
          y: clamp(0.15 + Math.floor(i / cols) * 0.22, 0.1, 0.9),
          shape: "square" as TableShape,
          orientation: "h" as TableOrient,
        };
      });
    }
    return { name, tables };
  });
}

export function TableLayoutEditor({ value, onChange }: { value: unknown; onChange: (floors: Floor[]) => void }) {
  const floors = normalizeFloors(value);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ idx: number; moved: boolean } | null>(null);
  // Alignment guide lines drawn while dragging (normalised 0..1, or null = none).
  const [guide, setGuide] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const floor = floors[active];

  function commit(next: Floor[]) { onChange(next); }
  function patchFloor(patch: Partial<Floor>) {
    const next = floors.map((f, i) => (i === active ? { ...f, ...patch } : f));
    commit(next);
  }
  function patchTable(idx: number, patch: Partial<TableItem>) {
    if (!floor) return;
    patchFloor({ tables: floor.tables.map((t, i) => (i === idx ? { ...t, ...patch } : t)) });
  }

  function nextLabel(): string {
    const nums = floors.flatMap((f) => f.tables.map((t) => parseInt(t.label, 10)).filter((n) => !isNaN(n)));
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  }
  /** Add a table of a given capacity. New tiles auto-place on the next free grid
   *  cell (rows of 8) so they start aligned; pass a smart default shape. */
  function addTable(seats: number | null, shape: TableShape = "square") {
    if (!floor) return;
    const n = floor.tables.length;
    const c = canvasRef.current?.getBoundingClientRect();
    const cols = 8;
    let x = 0.1 + (n % cols) * 0.1;
    let y = 0.16 + Math.floor(n / cols) * 0.16;
    if (c) { x = snapNorm(x, c.width); y = snapNorm(y, c.height); }
    const t: TableItem = { label: nextLabel(), seats, x: clamp(x, 0.04, 0.96), y: clamp(y, 0.06, 0.94), shape, orientation: "h" };
    patchFloor({ tables: [...floor.tables, t] });
    setSelected(n);
  }
  function deleteTable(idx: number) {
    if (!floor) return;
    patchFloor({ tables: floor.tables.filter((_, i) => i !== idx) });
    setSelected(null);
  }
  function addFloor() {
    const next = [...floors, { name: `Floor ${floors.length + 1}`, tables: [] }];
    commit(next);
    setActive(next.length - 1);
    setSelected(null);
  }
  function removeFloor() {
    const next = floors.filter((_, i) => i !== active);
    commit(next);
    setActive((a) => Math.max(0, a - 1));
    setSelected(null);
  }

  // ── Drag handlers (pointer-capture so a fast drag outside the tile keeps tracking) ──
  function onTilePointerDown(e: React.PointerEvent, idx: number) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { idx, moved: false };
    setSelected(idx);
  }
  function onTilePointerMove(e: React.PointerEvent, idx: number) {
    if (!drag.current || drag.current.idx !== idx) return;
    const c = canvasRef.current?.getBoundingClientRect();
    if (!c || !floor) return;
    drag.current.moved = true;

    // Raw pointer position (normalised), then magnetically align to siblings.
    const px = clamp((e.clientX - c.left) / c.width, 0.04, 0.96);
    const py = clamp((e.clientY - c.top) / c.height, 0.06, 0.94);

    // The dragged tile's half-extents (so we can align its edges, not just centre).
    const me = floor.tables[idx];
    const dd = tableDims(me.seats, me.shape, me.orientation);
    const hwD = dd.w / 2 / c.width, hhD = dd.h / 2 / c.height;
    const offX = [0, -hwD, hwD], offY = [0, -hhD, hhD]; // centre, near edge, far edge

    let nx = px, ny = py;
    let gx: number | null = null, gy: number | null = null;
    let bestX = SNAP_PX / c.width, bestY = SNAP_PX / c.height;

    // Compare every (my ref point × sibling ref point) pair; keep the closest
    // within threshold per axis. cand = the centre that makes the two meet.
    floor.tables.forEach((t, i) => {
      if (i === idx) return;
      const sd = tableDims(t.seats, t.shape, t.orientation);
      const hwS = sd.w / 2 / c.width, hhS = sd.h / 2 / c.height;
      const sX = [t.x, t.x - hwS, t.x + hwS], sY = [t.y, t.y - hhS, t.y + hhS];
      for (const dr of offX) for (const sr of sX) {
        const cand = sr - dr, err = Math.abs(px - cand);
        if (err < bestX) { bestX = err; nx = cand; gx = sr; }
      }
      for (const dr of offY) for (const sr of sY) {
        const cand = sr - dr, err = Math.abs(py - cand);
        if (err < bestY) { bestY = err; ny = cand; gy = sr; }
      }
    });

    // No sibling magnet on an axis → fall back to the square grid so free
    // placement still lands tidy instead of pixel-freeform.
    if (gx === null) nx = snapNorm(nx, c.width);
    if (gy === null) ny = snapNorm(ny, c.height);

    setGuide({ x: gx, y: gy });
    patchTable(idx, { x: clamp(nx, 0.04, 0.96), y: clamp(ny, 0.06, 0.94) });
  }
  function onTilePointerUp(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current = null;
    setGuide({ x: null, y: null });
  }

  return (
    <div className="space-y-3">
      {/* Floor tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {floors.map((f, i) => (
          <button
            key={i}
            onClick={() => { setActive(i); setSelected(null); }}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              i === active ? "border-[#160800] bg-[#160800] text-white" : "border-gray-200 bg-white text-gray-700 hover:border-[#160800]"
            }`}
          >
            {f.name || `Floor ${i + 1}`}
          </button>
        ))}
        <button onClick={addFloor} className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-semibold text-[#A2492C] hover:border-[#A2492C]">
          <Plus className="h-3.5 w-3.5" /> Floor
        </button>
      </div>

      {floor ? (
        <>
          {/* Floor name + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={floor.name}
              onChange={(e) => patchFloor({ name: e.target.value })}
              placeholder="Floor name"
              className="h-9 w-44 rounded-lg border border-gray-200 px-3 text-sm text-[#160800] outline-none focus:border-[#160800]"
            />
            <span className="text-xs font-medium text-gray-500">Add table:</span>
            <button onClick={() => addTable(2, "round")} title="2-seater (round bistro)" className="flex items-center gap-1 rounded-lg bg-[#160800] px-2.5 py-2 text-xs font-semibold text-white hover:bg-[#2d1100]">
              <Plus className="h-3.5 w-3.5" /> 2 pax
            </button>
            <button onClick={() => addTable(4, "square")} title="4-seater" className="flex items-center gap-1 rounded-lg bg-[#160800] px-2.5 py-2 text-xs font-semibold text-white hover:bg-[#2d1100]">
              <Plus className="h-3.5 w-3.5" /> 4 pax
            </button>
            <button onClick={() => addTable(6, "square")} title="6-seater (large)" className="flex items-center gap-1 rounded-lg bg-[#160800] px-2.5 py-2 text-xs font-semibold text-white hover:bg-[#2d1100]">
              <Plus className="h-3.5 w-3.5" /> 6 pax
            </button>
            {floors.length > 1 && (
              <button onClick={removeFloor} className="ml-auto flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-red-500 hover:text-red-700">
                <Trash2 className="h-3.5 w-3.5" /> Remove floor
              </button>
            )}
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            className="relative w-full overflow-hidden rounded-xl border border-gray-200 bg-white"
            style={{
              height: 460,
              touchAction: "none",
              // Fine SQUARE alignment grid (matches the drag snap) so the room
              // reads like graph paper and tables line up cleanly.
              backgroundImage:
                "linear-gradient(to right, rgba(22,8,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(22,8,0,0.06) 1px, transparent 1px)",
              backgroundSize: `${CELL}px ${CELL}px`,
            }}
            onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
          >
            {floor.tables.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                Tap &ldquo;Add table&rdquo;, then drag tables to match your floor.
              </div>
            )}
            {/* Live alignment guides — show the line a dragged table snapped to. */}
            {guide.x != null && <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-[#A2492C]" style={{ left: `${guide.x * 100}%` }} />}
            {guide.y != null && <div className="pointer-events-none absolute left-0 right-0 z-20 h-px bg-[#A2492C]" style={{ top: `${guide.y * 100}%` }} />}
            {floor.tables.map((t, idx) => {
              const dim = tableDims(t.seats, t.shape, t.orientation);
              return (
              <div
                key={idx}
                onPointerDown={(e) => onTilePointerDown(e, idx)}
                onPointerMove={(e) => onTilePointerMove(e, idx)}
                onPointerUp={onTilePointerUp}
                className={`absolute flex cursor-grab select-none flex-col items-center justify-center border text-center shadow-sm active:cursor-grabbing ${
                  t.shape === "round" ? "rounded-full" : "rounded-lg"
                } ${selected === idx ? "border-[#A2492C] ring-2 ring-[#A2492C]/30" : "border-[#160800]/30"}`}
                style={{
                  left: `${t.x * 100}%`, top: `${t.y * 100}%`, transform: "translate(-50%, -50%)",
                  width: dim.w, height: dim.h, backgroundColor: "#fff",
                }}
              >
                {/* Divider lines between the attached 2-tops (square tables only). */}
                {t.shape !== "round" && dim.cells > 1 && Array.from({ length: dim.cells - 1 }).map((_, i) =>
                  dim.vertical
                    ? <div key={i} className="absolute left-1 right-1 h-px bg-[#160800]/15" style={{ top: `${((i + 1) / dim.cells) * 100}%` }} />
                    : <div key={i} className="absolute top-1 bottom-1 w-px bg-[#160800]/15" style={{ left: `${((i + 1) / dim.cells) * 100}%` }} />
                )}
                <div className="relative z-10 flex flex-col items-center leading-none">
                  <span className="text-sm font-bold text-[#160800]">{t.label}</span>
                  {t.seats != null && <span className="text-[9px] text-gray-500">{t.seats}p</span>}
                </div>
              </div>
              );
            })}
          </div>

          {/* Selected table editor */}
          {selected != null && floor.tables[selected] && (
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Table</label>
                <input
                  value={floor.tables[selected].label}
                  onChange={(e) => patchTable(selected, { label: e.target.value })}
                  className="h-9 w-24 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#160800]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Seats</label>
                <input
                  type="number" min={0}
                  value={floor.tables[selected].seats ?? ""}
                  onChange={(e) => patchTable(selected, { seats: e.target.value === "" ? null : Number(e.target.value) })}
                  className="h-9 w-20 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#160800]"
                  placeholder="—"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Shape</label>
                <div className="flex gap-1">
                  <button onClick={() => patchTable(selected, { shape: "square" })}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border ${floor.tables[selected].shape === "square" ? "border-[#160800] bg-[#160800] text-white" : "border-gray-200 text-gray-500"}`}>
                    <Square className="h-4 w-4" />
                  </button>
                  <button onClick={() => patchTable(selected, { shape: "round" })}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border ${floor.tables[selected].shape === "round" ? "border-[#160800] bg-[#160800] text-white" : "border-gray-200 text-gray-500"}`}>
                    <Circle className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Orient</label>
                <div className="flex gap-1">
                  <button onClick={() => patchTable(selected, { orientation: "h" })} title="Horizontal — join left to right"
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg ${floor.tables[selected].orientation === "h" ? "border-[#160800] bg-[#160800] text-white" : "border-gray-200 text-gray-500"}`}>↔</button>
                  <button onClick={() => patchTable(selected, { orientation: "v" })} title="Vertical — stack top to bottom"
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg ${floor.tables[selected].orientation === "v" ? "border-[#160800] bg-[#160800] text-white" : "border-gray-200 text-gray-500"}`}>↕</button>
                </div>
              </div>
              <button onClick={() => deleteTable(selected)} className="ml-auto flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-red-500 hover:text-red-700">
                <Trash2 className="h-3.5 w-3.5" /> Delete table
              </button>
            </div>
          )}
        </>
      ) : (
        <button onClick={addFloor} className="flex items-center gap-1.5 rounded-lg bg-[#160800] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2d1100]">
          <Plus className="h-3.5 w-3.5" /> Add your first floor
        </button>
      )}
    </div>
  );
}
