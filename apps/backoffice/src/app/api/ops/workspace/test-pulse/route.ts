import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendDailyDigest } from "@/lib/ops-pulse/sender";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// POST — send a SAMPLE ops-pulse daily digest to the caller's own WhatsApp,
// through the real sender (approved template if one is configured, else
// free-form which only delivers inside the caller's open 24h window). Lets an
// owner verify pulse delivery + formatting before arming the cron. Sample data
// only — never touches the OpsAlert ledger or any real detector.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const me = await prisma.user.findUnique({ where: { id: session.id }, select: { phone: true } });
  if (!me?.phone) {
    return NextResponse.json(
      { error: "no_phone", message: "Your staff profile has no phone number on file — add one to receive a test pulse." },
      { status: 400 },
    );
  }

  // Representative sample spanning the real detector categories: routine
  // (recurring discipline) vs adhoc (event-driven). Mirrors what a live daily
  // digest looks like so the format + delivery are validated end to end.
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

  const result = await sendDailyDigest(me.phone, routine, adhoc);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error || "send_failed",
        message:
          "Send failed — most likely outside your 24h WhatsApp window and no approved pulse template is configured yet. Send any WhatsApp to the business number from your phone, then try again.",
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, messageId: result.messageId, to: me.phone });
}
