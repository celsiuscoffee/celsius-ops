// GET /api/loyalty/rewards?phone=… — points-shop catalog rewards the
// caller can afford. Thin wrapper around the canonical
// fetchAffordableCatalogForMember helper in @celsius/shared.
//
// Was a 250-line proxy that hit loyalty.celsiuscoffee.com for the
// catalog, joined reward_configs, applied heuristic discount-type
// classification, hydrated eligibility from a second Supabase query,
// AND merged in issued_rewards rows via a legacy rewards-table join
// (which silently dropped modern voucher-template-backed vouchers).
//
// Now: single source of truth in @celsius/shared. Active wallet
// vouchers live in /api/loyalty/me/vouchers (also wrapping the
// shared helper). Catalog and wallet are clean, non-overlapping
// concerns again.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchAffordableCatalogForMember } from "@celsius/shared";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

/** Normalise phone variants the customer may type — "0123…",
 *  "60123…", "+60123…" all collapse to "+60…". */
function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  const supabase = getSupabaseAdmin();

  try {
    // No phone — anonymous catalog browse with balance=0 so nothing
    // is "affordable". Lets the menu screen still pre-render the
    // rewards rail empty-state without 401-ing.
    if (!phone) {
      return NextResponse.json({ memberId: null, pointsBalance: null, rewards: [] });
    }

    const normPhone = normalisePhone(phone);
    // Look up the member by phone — phone-variant tolerant so a
    // member who originally signed up with "0123…" still resolves
    // when their JWT carries "+60123…".
    const { data: members } = await supabase
      .from("members")
      .select("id")
      .in("phone", [normPhone, normPhone.replace(/^\+/, ""), `0${normPhone.replace(/^\+60/, "")}`])
      .limit(1);
    const member = members && members[0];

    if (!member) {
      return NextResponse.json({ memberId: null, pointsBalance: null, rewards: [] });
    }

    // Member balance + catalog in parallel
    const [balanceRow, balanceRes] = await Promise.all([
      supabase
        .from("member_brands")
        .select("points_balance")
        .eq("member_id", member.id)
        .eq("brand_id", BRAND_ID)
        .maybeSingle(),
      Promise.resolve(null), // placeholder for symmetry
    ]);
    void balanceRes;
    const pointsBalance = (balanceRow.data?.points_balance as number | null) ?? 0;

    const rewards = await fetchAffordableCatalogForMember({
      supabase,
      memberId: member.id,
      brandId: BRAND_ID,
      balance: pointsBalance,
      // Pickup app only shows rewards that are tagged pickup-capable
      // (in_store-only rewards stay off the customer's catalog).
      fulfillmentChannel: "pickup",
    });

    return NextResponse.json({
      memberId: member.id,
      pointsBalance,
      rewards,
    });
  } catch (err) {
    console.error("Loyalty rewards fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch rewards" }, { status: 500 });
  }
}
