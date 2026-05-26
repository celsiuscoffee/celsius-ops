"use client";

import { useEffect, useRef } from "react";

/**
 * Customer-display viewport frame.
 *
 * The SUNMI D3 secondary display is 10.1", 1280×800 native. When the
 * customer-display URL is opened on the device, the WebView viewport
 * IS that resolution, so the inner frame fills the screen exactly
 * with no visible surround.
 *
 * When opened on a laptop/desktop/phone for design preview, the
 * frame stays at the exact 1280×800 device pixel count, but a CSS
 * `transform: scale()` shrinks it proportionally to fit the actual
 * viewport. That way:
 *   - On the SUNMI (1280×800)         → scale = 1   (no surround, fills viewport)
 *   - On a 1920×1080 desktop          → scale = 1   (frame centered, dark surround)
 *   - On a 13"/14" laptop (~1440×900) → scale ≈ 1   (frame centered, dark surround)
 *   - On a 390×844 iPhone-narrow view → scale ≈ 0.3 (proportional miniature)
 *
 * Critical: the page tree always renders at 1280×800 pixels — only
 * the *visual* size changes. So tap targets, font sizes, and layout
 * decisions are always evaluated against the device pixel count
 * regardless of where you're previewing. You'll never get a
 * "looks fine on laptop, broken on device" mismatch.
 *
 * Implementation: a ResizeObserver on the outer surround dynamically
 * updates a `--cd-scale` CSS variable, which the inner frame
 * consumes via `transform: scale(var(--cd-scale))`. The frame keeps
 * its 1280×800 explicit dimensions so its child tree resolves
 * `h-full` etc. against those numbers; only the rendered size
 * changes.
 *
 * The companion CSS rule in globals.css (`.cd-frame .h-screen
 * { height: 100% !important }`) remaps viewport-relative heights
 * inside the frame to the frame's height — the existing page uses
 * `h-screen` heavily and we don't want to rewrite every component.
 */
export default function CustomerDisplayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const surroundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const surround = surroundRef.current;
    if (!surround) return;

    // Recompute the scale factor whenever the surround resizes. Uses
    // `Math.min(...)` so the frame fits both dimensions — never
    // overflows. Cap at 1 so we never UPSCALE past native res on
    // huge monitors (would just look fuzzy).
    const apply = () => {
      const w = surround.clientWidth;
      const h = surround.clientHeight;
      const scale = Math.min(w / 1280, h / 800, 1);
      surround.style.setProperty("--cd-scale", String(scale));
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(surround);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={surroundRef}
      className="cd-surround"
      style={{
        // Pure black surround so the espresso (#160800) frame inside
        // pops clearly on desktop previews. On the SUNMI itself the
        // frame fills the viewport and this color is never visible.
        backgroundColor: "#000000",
        minHeight: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        className="cd-frame"
        style={{
          // SUNMI D3 secondary display native resolution. The page
          // tree ALWAYS renders against these numbers; the scale
          // transform below only changes how big it looks.
          width: 1280,
          height: 800,
          overflow: "hidden",
          boxShadow: "0 0 0 1px rgba(245,243,240,0.08), 0 24px 60px rgba(0,0,0,0.6)",
          position: "relative",
          // transform-origin: center matches the flex centering on
          // the surround so the frame scales toward its own middle.
          transformOrigin: "center center",
          transform: "scale(var(--cd-scale, 1))",
        }}
      >
        {children}
      </div>
    </div>
  );
}
