import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { sendPurchaseOrder, type PoForSend } from "@/lib/inventory/procurement-po-send";

export const dynamic = "force-dynamic";

// POST /api/inventory/orders/[id]/resend-po
// Re-fire the WhatsApp PO send for a purchase order — the "supplier says they
// never got it" button. Runs sendPurchaseOrder with force:true, which skips the
// delivered/prompted dedupes (the whole point is sending AGAIN) while keeping
// every other gate: automationMode, 24h window, PDF → prompt fallback. The
// outcome is read from the row THIS call recorded (ok:true only — a failed
// send used to be reported as "sent to the supplier").
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

  const startedAt = new Date();
  await sendPurchaseOrder(order as unknown as PoForSend, { force: true });

  // Report the outcome by reading the row THIS call recorded (timestamp >=
  // startedAt) — never an older row, and only ok:true counts as delivered. A
  // failed PDF-template row also stamps poSentFor, which the old query read
  // back as "PO block sent to the supplier" while the supplier got nothing.
  const [sent, prompted] = await Promise.all([
    prisma.whatsAppMessage.findFirst({
      where: {
        direction: "outbound",
        timestamp: { gte: startedAt },
        AND: [{ raw: { path: ["poSentFor"], equals: id } }, { raw: { path: ["ok"], equals: true } }],
      },
      orderBy: { timestamp: "desc" },
      select: { raw: true },
    }),
    prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", timestamp: { gte: startedAt }, raw: { path: ["poPromptFor"], equals: id } },
      orderBy: { timestamp: "desc" },
      select: { status: true, raw: true },
    }),
  ]);

  if (sent) {
    const via = String((sent.raw as Record<string, unknown>)?.via ?? "po-block");
    return NextResponse.json({
      ok: true,
      via,
      message: via === "pdf-template" ? "PO re-sent as a PDF to the supplier." : "PO block re-sent to the supplier.",
    });
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
  // A failed in-window/PDF send records a poSentFor row with ok:false — read it
  // for the error so the human isn't told "nothing happened" when Meta rejected.
  const failed = await prisma.whatsAppMessage.findFirst({
    where: { direction: "outbound", timestamp: { gte: startedAt }, raw: { path: ["poSentFor"], equals: id } },
    orderBy: { timestamp: "desc" },
    select: { raw: true },
  });
  if (failed) {
    const raw = (failed.raw ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      ok: false,
      message: `Send failed${raw.error ? `: ${String(raw.error)}` : " — check the WhatsApp configuration."}`,
    });
  }
  return NextResponse.json({
    ok: false,
    message: "Nothing sent — the supplier is on the manual lane (OFF) or PROCUREMENT_AGENT_ENABLED is off.",
  });
}
