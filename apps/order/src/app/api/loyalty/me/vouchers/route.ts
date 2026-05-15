// GET /api/loyalty/me/vouchers — caller's voucher wallet (active + recent).
//
// Returns issued_rewards rows for the authenticated member, sorted by
// expiry (soonest first), with status filter open so the client can show
// active / redeemed / expired in one trip if it wants.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";

export async function GET(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("issued_rewards")
    .select(`
      id, voucher_template_id, source_type, source_ref_id,
      title, description, icon, category,
      status, issued_at, expires_at, redeemed_at,
      stacks_with_beans,
      discount_type, discount_value, min_order_value,
      applicable_categories, applicable_products, free_product_name
    `)
    .eq("member_id", r.member.memberId)
    .in("status", ["active"])
    .order("expires_at", { ascending: true, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve voucher_template_id → reward_kind_id → (color, illustration_url)
  // in two batched lookups. The native voucher card reads these as a
  // per-voucher visual override on top of the source-bucket theme.
  // Templates without a reward_kind_id (most existing rows) just keep
  // the bucket theme — no behaviour change for those.
  type VoucherRow = {
    id: string; voucher_template_id: string | null; source_type: string | null;
    source_ref_id: string | null; title: string | null; description: string | null;
    icon: string | null; category: string | null; status: string;
    issued_at: string; expires_at: string | null; redeemed_at: string | null;
    stacks_with_beans: boolean | null;
    discount_type: string | null; discount_value: number | null; min_order_value: number | null;
    applicable_categories: string[] | null; applicable_products: string[] | null;
    free_product_name: string | null;
  };
  const rows = (data ?? []) as unknown as VoucherRow[];

  const templateIds = Array.from(new Set(
    rows.map((v) => v.voucher_template_id).filter((id): id is string => !!id),
  ));
  const kindByTemplateId = new Map<string, { color: string | null; illustration_url: string | null }>();
  if (templateIds.length > 0) {
    const { data: tpls } = await supabase
      .from("voucher_templates")
      .select("id, reward_kind_id")
      .in("id", templateIds);
    type TplRow = { id: string; reward_kind_id: string | null };
    const tplRows = (tpls ?? []) as TplRow[];
    const kindIds = Array.from(new Set(
      tplRows.map((t) => t.reward_kind_id).filter((id): id is string => !!id),
    ));
    if (kindIds.length > 0) {
      const { data: kinds } = await supabase
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

  const out = rows.map((v) => {
    const kind = v.voucher_template_id ? kindByTemplateId.get(v.voucher_template_id) : null;
    return {
      id: v.id,
      template_id: v.voucher_template_id ?? null,
      title: v.title ?? "Voucher",
      description: v.description ?? "",
      icon: v.icon ?? "ticket",
      category: v.category ?? "special",
      status: v.status,
      source_type: v.source_type ?? null,
      source_ref_id: v.source_ref_id ?? null,
      issued_at: v.issued_at,
      expires_at: v.expires_at,
      redeemed_at: v.redeemed_at,
      stacks_with_beans: v.stacks_with_beans ?? true,
      discount_type:         v.discount_type ?? null,
      discount_value:        v.discount_value ?? null,
      min_order_value:       v.min_order_value ?? null,
      applicable_categories: v.applicable_categories ?? null,
      applicable_products:   v.applicable_products ?? null,
      free_product_name:     v.free_product_name ?? null,
      // Per-voucher visual override from the linked reward_kind.
      // Native VoucherWallet reads kind_color + illustration_url
      // and uses them on top of the source-bucket theme.
      kind_color:        kind?.color ?? null,
      illustration_url:  kind?.illustration_url ?? null,
    };
  });

  return NextResponse.json(out);
}
