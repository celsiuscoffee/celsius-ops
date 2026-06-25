import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendDailyDigest } from "@/lib/ops-pulse/sender";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// Normalise a Malaysian number to E.164 digits (no +): strip non-digits, then
// turn a local "01x…" into "601x…". Already-international "60…" passes through.
function toMsisdn(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) return "60" + d.slice(1);
  return d;
}

// POST — send a SAMPLE ops-pulse daily digest via the real sender (approved
// template if configured, else free-form inside the recipient's open 24h
// window). Defaults to the caller's own phone; OWNER/ADMIN may override the
// recipient with { to }. Sample data only — never touches the OpsAlert ledger.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  const body = (await req.json().catch(() => ({}))) as { to?: unknown };
  const override = typeof body.to === "string" ? body.to.trim() : "";

  let target: string;
  if (override && isAdmin) {
    target = toMsisdn(override);
    if (target.length < 8) {
      return NextResponse.json({ error: "bad_number", message: "That recipient number doesn't look valid." }, { status: 400 });
    }
  } else {
    const me = await prisma.user.findUnique({ where: { id: session.id }, select: { phone: true } });
    if (!me?.phone) {
      return NextResponse.json(
        { error: "no_phone", message: "Your staff profile has no phone number on file — add one, or (as owner) enter a recipient." },
        { status: 400 },
      );
    }
    target = toMsisdn(me.phone);
  }

  // Representative sample spanning the real detector categories: routine
  // (recurring discipline) vs adhoc (event-driven). Mirrors a live daily digest
  // so format + delivery are validated end to end.
  const routine = [
    "🧪 TEST PULSE — sample data, not real alerts",
    "Stock count overdue (2 days) · Bangsar",
    "Weekly barista audit due · Bangsar",
    "Opening checklist incomplete · Bangsar",
  ];
  const adhoc = [
    "⭐ New 2★ review — “Long wait, latte was cold” · Bangsar",
    "Menu item snoozed 3h — Iced Latte · Bangsar",
    "Receiving short 2 units — PO #1042",
  ];

  const result = await sendDailyDigest(target, routine, adhoc);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error || "send_failed",
        message:
          "Send failed — most likely outside the recipient's 24h WhatsApp window and no approved pulse template is configured yet. They need to message the business number first, then try again.",
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, messageId: result.messageId, to: target });
}
