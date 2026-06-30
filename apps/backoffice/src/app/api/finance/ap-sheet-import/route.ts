// GET  /api/finance/ap-sheet-import — dry-run: parse the AP sheet, report how
//        many invoices WOULD be created (no writes).
// POST /api/finance/ap-sheet-import — commit: create the missing invoices, then
//        the AP-match (daily cron or /api/finance/ap-match) links them to bank
//        outflows.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { importApSheet } from "@/lib/finance/ap-sheet-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await importApSheet({ commit: false }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await importApSheet({ commit: true }));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
