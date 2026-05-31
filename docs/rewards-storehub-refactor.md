# Rewards / Loyalty Refactor — StoreHub-style Consolidation

**Status:** Spec • **Decision date:** 2026-05-31 • **Owner:** Ammar
**Prereq context:** see [rewards-v2-setup.md](./rewards-v2-setup.md) for the existing v2 schema.

## Problem

Every reward type today expresses "what does this apply to?" differently. Free Drink uses `applicable_categories`. A specific-product reward might use `free_product_ids`. Combo rewards use `combo_product_ids`. Free-text product names live in `free_product_name`. Member-tag-gated rewards use `applicable_tags`. The same row might have several of these set with conflicting or overlapping intent.

Result: every place that *reads* a reward has to branch on which eligibility field is set, and every place that *writes* a reward picks whichever field the author happened to think of. The shared discount engine has 60+ lines of eligibility-resolution logic that lives only because no two rewards share a shape.

The Bean-Points-Shop "Free Drink doesn't deduct" bug (fixed 2026-05-31, commit `e4c0d792`) was the loudest symptom: `rewards.discount_type` was null, `mint-voucher` copied the null, `issued_rewards.discount_type` became null, the engine returned 0. But the deeper issue is that *every reward shape is bespoke*. Fix one and the next mint path regresses.

Goal: **one canonical reward shape** so that "Free Drink" and "RM5 off any coffee" and "Free 15g bag with order over RM30" all serialise to the same six columns, regardless of which event minted them.

## The canonical shape (the actual deliverable)

Every reward — points-shop catalog item, mission completion, mystery drop, birthday gift, tier upgrade, manual grant — collapses to these six fields:

| Field | Type | Meaning |
|---|---|---|
| `discount_type` | enum | `flat` / `percent` / `free_item` / `free_upgrade` / `bogo` / `combo` |
| `discount_value` | numeric | sen for `flat`, percentage 0–100 for `percent`, null for `free_*` |
| `scope` | enum | `everything` / `products` / `categories` — what the reward targets |
| `target_ids` | text[] | product IDs (scope=products) or category IDs (scope=categories); null for `everything` |
| `modifier_filter` | jsonb | optional: only matches lines whose modifiers satisfy this (e.g. `{"size":"large"}`) |
| `min_order_value` | numeric (sen) | optional cart-subtotal floor before reward fires |

That's it. Six fields define every reward. Below: every reward type expressed in this shape.

### Worked examples

```jsonc
// "Free Drink" (any drink, any modifier) — Bean Points Shop or Mission win
{ discount_type: "free_item",
  discount_value: null,
  scope: "categories",
  target_ids: ["classic","flavoured","mocha","fruit-tea","gourmet-tea",
               "artisan-choc","artisan-matcha","mocktails"],
  modifier_filter: null,
  min_order_value: null }

// "Free Almond Croissant" (specific product)
{ discount_type: "free_item",
  discount_value: null,
  scope: "products",
  target_ids: ["prod-almond-croissant"],
  modifier_filter: null,
  min_order_value: null }

// "Free Large Upgrade on any coffee" (specific modifier on a category)
{ discount_type: "free_upgrade",
  discount_value: null,
  scope: "categories",
  target_ids: ["classic","flavoured","mocha"],
  modifier_filter: { size: "large" },
  min_order_value: null }

// "RM5 off any order"
{ discount_type: "flat",
  discount_value: 500,
  scope: "everything",
  target_ids: null,
  modifier_filter: null,
  min_order_value: null }

// "RM5 off any drink order over RM15" (current mystery-bag default)
{ discount_type: "flat",
  discount_value: 500,
  scope: "categories",
  target_ids: ["classic","flavoured","mocha","fruit-tea","gourmet-tea",
               "artisan-choc","artisan-matcha","mocktails"],
  modifier_filter: null,
  min_order_value: 1500 }

// "15% off coffee, max RM10"
{ discount_type: "percent",
  discount_value: 15,
  scope: "categories",
  target_ids: ["classic","flavoured","mocha"],
  modifier_filter: null,
  min_order_value: null,
  max_discount_value: 1000 }  // existing field, kept

// "Buy 1 espresso, get 1 free"
{ discount_type: "bogo",
  scope: "products",
  target_ids: ["prod-espresso"],
  bogo_buy_qty: 1,           // existing fields, kept
  bogo_free_qty: 1,
  modifier_filter: null }
```

### What gets dropped from the schema

- `applicable_categories` → folded into `target_ids` when `scope='categories'`
- `applicable_products` → folded into `target_ids` when `scope='products'`
- `free_product_ids` → folded into `target_ids` when `scope='products'` and `discount_type='free_item'`
- `free_product_name` → **dropped entirely** (free-text name matching is fragile and was the source of POS↔Pickup drift)
- `applicable_tags` → **dropped** (only on `rewards` table, unused in code)
- `combo_product_ids` → folded into `target_ids` when `discount_type='combo'`

### What stays as-is

- `min_order_value`, `max_discount_value`, `bogo_buy_qty`, `bogo_free_qty`, `combo_price` — kept (existing semantics)
- `outlets_allowlist` (on voucher_templates) — kept (orthogonal: store-level gating, not product-level)
- `validity_days`, `stock`, `points_required`, etc. — kept (lifecycle / inventory / cost, orthogonal to eligibility)

## Why three tables become two

Once the canonical shape exists, the only structural difference between `rewards` and `voucher_templates` is that `rewards` carries a `points_required` field (Bean Points Shop cost). Adding that field to `voucher_templates` lets us drop the `rewards` table entirely.

So the table consolidation is a side effect of the shape standardisation, not the goal. The goal is: *one row shape, one read path, one write path*.

## What StoreHub does (reference architecture)

Studied via `celsiuscoffee.storehubhq.com` on 2026-05-31. StoreHub's loyalty is split cleanly into three orthogonal concerns:

| Concern | StoreHub module | What it owns |
|---|---|---|
| **Tiers + earn rules** | Membership Settings + Points Settings | Tier ladder (Member→Silver→Gold→Platinum), point thresholds, per-tier RM→pts multipliers, points expiry. |
| **Cart-side discounts** | Promotions | 6 discount types (% off, RM off, override price, bundle, BXGY, free shipping); per-channel + per-time-window + per-store rules; not tied to points. |
| **Lifecycle vouchers** | Engage automations | Welcome / Birthday / Win-Back / Tier-Upgrade / Cashback Reminder — each issues a voucher to a specific member on a specific event. |

Notably, StoreHub has **no "Points Shop" catalog**. Points exist only to drive tiers. We're keeping our Points Shop (Celsius differentiator — answered "Keep" in decision Q1) but we'll express it as templates with `points_cost`, not a separate table.

## Decisions (locked 2026-05-31)

| Q | Answer |
|---|---|
| Keep Bean Points Shop (Free Drink / RM5 / RM10)? | **Yes — keep.** Templates carry `points_cost`. |
| Keep Missions / Challenges? | **Yes — keep.** No StoreHub equivalent. Active engagement driver. |
| Keep Mystery Bag? | **Yes — keep.** No StoreHub equivalent. Brand-defining UX. |
| Migration pace | **Big-bang, 3 commits in one week.** No multi-month phased rollout. |

## Target architecture (3 concepts)

```
voucher_templates    ← SINGLE source of truth for "what a voucher does".
                       Replaces: rewards + voucher_templates + reward_kinds (theming
                       collapsed in as fields, kept as separate refs for legacy reads).

issued_rewards       ← every actually-issued voucher, keyed by template_id.
                       (existing table — change is dropping inline reward_id /
                       inline discount fields in favour of template_id FK.)

tiers                ← tier ladder + earn-rate multipliers + tier-upgrade attach.
                       (existing table — no change in this refactor.)
```

Plus event-source tables stay as-is (`mission_assignments`, `mystery_drops`,
`tier_benefit_grants`) — they orchestrate **when** to mint a template, never
duplicate template fields.

## Schema delta

### Add to `voucher_templates`

| New column | Type | Purpose |
|---|---|---|
| `scope` | text CHECK in (`everything`,`products`,`categories`) | canonical eligibility discriminator — replaces 3 legacy "applicable_*" fields |
| `target_ids` | text[] | product or category IDs that this reward targets (NULL when `scope='everything'`) |
| `modifier_filter` | jsonb | optional `{modifier_name: required_value}` map — only matches cart lines whose modifiers contain ALL of these |
| `points_cost` | integer | NULL for non-shop templates; >0 for Bean-Points-Shop items (carries `rewards.points_required`) |
| `image_url` | text | display asset (from `rewards.image_url`) |
| `stock` | integer | NULL = unlimited; ≥0 = inventory remaining (from `rewards.stock`) |
| `max_per_member` | integer | NULL = unlimited; cap per-member redemptions |
| `valid_from` | timestamptz | optional date-window lower bound |
| `valid_until` | timestamptz | optional date-window upper bound |
| `is_points_shop` | boolean GENERATED `points_cost IS NOT NULL` STORED | materialised flag for index/filter |

### Drop from `voucher_templates` (after backfill into `target_ids`)

| Dropped column | Replacement |
|---|---|
| `applicable_categories` | folded into `target_ids` when `scope='categories'` |
| `applicable_products` | folded into `target_ids` when `scope='products'` |
| `free_product_ids` | folded into `target_ids` when `scope='products'` and `discount_type IN ('free_item','free_upgrade')` |
| `free_product_name` | dropped entirely — no more free-text name matching |

### Drop from `rewards` table (after rows migrated)

Drop the whole table after migration completes. The 3 catalog rows become regular voucher_templates rows with `points_cost` populated. The `applicable_tags` column on `rewards` is dropped without replacement — unused in code.

### `issued_rewards` change

Today's `issued_rewards` rows duplicate the eligibility fields inline (`applicable_categories`, `applicable_products`, `free_product_name`, etc.). This is the drift trap — a mint path forgets a field and the voucher silently misfires.

Two moves:

1. **Add `template_id`** (currently referenced in code as if it existed but the column doesn't):
   ```sql
   ALTER TABLE issued_rewards ADD COLUMN template_id uuid REFERENCES voucher_templates(id);
   ```
   Backfill from `reward_id` (3 rows → catalog template) and from source-type-specific lookups for the other 155.

2. **Drop the inline eligibility fields** from `issued_rewards` after Commit 2 lands. Engine reads through `template_id`. The inline `discount_type` / `discount_value` columns stay (snapshot at mint time so a template edit doesn't retroactively change an issued voucher) — but `applicable_categories` / `applicable_products` / `free_product_name` / `free_product_ids` come off, replaced by `scope` + `target_ids` snapshots.

## Migration plan — 3 commits

### Commit 1: backfill + schema additions (zero behaviour change)

- `ALTER TABLE voucher_templates ADD COLUMN points_cost integer, image_url text, stock integer, max_per_member integer, valid_from timestamptz, valid_until timestamptz, applicable_tags text[], is_points_shop boolean GENERATED ALWAYS AS (points_cost IS NOT NULL) STORED;`
- `ALTER TABLE issued_rewards ADD COLUMN template_id uuid REFERENCES voucher_templates(id);`
- Insert 3 rows into `voucher_templates` mirroring `rewards` (preserve `id` as a deterministic UUID derived from the legacy text id so cross-refs survive).
- Backfill `issued_rewards.template_id` for every active row by joining against `reward_id` (catalog redemptions) and existing template-keyed source tables (mystery, mission).
- Add a UNIQUE constraint so an issued row has either `template_id` OR `reward_id` set, not both.

Acceptance: `SELECT COUNT(*) FROM issued_rewards WHERE template_id IS NULL AND status='active'` returns 0. No customer-facing changes.

### Commit 2: re-wire writers (mint paths)

Files touched:
- `apps/pos/src/app/api/loyalty/mint-voucher/route.ts` → query `voucher_templates` instead of `rewards`; insert `issued_rewards` row with `template_id` set, drop inline `discount_type`/`discount_value`/etc. fields from the insert.
- `apps/order/src/lib/loyalty/v2.ts` mission-mint path → already uses templates, audit for consistency.
- Mystery mint paths in `apps/backoffice/src/app/api/loyalty/mystery/route.ts` → audit, ensure `template_id` set.
- `packages/shared/src/loyalty/mark-voucher-used.ts` → no change.

Drop the `inferDiscount()` defensive helper added in commit `e4c0d792` — by this point, every template has explicit fields, so inference is no longer needed.

Acceptance: redeem Free Drink in native app → `issued_rewards` row has `template_id` set, `reward_id` is null, `discount_type` is null (data comes from template at read time).

### Commit 3: re-wire readers + drop `rewards` table

Files touched:
- `packages/shared/src/loyalty/active-vouchers.ts` → join `issued_rewards` → `voucher_templates` to source `discount_type` etc. instead of reading inline.
- `packages/shared/src/loyalty/affordable-catalog.ts` → query `voucher_templates WHERE is_points_shop = true AND points_cost <= member_balance` instead of `rewards`.
- `packages/shared/src/loyalty/discount-engine.ts` → no change (already takes a spec).
- `apps/order/src/app/api/orders/route.ts` (Pickup checkout) + `apps/pos/src/app/register/page.tsx` → no change (consume the helper output).
- Migration: `DROP TABLE rewards;`

Acceptance: POS modal + Pickup wallet + customer-display all render identical voucher shapes sourced from templates. No reference to the `rewards` table remains in the codebase.

## Cutover risk

| Risk | Mitigation |
|---|---|
| Customers mid-redemption when commit 2 lands | Commit 1 is purely additive; commit 2 reads `template_id` if set, falls back to `reward_id` for an N-day grace period. |
| `issued_rewards.discount_type` reads in legacy code paths | Search for direct reads of `issued_rewards.discount_type` before commit 3; route through helpers. |
| POS offline cache (SUNMI) holds old voucher shape | Cache TTL is short (60s for vouchers); no persistent client cache to invalidate. |
| RLS policies referencing `rewards` table | Audit before `DROP TABLE`. Add SELECT policy on `voucher_templates` mirroring the one on `rewards`. |

## How the discount engine simplifies

Before — `packages/shared/src/loyalty/discount-engine.ts` `isLineEligible()` today (paraphrased):

```typescript
const hasProductFilter   = !!(spec.applicable_products?.length);
const hasCategoryFilter  = !!(spec.applicable_categories?.length);
const hasFreeProductIds  = !!(spec.free_product_ids?.length);
const hasFreeProductName = !!spec.free_product_name;
if (!hasProductFilter && !hasCategoryFilter && !hasFreeProductIds && !hasFreeProductName) {
  return true;  // no filter → everything matches
}
if (hasFreeProductIds && spec.free_product_ids.includes(line.product_id))  return true;
if (hasProductFilter && spec.applicable_products.includes(line.product_id)) return true;
if (hasCategoryFilter) {
  if (line.category    && spec.applicable_categories.includes(line.category))    return true;
  if (line.category_id && spec.applicable_categories.includes(line.category_id)) return true;
}
if (hasFreeProductName && line.name.toLowerCase() === spec.free_product_name.toLowerCase()) return true;
return false;
```

5 different fields to inspect, lowercase-string matching as a fallback. Drift surface area.

After:

```typescript
function isLineEligible(line, spec) {
  // 1. Scope check
  if (spec.scope === "everything") {
    // fall through to modifier check
  } else if (spec.scope === "products") {
    if (!spec.target_ids.includes(line.product_id)) return false;
  } else if (spec.scope === "categories") {
    const matched = spec.target_ids.includes(line.category)
                 || spec.target_ids.includes(line.category_id);
    if (!matched) return false;
  }
  // 2. Optional modifier filter
  if (spec.modifier_filter) {
    for (const [k, v] of Object.entries(spec.modifier_filter)) {
      if (line.modifiers?.[k] !== v) return false;
    }
  }
  return true;
}
```

Two branches. No string-matching fallback. The shape is the contract — if any new reward type emerges, it goes through these same six fields or it's not a reward.

## What this does NOT change

- The `tiers` table and tier-upgrade voucher attach mechanic — already clean.
- The discount engine's discount-math switch (flat / percent / free_item / free_upgrade) — stays.
- The POS / Pickup discount-math consolidation (Phase 2) — stays.
- The wallet-display filter that hides `source_type='points_redemption'` rows
  (commit `222c006`) — stays. The points-shop redemption flow continues to mint
  a voucher and apply it via the existing pipeline.
- Other loyalty tables (`reward_kinds`, `mission_assignments`, `mystery_drops`,
  `tier_benefit_grants`, `reward_missions`, `mystery_pool`, `reward_configs`) —
  unchanged. They orchestrate **when** to mint a template, not what a reward
  looks like.

## Open question for after Commit 3

Should we also collapse `reward_kinds` + `mystery_pool` + `reward_missions` into
`voucher_templates`? They each define "what a voucher looks like" for a specific
issue path. Not in scope for this refactor — those tables already point at
templates, so they're orchestration not duplication. Revisit if drift emerges.
