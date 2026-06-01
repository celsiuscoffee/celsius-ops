-- Per-product "Show on" — which selling channels a product appears on.
--
-- `visible_channels` is an allow-list over the canonical channel vocabulary
-- (pos | pickup | grab | foodpanda | dinein — same set as @celsius/shared
-- ModifierChannel + the per-channel price columns). Semantics mirror the
-- modifier channels exactly:
--   - empty `{}`  → visible EVERYWHERE (the default; every existing product
--                   is unaffected, so this is fully backward-compatible)
--   - non-empty   → visible ONLY on the listed channels
--
-- Each app's menu loader filters to its own channel (register → 'pos',
-- pickup → 'pickup', Grab → 'grab'). To hide a product everywhere, use the
-- global products.is_available flag instead — that's a different concept
-- (discontinued) from per-channel placement.
--
-- Applied to the live DB (kqdcdhpnyuwrxqhbuyfl) on 2026-06-02; recorded here
-- for repo reproducibility.
alter table products
  add column if not exists visible_channels text[] not null default '{}';
