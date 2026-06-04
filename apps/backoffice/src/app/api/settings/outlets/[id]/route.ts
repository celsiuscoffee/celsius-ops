import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { getUserFromHeaders } from "@/lib/auth";

// Fields that affect the auto-hours cron config
const HOURS_FIELDS = ["openTime", "closeTime", "daysOpen", "pickupStoreId"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Only allow safe fields
  const {
    name, code, type, phone, address, city, state, status,
    openTime, closeTime, daysOpen, isOpen, isBusy, pickupTimeMins,
    storehubId, loyaltyOutletId, pickupStoreId, lat, lng,
    companyName, regNo,
  } = body;
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (code !== undefined) data.code = code;
  if (type !== undefined) data.type = type;
  if (phone !== undefined) data.phone = phone;
  if (address !== undefined) data.address = address;
  if (city !== undefined) data.city = city;
  if (state !== undefined) data.state = state;
  if (status !== undefined) data.status = status;
  if (openTime !== undefined) data.openTime = openTime;
  if (closeTime !== undefined) data.closeTime = closeTime;
  if (daysOpen !== undefined) data.daysOpen = daysOpen;
  if (isOpen !== undefined) data.isOpen = isOpen;
  if (isBusy !== undefined) data.isBusy = isBusy;
  if (pickupTimeMins !== undefined) data.pickupTimeMins = pickupTimeMins;
  if (storehubId !== undefined) data.storehubId = storehubId || null;
  if (loyaltyOutletId !== undefined) data.loyaltyOutletId = loyaltyOutletId || null;
  if (pickupStoreId !== undefined) data.pickupStoreId = pickupStoreId || null;
  if (lat !== undefined) data.lat = lat;
  if (lng !== undefined) data.lng = lng;
  // Legal identity for the POS receipt — flows to the `outlets` view (read by
  // pos-native) as company_name / reg_no. Empty string clears it.
  if (companyName !== undefined) data.companyName = companyName || null;
  if (regNo !== undefined) data.regNo = regNo || null;

  // Prisma "Outlet" is the single source of truth — views read from it automatically
  const outlet = await prisma.outlet.update({
    where: { id },
    data,
  });

  // Sync outlet_hours to app_settings (for auto-hours cron)
  const needsHoursSync = HOURS_FIELDS.some((f) => body[f] !== undefined);
  if (needsHoursSync && outlet.pickupStoreId) {
    try {
      await syncOutletHours(outlet);
    } catch (err) {
      console.error("Failed to sync outlet hours:", err);
    }
  }

  return NextResponse.json(outlet);
}

/** Sync outlet hours config to app_settings (used by auto-hours cron) */
async function syncOutletHours(outlet: {
  pickupStoreId: string | null;
  openTime: string | null;
  closeTime: string | null;
  daysOpen: number[];
}) {
  if (!outlet.pickupStoreId) return;

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "outlet_hours")
    .single();

  const hours: Record<string, { open: string; close: string; daysOpen: number[] }> =
    (existing?.value as Record<string, { open: string; close: string; daysOpen: number[] }>) ?? {};

  hours[outlet.pickupStoreId] = {
    open: outlet.openTime ?? "08:00",
    close: outlet.closeTime ?? "22:00",
    daysOpen: outlet.daysOpen ?? [1, 2, 3, 4, 5, 6, 7],
  };

  const { error: hoursErr } = await supabase
    .from("app_settings")
    .upsert(
      { key: "outlet_hours", value: hours, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  if (hoursErr) {
    console.error("outlet_hours sync error:", hoursErr);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Check for linked staff or orders
  const staffCount = await prisma.user.count({ where: { outletId: id } });
  if (staffCount > 0) {
    return NextResponse.json({ error: "Cannot delete outlet with staff assigned. Deactivate instead." }, { status: 400 });
  }

  try {
    await prisma.outlet.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Cannot delete outlet. It may have linked data." }, { status: 400 });
  }
}
