import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runCommsDigest } from "@/lib/agents/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Manual / on-demand trigger for the agent-comms daily digest. NOT a Vercel
// cron (the project is near the 40-cron cap) - the scheduled run is folded into
// the owner-briefing cron's 9pm MYT firing. Hit this route to send a digest now.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  const res = await runCommsDigest();
  return NextResponse.json(res);
}
