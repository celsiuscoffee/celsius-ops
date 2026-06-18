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
    if (silencedIds.has(o.id)) return false; // cashier already actioned it
    const t = new Date(o.createdAt).getTime();
    return Number.isFinite(t) && now - t > SERVING_TARGET_MS;
  });
}

const idKey = (list: ServingItem[]) => list.map((o) => o.id).sort().join("|");

// Orders the cashier has ALREADY actioned (Done / Ready). Silenced immediately
// on tap so the alarm + popup stop AT ONCE — without waiting for the orders/
// tables list to refresh. That refresh can lag or be missed (dropped Realtime),
// which is what left a "done" order still sounding the serving alarm. Module-
// level (survives remounts) + capped. Order ids are unique uuids, so a silenced
// id can never suppress a future order.
const silencedIds = new Set<string>();
/** Stop the serving alarm for an order the moment it's actioned (Done/Ready). */
export function silenceServingAlarmOrder(id: string | null | undefined): void {
  if (!id) return;
  silencedIds.add(id);
  if (silencedIds.size > 1000) {
    for (const old of [...silencedIds].slice(0, 500)) silencedIds.delete(old);
  }
}

// MODULE-LEVEL state — survives a screen REMOUNT (a per-component ref reset on
// every remount, making every still-overdue order look "new" → re-alarm).
//
// servingAlarmedIds ACCUMULATES the ids we've already sounded the first overdue
// alarm for; it is NOT reset to the current overdue set each tick. That matters:
// an orders/tables reload can briefly drop an overdue order from the list and
// re-add it — keying "new" off "overdue last tick" would re-alarm on that flap.
// Served orders get fresh uuids and never reappear, so never re-alarming a known
// id is correct; the 5-min REPEAT_MS cadence still drives the ongoing nag.
// Capped so it can't grow unbounded over a long shift.
const servingAlarmedIds = new Set<string>();
let servingLastAlarmAt = 0;

/** Returns the orders currently past the serving target (for a popup) and
 *  sounds the alarm while any remain. */
export function useServingAlarm(items: ServingItem[]): ServingItem[] {
  // Always read the latest items inside the interval without re-arming it.
  const itemsRef = useRef<ServingItem[]>(items);
  itemsRef.current = items;
  const [overdue, setOverdue] = useState<ServingItem[]>([]);

  const evaluate = useCallback(() => {
    const now = Date.now();
    const od = pickOverdue(itemsRef.current, now);
    // An order we've NEVER alarmed for → ring straight away (don't wait out the
    // repeat window). Judged against the accumulating module set, so neither a
    // remount nor a transient list refresh re-triggers a "first" alarm.
    const hasNew = od.some((o) => !servingAlarmedIds.has(o.id));
    for (const o of od) servingAlarmedIds.add(o.id);
    if (servingAlarmedIds.size > 1000) {
      for (const old of [...servingAlarmedIds].slice(0, 500)) servingAlarmedIds.delete(old);
    }
    setOverdue((prev) => (idKey(prev) === idKey(od) ? prev : od)); // avoid no-op re-renders
    if (od.length > 0 && (hasNew || now - servingLastAlarmAt >= REPEAT_MS)) {
      servingLastAlarmAt = now;
      playAlarm();
    }
    // Note: servingAlarmedIds intentionally keeps served orders' ids until the
    // cap evicts them — re-adding the same id can't happen (uuids are unique),
    // so a served order is never re-alarmed.
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
