"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X, RotateCcw } from "lucide-react";
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
  subhead: TextLayer;
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
  subhead: {
    text: "A short supporting line goes here",
    x: 0.5,
    y: 0.52,
    color: "#F5F3F0",
    size: 0.035,
    align: "center",
  },
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

export function PosterComposer({ bgUrl, placement, onCancel, onSave }: Props) {
  const [state, setState] = useState<State>(DEFAULT_STATE);
  const [objective, setObjective] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which layer is active in the right-side editor. The bg is "bg" — its
  // controls (zoom, pan reset) sit in the same panel for consistency.
  const [selected, setSelected] = useState<"headline" | "subhead" | "bg">("headline");

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
  // without losing focus.
  const dragRef = useRef<{
    kind: "bg" | "headline" | "subhead";
    startClientX: number;
    startClientY: number;
    startState: State;
  } | null>(null);

  const onPointerDown = (
    kind: "bg" | "headline" | "subhead",
    e: React.PointerEvent,
  ) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startState: state,
    };
    setSelected(kind);
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
      if (drag.kind === "bg") {
        return { ...s, bgPanX: base.bgPanX + dxN, bgPanY: base.bgPanY + dyN };
      }
      if (drag.kind === "headline") {
        return {
          ...s,
          headline: {
            ...s.headline,
            x: Math.max(0, Math.min(1, base.headline.x + dxN)),
            y: Math.max(0, Math.min(1, base.headline.y + dyN)),
          },
        };
      }
      return {
        ...s,
        subhead: {
          ...s.subhead,
          x: Math.max(0, Math.min(1, base.subhead.x + dxN)),
          y: Math.max(0, Math.min(1, base.subhead.y + dyN)),
        },
      };
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
        subhead: TextLayer;
      };
      setState((cur) => ({
        ...cur,
        tintColor:   s.tintColor,
        tintOpacity: s.tintOpacity,
        headline:    s.headline,
        subhead:     s.subhead,
      }));
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
        document.fonts.load(`500 ${Math.round(state.subhead.size * OUT_H)}px "Peachi"`),
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
      drawText(state.subhead, 500);

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
  const updateLayer = (
    which: "headline" | "subhead",
    patch: Partial<TextLayer>,
  ) => {
    setState((s) => ({ ...s, [which]: { ...s[which], ...patch } }));
  };

  const selectedLayer =
    selected === "headline" ? state.headline : selected === "subhead" ? state.subhead : null;

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
                onPointerDown={(e) => onPointerDown("bg", e)}
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

              {/* Home placement overlay hint — semi-transparent mock of
                  the info card so the operator avoids placing text in
                  the reserved zone. */}
              {placement === "home" && (
                <div
                  className="pointer-events-none absolute inset-x-3 bottom-2 rounded-xl border border-white/20 bg-white/10"
                  style={{ height: previewH * 0.18 }}
                >
                  <div className="flex h-full items-center justify-center text-[8px] font-semibold uppercase tracking-wider text-white/60">
                    Info card area
                  </div>
                </div>
              )}

              {/* Text layers — draggable. translate(-50%) on Y to centre
                  on the y coord so it matches the canvas middle-baseline. */}
              {([
                { key: "headline" as const, layer: state.headline, weight: 700 },
                { key: "subhead"  as const, layer: state.subhead,  weight: 500 },
              ]).map(({ key, layer, weight }) => (
                <div
                  key={key}
                  onPointerDown={(e) => onPointerDown(key, e)}
                  className={`absolute cursor-move whitespace-nowrap ${
                    selected === key ? "outline outline-1 outline-dashed outline-white/60" : ""
                  }`}
                  style={{
                    left: `${layer.x * 100}%`,
                    top:  `${layer.y * 100}%`,
                    transform: `translate(${
                      layer.align === "center" ? "-50%" : layer.align === "right" ? "-100%" : "0"
                    }, -50%)`,
                    color: layer.color,
                    fontFamily: '"Peachi", Georgia, serif',
                    fontWeight: weight,
                    fontSize: `${layer.size * previewH}px`,
                    lineHeight: 1.05,
                    textShadow: "0 1px 2px rgba(0,0,0,0.15)",
                    padding: "2px 4px",
                  }}
                >
                  {layer.text || (key === "headline" ? "Headline" : "Subhead")}
                </div>
              ))}
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
                AI looks at your image + objective, suggests headline, subhead, tint and text positions.
              </p>
            </div>
          </div>

          {/* CONTROLS pane ----------------------------------------- */}
          <div className="flex flex-col gap-4 overflow-y-auto border-l border-gray-100 p-5">
            {/* Layer tabs */}
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
              {([
                { id: "bg" as const,       label: "Background" },
                { id: "headline" as const, label: "Headline" },
                { id: "subhead"  as const, label: "Subhead" },
              ]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  className={`rounded-md px-2 py-1.5 text-[11px] font-semibold ${
                    selected === t.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-600"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* BG controls */}
            {selected === "bg" && (
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

            {/* Text layer controls */}
            {selectedLayer && (selected === "headline" || selected === "subhead") && (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-gray-700">
                    {selected === "headline" ? "Headline text" : "Subhead text"}
                  </label>
                  <textarea
                    value={selectedLayer.text}
                    onChange={(e) => updateLayer(selected, { text: e.target.value })}
                    rows={selected === "subhead" ? 2 : 1}
                    className="mt-1 w-full resize-none rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-gray-700">
                    Size · {(selectedLayer.size * 100).toFixed(1)}%
                  </label>
                  <input
                    type="range"
                    min={selected === "headline" ? 0.04 : 0.02}
                    max={selected === "headline" ? 0.2 : 0.08}
                    step={0.001}
                    value={selectedLayer.size}
                    onChange={(e) => updateLayer(selected, { size: Number(e.target.value) })}
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
                      onChange={(e) => updateLayer(selected, { color: e.target.value })}
                      className="h-8 w-12 cursor-pointer rounded border border-gray-200"
                    />
                    <input
                      type="text"
                      value={selectedLayer.color}
                      onChange={(e) => updateLayer(selected, { color: e.target.value })}
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
                        onClick={() => updateLayer(selected, { align: a })}
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

                <p className="text-[10px] text-gray-400">
                  Drag the text in the preview to move it. Position is
                  saved as a fraction of the poster size, so it stays
                  put across resolutions.
                </p>
              </div>
            )}
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
