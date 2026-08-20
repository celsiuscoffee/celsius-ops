import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { allocateByOutlet, buildPaymentCsv, paymentReference, type PaymentLine, type ShiftDetail } from "@/lib/hr/payment-file";

export const dynamic = "force-dynamic";

// GET /api/hr/payroll/weekly/bank-file?run_id=…
//
// The per-person bulk-payment CSV finance uploads to the bank portal
// (Maybank2u Biz / CIMB BizChannel — a human approves the transfer there;
// this endpoint never moves money). Reworked 2026-07-19 (owner):
//   • RUN GATE — run must be finance-CONFIRMED (or already paid, for re-download).
//   • MANAGER GATE — every closed, non-rejected clock log in the run's week
//     must be manager-confirmed (final_status approved/adjusted) for every
//     paid PT ("managers need to confirm each PT hours first before paying").
//     Confirm at HR → PT Hours.
//   • NO SILENT SKIPS — missing bank details BLOCK the file (409 names them);
//     the old version quietly dropped those people from the payout.
//   • PER-PERSON REFERENCE — "PTW<ddmm> <name>" lands in the bank narration,
//     so each statement line reconciles to a payroll item (kills the
//     untraceable outlet lump sums the finance warehouse flagged).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id, cycle_type, period_start, period_end, status")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "confirmed" && run.status !== "paid") {
    return NextResponse.json(
      { error: `Run is '${run.status}' — confirm the run first, then download the payment file.` },
      { status: 409 },
    );
  }

  const { data: items } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("user_id, net_pay, computation_details")
    .eq("payroll_run_id", runId);
  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Run has no payroll items" }, { status: 409 });
  }
  const userIds = Array.from(new Set(items.map((i: { user_id: string }) => i.user_id)));

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, fullName: true, outletId: true, bankName: true, bankAccountNumber: true, bankAccountName: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // ── Gate: manager confirmation of every paid hour ────────────────────
  // Also carries outlet_id + clock_in: the split-by-outlet step (below) maps
  // each stored shift back to the outlet it was clocked at, keyed on the
  // clock-in instant.
  const { data: logs } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("user_id, final_status, clock_in, outlet_id")
    .in("user_id", userIds)
    .gte("clock_in", `${run.period_start}T00:00:00+08:00`)
    .lte("clock_in", `${run.period_end}T23:59:59+08:00`)
    .not("clock_out", "is", null);
  const unconfirmed = new Map<string, number>();
  // outlet of each shift, keyed by `${user_id}|${ISO clock_in}` — the shift
  // details store `start` as the same ISO instant.
  const outletByUserClockIn = new Map<string, string | null>();
  for (const l of (logs ?? []) as Array<{ user_id: string; final_status: string | null; clock_in: string; outlet_id: string | null }>) {
    if (l.clock_in) {
      outletByUserClockIn.set(`${l.user_id}|${new Date(l.clock_in).toISOString()}`, l.outlet_id ?? null);
    }
    if (l.final_status === "rejected") continue; // excluded from pay — no confirmation needed
    if (l.final_status === "approved" || l.final_status === "adjusted") continue;
    unconfirmed.set(l.user_id, (unconfirmed.get(l.user_id) ?? 0) + 1);
  }
  if (unconfirmed.size > 0) {
    const who = [...unconfirmed.entries()].map(([uid, n]) => {
      const u = userMap.get(uid);
      return `${u?.fullName || u?.name || uid.slice(0, 8)} (${n} shift${n > 1 ? "s" : ""})`;
    });
    return NextResponse.json(
      {
        error: "Manager confirmation missing — every clocked shift must be confirmed before paying.",
        unconfirmed: who,
        hint: "Managers confirm at HR → PT Hours. Rejected shifts are excluded automatically.",
      },
      { status: 409 },
    );
  }

  // Resolve outlet id → { code, name } for both the outlets shifts were
  // clocked at and each PT's home outlet (the fallback when a shift has no
  // outlet on it). Names live in the Prisma-cased "Outlet" table.
  const outletIds = Array.from(
    new Set(
      [
        ...outletByUserClockIn.values(),
        ...users.map((u) => u.outletId),
      ].filter((id): id is string => Boolean(id)),
    ),
  );
  const outlets = outletIds.length
    ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, code: true, name: true } })
    : [];
  const outletById = new Map(outlets.map((o) => [o.id, o]));

  // ── Gate: bank details — a missing account BLOCKS the file ───────────
  // Then split each PT's confirmed net_pay across the outlets they worked,
  // one bank line per outlet (owner 2026-08-20). The split is exact and
  // reconciles back to net_pay to the sen (see allocateByOutlet); a PT who
  // only worked one outlet still gets a single line, unchanged bar the new
  // Outlet column.
  const missingBank: string[] = [];
  const lines: PaymentLine[] = [];
  for (const item of items as Array<{ user_id: string; net_pay: number; computation_details: { shifts?: ShiftDetail[] } | null }>) {
    const u = userMap.get(item.user_id);
    const display = u?.fullName || u?.name || item.user_id.slice(0, 8);
    const amount = Number(item.net_pay) || 0;
    if (amount <= 0) continue;
    if (!u?.bankName || !u?.bankAccountNumber) {
      missingBank.push(display);
      continue;
    }

    const homeOutlet = u.outletId ? outletById.get(u.outletId) : undefined;
    const shifts = Array.isArray(item.computation_details?.shifts) ? item.computation_details!.shifts! : [];
    // Key each shift by the outlet it was clocked at; the sentinel "" collects
    // shifts whose outlet couldn't be resolved.
    const alloc = allocateByOutlet(
      shifts,
      (s) => (s.start ? outletByUserClockIn.get(`${item.user_id}|${new Date(s.start).toISOString()}`) ?? "" : ""),
      amount,
    );

    const base = {
      name: u.bankAccountName || display,
      bankName: u.bankName,
      accountNumber: u.bankAccountNumber,
    };

    // No usable shift breakdown (e.g. a hand-adjusted item): fall back to the
    // pre-split behaviour — one line for the whole net_pay against the home
    // outlet, reference without an outlet tag.
    if (alloc.length === 0) {
      lines.push({
        ...base,
        amount,
        reference: paymentReference(run.period_start, u.name || display),
        outlet: homeOutlet?.name ?? "",
      });
      continue;
    }

    const split = alloc.length > 1;
    // Stable order: biggest outlet first, so the file reads top-down by cost.
    alloc.sort((a, b) => b.amount - a.amount);
    for (const bucket of alloc) {
      if (bucket.amount <= 0) continue;
      const outlet = bucket.outletKey ? outletById.get(bucket.outletKey) : undefined;
      const outletName = outlet?.name ?? homeOutlet?.name ?? "";
      lines.push({
        ...base,
        amount: bucket.amount,
        // Only tag the reference with the outlet code when the person is
        // actually split — a single-outlet PT keeps the exact reference the
        // finance warehouse already reconciles against.
        reference: paymentReference(run.period_start, u.name || display, split ? outlet?.code : undefined),
        outlet: outletName,
      });
    }
  }
  if (missingBank.length > 0) {
    return NextResponse.json(
      { error: "Missing bank details — add them on the employee page first.", missing_bank: missingBank },
      { status: 409 },
    );
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const payees = new Set(lines.map((l) => l.accountNumber)).size;
  await logActivity({
    actorId: session.id,
    action: "payroll.bank-file.download",
    module: "hr",
    targetId: runId,
    targetName: `weekly ${run.period_start}`,
    // lines ≥ payees now that a multi-outlet PT is paid on one line per outlet.
    details: { run_id: runId, payees, lines: lines.length, total_rm: Math.round(total * 100) / 100 },
    request: req,
  });

  return new NextResponse(buildPaymentCsv(lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pt-payments-${run.period_start}.csv"`,
    },
  });
}
