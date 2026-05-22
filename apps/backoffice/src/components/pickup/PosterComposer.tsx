"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X, RotateCcw, Plus, Trash2 } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

type Placement = "splash" | "home";

type TextLayer = {
  text: string;
  x: number;       // 0-1 normalised in frame width — anchor sits here
  y: number;       // 0-1 normalised in frame height — vertical centre
  color: string;   // #RRGGBB
  size: number;    // 0-1 normalised in frame height (e.g. 0.1 = 10% of frame H)
  align: "left" | "center" | "right";
};

type State = {
  bgZoom: number;
  bgPanX: number;  // normalised, 0 = centred
  bgPanY: number;
  tintColor: string;
  tintOpacity: number;  // 0-1
  headline: TextLayer;
  // Multiple supporting lines — operator can add/remove. AI generation
  // populates 1-3 depending on the objective.
  subheads: TextLayer[];
};

const DEFAULT_STATE: State = {
  bgZoom: 1,
  bgPanX: 0,
  bgPanY: 0,
  tintColor: "#160800",
  tintOpacity: 0.25,
  headline: {
    text: "Your headline",
    x: 0.5,
    y: 0.4,
    color: "#FFFFFF",
    size: 0.1,
    align: "center",
  },
  subheads: [
    {
      text: "A short supporting line goes here",
      x: 0.5,
      y: 0.52,
      color: "#F5F3F0",
      size: 0.035,
      align: "center",
    },
  ],
};

// Reserved zones the customer app overlays on top of every poster.
// Drawn as semi-transparent stripes in the preview so the operator
// places text in the safe area. Coordinates are normalised 0-1.
const RESERVED_ZONES: Record<Placement, Array<{
  x: number; y: number; w: number; h: number; label: string;
}>> = {
  home: [
    { x: 0.02, y: 0.01, w: 0.16, h: 0.10, label: "C logo" },
    { x: 0.82, y: 0.01, w: 0.16, h: 0.10, label: "Cart" },
    { x: 0.02, y: 0.74, w: 0.96, h: 0.24, label: "Info card" },
  ],
  splash: [
    { x: 0.78, y: 0.02, w: 0.20, h: 0.07, label: "Close ✕" },
    { x: 0.20, y: 0.93, w: 0.60, h: 0.05, label: "Tap to open" },
  ],
};

// Output canvas dimensions per placement. Keeps file sizes reasonable
// while matching the aspect that the customer app actually renders.
const OUTPUT: Record<Placement, { w: number; h: number; previewMax: { w: number; h: number } }> = {
  splash: { w: 1080, h: 1920, previewMax: { w: 270, h: 480 } },
  home:   { w: 1200, h: 1120, previewMax: { w: 380, h: 355 } },
};

type Props = {
  // Background image URL — already cropped to the placement aspect via
  // the existing PosterCropDialog upstream. Composer treats it as a
  // canvas to overlay tint + text on; it does not re-crop the aspect.
  bgUrl: string;
  placement: Placement;
  onCancel: () => void;
  // Returns a fresh JPEG File ready for upload via the existing
  // /api/pickup/upload-image route. Parent decides what to do with it.
  onSave: (file: File) => void;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Active layer selector. "bg" + "headline" are singletons; subheads
// carry the array index so the controls and drag target know exactly
// which one is being edited.
type Selected =
  | { kind: "bg" }
  | { kind: "headline" }
  | { kind: "subhead"; index: number };

export function PosterComposer({ bgUrl, placement, onCancel, onSave }: Props) {
  const [state, setState] = useState<State>(DEFAULT_STATE);
  const [objective, setObjective] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Selected>({ kind: "headline" });

  const frameRef = useRef<HTMLDivElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  // Hydrate the bg image into an Image element once so the canvas
  // raster can draw it without re-fetching.
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = bgUrl;
    img.onload = () => { bgImgRef.current = img; };
  }, [bgUrl]);

  const { w: OUT_W, h: OUT_H, previewMax } = OUTPUT[placement];

  // Live preview size — scales the OUT aspect to fit previewMax.
  const previewScale = Math.min(previewMax.w / OUT_W, previewMax.h / OUT_H);
  const previewW = Math.round(OUT_W * previewScale);
  const previewH = Math.round(OUT_H * previewScale);

  // --- Pointer-drag plumbing ----------------------------------------
  // One generic drag controller for bg and text layers. We capture
  // the pointer on the frame so drags can leave the layer's bbox
  // without losing focus. Subhead drags carry the array index.
  const dragRef = useRef<{
    target: Selected;
    startClientX: number;
    startClientY: number;
    startState: State;
  } | null>(null);

  const onPointerDown = (target: Selected, e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      target,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startState: state,
    };
    setSelected(target);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const dxN = (e.clientX - drag.startClientX) / rect.width;
    const dyN = (e.clientY - drag.startClientY) / rect.height;

    setState((s) => {
      const base = drag.startState;
      if (drag.target.kind === "bg") {
        return { ...s, bgPanX: base.bgPanX + dxN, bgPanY: base.bgPanY + dyN };
      }
      if (drag.target.kind === "headline") {
        return {
          ...s,
          headline: {
            ...s.headline,
            x: Math.max(0, Math.min(1, base.headline.x + dxN)),
            y: Math.max(0, Math.min(1, base.headline.y + dyN)),
          },
        };
      }
      const idx = drag.target.index;
      const baseLayer = base.subheads[idx];
      if (!baseLayer) return s;
      const updated = s.subheads.slice();
      updated[idx] = {
        ...updated[idx],
        x: Math.max(0, Math.min(1, baseLayer.x + dxN)),
        y: Math.max(0, Math.min(1, baseLayer.y + dyN)),
      };
      return { ...s, subheads: updated };
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  // --- AI generate --------------------------------------------------
  const generate = async () => {
    const trimmed = objective.trim();
    if (!trimmed) {
      toast.error("Type an objective first");
      return;
    }
    setGenerating(true);
    try {
      const res = await adminFetch("/api/pickup/ai-poster/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: bgUrl, objective: trimmed, placement }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Generate failed");
      const s = json.suggestion as {
        tintColor: string;
        tintOpacity: number;
        headline: TextLayer;
        subheads: TextLayer[];
      };
      setState((cur) => ({
        ...cur,
        tintColor:   s.tintColor,
        tintOpacity: s.tintOpacity,
        headline:    s.headline,
        subheads:    s.subheads.length > 0 ? s.subheads : cur.subheads,
      }));
      // If the active layer is a subhead index that no longer exists
      // (AI returned fewer than we had), fall back to subhead 0.
      setSelected((cur) => {
        if (cur.kind === "subhead" && cur.index >= s.subheads.length) {
          return { kind: "subhead", index: 0 };
        }
        return cur;
      });
      toast.success("Generated");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  };

  // --- Rasterise + save --------------------------------------------
  const handleSave = async () => {
    const img = bgImgRef.current;
    if (!img) {
      toast.error("Background still loading");
      return;
    }
    setSaving(true);
    try {
      // Make sure Peachi is loaded before drawing — text would otherwise
      // fall back to serif on first render.
      await Promise.all([
        document.fonts.load(`700 ${Math.round(state.headline.size * OUT_H)}px "Peachi"`),
        ...state.subheads.map((sh) =>
          document.fonts.load(`500 ${Math.round(sh.size * OUT_H)}px "Peachi"`),
        ),
      ]).catch(() => {});

      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");

      // 1. Background (centre, with user pan/zoom). Image is already
      //    cropped to the placement aspect upstream, so stretching it
      //    to (OUT_W, OUT_H) at zoom=1 == "cover".
      ctx.save();
      ctx.translate(OUT_W / 2, OUT_H / 2);
      ctx.translate(state.bgPanX * OUT_W, state.bgPanY * OUT_H);
      ctx.scale(state.bgZoom, state.bgZoom);
      ctx.drawImage(img, -OUT_W / 2, -OUT_H / 2, OUT_W, OUT_H);
      ctx.restore();

      // 2. Tint overlay
      if (state.tintOpacity > 0) {
        const { r, g, b } = hexToRgb(state.tintColor);
        ctx.fillStyle = `rgba(${r},${g},${b},${state.tintOpacity})`;
        ctx.fillRect(0, 0, OUT_W, OUT_H);
      }

      // 3. Text layers — middle baseline so the y coord is the vertical
      //    centre of the glyph bbox; matches the preview where the text
      //    span is translateY(-50%) about its y position.
      const drawText = (layer: TextLayer, weight: number) => {
        if (!layer.text) return;
        const fontSize = Math.round(layer.size * OUT_H);
        ctx.font = `${weight} ${fontSize}px "Peachi", Georgia, serif`;
        ctx.fillStyle = layer.color;
        ctx.textAlign = layer.align;
        ctx.textBaseline = "middle";
        ctx.fillText(layer.text, layer.x * OUT_W, layer.y * OUT_H);
      };
      drawText(state.headline, 700);
      for (const sh of state.subheads) drawText(sh, 500);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("Could not encode poster");
      onSave(new File([blob], `poster-${Date.now()}.jpg`, { type: "image/jpeg" }));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // --- Render ------------------------------------------------------
  const updateHeadline = (patch: Partial<TextLayer>) => {
    setState((s) => ({ ...s, headline: { ...s.headline, ...patch } }));
  };
  const updateSubhead = (idx: number, patch: Partial<TextLayer>) => {
    setState((s) => {
      const updated = s.subheads.slice();
      if (!updated[idx]) return s;
      updated[idx] = { ...updated[idx], ...patch };
      return { ...s, subheads: updated };
    });
  };

  // Append a new subhead — clones styling from the last subhead so it
  // looks coherent with what's already on the poster. AI generation
  // can refine it after.
  const addSubhead = () => {
    setState((s) => {
      if (s.subheads.length >= 4) return s;
      const last = s.subheads[s.subheads.length - 1];
      const next: TextLayer = last
        ? { ...last, text: "New supporting line", y: Math.min(0.95, last.y + 0.07) }
        : { text: "New supporting line", x: 0.5, y: 0.6, color: "#F5F3F0", size: 0.035, align: "center" };
      const idx = s.subheads.length;
      // Defer the select update until after the state commits.
      queueMicrotask(() => setSelected({ kind: "subhead", index: idx }));
      return { ...s, subheads: [...s.subheads, next] };
    });
  };

  const removeSubhead = (idx: number) => {
    setState((s) => {
      if (s.subheads.length <= 1) return s; // keep at least one
      const updated = s.subheads.slice();
      updated.splice(idx, 1);
      const nextIdx = Math.min(idx, updated.length - 1);
      queueMicrotask(() => setSelected({ kind: "subhead", index: nextIdx }));
      return { ...s, subheads: updated };
    });
  };

  const selectedLayer: TextLayer | null =
    selected.kind === "headline" ? state.headline
      : selected.kind === "subhead" ? (state.subheads[selected.index] ?? null)
        : null;
  const isHeadline = selected.kind === "headline";
  const reservedZones = RESERVED_ZONES[placement];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Compose poster · {placement === "home" ? "Home banner" : "Splash"}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Type an objective, hit Generate, then drag to adjust.
            </p>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 hover:bg-gray-100">
            <X className="h-4 w-4 text-gray-600" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1fr_320px]">
          {/* PREVIEW pane ------------------------------------------ */}
          <div className="flex flex-col items-center justify-start gap-3 overflow-y-auto bg-gray-50 p-5">
            <div
              ref={frameRef}
              className="relative overflow-hidden rounded-lg bg-black shadow-lg select-none"
              style={{ width: previewW, height: previewH, touchAction: "none" }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* BG — draggable. transform-origin centre matches the
                  canvas raster (translate(W/2, H/2)). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bgUrl}
                alt=""
                draggable={false}
                onPointerDown={(e) => onPointerDown({ kind: "bg" }, e)}
                className="absolute inset-0 h-full w-full cursor-move"
                style={{
                  objectFit: "cover",
                  transform: `translate(${state.bgPanX * previewW}px, ${state.bgPanY * previewH}px) scale(${state.bgZoom})`,
                  transformOrigin: "center",
                }}
              />

              {/* Tint */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundColor: state.tintColor,
                  opacity: state.tintOpacity,
                }}
              />

              {/* Reserved zones — the customer app paints UI on top of
                  the poster (C logo, cart button, info card on home;
                  close ✕ + Tap-to-open on splash). Showing them in the
                  preview keeps the operator from putting text where it
                  will be hidden. */}
              {reservedZones.map((z) => (
                <div
                  key={z.label}
                  className="pointer-events-none absolute flex items-center justify-center rounded-md border border-dashed border-white/40 bg-black/20"
                  style={{
                    left:   `${z.x * 100}%`,
                    top:    `${z.y * 100}%`,
                    width:  `${z.w * 100}%`,
                    height: `${z.h * 100}%`,
                  }}
                >
                  <span className="text-[8px] font-semibold uppercase tracking-wider text-white/70">
                    {z.label}
                  </span>
                </div>
              ))}

              {/* Headline — bold + larger weight */}
              <div
                onPointerDown={(e) => onPointerDown({ kind: "headline" }, e)}
                className={`absolute cursor-move whitespace-nowrap ${
                  selected.kind === "headline" ? "outline outline-1 outline-dashed outline-white/60" : ""
                }`}
                style={{
                  left: `${state.headline.x * 100}%`,
                  top:  `${state.headline.y * 100}%`,
                  transform: `translate(${
                    state.headline.align === "center" ? "-50%" : state.headline.align === "right" ? "-100%" : "0"
                  }, -50%)`,
                  color: state.headline.color,
                  fontFamily: '"Peachi", Georgia, serif',
                  fontWeight: 700,
                  fontSize: `${state.headline.size * previewH}px`,
                  lineHeight: 1.05,
                  textShadow: "0 1px 2px rgba(0,0,0,0.15)",
                  padding: "2px 4px",
                }}
              >
                {state.headline.text || "Headline"}
              </div>

              {/* Subhead text layers — each draggable independently */}
              {state.subheads.map((layer, idx) => {
                const isSel = selected.kind === "subhead" && selected.index === idx;
                return (
                  <div
                    key={idx}
                    onPointerDown={(e) => onPointerDown({ kind: "subhead", index: idx }, e)}
                    className={`absolute cursor-move whitespace-nowrap ${
                      isSel ? "outline outline-1 outline-dashed outline-white/60" : ""
                    }`}
                    style={{
                      left: `${layer.x * 100}%`,
                      top:  `${layer.y * 100}%`,
                      transform: `translate(${
                        layer.align === "center" ? "-50%" : layer.align === "right" ? "-100%" : "0"
                      }, -50%)`,
                      color: layer.color,
                      fontFamily: '"Peachi", Georgia, serif',
                      fontWeight: 500,
                      fontSize: `${layer.size * previewH}px`,
                      lineHeight: 1.05,
                      textShadow: "0 1px 2px rgba(0,0,0,0.15)",
                      padding: "2px 4px",
                    }}
                  >
                    {layer.text || `Subhead ${idx + 1}`}
                  </div>
                );
              })}
            </div>

            {/* AI objective input — directly below the preview so it
                reads top-down: image, what you want, generate. */}
            <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-3">
              <label className="text-[11px] font-semibold text-gray-700">
                Objective
              </label>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                rows={2}
                placeholder="e.g. Promote Ramadan iftar special, 20% off espresso this week, warm casual tone"
                className="mt-1 w-full resize-none rounded-md border border-gray-200 px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={generate}
                disabled={generating || !objective.trim()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-terracotta px-3 py-2 text-xs font-semibold text-white hover:bg-terracotta-dark disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generating ? "Generating…" : "Generate with AI"}
              </button>
              <p className="mt-1.5 text-[10px] text-gray-400">
                AI promotes the strongest part of your objective (an offer like "10% off") to the headline, picks supporting subhead lines, and chooses tint + text colours that contrast with the image — while dodging the C-logo, cart and info-card zones.
              </p>
            </div>
          </div>

          {/* CONTROLS pane ----------------------------------------- */}
          <div className="flex flex-col gap-4 overflow-y-auto border-l border-gray-100 p-5">
            {/* Layer tabs — dynamic. Background + Headline are fixed;
                subheads wrap depending on how many the operator has
                added. The "+ Add" tile spawns a new subhead. */}
            <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
              {[
                { sel: { kind: "bg" } as Selected,       label: "Background", active: selected.kind === "bg" },
                { sel: { kind: "headline" } as Selected, label: "Headline",   active: selected.kind === "headline" },
                ...state.subheads.map((_, i) => ({
                  sel:    { kind: "subhead", index: i } as Selected,
                  label:  state.subheads.length > 1 ? `Subhead ${i + 1}` : "Subhead",
                  active: selected.kind === "subhead" && selected.index === i,
                })),
              ].map((t) => (
                <button
                  key={t.label}
                  onClick={() => setSelected(t.sel)}
                  className={`flex-1 min-w-[60px] rounded-md px-2 py-1.5 text-[11px] font-semibold ${
                    t.active ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"
                  }`}
                >
                  {t.label}
                </button>
              ))}
              {state.subheads.length < 4 && (
                <button
                  onClick={addSubhead}
                  title="Add another subhead"
                  className="flex items-center justify-center rounded-md px-2 py-1.5 text-[11px] font-semibold text-terracotta hover:bg-white"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* BG controls */}
            {selected.kind === "bg" && (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-gray-700">
                    Zoom · {state.bgZoom.toFixed(2)}×
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.01}
                    value={state.bgZoom}
                    onChange={(e) => setState((s) => ({ ...s, bgZoom: Number(e.target.value) }))}
                    className="mt-1 w-full"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-700">
                    Tint colour
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      value={state.tintColor}
                      onChange={(e) => setState((s) => ({ ...s, tintColor: e.target.value }))}
                      className="h-8 w-12 cursor-pointer rounded border border-gray-200"
                    />
                    <input
                      type="text"
                      value={state.tintColor}
                      onChange={(e) => setState((s) => ({ ...s, tintColor: e.target.value }))}
                      className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-700">
                    Tint opacity · {(state.tintOpacity * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={0.8}
                    step={0.01}
                    value={state.tintOpacity}
                    onChange={(e) => setState((s) => ({ ...s, tintOpacity: Number(e.target.value) }))}
                    className="mt-1 w-full"
                  />
                </div>

                <button
                  onClick={() =>
                    setState((s) => ({ ...s, bgPanX: 0, bgPanY: 0, bgZoom: 1 }))
                  }
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-200 px-2 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset position
                </button>
              </div>
            )}

            {/* Text layer controls — same UI for headline + subheads;
                the dispatcher below routes the patch to the right
                slot in state. */}
            {selectedLayer && (selected.kind === "headline" || selected.kind === "subhead") && (() => {
              const patch = (p: Partial<TextLayer>) => {
                if (isHeadline) updateHeadline(p);
                else if (selected.kind === "subhead") updateSubhead(selected.index, p);
              };
              return (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-gray-700">
                      {isHeadline
                        ? "Headline text"
                        : state.subheads.length > 1
                          ? `Subhead ${selected.kind === "subhead" ? selected.index + 1 : ""} text`
                          : "Subhead text"}
                    </label>
                    <textarea
                      value={selectedLayer.text}
                      onChange={(e) => patch({ text: e.target.value })}
                      rows={isHeadline ? 1 : 2}
                      className="mt-1 w-full resize-none rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-gray-700">
                      Size · {(selectedLayer.size * 100).toFixed(1)}%
                    </label>
                    <input
                      type="range"
                      min={isHeadline ? 0.04 : 0.02}
                      max={isHeadline ? 0.2 : 0.08}
                      step={0.001}
                      value={selectedLayer.size}
                      onChange={(e) => patch({ size: Number(e.target.value) })}
                      className="mt-1 w-full"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-gray-700">
                      Colour
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedLayer.color}
                        onChange={(e) => patch({ color: e.target.value })}
                        className="h-8 w-12 cursor-pointer rounded border border-gray-200"
                      />
                      <input
                        type="text"
                        value={selectedLayer.color}
                        onChange={(e) => patch({ color: e.target.value })}
                        className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-gray-700">Align</label>
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button
                          key={a}
                          onClick={() => patch({ align: a })}
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                            selectedLayer.align === a
                              ? "border-terracotta bg-terracotta/10 text-terracotta"
                              : "border-gray-200 text-gray-600"
                          }`}
                        >
                          {a[0].toUpperCase() + a.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Remove subhead — only available for subhead layers
                      and only when there's more than one (keeps the
                      composer in a renderable state). */}
                  {selected.kind === "subhead" && state.subheads.length > 1 && (
                    <button
                      onClick={() => removeSubhead(selected.index)}
                      className="flex w-full items-center justify-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-100"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove this subhead
                    </button>
                  )}

                  <p className="text-[10px] text-gray-400">
                    Drag the text in the preview to move it. Position is
                    saved as a fraction of the poster size, so it stays
                    put across resolutions.
                  </p>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save as image
          </button>
        </div>
      </div>
    </div>
  );
}
