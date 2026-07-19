import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setPulseWebhook, pulseTwoWayEnabled } from "@/lib/agents/pulse";

export const dynamic = "force-dynamic";

// One-time (idempotent) registration of the pulse bot's Telegram webhook so
// owner replies/taps reach /api/agents/pulse-webhook. OWNER/ADMIN only. Uses the
// pulse bot token + webhook secret from env - no token is handled by a human or
// placed in code. Hit this once after setting the env vars, and again if the
// app URL or secret changes.
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!pulseTwoWayEnabled()) {
    return NextResponse.json({ error: "CELSIUS_PULSE_BOT_TOKEN not set" }, { status: 400 });
  }
  const secret = process.env.CELSIUS_PULSE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CELSIUS_PULSE_WEBHOOK_SECRET not set" }, { status: 400 });
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL not set" }, { status: 500 });
  }
  const base = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
  const webhookUrl = `${base}/api/agents/pulse-webhook`;
  const result = await setPulseWebhook(webhookUrl, secret);
  return NextResponse.json({ webhookUrl, result });
}
