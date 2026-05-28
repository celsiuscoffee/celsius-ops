"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Customer-display layout.
 *
 * Two render modes (mirrors register/layout.tsx):
 *
 *  • DEVICE (Capacitor native app / real second screen): full-bleed.
 *    The page fills the actual WebView viewport with NO fixed-size
 *    frame and NO transform. Wrapping in a 1280×800 box + scaling
 *    on the SUNMI's GPU caused lag and mis-sized the UI when the
 *    WebView viewport wasn't exactly 1280×800. On the device we let
 *    the page be responsive to whatever the WebView gives us.
 *
 *  • DESKTOP PREVIEW (regular browser): the 1280×800 frame +
 *    scale-to-fit so we can eyeball the SUNMI second screen on a
 *    laptop. Purely a design aid; never reaches the device.
 *
 * Detection: `window.Capacitor?.isNativePlatform()`. Default to
 * full-bleed (fast path) and only switch ON the frame once we've
 * confirmed a non-native browser, so the device never mounts the
 * expensive transform.
 */
export default function CustomerDisplayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<"full" | "frame">("full");
  const surroundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isNative =
      typeof window !== "undefined" &&
      typeof (window as any)?.Capacitor?.isNativePlatform === "function" &&
      (window as any).Capacitor.isNativePlatform();
    if (!isNative) setMode("frame");
  }, []);

  useEffect(() => {
    if (mode !== "frame") return;
    const surround = surroundRef.current;
    if (!surround) return;
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
  }, [mode]);

  // Device / full-bleed.
  if (mode === "full") {
    return <>{children}</>;
  }

  // Desktop preview: fixed SUNMI second-screen frame, scaled to fit.
  return (
    <div
      ref={surroundRef}
      className="cd-surround"
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
        className="cd-frame"
        style={{
          width: 1280,
          height: 800,
          overflow: "hidden",
          boxShadow: "0 0 0 1px rgba(245,243,240,0.08), 0 24px 60px rgba(0,0,0,0.6)",
          position: "relative",
          transformOrigin: "center center",
          transform: "scale(var(--cd-scale, 1))",
        }}
      >
        {children}
      </div>
    </div>
  );
}
