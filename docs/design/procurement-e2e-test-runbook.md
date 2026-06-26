# Procurement loop — end-to-end live test runbook

_How to exercise the full procurement loop on the deployed app: inventory-driven
PO → AI supplier-chat agent (change orders) → POP auto-send. Last updated 2026-06-26._

This is a **live** test — it needs the deployed BackOffice, a phone for the test
supplier's WhatsApp number, and the feature flags below. There is no local
simulator; the agent and POP send talk to the real WhatsApp Cloud API.

## What is and isn't automated (set expectations)

- **PO origination** — `ai-decisions` reorder logic recommends the PO; a human
  clicks **Create PO**. (Below-par stock → draft PO.)
- **AI agent** — inbound supplier WhatsApp → `handleSupplierMessage`: auto-edits
  the PO for clear OOS / qty / delivery-date, captures invoices (vision-extracted),
  and escalates substitutions / payment / MOQ / ambiguity.
- **POP auto-send** — recording a payment that marks the invoice `PAID` fires
  `proof_of_payment` to the supplier.
- **NOT wired:** automated PO-send to the supplier over WhatsApp (the
  `purchase_order` / `po_approval` button flow was designed but never shipped).
  The PO is created in BackOffice; sending the order block to the supplier is still
  manual. The agent only needs an **open PO to exist** for the supplier.

## 0. Prerequisites

Env (on the deployed app):
- `PROCUREMENT_AGENT_ENABLED=true`
- `PROCUREMENT_AGENT_ALLOWLIST=<last 8 digits of the test supplier's WhatsApp number>`
- `PROCUREMENT_WHATSAPP_ENABLED=true`
- `ANTHROPIC_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_APP_SECRET` (⚠️ without the app secret, inbound is signature-rejected
  and the agent never runs), `WHATSAPP_VERIFY_TOKEN`.

Meta templates approved:
- `proof_of_payment` — with a **Document** header (the receipt PDF).

Data:
- **Test supplier**: status `ACTIVE`, `phone` = the WhatsApp number you'll message
  *from*, allowlisted as above.
- The webhook subscribed in Meta so inbound hits `/api/whatsapp/webhook`.

## 1. Make the reorder engine recommend a PO

For the **test outlet + test product**, create the below-par condition:

1. **Supplier price** — Procurement → Suppliers → test supplier → add the product
   with `price`, package, `moq`. Make it the cheapest (or only) source.
2. **Par level** — Procurement → Par Levels → set `reorderPoint`, `parLevel`
   (> reorderPoint), `avgDailyUsage`.
3. **Stock ≤ reorderPoint** — record a Wastage adjustment on that product/outlet
   until on-hand ≤ reorderPoint (or pick a product already below par).

The engine needs: `stock + on-order ≤ reorderPoint`, a par level, a cheapest
supplier, and **no other outlet with surplus** (else it suggests a transfer), and
**no existing open PO** for that product+outlet (else on-order netting suppresses
it — which is itself worth testing, see §5).

### Optional seed SQL (STAGING DB ONLY)

Replace the names; run against a **staging** database, never production. Cleanup
at the bottom. Uses base-unit StockBalance (null package) — keep a single balance
row per product+outlet so the reorder map is unambiguous.

```sql
-- IDs by name (adjust to your data)
WITH s AS (SELECT id FROM "Supplier" WHERE name = 'TEST SUPPLIER' LIMIT 1),
     p AS (SELECT id, "baseUom" FROM "Product" WHERE name = 'TEST PRODUCT' LIMIT 1),
     o AS (SELECT id FROM "Outlet" WHERE name = 'TEST OUTLET' LIMIT 1),
     pk AS (SELECT id FROM "ProductPackage" WHERE "productId" = (SELECT id FROM p) ORDER BY "isDefault" DESC LIMIT 1)
-- 1) supplier price
INSERT INTO "SupplierProduct" (id, "supplierId", "productId", "productPackageId", price, moq, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), s.id, p.id, pk.id, 50.00, 1, true, now(), now() FROM s, p, pk
ON CONFLICT ("supplierId", "productId", "productPackageId")
DO UPDATE SET price = EXCLUDED.price, "isActive" = true, "updatedAt" = now();

-- 2) par level (reorderPoint 20, parLevel 100)
WITH p AS (SELECT id FROM "Product" WHERE name = 'TEST PRODUCT' LIMIT 1),
     o AS (SELECT id FROM "Outlet" WHERE name = 'TEST OUTLET' LIMIT 1)
INSERT INTO "ParLevel" (id, "productId", "outletId", "parLevel", "reorderPoint", "avgDailyUsage")
SELECT gen_random_uuid(), p.id, o.id, 100, 20, 5 FROM p, o
ON CONFLICT ("productId", "outletId")
DO UPDATE SET "parLevel" = 100, "reorderPoint" = 20, "avgDailyUsage" = 5;

-- 3) stock below reorder (10 ≤ 20). Single base-unit row.
WITH p AS (SELECT id FROM "Product" WHERE name = 'TEST PRODUCT' LIMIT 1),
     o AS (SELECT id FROM "Outlet" WHERE name = 'TEST OUTLET' LIMIT 1)
DELETE FROM "StockBalance" sb USING p, o
WHERE sb."productId" = p.id AND sb."outletId" = o.id;
WITH p AS (SELECT id FROM "Product" WHERE name = 'TEST PRODUCT' LIMIT 1),
     o AS (SELECT id FROM "Outlet" WHERE name = 'TEST OUTLET' LIMIT 1)
INSERT INTO "StockBalance" (id, "outletId", "productId", "productPackageId", quantity, "lastUpdated")
SELECT gen_random_uuid(), o.id, p.id, NULL, 10, now() FROM p, o;

-- CLEANUP (after the test)
-- DELETE FROM "ParLevel" WHERE "productId" = (SELECT id FROM "Product" WHERE name='TEST PRODUCT')
--   AND "outletId" = (SELECT id FROM "Outlet" WHERE name='TEST OUTLET');
-- (leave SupplierProduct / StockBalance or reset as needed)
```

## 2. Generate + create the PO

Procurement → **AI Decisions**. Expect a recommended **purchase order** for the
test supplier. Sanity-check the decision data shipped in #532:
- **On Order** column = `—` (nothing inbound yet).
- **↑/↓ %** next to unit price only if you changed the price recently (price history).
- An amber **below-MOQ** warning + top-up shortfall if the order total < trip MOQ.

Click **Create PO** → DRAFT `Order` for the test supplier. (Agent treats DRAFT as
open; move to SENT to read as transmitted.)

## 3. AI-agent test matrix

From the test supplier's WhatsApp, send each, one at a time. After each, check
(a) the **reply**, (b) **Procurement → Supplier Chats** thread, (c) the **PO**.

| Send | Expect | Verify |
| --- | --- | --- |
| `caramel syrup takde` | **remove_item** — drops Caramel, warm Malay confirm | line gone, total recomputed |
| `beans boleh bagi 3 ctn je` | **reduce_qty** → Beans = 3 | qty=3, total updated |
| `hantar Rabu ya` | **delivery_date** → next Wed | PO deliveryDate set |
| *(photo/PDF of an invoice)* | **capture_invoice** — DRAFT invoice, amount/number/date **extracted** from the doc | Invoices shows DRAFT + "verify"; Reconciliation = UNVERIFIED |
| `Matcha OOS, boleh replace Yamama, same quality` | **ESCALATE** — holding reply, **no change** | "Agent suggests — your call" card; PO untouched |
| `below MOQ RM300, can add something?` | **ESCALATE** | no change; needs-attention |
| `is this PoP for inv -0142 or -0143?` | **ESCALATE** (payment/recon) | no change |
| `ada barang takde` (doesn't say which) | **ASK to clarify**, no change | reply asks which item |

**Act accordingly:** for each escalation, use the Supplier Chats composer (human
takeover) to reply and edit the PO yourself.

Agent log line to look for: `[supplier-agent] supplier=… po=… intent=… conf=… action=… escalate=…`.

## 4. POP upload + auto-send

1. Attach the supplier invoice to the PO (or use the captured DRAFT); set the real
   **amount**.
2. Record payment and **upload the POP receipt** so it's the **last** entry in the
   invoice's photos (must be a direct public file URL — not a redirect).
3. Mark the invoice **PAID**.

Expect: `proof_of_payment` auto-sends to the supplier (receipt document + invoice
no / amount / ref); `popSentAt` stamped; "POP sent" pill appears; reconciliation
stops flagging it. Best-effort — a WhatsApp failure won't fail the payment write,
but check the log: `[invoices/[id]] POP auto-sent …` or `… POP not sent reason=…`.

## 5. Bonus checks (the #532 decision data)

- **On-order netting:** with the PO from §2 in `SENT`/`APPROVED`, re-run AI
  Decisions — the same product should **no longer** be recommended (inbound stock
  covers it), and if it is, the On-Order column shows the inbound qty.
- **Price trend:** change the supplier's price (Suppliers → edit), re-run AI
  Decisions — the line shows ↑/↓ % and a `PriceHistory` row exists.
- **Reconciliation ledger:** Procurement → Reconciliation — the captured-but-
  unverified invoice appears as an exception; a billed-over-PO invoice shows the
  "Over PO" exception.

## Known gaps (out of scope for this test)

- Automated PO-send + `po_approval` buttons — not wired.
- Stock accuracy is shadow-only (consumption engine off); reorder still runs off
  receipts − wastage/transfers, not sales. Going live needs unit normalisation +
  a recipe import (see `procurement-qa-2026-06-26.md`).
