// GET /api/loyalty/all-rewards?brand_id=brand-celsius
//
// Unified rewards-list endpoint backing the new All-Rewards page in
// the backoffice. Aggregates across the channel-specific tables we
// have TODAY into the canonical-shape row the new UI consumes,
// without waiting for the schema migration. Once `voucher_triggers`
// is introduced (Commit 4 of the storehub-refactor spec), the body
// of this route collapses to a single join.
//
// Returned shape per row (the future canonical):
//   id, title, description, icon, discount_type, discount_value,
//   scope, target_ids, is_active, max_discount_value, min_order_value,
//   bogo_buy_qty, bogo_free_qty, multiplier_value, points_cost,
//   triggers: [{ type, label, config }],
//   issued_30d, used_30d, expires_days, updated_at

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

export type TriggerType =
  | "points_shop"
  | "mission"
  | "mystery"
  | "birthday"
  | "tier_upgrade"
  | "admin_push"
  | "manual_grant";

export type Trigger = {
  type: TriggerType;
  label: string;             // chip text, e.g. "Bean Shop · 300", "→ Gold"
  config?: Record<string, unknown>;
};

export type RewardRow = {
  id: string;
  /** transition-period origin: 'template' = voucher_templates row,
   *  'catalog' = legacy rewards row (Bean-Points shop). After the
   *  Commit-1/2 schema migration both collapse to 'template'. */
  origin: "template" | "catalog";
  title: string;
  description: string | null;
  icon: string | null;
  discount_type: string | null;
  discount_value: number | null;
  scope: "everything" | "products" | "categories";
  target_ids: string[];
  is_active: boolean;
  max_discount_value: number | null;
  min_order_value: number | null;
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  combo_price_sen: number | null;
  override_price_sen: number | null;
  free_product_ids: string[] | null;
  multiplier_value: number | null;
  /** Bean-Points cost. NULL for templates with no shop trigger;
   *  populated when origin='catalog' or when a points_shop trigger
   *  exists on a template (future). */
  points_cost: number | null;
  triggers: Trigger[];
  issued_30d: number;
  used_30d: number;
  expires_days: number | null;
  updated_at: string;
};

type VoucherTemplateRow = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  discount_type: string | null;
  discount_value: number | string | null;
  max_discount_value: number | string | null;
  min_order_value: number | string | null;
  multiplier_value: number | string | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  is_active: boolean;
  validity_days: number | null;
  updated_at: string;
  // Commit 3: catalog fields now live on the template (Bean-Shop mirror)
  points_cost: number | null;
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  combo_price_sen: number | null;
  override_price_sen: number | null;
};

type MissionRow = {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  goal: { type: string; value: number; period?: string } | null;
  reward_voucher_template_ids: string[];
  is_active: boolean;
};

type MysteryRow = {
  id: string;
  label: string;
  voucher_template_id: string | null;
  weight: number;
  min_tier: string | null;
  outcome_type: string;
};

const numOrNull = (v: number | string | null): number | null =>
  v == null ? null : typeof v === "string" ? Number.parseFloat(v) : v;

/** Decide canonical scope + target_ids from the legacy applicable_*
 *  fields. Mirrors the migration rule in the refactor spec — exactly
 *  one of (everything | products | categories). Free-product preferred
 *  over applicable_categories so a Free Croissant row with
 *  free_product_ids=[x] and a stale applicable_categories doesn't
 *  silently broaden eligibility. */
function deriveScope(args: {
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
}): { scope: RewardRow["scope"]; target_ids: string[] } {
  if (args.free_product_ids && args.free_product_ids.length) {
    return { scope: "products", target_ids: args.free_product_ids };
  }
  if (args.applicable_products && args.applicable_products.length) {
    return { scope: "products", target_ids: args.applicable_products };
  }
  if (args.applicable_categories && args.applicable_categories.length) {
    return { scope: "categories", target_ids: args.applicable_categories };
  }
  // free_product_name is a stale fallback the spec drops on migration;
  // we don't surface it as a target since it's free-text.
  return { scope: "everything", target_ids: [] };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const brandId = new URL(request.url).searchParams.get("brand_id") ?? "brand-celsius";

  // Run all reads in parallel. The aggregates over issued_rewards
  // (30d issued / 30d used) come back as compact group counts.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Commit 3: the catalog is now sourced from voucher_templates (rows
  // with points_cost set) — the legacy `rewards` table is no longer
  // fetched here, killing the previous 6-row Bean-Shop duplication
  // (3 catalog + 3 mirror). Catalog rows ARE templates now.
  const [tplRes, missionRes, mysteryRes, issued30Res] = await Promise.all([
    supabaseAdmin
      .from("voucher_templates")
      .select(
        "id, title, description, icon, discount_type, discount_value, max_discount_value, min_order_value, multiplier_value, applicable_categories, applicable_products, free_product_ids, free_product_name, is_active, validity_days, updated_at, points_cost, bogo_buy_qty, bogo_free_qty, combo_price_sen, override_price_sen",
      )
      .eq("brand_id", brandId),
    supabaseAdmin
      .from("reward_missions")
      .select(
        "id, title, description, difficulty, goal, reward_voucher_template_ids, is_active",
      )
      .eq("brand_id", brandId),
    supabaseAdmin
      .from("mystery_pool")
      .select("id, label, voucher_template_id, weight, min_tier, outcome_type")
      .eq("brand_id", brandId),
    supabaseAdmin
      .from("issued_rewards")
      .select("id, status, voucher_template_id, source_type, issued_at, redeemed_at")
      .eq("brand_id", brandId)
      .gte("issued_at", cutoff),
  ]);

  if (tplRes.error) return NextResponse.json({ error: tplRes.error.message }, { status: 500 });

  const templates = (tplRes.data ?? []) as VoucherTemplateRow[];
  const missions  = (missionRes.data ?? []) as MissionRow[];
  const mystery   = (mysteryRes.data ?? []) as MysteryRow[];
  const issued    = (issued30Res.data ?? []) as Array<{
    id: string;
    status: string;
    voucher_template_id: string | null;
    source_type: string | null;
    issued_at: string;
    redeemed_at: string | null;
  }>;

  // ─── Build trigger lookups by template id ───────────────────────
  // Each template can carry multiple trigger chips. Today these
  // live in 4 different tables; after Commit 4 of the refactor they
  // collapse into a single voucher_triggers join.
  const triggersByTemplate = new Map<string, Trigger[]>();
  const pushTrig = (tplId: string, t: Trigger) => {
    const arr = triggersByTemplate.get(tplId) ?? [];
    arr.push(t);
    triggersByTemplate.set(tplId, arr);
  };

  for (const m of missions) {
    if (!m.is_active) continue;
    const ids = m.reward_voucher_template_ids ?? [];
    const labelBits = [m.title || "Challenge"];
    if (m.difficulty) labelBits.push(`· ${m.difficulty}`);
    for (const tplId of ids) {
      pushTrig(tplId, {
        type: "mission",
        label: labelBits.join(" "),
        config: { mission_id: m.id, goal: m.goal, difficulty: m.difficulty },
      });
    }
  }

  // Pool drop% — denominator is the sum of all active pool weights.
  // Surfacing drop% on the trigger chip is more meaningful than raw
  // weight ("12% drop" beats "weight 10" for understanding pool design).
  const mysteryTotal = mystery.reduce((s, m) => s + (m.weight || 0), 0);
  for (const my of mystery) {
    if (!my.voucher_template_id) continue;
    const dropPct = mysteryTotal > 0 ? (my.weight / mysteryTotal) * 100 : 0;
    const tierBit = my.min_tier && my.min_tier !== "any" ? `, min ${my.min_tier}` : "";
    pushTrig(my.voucher_template_id, {
      type: "mystery",
      label: `Mystery · ${dropPct.toFixed(1)}% drop${tierBit}`,
      config: { pool_id: my.id, weight: my.weight, drop_pct: dropPct, min_tier: my.min_tier },
    });
  }

  // Bean-Shop trigger: any template with points_cost is a points-shop
  // item. Surfaced as a chip so the list reads "Bean Shop · 300".
  for (const t of templates) {
    if (t.points_cost != null && t.points_cost > 0) {
      pushTrig(t.id, {
        type: "points_shop",
        label: `Bean Shop · ${t.points_cost}`,
        config: { cost_beans: t.points_cost },
      });
    }
  }

  // ─── Stats: 30d issued + used, keyed by voucher_template_id ─────
  // Commit 2 backfilled voucher_template_id on every active issued row,
  // so this is now a straight group-by — no more reward_id / source_ref
  // attribution gymnastics.
  const issued30 = new Map<string, number>();
  const used30   = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const row of issued) {
    if (!row.voucher_template_id) continue;
    const key = `template:${row.voucher_template_id}`;
    bump(issued30, key);
    if (row.redeemed_at) bump(used30, key);
  }

  // ─── Build rows: templates first, then legacy catalog ───────────
  const rows: RewardRow[] = [];

  for (const t of templates) {
    const scope = deriveScope({
      applicable_categories: t.applicable_categories,
      applicable_products:   t.applicable_products,
      free_product_ids:      t.free_product_ids,
      free_product_name:     t.free_product_name,
    });
    const triggers = triggersByTemplate.get(t.id) ?? [];
    const key = `template:${t.id}`;
    rows.push({
      id: t.id,
      origin: "template",
      title: t.title,
      description: t.description,
      icon: t.icon,
      discount_type: t.discount_type,
      discount_value: numOrNull(t.discount_value),
      scope: scope.scope,
      target_ids: scope.target_ids,
      is_active: t.is_active,
      max_discount_value: numOrNull(t.max_discount_value),
      min_order_value: numOrNull(t.min_order_value),
      bogo_buy_qty: t.bogo_buy_qty ?? null,
      bogo_free_qty: t.bogo_free_qty ?? null,
      combo_price_sen: t.combo_price_sen ?? null,
      override_price_sen: t.override_price_sen ?? null,
      free_product_ids: t.free_product_ids ?? null,
      multiplier_value: numOrNull(t.multiplier_value),
      points_cost: t.points_cost ?? null,
      triggers,
      issued_30d: issued30.get(key) ?? 0,
      used_30d: used30.get(key) ?? 0,
      expires_days: t.validity_days,
      updated_at: t.updated_at,
    });
  }

  // (Legacy `rewards` catalog loop removed in Commit 3 — those rows are
  // now voucher_templates with points_cost, handled by the loop above.)

  // Newest first by default; the page sorts client-side after.
  rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return NextResponse.json({ rows });
}

// ─── Write handlers ────────────────────────────────────────────────
//
// POST   /api/loyalty/all-rewards     → create voucher_templates row
// PATCH  /api/loyalty/all-rewards?id=… → update voucher_templates row
// DELETE /api/loyalty/all-rewards?id=… → soft-delete (is_active=false)
//
// This route is the template registry. Channel-specific triggers
// (Mystery Pool entries, Mission rules, Birthday config, Tier Upgrade
// attaches, Admin Claimables) live on their own pages and reference
// templates via voucher_template_id. Wire/unwire those on the
// channel pages — never from here.

type CreateBody = {
  brand_id?: string;
  // template fields
  title: string;
  description?: string;
  icon?: string;
  discount_type: string;
  discount_value?: number | null;
  max_discount_value?: number | null;
  min_order_value?: number | null;
  multiplier_value?: number | null;
  // scope (canonical, mapped to legacy fields on write)
  scope: "everything" | "products" | "categories";
  target_ids?: string[];
  // type-specific knobs
  bogo_buy_qty?: number;
  bogo_free_qty?: number;
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
  /** bogo/free_item: the specific product(s) given free (the "get Y" item
   *  for BOGO). The scope/target_ids are the qualifying buy set. */
  free_product_ids?: string[] | null;
  // theming / lifecycle
  category?: string;
  validity_days?: number;
  stacks_with_beans?: boolean;
  stacks_with_other?: boolean;
  is_active?: boolean;
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = (await request.json()) as CreateBody;
  const brandId = body.brand_id ?? "brand-celsius";

  if (!body.title || !body.discount_type || !body.scope) {
    return NextResponse.json({ error: "title, discount_type, scope are required" }, { status: 400 });
  }

  // Map canonical scope + target_ids back to the legacy column trio.
  // After Commit 1 of the refactor this collapses to a direct write.
  const applicable_categories = body.scope === "categories" ? body.target_ids ?? null : null;
  const applicable_products   = body.scope === "products"   ? body.target_ids ?? null : null;

  const { data: tpl, error: tplErr } = await supabaseAdmin
    .from("voucher_templates")
    .insert({
      brand_id:              brandId,
      title:                 body.title,
      description:           body.description ?? "",
      icon:                  body.icon ?? "ticket",
      category:              body.category ?? "discount",
      discount_type:         body.discount_type,
      discount_value:        body.discount_value ?? null,
      max_discount_value:    body.max_discount_value ?? null,
      min_order_value:       body.min_order_value ?? null,
      multiplier_value:      body.multiplier_value ?? null,
      bogo_buy_qty:          body.bogo_buy_qty ?? null,
      bogo_free_qty:         body.bogo_free_qty ?? null,
      combo_price_sen:       body.combo_price_sen ?? null,
      override_price_sen:    body.override_price_sen ?? null,
      free_product_ids:      body.free_product_ids ?? null,
      applicable_categories,
      applicable_products,
      validity_days:         body.validity_days ?? 30,
      stacks_with_beans:     body.stacks_with_beans ?? true,
      stacks_with_other:     body.stacks_with_other ?? false,
      is_active:             body.is_active ?? true,
    })
    .select()
    .single();

  if (tplErr || !tpl) {
    return NextResponse.json({ error: tplErr?.message ?? "Failed to create template" }, { status: 500 });
  }

  return NextResponse.json({ template: tpl });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Origin gate: legacy catalog rows have text ids ("reward-1", etc.) —
  // we only update voucher_templates here. The legacy `rewards` table
  // edits go through the existing Points Shop page until the merge.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({
      error: "Legacy catalog rows (rewards table) must be edited via the Points Shop page until the catalog merge ships.",
    }, { status: 400 });
  }

  const body = (await request.json()) as Partial<CreateBody>;

  const update: Record<string, unknown> = {};
  if (body.title           !== undefined) update.title              = body.title;
  if (body.description     !== undefined) update.description        = body.description ?? "";
  if (body.icon            !== undefined) update.icon               = body.icon;
  if (body.category        !== undefined) update.category           = body.category;
  if (body.discount_type   !== undefined) update.discount_type      = body.discount_type;
  if (body.discount_value  !== undefined) update.discount_value     = body.discount_value;
  if (body.max_discount_value !== undefined) update.max_discount_value = body.max_discount_value;
  if (body.min_order_value !== undefined) update.min_order_value    = body.min_order_value;
  if (body.multiplier_value !== undefined) update.multiplier_value  = body.multiplier_value;
  if (body.bogo_buy_qty    !== undefined) update.bogo_buy_qty       = body.bogo_buy_qty;
  if (body.bogo_free_qty   !== undefined) update.bogo_free_qty      = body.bogo_free_qty;
  if (body.combo_price_sen !== undefined) update.combo_price_sen    = body.combo_price_sen;
  if (body.override_price_sen !== undefined) update.override_price_sen = body.override_price_sen;
  if (body.free_product_ids !== undefined) update.free_product_ids  = body.free_product_ids;
  if (body.validity_days   !== undefined) update.validity_days      = body.validity_days;
  if (body.stacks_with_beans !== undefined) update.stacks_with_beans = body.stacks_with_beans;
  if (body.stacks_with_other !== undefined) update.stacks_with_other = body.stacks_with_other;
  if (body.is_active       !== undefined) update.is_active          = body.is_active;
  if (body.scope !== undefined) {
    update.applicable_categories = body.scope === "categories" ? body.target_ids ?? null : null;
    update.applicable_products   = body.scope === "products"   ? body.target_ids ?? null : null;
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("voucher_templates")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Soft-delete: flip is_active=false. We never hard-delete a template
  // because issued_rewards rows reference it; deleting would orphan
  // historical vouchers in customer wallets.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({
      error: "Legacy catalog rows must be archived via the Points Shop page until the catalog merge ships.",
    }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("voucher_templates")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
