import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  markVoucherUsed,
  rowToDiscountSpec,
  inlineSpecFromIssued,
  specToRegisterDescriptor,
  DISCOUNT_SPEC_COLUMNS,
  type DiscountSpecRow,
  type VoucherDiscountSpec,
} from "@celsius/shared";

// Service-role required: member_brands writes + issued_rewards updates
// are blocked under anon. Without this, the modal hand-off succeeds
// but the actual deduction silently fails.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const BRAND_ID = "brand-celsius";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

/**
 * POST /api/loyalty/redeem
 * Body: { member_id, reward_id, outlet_id, issued_reward_id? }
 *
 * For catalog rewards: deducts points, creates redemption record
 * For issued rewards: marks issued_reward as "used", creates redemption record (0 points)
 *
 * The discount descriptor is built via @celsius/shared specToRegisterDescriptor
 * from the canonical voucher spec (Phase 2 of the cross-channel rewards
 * consolidation) — the same spec native + QR-table resolve from.
 */
export async function POST(req: NextRequest) {
  try {
    const { member_id, reward_id, outlet_id, issued_reward_id, preview } = await req.json();

    if (!member_id || !reward_id) {
      return NextResponse.json({ error: "member_id and reward_id required" }, { status: 400 });
    }

    // Resolve the reward + its discount descriptor from one of two sources:
    //  • Issued voucher (mystery / mission / birthday / welcome): the discount
    //    lives on the issued_rewards row itself. These are minted by the engine
    //    with reward_id = NULL and no legacy_reward_id, so the voucher_templates
    //    lookup below would 404 — meaning earned vouchers could NEVER be redeemed
    //    at the till. Resolve them from issued_rewards directly instead.
    //  • Catalog / Bean-Shop reward: the canonical voucher_templates row, keyed
    //    by legacy_reward_id (name:title, points_required:points_cost aliases keep
    //    the downstream points math unchanged).
    let reward: Record<string, any> | null = null;
    // Canonical discount spec, resolved the SAME way every channel does
    // (apps/order's wallet + catalog paths) so POS never drifts. The
    // register is client-authoritative — it applies this spec to its own
    // on-screen cart — so we hand back a descriptor (specToRegisterDescriptor)
    // rather than computing a sen amount here (the redeem route has no cart).
    let spec: VoucherDiscountSpec | null = null;
    if (issued_reward_id) {
      const { data: ir, error: irLookupErr } = await supabase
        .from("issued_rewards")
        .select("id, member_id, title, description, voucher_template_id, discount_type, discount_value, min_order_value, applicable_products, applicable_categories, free_product_name, status")
        .eq("id", issued_reward_id)
        .eq("member_id", member_id)
        .maybeSingle();
      if (irLookupErr || !ir) {
        return NextResponse.json({ error: "Reward not found" }, { status: 404 });
      }
      if (ir.status !== "active") {
        return NextResponse.json({ error: "Reward already used or expired" }, { status: 400 });
      }
      // points_required 0 (issued vouchers cost no points); stock null (no cap).
      reward = { ...ir, name: ir.title, points_required: 0, stock: null };
      // Prefer the linked voucher_template's full mechanics — max_discount,
      // free_product_ids, and the bogo/combo/override knobs live ONLY on the
      // template, not the denormalized issued_rewards row. Without this an
      // earned bogo/combo voucher loses those knobs at the till (the exact
      // drift apps/order's wallet path already fixes). Fall back to the
      // inline columns for legacy vouchers minted before the link existed.
      if (ir.voucher_template_id) {
        const { data: tmpl } = await supabase
          .from("voucher_templates")
          .select(DISCOUNT_SPEC_COLUMNS)
          .eq("id", ir.voucher_template_id)
          .maybeSingle<DiscountSpecRow>();
        spec = tmpl ? rowToDiscountSpec(tmpl) : inlineSpecFromIssued(ir);
      } else {
        spec = inlineSpecFromIssued(ir);
      }
    } else {
      const { data: vt, error: rwErr } = await supabase
        .from("voucher_templates")
        .select("*, name:title, points_required:points_cost")
        .eq("legacy_reward_id", reward_id)
        .eq("brand_id", BRAND_ID)
        .eq("is_active", true)
        .maybeSingle();
      if (rwErr || !vt) {
        return NextResponse.json({ error: "Reward not found or inactive" }, { status: 404 });
      }
      reward = vt;
      spec = rowToDiscountSpec(vt as DiscountSpecRow);
    }
    if (!reward || !spec) {
      return NextResponse.json({ error: "Reward not found or inactive" }, { status: 404 });
    }

    // Check stock (catalog rewards only — issued vouchers carry stock = null)
    if (reward.stock != null && reward.stock <= 0) {
      return NextResponse.json({ error: "Reward out of stock" }, { status: 400 });
    }

    // ── Preview (POS deferred burn) ──────────────────────────────────
    // The register RESERVES a catalog reward on the cart and the actual
    // Beans burn + redemption record happen at payment confirmation
    // (/api/pos/loyalty/complete), pickup-style. Here we only validate
    // affordability and hand back the discount descriptor — no deduction,
    // no redemption row. Issued vouchers (issued_reward_id) still commit
    // immediately; they don't cost Beans.
    if (preview && !issued_reward_id) {
      const { data: mb } = await supabase
        .from("member_brands")
        .select("points_balance")
        .eq("member_id", member_id)
        .eq("brand_id", BRAND_ID)
        .maybeSingle();
      const balance = mb?.points_balance ?? 0;
      if (balance < (reward.points_required ?? 0)) {
        return NextResponse.json({ error: "Insufficient points" }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        redemption_id: null,  // not redeemed yet — committed at payment
        code: null,
        new_balance: balance, // unchanged until the burn at /complete
        reward_name: reward.name,
        discount: specToRegisterDescriptor(spec),
        points_spent: reward.points_required ?? 0, // burned at /complete; shown on receipt
        preview: true,
      });
    }

    let newBalance: number;
    const code = generateCode();

    if (issued_reward_id) {
      // ── Issued reward (birthday/welcome): no point deduction ──
      // Single source of truth: the shared markVoucherUsed helper (the same
      // one apps/order's checkout uses) flips status → 'used' AND stamps
      // redeemed_at, scoped to id + member_id + brand_id + status='active'.
      // Idempotent — a re-call on an already-burned voucher returns
      // alreadyUsed:true rather than erroring, so a POS retry won't 500.
      const burn = await markVoucherUsed({
        supabase,
        voucherId: issued_reward_id,
        memberId: member_id,
        brandId: BRAND_ID,
      });
      if (!burn.ok) {
        return NextResponse.json({ error: "Failed to use issued reward" }, { status: 500 });
      }

      // Get current balance for response
      const { data: mb } = await supabase
        .from("member_brands")
        .select("points_balance")
        .eq("member_id", member_id)
        .eq("brand_id", BRAND_ID)
        .single();
      newBalance = mb?.points_balance ?? 0;

    } else {
      // ── Catalog reward: atomic point deduction ──
      const { data: deductResult, error: deductErr } = await supabase
        .rpc("deduct_points", {
          p_member_id: member_id,
          p_brand_id: BRAND_ID,
          p_points: reward.points_required,
        });

      if (deductErr) {
        // Fallback: manual deduction if RPC doesn't exist
        if (deductErr.message.includes("function") || deductErr.code === "42883") {
          const { data: mb } = await supabase
            .from("member_brands")
            .select("*")
            .eq("member_id", member_id)
            .eq("brand_id", BRAND_ID)
            .single();

          if (!mb || mb.points_balance < reward.points_required) {
            return NextResponse.json({ error: "Insufficient points" }, { status: 400 });
          }

          newBalance = mb.points_balance - reward.points_required;
          await supabase
            .from("member_brands")
            .update({
              points_balance: newBalance,
              total_points_redeemed: mb.total_points_redeemed + reward.points_required,
            })
            .eq("id", mb.id);
        } else {
          return NextResponse.json({ error: "Failed to deduct points" }, { status: 500 });
        }
      } else {
        newBalance = deductResult as number;
        if (newBalance < 0) {
          return NextResponse.json({ error: "Insufficient points" }, { status: 400 });
        }
      }

      // Create point_transaction for audit
      await supabase.from("point_transactions").insert({
        id: `txn-pos-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
        member_id,
        brand_id: BRAND_ID,
        outlet_id: outlet_id || null,
        type: "redeem",
        points: -reward.points_required,
        balance_after: newBalance,
        description: `POS Redeemed: ${reward.name}`,
        reference_id: null, // will be updated with redemption id
        multiplier: 1,
      });
    }

    // Create redemption record
    const rdmId = `rdm-pos-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const { data: redemption, error: rdmErr } = await supabase
      .from("redemptions")
      .insert({
        id: rdmId,
        member_id,
        reward_id,
        brand_id: BRAND_ID,
        outlet_id: outlet_id || null,
        points_spent: issued_reward_id ? 0 : reward.points_required,
        status: "confirmed", // POS redemptions are instantly confirmed
        code,
        redemption_type: "in_store",
        source: "pos",
        confirmed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (rdmErr) {
      // Rollback points if redemption record fails (only for catalog rewards)
      if (!issued_reward_id) {
        await supabase.rpc("deduct_points", {
          p_member_id: member_id,
          p_brand_id: BRAND_ID,
          p_points: -reward.points_required, // negative = add back
        });
      }
      return NextResponse.json({ error: "Failed to create redemption" }, { status: 500 });
    }

    // Decrement stock on the canonical template, keyed by legacy id.
    if (reward.stock !== null) {
      await supabase
        .from("voucher_templates")
        .update({ stock: Math.max(0, reward.stock - 1) })
        .eq("legacy_reward_id", reward_id)
        .gt("stock", 0);
    }

    // Discount descriptor for the register to apply (shared projection).
    const discount = specToRegisterDescriptor(spec);

    return NextResponse.json({
      success: true,
      redemption_id: rdmId,
      code,
      new_balance: newBalance,
      reward_name: reward.name,
      discount,
      points_spent: issued_reward_id ? 0 : (reward.points_required ?? 0),
    });
  } catch (err) {
    console.error("[LOYALTY] Redeem error:", err);
    return NextResponse.json({ error: "Redemption failed" }, { status: 500 });
  }
}

// The POS discount descriptor is now built by @celsius/shared
// specToRegisterDescriptor(spec) — one lossless, unit-safe projection of
// the canonical VoucherDiscountSpec, shared with native + QR-table. The old
// name-parsing buildDiscountInfo (which leaked RM-vs-SEN on its dead legacy
// branch, and never carried the template-only bogo/combo/override knobs for
// issued vouchers) is gone.
