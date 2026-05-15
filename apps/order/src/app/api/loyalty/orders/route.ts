import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireCustomerSession } from "@/lib/customer-jwt";

// GET /api/loyalty/orders?phone=+60xxx&limit=20
// Returns the customer's most recent orders, with line items, for the
// pickup app's Orders tab. Read-only; identified by phone (already
// OTP-verified at login).
//
// Response: { orders: [{ id, order_number, status, total, created_at,
//   payment_method, store_id, items: [{ product_id, product_name,
//   quantity, item_total, modifiers }] }] }

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

export async function GET(request: NextRequest) {
  const phoneParam = request.nextUrl.searchParams.get("phone");
  if (!phoneParam) {
    return NextResponse.json({ error: "Missing phone" }, { status: 400 });
  }
  const limit = Math.min(
    50,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 20)
  );

  try {
    const supabase = getSupabaseAdmin();
    const phone = normalisePhone(phoneParam);

    // When STRICT_CUSTOMER_AUTH is on, require a Bearer token whose
    // signed phone matches the queried phone. Off by default so the
    // PWA keeps working until it also sends the token.
    const guard = requireCustomerSession(request);
    if (guard.error) return guard.error as unknown as NextResponse;
    if (guard.session && guard.session.phone !== phone) {
      return NextResponse.json(
        { error: "Session does not match phone" },
        { status: 403 }
      );
    }

    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_number, status, total, created_at, payment_method, store_id, " +
          "order_items(product_id, product_name, quantity, item_total, modifiers, unit_price)"
      )
      .eq("customer_phone", phone)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("orders history query error:", error);
      return NextResponse.json({ orders: [] });
    }

    // Resolve store_id → outlet name once for the whole batch. The
    // orders table just stores the raw store_id; the Orders tab in
    // the pickup app needs to render "Conezion" / "Putrajaya" /
    // etc. next to each order so the customer can tell where they
    // ordered from without tapping in.
    type OrderRow = {
      id: string;
      order_number: string;
      status: string;
      total: number;
      created_at: string;
      payment_method: string | null;
      store_id: string | null;
      order_items: unknown;
    };
    const rows = (data ?? []) as unknown as OrderRow[];
    const storeIds = Array.from(
      new Set(rows.map((o) => o.store_id).filter((id): id is string => !!id)),
    );
    const storeNameById = new Map<string, string>();
    if (storeIds.length > 0) {
      const { data: outlets } = await supabase
        .from("outlet_settings")
        .select("store_id, name")
        .in("store_id", storeIds);
      for (const row of (outlets ?? []) as Array<{ store_id: string | null; name: string | null }>) {
        if (row?.store_id && row?.name) {
          storeNameById.set(row.store_id, row.name);
        }
      }
    }
    const orders = rows.map((o) => ({
      ...o,
      store_name: o.store_id ? (storeNameById.get(o.store_id) ?? null) : null,
    }));

    return NextResponse.json({ orders });
  } catch (err) {
    console.error("orders history route error:", err);
    return NextResponse.json({ orders: [] });
  }
}
