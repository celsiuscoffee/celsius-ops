import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRAPH = "https://graph.facebook.com/v23.0";
// Temporary read-only access key so the setup can be verified server-side
// without a browser session. Lists only template metadata (names/statuses) —
// no secrets. Safe to remove once template setup is confirmed.
const DIAG_KEY = "celsius-tpl-9Fb3xq";

// The ops-pulse template set, created via ?action=create. Bodies are emoji-free
// with a single {{1}} variable carrying the one-line "count · item · item"
// summary built by the *Var helpers in sender.ts. Category UTILITY, language en.
const TEMPLATE_DEFS = [
  {
    name: "ops_pulse_digest",
    body: "Ops Pulse\n\n{{1}}\n\nReply DONE when handled.",
    sample: "3 need you · Stock count overdue at Bangsar · 2-star review at KLCC",
  },
  {
    name: "ops_pulse_daily",
    body: "Daily Ops Pulse\n\n{{1}}\n\nClear them today. Reply DONE as you go.",
    sample: "4 open today · Stock count overdue · Weekly audit due · Opening checklist incomplete",
  },
  {
    name: "ops_pulse_escalation",
    body: "Ops escalation\n\n{{1}}\n\nThese are past SLA — please follow up.",
    sample: "2 unacked past SLA · Checklist incomplete at Bangsar — lead: Ariff",
  },
  {
    name: "ops_pulse_audit",
    body: "Audit\n\n{{1}}\n\nRun it and log the report. Reply DONE when done.",
    sample: "1 audit due · Kitchen Quality Audit overdue at Bangsar (8 days)",
  },
] as const;

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

  // ?action=create — submit the ops-pulse template set to Meta for approval. A
  // name that already exists comes back as an error we surface (so re-running is
  // safe). Requires the token to carry whatsapp_business_management.
  if (req.nextUrl.searchParams.get("action") === "create") {
    const created: unknown[] = [];
    for (const t of TEMPLATE_DEFS) {
      try {
        const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: t.name,
            language: "en",
            category: "UTILITY",
            components: [{ type: "BODY", text: t.body, example: { body_text: [[t.sample]] } }],
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          id?: string;
          status?: string;
          error?: { message?: string; error_user_msg?: string };
        };
        created.push({
          name: t.name,
          ok: res.ok,
          httpStatus: res.status,
          id: json.id ?? null,
          status: json.status ?? null,
          error: json.error?.error_user_msg || json.error?.message || null,
        });
      } catch (e) {
        created.push({ name: t.name, ok: false, error: String(e) });
      }
    }
    return NextResponse.json({ created });
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
        OPS_PULSE_TPL_AUDIT: process.env.OPS_PULSE_TPL_AUDIT || null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
