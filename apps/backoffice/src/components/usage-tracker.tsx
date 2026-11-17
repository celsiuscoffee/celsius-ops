"use client";

// Office usage (declutter, 17 Nov 2026; ported from Gosamē Office): which
// pages people open, and on which device, so the menu follows what is really
// used. Internal only: one POST to this app's /api/usage per page view, stored
// in ActivityLog (module "usage", action "view"); no outside service, no
// cookies of its own. Read back on Settings › Office Usage.
import { useEffect } from "react";

const SAME_PAGE_MS = 30_000;
let last: { path: string; at: number } | null = null;

/** Records a view of `pathname` once it settles; the same path again within 30 s counts once. */
export function useUsageTracking(pathname: string | null) {
  useEffect(() => {
    if (!pathname) return;
    const now = Date.now();
    if (last && last.path === pathname && now - last.at < SAME_PAGE_MS) return;
    // a page the person only passed through (a redirect, a fast click on) is not a view
    const timer = window.setTimeout(() => {
      last = { path: pathname, at: Date.now() };
      // the shell's phone layout is below 768 px (md)
      const viewport = window.matchMedia("(min-width: 768px)").matches ? "desktop" : "phone";
      fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname, viewport }),
        keepalive: true,
      }).catch(() => { /* usage is best effort: never bother the person with it */ });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [pathname]);
}
