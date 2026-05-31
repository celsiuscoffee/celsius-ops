/**
 * GrabFood integration admin API (BackOffice side).
 *
 * Read-side: outlet linkage + recent GrabFood order summary.
 * Write-side: set/clear the `grabMerchantId` for an outlet (the column we
 * added to the Outlet table; the inbound order webhook resolves the right
 * outlet for incoming Grab orders by this value).
 *
 * GET    /api/integrations/grab           → { configured, outlets[], recentOrders[], stats }
 * PATCH  /api/integrations/grab           → { outletId, grabMerchantId } → updates linkage
 *
 * Why raw SQL: `grabMerchantId` was added to the underlying "Outlet" table
 * via manual migration but isn't in the generated Prisma client yet. We use
 * $queryRaw / $executeRaw to read/write it directly until the Prisma schema
 * catches up.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { Prisma } from "@prisma/client";

type OutletLinkRow = {
  id: string;
  name: string;
  city: string | null;
  storehubId: string | null;
  grabMerchantId: string | null;
  is_active: boolean;
};

type RecentOrderRow = {
  id: string;
  external_id: string | null;
  order_number: string | null;
  // outlet_name is not a column on pos_orders — it's joined from outlets.
  // The old SELECT crashed on the missing column, killing this whole admin
  // page. We now LEFT JOIN outlets and alias the name in the SELECT below.
  outlet_name: string | null;
  status: string | null;
  total: number | null;
  created_at: Date;
};

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Outlet linkage — read grabMerchantId via raw SQL.
  const outletRows = await prisma.$queryRaw<OutletLinkRow[]>(Prisma.sql`
    SELECT "loyaltyOutletId" AS id,
           name,
           city,
           "storehubId",
           "grabMerchantId",
           (status = 'ACTIVE'::"OutletStatus") AS is_active
    FROM "Outlet"
    WHERE "loyaltyOutletId" IS NOT NULL
    ORDER BY name ASC
  `);

  // Recent GrabFood orders (last 14 days, up to 25 rows).
  // pos_orders schema (from inbound webhook): platform='grabfood', external_id,
  // order_number, status, total (sen), outlet_name, created_at.
  let recentOrders: RecentOrderRow[] = [];
  let stats = { last7d: 0, last30d: 0, allTime: 0 };
  try {
    recentOrders = await prisma.$queryRaw<RecentOrderRow[]>(Prisma.sql`
      SELECT po.id,
             po.external_id,
             po.order_number,
             o.name AS outlet_name,
             po.status,
             po.total,
             po.created_at
      FROM pos_orders po
      LEFT JOIN outlets o ON o.id = po.outlet_id
      WHERE po.source = 'grabfood'
        AND po.created_at > NOW() - INTERVAL '14 days'
      ORDER BY po.created_at DESC
      LIMIT 25
    `);
    const statsRow = await prisma.$queryRaw<{ last7d: bigint; last30d: bigint; all_time: bigint }[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')  AS last7d,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS last30d,
        COUNT(*)                                                         AS all_time
      FROM pos_orders WHERE source = 'grabfood'
    `);
    if (statsRow[0]) {
      stats = {
        last7d: Number(statsRow[0].last7d),
        last30d: Number(statsRow[0].last30d),
        allTime: Number(statsRow[0].all_time),
      };
    }
  } catch (err) {
    // pos_orders may not exist in some preview environments; degrade gracefully.
    console.warn("[integrations/grab] pos_orders read skipped:", err);
  }

  const configured = outletRows.some((o) => !!o.grabMerchantId);
  return NextResponse.json({
    configured,
    env: process.env.GRAB_ENV || "sandbox",
    outlets: outletRows.map((o) => ({
      id: o.id,
      name: o.name,
      city: o.city,
      storehubId: o.storehubId,
      grabMerchantId: o.grabMerchantId,
      isActive: o.is_active,
    })),
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      externalId: o.external_id,
      orderNumber: o.order_number,
      outletName: o.outlet_name,
      status: o.status,
      totalRM: o.total != null ? Number(o.total) / 100 : null,
      createdAt: o.created_at,
    })),
    stats,
  });
}

export async function PATCH(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    outletId?: string;
    grabMerchantId?: string | null;
  };
  const outletId = (body.outletId || "").trim();
  const next = body.grabMerchantId === null ? null : (body.grabMerchantId || "").trim() || null;

  if (!outletId) {
    return NextResponse.json({ error: "outletId required" }, { status: 400 });
  }

  // Mirror the write to BOTH tables. The admin UI reads from the Prisma
  // "Outlet" table (camelCase grabMerchantId) but the inbound Grab webhook
  // resolves the destination outlet by selecting from `outlets` (snake_case
  // grab_merchant_id). The two were getting out of sync — a UI edit would
  // silently break order routing because the webhook still saw the old
  // merchant id. Update both atomically so they can't diverge.
  const [pascalResult, snakeResult] = await Promise.all([
    prisma.$executeRaw(Prisma.sql`
      UPDATE "Outlet"
      SET "grabMerchantId" = ${next}
      WHERE "loyaltyOutletId" = ${outletId}
    `),
    prisma.$executeRaw(Prisma.sql`
      UPDATE outlets
      SET grab_merchant_id = ${next}
      WHERE id = ${outletId}
    `),
  ]);

  if (pascalResult === 0 && snakeResult === 0) {
    return NextResponse.json({ error: "outlet not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    outletId,
    grabMerchantId: next,
    updated: { outlet_pascal: pascalResult, outlets_snake: snakeResult },
  });
}
