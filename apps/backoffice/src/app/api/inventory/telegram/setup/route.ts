import { NextRequest, NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { setWebhook } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  try {
    await requireRole(req.headers, "OWNER");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL not configured" }, { status: 500 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "TELEGRAM_WEBHOOK_SECRET not configured" }, { status: 500 });
  }

  const webhookUrl = `${appUrl.startsWith("http") ? appUrl : `https://${appUrl}`}/api/inventory/telegram/webhook`;
  const result = await setWebhook(webhookUrl, secret);

  return NextResponse.json({ webhookUrl, result });
}
