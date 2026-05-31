# Rewards / Loyalty Refactor — StoreHub-style Consolidation

**Status:** Commits 1–3 SHIPPED • **Decision date:** 2026-05-31 • **Owner:** Ammar
**Prereq context:** see [rewards-v2-setup.md](./rewards-v2-setup.md) for the existing v2 schema.

> ## ✅ Final shape (2026-05-31) — read this first
>
> | Phase | Status |
> |---|---|
> | **Commit 1** — canonical shape on `voucher_templates` (scope / target_ids / modifier_filter / points_cost + backfill) | **DONE** — `docs/migrations/rewards-canonical-shape-commit1.sql` |
> | **Commit 2** — every mint path writes `issued_rewards.voucher_template_id` | **DONE** — commit `eb05593d` |
> | **Commit 3** — customer catalog reads `voucher_templates`, backoffice list de-duplicated | **DONE (safe slice)** — `docs/migrations/rewards-canonical-shape-commit3.sql`. The full `DROP TABLE rewards` is **deferred** (30+ refs across 4 apps; `legacy_reward_id` bridges catalog↔redeem until then). |
> | **Commits 4 & 5** — `voucher_triggers` table + collapse channel tables | **NOT PURSUED.** See decision below. |
>
> ### Decision: channels stay separate
>
> The "Template + Trigger + Instance" collapse (introduce a single
> `voucher_triggers` table, fold Mystery Pool / Challenges / Birthday /
> Tier Upgrade / Admin Claimables into it, collapse the 5 backoffice
> pages into one form) is **explicitly NOT happening.**
>
> Instead:
> - `voucher_templates` is the **single source of truth for what a
>   reward is** (the template registry — managed on the new All Rewards
>   page).
> - Each **channel keeps its own table + its own backoffice page**
>   (`mystery_pool`, `reward_missions`, `admin_claimables`, birthday
>   config, tier-upgrade attach) and **references templates** via
>   `voucher_template_id`. They were already doing this — no migration
>   needed on the channel side.
> - The "How customers earn it" trigger checkboxes were removed from the
>   reward form (commit `da0abff9`). Wire/unwire triggers on the channel
>   pages.
>
> Rationale: the channels have genuinely different config surfaces
> (mystery weighting/drop-%, mission goals/cooldown, tier thresholds,
> admin audiences). Forcing them through one `voucher_triggers.config`
> jsonb lost the purpose-built UX without a real payoff. The drift the
> refactor targeted lived in the *reward shape*, not the *trigger
> config* — and that's fixed by Commits 1–3.
>
> Everything below the divider is the original spec, kept for history.
> Sections describing `voucher_triggers` / the 5-commit plan are
> **superseded** by the box above.

---

## Problem

Every reward type today expresses "what does this apply to?" differently. Free Drink uses `applicable_categories`. A specific-product reward might use `free_product_ids`. Combo rewards use `combo_product_ids`. Free-text product names live in `free_product_name`. Member-tag-gated rewards use `applicable_tags`. The same row might have several of these set with conflicting or overlapping intent.

Result: every place that *reads* a reward has to branch on which eligibility field is set, and every place that *writes* a reward picks whichever field the author happened to think of. The shared discount engine has 60+ lines of eligibility-resolution logic that lives only because no two rewards share a shape.

The Bean-Points-Shop "Free Drink doesn't deduct" bug (fixed 2026-05-31, commit `e4c0d792`) was the loudest symptom: `rewards.discount_type` was null, `mint-voucher` copied the null, `issued_rewards.discount_type` became null, the engine returned 0. But the deeper issue is that *every reward shape is bespoke*. Fix one and the next mint path regresses.

Goal: **one canonical reward shape** so that "Free Drink" and "RM5 off any coffee" and "Free 15g bag with order over RM30" all serialise to the same six columns, regardless of which event minted them.

## The canonical shape (the actual deliverable)

Every reward — points-shop catalog item, mission completion, mystery drop, birthday gift, tier upgrade, manual grant — collapses to these six fields:

| Field | Type | Meaning |
|---|---|---|
| `discount_type` | enum | `flat` / `percent` / `free_item` / `free_upgrade` / `bogo` / `combo` / `override_price` / `beans_multiplier` / `none` |
| `discount_value` | numeric | sen for `flat`, percentage 0–100 for `percent`, null for `free_*`, multiplier (e.g. 2.0) for `beans_multiplier` |
| `scope` | enum | `everything` / `products` / `categories` — what the reward targets |
| `target_ids` | text[] | product IDs (scope=products) or category IDs (scope=categories); null for `everything` |
| `modifier_filter` | jsonb | optional: only matches lines whose modifiers satisfy this (e.g. `{"size":"large"}`) |
| `min_order_value` | numeric (sen) | optional cart-subtotal floor before reward fires |

That's it. Six fields define every reward. Below: every reward type expressed in this shape.

The 9 `discount_type` values cover the canonical set audited against StoreHub's promotion types + Celsius's existing 14 templates. Three additional type-specific knobs live on the same row but are read only by the relevant types — they don't add columns to most rewards:

| Type-specific knob | Read by | Purpose |
|---|---|---|
| `max_discount_value_sen` | `percent` | cap on % discount (e.g., "15% off, max RM10") |
| `bogo_buy_qty` / `bogo_free_qty` | `bogo` | the X and Y in "buy X get Y free" |
| `combo_price_sen` | `combo` | the override total for the required product set |
| `override_price_sen` | `override_price` | the fixed price each eligible line is replaced with |

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

// "Free Add-on" — refund customer's selected add-on modifier on any drink.
// Celsius today has ONE modifier group called Add-ons (no size/milk
// variants), so the modifier_filter is empty and the engine works at the
// modifier-priceDelta level inside discount_type='free_upgrade'. (Engine
// semantics for free_upgrade still needs the refinement described in the
// reward audit — current behaviour is "free the whole cheapest line",
// which is too generous.)
{ discount_type: "free_upgrade",
  discount_value: null,
  scope: "everything",
  target_ids: null,
  modifier_filter: null,
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

// "Bagel + Coffee combo for RM18" (REQUIRED set, override total)
{ discount_type: "combo",
  scope: "products",
  target_ids: ["prod-bagel", "prod-coffee-black"],
  combo_price_sen: 1800,
  modifier_filter: null }

// "Happy-hour Iced Americano for RM5 (3–5pm)"
//   — single product, fixed price, no required set.
//   Time-gating is done by the auto-promotions layer; the reward
//   shape itself just says "this line is RM5".
{ discount_type: "override_price",
  scope: "products",
  target_ids: ["prod-iced-americano"],
  override_price_sen: 500,
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

## The deeper collapse — Template + Trigger + Instance (2026-05-31 decision)

> **⚠️ SUPERSEDED — NOT BUILT.** This entire section (voucher_triggers,
> the 3-table model, the unified "New Reward" form with trigger
> checkboxes, Commits 4 & 5) was retired. Channels stay separate — see
> the "Final shape" box at the top of this doc. Kept for history only.

The shape consolidation above stops the field-level drift, but the system still has *six* almost-identical "channel" tables that each carry "what's the voucher + when do we issue it":

| Channel | Template table today | State table today | What's actually different? |
|---|---|---|---|
| Points Shop | `rewards` | (none) | trigger = customer spends N beans |
| Challenges | `reward_missions` | `mission_assignments` | trigger = customer hits a progress goal |
| Mystery Pool | `mystery_pool` | `mystery_drops` | trigger = random roll on every order, weighted |
| Birthday | template ref on config | (none) | trigger = cron on member.birthday |
| Tier Upgrade | template ref on `tiers` | `tier_benefit_grants` | trigger = member crosses tier threshold |
| Admin Claimables | `admin_claimables` | per-member claim state | trigger = admin enqueues, customer claims |
| Manual Grant | template ref | (none) | trigger = admin assigns directly |

Read the "what's actually different" column. **Everything except the trigger is the same.** The voucher itself, its shape, its lifecycle, its discount math — identical. The difference is *when* and *who*.

Yet today each channel has its own template table (`rewards`, `reward_missions`, `mystery_pool`, …), its own field set, its own inline-discount drift, its own backoffice page. The fundamentals of each reward channel are NOT different — only the trigger is.

### Target model — 3 tables, one row shape for each concept

```
voucher_templates    ← "what the voucher does"
                       (the canonical shape we standardised above)

voucher_triggers     ← "when/how this template gets issued to a member"
                       (one row per channel rule, type-discriminated)

issued_rewards       ← "this template was issued to this member at this time"
                       (already exists; gains template_id + trigger_id)
```

`voucher_triggers` columns:

```
id                uuid
template_id       uuid REFERENCES voucher_templates(id)
type              text CHECK in ('points_shop','mission','mystery',
                                  'birthday','tier_upgrade','admin_push',
                                  'manual_grant')
is_active         boolean
config            jsonb   -- type-specific config:
                          --   points_shop:  { cost_beans: 300 }
                          --   mission:      { goal_type: 'spend_rm',
                          --                   goal_value: 30,
                          --                   period_days: 7 }
                          --   mystery:      { weight: 10, min_tier: 'bronze' }
                          --   birthday:     { days_before: 0 }
                          --   tier_upgrade: { tier_id: 'gold' }
                          --   admin_push:   { audience_tags: ['vip'] }
                          --   manual_grant: (no auto-issue, empty)
valid_from        timestamptz
valid_until       timestamptz
created_at        timestamptz
```

One template can have MULTIPLE triggers — "Free Drink" can be sold for 300 beans AND awarded on birthday AND given on Gold tier upgrade. Today that's three rows in three different tables; after the refactor it's one template + three trigger rows.

### Per-channel state tables stay thin

Mission progress and mystery roll history still need somewhere to live, but they become **state tables**, not template tables — they carry per-member tracking, not reward shape:

```
member_mission_state    (member_id, trigger_id, progress, started_at, completed_at)
member_mystery_history  (member_id, order_id, trigger_id, rolled_at)
member_birthday_grants  (member_id, year, trigger_id)  -- prevents double-grant
member_admin_claims     (member_id, trigger_id, claimed_at)
```

Each is ~5 columns. They're tracking, not configuration.

### What the backoffice collapses to

Today: 5 separate channel pages (Points Shop, Challenges, Mystery Pool, Birthday Treats, Admin Claimables) — each with its own form, fields, vocabulary.

After: **one "New Reward" page** modeled on StoreHub's "New Promotion":

```
┌─ Enable [toggle] ──────────────────────────────────────────┐
│                                                            │
├─ The Voucher (template) ──────────────────────────────────┤
│   Name · Description · Icon                                │
│   Discount type [free_item ▾]   Value [—]                  │
│   Scope [categories ▾]   Targets [chips: classic, mocha…]  │
│   Min order · Max discount · Modifier filter (optional)    │
│   Expiry policy                                            │
│                                                            │
├─ How customers earn it (one or more triggers) ────────────┤
│   ☑ Spend Beans          Cost: [300] beans                 │
│   ☑ Complete Challenge   Goal: [Spend RM30 in a week]      │
│   ☐ Mystery Drop         Weight: [—]   Min tier: [—]       │
│   ☑ On Birthday          Days before: [0]                  │
│   ☐ On Tier Upgrade      Tier: [—]                         │
│   ☐ Admin push           Audience: [—]                     │
│   ☐ Manual grant only    (no auto-issue)                   │
│                                                            │
├─ Limits ──────────────────────────────────────────────────┤
│   Stock · Per-member cap · Valid from/until · Stackable    │
│                                                            │
└────────────────────────────────────────────────────────────┘
                                              [Save] [Cancel]
```

Same flow every time. The "trigger" section is the *only* place where channel rules live, and they're checkboxes — not separate pages. A reward list view can filter by trigger type ("show me just the mysteries") without needing dedicated pages.

### Why this isn't just renaming

- **Reporting collapses**: `JOIN issued_rewards.trigger_id` answers "which channels drove the most redemptions?" in one query. Today this needs UNIONs across 5 tables.
- **Adding a new channel is one trigger type**: want "Refer-a-friend gives a voucher"? Add `type='referral'` to the enum + a small evaluator. No new template table, no new backoffice page, no new mint route.
- **Cross-channel rewards become trivial**: "Free Drink is sold for 300 beans AND given on birthday" is two trigger rows. Today: two duplicate template rows in two different tables that can drift.
- **Audit gets cleaner**: one place where vouchers are defined, one place where channels are configured, one place where instances live.

### Wiring existing data — nothing gets orphaned

Every existing reward-related row has a defined home in the new structure. The migration is **lossless** — no data deleted that doesn't have an explicit replacement path.

### Table-by-table migration map (counts as of 2026-05-31)

| Existing table | Rows | Lands in (new structure) | How |
|---|---:|---|---|
| `voucher_templates` | 14 | `voucher_templates` (stays) | Add `scope`/`target_ids`/`modifier_filter` columns; backfill from existing `applicable_categories` / `applicable_products` / `free_product_ids` / `free_product_name`. Drop the legacy 4 columns. |
| `rewards` | 3 | `voucher_templates` (merged in) | INSERT 3 new template rows mirroring catalog rows; carry `points_required` into `points_cost`. Preserve mapping `(rewards.id → new template uuid)` for FK resolution on issued rows. Then `DROP TABLE rewards`. |
| `issued_rewards` (active) | 119 | `issued_rewards` (stays) | Add `template_id` FK + `trigger_id` FK; backfill both from existing source-type/source-ref-id/reward-id signals. Drop legacy inline eligibility columns once readers cut over. |
| `issued_rewards` (used/expired/cancelled) | 39 | `issued_rewards` (stays, no changes needed) | Read-only historical rows. We snapshot what was issued; their `template_id` is best-effort backfill, can be null on rows that pre-date the trigger model. |
| `reward_missions` | 9 | `voucher_triggers` (type='mission') | INSERT one `voucher_triggers` row per mission with `type='mission'`, `template_id` from `reward_voucher_template_ids[0]`, `config={goal_type, goal_value, period_days, difficulty, cooldown_weeks, is_swap_eligible}`. Then `DROP TABLE reward_missions`. |
| `mission_assignments` | 107 | `member_mission_state` (renamed table) | RENAME `mission_assignments` → `member_mission_state`. Drop reward-shape columns if any leaked in. Add `trigger_id` FK pointing at the corresponding new `voucher_triggers` row. |
| `mystery_pool` | 7 | `voucher_triggers` (type='mystery') | INSERT one `voucher_triggers` row per pool entry with `type='mystery'`, `template_id` from `voucher_template_id`, `config={weight, min_tier, birthday_month_boost, outcome_type, multiplier_value, flat_beans_value}`. Then `DROP TABLE mystery_pool`. |
| `mystery_drops` | 44 | `member_mystery_history` (renamed) | RENAME `mystery_drops` → `member_mystery_history`. Add `trigger_id` FK. Existing `voucher_id` reference (links to the minted issued_reward) stays. |
| `admin_claimables` | (varies) | `voucher_triggers` (type='admin_push') + `member_admin_claims` (new state table) | INSERT one `voucher_triggers` row per claimable with `type='admin_push'`, `config={audience_tags, max_claims, starts_at, ends_at}`. Per-member claim state moves to `member_admin_claims`. Then `DROP TABLE admin_claimables`. |
| `tier_benefit_grants` | 6 | `voucher_triggers` (type='tier_upgrade') | INSERT one `voucher_triggers` row per grant rule with `type='tier_upgrade'`, `config={tier_id}`. Per-member grant state moves to `member_tier_grants` (renamed). |
| `reward_kinds` | 5 | `voucher_templates.reward_kind_id` (existing FK) | No change — already orthogonal. Stays as theming reference. |
| `reward_configs` | 4 | `reward_configs` (stays) | Holds global config (tier multipliers, daily earn cap, etc.). Not template-shaped. Untouched. |
| `tiers` | 6 | `tiers` (stays) | Tier definitions + perks. Untouched. |

**Total**: 5 tables disappear, 1 new table introduced (`voucher_triggers`), 3 tables get renamed for clarity, 0 rows lost.

### Per-commit row-accountability gates

Every commit ends with verification SQL that asserts the row count math:

**After Commit 1** (canonical shape, additive):
```sql
-- Every active template has a scope set
SELECT COUNT(*) FROM voucher_templates WHERE is_active = true AND scope IS NULL;
-- expected: 0

-- Every active points-shop catalog row has been mirrored as a template
SELECT COUNT(*) FROM rewards WHERE brand_id = 'brand-celsius' AND is_active = true;
-- expected: 3 (rows still exist, just mirrored)
SELECT COUNT(*) FROM voucher_templates WHERE points_cost IS NOT NULL AND brand_id = 'brand-celsius';
-- expected: 3 (matched mirrors)
```

**After Commit 2** (writers re-wired):
```sql
-- Every active issued row created from this point has template_id set
SELECT COUNT(*) FROM issued_rewards
  WHERE status = 'active' AND created_at > '<commit-2-deploy-ts>' AND template_id IS NULL;
-- expected: 0
```

**After Commit 3** (readers + drop `rewards`):
```sql
-- The rewards table is gone
SELECT to_regclass('rewards');
-- expected: NULL

-- No code path references it (grep guard in CI)
```

**After Commit 4** (`voucher_triggers` populated + backfilled from channels):
```sql
-- Every mystery_pool row has a corresponding voucher_triggers entry
SELECT COUNT(*) FROM mystery_pool;       -- baseline
SELECT COUNT(*) FROM voucher_triggers WHERE type = 'mystery';
-- expected: equal

-- Same for reward_missions
SELECT COUNT(*) FROM reward_missions;
SELECT COUNT(*) FROM voucher_triggers WHERE type = 'mission';
-- expected: equal

-- Every active issued_reward from a channel has a trigger_id set
SELECT COUNT(*) FROM issued_rewards
  WHERE status = 'active'
    AND source_type IN ('mystery', 'mission', 'birthday', 'manual', 'points_redemption')
    AND trigger_id IS NULL;
-- expected: 0  (orphaned legacy rows excluded — those are the 108 already expired)
```

**After Commit 5** (drop legacy tables + collapse backoffice):
```sql
-- The 4 channel tables are gone
SELECT to_regclass('mystery_pool'), to_regclass('reward_missions'),
       to_regclass('admin_claimables'), to_regclass('rewards');
-- expected: NULL, NULL, NULL, NULL

-- Renamed state tables exist
SELECT to_regclass('member_mission_state'), to_regclass('member_mystery_history'),
       to_regclass('member_admin_claims'), to_regclass('member_tier_grants');
-- expected: 4 tables present
```

### Risk: legacy issued_rewards that pre-date the trigger model

The 39 used/expired/cancelled `issued_rewards` rows from before `source_type` was added (the same legacy cohort that produced the 108 orphans we expired earlier today) won't have a clean trigger_id. Their `template_id` is best-effort — if `reward_id` resolves to a known catalog row, we wire them up; if not, `template_id` stays null and the row is treated as a historical record only (no replay, no count in active reports). This is acceptable because:
- They're terminal-state (already used/expired)
- The orphan-cleanup migration earlier today removed the 108 active ones
- New issuance from Commit 2+ always writes both FKs

## Refactor expands to 5 commits

The earlier 3-commit plan (Commits 1–3) ships the canonical shape and collapses `rewards` into `voucher_templates`. Commits 4–5 ship the trigger consolidation:

**Commit 4** — introduce `voucher_triggers` + backfill from the channel-specific tables:
- Backfill `voucher_triggers` rows from `mystery_pool` (mystery type), `reward_missions` (mission type), birthday config (birthday type), tier upgrade refs (tier_upgrade type), `admin_claimables` (admin_push type).
- Add `trigger_id` to `issued_rewards`; backfill where derivable from `source_type` + `source_ref_id`.
- Channel-specific tables stay readable in parallel — readers gradually migrate to `voucher_triggers`.

**Commit 5** — collapse the backoffice + drop legacy tables:
- New "New Reward" page (replaces 5 channel pages). Old pages stay accessible as filtered views ("just mysteries", "just missions") for the first week, then removed.
- `DROP TABLE mystery_pool, reward_missions, admin_claimables`. Per-channel state tables stay (renamed for clarity).
- Drop legacy mint paths that wrote channel-specific tables. All mints go through one `mintFromTrigger(triggerId, memberId)` helper.

Acceptance after Commit 5: 5 deletions (rewards, mystery_pool, reward_missions, admin_claimables, old mint glue), 1 addition (voucher_triggers), 5 backoffice pages → 1.

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

## Reward audit (2026-05-31) — does every existing row fit?

Walked all 14 `voucher_templates` + 3 `rewards` rows through the canonical shape.
`mystery_pool` (7 rows) and `reward_missions` (9 rows) are pure orchestration —
they reference `voucher_template_id`(s) and inherit shape automatically. No
migration touch needed on either.

**31 of 33 rows fit cleanly.** The 2 outliers are both `free_item`/`free_upgrade`
templates with no eligibility set anywhere on the row:

- **Free Pastry** (inactive) — abandoned mid-config. **Decision: delete the row
  during migration**, don't migrate. If admins want a "free pastry" reward
  later they create it fresh with proper category targeting.
- **Free Add-on** (active) — name suggests "free your selected add-on modifier"
  but no eligibility wired. Celsius's catalog has only ONE modifier group
  ("Add-ons" — no size/milk variants), so `modifier_filter` doesn't help here.
  **Decision: migrate as `scope='everything'`** (matches today's
  every-line-eligible engine fallback) and **add a follow-up ticket** to give
  `free_upgrade` distinct engine semantics — "refund the modifier upcharge on
  the cheapest line that has add-ons", not "free the whole line."

## Decisions captured 2026-05-31 (sign-off log)

- **BOGO and Combo stay as first-class `discount_type` values.** They fit the
  canonical shape with type-specific semantics on the SAME six fields:
  - **`bogo`** — `target_ids` is the *eligible set*. Customer must have at least
    `bogo_buy_qty` lines from that set; the cheapest `bogo_free_qty` of those
    become free.  Works with `scope='products'` (specific SKU BOGO) or
    `scope='categories'` (any-from-category BOGO).
  - **`combo`** — `target_ids` is the *required set*. ALL listed items must be
    in cart; the engine overrides their combined price to `combo_price`.  Only
    sensible with `scope='products'`.

  No new fields beyond the existing `bogo_buy_qty` / `bogo_free_qty` /
  `combo_price` (kept) and `target_ids` (the canonical eligibility column).

- **`modifier_filter` as jsonb** — accepted. Cardinality is low (max ~3 modifier
  groups per drink today), un-indexed is fine. If query patterns demand it
  later we add a GIN index.

- **`target_ids` as a single text[] column** discriminated by `scope` — same
  type-discipline as `modifier_filter`. The trade-off is no array-FK, but
  PostgreSQL doesn't natively support array FKs anyway and adding two columns
  (`target_product_ids` + `target_category_ids`) doubles the read-path
  branching without buying integrity. The discount engine validates membership
  at use-time against the live products/categories tables, which is the
  real correctness guard.
