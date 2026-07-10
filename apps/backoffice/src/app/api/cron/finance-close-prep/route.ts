// Day-1 cron — prepares the month-end close for the month that just ended.
//
// Runs the close-readiness checklist (close-prep) for every legal entity and
// tells the owner on Telegram what is green and what blocks the close, with
// the management-fee accrual each subsidiary owes HQ. It NEVER closes or
// posts anything — closing is a human decision on /finance/compliance
// (spec: the Close agent is manual-approve, never auto-close).
//
// Schedule: 22:30 UTC on the 1st = 6:30am MYT, after the 4am finance-eod has
// ingested the final day of the month.

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSession } from "@/lib/auth";
import { listCompanies } from "@/lib/finance/companies";
import { prepareClose, type ClosePrep } from "@/lib/finance/close-prep";
import { sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function lastMonth(): string {
  const d = new Date(Date.now() + 8 * 3600_000); // MYT
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const rm = (n: number) => `RM ${Math.round(n).toLocaleString("en-MY")}`;

function summarise(period: string, preps: ClosePrep[]): string {
  const lines: string[] = [`<b>Month-end close — ${period}</b>`];
  for (const p of preps) {
    const failing = p.checks.filter((c) => !c.ok);
    const head = p.status === "closed" ? "🔒" : p.ready ? "✅" : "⚠️";
    lines.push(`\n${head} <b>${p.companyName}</b>${p.status === "closed" ? " (closed)" : p.ready ? " — ready to close" : ""}`);
    for (const c of failing) lines.push(`  ✗ ${c.label}: ${c.detail}`);
    if (p.mgmtFee.applicable) {
      lines.push(
        p.mgmtFee.shortfall > 0
          ? `  Mgmt fee 6.8%: ${rm(p.mgmtFee.accrued)} on ${rm(p.mgmtFee.revenue)} — paid ${rm(p.mgmtFee.paid)}, accrue ${rm(p.mgmtFee.shortfall)} to HQ`
          : `  Mgmt fee 6.8%: settled (${rm(p.mgmtFee.paid)} paid)`,
      );
    }
    if (p.depreciationPreview > 0) lines.push(`  Depreciation: ${rm(p.depreciationPreview)}`);
  }
  lines.push(`\nReview and close: backoffice.celsiuscoffee.com/finance/compliance`);
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getSession();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
    }
  }

  const period = req.nextUrl.searchParams.get("period") ?? lastMonth();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }

  try {
    const companies = await listCompanies();
    const preps = await Promise.all(companies.map((c) => prepareClose(c.id, c.name, period)));

    let delivered = false;
    const chatRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
    const chatId = chatRaw ? parseInt(chatRaw, 10) : NaN;
    if (!Number.isNaN(chatId)) {
      const res = await sendMessage(chatId, summarise(period, preps));
      delivered = res.ok;
    } else {
      console.warn("[finance-close-prep] TELEGRAM_OWNER_CHAT_ID not configured — skipping delivery");
    }

    return NextResponse.json({
      period,
      delivered,
      companies: preps.map((p) => ({
        companyId: p.companyId,
        ready: p.ready,
        status: p.status,
        failing: p.checks.filter((c) => !c.ok).map((c) => c.key),
        mgmtFeeShortfall: p.mgmtFee.shortfall,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
