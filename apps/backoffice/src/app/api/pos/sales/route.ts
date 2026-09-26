import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requirePosApiAuth } from "@/lib/pos-auth";

/**
 * POST /api/pos/sales — land a completed till sale in the cloud.
 * Body: { order, items, payments }  (the till's SalePayload, unchanged)
 *
 * The native till used to call the `create_pos_sale` RPC directly with the
 * public anon key. That key ships in every APK, so anyone holding it could
 * fabricate completed sales (any outlet, any cashier's employee_id, any
 * discount) straight into pos_orders — corrupting Z-reports and the finance
 * revenue lens (2026-09-25 QA, Critical). This route is the only sanctioned
 * caller now: it requires the POS staff session the till already carries as a
 * Bearer, then runs the same RPC with the service role. The RPC keeps doing
 * the work — idempotent on order.id, authoritative order number, whole-sen
 * rounding — so the till's offline-queue semantics are untouched.
 *
 * Response codes are what the till's sync loop keys on:
 *   200  { order_id, created, order_number }  landed (or already had)
 *   400  malformed payload — a per-sale problem, the till dead-letters it
 *   401  no/expired POS session — the till retries after re-login, never
 *        dead-letters (the sale is fine, the token isn't)
 *   422  the DB rejected THIS payload — per-sale, the till dead-letters it
 *   5xx  our problem — the till retries later
 *
 * Attribution: the session's employee/outlet are only COMPARED with the
 * payload for now (warn on mismatch), not enforced. A till drains its offline
 * queue under whoever is signed in at the time, so sales buffered during a
 * previous cashier's shift legitimately carry a different employee_id.
 * Enforcement is a follow-up once the warning volume shows what "normal" is.
 */

type SalePayload = {
  order: Record<string, unknown>;
  items: Record<string, unknown>[];
  payments: Record<string, unknown>[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parsePayload(body: unknown): SalePayload | string {
  if (!isRecord(body)) return "body must be an object";
  const { order, items, payments } = body;
  if (!isRecord(order)) return "order is required";
  if (typeof order.id !== "string" || !order.id) return "order.id is required";
  if (typeof order.outlet_id !== "string" || !order.outlet_id) return "order.outlet_id is required";
  if (items !== undefined && !(Array.isArray(items) && items.every(isRecord))) return "items must be an array";
  if (payments !== undefined && !(Array.isArray(payments) && payments.every(isRecord))) return "payments must be an array";
  return {
    order,
    items: (items as Record<string, unknown>[] | undefined) ?? [],
    payments: (payments as Record<string, unknown>[] | undefined) ?? [],
  };
}

export async function POST(request: NextRequest) {
  const auth = await requirePosApiAuth(request, "POST /api/pos/sales");
  if (auth.block) return auth.block;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payload = parsePayload(body);
  if (typeof payload === "string") return NextResponse.json({ error: payload }, { status: 400 });

  const user = auth.user;
  if (user) {
    const emp = payload.order.employee_id;
    if (emp && emp !== user.id) {
      console.warn(`[pos-sales] order ${payload.order.id}: employee_id ${String(emp)} != session ${user.id}`);
    }
    if (user.outletId && payload.order.outlet_id !== user.outletId) {
      console.warn(`[pos-sales] order ${payload.order.id}: outlet ${String(payload.order.outlet_id)} != session ${user.outletId}`);
    }
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("create_pos_sale", { p: payload });
  if (error) {
    // The RPC raises on a payload it cannot store (missing ids, bad types).
    // That is this sale's problem, not an outage: 422 so the till dead-letters
    // it instead of jamming the sales behind it.
    console.error(`[pos-sales] create_pos_sale rejected order ${payload.order.id}: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json(data);
}
