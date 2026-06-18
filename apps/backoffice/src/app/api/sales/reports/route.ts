import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildOverTime,
  buildByChannel,
  buildByProduct,
  buildByCategory,
  buildByPayment,
  buildByPromotion,
  buildByShift,
  type ReportKind,
  type GroupBy,
  type OutletPick,
} from "../_lib/reports";
import { getMYTToday, addDays } from "../_lib/native-sales-helpers";

/**
 * GET /api/sales/reports
 *   ?report=over-time|product|category|payment   (default over-time)
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD                (MYT; default last 7 days)
 *   &outletId=all|<Outlet.id>                     (admins only; others locked)
 *   &groupBy=day|week|month                       (over-time only; default day)
 *
 * StoreHub-style Sales reports on our own data. See _lib/reports.ts for the
 * source/cutover routing. Money is returned in RM (already converted).
 */

const VALID_REPORTS: ReportKind[] = [
  "over-time",
  "channel",
  "product",
  "category",
  "payment",
  "promotion",
  "shift",
];
const VALID_GROUP: GroupBy[] = ["day", "week", "month"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user;

  const sp = new URL(request.url).searchParams;
  const report = (sp.get("report") || "over-time") as ReportKind;
  if (!VALID_REPORTS.includes(report)) {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }
  const groupBy = (sp.get("groupBy") || "day") as GroupBy;
  if (!VALID_GROUP.includes(groupBy)) {
    return NextResponse.json({ error: "Invalid groupBy" }, { status: 400 });
  }

  const today = getMYTToday();
  const qFrom = sp.get("from");
  const qTo = sp.get("to");
  let from = DATE_RE.test(qFrom || "") ? (qFrom as string) : addDays(today, -6);
  let to = DATE_RE.test(qTo || "") ? (qTo as string) : today;
  if (from > to) [from, to] = [to, from];

  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const reqOutlet = sp.get("outletId");
  // Admins default to all outlets and may drill into one; everyone else is
  // locked to their assigned outlet (client param ignored).
  const scope = isAdmin ? reqOutlet || "all" : user.outletId;
  if (!scope) return NextResponse.json({ error: "No outlet" }, { status: 400 });

  const all = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      storehubId: true,
      loyaltyOutletId: true,
      pickupStoreId: true,
      posNativeCutoverAt: true,
    },
    orderBy: { name: "asc" },
  });
  const picked: OutletPick[] = scope === "all" ? all : all.filter((o) => o.id === scope);
  if (scope !== "all" && picked.length === 0) {
    return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  }

  try {
    let result;
    if (report === "channel") result = await buildByChannel(picked, from, to);
    else if (report === "product") result = await buildByProduct(picked, from, to);
    else if (report === "category") result = await buildByCategory(picked, from, to);
    else if (report === "payment") result = await buildByPayment(picked, from, to);
    else if (report === "promotion") result = await buildByPromotion(picked, from, to);
    else if (report === "shift") result = await buildByShift(picked, from, to);
    else result = await buildOverTime(picked, from, to, groupBy);

    return NextResponse.json({
      ...result,
      from,
      to,
      groupBy,
      outletId: scope === "all" ? "all" : picked[0].id,
      outletName: scope === "all" ? "All outlets" : picked[0].name,
      availableOutlets: isAdmin ? all.map((o) => ({ id: o.id, name: o.name })) : undefined,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[sales/reports]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Report failed" },
      { status: 500 },
    );
  }
}
