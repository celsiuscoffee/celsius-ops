"use client";

import { useEffect, useRef } from "react";
import { POSProvider } from "@/lib/pos-context";

/**
 * Register frame — locks the cashier-facing page to the SUNMI D3
 * main display's native resolution (15.6", 1920×1080) so desktop
 * previews match the device exactly.
 *
 * Mirrors the customer-display frame at app/customer-display/layout.tsx
 * — same pattern, different dimensions. The page tree ALWAYS renders
 * at 1920×1080 device pixels; a CSS `transform: scale()` shrinks
 * the *visual* size to fit smaller viewports so a 13"/14" laptop
 * can still preview the full design proportionally without
 * clipping. On the SUNMI itself (1920×1080) the scale is 1 and
 * the frame fills the screen with no surround.
 *
 * The companion `.pos-frame .h-screen` rule in globals.css remaps
 * `h-screen` (100vh) inside the frame to `h-full` (= 1080px) so
 * the existing page tree resolves heights against the frame
 * instead of the actual viewport.
 *
 * `overflow: hidden` on the frame catches overflow bugs at design
 * time — if a panel doesn't fit in the SUNMI display, it won't
 * fit here either, and you'll see the clipping immediately.
 */
export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const surroundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const surround = surroundRef.current;
    if (!surround) return;

    // Recompute the scale factor whenever the surround resizes.
    // min(...) so we fit both dimensions; cap at 1 so we never
    // UPSCALE past native res (would just look fuzzy).
    const apply = () => {
      const w = surround.clientWidth;
      const h = surround.clientHeight;
      const scale = Math.min(w / 1920, h / 1080, 1);
      surround.style.setProperty("--pos-scale", String(scale));
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(surround);
    return () => ro.disconnect();
  }, []);

  return (
    <POSProvider>
      <div
        ref={surroundRef}
        className="pos-surround"
        style={{
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
          className="pos-frame"
          style={{
            // SUNMI D3 main display native resolution.
            width: 1920,
            height: 1080,
            overflow: "hidden",
            boxShadow: "0 0 0 1px rgba(245,243,240,0.08), 0 24px 60px rgba(0,0,0,0.6)",
            position: "relative",
            transformOrigin: "center center",
            transform: "scale(var(--pos-scale, 1))",
          }}
        >
          {children}
        </div>
      </div>
    </POSProvider>
  );
}
