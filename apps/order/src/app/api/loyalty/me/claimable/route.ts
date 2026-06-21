// GET /api/loyalty/me/claimable — offers waiting for one-tap claim.
//
// Two sources, unioned:
//   1. Pending mystery drops (un-revealed, the customer hasn't tapped yet)
//   2. Admin-pushed promo claimables
//
// Welcome offer is a separate one-time flow handled on signup, not here.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

export async function GET(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const supabase = getSupabaseAdmin();

  // 1) Mystery drops awaiting tap-reveal.
  const { data: drops } = await supabase
    .from("mystery_drops")
    .select(`
      id, order_id, pool_entry_id, outcome_type,
      mystery_pool!inner(label, icon, reveal_emoji, voucher_template_id)
    `)
    .eq("member_id", r.member.memberId)
    .is("revealed_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  type DropRow = {
    id: string; order_id: string | null; pool_entry_id: string; outcome_type: string;
    mystery_pool: { label: string; icon: string; reveal_emoji: string | null; voucher_template_id: string | null };
  };

  const mysteryClaimables = ((drops ?? []) as unknown as DropRow[]).map((d) => ({
    id: d.id,
    order_id: d.order_id,
    title: d.mystery_pool.label,
    description: "Tap to reveal your reward",
    icon: d.mystery_pool.icon ?? "sparkle",
    category: "special" as const,
    source_type: "mystery_pending" as const,
    expires_at: null,
    cta_label: "Reveal",
  }));

  // 2) admin_claimables — welcome / promo offers not yet claimed by this member.
  const now = new Date().toISOString();
  const { data: pushed } = await supabase
    .from("admin_claimables")
    .select(`
      id, title, description, voucher_template_id, member_ids, ends_at, max_claims, total_claimed,
      voucher_templates!inner(icon, category)
    `)
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true)
    .or(`ends_at.is.null,ends_at.gte.${now}`);

  type PushedRow = {
    id: string; title: string; description: string; voucher_template_id: string;
    member_ids: string[]; ends_at: string | null; max_claims: number | null; total_claimed: number;
    voucher_templates: { icon: string; category: string };
  };

  // Filter: only show if (a) audience targets this member or is empty (everyone),
  // (b) not already claimed by this member, (c) max_claims not exhausted.
  const eligible: PushedRow[] = [];
  for (const c of (pushed ?? []) as unknown as PushedRow[]) {
    const audienceMatch = !c.member_ids?.length || c.member_ids.includes(r.member.memberId);
    if (!audienceMatch) continue;
    if (c.max_claims !== null && c.total_claimed >= c.max_claims) continue;

    const { data: already } = await supabase
      .from("admin_claimables_claimed")
      .select("claimable_id")
      .eq("claimable_id", c.id)
      .eq("member_id", r.member.memberId)
      .maybeSingle();
    if (already) continue;

    eligible.push(c);
  }

  const pushedClaimables = eligible.map((c) => ({
    id: `admin:${c.id}`,
    title: c.title,
    description: c.description,
    icon: c.voucher_templates.icon ?? "gift",
    category: (c.voucher_templates.category ?? "special") as
      "free_item" | "upgrade" | "discount" | "multiplier" | "special",
    source_type: "promo" as const,
    expires_at: c.ends_at,
    cta_label: "Claim",
  }));

  // Mystery first (oldest pending should be revealed before promos clutter the UI).
  return NextResponse.json([...mysteryClaimables, ...pushedClaimables]);
}
