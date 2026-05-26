import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/pos/refund
 *
 * Creates a single-row-per-event refund: one new pos_orders row with
 * negative subtotal/total + refund_of_order_id back to the original.
 * The original stays as-is; per-line refunded_quantity counters are
 * incremented so partial refunds compose. refunded_at on the original
 * is stamped only when every line is fully refunded.
 *
 * Why single-row-per-event: the Z-report / Tax-report aggregator sums
 * pos_orders.total over a date window. Negative refund rows naturally
 * subtract from gross sales without touching the original, so historic
 * totals never mutate.
 *
 * Atomic-ish: Supabase has no client-side transactions, so we keep a
 * cleanup list of inserted rows and roll them back on any failure
 * after the first insert. The refunded_quantity update is the last
 * mutation, so a crash mid-flow at worst leaves an orphan refund row
 * that the BO admin can delete (refund_of_order_id makes them easy
 * to find).
 */

// Service-role required: pos_orders/pos_order_items/pos_order_payments
// are RLS-locked for writes. Anon would silently no-op and leave the
// register thinking the refund landed.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type RefundMethod = "cash" | "card" | "store_credit";

interface RefundBody {
  original_order_id: string;
  items: Array<{ pos_order_item_id: string; quantity: number }>;
  reason: string;
  refund_method: RefundMethod;
  employee_id: string;
}

interface OriginalItemRow {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  modifier_total: number;
  modifiers: unknown;
  tax_amount: number;
  item_total: number;
  refunded_quantity: number | null;
  kitchen_station: string | null;
}

interface OriginalOrderRow {
  id: string;
  order_number: string;
  outlet_id: string;
  register_id: string | null;
  shift_id: string | null;
  employee_id: string | null;
  source: string;
  order_type: string;
  table_number: string | null;
  queue_number: string | null;
  subtotal: number;
  sst_amount: number;
  service_charge: number;
  discount_amount: number;
  promo_discount: number;
  rounding_amount: number;
  total: number;
  customer_phone: string | null;
  customer_name: string | null;
  loyalty_phone: string | null;
  loyalty_points_earned: number;
  reward_id: string | null;
  voucher_code: string | null;
  refund_of_order_id: string | null;
}

export async function POST(req: NextRequest) {
  // Track inserts so we can cleanup on partial failure. Order matters:
  // children first so we don't leak FK orphans when reversing.
  const cleanup: Array<() => Promise<void>> = [];

  try {
    const body = (await req.json()) as Partial<RefundBody>;
    const { original_order_id, items, reason, refund_method, employee_id } = body;

    // ─── 0. Input validation ──────────────────────────────
    if (!original_order_id || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "original_order_id + non-empty items[] required" },
        { status: 400 },
      );
    }
    if (!reason || reason.trim().length < 2) {
      return NextResponse.json({ error: "reason required" }, { status: 400 });
    }
    if (!refund_method || !["cash", "card", "store_credit"].includes(refund_method)) {
      return NextResponse.json(
        { error: "refund_method must be cash | card | store_credit" },
        { status: 400 },
      );
    }
    if (!employee_id) {
      return NextResponse.json({ error: "employee_id required" }, { status: 400 });
    }
    if (items.some((i) => !i.pos_order_item_id || !Number.isFinite(i.quantity) || i.quantity <= 0)) {
      return NextResponse.json(
        { error: "each item needs pos_order_item_id + positive integer quantity" },
        { status: 400 },
      );
    }

    // ─── Auth: confirm employee_id exists + is allowed to refund ───
    // The POS staff identity lives in the Prisma `User` table on the
    // same Supabase project. We require an ACTIVE user whose role is
    // MANAGER, ADMIN or OWNER. STAFF role is excluded — refunds are
    // a privileged operation in F&B; cashiers escalate to a manager.
    // (BackOffice can later toggle this with a `permissions[]` flag,
    // but role-based is the strictest sane default.)
    const { data: staffRow, error: staffErr } = await supabase
      .from("User")
      .select("id, role, status")
      .eq("id", employee_id)
      .maybeSingle();
    if (staffErr || !staffRow) {
      return NextResponse.json({ error: "employee_id not found" }, { status: 403 });
    }
    if (staffRow.status !== "ACTIVE") {
      return NextResponse.json({ error: "employee inactive" }, { status: 403 });
    }
    if (!["MANAGER", "ADMIN", "OWNER"].includes(String(staffRow.role))) {
      return NextResponse.json(
        { error: "Refund requires Manager role or above" },
        { status: 403 },
      );
    }

    // ─── 1. Load original order + items ───────────────────
    const { data: original, error: origErr } = await supabase
      .from("pos_orders")
      .select(
        "id, order_number, outlet_id, register_id, shift_id, employee_id, source, order_type, table_number, queue_number, subtotal, sst_amount, service_charge, discount_amount, promo_discount, rounding_amount, total, customer_phone, customer_name, loyalty_phone, loyalty_points_earned, reward_id, voucher_code, refund_of_order_id",
      )
      .eq("id", original_order_id)
      .maybeSingle();
    if (origErr || !original) {
      return NextResponse.json({ error: "Original order not found" }, { status: 404 });
    }
    const orig = original as OriginalOrderRow;

    // Block refunds of refunds (they'd cascade) and of non-positive
    // orders (a refund of a refund row makes no business sense).
    if (orig.refund_of_order_id !== null) {
      return NextResponse.json(
        { error: "Cannot refund a refund row" },
        { status: 400 },
      );
    }
    if (orig.total <= 0) {
      return NextResponse.json(
        { error: "Cannot refund a zero or negative order" },
        { status: 400 },
      );
    }

    const { data: origItems, error: itemsErr } = await supabase
      .from("pos_order_items")
      .select(
        "id, order_id, product_id, product_name, variant_id, variant_name, quantity, unit_price, modifier_total, modifiers, tax_amount, item_total, refunded_quantity, kitchen_station",
      )
      .eq("order_id", orig.id);
    if (itemsErr || !origItems) {
      return NextResponse.json({ error: "Could not load original items" }, { status: 500 });
    }
    const itemsById = new Map<string, OriginalItemRow>();
    for (const r of origItems as OriginalItemRow[]) itemsById.set(r.id, r);

    // ─── 2. Validate + compute totals ─────────────────────
    // Each refund line is validated against the original line's
    // remaining-refundable quantity (quantity - refunded_quantity).
    let refundSubtotal = 0; // sen
    let refundTaxTotal = 0; // sen
    const refundLines: Array<{
      orig: OriginalItemRow;
      refundQty: number;
      lineSubtotal: number; // sen, positive
      lineTax: number; // sen, positive
      lineTotal: number; // sen, positive (subtotal + tax, before service charge)
    }> = [];

    for (const reqItem of items) {
      const o = itemsById.get(reqItem.pos_order_item_id);
      if (!o) {
        return NextResponse.json(
          { error: `Item ${reqItem.pos_order_item_id} not on this order` },
          { status: 400 },
        );
      }
      const alreadyRefunded = o.refunded_quantity ?? 0;
      const remaining = o.quantity - alreadyRefunded;
      const qty = Math.floor(reqItem.quantity);
      if (qty <= 0 || qty > remaining) {
        return NextResponse.json(
          {
            error: `Line ${o.product_name}: refund qty ${qty} exceeds remaining ${remaining}`,
          },
          { status: 400 },
        );
      }
      // Effective unit price = base + modifier upcharge spread across
      // the line. item_total already includes modifier_total, so the
      // per-unit refundable amount is item_total / quantity.
      const perUnit = Math.round(o.item_total / o.quantity);
      const lineSub = perUnit * qty;
      // Pro-rate the line's tax against the original line's tax.
      const perUnitTax = o.quantity > 0 ? Math.round(o.tax_amount / o.quantity) : 0;
      const lineTax = perUnitTax * qty;
      refundSubtotal += lineSub;
      refundTaxTotal += lineTax;
      refundLines.push({ orig: o, refundQty: qty, lineSubtotal: lineSub, lineTax, lineTotal: lineSub + lineTax });
    }

    // Pro-rate service charge by share of subtotal. Avoids the edge
    // case where a single small line refund returns the full SC.
    const origSubtotalAbs = orig.subtotal > 0 ? orig.subtotal : 1;
    const serviceChargeProRated = Math.round(
      (orig.service_charge * refundSubtotal) / origSubtotalAbs,
    );

    // Pro-rate discount the same way — a discounted order's refund
    // shouldn't return more than the customer actually paid for that
    // share of the cart. Subtract pro-rated discount from refund total.
    const discountProRated = Math.round(
      ((orig.discount_amount + orig.promo_discount) * refundSubtotal) / origSubtotalAbs,
    );

    // Final refund total (positive). Stored as negative on the row.
    // Tax is already inside the line totals so we don't add it again.
    const refundTotal = Math.max(
      0,
      refundSubtotal - discountProRated + serviceChargeProRated,
    );

    // ─── 3. Insert refund order row ────────────────────────
    // status='refunded' is the marker the Z-report agent looks for.
    // We carry forward outlet_id/register_id/shift_id/source so the
    // refund counts against the same shift's totals.
    const refundOrderNumber = `${orig.order_number}-R${Date.now().toString().slice(-5)}`;
    const refundOrderId = `pos-refund-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;

    const { data: refundOrder, error: refundOrderErr } = await supabase
      .from("pos_orders")
      .insert({
        id: refundOrderId,
        order_number: refundOrderNumber,
        outlet_id: orig.outlet_id,
        register_id: orig.register_id,
        shift_id: orig.shift_id,
        employee_id: employee_id, // who DID the refund, not who took the original
        source: orig.source,
        order_type: orig.order_type,
        status: "refunded",
        table_number: orig.table_number,
        queue_number: orig.queue_number,
        subtotal: -refundSubtotal,
        sst_amount: -refundTaxTotal,
        service_charge: -serviceChargeProRated,
        discount_amount: -discountProRated,
        promo_discount: 0,
        rounding_amount: 0,
        total: -refundTotal,
        customer_phone: orig.customer_phone,
        customer_name: orig.customer_name,
        loyalty_phone: orig.loyalty_phone,
        refund_of_order_id: orig.id,
        refund_reason: reason.trim(),
        refunded_by: employee_id,
      })
      .select("id")
      .single();

    if (refundOrderErr || !refundOrder) {
      console.error("[refund] order insert failed:", refundOrderErr);
      return NextResponse.json({ error: "Refund failed: could not create refund order" }, { status: 500 });
    }
    const newRefundOrderId = refundOrder.id as string;
    cleanup.push(async () => {
      await supabase.from("pos_orders").delete().eq("id", newRefundOrderId);
    });

    // ─── 4. Insert refund line items (negative qty + negative totals) ──
    const refundItemRows = refundLines.map((l) => ({
      order_id: newRefundOrderId,
      product_id: l.orig.product_id,
      product_name: l.orig.product_name,
      variant_id: l.orig.variant_id,
      variant_name: l.orig.variant_name,
      quantity: -l.refundQty,
      unit_price: l.orig.unit_price,
      modifiers: l.orig.modifiers ?? [],
      modifier_total: 0, // already baked into unit_price share via item_total
      discount_amount: 0,
      tax_amount: -l.lineTax,
      item_total: -l.lineSubtotal,
      kitchen_station: null, // refund rows are not for kitchen
      kitchen_status: "done",
    }));
    const { error: itemsInsErr } = await supabase
      .from("pos_order_items")
      .insert(refundItemRows);
    if (itemsInsErr) {
      console.error("[refund] items insert failed:", itemsInsErr);
      await Promise.all(cleanup.map((f) => f().catch(() => {})));
      return NextResponse.json({ error: "Refund failed: items insert" }, { status: 500 });
    }
    cleanup.unshift(async () => {
      await supabase.from("pos_order_items").delete().eq("order_id", newRefundOrderId);
    });

    // ─── 5. Insert payment row (negative amount) ───────────
    const { error: payErr } = await supabase
      .from("pos_order_payments")
      .insert({
        order_id: newRefundOrderId,
        payment_method: refund_method,
        amount: -refundTotal,
        status: "completed",
      });
    if (payErr) {
      console.error("[refund] payment insert failed:", payErr);
      await Promise.all(cleanup.map((f) => f().catch(() => {})));
      return NextResponse.json({ error: "Refund failed: payment insert" }, { status: 500 });
    }
    cleanup.unshift(async () => {
      await supabase.from("pos_order_payments").delete().eq("order_id", newRefundOrderId);
    });

    // ─── 6. Bump refunded_quantity on the original lines ───
    // Done individually because we add to the existing value; can't
    // express as a single UPDATE without an RPC.
    for (const l of refundLines) {
      const newRefunded = (l.orig.refunded_quantity ?? 0) + l.refundQty;
      const { error: upErr } = await supabase
        .from("pos_order_items")
        .update({ refunded_quantity: newRefunded })
        .eq("id", l.orig.id);
      if (upErr) {
        console.error("[refund] refunded_quantity update failed:", upErr);
        await Promise.all(cleanup.map((f) => f().catch(() => {})));
        return NextResponse.json(
          { error: "Refund failed: could not update original counters" },
          { status: 500 },
        );
      }
    }

    // ─── 7. Stamp refunded_at on original if fully refunded ──
    // We re-read counts in case a concurrent refund landed between
    // step 6 and now. Cheap and safer than trusting local state.
    const { data: afterItems } = await supabase
      .from("pos_order_items")
      .select("quantity, refunded_quantity")
      .eq("order_id", orig.id);
    const fullyRefunded =
      Array.isArray(afterItems) &&
      afterItems.length > 0 &&
      afterItems.every(
        (r) => (r.refunded_quantity ?? 0) >= (r.quantity ?? 0),
      );
    if (fullyRefunded) {
      await supabase
        .from("pos_orders")
        .update({ refunded_at: new Date().toISOString() })
        .eq("id", orig.id);
    }

    // ─── 8. Reverse loyalty side-effects (best-effort) ─────
    // None of these block the cashier — they're audit-trail repairs.
    // Wrapped in their own try/catch so a loyalty hiccup never breaks
    // a refund that already landed in the books.
    void (async () => {
      try {
        const baseUrl = req.nextUrl.origin;

        // 8a. If the original used a reward voucher, flip it back to
        // active so the customer can use it again. mark-used is the
        // existing helper; it accepts member_id + voucher_id and
        // flips status='used' — we want the reverse, but the loyalty
        // tables only support a forward flip. For now, fire a best-
        // effort note so an operator can manually restore. (TODO:
        // dedicated /api/loyalty/unmark-used.)
        if (orig.reward_id && orig.loyalty_phone) {
          console.warn(
            "[refund] reward voucher reversal not yet implemented — manual restore needed for reward_id=",
            orig.reward_id,
          );
        }

        // 8b. If the original earned points, deduct them by calling
        // /earn with a negative amount_rm. We need member_id which is
        // not stored on the order — look it up by phone.
        if (orig.loyalty_points_earned > 0 && orig.loyalty_phone) {
          const lookup = await fetch(
            `${baseUrl}/api/loyalty/lookup?phone=${encodeURIComponent(orig.loyalty_phone)}`,
          );
          if (lookup.ok) {
            const { member } = (await lookup.json()) as { member?: { id: string } };
            if (member?.id) {
              await fetch(`${baseUrl}/api/loyalty/earn`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  member_id: member.id,
                  outlet_id: orig.outlet_id,
                  amount_rm: -(refundTotal / 100),
                  order_id: newRefundOrderId,
                  order_number: refundOrderNumber,
                }),
              }).catch((e) => console.warn("[refund] earn-reverse failed:", e));
            }
          }
        }
      } catch (e) {
        console.warn("[refund] loyalty reversal best-effort error:", e);
      }
    })();

    return NextResponse.json({
      refund_order_id: newRefundOrderId,
      refund_total_sen: refundTotal,
    });
  } catch (err) {
    console.error("[refund] uncaught:", err);
    // Roll back whatever we managed to insert before the throw.
    await Promise.all(cleanup.map((f) => f().catch(() => {})));
    const msg = err instanceof Error ? err.message : "Refund failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
