import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

// Fields that exist in Supabase outlet_settings and need syncing
const PICKUP_SYNC_FIELDS = [
  "isOpen", "isBusy", "pickupTimeMins", "name", "status",
  "openTime", "closeTime", "daysOpen", "pickupStoreId",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Only allow safe fields
  const {
    name, code, type, phone, address, city, state, status,
    openTime, closeTime, daysOpen, isOpen, isBusy, pickupTimeMins,
    storehubId, loyaltyOutletId, pickupStoreId, lat, lng,
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

  const outlet = await prisma.outlet.update({
    where: { id },
    data,
  });

  // ── Sync pickup-related fields to Supabase outlet_settings ──────────
  const needsSync = PICKUP_SYNC_FIELDS.some((f) => body[f] !== undefined);
  if (needsSync && outlet.pickupStoreId) {
    try {
      await syncToSupabase(outlet);
    } catch (err) {
      console.error("Failed to sync outlet to Supabase:", err);
      // Don't fail the main request — Prisma update succeeded
    }
  }

  return NextResponse.json(outlet);
}

/** Sync Prisma outlet fields to Supabase outlet_settings + app_settings */
async function syncToSupabase(outlet: {
  pickupStoreId: string | null;
  name: string;
  status: string;
  isOpen: boolean | null;
  isBusy: boolean | null;
  pickupTimeMins: number | null;
  openTime: string | null;
  closeTime: string | null;
  daysOpen: number[];
}) {
  if (!outlet.pickupStoreId) return;

  const supabase = getSupabaseAdmin();

  // 1. Upsert outlet_settings
  const { error: settingsErr } = await supabase
    .from("outlet_settings")
    .upsert(
      {
        store_id: outlet.pickupStoreId,
        name: outlet.name,
        is_active: outlet.status === "ACTIVE",
        is_open: outlet.isOpen ?? false,
        is_busy: outlet.isBusy ?? false,
        pickup_time_mins: outlet.pickupTimeMins ?? 15,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" },
    );

  if (settingsErr) {
    console.error("outlet_settings sync error:", settingsErr);
  }

  // 2. Update outlet_hours in app_settings (for auto-hours cron)
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
