import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchActiveVouchersForMember,
  fetchAffordableCatalogForMember,
} from "@celsius/shared";

// Service-role required: member_brands + issued_rewards are RLS-locked.
// Anon reads return empty rowsets → balance=0 → every catalog reward
// falls out of the affordability filter → register modal shows
// "No rewards available" even for members with thousands of Beans.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const BRAND_ID = "brand-celsius";

/**
 * GET /api/loyalty/rewards?member_id=xxx
 *
 * Returns available rewards for a member, split into two clean buckets:
 *   - catalog: catalog rewards they can afford (points_required <= balance)
 *   - issued:  active wallet vouchers (welcome, mission, mystery, etc.)
 *
 * Both shapes are deliberately distinct. The previous response merged
 * issued vouchers into the catalog shape by adding `is_issued: true,
 * points_required: 0, ...`, which made the modal code work but
 * leaked a sloppy domain boundary into every consumer. The new shape
 * makes the difference explicit: catalog rewards are bean-priced
 * options to redeem; issued vouchers are ready-to-burn wallet items.
 *
 * The issued portion is fetched via the shared
 * fetchActiveVouchersForMember helper (used by the Pickup /me/vouchers
 * endpoint too) so POS + Pickup never drift on filter logic or shape.
 */
export async function GET(req: NextRequest) {
  try {
    const memberId = req.nextUrl.searchParams.get("member_id");
    if (!memberId) {
      return NextResponse.json({ error: "member_id required" }, { status: 400 });
    }

    // Fetch member balance
    const { data: mb } = await supabase
      .from("member_brands")
      .select("points_balance")
      .eq("member_id", memberId)
      .eq("brand_id", BRAND_ID)
      .single();

    const balance = mb?.points_balance ?? 0;

    // Fetch BOTH buckets via shared helpers — single source of truth
    // shared with Pickup's /api/loyalty/me/vouchers and
    // /api/loyalty/rewards. POS passes no fulfillmentChannel so all
    // rewards (in-store + pickup) surface for the cashier.
    const [issued, catalog] = await Promise.all([
      fetchActiveVouchersForMember({ supabase, memberId, brandId: BRAND_ID }),
      fetchAffordableCatalogForMember({
        supabase,
        memberId,
        brandId: BRAND_ID,
        balance,
      }),
    ]);

    return NextResponse.json({
      balance,
      catalog,
      issued,
    });
  } catch (err) {
    console.error("[LOYALTY] Fetch rewards error:", err);
    return NextResponse.json({ error: "Failed to fetch rewards" }, { status: 500 });
  }
}
