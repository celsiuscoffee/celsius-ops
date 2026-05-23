"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X, RotateCcw, Plus, Trash2, ShoppingCart } from "lucide-react";
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
  // Drop-shadow strength, 0 (no shadow) - 1 (heavy). Applied both in
  // the live preview (CSS text-shadow) and the canvas raster (ctx
  // shadow*). Useful for white text on light photos — boost shadow
  // until the text reads cleanly. Optional for back-compat with prior
  // composer_state JSON that doesn't carry the field; defaults to 0
  // when missing (i.e. no shadow).
  shadow?: number;
  // Typeface — "peachi" (default serif, brand heading font) or
  // "space-grotesk" (sans-serif secondary font). Pick whichever reads
  // better against the bg. Optional for back-compat; defaults to
  // "peachi" when missing.
  font?: "peachi" | "space-grotesk";
};

// Concrete CSS font-family stack per choice. Single source of truth
// shared by the preview and canvas raster.
const FONT_STACK: Record<NonNullable<TextLayer["font"]>, string> = {
  "peachi":        '"Peachi", Georgia, serif',
  "space-grotesk": '"Space Grotesk", system-ui, sans-serif',
};

// Persisted composition state. Saved to splash_posters.composer_state so
// the operator can re-open and tweak instead of starting from scratch.
export type ComposerState = {
  bgUrl: string;       // original (already-cropped) background — pre-rasterise
  bgZoom: number;
  bgPanX: number;      // normalised, 0 = centred
  bgPanY: number;
  tintColor: string;
  tintOpacity: number; // 0-1
  headline: TextLayer;
  subheads: TextLayer[];
};

// Local component state — same shape, minus the bgUrl (which lives in props).
type State = Omit<ComposerState, "bgUrl">;

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
    shadow: 0,
    font: "peachi",
  },
  subheads: [
    {
      text: "A short supporting line goes here",
      x: 0.5,
      y: 0.52,
      color: "#F5F3F0",
      size: 0.035,
      align: "center",
      shadow: 0,
      font: "peachi",
    },
  ],
};

// Maps a 0-1 shadow strength to concrete CSS/canvas params. Single
// source of truth so preview and rasterise stay in sync. Offsets and
// blur scale with the text height so big headlines get proportionally
// bigger shadows; alpha grows linearly with strength.
function shadowParams(strength: number, fontPx: number) {
  const s = Math.max(0, Math.min(1, strength || 0));
  return {
    offsetY: Math.round(fontPx * 0.04 * s),     // ~4% of font size at max
    blur:    Math.round(fontPx * 0.18 * (0.4 + 0.6 * s)), // 7-18% range
    alpha:   0.55 * s,                          // 0 .. 0.55
  };
}

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
  // Optional saved state — when present, hydrates the composer with
  // the prior layers instead of DEFAULT_STATE. Used by the Edit-poster
  // flow so the operator continues editing rather than starting over.
  initialState?: ComposerState;
  onCancel: () => void;
  // Returns a fresh JPEG File ready for upload via the existing
  // /api/pickup/upload-image route, plus the ComposerState so the
  // parent can persist it for future edits. Parent decides what to
  // do with both.
  onSave: (file: File, state: ComposerState) => void;
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

export function PosterComposer({ bgUrl, placement, initialState, onCancel, onSave }: Props) {
  // Strip bgUrl out of initialState — we keep it in props so the bg can
  // be swapped (re-crop) without churning composition state.
  const [state, setState] = useState<State>(() => {
    if (!initialState) return DEFAULT_STATE;
    const { bgUrl: _ignore, ...rest } = initialState;
    return rest;
  });
  const [objective, setObjective] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Selected>({ kind: "headline" });
  // Tracks whether the current layers came from an "extract" call (OCR
  // of an existing baked poster). When true, we show a banner warning
  // the operator that the original text is still in the bg pixels —
  // moving layers won't erase it; they'd need to re-crop. Cleared once
  // they re-generate via the AI compose prompt or save.
  const [extractedFromImage, setExtractedFromImage] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const [bgReady, setBgReady] = useState(false);
  // Hydrate the bg image into an Image element so the canvas raster can
  // draw it without re-fetching. Two subtleties:
  //   1. crossOrigin="anonymous" MUST be paired with a CORS-enabled
  //      response, or the canvas gets tainted and toBlob() returns null
  //      ("Could not encode poster"). Cloudinary serves ACAO:* on image
  //      fetches by default, so this works — but only if the browser
  //      actually sends a CORS request.
  //   2. If the preview <img> already cached a non-CORS response for the
  //      same URL, the browser may serve the cached bytes to this CORS
  //      request and the response will lack ACAO. We append a tiny
  //      cache-bust param so this Image gets its own fresh CORS-enabled
  //      response, never sharing the cache with the preview <img>.
  useEffect(() => {
    setBgReady(false);
    bgImgRef.current = null;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      bgImgRef.current = img;
      setBgReady(true);
    };
    img.onerror = () => {
      // CORS failure or 404 — Save will toast and stay open so the
      // operator can re-crop or retry.
      toast.error("Background image couldn't load for export. Try re-cropping.");
    };
    const sep = bgUrl.includes("?") ? "&" : "?";
    img.src = `${bgUrl}${sep}cors=1`;
  }, [bgUrl]);

  // Auto-extract layers from the bg image when there's no prior
  // composer_state to hydrate from. This makes legacy posters (created
  // before composer_state was persisted) editable too — Claude OCRs the
  // visible text and returns matching layers so the operator can tweak
  // text/colours instead of starting from the default placeholders.
  // Only runs once per mount; subsequent re-renders don't re-trigger.
  useEffect(() => {
    if (initialState) return;
    let cancelled = false;
    const run = async () => {
      setExtracting(true);
      try {
        const res = await adminFetch("/api/pickup/ai-poster/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: bgUrl, mode: "extract", placement }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          // Extract is best-effort — if it fails, fall back to the
          // default placeholders silently. Operator can still type
          // an objective and run compose mode.
          return;
        }
        const s = json.suggestion as {
          tintColor: string;
          tintOpacity: number;
          headline: TextLayer;
          subheads: TextLayer[];
        };
        // Only apply if Claude actually read text — empty headline +
        // empty subheads means the image has no readable text and we
        // should leave DEFAULT_STATE alone.
        const anyText =
          (s.headline?.text ?? "").trim().length > 0 ||
          (s.subheads ?? []).some((sh) => (sh.text ?? "").trim().length > 0);
        if (!anyText) return;
        setState((cur) => ({
          ...cur,
          tintColor:   s.tintColor,
          tintOpacity: s.tintOpacity,
          headline:    s.headline,
          subheads:    s.subheads.length > 0 ? s.subheads : cur.subheads,
        }));
        setExtractedFromImage(true);
      } catch {
        // Network error — silently fall back. Manual compose still works.
      } finally {
        if (!cancelled) setExtracting(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Running an objective-driven compose supersedes the extracted
      // layers — the operator has chosen to write new text, so the
      // "loaded from baked image" warning is no longer relevant.
      setExtractedFromImage(false);
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
      toast.error("Background still loading — try again in a moment.");
      return;
    }
    // Hard guard against stacking on an already-text-baked bg. When
    // extract mode lifted text out of the image, the original pixels
    // still carry that text — saving would draw the editable layers on
    // top, producing double text. Require explicit confirm before
    // proceeding so the operator doesn't silently corrupt the poster.
    if (extractedFromImage) {
      const ok = window.confirm(
        "Background already has text baked into it. Saving now will draw the new text ON TOP of the old, producing double text.\n\nTo edit cleanly, click Cancel, then close this composer and Re-crop with a fresh image.\n\nContinue and stack anyway?",
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      // Make sure each layer's font is actually loaded before drawing —
      // text would otherwise fall back to a generic serif/sans on first
      // render. We pre-load BOTH Peachi and Space Grotesk at the actual
      // size+weight each layer uses, since the operator can mix fonts
      // across the headline + subheads.
      const fontFamily = (f: TextLayer["font"]) =>
        f === "space-grotesk" ? '"Space Grotesk"' : '"Peachi"';
      await Promise.all([
        document.fonts.load(`700 ${Math.round(state.headline.size * OUT_H)}px ${fontFamily(state.headline.font)}`),
        ...state.subheads.map((sh) =>
          document.fonts.load(`500 ${Math.round(sh.size * OUT_H)}px ${fontFamily(sh.font)}`),
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
      //    span is translateY(-50%) about its y position. Shadow params
      //    come from the same shadowParams() helper as the preview, so
      //    the rasterised JPEG matches what the operator sees on screen.
      const drawText = (layer: TextLayer, weight: number) => {
        if (!layer.text) return;
        const fontSize = Math.round(layer.size * OUT_H);
        ctx.save();
        ctx.font = `${weight} ${fontSize}px ${FONT_STACK[layer.font ?? "peachi"]}`;
        ctx.fillStyle = layer.color;
        ctx.textAlign = layer.align;
        ctx.textBaseline = "middle";
        const sh = shadowParams(layer.shadow ?? 0, fontSize);
        if (sh.alpha > 0) {
          ctx.shadowColor   = `rgba(0,0,0,${sh.alpha})`;
          ctx.shadowBlur    = sh.blur;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = sh.offsetY;
        }
        ctx.fillText(layer.text, layer.x * OUT_W, layer.y * OUT_H);
        ctx.restore();
      };
      drawText(state.headline, 700);
      for (const sh of state.subheads) drawText(sh, 500);

      // canvas.toBlob() returns null (not throws) when the canvas is
      // tainted — e.g. the bg image was loaded without CORS. We retry
      // via toDataURL → fetch → blob, which surfaces a clearer error.
      // If even THAT fails, the image is unrecoverable for export and
      // the operator needs to re-crop (which re-uploads via our own
      // backend and produces a clean Cloudinary URL).
      let blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) {
        try {
          const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          const r = await fetch(dataUrl);
          blob = await r.blob();
        } catch {
          throw new Error(
            "Couldn't export — the background image is blocked by CORS. Try re-cropping the image to refresh it.",
          );
        }
      }
      if (!blob) {
        throw new Error("Couldn't encode the poster — try re-cropping the background.");
      }
      const file = new File([blob], `poster-${Date.now()}.jpg`, { type: "image/jpeg" });
      // Hand back the editable state alongside the rasterised file so
      // the parent can persist composer_state. Editing the poster later
      // reopens the composer with this state instead of regenerating.
      const fullState: ComposerState = { bgUrl, ...state };
      onSave(file, fullState);
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

              {/* Mock chrome — the customer app paints UI on top of the
                  poster. We render an approximation of the actual chrome
                  (C logo, cart button, member info card on home; close
                  ✕ + tap-to-open on splash) so the operator sees exactly
                  what the customer will see and places text accordingly.
                  These are visual-only and don't block pointer events. */}
              {placement === "home" && (
                <>
                  {/* C logo — dark rounded square top-left */}
                  <div
                    className="pointer-events-none absolute flex items-center justify-center rounded-lg bg-[#160800] shadow-md"
                    style={{
                      left:   `${0.03 * previewW}px`,
                      top:    `${0.03 * previewH}px`,
                      width:  `${Math.max(28, previewH * 0.085)}px`,
                      height: `${Math.max(28, previewH * 0.085)}px`,
                      fontFamily: '"Peachi", Georgia, serif',
                      fontWeight: 700,
                      fontSize: `${Math.max(14, previewH * 0.055)}px`,
                      color: "#F5F3F0",
                    }}
                  >
                    c
                  </div>

                  {/* Cart — white circle top-right */}
                  <div
                    className="pointer-events-none absolute flex items-center justify-center rounded-full bg-white shadow-md"
                    style={{
                      right:  `${0.03 * previewW}px`,
                      top:    `${0.03 * previewH}px`,
                      width:  `${Math.max(30, previewH * 0.09)}px`,
                      height: `${Math.max(30, previewH * 0.09)}px`,
                    }}
                  >
                    <ShoppingCart
                      className="text-[#160800]"
                      style={{ width: `${Math.max(14, previewH * 0.045)}px`, height: `${Math.max(14, previewH * 0.045)}px` }}
                    />
                  </div>

                  {/* Member info card — espresso surface bottom 25% */}
                  <div
                    className="pointer-events-none absolute rounded-xl shadow-2xl"
                    style={{
                      left:   `${0.04 * previewW}px`,
                      right:  `${0.04 * previewW}px`,
                      bottom: `${0.025 * previewH}px`,
                      backgroundColor: "#160800",
                      padding: `${previewH * 0.022}px ${previewW * 0.035}px`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="truncate text-white"
                        style={{ fontFamily: '"Peachi", Georgia, serif', fontSize: `${Math.max(11, previewH * 0.034)}px` }}
                      >
                        Hi, Friend.
                      </span>
                      <span
                        className="font-bold tracking-wider"
                        style={{ fontSize: `${Math.max(8, previewH * 0.022)}px`, color: "#FBBF24" }}
                      >
                        ✦ MEMBER
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-stretch border-t border-white/10 pt-1.5">
                      <div className="flex-1">
                        <div className="font-bold text-white" style={{ fontSize: `${Math.max(10, previewH * 0.032)}px` }}>
                          3,214
                        </div>
                        <div className="uppercase tracking-wider text-white/55" style={{ fontSize: `${Math.max(7, previewH * 0.020)}px` }}>
                          BEANS
                        </div>
                      </div>
                      <div className="flex-1 border-l border-white/10 pl-2">
                        <div className="font-bold" style={{ fontSize: `${Math.max(10, previewH * 0.032)}px`, color: "#FBBF24" }}>
                          2
                        </div>
                        <div className="uppercase tracking-wider text-white/55" style={{ fontSize: `${Math.max(7, previewH * 0.020)}px` }}>
                          REWARDS
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {placement === "splash" && (
                <>
                  {/* Close ✕ — circular dismiss top-right */}
                  <div
                    className="pointer-events-none absolute flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm"
                    style={{
                      right:  `${0.04 * previewW}px`,
                      top:    `${0.025 * previewH}px`,
                      width:  `${Math.max(26, previewH * 0.05)}px`,
                      height: `${Math.max(26, previewH * 0.05)}px`,
                      color: "#FFFFFF",
                      fontSize: `${Math.max(14, previewH * 0.028)}px`,
                    }}
                  >
                    ✕
                  </div>

                  {/* Tap to open hint — bottom caption */}
                  <div
                    className="pointer-events-none absolute left-0 right-0 text-center uppercase tracking-[0.18em] text-white/80"
                    style={{
                      bottom: `${0.03 * previewH}px`,
                      fontSize: `${Math.max(8, previewH * 0.018)}px`,
                      letterSpacing: "0.2em",
                    }}
                  >
                    TAP TO OPEN
                  </div>
                </>
              )}

              {/* Headline — bold + larger weight */}
              {(() => {
                // Preview shadow — derived from per-layer strength so the
                // operator sees the same drop as the rasterised JPEG. Uses
                // the same shadowParams() helper as canvas.
                const headlineFontPx = state.headline.size * previewH;
                const hs = shadowParams(state.headline.shadow ?? 0, headlineFontPx);
                return (
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
                      fontFamily: FONT_STACK[state.headline.font ?? "peachi"],
                      fontWeight: 700,
                      fontSize: `${headlineFontPx}px`,
                      lineHeight: 1.05,
                      textShadow: hs.alpha > 0
                        ? `0 ${hs.offsetY}px ${hs.blur}px rgba(0,0,0,${hs.alpha.toFixed(3)})`
                        : "none",
                      padding: "2px 4px",
                    }}
                  >
                    {state.headline.text || "Headline"}
                  </div>
                );
              })()}

              {/* Subhead text layers — each draggable independently */}
              {state.subheads.map((layer, idx) => {
                const isSel = selected.kind === "subhead" && selected.index === idx;
                const fontPx = layer.size * previewH;
                const sh = shadowParams(layer.shadow ?? 0, fontPx);
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
                      fontFamily: FONT_STACK[layer.font ?? "peachi"],
                      fontWeight: 500,
                      fontSize: `${fontPx}px`,
                      lineHeight: 1.05,
                      textShadow: sh.alpha > 0
                        ? `0 ${sh.offsetY}px ${sh.blur}px rgba(0,0,0,${sh.alpha.toFixed(3)})`
                        : "none",
                      padding: "2px 4px",
                    }}
                  >
                    {layer.text || `Subhead ${idx + 1}`}
                  </div>
                );
              })}
            </div>

            {/* Extract-mode notice — appears when the composer auto-OCR'd
                text from a legacy bg image (no saved composer_state). Lets
                the operator know the text was lifted from the image so
                they understand WHY layers are pre-populated, and warns
                that the original baked-in text is still in the bg pixels
                — moving the layer doesn't erase what's underneath. */}
            {extracting && (
              <div className="flex w-full max-w-md items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Reading existing text from the poster…
              </div>
            )}
            {extractedFromImage && !extracting && (
              <div className="w-full max-w-md rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2.5 text-[11px] text-red-900">
                <p className="font-semibold text-red-900">⚠️ Background has baked-in text — saving will STACK</p>
                <p className="mt-1 text-red-800/85">
                  This image already has &quot;{state.headline.text}&quot;
                  {state.subheads[0]?.text ? ` / "${state.subheads[0].text}"` : ""} painted into the pixels.
                  Saving the composer here would lay new text on top of the old, doubling it.
                </p>
                <p className="mt-1 text-red-800/85">
                  <strong>To fix:</strong> close this composer, click <strong>Re-crop</strong> in the form, and upload a clean background photo (no text on it). Then re-open AI compose.
                </p>
              </div>
            )}

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
                      max={isHeadline ? 0.24 : 0.10}
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

                  {/* Typeface — Peachi (serif, brand heading) or Space
                      Grotesk (sans, modern + technical). Pick whichever
                      reads better against the bg + matches the campaign
                      mood. Per-layer so headline and subheads can mix. */}
                  <div>
                    <label className="text-[11px] font-medium text-gray-700">Font</label>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      {([
                        { id: "peachi" as const,        label: "Peachi",        stack: FONT_STACK["peachi"] },
                        { id: "space-grotesk" as const, label: "Space Grotesk", stack: FONT_STACK["space-grotesk"] },
                      ]).map((f) => {
                        const active = (selectedLayer.font ?? "peachi") === f.id;
                        return (
                          <button
                            key={f.id}
                            onClick={() => patch({ font: f.id })}
                            className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold ${
                              active
                                ? "border-terracotta bg-terracotta/10 text-terracotta"
                                : "border-gray-200 text-gray-600"
                            }`}
                            style={{ fontFamily: f.stack }}
                          >
                            {f.label}
                          </button>
                        );
                      })}
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

                  {/* Shadow slider — drop-shadow strength behind the
                      glyphs. 0 = no shadow (default). At max the text
                      gets a soft dark drop that improves legibility on
                      busy / pale backgrounds. Applies in both the live
                      preview and the rasterised JPEG. */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium text-gray-700">
                        Shadow · {Math.round(((selectedLayer.shadow ?? 0) * 100))}%
                      </label>
                      {(selectedLayer.shadow ?? 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => patch({ shadow: 0 })}
                          className="text-[10px] text-gray-500 hover:text-gray-900"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={selectedLayer.shadow ?? 0}
                      onChange={(e) => patch({ shadow: Number(e.target.value) })}
                      className="mt-1 w-full"
                    />
                    <p className="mt-1 text-[10px] text-gray-400">
                      Lifts text off pale or busy backgrounds. Leave at 0 when the text already has enough contrast.
                    </p>
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
            disabled={saving || !bgReady}
            className="flex items-center gap-2 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-60"
            title={!bgReady ? "Waiting for the background to load…" : undefined}
          >
            {(saving || !bgReady) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {bgReady ? "Save as image" : "Loading bg…"}
          </button>
        </div>
      </div>
    </div>
  );
}
