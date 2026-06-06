import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";

// Consolidated monthly net cash flow from classified bank statements.
// Monthly Inflow/Outflow/Net + Group Bank Balance come from BankStatement
// HEADER totals (fast, already net of InterCo at ingest); the category
// ranking comes from the classified lines of the same (deduped) statements.
//
// Dedupe: a given (account, month) can have more than one statement row
// (e.g. an early CSV upload + the later PDF backfill). We keep the richest
// one (most lines) per (account-last4, month) so totals never double-count.

function last4(accountName: string | null): string {
  return accountName?.match(/(\d{4})\)?\s*$/)?.[1] ?? (accountName ?? "????");
}
function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const sp = req.nextUrl.searchParams;
  const to = sp.get("to") ? new Date(`${sp.get("to")}T23:59:59Z`) : new Date();
  const from = sp.get("from")
    ? new Date(`${sp.get("from")}T00:00:00Z`)
    : new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), 1));
  const accountFilter = sp.getAll("account").filter(Boolean); // list of last4

  const statements = await prisma.bankStatement.findMany({
    where: { statementDate: { gte: from, lte: to } },
    select: {
      id: true,
      accountName: true,
      statementDate: true,
      closingBalance: true,
      totalInflows: true,
      totalOutflows: true,
      interCoInflows: true,
      interCoOutflows: true,
      _count: { select: { lines: true } },
    },
    orderBy: { statementDate: "asc" },
  });

  // Dedupe per (last4, month): keep the statement with the most lines.
  const best = new Map<string, (typeof statements)[number]>();
  for (const s of statements) {
    const code = last4(s.accountName);
    if (accountFilter.length && !accountFilter.includes(code)) continue;
    const key = `${code}|${ym(s.statementDate)}`;
    const prev = best.get(key);
    if (!prev || s._count.lines > prev._count.lines) best.set(key, s);
  }
  const kept = [...best.values()];
  const keptIds = kept.map((s) => s.id);

  // Monthly rollup from headers (already net of InterCo at ingest).
  const months = new Map<string, { inflow: number; outflow: number; closing: number }>();
  const accountSet = new Map<string, string>(); // last4 -> display name
  for (const s of kept) {
    const m = ym(s.statementDate);
    const row = months.get(m) ?? { inflow: 0, outflow: 0, closing: 0 };
    const inflow = Number(s.totalInflows ?? 0) - Number(s.interCoInflows ?? 0);
    const outflow = Number(s.totalOutflows ?? 0) - Number(s.interCoOutflows ?? 0);
    row.inflow += inflow;
    row.outflow += outflow;
    row.closing += Number(s.closingBalance); // group bank balance = Σ account closing balances
    months.set(m, row);
    accountSet.set(last4(s.accountName), (s.accountName ?? "").replace(/\s*\(\d{4}\)\s*$/, "").trim() || s.accountName || "Account");
  }

  const monthly = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, r]) => ({
      month,
      inflow: round2(r.inflow),
      outflow: round2(r.outflow),
      net: round2(r.inflow - r.outflow),
      closingBalance: round2(r.closing),
    }));

  // Category ranking from the kept statements' lines (exclude InterCo).
  const grouped = keptIds.length
    ? await prisma.bankStatementLine.groupBy({
        by: ["category", "direction"],
        where: { statementId: { in: keptIds }, isInterCo: false },
        _sum: { amount: true },
        _count: { _all: true },
      })
    : [];
  const cat = (dir: "CR" | "DR") =>
    grouped
      .filter((g) => g.direction === dir)
      .map((g) => ({ category: g.category ?? "UNCLASSIFIED", amount: round2(Number(g._sum.amount ?? 0)), count: g._count._all }))
      .sort((a, b) => b.amount - a.amount);

  const totals = monthly.reduce(
    (acc, m) => ({ inflow: acc.inflow + m.inflow, outflow: acc.outflow + m.outflow }),
    { inflow: 0, outflow: 0 }
  );

  return NextResponse.json({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    monthly,
    totals: {
      inflow: round2(totals.inflow),
      outflow: round2(totals.outflow),
      net: round2(totals.inflow - totals.outflow),
      closingBalance: monthly.length ? monthly[monthly.length - 1].closingBalance : 0,
    },
    topInflow: cat("CR"),
    topOutflow: cat("DR"),
    accounts: [...accountSet.entries()].map(([code, name]) => ({ code, name })),
  });
}
