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
  card: "bg-info", online: "bg-info", qr: "bg-ok", consignment: "bg-warn", grab: "bg-ok",
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
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <ArrowDownToLine className="h-4 w-4 text-ok-text" />
            Incoming settlements
          </h3>
          <p className="mt-0.5 text-xs text-text-2">
            Cash landing per day on each channel&apos;s real settlement calendar. Weekends are QR-only; Mon/Tue carry the card and Revenue Monster batches.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-line p-0.5">
            {[7, 14, 28].map((d) => (
              <button
                key={d}
                onClick={() => { setDays(d); setCustom(null); }}
                className={`rounded px-2 py-1 text-xs ${!custom && days === d ? "bg-ink text-on-ink" : "text-text-2 hover:bg-sunken"}`}
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
        <div className="py-10 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-text-3" /></div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            <div className="rounded-lg bg-sunken px-3 py-2">
              <p className="text-[11px] text-text-2">
                Expected {custom ? `${dayLabel(custom.from, todayStr).date} – ${dayLabel(custom.to, todayStr).date}` : `in ${days}d`}
              </p>
              <p className="mt-0.5 text-lg font-bold text-text">{RM0(f.total)}</p>
            </div>
            <div className="rounded-lg bg-ok-soft px-3 py-2">
              <p className="text-[11px] text-ok-text">Booked</p>
              <p className="mt-0.5 text-lg font-bold text-ok-text">{RM0(f.bookedTotal)}</p>
              <p className="text-[10px] text-ok-text">already rung, awaiting settlement</p>
            </div>
            <div className="rounded-lg bg-sunken px-3 py-2">
              <p className="text-[11px] text-text-2">Projected</p>
              <p className="mt-0.5 text-lg font-bold text-text-2">{RM0(f.projectedTotal)}</p>
              <p className="text-[10px] text-text-3">future sales at run-rate</p>
            </div>
          </div>

          {/* Discounts given over the trailing window of the same length. The
              settlement figures above are already net of discount — this shows
              how much revenue was given away to bring it in. */}
          <div className="mt-2 flex items-center justify-between rounded-lg bg-warn-soft px-3 py-1.5">
            <p className="text-[11px] text-warn-text">
              Discounts given <span className="text-warn-text">(prior {f.discounts.from === f.discounts.to ? "day" : "period"})</span>
            </p>
            <p className="text-sm font-semibold text-warn-text">
              {RM0(f.discounts.total)} <span className="text-[11px] font-normal text-warn-text">· {f.discounts.pct}% of gross</span>
            </p>
          </div>

          <div className="mt-3 space-y-1">
            {f.byDate.map((d) => {
              const l = dayLabel(d.date, todayStr);
              const bookedPct = d.net > 0 ? (d.booked / d.net) * 100 : 0;
              return (
                <div key={d.date} className="rounded-md px-1.5 py-1 hover:bg-sunken">
                  <div className="flex items-center gap-2">
                    <div className="w-20 shrink-0 text-xs">
                      <span className={`font-medium ${l.isToday ? "text-ok-text" : "text-text-2"}`}>{l.dow}</span>{" "}
                      <span className="text-text-3">{l.date}</span>
                    </div>
                    <div className="relative h-4 flex-1 overflow-hidden rounded bg-sunken">
                      <div className="absolute inset-y-0 left-0 bg-ok/80" style={{ width: `${(d.net / maxNet) * bookedPct}%` }} />
                      <div
                        className="absolute inset-y-0 bg-line"
                        style={{ left: `${(d.net / maxNet) * bookedPct}%`, width: `${(d.net / maxNet) * (100 - bookedPct)}%` }}
                      />
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-text">{RM0(d.net)}</div>
                  </div>
                  {/* Channel split on its own line so short bars never clip it. */}
                  <div className="ml-20 flex flex-wrap gap-x-3 gap-y-0.5 pl-2 pt-0.5">
                    {CHANNEL_ORDER.filter((c) => (d.byChannel[c] ?? 0) > 0).map((c) => (
                      <span key={c} className="flex items-center gap-1 text-[10px] text-text-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${CHANNEL_DOT[c]}`} />
                        {CHANNEL_LABEL[c]} <span className="tabular-nums text-text-2">{RM0(d.byChannel[c]!)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-[11px] text-text-2">
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-ok/80" /> booked</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-line" /> projected</span>
            {f.byEntity.map((e) => (
              <span key={e.entity} className="ml-auto sm:ml-0">
                {ENTITY_LABEL[e.entity] ?? e.entity} <span className="text-text-3">({e.account})</span>{" "}
                <span className="font-medium text-text-2">{RM0(e.net)}</span>
              </span>
            ))}
          </div>

          {/* Reconciliation to the "Avg cash in" KPI, which counts every
              non-inter-company bank credit. Grab is now folded into the forecast
              above (bank run-rate, ~RM{grabPerDay}/day, lands in HQ 4384). Only
              this residual — meetings/events, refunds, misc — is left out. */}
          <p className="mt-1.5 text-[10px] leading-relaxed text-text-3">
            Grab is included above at its trailing bank run-rate ({RM0(f.reconcile.grabPerDay)}/day, pools into HQ 4384).
            {f.reconcile.otherPerDay > 0 && (
              <> A further ~{RM0(f.reconcile.otherPerDay)}/day of non-sales credits (meetings, refunds, misc) hits the bank but isn&apos;t forecast here — that&apos;s the gap between this panel and &ldquo;Average cash in&rdquo;.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}
