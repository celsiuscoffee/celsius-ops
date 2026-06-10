import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

/**
 * Today's UNREVEALED mystery drops for this outlet — drives the register's
 * header 🎁 pill so staff can remind a customer who forgot to tap reveal
 * (~21 drops/day were going unrevealed when this shipped).
 *
 * A drop row (mystery_drops) is created when a qualifying sale completes;
 * revealed_at stays NULL until the customer taps reveal (customer display or
 * the Celsius app). Drops reference both in-store sales (pos_orders, keyed by
 * outlet_id) and app orders (orders, keyed by store_id) — we resolve both and
 * keep only this outlet's, carrying order number + loyalty phone so staff can
 * identify the customer ("ending 1234").
 *
 * Deliberately POLLED (60s) rather than a realtime channel: the prompt is a
 * reminder surface, freshness within a minute is plenty, and it avoids the
 * subscribe-churn crash class entirely. reload() is exposed so a completed
 * sale can refresh the count immediately.
 */
export type UnrevealedDrop = {
  id: string;
  orderNumber: string;
  source: "pos" | "app";
  phone: string | null;
  createdAt: string;
};

const POLL_MS = 60_000;

type DropRow = { id: string; order_id: string; created_at: string };
type OrderLite = { id: string; order_number: string; loyalty_phone: string | null };

export function useUnrevealedDrops(outletId: string | null | undefined) {
  const [drops, setDrops] = useState<UnrevealedDrop[]>([]);
  // pickup store_id ("conezion") for this POS outlet — resolved once.
  const storeIdRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!outletId) return;
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0); // today, local
      const { data } = await supabase
        .from("mystery_drops")
        .select("id, order_id, created_at")
        .is("revealed_at", null)
        .gte("created_at", start.toISOString())
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = (data ?? []) as DropRow[];
      if (rows.length === 0) {
        setDrops([]);
        return;
      }
      if (storeIdRef.current === null) {
        const { data: s } = await supabase
          .from("outlet_settings")
          .select("store_id")
          .eq("loyalty_outlet_id", outletId)
          .maybeSingle();
        storeIdRef.current = (s as { store_id?: string } | null)?.store_id ?? "";
      }
      const ids = rows.map((r) => r.order_id);
      const [posRes, appRes] = await Promise.all([
        supabase
          .from("pos_orders")
          .select("id, order_number, loyalty_phone")
          .in("id", ids)
          .eq("outlet_id", outletId),
        storeIdRef.current
          ? supabase
              .from("orders")
              .select("id, order_number, loyalty_phone")
              .in("id", ids)
              .eq("store_id", storeIdRef.current)
          : Promise.resolve({ data: [] as OrderLite[] }),
      ]);
      const byOrder = new Map<string, { n: string; p: string | null; src: "pos" | "app" }>();
      for (const o of ((posRes.data ?? []) as OrderLite[])) byOrder.set(o.id, { n: o.order_number, p: o.loyalty_phone, src: "pos" });
      for (const o of (((appRes as { data?: OrderLite[] }).data ?? []) as OrderLite[])) byOrder.set(o.id, { n: o.order_number, p: o.loyalty_phone, src: "app" });
      // Drops whose order belongs to another outlet simply don't resolve → dropped.
      setDrops(
        rows.flatMap((r) => {
          const o = byOrder.get(r.order_id);
          return o ? [{ id: r.id, orderNumber: o.n, source: o.src, phone: o.p, createdAt: r.created_at }] : [];
        }),
      );
    } catch {
      /* network blip — keep the last list; next poll refreshes */
    }
  }, [outletId]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  return { drops, count: drops.length, reload };
}

/** "+60123456789" → "…6789" — enough for staff to confirm with the customer
 *  without printing a whole phone number on a shared screen. */
export function maskPhone(p: string | null): string {
  if (!p) return "guest";
  const digits = p.replace(/\D/g, "");
  return digits.length >= 4 ? `…${digits.slice(-4)}` : "member";
}
