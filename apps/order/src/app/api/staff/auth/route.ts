import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { verifyPin, hashPin } from "@celsius/auth";
import { signStaffToken } from "@/lib/staff-token";
import { checkRateLimit, safeEqual } from "@celsius/shared";

// Brute-force budget for a 4–6 digit PIN. Shared Upstash counter (one bucket
// across every lambda, unlike the old per-process Map that reset on each cold
// start and multiplied by the number of warm instances), keyed BOTH on the
// outlet and on the caller IP: the outlet key stops a distributed guess at one
// till's PIN, the IP key stops one box cycling through outlets.
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_PER_STORE = 10;
const PIN_MAX_PER_IP = 20;

/**
 * POST /api/staff/auth
 * Body: { storeId: string; pin: string }
 *
 * Auth cascade:
 * 1. Backoffice "User" table via Supabase REST — bcrypt PIN
 * 2. Supabase staff_members table — plaintext PIN (legacy)
 * 3. outlet_settings.staff_pin — plaintext fallback
 *
 * Returns { ok: true, storeId, staffName, staffId, storeName } on success.
 */
export async function POST(request: NextRequest) {
  try {
    const { storeId, pin } = await request.json() as { storeId?: string; pin?: string };

    if (!storeId || !pin) {
      return NextResponse.json({ error: "Missing storeId or pin" }, { status: 400 });
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const [byStore, byIp] = await Promise.all([
      checkRateLimit(`staff-pin:store:${storeId}`, PIN_MAX_PER_STORE, PIN_WINDOW_MS),
      checkRateLimit(`staff-pin:ip:${ip}`, PIN_MAX_PER_IP, PIN_WINDOW_MS),
    ]);
    if (byStore.limited || byIp.limited) {
      return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
    }

    const supabase = getSupabaseAdmin();

    // ── Fetch outlet info (for storeName + is_active check) ───────────────
    // staff_pin was removed from outlet_settings view (secret-stripping fix).
    // The deprecated fallback below now queries Outlet table directly.
    const { data: outletData, error: outletError } = await supabase
      .from("outlet_settings")
      .select("is_active, name")
      .eq("store_id", storeId)
      .single();

    if (outletError || !outletData) {
      return NextResponse.json({ error: "Invalid store" }, { status: 400 });
    }

    if (!outletData.is_active) {
      return NextResponse.json({ error: "This outlet is not active" }, { status: 403 });
    }

    const storeName = (outletData.name as string) ?? storeId;

    // ── 1. Backoffice User table (via Supabase REST) ──────────────────────
    // We query the Prisma-managed "User" + "Outlet" tables directly through
    // the Supabase service-role client so this route doesn't need Prisma /
    // DATABASE_URL on the order app's Vercel project. The RLS-bypassing
    // service role can read both tables.
    try {
      // storeId here is the pickup slug (e.g. "conezion"). User.outletIds
      // stores Outlet UUIDs, so resolve slug → UUID first.
      const { data: outletRow } = await supabase
        .from("Outlet")
        .select("id")
        .eq("pickupStoreId", storeId)
        .maybeSingle();
      const outletUuid = (outletRow as { id?: string } | null)?.id;

      if (outletUuid) {
        const { data: users, error: usersErr } = await supabase
          .from("User")
          .select("id, name, pin")
          .eq("status", "ACTIVE")
          .not("pin", "is", null)
          .contains("outletIds", [outletUuid])
          .overlaps("appAccess", ["kds", "staff_app", "order"]);

        if (usersErr) {
          console.error("[staff-auth] User lookup error:", usersErr.message);
        } else if (users) {
          for (const user of users as Array<{ id: string; name: string; pin: string | null }>) {
            const { match, needsRehash } = await verifyPin(pin, user.pin);
            if (match) {
              // Progressive rehash: upgrade plaintext PINs to bcrypt
              if (needsRehash) {
                const hashed = await hashPin(pin);
                await supabase.from("User").update({ pin: hashed }).eq("id", user.id);
              }
              return NextResponse.json({
                ok:        true,
                storeId,
                storeName,
                staffName: user.name,
                staffId:   user.id,
                source:    "backoffice",
                token:     signStaffToken({ storeId, staffId: user.id, staffName: user.name }),
              });
            }
          }
        }
      }
    } catch (lookupErr) {
      const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
      console.error("[staff-auth] backoffice lookup failed:", msg.slice(0, 200));
    }

    // (The former step 2, a plaintext-PIN lookup against `staff_members`, is
    // gone: that table does not exist in production — verified 2026-09-26 —
    // so the query errored on every call and the route fell straight through
    // to step 3.)

    // ── 3. Fallback: Outlet.staffPin (backward compat) ─────────
    // Read from the underlying table directly; the outlet_settings view
    // no longer exposes staffPin to avoid leaking it via anon PostgREST.
    const { data: outletPin } = await supabase
      .from("Outlet")
      .select("staffPin")
      .eq("pickupStoreId", storeId)
      .maybeSingle();
    const expected = (outletPin as { staffPin?: string | null } | null)?.staffPin ?? null;

    if (!expected) {
      return NextResponse.json({ error: "PIN not configured for this outlet" }, { status: 403 });
    }

    if (!safeEqual(pin, expected)) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    // A shared plaintext outlet PIN is the weakest login on the estate (3
    // outlets still carry one, 2026-09-26). Logged so its use can be watched
    // down to zero and the column dropped; the per-user bcrypt path above is
    // the target for every till.
    console.warn(`[staff-auth] outlet ${storeId} signed in with the shared Outlet.staffPin fallback`);
    return NextResponse.json({
      ok:        true,
      storeId,
      storeName,
      staffName: null,
      staffId:   null,
      source:    "outlet_pin",
      token:     signStaffToken({ storeId, staffId: null, staffName: null }),
    });
  } catch (err) {
    console.error("Staff auth error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
