import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PO line price↔package guard.
 *
 * The Aug 2026 catalog sweep found ~80 PO lines where a big-pack package was
 * selected with a small-pack price attached (or vice versa): 67 milk lines
 * booked "12×2L carton" at the 12×1L price doubled every litre figure for four
 * months; Monin cartons at bottle money, butter cartons at piece money, brioche
 * loaves at box money, etc. Every one of those lines was catchable at entry
 * time: the typed price matched a SIBLING package's going rate far better than
 * the selected one's.
 *
 * The guard compares each line's unitPrice against a reference price for the
 * selected package — the active supplier catalog price when one exists, else
 * the median of the last 12 months of PO lines for that package — and:
 *
 *   - REFUSES (400 PRICE_PACKAGE_MISMATCH) when the price is far outside the
 *     selected package's band [0.55×, 1.8×] AND fits a sibling package of the
 *     same product; the response names the suggested package. This is the
 *     exact defect class above — better to block than to corrupt months of
 *     stock and spend figures.
 *   - Passes with a WARNING (never blocks) when the price is out of band but
 *     no sibling fits — genuine price changes must not stall procurement.
 *   - Passes silently when there is no reference at all (new product/package).
 *
 * `override: true` (body flag overridePriceGuard from the create form) demotes
 * refusals to warnings for the rare legitimate collision.
 */

const LOW = 0.55;
const HIGH = 1.8;

export interface PoLineInput {
  productId: string;
  productPackageId?: string | null;
  unitPrice: number;
}

interface RefPrice {
  packageId: string | null;
  label: string;
  refPrice: number;
  source: "catalog" | "history";
}

interface Mismatch {
  productId: string;
  productName: string;
  selectedPackage: string;
  unitPrice: number;
  expectedAround: number;
  suggestedPackage: string;
  suggestedRef: number;
}

export type PoPriceGuardResult =
  | { ok: true; warnings: string[] }
  | { ok: false; response: NextResponse };

const fits = (price: number, ref: number) =>
  price >= ref * LOW && price <= ref * HIGH;

export async function guardOrderLinePrices(
  items: PoLineInput[],
  opts?: { override?: boolean },
): Promise<PoPriceGuardResult> {
  const productIds = [
    ...new Set(items.filter((i) => i?.productId && i.unitPrice > 0).map((i) => i.productId)),
  ];
  if (productIds.length === 0) return { ok: true, warnings: [] };

  // Reference prices per (product, package): active supplier catalog first,
  // then 12-month median of PO lines (>= 3 lines so one bad entry can't set
  // the reference). packageId null = loose base-unit lines.
  const refs = await prisma.$queryRaw<
    Array<{ product_id: string; package_id: string | null; label: string; ref_price: number; source: string }>
  >`
    WITH catalog AS (
      SELECT sp."productId" AS product_id,
             sp."productPackageId" AS package_id,
             MIN(sp.price)::float AS ref_price
      FROM "SupplierProduct" sp
      WHERE sp."isActive" AND sp.price > 0 AND sp."productId" = ANY(${productIds})
      GROUP BY 1, 2
    ),
    history AS (
      SELECT oi."productId" AS product_id,
             oi."productPackageId" AS package_id,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY oi."unitPrice")::float AS ref_price,
             COUNT(*) AS n
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE oi."productId" = ANY(${productIds})
        AND oi."unitPrice" > 0
        AND o.status <> 'CANCELLED'
        AND o."createdAt" >= now() - interval '12 months'
      GROUP BY 1, 2
      HAVING COUNT(*) >= 3
    ),
    merged AS (
      SELECT product_id, package_id, ref_price, 'catalog' AS source FROM catalog
      UNION ALL
      SELECT h.product_id, h.package_id, h.ref_price, 'history'
      FROM history h
      WHERE NOT EXISTS (
        SELECT 1 FROM catalog c
        WHERE c.product_id = h.product_id
          AND c.package_id IS NOT DISTINCT FROM h.package_id
      )
    )
    SELECT m.product_id, m.package_id,
           COALESCE(pp."packageLabel", pp."packageName", 'loose base unit') AS label,
           m.ref_price, m.source
    FROM merged m
    LEFT JOIN "ProductPackage" pp ON pp.id = m.package_id`;

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(products.map((p) => [p.id, p.name]));

  const refsByProduct = new Map<string, RefPrice[]>();
  for (const r of refs) {
    const arr = refsByProduct.get(r.product_id) ?? [];
    arr.push({
      packageId: r.package_id,
      label: r.label,
      refPrice: Number(r.ref_price),
      source: r.source as RefPrice["source"],
    });
    refsByProduct.set(r.product_id, arr);
  }

  const warnings: string[] = [];
  const mismatches: Mismatch[] = [];

  for (const line of items) {
    if (!line?.productId || !(line.unitPrice > 0)) continue;
    const productRefs = refsByProduct.get(line.productId);
    if (!productRefs || productRefs.length === 0) continue; // new product — nothing to judge against

    const selectedId = line.productPackageId ?? null;
    const selected = productRefs.find((r) => r.packageId === selectedId);
    const productName = nameOf.get(line.productId) ?? line.productId;

    if (selected && fits(line.unitPrice, selected.refPrice)) continue;

    // Out of band (or no reference for the chosen package): does the price
    // fit a sibling package instead? Prefer the closest-fitting sibling.
    const sibling = productRefs
      .filter((r) => r.packageId !== selectedId && fits(line.unitPrice, r.refPrice))
      .sort(
        (a, b) =>
          Math.abs(Math.log(line.unitPrice / a.refPrice)) -
          Math.abs(Math.log(line.unitPrice / b.refPrice)),
      )[0];

    if (sibling) {
      mismatches.push({
        productId: line.productId,
        productName,
        selectedPackage: selected?.label ?? "the selected package",
        unitPrice: line.unitPrice,
        expectedAround: selected ? Math.round(selected.refPrice * 100) / 100 : 0,
        suggestedPackage: sibling.label,
        suggestedRef: Math.round(sibling.refPrice * 100) / 100,
      });
    } else if (selected) {
      warnings.push(
        `${productName}: RM ${line.unitPrice} is outside the usual range for ${selected.label} (~RM ${
          Math.round(selected.refPrice * 100) / 100
        }). Double-check the price or pack.`,
      );
    }
  }

  if (mismatches.length > 0 && !opts?.override) {
    const first = mismatches[0];
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            `${first.productName}: RM ${first.unitPrice} matches ${first.suggestedPackage} ` +
            `(~RM ${first.suggestedRef}), not ${first.selectedPackage}` +
            (first.expectedAround ? ` (~RM ${first.expectedAround})` : "") +
            `. Pick the pack that matches the price` +
            (mismatches.length > 1 ? `, and check ${mismatches.length - 1} more line(s)` : "") +
            `.`,
          code: "PRICE_PACKAGE_MISMATCH",
          mismatches,
          warnings,
        },
        { status: 400 },
      ),
    };
  }

  // Overridden mismatches surface as warnings so the response still records them.
  for (const m of mismatches) {
    warnings.push(
      `${m.productName}: RM ${m.unitPrice} on ${m.selectedPackage} matches ${m.suggestedPackage} (~RM ${m.suggestedRef}) — saved anyway (override).`,
    );
  }

  return { ok: true, warnings };
}
