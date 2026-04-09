import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

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
 * Primary: looks up pin in staff_members where the member is active,
 * belongs to the outlet, and has kds or staff_app access.
 * Fallback: checks outlet_settings.staff_pin for backward compatibility.
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

    // ── Primary: look up in staff_members ─────────────────────────────────
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
      });
    }

    // ── Fallback: outlet_settings.staff_pin (backward compat) ─────────────
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
    });
  } catch (err) {
    console.error("Staff auth error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
