# Rewards / Loyalty Refactor — StoreHub-style Consolidation

**Status:** Spec • **Decision date:** 2026-05-31 • **Owner:** Ammar
**Prereq context:** see [rewards-v2-setup.md](./rewards-v2-setup.md) for the existing v2 schema.

## Problem

Today's Celsius loyalty schema has ~12 tables that overlap and drift. Specifically:

- `rewards` (3 rows: Free Drink, RM5, RM10) — the Bean-Points-Shop catalog
- `voucher_templates` (14 rows) — modern reward definitions used by mystery/mission/birthday/tier paths
- `issued_rewards` (158 rows, 119 active) — instances minted into customer wallets

These three tables carry near-identical columns (`discount_type`, `discount_value`, `applicable_categories`, `applicable_products`, `free_product_name`, `min_order_value`, …). The Bean-Points-Shop "Free Drink doesn't deduct" bug (fixed 2026-05-31, commit `e4c0d792`) was a direct consequence: `rewards.discount_type` was null, `mint-voucher` copied the null, `issued_rewards.discount_type` became null, and the discount engine returned 0.

This is structural drift — every place that mints a voucher copies fields independently. Fix once, regress next month.

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

| New column | Type | Purpose | Source |
|---|---|---|---|
| `points_cost` | integer | NULL for non-shop templates; >0 for Bean-Points-Shop items | from `rewards.points_required` |
| `image_url` | text | display asset | from `rewards.image_url` |
| `stock` | integer | NULL = unlimited; ≥0 = inventory remaining | from `rewards.stock` |
| `max_per_member` | integer | NULL = unlimited; cap per-member redemptions | from `rewards.max_redemptions_per_member` |
| `valid_from` | timestamptz | NULL = no lower bound | from `rewards.valid_from` |
| `valid_until` | timestamptz | NULL = no upper bound | from `rewards.valid_until` |
| `applicable_tags` | text[] | member-tag-based eligibility | from `rewards.applicable_tags` |
| `is_points_shop` | boolean | `points_cost IS NOT NULL` materialised for index | derived |

### Deprecate in `rewards`

Drop the whole table after migration completes. The 3 rows become templates.

### `issued_rewards` change

Already has `template_id` referenced in code paths (per the `loyalty-snapshot.ts`
comment `ir-points_redemption-mpj9ivks-…`) but the column **does not exist on
the table** (confirmed by failed query: `column "template_id" does not exist`).

Add it:

```sql
ALTER TABLE issued_rewards ADD COLUMN template_id uuid REFERENCES voucher_templates(id);
```

Then backfill `template_id` for all 158 existing rows from `reward_id` (3 rows
pointing at `rewards.id`) and from existing template lookups for the other 155.

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

## What this does NOT change

- The `tiers` table and tier-upgrade voucher attach mechanic — already clean.
- The `discount-engine.ts` shared module — already correct, just gets richer input.
- The POS / Pickup discount math (Phase 2 consolidation) — stays.
- The wallet-display filter that hides `source_type='points_redemption'` rows
  (commit `222c006`) — stays. The points-shop redemption flow continues to mint
  a voucher and apply it via the existing pipeline.

## Open question for after Commit 3

Should we also collapse `reward_kinds` + `mystery_pool` + `reward_missions` into
`voucher_templates`? They each define "what a voucher looks like" for a specific
issue path. Not in scope for this refactor — those tables already point at
templates, so they're orchestration not duplication. Revisit if drift emerges.
