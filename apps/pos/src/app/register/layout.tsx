"use client";

import { useEffect, useRef, useState } from "react";
import { POSProvider } from "@/lib/pos-context";

/**
 * Register layout.
 *
 * Two render modes:
 *
 *  • DEVICE (Capacitor native app on the SUNMI, or any real
 *    register screen): full-bleed. The page fills the actual
 *    viewport with NO fixed-size frame and NO transform. This is
 *    critical — wrapping the tree in a 1920×1080 box and applying
 *    `transform: scale()` on the SUNMI's Rockchip GPU caused heavy
 *    lag AND mis-sized the UI when the WebView viewport wasn't
 *    exactly 1920×1080 (status/nav bars, density). On the device
 *    we want the page to simply be responsive to whatever the
 *    WebView gives us.
 *
 *  • DESKTOP PREVIEW (regular browser): the 1920×1080 frame +
 *    scale-to-fit, so we can eyeball the SUNMI layout on a laptop.
 *    Purely a design aid; never reaches the device.
 *
 * Detection: `window.Capacitor?.isNativePlatform()`. We default to
 * full-bleed (the safe, fast path) and only switch ON the frame
 * once we've confirmed we're in a non-native browser — so the
 * device never even briefly mounts the expensive transform.
 */
export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // "full" = device / full-bleed (default). "frame" = desktop preview.
  const [mode, setMode] = useState<"full" | "frame">("full");
  const surroundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isNative =
      typeof window !== "undefined" &&
      typeof (window as any)?.Capacitor?.isNativePlatform === "function" &&
      (window as any).Capacitor.isNativePlatform();
    // Only a non-native desktop browser gets the preview frame.
    if (!isNative) setMode("frame");
  }, []);

  // Scale-to-fit only runs in preview (frame) mode.
  useEffect(() => {
    if (mode !== "frame") return;
    const surround = surroundRef.current;
    if (!surround) return;
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
  }, [mode]);

  // Device / full-bleed: render the page directly against the real
  // viewport. No frame, no transform — fixes both the lag and the
  // size mismatch on the SUNMI.
  if (mode === "full") {
    return <POSProvider>{children}</POSProvider>;
  }

  // Desktop preview: fixed SUNMI-resolution frame, scaled to fit.
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
