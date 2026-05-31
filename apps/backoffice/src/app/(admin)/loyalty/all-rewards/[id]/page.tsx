"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import RewardForm, { type FormValue, type DiscountType, type Scope } from "../RewardForm";

const BRAND_ID = "brand-celsius";

type ApiRow = {
  id: string;
  origin: "template" | "catalog";
  title: string;
  description: string | null;
  icon: string | null;
  discount_type: string | null;
  discount_value: number | null;
  scope: Scope;
  target_ids: string[];
  is_active: boolean;
  max_discount_value: number | null;
  min_order_value: number | null;
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  multiplier_value: number | null;
  expires_days: number | null;
  triggers: { type: string }[];
};

export default function EditRewardPage() {
  const params = useParams<{ id: string }>();
  const [initial, setInitial] = useState<Partial<FormValue> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/loyalty/all-rewards?brand_id=${BRAND_ID}`, { credentials: "include" })
      .then((res) => res.json())
      .then((json: { rows: ApiRow[] }) => {
        if (cancelled) return;
        const row = json.rows.find((r) => r.id === params.id);
        if (!row) {
          setError("Reward not found");
          return;
        }
        const triggers: FormValue["triggers"] = {};
        for (const t of row.triggers) {
          (triggers as Record<string, Record<string, unknown>>)[t.type] = {};
        }
        setInitial({
          id: row.id,
          title: row.title,
          description: row.description ?? "",
          icon: row.icon ?? "ticket",
          discount_type: (row.discount_type as DiscountType) ?? "free_item",
          discount_value: row.discount_value,
          max_discount_value: row.max_discount_value,
          min_order_value: row.min_order_value,
          multiplier_value: row.multiplier_value,
          bogo_buy_qty: row.bogo_buy_qty ?? 1,
          bogo_free_qty: row.bogo_free_qty ?? 1,
          scope: row.scope,
          target_ids: row.target_ids,
          modifier_filter: {},
          validity_days: row.expires_days ?? 30,
          stacks_with_beans: true,
          stacks_with_other: false,
          is_active: row.is_active,
          triggers,
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
    return () => { cancelled = true; };
  }, [params.id]);

  if (error) {
    return (
      <div className="px-6 py-6 max-w-3xl mx-auto">
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-700">{error}</div>
      </div>
    );
  }
  if (!initial) {
    return (
      <div className="px-6 py-6 max-w-3xl mx-auto text-slate-500">Loading…</div>
    );
  }
  return <RewardForm mode="edit" initial={initial} />;
}
