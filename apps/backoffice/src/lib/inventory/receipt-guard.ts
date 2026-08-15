import { NextResponse } from "next/server";
import { resolveReceiptPackages, type ResolvedReceiptPackage } from "@celsius/db";
import { prisma } from "@/lib/prisma";

/**
 * Load the package catalogue for a set of received lines and resolve each one.
 *
 * Wraps the pure resolver in `@celsius/db` with the two queries it needs, so
 * every route that books stock enforces the same rule with three lines of code
 * instead of copying the fetch. Returns a ready-to-send 400 when any line is
 * ambiguous — see `receipt-package.ts` for why refusing beats guessing.
 */
export async function guardReceiptPackages(
  items: Array<{ productId: string; productPackageId?: string | null }>,
  opts: { poPackageByProduct?: Map<string, string | null> } = {},
): Promise<{ ok: true; resolved: ResolvedReceiptPackage[] } | { ok: false; response: NextResponse }> {
  const lines = items.map((i) => ({
    productId: i.productId,
    productPackageId: i.productPackageId ?? null,
  }));
  const productIds = [...new Set(lines.map((l) => l.productId))];

  const [packages, products] = await Promise.all([
    prisma.productPackage.findMany({
      where: { productId: { in: productIds } },
      select: { id: true, productId: true, packageLabel: true, conversionFactor: true },
    }),
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
  ]);

  const result = resolveReceiptPackages(lines, {
    packages: packages.map((p) => ({ ...p, conversionFactor: Number(p.conversionFactor) })),
    poPackageByProduct: opts.poPackageByProduct,
    productNames: new Map(products.map((p) => [p.id, p.name])),
  });

  if (!result.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Choose a package for every item before receiving.",
          details: result.errors.map((e) => e.message),
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, resolved: result.resolved };
}
