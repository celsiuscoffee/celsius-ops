import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOrderReward } from "../order-reward";

// Characterization tests for the server-side reward resolution used by
// every redemption route (QR-table, native pickup, POS register). A
// scripted fake stands in for supabase; each handler receives the
// accumulated filters so one table can answer different queries.

type Query = { select: string; filters: Record<string, unknown>; limit?: number };
type Handler = (q: Query) => unknown;

function fakeDb(tables: Record<string, Handler>): SupabaseClient {
  return {
    from(table: string) {
      const handler = tables[table];
      if (!handler) throw new Error(`unexpected table ${table}`);
      const q: Query = { select: "", filters: {} };
      const builder = {
        select(s: string) {
          q.select = s;
          return builder;
        },
        eq(col: string, val: unknown) {
          q.filters[col] = val;
          return builder;
        },
        limit(n: number) {
          q.limit = n;
          return builder;
        },
        in(col: string, vals: unknown[]) {
          q.filters[col] = vals;
          return Promise.resolve({ data: handler(q), error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: handler(q), error: null });
        },
        single() {
          return Promise.resolve({ data: handler(q), error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const FUTURE = "2099-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";

// One RM20 latte. subtotalSen passed to the resolver matches.
const items = [{ product: { id: "p-latte", name: "Latte" }, quantity: 1, basePrice: 20, totalPrice: 20 }];
const SUBTOTAL = 2000;

const flatTemplate = {
  discount_type: "flat",
  discount_value: 500,
  max_discount_value: null,
  min_order_value: null,
  applicable_categories: null,
  applicable_products: null,
  free_product_ids: null,
  free_product_name: null,
  bogo_buy_qty: null,
  bogo_free_qty: null,
  combo_price_sen: null,
  override_price_sen: null,
};

function walletRow(overrides: Record<string, unknown> = {}) {
  return {
    member_id: "m1",
    status: "active",
    expires_at: null,
    voucher_template_id: "t1",
    min_order_value: null,
    discount_type: null,
    discount_value: null,
    applicable_categories: null,
    applicable_products: null,
    free_product_name: null,
    ...overrides,
  };
}

describe("resolveOrderReward — no reward", () => {
  it("nothing applied → kind none, 0", async () => {
    const r = await resolveOrderReward({
      supabase: fakeDb({}),
      memberId: "m1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: true, kind: "none", discountSen: 0 });
  });
});

describe("resolveOrderReward — wallet vouchers", () => {
  it("explicit walletVoucherId resolves the linked template's spec", async () => {
    const db = fakeDb({
      issued_rewards: () => walletRow(),
      voucher_templates: () => flatTemplate,
    });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      walletVoucherId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toMatchObject({ ok: true, kind: "wallet", walletVoucherId: "v1", discountSen: 500 });
  });

  it("QR-table convention: rewardId carrying a voucher id resolves as wallet too", async () => {
    const db = fakeDb({
      issued_rewards: () => walletRow(),
      voucher_templates: () => flatTemplate,
    });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      rewardId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toMatchObject({ ok: true, kind: "wallet", walletVoucherId: "v1" });
  });

  it("explicit wallet id not found → hard error", async () => {
    const db = fakeDb({ issued_rewards: () => null });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      walletVoucherId: "v-missing",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Voucher not found" });
  });

  it("someone else's voucher → 'Voucher not found' (no ownership leak)", async () => {
    const db = fakeDb({ issued_rewards: () => walletRow({ member_id: "m2" }) });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      walletVoucherId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Voucher not found" });
  });

  it("explicit + already redeemed → hard error", async () => {
    const db = fakeDb({ issued_rewards: () => walletRow({ status: "redeemed" }) });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      walletVoucherId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Voucher already used or inactive" });
  });

  it("explicit + expired → hard error", async () => {
    const db = fakeDb({ issued_rewards: () => walletRow({ expires_at: PAST }) });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      walletVoucherId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Voucher expired" });
  });

  it("rewardId hitting a redeemed voucher falls through to catalog (then misses)", async () => {
    const db = fakeDb({
      issued_rewards: () => walletRow({ status: "redeemed" }),
      voucher_templates: () => null, // catalog lookup misses too
    });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      rewardId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Reward no longer available" });
  });

  it("legacy voucher with no template link uses the inline columns", async () => {
    const db = fakeDb({
      issued_rewards: () =>
        walletRow({ voucher_template_id: null, discount_type: "flat", discount_value: 300 }),
    });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      walletVoucherId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toMatchObject({ ok: true, kind: "wallet", discountSen: 300 });
  });

  it("below the voucher's min order → friendly error", async () => {
    const db = fakeDb({
      issued_rewards: () =>
        walletRow({ voucher_template_id: null, discount_type: "flat", discount_value: 300, min_order_value: 5000 }),
    });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      walletVoucherId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Minimum order not met for voucher" });
  });

  it("discount is clamped to the order subtotal", async () => {
    const db = fakeDb({
      issued_rewards: () =>
        walletRow({ voucher_template_id: null, discount_type: "flat", discount_value: 99999 }),
    });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: "m1",
      walletVoucherId: "v1",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toMatchObject({ ok: true, discountSen: SUBTOTAL });
  });

  it("no memberId → wallet path is skipped entirely (straight to catalog)", async () => {
    const db = fakeDb({
      voucher_templates: () => ({
        id: "t9",
        is_active: true,
        valid_from: null,
        valid_until: null,
        stock: null,
        points_cost: 0,
        ...flatTemplate,
      }),
    });
    const r = await resolveOrderReward({
      supabase: db,
      memberId: null,
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toMatchObject({ ok: true, kind: "catalog", discountSen: 500 });
  });
});

describe("resolveOrderReward — catalog rewards", () => {
  function catalogTemplate(overrides: Record<string, unknown> = {}) {
    return {
      id: "t9",
      is_active: true,
      valid_from: null,
      valid_until: null,
      stock: null,
      points_cost: 100,
      ...flatTemplate,
      ...overrides,
    };
  }

  /** issued_rewards answers BOTH the wallet probe (filters.id) and the
   *  active-voucher precheck (filters.member_id) — script them apart. */
  function catalogDb(opts: {
    template: unknown;
    heldVoucher?: unknown;
    balance?: number;
  }): SupabaseClient {
    return fakeDb({
      issued_rewards: (q) => (q.filters["id"] ? null : (opts.heldVoucher ?? null)),
      voucher_templates: () => opts.template,
      member_brands: () => ({ points_balance: opts.balance ?? 0 }),
    });
  }

  it("active template with sufficient points → ok with pointsCost", async () => {
    const r = await resolveOrderReward({
      supabase: catalogDb({ template: catalogTemplate(), balance: 250 }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toMatchObject({
      ok: true,
      kind: "catalog",
      catalogRewardId: "r-flat5",
      pointsCost: 100,
      discountSen: 500,
    });
  });

  it("inactive → 'Reward is no longer active'", async () => {
    const r = await resolveOrderReward({
      supabase: catalogDb({ template: catalogTemplate({ is_active: false }) }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Reward is no longer active" });
  });

  it("validity window enforced both directions", async () => {
    const notYet = await resolveOrderReward({
      supabase: catalogDb({ template: catalogTemplate({ valid_from: FUTURE }) }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(notYet).toEqual({ ok: false, error: "Reward not yet active" });

    const lapsed = await resolveOrderReward({
      supabase: catalogDb({ template: catalogTemplate({ valid_until: PAST }) }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(lapsed).toEqual({ ok: false, error: "Reward has expired" });
  });

  it("zero stock blocks; null stock means unlimited", async () => {
    const out = await resolveOrderReward({
      supabase: catalogDb({ template: catalogTemplate({ stock: 0 }) }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(out).toEqual({ ok: false, error: "Reward is out of stock" });

    const ok = await resolveOrderReward({
      supabase: catalogDb({ template: catalogTemplate({ stock: null }), balance: 250 }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(ok).toMatchObject({ ok: true });
  });

  it("min order failure formats the RM amount for the customer", async () => {
    const r = await resolveOrderReward({
      supabase: catalogDb({ template: catalogTemplate({ min_order_value: 3000 }) }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Reward needs a minimum order of RM30.00" });
  });

  it("points shortfall is caught BEFORE payment, with both numbers", async () => {
    const r = await resolveOrderReward({
      supabase: catalogDb({ template: catalogTemplate(), balance: 50 }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toEqual({ ok: false, error: "Not enough points (need 100, have 50)" });
  });

  it("holding an active issued voucher for the reward skips the balance check", async () => {
    const r = await resolveOrderReward({
      supabase: catalogDb({
        template: catalogTemplate(),
        heldVoucher: { id: "v-held" },
        balance: 0, // would fail the balance check if it ran
      }),
      memberId: "m1",
      rewardId: "r-flat5",
      items,
      subtotalSen: SUBTOTAL,
    });
    expect(r).toMatchObject({ ok: true, kind: "catalog", pointsCost: 100 });
  });
});
