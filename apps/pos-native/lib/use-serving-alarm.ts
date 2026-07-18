import { useCallback, useEffect, useRef, useState } from "react";
import { playAlarm, primeSounds } from "./chime";

/**
 * Serving-time escalation alarm. Sounds an urgent warble — and surfaces the
 * offending orders so the caller can show a popup — when an order has been open
 * past the serving-time TARGET without being actioned:
 *
 *   - pickup order → "Ready" not pressed within 15 min
 *   - QR table     → "Done"  not pressed within 15 min
 *
 * The caller passes the currently-open serving items (already filtered to "not
 * yet ready / not yet done" upstream — see register.tsx). This hook owns the
 * time math, the sound, and the live overdue list it RETURNS for the UI.
 *
 * It re-evaluates both on a timer (an order crossing the 15-min mark while it
 * just sits isn't a Realtime event) AND immediately whenever the list changes
 * (an order actioned, or a new already-late order appears). The alarm sounds
 * the moment an order FIRST goes overdue, then re-sounds on a cadence while
 * anything stays overdue, and the list/popup clears the instant it's actioned.
 */

export const SERVING_TARGET_MS = 15 * 60 * 1000; // 15 min (was 10 — too early during peak, disturbed customers)
const RECHECK_MS = 15 * 1000;                    // re-evaluate ages every 15s
const REPEAT_MS = 5 * 60 * 1000;                 // re-sound at most every 5 min while overdue (was 45s — too naggy at peak)

export type ServingItem = {
  id: string;
  createdAt: string;
  channel: "pickup" | "table";
  label: string; // order number ("C-1234") or table label ("T5")
};

function pickOverdue(items: ServingItem[], now: number): ServingItem[] {
  return items.filter((o) => {
    const t = new Date(o.createdAt).getTime();
    return Number.isFinite(t) && now - t > SERVING_TARGET_MS;
  });
}

const idKey = (list: ServingItem[]) => list.map((o) => o.id).sort().join("|");

/** Returns the orders currently past the serving target (for a popup), a
 *  `silence()` to mute the alarm for the orders overdue RIGHT NOW, and sounds
 *  the alarm while any unsilenced order remains. The mute is PER ORDER ID:
 *  staff can silence a warble they've acknowledged (e.g. the order was just
 *  served but its "done" event hasn't landed yet), serving one of several
 *  silenced orders keeps the rest muted, and a genuinely NEW overdue order
 *  always rings through. A silenced id is forgotten once it leaves the overdue
 *  set, so the same order re-fires only if it somehow goes overdue again. */
export function useServingAlarm(items: ServingItem[]): { overdue: ServingItem[]; silence: () => void } {
  // Always read the latest items inside the interval without re-arming it.
  const itemsRef = useRef<ServingItem[]>(items);
  itemsRef.current = items;
  const lastAlarmRef = useRef(0);
  const prevOverdueRef = useRef<Set<string>>(new Set());
  // Order ids staff have muted. Pruned to the live overdue set each tick.
  const silencedIdsRef = useRef<Set<string>>(new Set());
  const [overdue, setOverdue] = useState<ServingItem[]>([]);

  const evaluate = useCallback(() => {
    const now = Date.now();
    const od = pickOverdue(itemsRef.current, now);
    const odIds = new Set(od.map((o) => o.id));
    // Forget silences for orders no longer overdue (served / actioned).
    for (const id of silencedIdsRef.current) {
      if (!odIds.has(id)) silencedIdsRef.current.delete(id);
    }
    // An order that wasn't overdue a moment ago → ring straight away (don't
    // wait out the repeat window). Otherwise re-ring only every REPEAT_MS.
    const hasNew = od.some((o) => !prevOverdueRef.current.has(o.id));
    prevOverdueRef.current = odIds;
    setOverdue((prev) => (idKey(prev) === idKey(od) ? prev : od)); // avoid no-op re-renders
    if (od.length === 0) return;
    // Fully muted only when EVERY overdue order has been silenced — one
    // unacknowledged order keeps the escalation cadence alive.
    const allMuted = od.every((o) => silencedIdsRef.current.has(o.id));
    if (!allMuted && (hasNew || now - lastAlarmRef.current >= REPEAT_MS)) {
      lastAlarmRef.current = now;
      playAlarm();
    }
  }, []);

  // Mute the orders overdue right now (per id). New overdue orders still ring.
  const silence = useCallback(() => {
    for (const id of prevOverdueRef.current) silencedIdsRef.current.add(id);
  }, []);

  useEffect(() => {
    primeSounds();
    evaluate();
    const id = setInterval(evaluate, RECHECK_MS);
    return () => clearInterval(id);
  }, [evaluate]);

  // Re-evaluate the instant the list changes (order actioned → drop it; a new
  // already-late order arrives → ring + popup now, no wait for the next tick).
  useEffect(() => { evaluate(); }, [items, evaluate]);

  return { overdue, silence };
}
