"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, CheckCircle2, AlertTriangle, HelpCircle, Copy, ArrowDownCircle } from "lucide-react";

type ApMatch = {
  invoiceId: string; invoiceNumber: string | null; payee: string; amount: number; issueDate: string;
  bankLineId: string; bankDesc: string; bankDate: string; bankCategory: string | null;
  score: number; tier: "auto" | "review"; reasons: string[]; alreadyPaid: boolean;
};
type CashIn = {
  from: string; to: string; salesGross: number; settlementsTotal: number; gap: number; gapPct: number | null;
  settlementsByChannel: { channel: string; amount: number; n: number }[];
  salesByChannel: { channel: string; amount: number }[];
  grab: { gross: number; settled: number; deductionPct: number | null };
};
type ReconData = {
  summary: { auto: number; review: number; doublePayments: number; unmatchedInvoices: number; unmatchedOutflows: number; unmatchedOutflowValue: number };
  auto: ApMatch[]; review: ApMatch[]; doublePayments: ApMatch[];
  unmatchedInvoices: { invoiceId: string; invoiceNumber: string | null; payee: string; amount: number; issueDate: string }[];
  unmatchedOutflows: { bankLineId: string; desc: string; date: string; amount: number; category: string | null }[];
  cashIn: CashIn;
};

const fmtRM = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtRM0 = (n: number) => `RM ${n.toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;

export default function ReconPage() {
  const [days, setDays] = useState(90);
  const { data, isLoading } = useFetch<ReconData>(`/api/finance/ap-match?sinceDays=${days}`);

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Reconciliation</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
            Cash-out: bank payments matched to procurement invoices. Read-only preview — the loop auto-applies high-confidence matches; the rest is your queue.
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
          {[30, 90, 180].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${days === d ? "bg-terracotta text-white" : "text-gray-600 hover:bg-gray-50"}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="mt-6 flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
            <Tile icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} label="Auto-matched" value={data.summary.auto} tone="green" />
            <Tile icon={<HelpCircle className="h-4 w-4 text-amber-600" />} label="Needs review" value={data.summary.review} tone="amber" />
            <Tile icon={<Copy className="h-4 w-4 text-red-600" />} label="Double payments" value={data.summary.doublePayments} tone={data.summary.doublePayments ? "red" : "gray"} />
            <Tile icon={<ArrowDownCircle className="h-4 w-4 text-gray-500" />} label="Unmatched out" value={data.summary.unmatchedOutflows} sub={fmtRM0(data.summary.unmatchedOutflowValue)} tone="gray" />
            <Tile icon={<AlertTriangle className="h-4 w-4 text-gray-500" />} label="Open invoices, no payment" value={data.summary.unmatchedInvoices} tone="gray" />
          </div>

          {/* CASH-IN: sales rung up vs settlements received */}
          <Section title={`Cash-in — sales vs settlements (${data.cashIn.from} → ${data.cashIn.to})`} desc="What the POS rang up vs what landed in the bank. The gap is fees + platform commission + cash-not-banked + settlement timing.">
            <div className="grid grid-cols-3 gap-3 px-4 py-3">
              <div><p className="text-[11px] text-gray-500">Sales rung up</p><p className="font-mono text-sm font-semibold text-gray-900">{fmtRM(data.cashIn.salesGross)}</p></div>
              <div><p className="text-[11px] text-gray-500">Settled to bank</p><p className="font-mono text-sm font-semibold text-gray-900">{fmtRM(data.cashIn.settlementsTotal)}</p></div>
              <div><p className="text-[11px] text-gray-500">Gap</p><p className={`font-mono text-sm font-semibold ${Math.abs(data.cashIn.gapPct ?? 0) > 12 ? "text-red-600" : "text-amber-600"}`}>{fmtRM(data.cashIn.gap)}{data.cashIn.gapPct != null && <span className="text-[11px] font-normal text-gray-400"> ({data.cashIn.gapPct}%)</span>}</p></div>
            </div>
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full min-w-[480px] text-sm">
                <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium">Channel</th><th className="px-3 py-2 text-right font-medium">Settled</th><th className="px-3 py-2 text-right font-medium">Txns</th>
                </tr></thead>
                <tbody className="divide-y">
                  {data.cashIn.settlementsByChannel.map((c) => (
                    <tr key={c.channel} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-xs text-gray-700">{c.channel}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-green-700">+{fmtRM(c.amount)}</td>
                      <td className="px-3 py-1.5 text-right text-[11px] text-gray-400">{c.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.cashIn.grab.deductionPct != null && (
              <p className={`border-t border-gray-100 px-4 py-2 text-[11px] ${data.cashIn.grab.deductionPct > 45 ? "text-red-600" : "text-gray-500"}`}>
                Grab: gross {fmtRM(data.cashIn.grab.gross)} vs settled {fmtRM(data.cashIn.grab.settled)} → <strong>{data.cashIn.grab.deductionPct}% deducted</strong> at source (commission + promos + timing){data.cashIn.grab.deductionPct > 45 ? " — high, review" : ""}.
              </p>
            )}
          </Section>

          {data.doublePayments.length > 0 && (
            <Section title="⚠ Possible double payments" desc="Invoice already settled but another bank payment matches it.">
              <MatchTable rows={data.doublePayments} />
            </Section>
          )}

          <Section title="Auto-matched (high confidence)" desc="Amount-exact + payee name + date. The loop clears these and re-tags the bank line to COGS.">
            <MatchTable rows={data.auto} />
          </Section>

          <Section title="Needs review" desc="Likely matches that aren't certain enough to auto-clear — confirm or reject.">
            <MatchTable rows={data.review} showReasons />
          </Section>

          <Section title="Unmatched outflows — unreconciled cash-out" desc="Bank payments with no matching invoice yet. The pile to drive to zero.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr></thead>
                <tbody className="divide-y">
                  {data.unmatchedOutflows.slice(0, 100).map((o) => (
                    <tr key={o.bankLineId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{o.date}</td>
                      <td className="px-3 py-2 text-xs text-gray-700">{o.desc}</td>
                      <td className="px-3 py-2 text-[11px] text-gray-400">{o.category ?? "Unclassified"}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-red-700">−{fmtRM(o.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.unmatchedOutflows.length > 100 && <p className="px-3 py-2 text-[11px] text-gray-400">Showing top 100 of {data.unmatchedOutflows.length} by amount.</p>}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Tile({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone: "green" | "amber" | "red" | "gray" }) {
  const ring = tone === "green" ? "border-green-200" : tone === "amber" ? "border-amber-200" : tone === "red" ? "border-red-200" : "border-gray-200";
  return (
    <div className={`rounded-lg border ${ring} bg-white px-3 py-2.5`}>
      <div className="flex items-center gap-1.5 text-xs text-gray-500">{icon}{label}</div>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        <p className="mt-0.5 text-[11px] text-gray-400">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function MatchTable({ rows, showReasons }: { rows: ApMatch[]; showReasons?: boolean }) {
  if (rows.length === 0) return <p className="px-4 py-4 text-xs text-gray-400">Nothing here.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
          <th className="px-3 py-2 font-medium">Invoice payee</th><th className="px-3 py-2 text-right font-medium">Amount</th>
          <th className="px-3 py-2 font-medium">Bank line</th><th className="px-3 py-2 font-medium">Category</th>
          <th className="px-3 py-2 text-right font-medium">Score</th>{showReasons && <th className="px-3 py-2 font-medium">Why</th>}
        </tr></thead>
        <tbody className="divide-y">
          {rows.map((m) => (
            <tr key={m.invoiceId + m.bankLineId} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-xs text-gray-700">{m.payee}{m.invoiceNumber ? <span className="text-gray-400"> · {m.invoiceNumber}</span> : ""}<div className="text-[10px] text-gray-400">{m.issueDate}</div></td>
              <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{fmtRM(m.amount)}</td>
              <td className="px-3 py-2 text-xs text-gray-600">{m.bankDesc}<div className="text-[10px] text-gray-400">{m.bankDate}</div></td>
              <td className="px-3 py-2 text-[11px] text-gray-400">{m.bankCategory ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-xs"><span className={m.score >= 0.85 ? "text-green-700" : "text-amber-700"}>{m.score.toFixed(2)}</span></td>
              {showReasons && <td className="px-3 py-2 text-[10px] text-gray-400">{m.reasons.join(", ")}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
