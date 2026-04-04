import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

function csvEscape(value: string | number | null | undefined): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// GET /api/pickup/orders/export?from=YYYY-MM-DD&to=YYYY-MM-DD&store=xxx
// Returns a CSV download of orders in the given date range
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const from  = searchParams.get("from");
    const to    = searchParams.get("to");
    const store = searchParams.get("store");

    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("orders")
      .select("*, order_items(*)")
      .order("created_at", { ascending: false });

    if (from)  query = query.gte("created_at", new Date(from).toISOString());
    if (to)    query = query.lte("created_at", new Date(to + "T23:59:59").toISOString());
    if (store && store !== "all") query = query.eq("store_id", store);

    const { data: orders, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const header = [
      "Order #",
      "Date",
      "Time",
      "Store",
      "Status",
      "Payment",
      "Items",
      "Subtotal (RM)",
      "SST (RM)",
      "Discount (RM)",
      "Total (RM)",
    ].join(",");

    const rows = (orders ?? []).map((order) => {
      const items = (order.order_items ?? []) as {
        product_name: string;
        quantity: number;
      }[];

      const itemsSummary = items
        .map((i) => `${i.quantity}x ${i.product_name}`)
        .join(", ");

      const dt = new Date(order.created_at);
      const date = dt.toLocaleDateString("en-MY", { day: "2-digit", month: "2-digit", year: "numeric" });
      const time = dt.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false });

      const subtotalRm  = (order.subtotal  / 100).toFixed(2);
      const sstRm       = (order.sst_amount / 100).toFixed(2);
      const discountRm  = (((order.subtotal + order.sst_amount) - order.total) / 100).toFixed(2);
      const totalRm     = (order.total / 100).toFixed(2);

      return [
        csvEscape(order.order_number),
        csvEscape(date),
        csvEscape(time),
        csvEscape(order.store_id),
        csvEscape(order.status),
        csvEscape(order.payment_method),
        csvEscape(itemsSummary),
        csvEscape(subtotalRm),
        csvEscape(sstRm),
        csvEscape(discountRm),
        csvEscape(totalRm),
      ].join(",");
    });

    const csv = [header, ...rows].join("\n");

    const fromLabel = from ?? "all";
    const toLabel   = to   ?? "all";

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type":        "text/csv",
        "Content-Disposition": `attachment; filename="orders-${fromLabel}-${toLabel}.csv"`,
      },
    });
  } catch (err) {
    console.error("Orders export error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
