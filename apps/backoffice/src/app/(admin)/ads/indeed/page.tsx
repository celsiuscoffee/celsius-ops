"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Card } from "@/components/ui/card";
import { Loader2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

type Item = {
  company: string; isCelsius: boolean;
  jobTitle: string | null; location: string | null;
  clicks: number | null; avgCost: number; amountUsd: number;
};
type Invoice = {
  id: string; invoiceNumber: string | null; issueDate: string;
  periodStart: string; periodEnd: string;
  totalUsd: number; totalMyr: number | null; fxRate: number | null;
  celsiusUsd: number; otherPartyUsd: number; otherParties: string[];
  status: string; reimbursedAt: string | null; bankLineId: string | null;
  lagDays: number | null; notes: string | null; items: Item[];
};
type Data = {
  summary: {
    invoices: number; totalUsd: number; celsiusUsd: number; recoverableUsd: number;
    reimbursedMyr: number; outstandingCount: number; outstandingUsd: number;
    avgLagDays: number | null;
  };
  invoices: Invoice[];
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const myr = (n: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);
const day = (s: string) =>
  new Date(s + (s.length === 10 ? "T00:00:00Z" : "")).toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });

export default function RecruitmentAdsPage() {
  const { data, isLoading, error } = useFetch<Data>("/api/ads/indeed");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading recruitment claims…
      </div>
    );
  }
  if (error || !data) {
    return <div className="p-6 text-sm text-destructive">Could not load recruitment claims.</div>;
  }

  const s = data.summary;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Recruitment Ads</h1>
        <p className="text-sm text-muted-foreground">
          Indeed job-board spend, by invoice. Billed to the director&apos;s card and reimbursed
          later — the bank month is not the spend month, so track it here.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Invoiced</div>
          <div className="mt-1 text-2xl font-semibold">{usd(s.totalUsd)}</div>
          <div className="text-xs text-muted-foreground">{s.invoices} invoices</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Celsius spend</div>
          <div className="mt-1 text-2xl font-semibold">{usd(s.celsiusUsd)}</div>
          <div className="text-xs text-muted-foreground">the real hiring cost</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Recoverable</div>
          <div className="mt-1 text-2xl font-semibold text-amber-600">{usd(s.recoverableUsd)}</div>
          <div className="text-xs text-muted-foreground">other companies&apos; jobs</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Unreimbursed</div>
          <div className="mt-1 text-2xl font-semibold">{usd(s.outstandingUsd)}</div>
          <div className="text-xs text-muted-foreground">
            {s.outstandingCount} invoice{s.outstandingCount === 1 ? "" : "s"}
            {s.avgLagDays != null ? ` · ${s.avgLagDays}d average lag` : ""}
          </div>
        </Card>
      </div>

      {s.recoverableUsd > 0 && (
        <Card className="flex items-start gap-3 border-amber-500/40 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-sm">
            <span className="font-medium">{usd(s.recoverableUsd)} of this spend is not Celsius&apos;s.</span>{" "}
            Another company&apos;s job ads are billed to the same Indeed account. Recover it or
            book it as a receivable — it should not sit in the hiring cost.
          </div>
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Invoice</th>
              <th className="p-3 font-medium">Issued</th>
              <th className="p-3 text-right font-medium">Total</th>
              <th className="p-3 text-right font-medium">Celsius</th>
              <th className="p-3 text-right font-medium">Other</th>
              <th className="p-3 text-right font-medium">Reimbursed</th>
              <th className="p-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((inv) => {
              const isOpen = !!open[inv.id];
              return (
                <>
                  <tr
                    key={inv.id}
                    className="cursor-pointer border-b hover:bg-muted/40"
                    onClick={() => setOpen((o) => ({ ...o, [inv.id]: !o[inv.id] }))}
                  >
                    <td className="p-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {inv.invoiceNumber ?? inv.id}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground">{day(inv.issueDate)}</td>
                    <td className="p-3 text-right">{usd(inv.totalUsd)}</td>
                    <td className="p-3 text-right">{usd(inv.celsiusUsd)}</td>
                    <td className={`p-3 text-right ${inv.otherPartyUsd > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {inv.otherPartyUsd > 0 ? usd(inv.otherPartyUsd) : "—"}
                    </td>
                    <td className="p-3 text-right">
                      {inv.totalMyr != null ? (
                        <span title={inv.fxRate ? `@ ${inv.fxRate}` : undefined}>{myr(inv.totalMyr)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {inv.status === "paid" ? (
                        <span className="text-emerald-600">
                          Reimbursed{inv.lagDays != null ? ` · ${inv.lagDays}d` : ""}
                        </span>
                      ) : (
                        <span className="text-amber-600">Unclaimed</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${inv.id}-detail`} className="border-b bg-muted/20">
                      <td colSpan={7} className="p-3">
                        {inv.notes && <p className="mb-2 text-xs text-muted-foreground">{inv.notes}</p>}
                        <table className="w-full text-xs">
                          <thead className="text-left text-muted-foreground">
                            <tr>
                              <th className="py-1 font-medium">Company</th>
                              <th className="py-1 font-medium">Role</th>
                              <th className="py-1 font-medium">Location</th>
                              <th className="py-1 text-right font-medium">Clicks</th>
                              <th className="py-1 text-right font-medium">Avg CPC</th>
                              <th className="py-1 text-right font-medium">Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inv.items.map((it, i) => (
                              <tr key={i} className={it.isCelsius ? "" : "text-amber-600"}>
                                <td className="py-1">{it.company}</td>
                                <td className="py-1">{it.jobTitle ?? "—"}</td>
                                <td className="py-1">{it.location ?? "—"}</td>
                                <td className="py-1 text-right">{it.clicks ?? "—"}</td>
                                <td className="py-1 text-right">{usd(it.avgCost)}</td>
                                <td className="py-1 text-right">{usd(it.amountUsd)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
