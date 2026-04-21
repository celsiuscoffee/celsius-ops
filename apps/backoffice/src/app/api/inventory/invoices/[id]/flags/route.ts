import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { parseFlags, type InvoiceFlagCode } from "@/lib/inventory/flag-detector";

// POST /api/inventory/invoices/[id]/flags
// Body: { action: "dismiss" | "reopen", code: InvoiceFlagCode }
// Dismiss = "accept" (the user reviewed and the flag is OK).
// Reopen = un-dismiss if it was cleared in error.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const { action, code } = (await req.json()) as { action?: string; code?: InvoiceFlagCode };
    if (!action || !code) {
      return NextResponse.json({ error: "action and code are required" }, { status: 400 });
    }

    const inv = await prisma.invoice.findUnique({ where: { id }, select: { flags: true } });
    if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const flags = parseFlags(inv.flags);
    const idx = flags.findIndex((f) => f.code === code);
    if (idx === -1) return NextResponse.json({ error: "Flag not found" }, { status: 404 });

    if (action === "dismiss") {
      flags[idx] = {
        ...flags[idx],
        dismissed: true,
        dismissedAt: new Date().toISOString(),
        dismissedById: caller.id,
      };
    } else if (action === "reopen") {
      flags[idx] = {
        ...flags[idx],
        dismissed: false,
        dismissedAt: undefined,
        dismissedById: undefined,
      };
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { flags: flags as unknown as Prisma.InputJsonValue },
      select: { flags: true },
    });

    return NextResponse.json({ flags: updated.flags });
  } catch (err) {
    console.error("[invoices/[id]/flags POST]", err);
    const message = err instanceof Error ? err.message : "Failed to update flag";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
