import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/loyalty/claim
 * Body: { member_id, claimable_id }
 *
 * Claims an admin_claimables row OR reveals a mystery_drops outcome and,
 * for voucher outcomes, mints an issued_rewards row to the member's
 * wallet. Mirrors apps/order/src/app/api/loyalty/me/claimable/[id]/claim
 * minus the resolveMember session check — caller is the in-store
 * customer-display, identity is established by phone lookup upstream.
 *
 * 200 → { voucher? } where voucher is the new issued_rewards row (or
 *       null for non-voucher mystery outcomes).
 * 404 → claimable / drop not found, or member ineligible.
 * 410 → expired / fully claimed.
 */

const BRAND_ID = "brand-celsius";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

async function issueVoucherFromTemplate(
  supabase: ReturnType<typeof getAdmin>,
  args: {
    memberId: string;
    templateId: string;
    sourceType: "manual" | "mystery";
    sourceRefId: string;
  },
) {
  const { data: tpl } = await supabase
    .from("voucher_templates")
    .select(
      "id, title, description, icon, category, validity_days, discount_type, discount_value, multiplier_value, min_order_value, applicable_categories, applicable_products, free_product_name, stacks_with_beans",
    )
    .eq("id", args.templateId)
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true)
    .single();

  if (!tpl) return null;

  const expiresAt = tpl.validity_days
    ? new Date(Date.now() + tpl.validity_days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const id = `ir-${args.sourceType}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const { data, error } = await supabase
    .from("issued_rewards")
    .insert({
      id,
      brand_id: BRAND_ID,
      member_id: args.memberId,
      voucher_template_id: tpl.id,
      source_type: args.sourceType,
      source_ref_id: args.sourceRefId,
      title: tpl.title,
      description: tpl.description,
      icon: tpl.icon,
      category: tpl.category,
      discount_type: tpl.discount_type,
      discount_value: tpl.discount_value,
      multiplier_value: tpl.multiplier_value,
      min_order_value: tpl.min_order_value,
      applicable_categories: tpl.applicable_categories,
      applicable_products: tpl.applicable_products,
      free_product_name: tpl.free_product_name,
      stacks_with_beans: tpl.stacks_with_beans ?? true,
      status: "active",
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    console.warn("[LOYALTY] issueVoucherFromTemplate insert failed:", error.message);
    return null;
  }
  return data;
}

export async function POST(req: NextRequest) {
  try {
    const { member_id, claimable_id } = await req.json();
    if (!member_id || !claimable_id) {
      return NextResponse.json(
        { error: "member_id and claimable_id required" },
        { status: 400 },
      );
    }

    const supabase = getAdmin();

    // ── Admin claimable path ─────────────────────────────────
    if (typeof claimable_id === "string" && claimable_id.startsWith("admin:")) {
      const adminId = claimable_id.slice("admin:".length);
      const { data: c } = await supabase
        .from("admin_claimables")
        .select(
          "id, voucher_template_id, member_ids, max_claims, total_claimed, ends_at, is_active",
        )
        .eq("id", adminId)
        .single();
      if (!c || !c.is_active) {
        return NextResponse.json({ error: "Claimable not found" }, { status: 404 });
      }
      if (c.ends_at && new Date(c.ends_at as string).getTime() < Date.now()) {
        return NextResponse.json({ error: "Offer expired" }, { status: 410 });
      }
      if (c.max_claims !== null && (c.total_claimed ?? 0) >= c.max_claims) {
        return NextResponse.json({ error: "Offer fully claimed" }, { status: 410 });
      }
      const audience = (c.member_ids ?? []) as string[];
      if (audience.length && !audience.includes(member_id)) {
        return NextResponse.json({ error: "Not eligible" }, { status: 403 });
      }

      // Idempotency.
      const { data: already } = await supabase
        .from("admin_claimables_claimed")
        .select("voucher_id")
        .eq("claimable_id", adminId)
        .eq("member_id", member_id)
        .maybeSingle();
      if (already?.voucher_id) {
        const { data: existing } = await supabase
          .from("issued_rewards")
          .select("*")
          .eq("id", already.voucher_id as string)
          .single();
        return NextResponse.json({ voucher: existing, already_claimed: true });
      }

      const issued = await issueVoucherFromTemplate(supabase, {
        memberId: member_id,
        templateId: c.voucher_template_id as string,
        sourceType: "manual",
        sourceRefId: adminId,
      });
      if (!issued) {
        return NextResponse.json({ error: "Failed to issue voucher" }, { status: 500 });
      }

      await supabase.from("admin_claimables_claimed").insert({
        claimable_id: adminId,
        member_id,
        voucher_id: issued.id,
      });
      await supabase
        .from("admin_claimables")
        .update({ total_claimed: (c.total_claimed ?? 0) + 1 })
        .eq("id", adminId);

      return NextResponse.json({ voucher: issued });
    }

    // ── Mystery drop reveal path ─────────────────────────────
    const { data: drop } = await supabase
      .from("mystery_drops")
      .select(
        "id, member_id, order_id, pool_entry_id, outcome_type, multiplier_applied, beans_awarded, voucher_id, revealed_at",
      )
      .eq("id", claimable_id)
      .eq("member_id", member_id)
      .single();
    if (!drop) {
      return NextResponse.json({ error: "Claimable not found" }, { status: 404 });
    }

    const { data: entry } = await supabase
      .from("mystery_pool")
      .select("label, reveal_emoji, voucher_template_id, outcome_type")
      .eq("id", drop.pool_entry_id)
      .single();
    if (!entry) {
      return NextResponse.json({ error: "Drop pool entry missing" }, { status: 404 });
    }

    let voucher = null;
    if (!drop.revealed_at) {
      if (drop.outcome_type === "voucher" && entry.voucher_template_id) {
        voucher = await issueVoucherFromTemplate(supabase, {
          memberId: member_id,
          templateId: entry.voucher_template_id as string,
          sourceType: "mystery",
          sourceRefId: drop.id,
        });
      }
      await supabase
        .from("mystery_drops")
        .update({
          revealed_at: new Date().toISOString(),
          voucher_id: voucher?.id ?? drop.voucher_id,
        })
        .eq("id", drop.id);
    } else if (drop.voucher_id) {
      const { data: existing } = await supabase
        .from("issued_rewards")
        .select("*")
        .eq("id", drop.voucher_id as string)
        .single();
      voucher = existing;
    }

    return NextResponse.json({
      voucher,
      mystery: {
        outcome_type: drop.outcome_type,
        multiplier_value: drop.multiplier_applied,
        flat_beans_value: drop.beans_awarded,
        label: entry.label,
        reveal_emoji: entry.reveal_emoji,
      },
    });
  } catch (err) {
    console.error("[LOYALTY] claim error:", err);
    return NextResponse.json({ error: "Claim failed" }, { status: 500 });
  }
}
