import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireCustomerSession } from "@/lib/customer-jwt";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

// GET /api/loyalty/points-history?phone=+60xxx&limit=30
// Returns the customer's points ledger (earn / redeem / adjust / bonus
// rows from point_transactions) so the Rewards screen can show a
// self-serve "where did my points come from / go" history. This is the
// customer-facing mirror of the backoffice member drawer's Points
// ledger. Read-only; identified by phone (already OTP-verified at login,
// and re-checked against the Bearer session when STRICT_CUSTOMER_AUTH is
// on — same guard as /api/loyalty/orders and /api/loyalty/member).
//
// Response: { history: [{ id, type, points, balance_after, description,
//   order_number, created_at }] }

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

type LedgerRow = {
  id: string;
  type: string;
  points: number;
  balance_after: number | null;
  description: string | null;
  reference_id: string | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const phoneParam = request.nextUrl.searchParams.get("phone");
  if (!phoneParam) {
    return NextResponse.json({ error: "Missing phone" }, { status: 400 });
  }
  const limit = Math.min(
    100,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 30),
  );

  try {
    const supabase = getSupabaseAdmin();
    const phone = normalisePhone(phoneParam);

    // Same guard as the other member-scoped GETs: when STRICT_CUSTOMER_AUTH
    // is on, require a Bearer token whose signed phone matches the queried
    // phone. Off by default so the PWA keeps working until it also sends
    // the token.
    const guard = requireCustomerSession(request);
    if (guard.error) return guard.error as unknown as NextResponse;
    if (guard.session && guard.session.phone !== phone) {
      return NextResponse.json(
        { error: "Session does not match phone" },
        { status: 403 },
      );
    }

    // Resolve member by phone (the ledger is keyed by member_id, not phone).
    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("phone", phone)
      .maybeSingle<{ id: string }>();

    if (!member) return NextResponse.json({ history: [] });

    const { data: rows, error } = await supabase
      .from("point_transactions")
      .select("id, type, points, balance_after, description, reference_id, created_at")
      .eq("member_id", member.id)
      .eq("brand_id", BRAND_ID)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("points-history query error:", error);
      return NextResponse.json({ history: [] });
    }

    const ledger = (rows ?? []) as LedgerRow[];

    // Resolve the human order number for earn/redeem rows so the customer
    // sees "Order C-3247" instead of a bare uuid. reference_id points at
    // orders.id (pickup) or pos_orders.id (counter) for order-linked rows,
    // or a redemption/txn id otherwise (left unresolved). Batch both lookups.
    const refIds = Array.from(
      new Set(ledger.map((l) => l.reference_id).filter((r): r is string => !!r)),
    );
    const orderNumberById = new Map<string, string>();
    if (refIds.length > 0) {
      const [pickupRes, posRes] = await Promise.all([
        supabase.from("orders").select("id, order_number").in("id", refIds),
        supabase.from("pos_orders").select("id, order_number").in("id", refIds),
      ]);
      for (const o of [
        ...((pickupRes.data ?? []) as { id: string; order_number: string | null }[]),
        ...((posRes.data ?? []) as { id: string; order_number: string | null }[]),
      ]) {
        if (o?.id && o.order_number) orderNumberById.set(o.id, o.order_number);
      }
    }

    const history = ledger.map((l) => ({
      id: l.id,
      type: l.type,
      points: l.points,
      balance_after: l.balance_after,
      description: l.description,
      order_number: l.reference_id ? orderNumberById.get(l.reference_id) ?? null : null,
      created_at: l.created_at,
    }));

    return NextResponse.json({ history });
  } catch (err) {
    console.error("points-history route error:", err);
    return NextResponse.json({ history: [] });
  }
}
