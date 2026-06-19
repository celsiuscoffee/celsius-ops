import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { syncGrabCampaigns } from "@/lib/grab-campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Daily refresh of the GrabFood campaign mirror (read-only) for every linked
// outlet. Promo *cost* comes from order data, not here — this just keeps the
// campaign list/status current.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const result = await syncGrabCampaigns();
  return NextResponse.json({ ok: true, ...result });
}
