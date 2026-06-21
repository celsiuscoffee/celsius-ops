// Shared, canonical "active wallet voucher" fetch — single source of
// truth used by BOTH apps/order (Pickup) and apps/pos. Replaces two
// near-duplicate queries that had drifted in their filters, joins,
// and response field sets.
//
// The strict ActiveVoucher type below is what both apps return to
// their clients. POS legacy fields (image_url, reward_type, is_issued,
// issued_reward_id) are deliberately dropped — they were either
// unused or redundant with source_type / array position.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Where a voucher came from — drives theme bucket + eyebrow label
 *  on the client. Mirrors issued_rewards.source_type values seen in
 *  prod. */
export type VoucherSource =
  | "mission"
  | "mystery"
  | "birthday"
  | "referral"
  | "manual"
  | "points_redemption"
  | "welcome"
  | "promo"
  | "campaign";

/** Discount mechanic on a voucher. Mirrors the DB CHECK constraint
 *  on voucher_templates.discount_type. */
export type VoucherDiscountType =
  | "flat"
  | "percent"
  | "free_item"
  | "bogo"
  | "combo"
  | "override_price"
  | "beans_multiplier"
  | "none";

/** Canonical wallet voucher. Identical shape returned to POS + Pickup
 *  clients. Field names match the existing Pickup contract so the
 *  pickup-native app keeps working without a type change. */
export type ActiveVoucher = {
  /** issued_rewards.id — also the value to send to /redeem and
   *  /mark-used as the "burn this voucher" reference. */
  id: string;
  /** Modern voucher_template_id (null for legacy rows that joined
   *  through the rewards catalog instead). */
  template_id: string | null;
  /** Legacy catalog back-reference. Required by the POS /redeem
   *  endpoint which looks up the rewards table to validate stock +
   *  active status. NULL for modern voucher-template-backed rows
   *  (mission / mystery / referral). */
  reward_id: string | null;
  /** Theme bucket + label */
  source_type: VoucherSource | null;
  /** Back-ref to whatever issued the voucher (mission_assignments.id,
   *  mystery_drops.id, referral_attributions.id, etc.) */
  source_ref_id: string | null;
  /** Display fields */
  title: string;
  description: string;
  icon: string;
  category: string;
  /** Status — always "active" since this fetcher filters for it. */
  status: "active";
  /** Lifecycle timestamps */
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  /** Discount mechanics — drive the checkout discount engine */
  discount_type: VoucherDiscountType | null;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_name: string | null;
  free_product_ids: string[] | null;
  /** BOGO mechanics — resolved from the linked voucher_template (NOT carried on
   *  issued_rewards). Without these the cart engine computes a RM0 free item. */
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  /** Combo bundle price / single-item override price (SEN) — template-only. */
  combo_price_sen: number | null;
  override_price_sen: number | null;
  /** Whether this voucher stacks with bean redemptions in the same cart */
  stacks_with_beans: boolean;
  /** Optional per-voucher visual override from the linked reward_kind */
  kind_color: string | null;
  illustration_url: string | null;
};

/** Raw issued_rewards row shape — internal, do not export.
 *  NOTE: issued_rewards denormalises a subset of the template's
 *  discount metadata at grant-time — title, discount_type,
 *  discount_value, min_order_value, applicable_*, free_product_name.
 *  It does NOT carry max_discount_value or free_product_ids — those
 *  stay on voucher_templates / rewards. The ActiveVoucher type below
 *  still exposes them as fields for shape stability with the catalog
 *  side; we just always return null here. */
type IssuedRow = {
  id: string;
  voucher_template_id: string | null;
  reward_id: string | null;
  source_type: string | null;
  source_ref_id: string | null;
  title: string | null;
  description: string | null;
  icon: string | null;
  category: string | null;
  status: string;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  stacks_with_beans: boolean | null;
  discount_type: string | null;
  discount_value: number | null;
  min_order_value: number | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_name: string | null;
};

/** Fetch all active wallet vouchers for a member. Single source of
 *  truth used by both POS and Pickup. Applies the same canonical
 *  filter set:
 *    - status = 'active'
 *    - brand_id = brandId (defaults to 'brand-celsius')
 *    - drop rows where expires_at < now() (defensive — the
 *      voucher-expire cron usually flips these to 'expired' but
 *      there's a small window where they're still "active")
 *    - drop rows with no usable identity (no title AND no
 *      reward_id; only an indicator of a half-written grant)
 *    - ORDER BY expires_at ASC NULLS LAST so soonest-to-expire
 *      shows first
 *
 *  Joins voucher_templates → reward_kinds to resolve per-voucher
 *  visual overrides (color + illustration_url). Templates without
 *  a linked reward_kind silently fall back to bucket defaults on
 *  the client. */
export async function fetchActiveVouchersForMember(args: {
  supabase: SupabaseClient;
  memberId: string;
  brandId?: string;
}): Promise<ActiveVoucher[]> {
  const brandId = args.brandId ?? "brand-celsius";

  const { data, error } = await args.supabase
    .from("issued_rewards")
    .select(`
      id, voucher_template_id, reward_id, source_type, source_ref_id,
      title, description, icon, category,
      status, issued_at, expires_at, redeemed_at,
      stacks_with_beans,
      discount_type, discount_value, min_order_value,
      applicable_categories, applicable_products,
      free_product_name
    `)
    .eq("member_id", args.memberId)
    .eq("brand_id", brandId)
    .eq("status", "active")
    .order("expires_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw new Error(`fetchActiveVouchersForMember: ${error.message}`);
  }

  const nowMs = Date.now();
  const rows = ((data ?? []) as unknown as IssuedRow[]).filter((r) => {
    if (r.expires_at && new Date(r.expires_at).getTime() < nowMs) return false;
    if (!r.title && !r.reward_id) return false;
    return true;
  });

  // Resolve per-voucher theme overrides via voucher_templates →
  // reward_kinds. Two batched lookups to avoid N+1.
  const templateIds = Array.from(new Set(
    rows.map((v) => v.voucher_template_id).filter((id): id is string => !!id),
  ));
  const kindByTemplateId = new Map<string, { color: string | null; illustration_url: string | null }>();
  // Discount mechanics that live ONLY on voucher_templates (not denormalized
  // onto issued_rewards): BOGO quantities + free_product_ids. The cart engine
  // needs these to compute a bogo / free-item discount.
  const mechByTemplateId = new Map<string, { bogo_buy_qty: number | null; bogo_free_qty: number | null; free_product_ids: string[] | null; max_discount_value: number | null; combo_price_sen: number | null; override_price_sen: number | null }>();
  if (templateIds.length > 0) {
    const { data: tpls } = await args.supabase
      .from("voucher_templates")
      .select("id, reward_kind_id, bogo_buy_qty, bogo_free_qty, free_product_ids, max_discount_value, combo_price_sen, override_price_sen")
      .in("id", templateIds);
    type TplRow = { id: string; reward_kind_id: string | null; bogo_buy_qty: number | null; bogo_free_qty: number | null; free_product_ids: string[] | null; max_discount_value: number | null; combo_price_sen: number | null; override_price_sen: number | null };
    const tplRows = (tpls ?? []) as TplRow[];
    for (const t of tplRows) {
      mechByTemplateId.set(t.id, { bogo_buy_qty: t.bogo_buy_qty, bogo_free_qty: t.bogo_free_qty, free_product_ids: t.free_product_ids, max_discount_value: t.max_discount_value, combo_price_sen: t.combo_price_sen, override_price_sen: t.override_price_sen });
    }
    const kindIds = Array.from(new Set(
      tplRows.map((t) => t.reward_kind_id).filter((id): id is string => !!id),
    ));
    if (kindIds.length > 0) {
      const { data: kinds } = await args.supabase
        .from("reward_kinds")
        .select("id, color, illustration_url")
        .in("id", kindIds);
      type KindRow = { id: string; color: string | null; illustration_url: string | null };
      const kindById = new Map<string, KindRow>(
        ((kinds ?? []) as KindRow[]).map((k) => [k.id, k]),
      );
      for (const t of tplRows) {
        if (t.reward_kind_id) {
          const k = kindById.get(t.reward_kind_id);
          if (k) kindByTemplateId.set(t.id, { color: k.color, illustration_url: k.illustration_url });
        }
      }
    }
  }

  return rows.map((v): ActiveVoucher => {
    const kind = v.voucher_template_id ? kindByTemplateId.get(v.voucher_template_id) : null;
    const mech = v.voucher_template_id ? mechByTemplateId.get(v.voucher_template_id) : null;
    return {
      id: v.id,
      template_id: v.voucher_template_id ?? null,
      reward_id: v.reward_id ?? null,
      source_type: v.source_type as VoucherSource | null,
      source_ref_id: v.source_ref_id,
      title: v.title ?? "Voucher",
      description: v.description ?? "",
      icon: v.icon ?? "ticket",
      category: v.category ?? "special",
      status: "active",
      issued_at: v.issued_at,
      expires_at: v.expires_at,
      redeemed_at: v.redeemed_at,
      discount_type: (v.discount_type as VoucherDiscountType | null) ?? null,
      discount_value: v.discount_value ?? null,
      // Resolved from the linked template (only lives there, not on issued_rewards).
      max_discount_value: mech?.max_discount_value ?? null,
      min_order_value: v.min_order_value ?? null,
      applicable_categories: v.applicable_categories ?? null,
      applicable_products: v.applicable_products ?? null,
      free_product_name: v.free_product_name ?? null,
      // Resolved from the linked template (these live only there, not on issued_rewards).
      free_product_ids: mech?.free_product_ids ?? null,
      bogo_buy_qty: mech?.bogo_buy_qty ?? null,
      bogo_free_qty: mech?.bogo_free_qty ?? null,
      combo_price_sen: mech?.combo_price_sen ?? null,
      override_price_sen: mech?.override_price_sen ?? null,
      stacks_with_beans: v.stacks_with_beans ?? true,
      kind_color: kind?.color ?? null,
      illustration_url: kind?.illustration_url ?? null,
    };
  });
}
