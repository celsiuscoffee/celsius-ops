"use client";

// Daily cash run-rate — the honest "how much moves per day" figure.
//
// The settlement panel forecasts a NARROW, forward number (net sales
// settlements, mostly projected), so its per-day figure reads well below the
// ~RM10.6k/day the owner knows from the bank. That gap is real and expected —
// but the owner still wants the true daily run-rate on the same page. This
// reads it straight from actual bank flows over a trailing window, external
// only (inter-entity transfers excluded), and splits weekday vs weekend so the
// pattern is visible: weekdays land the big supplier/payroll/rent outflows and
// run cash-negative; weekends are low-sales but almost outflow-free and run
// cash-positive.

import { useFetch } from "@/lib/use-fetch";
import { Loader2, Gauge, TrendingUp, TrendingDown } from "lucide-react";

type Leg = { avgIn: number; avgOut: number; avgNet: number; days: number };
type RunRate = {
  daysBack: number;
  from: string;
  to: string;
  account: string | null;
  accountLabel: string | null;
  overall: Leg;
  weekday: Leg;
  weekend: Leg;
};

const RM0 = (n: number) => `RM${Math.round(n).toLocaleString("en-MY")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${RM0(Math.abs(n))}`;

export default function DailyRunRateStrip({ account }: { account?: string }) {
  const query = account ? `?account=${account}` : "";
  const { data, isLoading } = useFetch<{ runRate: RunRate }>(`/api/finance/cashflow/daily-averages${query}`);
  const r = data?.runRate;

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <Gauge className="h-4 w-4 text-brand-text" />
            Daily cash run-rate
          </h3>
          <p className="mt-0.5 text-xs text-text-2">
            Actual bank flows averaged per calendar day{r ? ` over the last ${r.daysBack} days` : ""}, inter-company
            transfers excluded. {r?.accountLabel ? `${r.accountLabel} only.` : "All accounts."}
          </p>
        </div>
      </div>

      {isLoading || !r ? (
        <div className="py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-text-3" /></div>
      ) : (
        <>
          {/* Headline: the three per-day numbers. Cash in is the ~RM10.6k the
              owner reads off the bank; net is the true daily cash generation. */}
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-lg bg-ok-soft px-3 py-2">
              <p className="text-[11px] text-ok-text">Average cash in a day</p>
              <p className="mt-0.5 text-xl font-bold text-ok-text">{RM0(r.overall.avgIn)}</p>
            </div>
            <div className="rounded-lg bg-danger-soft px-3 py-2">
              <p className="text-[11px] text-danger-text">Average cash out a day</p>
              <p className="mt-0.5 text-xl font-bold text-danger-text">{RM0(r.overall.avgOut)}</p>
            </div>
            <div className={`rounded-lg px-3 py-2 ${r.overall.avgNet >= 0 ? "bg-ok-soft" : "bg-warn-soft"}`}>
              <p className={`flex items-center gap-1 text-[11px] ${r.overall.avgNet >= 0 ? "text-ok-text" : "text-warn-text"}`}>
                {r.overall.avgNet >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                Average net a day
              </p>
              <p className={`mt-0.5 text-xl font-bold ${r.overall.avgNet >= 0 ? "text-ok-text" : "text-warn-text"}`}>
                {signed(r.overall.avgNet)}
              </p>
            </div>
          </div>

          {/* Weekday vs weekend — where cash is actually made vs spent. */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {([
              { label: "Weekday", leg: r.weekday },
              { label: "Weekend", leg: r.weekend },
            ] as const).map(({ label, leg }) => (
              <div key={label} className="rounded-lg border border-line bg-sunken/60 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-2">{label}</span>
                  <span className={`text-xs font-semibold ${leg.avgNet >= 0 ? "text-ok-text" : "text-danger-text"}`}>
                    net {signed(leg.avgNet)}/day
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-text-2">
                  <span>in <span className="font-medium text-ok-text">{RM0(leg.avgIn)}</span></span>
                  <span>out <span className="font-medium text-danger-text">{RM0(leg.avgOut)}</span></span>
                  <span className="ml-auto text-text-3">{leg.days}d</span>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-2 text-[10px] leading-relaxed text-text-3">
            Weekdays carry the big supplier, payroll and rent outflows, so they run cash-negative; weekends are
            low-sales but almost outflow-free, so they run cash-positive. This is the real bank run-rate — broader than
            the settlement forecast above, which counts only sales channels.
          </p>
        </>
      )}
    </div>
  );
}
