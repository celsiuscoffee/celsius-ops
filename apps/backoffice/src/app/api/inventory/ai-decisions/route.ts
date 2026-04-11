import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─── GET /api/inventory/ai-decisions ────────────────────────────────────
// Returns executable decisions: draft POs to create, transfers to make,
// wastage alerts. No AI model call — pure data-driven logic.

export async function GET(request: NextRequest) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const outletId = searchParams.get("outletId") || null;

    const now = new Date();
    const mytNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const d30 = new Date(mytNow);
    d30.setDate(d30.getDate() - 29);

    const outletWhere = outletId ? { id: outletId, status: "ACTIVE" as const } : { status: "ACTIVE" as const };

    // ─── Parallel data fetches ──────────────────────────────────────
    const [outlets, stockBalances, parLevels, supplierProducts, products, existingDraftOrders, wastage30] = await Promise.all([
      prisma.outlet.findMany({
        where: outletWhere,
        select: { id: true, name: true, code: true },
      }),
      prisma.stockBalance.findMany({
        where: outletId ? { outletId } : {},
        select: { productId: true, outletId: true, quantity: true },
      }),
      prisma.parLevel.findMany({
        where: outletId ? { outletId } : {},
        select: {
          productId: true,
          outletId: true,
          parLevel: true,
          reorderPoint: true,
          maxLevel: true,
          avgDailyUsage: true,
        },
      }),
      prisma.supplierProduct.findMany({
        where: { isActive: true },
        select: {
          supplierId: true,
          productId: true,
          productPackageId: true,
          price: true,
          moq: true,
          supplier: { select: { id: true, name: true, leadTimeDays: true } },
          productPackage: { select: { id: true, conversionFactor: true, packageName: true, packageLabel: true } },
        },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true, sku: true, baseUom: true, shelfLifeDays: true, itemType: true },
      }),
      // Existing DRAFT orders to avoid duplicates
      prisma.order.findMany({
        where: { status: "DRAFT", orderType: "PURCHASE_ORDER" },
        select: {
          outletId: true,
          supplierId: true,
          items: { select: { productId: true } },
        },
      }),
      // Wastage last 30 days
      prisma.stockAdjustment.findMany({
        where: {
          createdAt: { gte: new Date(d30.toISOString().split("T")[0] + "T00:00:00+08:00") },
          adjustmentType: { in: ["WASTAGE", "BREAKAGE", "EXPIRED", "SPILLAGE"] },
          ...(outletId ? { outletId } : {}),
        },
        select: { productId: true, outletId: true, adjustmentType: true, quantity: true, costAmount: true },
      }),
    ]);

    const productMap = new Map(products.map((p) => [p.id, p]));
    const outletMap = new Map(outlets.map((o) => [o.id, o]));
    const parMap = new Map(parLevels.map((p) => [`${p.productId}_${p.outletId}`, p]));
    const stockMap = new Map(stockBalances.map((s) => [`${s.productId}_${s.outletId}`, Number(s.quantity)]));

    // Build set of products already in DRAFT orders per outlet to avoid duplicates
    const draftProductSet = new Set<string>();
    for (const draftOrder of existingDraftOrders) {
      for (const item of draftOrder.items) {
        draftProductSet.add(`${item.productId}_${draftOrder.outletId}`);
      }
    }

    // ─── 1. REORDER DECISIONS — Generate PO line items ──────────────

    // For each product at each outlet, check if below reorder point
    // First check if another outlet has surplus → suggest transfer instead of PO
    // Group by outlet+supplier → becomes a draft PO

    // Build cheapest supplier map: productId → { supplierId, price, packageId, packageName, unitCost }
    type SupplierOption = {
      supplierId: string;
      supplierName: string;
      price: number;
      productPackageId: string | null;
      packageName: string | null;
      conversionFactor: number;
      unitCost: number; // cost per base unit
      moq: number;
      leadTimeDays: number;
    };

    const supplierOptionsMap: Record<string, SupplierOption[]> = {};
    for (const sp of supplierProducts) {
      const conv = sp.productPackage ? Number(sp.productPackage.conversionFactor) : 1;
      const unitCost = Number(sp.price) / conv;
      if (!supplierOptionsMap[sp.productId]) supplierOptionsMap[sp.productId] = [];
      supplierOptionsMap[sp.productId].push({
        supplierId: sp.supplier.id,
        supplierName: sp.supplier.name,
        price: Number(sp.price),
        productPackageId: sp.productPackage?.id || null,
        packageName: sp.productPackage?.packageLabel || sp.productPackage?.packageName || null,
        conversionFactor: conv,
        unitCost,
        moq: Number(sp.moq) || 0,
        leadTimeDays: sp.supplier.leadTimeDays || 0,
      });
    }

    // Pick cheapest supplier for each product
    const cheapestSupplier: Record<string, SupplierOption> = {};
    for (const [pid, options] of Object.entries(supplierOptionsMap)) {
      options.sort((a, b) => a.unitCost - b.unitCost);
      cheapestSupplier[pid] = options[0];
    }

    // Build reorder items
    type ReorderItem = {
      productId: string;
      productName: string;
      sku: string;
      baseUom: string;
      currentQty: number;
      parLevel: number;
      reorderPoint: number;
      avgDailyUsage: number;
      orderQty: number; // in package units
      unitPrice: number; // per package
      totalPrice: number;
      productPackageId: string | null;
      packageName: string | null;
      daysUntilStockout: number;
    };

    // ── Pre-compute surplus stock at each outlet per product ──
    // (stock above par level = available for transfer to deficit outlets)
    // Track how much surplus has been "claimed" by transfer suggestions
    const surplusClaimed: Record<string, number> = {}; // key: productId_outletId → qty already allocated

    // Transfer recommendations generated from PO analysis (surplus at other outlets)
    type TransferFromPOItem = {
      productId: string; productName: string;
      fromQty: number; toQty: number; transferQty: number; toParLevel: number;
    };
    type TransferFromPO = {
      type: "transfer";
      fromOutletId: string; fromOutletName: string;
      toOutletId: string; toOutletName: string;
      items: TransferFromPOItem[];
      reason: string;
    };
    const transferFromPO: TransferFromPO[] = [];

    // Group: outletId → supplierId → ReorderItem[]
    const reorderGroups: Record<string, Record<string, ReorderItem[]>> = {};
    let totalReorderValue = 0;

    for (const outlet of outlets) {
      for (const product of products) {
        const key = `${product.id}_${outlet.id}`;
        const par = parMap.get(key);
        if (!par) continue; // no par level = skip

        const currentQty = stockMap.get(key) ?? 0;
        const reorderPoint = Number(par.reorderPoint);
        const parLevel = Number(par.parLevel);
        const avgDaily = Number(par.avgDailyUsage);

        // Only reorder if at or below reorder point
        if (currentQty > reorderPoint) continue;

        // Skip if already in a DRAFT order
        if (draftProductSet.has(key)) continue;

        // ── Check if other outlets have surplus we can transfer ──
        let baseUnitsNeeded = Math.max(parLevel - currentQty, 0);
        if (baseUnitsNeeded <= 0) continue;

        // Look for surplus at other outlets (stock above par level)
        if (outlets.length > 1) {
          for (const otherOutlet of outlets) {
            if (otherOutlet.id === outlet.id) continue;
            const otherKey = `${product.id}_${otherOutlet.id}`;
            const otherPar = parMap.get(otherKey);
            if (!otherPar) continue;
            const otherQty = stockMap.get(otherKey) ?? 0;
            const otherParLevel = Number(otherPar.parLevel);
            const claimed = surplusClaimed[otherKey] || 0;
            const surplus = otherQty - otherParLevel - claimed;
            if (surplus <= 0) continue;

            // Transfer what we can from this outlet
            const transferQty = Math.min(surplus, baseUnitsNeeded);
            if (transferQty <= 0) continue;

            // Track the claim so we don't double-allocate
            surplusClaimed[otherKey] = claimed + transferQty;

            // Create or append to transfer recommendation
            const fromOutlet = outletMap.get(otherOutlet.id);
            const toOutlet = outletMap.get(outlet.id);
            if (fromOutlet && toOutlet) {
              let existing = transferFromPO.find(
                (t) => t.fromOutletId === otherOutlet.id && t.toOutletId === outlet.id
              );
              if (!existing) {
                existing = {
                  type: "transfer",
                  fromOutletId: otherOutlet.id,
                  fromOutletName: fromOutlet.name,
                  toOutletId: outlet.id,
                  toOutletName: toOutlet.name,
                  items: [],
                  reason: `Transfer surplus from ${fromOutlet.name} instead of new PO`,
                };
                transferFromPO.push(existing);
              }
              existing.items.push({
                productId: product.id,
                productName: product.name,
                fromQty: otherQty,
                toQty: currentQty,
                transferQty: Math.round(transferQty),
                toParLevel: parLevel,
              });
            }

            baseUnitsNeeded -= transferQty;
            if (baseUnitsNeeded <= 0) break;
          }
        }

        // If transfer covered all the deficit, skip the PO
        if (baseUnitsNeeded <= 0) continue;

        // Find cheapest supplier
        const supplier = cheapestSupplier[product.id];
        if (!supplier) continue; // no supplier = can't order

        // Calculate order quantity: only remaining deficit after transfers, in package units
        const packageQty = Math.ceil(baseUnitsNeeded / supplier.conversionFactor);
        // Respect MOQ
        const orderQty = Math.max(packageQty, supplier.moq);
        const totalPrice = orderQty * supplier.price;
        const daysLeft = avgDaily > 0 ? Math.round(currentQty / avgDaily) : 0;

        const item: ReorderItem = {
          productId: product.id,
          productName: product.name,
          sku: product.sku || "",
          baseUom: product.baseUom,
          currentQty,
          parLevel,
          reorderPoint,
          avgDailyUsage: Math.round(avgDaily * 100) / 100,
          orderQty,
          unitPrice: supplier.price,
          totalPrice: Math.round(totalPrice * 100) / 100,
          productPackageId: supplier.productPackageId,
          packageName: supplier.packageName,
          daysUntilStockout: daysLeft,
        };

        if (!reorderGroups[outlet.id]) reorderGroups[outlet.id] = {};
        if (!reorderGroups[outlet.id][supplier.supplierId]) reorderGroups[outlet.id][supplier.supplierId] = [];
        reorderGroups[outlet.id][supplier.supplierId].push(item);
        totalReorderValue += totalPrice;
      }
    }

    // Build PO recommendations
    type PORecommendation = {
      type: "purchase_order";
      outletId: string;
      outletName: string;
      outletCode: string;
      supplierId: string;
      supplierName: string;
      leadTimeDays: number;
      items: ReorderItem[];
      totalAmount: number;
      urgency: "critical" | "low" | "restock";
    };

    const poRecommendations: PORecommendation[] = [];

    for (const [oid, supplierGroups] of Object.entries(reorderGroups)) {
      const outlet = outletMap.get(oid);
      if (!outlet) continue;

      for (const [sid, items] of Object.entries(supplierGroups)) {
        const supplierInfo = cheapestSupplier[items[0].productId];
        const total = items.reduce((s, i) => s + i.totalPrice, 0);
        const hasCritical = items.some((i) => i.currentQty <= 0);
        const hasLow = items.some((i) => i.daysUntilStockout <= 2);

        poRecommendations.push({
          type: "purchase_order",
          outletId: oid,
          outletName: outlet.name,
          outletCode: outlet.code,
          supplierId: sid,
          supplierName: supplierInfo?.supplierName || "Unknown",
          leadTimeDays: supplierInfo?.leadTimeDays || 0,
          items,
          totalAmount: Math.round(total * 100) / 100,
          urgency: hasCritical ? "critical" : hasLow ? "low" : "restock",
        });
      }
    }

    // Sort: critical first, then by total amount desc
    poRecommendations.sort((a, b) => {
      const urgencyOrder = { critical: 0, low: 1, restock: 2 };
      if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      return b.totalAmount - a.totalAmount;
    });

    // ─── 2. TRANSFER DECISIONS — Balance stock across outlets ────────

    type TransferRecommendation = {
      type: "transfer";
      fromOutletId: string;
      fromOutletName: string;
      toOutletId: string;
      toOutletName: string;
      items: {
        productId: string;
        productName: string;
        fromQty: number;
        toQty: number;
        transferQty: number;
        toParLevel: number;
      }[];
      reason: string;
    };

    const transferRecommendations: TransferRecommendation[] = [];

    if (outlets.length > 1) {
      // For each product, find outlets with overstock and outlets with low stock
      for (const product of products) {
        const outletStocks: { outletId: string; qty: number; par: number; reorder: number; maxLevel: number; avgDaily: number }[] = [];

        for (const outlet of outlets) {
          const key = `${product.id}_${outlet.id}`;
          const par = parMap.get(key);
          if (!par) continue;
          const qty = stockMap.get(key) ?? 0;
          outletStocks.push({
            outletId: outlet.id,
            qty,
            par: Number(par.parLevel),
            reorder: Number(par.reorderPoint),
            maxLevel: Number(par.maxLevel) || Number(par.parLevel) * 2,
            avgDaily: Number(par.avgDailyUsage),
          });
        }

        // Find overstocked outlets and understocked outlets
        const overstocked = outletStocks.filter((o) => o.qty > o.maxLevel);
        const understocked = outletStocks.filter((o) => o.qty <= o.reorder && o.avgDaily > 0);

        for (const from of overstocked) {
          for (const to of understocked) {
            if (from.outletId === to.outletId) continue;
            const surplus = from.qty - from.par;
            const deficit = to.par - to.qty;
            const transferQty = Math.min(surplus, deficit);
            if (transferQty <= 0) continue;

            const fromOutlet = outletMap.get(from.outletId);
            const toOutlet = outletMap.get(to.outletId);
            if (!fromOutlet || !toOutlet) continue;

            // Check if there's already a transfer recommendation for this pair
            let existing = transferRecommendations.find(
              (t) => t.fromOutletId === from.outletId && t.toOutletId === to.outletId
            );
            if (!existing) {
              existing = {
                type: "transfer",
                fromOutletId: from.outletId,
                fromOutletName: fromOutlet.name,
                toOutletId: to.outletId,
                toOutletName: toOutlet.name,
                items: [],
                reason: `Balance stock: ${fromOutlet.name} has surplus, ${toOutlet.name} needs stock`,
              };
              transferRecommendations.push(existing);
            }

            existing.items.push({
              productId: product.id,
              productName: product.name,
              fromQty: from.qty,
              toQty: to.qty,
              transferQty: Math.round(transferQty),
              toParLevel: to.par,
            });
          }
        }
      }
    }

    // Merge transfer recommendations from PO analysis (surplus at other outlets)
    for (const tfr of transferFromPO) {
      // Check if there's already a recommendation for this outlet pair
      const existing = transferRecommendations.find(
        (t) => t.fromOutletId === tfr.fromOutletId && t.toOutletId === tfr.toOutletId
      );
      if (existing) {
        // Merge items, avoid duplicates
        for (const item of tfr.items) {
          if (!existing.items.some((i) => i.productId === item.productId)) {
            existing.items.push(item);
          }
        }
      } else {
        transferRecommendations.push(tfr);
      }
    }

    // ─── 3. WASTAGE ALERTS ──────────────────────────────────────────

    type WastageAlert = {
      type: "wastage_alert";
      productId: string;
      productName: string;
      outletId: string;
      outletName: string;
      totalWasted: number;
      wasteCost: number;
      adjustmentType: string;
      suggestion: string;
    };

    // Aggregate wastage by product+outlet
    const wasteAgg: Record<string, { productId: string; outletId: string; qty: number; cost: number; types: Set<string> }> = {};
    for (const w of wastage30) {
      const key = `${w.productId}_${w.outletId}`;
      if (!wasteAgg[key]) wasteAgg[key] = { productId: w.productId, outletId: w.outletId, qty: 0, cost: 0, types: new Set() };
      wasteAgg[key].qty += Math.abs(Number(w.quantity));
      wasteAgg[key].cost += Math.abs(Number(w.costAmount || 0));
      wasteAgg[key].types.add(w.adjustmentType);
    }

    const wastageAlerts: WastageAlert[] = [];
    for (const [, agg] of Object.entries(wasteAgg)) {
      const product = productMap.get(agg.productId);
      const outlet = outletMap.get(agg.outletId);
      if (!product || !outlet) continue;

      const par = parMap.get(`${agg.productId}_${agg.outletId}`);
      const avgDaily = par ? Number(par.avgDailyUsage) : 0;

      // Only alert if wastage is significant (>20% of monthly usage or > RM50)
      const monthlyUsage = avgDaily * 30;
      if (monthlyUsage > 0 && agg.qty / monthlyUsage < 0.2 && agg.cost < 50) continue;

      const types = [...agg.types].join(", ");
      let suggestion = "Reduce order quantity to match actual usage.";
      if (agg.types.has("EXPIRED")) suggestion = "Reduce par level or order more frequently in smaller batches.";
      if (agg.types.has("SPILLAGE")) suggestion = "Review handling procedures and staff training.";
      if (agg.types.has("BREAKAGE")) suggestion = "Check storage conditions and packaging.";

      wastageAlerts.push({
        type: "wastage_alert",
        productId: agg.productId,
        productName: product.name,
        outletId: agg.outletId,
        outletName: outlet.name,
        totalWasted: Math.round(agg.qty * 100) / 100,
        wasteCost: Math.round(agg.cost * 100) / 100,
        adjustmentType: types,
        suggestion,
      });
    }

    wastageAlerts.sort((a, b) => b.wasteCost - a.wasteCost);

    // ─── Response ───────────────────────────────────────────────────

    return NextResponse.json({
      purchaseOrders: poRecommendations,
      transfers: transferRecommendations,
      wastageAlerts: wastageAlerts.slice(0, 15),
      summary: {
        totalPOsToCreate: poRecommendations.length,
        totalReorderValue: Math.round(totalReorderValue),
        criticalPOs: poRecommendations.filter((p) => p.urgency === "critical").length,
        transfersNeeded: transferRecommendations.length,
        wastageAlertCount: wastageAlerts.length,
      },
    });
  } catch (err) {
    console.error("[ai-decisions] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
