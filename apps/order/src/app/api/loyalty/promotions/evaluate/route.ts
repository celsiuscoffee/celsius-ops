import { NextRequest, NextResponse } from "next/server";
import { evaluatePromotions, type CartLine } from "@/lib/loyalty/promotions";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// POST /api/loyalty/promotions/evaluate
//
// Returns the same shape as the loyalty app's /api/promotions/evaluate
// but routed through `evaluatePromotions()` in lib/loyalty/promotions
// so the response includes the tier % post-step. The previous version
// was a raw proxy that skipped the tier layering — the customer would
// see "RM14.90 total" at checkout (no tier %), then the order route
// would re-evaluate WITH the tier layer and store a smaller total,
// producing a confusing preview ↔ receipt mismatch on Silver / Gold /
// Platinum / Staff / Black Card members.
//
// Now also: server-side category fallback. Category-gated combos
// ("any classic drink + any roti bakar") need `line.category` set or
// the gate fails closed. /api/orders and /api/checkout/initiate already
// look up categories from the products table before evaluating; this
// proxy does the same so the checkout preview matches what the order
// route eventually charges. Without this fix, customers see the
// pre-combo total at the preview and the post-combo total only after
// pressing Place Order — which reads as a surprise, even though it's
// a pleasant one.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      lines?: CartLine[];
      member_id?: string | null;
      outlet_id?: string | null;
      member_tier_id?: string | null;
      // First-order-discount preview context. FOD is a native-app-only
      // perk resolved at order create (/api/orders); the promo engine
      // excludes trigger_type='first_order' so it can't double-apply.
      // That left the native checkout previewing full price while the
      // PaymentIntent charged 10% less — reads as "no discount" to a
      // new customer. When the caller declares a native source + the
      // customer's phone, mirror the order route's eligibility check
      // here so the preview can show the same number the order will
      // charge. Callers that omit these fields (web PWA, older app
      // bundles) get `first_order: null` and behave as before.
      loyalty_phone?: string | null;
      source?: string | null;
    };

    const lines = body.lines ?? [];

    // Backfill missing category from the products table so category-
    // gated combos can fire even if the client forgot to send it.
    const idsNeedingCategory = lines
      .filter((l) => !l.category && l.product_id)
      .map((l) => l.product_id);
    const categoryByProductId = new Map<string, string | null>();
    if (idsNeedingCategory.length > 0) {
      const supabase = getSupabaseAdmin();
      const { data: rows } = await supabase
        .from("products")
        .select("id, category")
        .in("id", idsNeedingCategory);
      for (const r of ((rows ?? []) as Array<{ id: string; category: string | null }>)) {
        categoryByProductId.set(r.id, r.category);
      }
    }
    const enrichedLines: CartLine[] = lines.map((l) => ({
      ...l,
      category: l.category ?? categoryByProductId.get(l.product_id) ?? undefined,
    }));

    const result = await evaluatePromotions({
      lines: enrichedLines,
      member_id: body.member_id ?? null,
      outlet_id: body.outlet_id ?? null,
      member_tier_id: body.member_tier_id ?? null,
    });

    // First-order discount preview — same gates as /api/orders: native
    // source, a phone with zero prior active/completed orders, and an
    // active first_order promo row. PREVIEW ONLY: the order route
    // re-validates independently, so a spoofed `source` here can only
    // change what the screen shows, never what gets charged.
    let firstOrder: { name: string; discount_amount: number } | null = null;
    const fodNativeOk = body.source === "app_ios" || body.source === "app_android";
    if (fodNativeOk && body.loyalty_phone) {
      const supabase = getSupabaseAdmin();
      const [{ data: fodRow }, { count }] = await Promise.all([
        supabase
          .from("promotions")
          .select("name, discount_type, discount_value")
          .eq("brand_id", "brand-celsius")
          .eq("trigger_type", "first_order")
          .eq("is_active", true)
          .order("priority", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("loyalty_phone", body.loyalty_phone)
          .in("status", ["completed", "preparing", "ready", "paid"]),
      ]);
      if (fodRow && (count ?? 0) === 0) {
        const value = Number(fodRow.discount_value ?? 0);
        const amount = (fodRow.discount_type as string) === "percentage_off"
          ? Math.round(result.subtotal * value) / 100
          : Math.min(value, result.subtotal);
        if (amount > 0) {
          firstOrder = {
            name: (fodRow.name as string) || "First order discount",
            discount_amount: amount,
          };
        }
      }
    }

    return NextResponse.json({ ...result, first_order: firstOrder });
  } catch (err) {
    console.error("promotions/evaluate proxy error:", err);
    return NextResponse.json(
      { error: "Failed to evaluate promotions" },
      { status: 500 }
    );
  }
}
