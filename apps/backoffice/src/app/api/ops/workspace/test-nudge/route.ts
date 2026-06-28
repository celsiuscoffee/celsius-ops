import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findNoClockInBreaches } from "@/lib/ops-pulse/detectors";
import { findStaleStockBreaches } from "@/lib/ops-nudges";
import { sendProactive } from "@/lib/ops-pulse/sender";
import { TEMPLATES } from "@/lib/ops-pulse/config";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

function toMsisdn(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.startsWith("0") ? "60" + d.slice(1) : d;
}

// POST /api/ops/workspace/test-nudge — send ONE person the REAL current ops
// digest (today's no-clock-ins + overdue stock counts), scoped to a single
// recipient so it never fans out to staff. Defaults to the caller's own phone;
// OWNER/ADMIN may target anyone with { to }. Returns the composed text even when
// the send fails (e.g. recipient's 24h window is closed), so the copy can be
// reviewed. This is the "test the flow to one staff first" tool.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  const body = (await req.json().catch(() => ({}))) as { to?: unknown; name?: unknown };
  const override = typeof body.to === "string" ? body.to.trim() : "";

  // Resolve recipient phone + a friendly first name for the greeting.
  let target: string;
  let greetName = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "there";
  if (override && isAdmin) {
    target = toMsisdn(override);
    if (target.length < 8) {
      return NextResponse.json({ error: "bad_number", message: "That recipient number doesn't look valid." }, { status: 400 });
    }
  } else {
    const me = await prisma.user.findUnique({ where: { id: session.id }, select: { phone: true, name: true, fullName: true } });
    if (!me?.phone) {
      return NextResponse.json(
        { error: "no_phone", message: "Your profile has no phone — add one, or (as owner) pass a recipient." },
        { status: 400 },
      );
    }
    target = toMsisdn(me.phone);
    greetName = (me.fullName || me.name || "there").split(" ")[0];
  }

  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "2-digit", month: "short" });

  // Real live data — same detectors the crons use.
  const [clk, stock] = await Promise.all([findNoClockInBreaches(now), findStaleStockBreaches(now, 3)]);

  const ids = [...new Set(clk.map((b) => String(b.detail.userId ?? "")).filter(Boolean))];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, fullName: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName || u.name]));

  const fmtTime = (t: string) => {
    const [h, m] = t.slice(0, 5).split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""}${ap}`;
  };
  const noShowLines = clk.map((b) => {
    const who = nameById.get(String(b.detail.userId ?? "")) ?? "Staff";
    return `${who} — ${b.outletName}, ${fmtTime(String(b.detail.scheduledStart ?? ""))}`;
  });
  const stockLines = stock.map((b) => `${b.outletName} — ${String((b.detail as { when?: string }).when ?? "overdue")}`);

  // Compose: professional but casual, no emoji.
  const parts = [`Morning ${greetName}. Quick ops check for ${dateLabel}:`];
  if (noShowLines.length) {
    parts.push("", `Not clocked in yet (${noShowLines.length}):`, ...noShowLines.map((l) => `- ${l}`));
  }
  if (stockLines.length) {
    parts.push("", `Stock count overdue (${stockLines.length}):`, ...stockLines.map((l) => `- ${l}`));
  }
  if (!noShowLines.length && !stockLines.length) {
    parts.push("", "All clear — everyone's clocked in and stock counts are current. Nice work.");
  } else {
    parts.push("", "Could you follow up with the team? Reply DONE once it's sorted. Thanks.");
  }
  const text = parts.join("\n");
  const v = `Ops check ${dateLabel}: ${noShowLines.length} not clocked in, ${stockLines.length} stock counts due`;

  const res = await sendProactive(target, TEMPLATES.nudge, text, v);

  return NextResponse.json({
    ok: res.ok,
    to: target,
    preview: text,
    counts: { noShows: noShowLines.length, stockOverdue: stockLines.length },
    error: res.ok ? undefined : res.error,
    message: res.ok
      ? "Sent — check WhatsApp."
      : "Send failed — most likely the recipient's 24h window is closed and no ops_nudge template is approved yet. Have them message the business number once, then retry.",
  });
}
