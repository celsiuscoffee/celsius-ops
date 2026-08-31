import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

// Recruitment ad claims (Indeed).
//
// Indeed bills the director's card and he reimburses himself later — lagging
// 1-4 months, so the bank month is a bad proxy for when the spend happened.
// This route reports by INVOICE, splits each one into Celsius vs third-party
// spend (the Indeed account also carries Gosame International's jobs, which is
// recoverable, not a Celsius cost), and shows what is still unreimbursed.
type ItemRow = {
  invoice_id: string; company_name: string; is_celsius: boolean;
  job_title: string | null; location: string | null;
  quantity: number | null; average_cost: number | null; amount_usd: number | string;
};
type InvoiceRow = {
  id: string; invoice_number: string | null; issue_date: string;
  period_start: string; period_end: string;
  amount_usd: number | string; amount_myr: number | string | null;
  status: string; notes: string | null;
  claimed_at: string | null; reimbursed_at: string | null;
  bank_line_id: string | null; fx_rate: number | string | null;
};

const num = (v: number | string | null | undefined) => (v == null ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getFinanceClient("recruitment-claims");
  const [{ data: invoices, error: invErr }, { data: items, error: itemErr }] = await Promise.all([
    client.from("indeed_ads_invoice").select("*").order("issue_date", { ascending: false }),
    client.from("indeed_ads_invoice_item").select("*"),
  ]);
  if (invErr || itemErr) {
    return NextResponse.json({ error: invErr?.message ?? itemErr?.message }, { status: 500 });
  }

  const byInvoice = new Map<string, ItemRow[]>();
  for (const it of (items ?? []) as ItemRow[]) {
    const list = byInvoice.get(it.invoice_id);
    if (list) list.push(it); else byInvoice.set(it.invoice_id, [it]);
  }

  const rows = ((invoices ?? []) as InvoiceRow[]).map((inv) => {
    const its = byInvoice.get(inv.id) ?? [];
    const netUsd = its.reduce((s, i) => s + num(i.amount_usd), 0);
    const otherUsd = its.filter((i) => !i.is_celsius).reduce((s, i) => s + num(i.amount_usd), 0);
    // Tax rides on the whole invoice, so a third party's share of it is their
    // share of the net. Fall back to the invoice total when items are missing.
    const share = netUsd > 0 ? otherUsd / netUsd : 0;
    const totalUsd = num(inv.amount_usd);
    // Only a reimbursed invoice has a real rate; leave MYR null otherwise
    // rather than inventing one from a reference rate.
    const fx = num(inv.fx_rate) || null;
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      issueDate: inv.issue_date,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      totalUsd: round2(totalUsd),
      totalMyr: inv.amount_myr != null ? round2(num(inv.amount_myr)) : null,
      fxRate: fx,
      celsiusUsd: round2(totalUsd * (1 - share)),
      otherPartyUsd: round2(totalUsd * share),
      otherParties: [...new Set(its.filter((i) => !i.is_celsius).map((i) => i.company_name))],
      status: inv.status,
      reimbursedAt: inv.reimbursed_at,
      bankLineId: inv.bank_line_id,
      lagDays: inv.reimbursed_at
        ? Math.round((Date.parse(inv.reimbursed_at) - Date.parse(inv.issue_date)) / 86_400_000)
        : null,
      notes: inv.notes,
      items: its
        .slice()
        .sort((a, b) => num(b.amount_usd) - num(a.amount_usd))
        .map((i) => ({
          company: i.company_name, isCelsius: i.is_celsius,
          jobTitle: i.job_title, location: i.location,
          clicks: i.quantity, avgCost: num(i.average_cost), amountUsd: round2(num(i.amount_usd)),
        })),
    };
  });

  const outstanding = rows.filter((r) => r.status !== "paid");
  const summary = {
    invoices: rows.length,
    totalUsd: round2(rows.reduce((s, r) => s + r.totalUsd, 0)),
    celsiusUsd: round2(rows.reduce((s, r) => s + r.celsiusUsd, 0)),
    recoverableUsd: round2(rows.reduce((s, r) => s + r.otherPartyUsd, 0)),
    reimbursedMyr: round2(rows.reduce((s, r) => s + (r.totalMyr ?? 0), 0)),
    outstandingCount: outstanding.length,
    outstandingUsd: round2(outstanding.reduce((s, r) => s + r.totalUsd, 0)),
    avgLagDays: (() => {
      const lags = rows.map((r) => r.lagDays).filter((n): n is number => n != null);
      return lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length) : null;
    })(),
  };

  return NextResponse.json({ summary, invoices: rows });
}
