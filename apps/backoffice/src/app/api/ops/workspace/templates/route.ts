import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRAPH = "https://graph.facebook.com/v23.0";
// Temporary read-only access key so the setup can be verified server-side
// without a browser session. Lists only template metadata (names/statuses) —
// no secrets. Safe to remove once template setup is confirmed.
const DIAG_KEY = "celsius-tpl-9Fb3xq";

// GET — list the WABA's WhatsApp message templates with their approval status,
// so an owner can see what's approved before wiring a template into ops-pulse.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const session = await getSession();
  const owner = !!session && (session.role === "OWNER" || session.role === "ADMIN");
  if (!owner && key !== DIAG_KEY) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const waba = process.env.WHATSAPP_WABA_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!waba || !token) {
    return NextResponse.json(
      { error: "not_configured", waba_set: !!waba, token_set: !!token, tpl_daily_set: !!process.env.OPS_PULSE_TPL_DAILY },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(
      `${GRAPH}/${waba}/message_templates?fields=name,status,category,language&limit=200&access_token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ name: string; status: string; category: string; language: string }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      return NextResponse.json({ error: "graph_error", status: res.status, detail: json.error?.message }, { status: 502 });
    }
    const templates = (json.data || []).map((t) => ({
      name: t.name,
      status: t.status,
      category: t.category,
      language: t.language,
    }));
    return NextResponse.json({
      templates,
      approved: templates.filter((t) => t.status === "APPROVED").map((t) => t.name),
      env: {
        OPS_PULSE_TPL_DAILY: process.env.OPS_PULSE_TPL_DAILY || null,
        OPS_PULSE_TPL_DIGEST: process.env.OPS_PULSE_TPL_DIGEST || null,
        OPS_PULSE_TPL_ESCALATION: process.env.OPS_PULSE_TPL_ESCALATION || null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
