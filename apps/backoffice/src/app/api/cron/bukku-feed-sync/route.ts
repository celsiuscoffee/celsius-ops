// Daily cron — pulls Bukku's raw Maybank feed for every connected company
// and rebuilds the live bank ledger forward from each account's last PDF
// closing balance. Idempotent + self-healing (see syncBukkuFeedLedger).
// Scheduled after Bukku's nightly bank-feed sync (~22:30 MYT).

import { NextRequest, NextResponse } from "next/server";
import { syncBukkuFeedLedger } from "@/lib/finance/bukku-feed-sync";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  try {
    const { accounts } = await syncBukkuFeedLedger({ commit: true });
    const summary = {
      accounts: accounts.length,
      committed: accounts.filter((a) => a.committed).length,
      newLines: accounts.reduce((s, a) => s + a.newLines, 0),
      skipped: accounts.filter((a) => a.skipped).map((a) => `${a.subdomain}/${a.accountTail}: ${a.skipped}`),
    };
    return NextResponse.json({ summary, accounts });
  } catch (err) {
    console.error("[cron/bukku-feed-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "feed sync failed" },
      { status: 500 },
    );
  }
}
