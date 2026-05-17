// Web-only viewport diagnostic overlay. Renders absolute-fixed at the
// top of the screen and shows the values that drive bottom-nav
// positioning on iOS PWA standalone. Hidden behind ?debug=1 so it
// doesn't ship to regular users — the URL stays clean in app links.
//
// To use: open https://order.celsiuscoffee.com/?debug=1 on the device,
// screenshot the top-left strip, send to engineering.

import { useEffect, useState } from "react";

type Snap = {
  vh: number;
  iw: number;
  cw: number;
  ch: number;
  vvw: number;
  vvh: number;
  vvOffsetTop: number;
  vvScale: number;
  safeTop: string;
  safeBottom: string;
  bodyH: number;
  rootH: number;
  navBottomGap: string;
  isStandalone: boolean;
  ua: string;
};

function snapshot(): Snap {
  const html = document.documentElement;
  const body = document.body;
  const root = document.getElementById("root");
  const nav = document.querySelector('[class*="bottom-0"]') as HTMLElement | null;
  const navRect = nav?.getBoundingClientRect();

  // CSS env() values need a probe element since JS can't read them
  // directly. Use a hidden div with padding-bottom: env(...).
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);pointer-events:none;";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const safeTop = cs.paddingTop;
  const safeBottom = cs.paddingBottom;
  document.body.removeChild(probe);

  return {
    vh: window.innerHeight,
    iw: window.innerWidth,
    cw: html.clientWidth,
    ch: html.clientHeight,
    vvw: window.visualViewport?.width ?? 0,
    vvh: window.visualViewport?.height ?? 0,
    vvOffsetTop: window.visualViewport?.offsetTop ?? 0,
    vvScale: window.visualViewport?.scale ?? 1,
    safeTop,
    safeBottom,
    bodyH: body.offsetHeight,
    rootH: root?.offsetHeight ?? 0,
    navBottomGap: navRect
      ? `${Math.round(window.innerHeight - navRect.bottom)}px (vh-bot=${Math.round(navRect.bottom)})`
      : "no-nav-mounted-yet",
    isStandalone:
      (window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
      // iOS Safari quirk: window.navigator.standalone is true when launched
      // from Add-to-Home-Screen icon.
      Boolean((window.navigator as { standalone?: boolean }).standalone),
    ua: navigator.userAgent.slice(0, 70),
  };
}

export function DebugViewport() {
  const enabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("debug");
  const [snap, setSnap] = useState<Snap | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => setSnap(snapshot());
    tick();
    const id = window.setInterval(tick, 800);
    const onResize = () => tick();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("scroll", onResize);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
    };
  }, [enabled]);

  if (!enabled || !snap) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.85)",
        color: "#0f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
        lineHeight: 1.25,
        padding: "4px 6px",
        pointerEvents: "none",
        whiteSpace: "pre",
      }}
    >
      {`vh:${snap.vh} iw:${snap.iw} ch:${snap.ch}
vv:${snap.vvw}x${snap.vvh}@${snap.vvScale} off:${snap.vvOffsetTop}
safe-top:${snap.safeTop}  safe-bot:${snap.safeBottom}
body:${snap.bodyH} root:${snap.rootH}
nav-bottom-gap:${snap.navBottomGap}
standalone:${snap.isStandalone}`}
    </div>
  );
}
