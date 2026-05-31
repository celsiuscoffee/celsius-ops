import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/loyalty/lookup?phone=+60xxx
 *
 * Server-side member lookup for the POS register's Customer panel.
 * The browser used to hit the `members` table directly via the anon
 * Supabase key, but that table has zero RLS policies (member PII =
 * not anon-readable). The browser request silently returned [] and
 * the cashier saw "no member found" for everyone.
 *
 * This route uses the service role to read both `members` and
 * `member_brands`, returning the same LoyaltyMember shape the
 * register expects.
 */

const BRAND_ID = "brand-celsius";

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/[^0-9]/g, "");
  const local = digits.startsWith("60") ? digits.slice(2) : digits.replace(/^0+/, "");
  return Array.from(
    new Set(
      [raw.trim(), digits, `+${digits}`, local, `0${local}`, `60${local}`, `+60${local}`].filter(
        Boolean,
      ),
    ),
  );
}

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }
  try {
    const supabase = getClient();
    const variants = phoneVariants(phone);

    const { data: members } = await supabase
      .from("members")
      .select("id, phone, name, tags")
      .in("phone", variants)
      .limit(1);
    const member = members?.[0];
    if (!member) {
      return NextResponse.json({ member: null });
    }

    const { data: mb } = await supabase
      .from("member_brands")
      .select("points_balance, total_spent, total_visits, last_visit_at, current_tier_id")
      .eq("member_id", member.id)
      .eq("brand_id", BRAND_ID)
      .maybeSingle();

    // Tier — join lazily so the register can show the gold pill +
    // multiplier without needing a second roundtrip. Falls back to the
    // bronze "Member" tier if the row doesn't have current_tier_id set.
    // We include discount_percent + stackable so the register can apply
    // the native stacking rule (non-stackable tiers wipe vouchers, etc).
    let tier: {
      id: string;
      slug: string;
      name: string;
      color: string;
      multiplier: number;
      discount_percent: number;
      stackable: boolean;
    } | null = null;
    if (mb?.current_tier_id) {
      const { data: tierRow } = await supabase
        .from("tiers")
        .select("id, slug, name, color, multiplier, discount_percent, stackable")
        .eq("id", mb.current_tier_id)
        .maybeSingle();
      if (tierRow) {
        tier = {
          id:               tierRow.id as string,
          slug:             tierRow.slug as string,
          name:             tierRow.name as string,
          color:            (tierRow.color as string) ?? "#A2492C",
          multiplier:       Number(tierRow.multiplier ?? 1),
          discount_percent: Number(tierRow.discount_percent ?? 0),
          stackable:        (tierRow.stackable as boolean | null) ?? true,
        };
      }
    }

    return NextResponse.json({
      member: {
        id:             member.id,
        phone:          member.phone,
        name:           member.name,
        tags:           member.tags ?? [],
        points_balance: mb?.points_balance ?? 0,
        total_spent:    parseFloat(String(mb?.total_spent ?? "0")),
        total_visits:   mb?.total_visits ?? 0,
        last_visit_at:  mb?.last_visit_at ?? null,
        tier,
      },
    });
  } catch (err) {
    console.error("[lookup] error:", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
