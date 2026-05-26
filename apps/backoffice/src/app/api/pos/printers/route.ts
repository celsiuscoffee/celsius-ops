import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * POS printer configs — canonical owner is the main backoffice.
 *
 * GET    /api/pos/printers              → list all
 * GET    /api/pos/printers?outlet_id=…  → filter to one outlet
 * POST   /api/pos/printers              → create
 * PUT    /api/pos/printers              → update (body must include id)
 * DELETE /api/pos/printers?id=…         → remove
 *
 * The POS register reads these via `fetchPrinterConfigs(outletId)` on
 * boot and caches them via `setPrinterConfigs(...)`. At print time
 * `printToExternalPrinter(station, text)` looks up the matching
 * config and POSTs the ESC/POS payload (with the printer's IP+port
 * baked in) to the local print bridge at localhost:8080.
 *
 * Each row represents ONE physical printer:
 *   - printer_type: 'docket' (kitchen/bar/counter) | 'receipt' (cashier)
 *   - station: matches pos_kitchen_stations.name when printer_type=docket
 *              (e.g. "Bar", "Kitchen", "Counter"). Null for receipt printers.
 *   - connection_type: 'network' (LAN IP) | 'usb' | 'bluetooth' | 'built_in'
 *   - ip_address / port: required for network printers (default port 9100)
 */

const ALLOWED_TYPES = new Set(["docket", "receipt"]);
const ALLOWED_CONN = new Set(["network", "usb", "bluetooth", "built_in"]);

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const supabase = getSupabaseAdmin();
  const outletId = request.nextUrl.searchParams.get("outlet_id");

  const q = supabase
    .from("pos_printer_config")
    .select("*")
    .order("outlet_id")
    .order("printer_type")
    .order("name");
  const { data, error } = outletId ? await q.eq("outlet_id", outletId) : await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ printers: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json();
  const required = ["outlet_id", "name", "printer_type", "connection_type"] as const;
  for (const k of required) {
    if (!body?.[k]) return NextResponse.json({ error: `${k} required` }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(body.printer_type)) {
    return NextResponse.json({ error: "invalid printer_type" }, { status: 400 });
  }
  if (!ALLOWED_CONN.has(body.connection_type)) {
    return NextResponse.json({ error: "invalid connection_type" }, { status: 400 });
  }
  // Network printers need an IP — otherwise the print bridge has
  // nothing to talk to. Catching this on insert prevents a "row
  // exists but does nothing" footgun.
  if (body.connection_type === "network" && !body.ip_address) {
    return NextResponse.json({ error: "ip_address required for network printers" }, { status: 400 });
  }
  // Docket printers need a station — that's the routing key. Receipt
  // printers shouldn't have one (there's at most one per outlet).
  if (body.printer_type === "docket" && !body.station) {
    return NextResponse.json({ error: "station required for docket printers" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const insert = {
    outlet_id: body.outlet_id,
    name: body.name,
    printer_type: body.printer_type,
    station: body.printer_type === "docket" ? body.station : null,
    connection_type: body.connection_type,
    ip_address: body.ip_address ?? null,
    port: body.port ?? 9100,
    is_enabled: body.is_enabled ?? true,
  };
  const { data, error } = await supabase.from("pos_printer_config").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ printer: data });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json();
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (body.printer_type && !ALLOWED_TYPES.has(body.printer_type)) {
    return NextResponse.json({ error: "invalid printer_type" }, { status: 400 });
  }
  if (body.connection_type && !ALLOWED_CONN.has(body.connection_type)) {
    return NextResponse.json({ error: "invalid connection_type" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const allowed = ["name", "printer_type", "station", "connection_type", "ip_address", "port", "is_enabled"] as const;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) updates[k] = body[k];
  // Same validation as POST when type/station are being changed
  if (updates.printer_type === "receipt") updates.station = null;

  const { data, error } = await supabase
    .from("pos_printer_config")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ printer: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("pos_printer_config").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
