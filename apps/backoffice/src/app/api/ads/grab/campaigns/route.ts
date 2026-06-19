/**
 * GrabFood campaigns — list the synced mirror + trigger a re-sync.
 *
 * GET  /api/ads/grab/campaigns?outletId=outlet-sa   → { campaigns[] }
 * POST /api/ads/grab/campaigns                        → runs syncGrabCampaigns()
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { syncGrabCampaigns } from "@/lib/grab-campaigns";

export const dynamic = "force-dynamic";

type CampaignRow = {
  id: string;
  outlet_id: string;
  outlet_name: string | null;
  grab_campaign_id: string;
  name: string | null;
  created_by: string | null;
  status: string | null;
  discount_summary: string | null;
  synced_at: Date;
};

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "OWNER", "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const outletId = req.nextUrl.searchParams.get("outletId");
  const oFilter = outletId && outletId !== "all" ? outletId : null;

  const rows = await prisma.$queryRaw<CampaignRow[]>(Prisma.sql`
    SELECT c.id, c.outlet_id, o.name AS outlet_name, c.grab_campaign_id, c.name,
           c.created_by, c.status, c.discount_summary, c.synced_at
    FROM grab_campaigns c
    LEFT JOIN outlets o ON o.id = c.outlet_id
    WHERE (${oFilter}::text IS NULL OR c.outlet_id = ${oFilter})
    ORDER BY c.synced_at DESC, c.name ASC
  `);

  return NextResponse.json({
    campaigns: rows.map((r) => ({
      id: r.id,
      outletId: r.outlet_id,
      outletName: r.outlet_name ?? r.outlet_id,
      grabCampaignId: r.grab_campaign_id,
      name: r.name,
      createdBy: r.created_by,
      status: r.status,
      discountSummary: r.discount_summary,
      syncedAt: r.synced_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req.headers, "OWNER", "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncGrabCampaigns();
  return NextResponse.json(result, { status: result.errors.length && result.upserted === 0 ? 502 : 200 });
}
