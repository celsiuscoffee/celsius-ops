import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron-monitor";
import { syncGrabCampaigns } from "@/lib/grab-campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Daily refresh of the GrabFood campaign mirror (read-only) for every linked
// outlet. Promo *cost* comes from order data, not here — this just keeps the
// campaign list/status current.
async function runGrabCampaignsSync() {
  const result = await syncGrabCampaigns();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = cronRoute("grab-campaigns-sync", runGrabCampaignsSync);
