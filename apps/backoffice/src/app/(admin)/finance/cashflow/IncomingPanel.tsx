"use client";

// Incoming settlements — what cash actually lands, and when.
//
// Revenue rung today is cash on very different days depending on how it was
// paid: QR is same-day, Maybank card is next business day, Shah Alam's NTT card
// runs ~2 business days behind, Revenue Monster pays Fri+Sat+Sun as ONE Tuesday
// batch, and GastroHub settles a whole week on the following Tuesday. That makes
// Mondays and Tuesdays the big cash days and weekends QR-only — a rhythm you
// cannot see from a sales chart. This panel reads the settlement calendar
// straight from lib/finance/settlement-forecast so the day-by-day cash is
// answerable at a glance instead of by hand.

import { useMemo, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, ArrowDownToLine } from "lucide-react";
import { DateRangePicker } from "@/components/date-range-picker";

type Channel = "online" | "card" | "qr" | "consignment" | "grab";

type Forecast = {
  from: string;
  to: string;
  byDate: { date: string; net: number; booked: number; projected: number; byChannel: Partial<Record<Channel, number>> }[];
  byEntity: { entity: string; account: string; net: number }[];
  total: number;
  bookedTotal: number;
  projectedTotal: number;
  discounts: { total: number; grossSales: number; pct: number; from: string; to: string };
  reconcile: { grabPerDay: number; otherPerDay: number; otherWindowTotal: number; trailingDays: number };
};

const ENTITY_LABEL: Record<string, string> = {
  celsius: "Shah Alam + Nilai",
  celsiusconezion: "Putrajaya",
  celsiustamarind: "Cyberjaya",
};
const CHANNEL_LABEL: Record<Channel, string> = { online: "Online", card: "Card", qr: "QR", consignment: "Consignment", grab: "Grab" };
const CHANNEL_ORDER: Channel[] = ["card", "online", "qr", "consignment", "grab"];
const CHANNEL_DOT: Record<Channel, string> = {
  card: "bg-blue-500", online: "bg-violet-500", qr: "bg-emerald-500", consignment: "bg-amber-500", grab: "bg-green-600",
};

const RM0 = (n: number) => `RM${Math.round(n).toLocaleString("en-MY")}`;
function todayMytStr() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
function addDaysStr(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dayLabel(d: string, todayStr: string): { dow: string; date: string; isToday: boolean } {
  const dt = new Date(`${d}T00:00:00Z`);
  return {
    dow: DOW[dt.getUTCDay()],
    date: `${dt.getUTCDate()} ${dt.toLocaleString("en-MY", { month: "short", timeZone: "UTC" })}`,
    isToday: d === todayStr,
  };
}

export default function IncomingPanel() {
  // Window: a day-count preset from today, or a custom [from, to] range.
  const [days, setDays] = useState(7);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const query = custom ? `from=${custom.from}&to=${custom.to}` : `days=${days}`;
  const { data, isLoading } = useFetch<{ forecast: Forecast }>(`/api/finance/cashflow/incoming?${query}`);
  const f = data?.forecast;

  // Scale bars against the biggest day so the weekly rhythm is visible.
  const maxNet = useMemo(() => (f ? Math.max(...f.byDate.map((d) => d.net), 1) : 1), [f]);
  const todayStr = todayMytStr();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
            Incoming settlements
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Cash landing per day on each channel&apos;s real settlement calendar. Weekends are QR-only; Mon/Tue carry the card and Revenue Monster batches.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-gray-200 p-0.5">
            {[7, 14, 28].map((d) => (
              <button
                key={d}
                onClick={() => { setDays(d); setCustom(null); }}
                className={`rounded px-2 py-1 text-xs ${!custom && days === d ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <DateRangePicker
            start={custom?.from ?? todayStr}
            end={custom?.to ?? addDaysStr(todayStr, days - 1)}
            onChange={(s, e) => setCustom({ from: s, to: e })}
            size="xs"
          />
        </div>
      </div>

      {isLoading || !f ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" /></div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[11px] text-gray-500">
                Expected {custom ? `${dayLabel(custom.from, todayStr).date} – ${dayLabel(custom.to, todayStr).date}` : `in ${days}d`}
              </p>
              <p className="mt-0.5 text-lg font-bold text-gray-900">{RM0(f.total)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 px-3 py-2">
              <p className="text-[11px] text-emerald-700">Booked</p>
              <p className="mt-0.5 text-lg font-bold text-emerald-700">{RM0(f.bookedTotal)}</p>
              <p className="text-[10px] text-emerald-600/70">already rung, awaiting settlement</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[11px] text-gray-500">Projected</p>
              <p className="mt-0.5 text-lg font-bold text-gray-500">{RM0(f.projectedTotal)}</p>
              <p className="text-[10px] text-gray-400">future sales at run-rate</p>
            </div>
          </div>

          {/* Discounts given over the trailing window of the same length. The
              settlement figures above are already net of discount — this shows
              how much revenue was given away to bring it in. */}
          <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-1.5">
            <p className="text-[11px] text-amber-700">
              Discounts given <span className="text-amber-600/70">(prior {f.discounts.from === f.discounts.to ? "day" : "period"})</span>
            </p>
            <p className="text-sm font-semibold text-amber-700">
              {RM0(f.discounts.total)} <span className="text-[11px] font-normal text-amber-600/70">· {f.discounts.pct}% of gross</span>
            </p>
          </div>

          <div className="mt-3 space-y-1">
            {f.byDate.map((d) => {
              const l = dayLabel(d.date, todayStr);
              const bookedPct = d.net > 0 ? (d.booked / d.net) * 100 : 0;
              return (
                <div key={d.date} className="rounded-md px-1.5 py-1 hover:bg-gray-50">
                  <div className="flex items-center gap-2">
                    <div className="w-20 shrink-0 text-xs">
                      <span className={`font-medium ${l.isToday ? "text-emerald-700" : "text-gray-700"}`}>{l.dow}</span>{" "}
                      <span className="text-gray-400">{l.date}</span>
                    </div>
                    <div className="relative h-4 flex-1 overflow-hidden rounded bg-gray-100">
                      <div className="absolute inset-y-0 left-0 bg-emerald-500/80" style={{ width: `${(d.net / maxNet) * bookedPct}%` }} />
                      <div
                        className="absolute inset-y-0 bg-gray-300"
                        style={{ left: `${(d.net / maxNet) * bookedPct}%`, width: `${(d.net / maxNet) * (100 - bookedPct)}%` }}
                      />
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-900">{RM0(d.net)}</div>
                  </div>
                  {/* Channel split on its own line so short bars never clip it. */}
                  <div className="ml-20 flex flex-wrap gap-x-3 gap-y-0.5 pl-2 pt-0.5">
                    {CHANNEL_ORDER.filter((c) => (d.byChannel[c] ?? 0) > 0).map((c) => (
                      <span key={c} className="flex items-center gap-1 text-[10px] text-gray-500">
                        <span className={`h-1.5 w-1.5 rounded-full ${CHANNEL_DOT[c]}`} />
                        {CHANNEL_LABEL[c]} <span className="tabular-nums text-gray-700">{RM0(d.byChannel[c]!)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-emerald-500/80" /> booked</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-gray-300" /> projected</span>
            {f.byEntity.map((e) => (
              <span key={e.entity} className="ml-auto sm:ml-0">
                {ENTITY_LABEL[e.entity] ?? e.entity} <span className="text-gray-400">({e.account})</span>{" "}
                <span className="font-medium text-gray-700">{RM0(e.net)}</span>
              </span>
            ))}
          </div>

          {/* Reconciliation to the "Avg cash in" KPI, which counts every
              non-inter-company bank credit. Grab is now folded into the forecast
              above (bank run-rate, ~RM{grabPerDay}/day, lands in HQ 4384). Only
              this residual — meetings/events, refunds, misc — is left out. */}
          <p className="mt-1.5 text-[10px] leading-relaxed text-gray-400">
            Grab is included above at its trailing bank run-rate ({RM0(f.reconcile.grabPerDay)}/day, pools into HQ 4384).
            {f.reconcile.otherPerDay > 0 && (
              <> A further ~{RM0(f.reconcile.otherPerDay)}/day of non-sales credits (meetings, refunds, misc) hits the bank but isn&apos;t forecast here — that&apos;s the gap between this panel and total &ldquo;Avg cash in&rdquo;.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}
