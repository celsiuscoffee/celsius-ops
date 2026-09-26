import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// GET /api/settings?key=sst
//
// Public config reads for the customer app and the web checkout. Only the
// keys below are served: app_settings also holds internal state (loop and
// pairing scores, integration config such as maybank_qr / sms_provider) that
// has no business reaching a customer device.
//
// There is deliberately no PUT here. Writes go through the backoffice's own
// /api/settings, which sits behind a backoffice session + module check; this
// route is reachable by anyone on the internet.
const PUBLIC_KEYS = new Set([
  "sst",
  "points_per_rm",
  "min_order_value",
  "maintenance",
  "min_app_version",
  "payments_enabled",
  "promo_banner",
  "outlet_hours",
  "outlet_open_override",
  "pickup_config_version",
]);

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  if (!PUBLIC_KEYS.has(key)) return NextResponse.json(null);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();

  if (error || !data) return NextResponse.json(null);
  return NextResponse.json(data.value);
}
