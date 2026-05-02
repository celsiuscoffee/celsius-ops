// GET /api/finance/home
// Aggregates the "Business Feed"-style home cards: agent activity for the
// last 24h, MTD revenue by channel, exception counts, cash position per
// bank account.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { getActiveCompanyId } from "@/lib/finance/companies";

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
    .eq("status", "posted")
    .order("posted_at", { ascending: false })
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
        .filter((t) => t.status === "posted" && t.txn_date >= mtdStart && t.company_id === companyId)
        .map((t) => t.id)
    );
    for (const l of mtdLines) {
      if (!validTxnIds.has(l.transaction_id)) continue;
      mtdRevenue += Number(l.credit) - Number(l.debit);
    }
  }

  // Cash position per bank account: sum of (debit - credit) on 1000-* codes.
  const { data: bankLines } = await client
    .from("fin_journal_lines")
    .select("account_code, debit, credit, transaction_id")
    .like("account_code", "1000%");

  const cashByAccount: Record<string, number> = {};
  if (bankLines && bankLines.length) {
    const txnIds = Array.from(new Set(bankLines.map((l) => l.transaction_id)));
    const { data: txns } = await client
      .from("fin_transactions")
      .select("id, status, company_id")
      .in("id", txnIds);
    const valid = new Set(
      (txns ?? [])
        .filter((t) => t.status === "posted" && t.company_id === companyId)
        .map((t) => t.id)
    );
    for (const l of bankLines) {
      if (!valid.has(l.transaction_id)) continue;
      const code = l.account_code as string;
      cashByAccount[code] = (cashByAccount[code] ?? 0) + Number(l.debit) - Number(l.credit);
    }
  }

  // Account names for cash card display.
  const codes = Object.keys(cashByAccount);
  const { data: accounts } = codes.length
    ? await client.from("fin_accounts").select("code, name").in("code", codes)
    : { data: [] as { code: string; name: string }[] };
  const accountNames = new Map((accounts ?? []).map((a) => [a.code, a.name]));

  // Today's agent activity counts for the activity feed header.
  const { data: agentActivity } = await client
    .from("fin_transactions")
    .select("posted_by_agent, amount")
    .eq("company_id", companyId)
    .gte("txn_date", yesterday)
    .lte("txn_date", today)
    .eq("status", "posted");

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
    cashPosition: codes
      .map((code) => ({
        code,
        name: accountNames.get(code) ?? code,
        balance: Math.round(cashByAccount[code] * 100) / 100,
      }))
      .sort((a, b) => b.balance - a.balance),
    agentActivity: Object.entries(activityByAgent).map(([agent, v]) => ({
      agent,
      count: v.count,
      amount: Math.round(v.amount * 100) / 100,
    })),
    recentPosts: recentPosts ?? [],
  });
}
