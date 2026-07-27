"use client";

import { useCallback, useRef } from "react";

/**
 * Guards against the stale-response race that plagues filtered dashboards:
 * changing an outlet/date/period filter fires a new fetch while an older,
 * slower one is still in flight, and if the old response resolves last it
 * overwrites the newer filtered data — the page reads as "not updated when
 * filter" (the exact bug reported on Sales Compare and Cashier Performance).
 *
 * Usage:
 *   const beginRequest = useLatestRequest();
 *   const load = useCallback(async () => {
 *     const { signal, isCurrent } = beginRequest();   // aborts the previous
 *     const res = await fetch(url, { signal });
 *     if (!isCurrent()) return;                        // superseded — drop
 *     const json = await res.json();
 *     if (!isCurrent()) return;
 *     setData(json);
 *   }, [beginRequest, ...deps]);
 *
 * `beginRequest()`:
 *   - bumps an internal sequence counter and aborts the prior controller
 *     (so the network request is actually cancelled, not just ignored — a
 *     small speed win too: no wasted work on abandoned filters),
 *   - returns `{ signal, isCurrent }`. Pass `signal` to fetch; call
 *     `isCurrent()` after every await and bail if false.
 *
 * Also handle AbortError in your catch: `if (e?.name === "AbortError") return;`
 * (or just `if (!isCurrent()) return;` first, which covers it).
 */
export function useLatestRequest(): () => { signal: AbortSignal; isCurrent: () => boolean } {
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  return useCallback(() => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return { signal: controller.signal, isCurrent: () => seq === seqRef.current };
  }, []);
}
