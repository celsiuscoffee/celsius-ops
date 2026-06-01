import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// PATCH /api/pickup/products/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;

  const update: Record<string, unknown> = {};

  if (typeof body.base_price_rm === "number") {
    update.price = body.base_price_rm;
  }
  if (typeof body.name === "string")         update.name         = body.name;
  if (typeof body.description === "string")  update.description  = body.description;
  if (typeof body.category_id === "string")  update.category     = body.category_id;
  if (typeof body.image === "string")        update.image_url    = body.image;
  if (typeof body.is_available === "boolean") update.is_available = body.is_available;
  if (typeof body.is_popular === "boolean")  update.is_featured  = body.is_popular;
  if (typeof body.position === "number" && Number.isFinite(body.position)) {
    update.position = Math.round(body.position);
  }
  if (typeof body.featured_position === "number" && Number.isFinite(body.featured_position)) {
    update.featured_position = Math.round(body.featured_position);
  }

  // Soft-blacklist of modifier group IDs / option IDs the merchant wants to
  // hide from customers. Stored as jsonb array; sync from StoreHub leaves
  // this field alone, so deletions persist across re-syncs.
  if (Array.isArray(body.hidden_modifier_ids)) {
    update.hidden_modifier_ids = body.hidden_modifier_ids.filter((x): x is string => typeof x === "string");
  }

  // Modifier groups — backoffice-owned (we no longer pull these from StoreHub
  // sync, so the merchant manages them directly here). Stored as jsonb on
  // products.modifiers. Shape mirrors StoreHub: group { id, name, multiSelect,
  // options: [{ id, label, priceDelta, isDefault }] }.
  if (Array.isArray(body.modifiers)) {
    update.modifiers = body.modifiers;
  }

  // StoreHub-parity fields — added 2026-05-24 per consolidation.
  if (typeof body.print_additional_docket === "boolean") {
    update.print_additional_docket = body.print_additional_docket;
  }
  // Kitchen station — empty string from the form means "no kitchen
  // docket"; store NULL so the printer router knows to skip.
  if (typeof body.kitchen_station === "string" || body.kitchen_station === null) {
    const s = (body.kitchen_station ?? "").toString().trim();
    update.kitchen_station = s === "" ? null : s;
  }
  if (typeof body.e_invoice_classification_code === "string" || body.e_invoice_classification_code === null) {
    update.e_invoice_classification_code = body.e_invoice_classification_code || null;
  }
  if ("schedule_start_date" in body) update.schedule_start_date = body.schedule_start_date || null;
  if ("schedule_end_date"   in body) update.schedule_end_date   = body.schedule_end_date   || null;
  if (Array.isArray(body.schedule_days_of_week)) {
    // 0=Sun..6=Sat; clamp to valid range.
    update.schedule_days_of_week = body.schedule_days_of_week
      .filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6);
  } else if (body.schedule_days_of_week === null) {
    update.schedule_days_of_week = null;
  }
  if ("schedule_time_from" in body) update.schedule_time_from = body.schedule_time_from || null;
  if ("schedule_time_to"   in body) update.schedule_time_to   = body.schedule_time_to   || null;

  // Channel-specific pricing (StoreHub-parity, 2026-05-26). Treat ""/null/undefined
  // as "clear" so the merchant can revert a channel back to base price.
  const channelPriceKeys = ["price_pickup", "price_grab", "price_foodpanda", "price_dinein"] as const;
  for (const k of channelPriceKeys) {
    if (k in body) {
      const v = body[k];
      if (v === null || v === "" || typeof v === "undefined") {
        update[k] = null;
      } else if (typeof v === "number" && Number.isFinite(v)) {
        update[k] = v;
      } else if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) {
        update[k] = Number(v);
      }
    }
  }

  // Per-product SST tax overrides. Null/empty clears the override so
  // the outlet-level default applies again. The LHDN e-Invoice
  // classification code is on the older e_invoice_classification_code
  // column, handled elsewhere in this PATCH.
  if ("tax_rate" in body) {
    const v = body.tax_rate;
    if (v === null || v === "" || typeof v === "undefined") {
      update.tax_rate = null;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      update.tax_rate = v;
    } else if (typeof v === "string" && !isNaN(Number(v))) {
      update.tax_rate = Number(v);
    }
  }
  if (typeof body.tax_inclusive === "boolean") {
    update.tax_inclusive = body.tax_inclusive;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("products")
    .update(update)
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/pickup/products/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(_request);
  if (auth.error) return auth.error;
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
