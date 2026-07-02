import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { sendPurchaseOrder, type PoForSend } from "@/lib/inventory/procurement-po-send";

export const dynamic = "force-dynamic";

// POST /api/inventory/orders/[id]/resend-po
// Re-fire the WhatsApp PO send for a purchase order that's marked sent but was never
// delivered (e.g. it was blocked by the old allowlist gate, or a cold-window prompt needs
// re-sending). Owner/admin only. Re-runs sendPurchaseOrder (which keeps all its own gates:
// automationMode, 24h window / prompt template, and the poSentFor dedup so an
// already-delivered PO is a no-op), then reports what actually happened.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN", "MANAGER"].includes(caller.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      outlet: true,
      supplier: true,
      items: { include: { product: true, productPackage: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.orderType !== "PURCHASE_ORDER") {
    return NextResponse.json({ error: "Not a purchase order." }, { status: 400 });
  }
  if (!["SENT", "CONFIRMED", "AWAITING_DELIVERY"].includes(order.status)) {
    return NextResponse.json({ error: `PO is ${order.status.toLowerCase()} — not in a sendable state.` }, { status: 400 });
  }

  await sendPurchaseOrder(order as unknown as PoForSend);

  // Report the outcome by reading the row sendPurchaseOrder just recorded for this PO.
  const [sent, prompted] = await Promise.all([
    prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", raw: { path: ["poSentFor"], equals: id } },
      orderBy: { timestamp: "desc" },
      select: { status: true },
    }),
    prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", raw: { path: ["poPromptFor"], equals: id } },
      orderBy: { timestamp: "desc" },
      select: { status: true, raw: true },
    }),
  ]);

  if (sent) {
    return NextResponse.json({ ok: true, via: "po-block", message: "PO block sent to the supplier." });
  }
  if (prompted) {
    const raw = (prompted.raw ?? {}) as Record<string, unknown>;
    if (prompted.status === "sent" && raw.ok === true) {
      return NextResponse.json({
        ok: true,
        via: "prompt",
        message: "Supplier is cold — sent the reply prompt; the PO block follows automatically when they reply.",
      });
    }
    return NextResponse.json({
      ok: false,
      via: "prompt",
      message: `Cold prompt failed — most likely the "procurement_new_order" template isn't approved on Meta yet.${raw.error ? ` (${String(raw.error)})` : ""}`,
    });
  }
  return NextResponse.json({
    ok: false,
    message: "Nothing sent — the supplier is on the manual lane (OFF) or PROCUREMENT_AGENT_ENABLED is off.",
  });
}
