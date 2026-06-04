import { useEffect, useRef } from "react";
import { playAlarm, primeSounds } from "./chime";

/**
 * Serving-time escalation alarm. Sounds an urgent warble when an order has been
 * open past the serving-time TARGET without being actioned:
 *
 *   - pickup order → "Ready" not pressed within 10 min
 *   - QR table     → "Done"  not pressed within 10 min
 *
 * Caller passes the currently-open serving items (already filtered to "not yet
 * ready / not yet done" upstream — see register.tsx), each with the timestamp
 * the clock started (order created_at). This hook owns only the time math + the
 * sound: it re-checks ages on an interval (the 10-min mark won't arrive as a
 * Realtime event) and re-sounds on a cadence while anything stays overdue, so a
 * breach can't be slept through. Goes quiet the moment the list clears.
 */

export const SERVING_TARGET_MS = 10 * 60 * 1000; // 10 min
const RECHECK_MS = 20 * 1000;                    // re-evaluate ages every 20s
const REPEAT_MS = 45 * 1000;                     // re-sound at most every 45s while overdue

export type ServingItem = { id: string; createdAt: string };

export function useServingAlarm(items: ServingItem[]) {
  // Always read the latest items inside the interval without re-arming it.
  const itemsRef = useRef<ServingItem[]>(items);
  itemsRef.current = items;
  const lastAlarmRef = useRef(0);

  useEffect(() => {
    primeSounds();
    const tick = () => {
      const now = Date.now();
      const overdue = itemsRef.current.some((o) => {
        const started = new Date(o.createdAt).getTime();
        return Number.isFinite(started) && now - started > SERVING_TARGET_MS;
      });
      if (overdue && now - lastAlarmRef.current >= REPEAT_MS) {
        lastAlarmRef.current = now;
        playAlarm();
      }
    };
    tick(); // check immediately on mount (covers orders already overdue)
    const id = setInterval(tick, RECHECK_MS);
    return () => clearInterval(id);
  }, []);
}
