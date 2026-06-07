// GET /api/finance/home
// Aggregates the "Business Feed"-style home cards: agent activity for the
// last 24h, MTD revenue by channel, exception counts, cash position per
// bank account.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { getActiveCompanyId } from "@/lib/finance/companies";
import { prisma } from "@/lib/prisma";

// Each company's Maybank current account, identified by the 4-digit suffix in
// BankStatement.accountName. Cash position reads the latest statement's closing
// balance — the ledger's 1000-* balances are unreliable until journals post.
const BANK_ACCOUNT_SUFFIX: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

export const dynamic = "force-dynamic";

function todayMyt(): string {
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return myt.toISOString().slice(0, 10);
}

function mtdStartMyt(): string {
  return todayMyt().slice(0, 7) + "-01";
}

function yesterdayMyt(): string {
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  myt.setUTCDate(myt.getUTCDate() - 1);
  return myt.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());

  const client = getFinanceClient();
  const today = todayMyt();
  const yesterday = yesterdayMyt();
  const mtdStart = mtdStartMyt();

  // Recent posted transactions (yesterday's AR runs are the headline).
  const { data: recentPosts } = await client
    .from("fin_transactions")
    .select("id, txn_date, description, amount, posted_by_agent, confidence, outlet_id")
    .eq("company_id", companyId)
    .gte("txn_date", yesterday)
    .lte("txn_date", today)
    .in("status", ["posted", "draft"])
    .order("txn_date", { ascending: false })
    .limit(20);

  // Open exceptions count by priority.
  const { data: openExc } = await client
    .from("fin_exceptions")
    .select("id, priority")
    .eq("company_id", companyId)
    .eq("status", "open");

  const exceptionCount = {
    total: openExc?.length ?? 0,
    urgent: openExc?.filter((e) => e.priority === "urgent").length ?? 0,
    high: openExc?.filter((e) => e.priority === "high").length ?? 0,
  };

  // MTD revenue total (all 5xxx accounts, credit minus debit).
  const { data: mtdLines } = await client
    .from("fin_journal_lines")
    .select("debit, credit, account_code, transaction_id")
    .like("account_code", "5%");

  // We need to filter by transaction date; second hop:
  let mtdRevenue = 0;
  if (mtdLines && mtdLines.length) {
    const txnIds = Array.from(new Set(mtdLines.map((l) => l.transaction_id)));
    const { data: txns } = await client
      .from("fin_transactions")
      .select("id, txn_date, status, company_id")
      .in("id", txnIds);
    const validTxnIds = new Set(
      (txns ?? [])
        .filter((t) => (t.status === "posted" || t.status === "draft") && t.txn_date >= mtdStart && t.company_id === companyId)
        .map((t) => t.id)
    );
    for (const l of mtdLines) {
      if (!validTxnIds.has(l.transaction_id)) continue;
      mtdRevenue += Number(l.credit) - Number(l.debit);
    }
  }

  // Cash position — latest bank-statement closing balance for this company's
  // account. (Reads the bank directly; the ledger's 1000-* balances are
  // unreliable until journals actually post.)
  const suffix = BANK_ACCOUNT_SUFFIX[companyId];
  const cashPosition: { code: string; name: string; balance: number }[] = [];
  if (suffix) {
    const stmt = await prisma.bankStatement.findFirst({
      where: { accountName: { contains: suffix } },
      orderBy: { statementDate: "desc" },
      select: { accountName: true, closingBalance: true, statementDate: true },
    });
    if (stmt) {
      cashPosition.push({
        code: suffix,
        name: `${stmt.accountName ?? "Bank"} · as of ${stmt.statementDate.toISOString().slice(0, 10)}`,
        balance: Number(stmt.closingBalance),
      });
    }
  }

  // Today's agent activity counts for the activity feed header.
  const { data: agentActivity } = await client
    .from("fin_transactions")
    .select("posted_by_agent, amount")
    .eq("company_id", companyId)
    .gte("txn_date", yesterday)
    .lte("txn_date", today)
    .in("status", ["posted", "draft"]);

  const activityByAgent: Record<string, { count: number; amount: number }> = {};
  for (const r of agentActivity ?? []) {
    const a = (r.posted_by_agent as string) ?? "unknown";
    if (!activityByAgent[a]) activityByAgent[a] = { count: 0, amount: 0 };
    activityByAgent[a].count += 1;
    activityByAgent[a].amount += Number(r.amount);
  }

  return NextResponse.json({
    asOf: new Date().toISOString(),
    mtd: { start: mtdStart, revenue: Math.round(mtdRevenue * 100) / 100 },
    exceptions: exceptionCount,
    cashPosition,
    agentActivity: Object.entries(activityByAgent).map(([agent, v]) => ({
      agent,
      count: v.count,
      amount: Math.round(v.amount * 100) / 100,
    })),
    recentPosts: recentPosts ?? [],
  });
}
