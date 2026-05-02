import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { verifyPin, hashPin } from "@celsius/auth";

const attempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(storeId: string): boolean {
  const now = Date.now();
  const key = storeId;
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

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

    if (!checkRateLimit(storeId)) {
      return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
    }

    const supabase = getSupabaseAdmin();

    // ── Fetch outlet info (for storeName + is_active check) ───────────────
    const { data: outletData, error: outletError } = await supabase
      .from("outlet_settings")
      .select("staff_pin, is_active, name")
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
              attempts.delete(storeId);
              return NextResponse.json({
                ok:        true,
                storeId,
                storeName,
                staffName: user.name,
                staffId:   user.id,
                source:    "backoffice",
              });
            }
          }
        }
      }
    } catch (lookupErr) {
      const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
      console.error("[staff-auth] backoffice lookup failed:", msg.slice(0, 200));
    }

    // ── 2. Supabase staff_members (legacy) ────────────────────────────────
    const { data: members, error: membersError } = await supabase
      .from("staff_members")
      .select("id, name")
      .eq("pin", pin)
      .eq("is_active", true)
      .contains("outlet_ids", [storeId])
      .or("app_access.cs.{kds},app_access.cs.{staff_app}");

    if (!membersError && members && members.length > 0) {
      const member = members[0] as { id: string; name: string };
      attempts.delete(storeId);
      return NextResponse.json({
        ok:        true,
        storeId,
        storeName,
        staffName: member.name,
        staffId:   member.id,
        source:    "legacy",
      });
    }

    // ── 3. Fallback: outlet_settings.staff_pin (backward compat) ─────────
    const expected = outletData.staff_pin as string | null;

    if (!expected) {
      return NextResponse.json({ error: "PIN not configured for this outlet" }, { status: 403 });
    }

    if (pin !== expected) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    attempts.delete(storeId);
    return NextResponse.json({
      ok:        true,
      storeId,
      storeName,
      staffName: null,
      staffId:   null,
      source:    "outlet_pin",
    });
  } catch (err) {
    console.error("Staff auth error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
