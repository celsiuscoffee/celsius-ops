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
 * 1. Prisma User table (backoffice-managed users) — bcrypt PIN
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

    // ── 1. Prisma User table (backoffice-managed staff) ───────────────────
    // Dynamic import: Prisma only loads if DATABASE_URL is set (safe for deploys without it)
    try {
      const { prisma } = await import("@celsius/db");
      // storeId here is the pickup slug (e.g. "conezion"). User.outletIds stores
      // Outlet UUIDs, so resolve the slug → UUID before filtering.
      const outlet = await prisma.outlet.findFirst({
        where: { pickupStoreId: storeId },
        select: { id: true },
      });
      const outletUuid = outlet?.id;

      const prismaUsers = outletUuid
        ? await prisma.user.findMany({
            where: {
              status: "ACTIVE",
              pin: { not: null },
              outletIds: { has: outletUuid },
              appAccess: { hasSome: ["kds", "staff_app", "order"] },
            },
            select: { id: true, name: true, pin: true },
          })
        : [];

      for (const user of prismaUsers) {
        const { match, needsRehash } = await verifyPin(pin, user.pin);
        if (match) {
          // Progressive rehash: upgrade plaintext PINs to bcrypt
          if (needsRehash) {
            const hashed = await hashPin(pin);
            await prisma.user.update({
              where: { id: user.id },
              data: { pin: hashed },
            });
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
    } catch (prismaErr) {
      // If Prisma DB is unreachable, fall through to Supabase.
      // Split fields onto separate log lines because Vercel truncates each message.
      const e = prismaErr instanceof Error ? prismaErr : null;
      console.error("[staff-auth] dburl-set:", Boolean(process.env.DATABASE_URL));
      console.error("[staff-auth] err-name:", e?.name ?? typeof prismaErr);
      console.error("[staff-auth] err-msg:", e?.message?.slice(0, 200) ?? String(prismaErr).slice(0, 200));
      if (e?.stack) console.error("[staff-auth] err-stack:", e.stack.slice(0, 400));
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
