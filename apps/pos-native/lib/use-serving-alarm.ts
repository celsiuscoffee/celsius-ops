import { useCallback, useEffect, useRef, useState } from "react";
import { playAlarm, primeSounds } from "./chime";

/**
 * Serving-time escalation alarm. Sounds an urgent warble — and surfaces the
 * offending orders so the caller can show a popup — when an order has been open
 * past the serving-time TARGET without being actioned:
 *
 *   - pickup order → "Ready" not pressed within 10 min
 *   - QR table     → "Done"  not pressed within 10 min
 *
 * The caller passes the currently-open serving items (already filtered to "not
 * yet ready / not yet done" upstream — see register.tsx). This hook owns the
 * time math, the sound, and the live overdue list it RETURNS for the UI.
 *
 * It re-evaluates both on a timer (an order crossing the 10-min mark while it
 * just sits isn't a Realtime event) AND immediately whenever the list changes
 * (an order actioned, or a new already-late order appears). The alarm sounds
 * the moment an order FIRST goes overdue, then re-sounds on a cadence while
 * anything stays overdue, and the list/popup clears the instant it's actioned.
 */

export const SERVING_TARGET_MS = 10 * 60 * 1000; // 10 min
const RECHECK_MS = 15 * 1000;                    // re-evaluate ages every 15s
const REPEAT_MS = 45 * 1000;                     // re-sound at most every 45s while overdue

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

/** Returns the orders currently past the serving target (for a popup) and
 *  sounds the alarm while any remain. */
export function useServingAlarm(items: ServingItem[]): ServingItem[] {
  // Always read the latest items inside the interval without re-arming it.
  const itemsRef = useRef<ServingItem[]>(items);
  itemsRef.current = items;
  const lastAlarmRef = useRef(0);
  const prevOverdueRef = useRef<Set<string>>(new Set());
  const [overdue, setOverdue] = useState<ServingItem[]>([]);

  const evaluate = useCallback(() => {
    const now = Date.now();
    const od = pickOverdue(itemsRef.current, now);
    // An order that wasn't overdue a moment ago → ring straight away (don't
    // wait out the repeat window). Otherwise re-ring only every REPEAT_MS.
    const hasNew = od.some((o) => !prevOverdueRef.current.has(o.id));
    prevOverdueRef.current = new Set(od.map((o) => o.id));
    setOverdue((prev) => (idKey(prev) === idKey(od) ? prev : od)); // avoid no-op re-renders
    if (od.length > 0 && (hasNew || now - lastAlarmRef.current >= REPEAT_MS)) {
      lastAlarmRef.current = now;
      playAlarm();
    }
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

  return overdue;
}
