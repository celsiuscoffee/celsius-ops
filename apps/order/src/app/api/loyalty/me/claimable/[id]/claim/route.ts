// POST /api/loyalty/me/claimable/[id]/claim
//
// "One-tap claim" for offers in the customer's claimable list. Behaviour
// depends on the underlying source:
//   - mystery_pending → routes through revealMysteryDrop (issues voucher
//     if drop was a voucher outcome) but doesn't show the reveal UI; we
//     just claim the underlying voucher and let the wallet update.
//   - promo / welcome → issues the underlying voucher template directly.

import { NextRequest, NextResponse } from "next/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";
import { revealMysteryDrop, issueVoucher } from "@/lib/loyalty/v2";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const { id } = await ctx.params;
  const supabase = getSupabaseAdmin();

  // admin_claimables ids are prefixed "admin:<uuid>" in the list endpoint
  // so the client doesn't collide with mystery_drops ids.
  if (id.startsWith("admin:")) {
    const adminId = id.slice("admin:".length);
    const { data: claimable } = await supabase
      .from("admin_claimables")
      .select("id, voucher_template_id, member_ids, max_claims, total_claimed, ends_at, is_active")
      .eq("id", adminId)
      .single();
    if (!claimable || !claimable.is_active) {
      return NextResponse.json({ error: "Claimable not found" }, { status: 404 });
    }
    if (claimable.ends_at && new Date(claimable.ends_at as string) < new Date()) {
      return NextResponse.json({ error: "Offer expired" }, { status: 410 });
    }
    if (claimable.max_claims !== null && (claimable.total_claimed ?? 0) >= claimable.max_claims) {
      return NextResponse.json({ error: "Offer fully claimed" }, { status: 410 });
    }
    const audienceMatch = !(claimable.member_ids as string[])?.length
      || (claimable.member_ids as string[]).includes(r.member.memberId);
    if (!audienceMatch) {
      return NextResponse.json({ error: "Not eligible" }, { status: 403 });
    }
    // Idempotency check.
    const { data: already } = await supabase
      .from("admin_claimables_claimed")
      .select("voucher_id")
      .eq("claimable_id", adminId)
      .eq("member_id", r.member.memberId)
      .maybeSingle();
    if (already?.voucher_id) {
      // Already claimed — return the existing voucher.
      const { data: v } = await supabase
        .from("issued_rewards")
        .select(`id, voucher_template_id, source_type, title, description, icon, category,
                 status, issued_at, expires_at, redeemed_at, stacks_with_beans`)
        .eq("id", already.voucher_id as string)
        .single();
      return NextResponse.json(v);
    }

    const issued = await issueVoucher({
      memberId: r.member.memberId,
      templateId: claimable.voucher_template_id as string,
      sourceType: "manual",
      sourceRefId: adminId,
    });
    if (!issued) return NextResponse.json({ error: "Failed to issue voucher" }, { status: 500 });

    await supabase.from("admin_claimables_claimed").insert({
      claimable_id: adminId,
      member_id: r.member.memberId,
      voucher_id: issued.id,
    });
    await supabase
      .from("admin_claimables")
      .update({ total_claimed: (claimable.total_claimed ?? 0) + 1 })
      .eq("id", adminId);

    return NextResponse.json(issued);
  }

  // Is this a mystery drop?
  const { data: drop } = await supabase
    .from("mystery_drops")
    .select("id")
    .eq("id", id)
    .eq("member_id", r.member.memberId)
    .single();

  if (drop) {
    // Treat claim as a reveal-with-zero-base — bonus beans aren't relevant
    // for the claim flow (the dedicated /reveal endpoint handles that on
    // the order confirmation screen).
    const result = await revealMysteryDrop({
      memberId: r.member.memberId,
      dropId: drop.id,
      baseBeansEarned: 0,
    });
    if (!result) return NextResponse.json({ error: "Drop not found" }, { status: 404 });

    // Best-effort: return the issued voucher row so the client can drop
    // it into the wallet immediately.
    if (result.voucher_id) {
      const { data: v } = await supabase
        .from("issued_rewards")
        .select(`
          id, voucher_template_id, source_type,
          title, description, icon, category,
          status, issued_at, expires_at, redeemed_at, stacks_with_beans
        `)
        .eq("id", result.voucher_id)
        .single();
      if (v) {
        return NextResponse.json({
          id: v.id,
          template_id: v.voucher_template_id ?? null,
          title: v.title,
          description: v.description,
          icon: v.icon,
          category: v.category,
          status: v.status,
          source_type: v.source_type,
          issued_at: v.issued_at,
          expires_at: v.expires_at,
          redeemed_at: v.redeemed_at,
          stacks_with_beans: v.stacks_with_beans ?? true,
        });
      }
    }
    // Non-voucher outcomes (no_bonus / multiplier without context) — just
    // mark claimed; client refreshes wallet anyway.
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Claimable not found" }, { status: 404 });
}
