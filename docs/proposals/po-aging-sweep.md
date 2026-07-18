# Proposal: zombie-PO sweep + aging policy

**Status:** PROPOSED (awaiting owner) · finance-warehouse custodian, 2026-07-18
**Scope:** 50 `AWAITING_DELIVERY` purchase orders older than 14 days, RM35,598 of
phantom committed spend. Cancelling POs changes procurement state, so this is
propose-only (autonomy ladder rung 3).

## What the data says

Every stale PO fits the same pattern — these are **zombies, not late deliveries**:

- **0 of 50** have any `Receiving` row (nothing was ever booked against them).
- **44 of 50** have *newer COMPLETED POs from the same supplier* — the ordering
  cycle moved on. The goods either arrived and were received against a later
  PO, or the order was superseded/re-placed.
- The remaining 6 (Jiju Cakes ×3, NYC Treats ×2, ERUL ×1; all ≤ RM894) are
  recent enough (15–31d) that they may still be genuinely pending — worth one
  manager check before cancelling.
- Concentration: Yow Seng (7, RM4.4k), Collective Project (5, RM12.2k — five
  RM2,350–2,815 standing orders), The Milk Ministry (5), NYC Treats (6),
  JS Breadserie (8). These look like weekly standing orders where receiving
  happens against whichever PO is handy and the rest rot.

Why it matters: open-PO value feeds committed-spend, supplier-aging views and
the reorder engine's picture of "already on the way" — RM35.6k of phantom
inbound suppresses real reorders and inflates commitments.

## Proposed policy (two parts)

1. **One-time sweep (owner approves list):** cancel the 44 superseded POs
   (stale + no receiving + newer completed PO from same supplier), stamping
   `notes` with `auto-expired: superseded, see po-aging-sweep proposal`.
   The 6 without a newer completed PO go to the outlet managers as a
   check-then-cancel list.
2. **Ongoing guard (ships as code once approved):** weekly cron marks
   `AWAITING_DELIVERY` POs as CANCELLED when they are (a) >21 days old,
   (b) have no receiving, and (c) the supplier has ≥2 newer completed POs —
   with a WhatsApp digest line to the ordering manager so a genuinely
   still-pending order can be re-opened. Nothing auto-cancels without all
   three conditions.

The custodian tracks the number as **check 29** (aging ratchet): open
`AWAITING_DELIVERY` >14d should trend to ~0 after the sweep; a rebound means
the receiving flow is skipping PO linkage again.

## The exact one-time cancel list (44)

Criteria: `AWAITING_DELIVERY`, age >14d, no `Receiving`, ≥1 newer COMPLETED PO
from the same supplier. Top by value (full list reproducible with the query
below): CC-CC001-0174 Collective RM2,815 · CC-CC002-0165 Collective RM2,350 ·
CC-CC002-0203 Collective RM2,350 · CC-CC002-0221 Collective RM2,350 ·
CC-CC002-0231 Collective RM2,350 · CC-CC001-0228 Yow Seng RM1,464 ·
CC-CC001-0203 Global Coffee RM1,138 · CC-CC001-0078 JG Pacific RM1,018 ·
CC-CC002-0233 BGS RM995 · CC-CC002-0217 Yow Seng RM932 … (oldest is
CC-CC001-0071, 2026-05-05, 73 days).

```sql
SELECT o."orderNumber", s.name, o."totalAmount",
       (o."createdAt" AT TIME ZONE 'Asia/Kuala_Lumpur')::date
FROM "Order" o JOIN "Supplier" s ON s.id = o."supplierId"
WHERE o."orderType"='PURCHASE_ORDER' AND o.status='AWAITING_DELIVERY'
  AND now() - o."createdAt" > interval '14 days'
  AND NOT EXISTS (SELECT 1 FROM "Receiving" r WHERE r."orderId" = o.id)
  AND EXISTS (SELECT 1 FROM "Order" o2 WHERE o2."supplierId" = o."supplierId"
    AND o2."orderType"='PURCHASE_ORDER' AND o2.status='COMPLETED'
    AND o2."createdAt" > o."createdAt")
ORDER BY o."createdAt";
```

## Root cause to fix separately

Receivings are being created without (or against the wrong) `orderId` for
standing-order suppliers — the same family of problem as the 71%-null
`productPackageId` fixed on 2026-07-18. Once the sweep lands, watch whether
new POs from the top-5 suppliers above complete normally; if not, the staff
receiving flow needs a "which open PO is this?" picker keyed by supplier.
