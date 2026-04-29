"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, ChevronLeft } from "lucide-react";

type Outlet = { id: string; code: string; name: string; isHQ: boolean };

type CashMatrix = {
  outlets: Outlet[];
  months: string[];
  cells: Record<string, number>;     // "category|outletId|YYYY-MM" → signed amount
  monthTotals: Record<string, number>;
  categoryMonthTotals: Record<string, Record<string, number>>;
  categories: string[];
};

// Friendly category labels — matches Finance's spreadsheet exactly so the
// page reads like the existing artefact.
const CATEGORY_LABELS: Record<string, string> = {
  CARD: "Card",
  QR: "QR (DuitNow)",
  STOREHUB: "StoreHub",
  GRAB: "Grab",
  GRAB_PUTRAJAYA: "Grab (Putrajaya)",
  FOODPANDA: "Foodpanda",
  MEETINGS_EVENTS: "Meetings & Events",
  GASTROHUB: "GastroHub",
  CAPITAL: "Capital injection",
  MANAGEMENT_FEE: "Management fee",
  ADTD: "AD/TD",
  OTHER_INFLOW: "Other inflow",
  RAW_MATERIALS: "Raw materials",
  DELIVERY: "Delivery",
  DIRECTORS_ALLOWANCE: "Directors' allowance",
  EMPLOYEE_SALARY: "Employee salary",
  PARTIMER: "Part-timers",
  STATUTORY_PAYMENT: "Statutory (EPF/SOCSO)",
  STAFF_CLAIM: "Staff claim",
  PETTY_CASH: "Petty cash",
  MARKETPLACE_FEE: "Marketplace fee",
  DIGITAL_ADS: "Digital ads",
  KOL: "KOL",
  OTHER_MARKETING: "Other marketing",
  RENT: "Rent",
  UTILITIES: "Utilities",
  SOFTWARE: "Software",
  CFS_FEE: "CFS fee",
  COMPLIANCE: "Compliance",
  TAX: "Tax",
  LICENSING_FEE: "Licensing fee",
  ROYALTY_FEE: "Royalty fee",
  LOAN: "Loan",
  BANK_FEE: "Bank fee",
  EQUIPMENTS: "Equipments",
  MAINTENANCE: "Maintenance",
  INVESTMENTS: "Investments",
  INTERCO_PEOPLE: "InterCo (people)",
  INTERCO_RAW_MATERIAL: "InterCo (raw mat)",
  INTERCO_INVESTMENTS: "InterCo (investments)",
  INTERCO_EXPENSES: "InterCo (expenses)",
  TRANSFER_NOT_SUCCESSFUL: "Transfer not successful",
  OTHER_OUTFLOW: "Other outflow",
};

// Category bands — used to group rows + insert subtotal rows so the
// matrix reads in the same shape as Finance's spreadsheet.
const BANDS: Array<{ label: string; categories: string[]; tone: "in" | "out" }> = [
  { label: "Inflows", tone: "in", categories: [
    "CARD", "QR", "STOREHUB", "GRAB", "GRAB_PUTRAJAYA", "FOODPANDA",
    "MEETINGS_EVENTS", "GASTROHUB", "CAPITAL", "MANAGEMENT_FEE", "ADTD", "OTHER_INFLOW",
  ]},
  { label: "COGS", tone: "out", categories: ["RAW_MATERIALS", "DELIVERY"] },
  { label: "Labour", tone: "out", categories: [
    "DIRECTORS_ALLOWANCE", "EMPLOYEE_SALARY", "PARTIMER", "STATUTORY_PAYMENT", "STAFF_CLAIM", "PETTY_CASH",
  ]},
  { label: "Marketing", tone: "out", categories: ["MARKETPLACE_FEE", "DIGITAL_ADS", "KOL", "OTHER_MARKETING"] },
  { label: "Property & Ops", tone: "out", categories: ["RENT", "UTILITIES", "SOFTWARE"] },
  { label: "Compliance & Finance", tone: "out", categories: [
    "CFS_FEE", "COMPLIANCE", "TAX", "LICENSING_FEE", "ROYALTY_FEE", "LOAN", "BANK_FEE",
  ]},
  { label: "Capex / Capital", tone: "out", categories: ["EQUIPMENTS", "MAINTENANCE", "INVESTMENTS"] },
  { label: "InterCo", tone: "out", categories: [
    "INTERCO_PEOPLE", "INTERCO_RAW_MATERIAL", "INTERCO_INVESTMENTS", "INTERCO_EXPENSES",
  ]},
  { label: "Catch-all", tone: "out", categories: ["TRANSFER_NOT_SUCCESSFUL", "OTHER_OUTFLOW"] },
];

function fmtMYR(n: number, opts?: { showZero?: boolean }): string {
  if (n === 0 && !opts?.showZero) return "—";
  return new Intl.NumberFormat("en-MY", { maximumFractionDigits: 0 }).format(n);
}

function monthLabel(m: string): string {
  // m = YYYY-MM
  const [y, mo] = m.split("-").map((s) => parseInt(s, 10));
  const d = new Date(y, mo - 1, 1);
  return d.toLocaleString("en-MY", { month: "short", year: "2-digit" });
}

export default function CashTrackingPage() {
  const [monthsBack, setMonthsBack] = useState(6);
  const [activeOutletId, setActiveOutletId] = useState<string | null>(null); // null = all
  const [includeInterCo, setIncludeInterCo] = useState(true);

  const params = new URLSearchParams({ months: String(monthsBack) });
  if (activeOutletId) params.set("outlet", activeOutletId);
  if (!includeInterCo) params.set("includeInterCo", "false");

  const { data, isLoading } = useFetch<CashMatrix>(`/api/finance/cash-tracking?${params.toString()}`);

  const visibleBands = useMemo(() => {
    if (!data) return [];
    const present = new Set(data.categories);
    return BANDS
      .map((b) => ({ ...b, categories: b.categories.filter((c) => present.has(c)) }))
      .filter((b) => b.categories.length > 0);
  }, [data]);

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/finance/cashflow" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <ChevronLeft className="h-3 w-3" /> Cashflow
          </Link>
          <h2 className="mt-1 text-lg sm:text-xl font-semibold text-gray-900">Cash Tracking</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
            Per-outlet × category × month breakdown. Sourced from classified bank statement lines — values mirror Finance&rsquo;s cash-tracking spreadsheet.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={includeInterCo}
              onChange={(e) => setIncludeInterCo(e.target.checked)}
              className="rounded border-gray-300 text-terracotta focus:ring-terracotta"
            />
            Include InterCo
          </label>
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            {[3, 6, 12].map((m) => (
              <button
                key={m}
                onClick={() => setMonthsBack(m)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${monthsBack === m ? "bg-terracotta text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="mt-6 flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : data.outlets.length === 0 || data.months.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
          <p className="text-sm text-gray-500">No classified bank statement lines yet.</p>
          <p className="mt-1 text-xs text-gray-400">
            Upload a CSV/Excel statement on the <Link href="/finance/bank-statements" className="text-terracotta hover:underline">Bank Statements</Link> page — lines will be auto-classified and appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Outlet tabs — All + each outlet (incl. HQ pseudo) */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveOutletId(null)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${activeOutletId === null ? "border-terracotta bg-terracotta text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
            >
              All outlets
            </button>
            {data.outlets.map((o) => (
              <button
                key={o.id}
                onClick={() => setActiveOutletId(o.id)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${activeOutletId === o.id ? "border-terracotta bg-terracotta text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"} ${o.isHQ ? "italic" : ""}`}
              >
                {o.name}
              </button>
            ))}
          </div>

          {/* Matrix table */}
          <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium">Category</th>
                  {data.months.map((m) => (
                    <th key={m} className="px-3 py-2 text-right font-medium tabular-nums">{monthLabel(m)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleBands.map((band) => {
                  const bandSubtotalByMonth: Record<string, number> = {};
                  for (const m of data.months) {
                    let sum = 0;
                    for (const c of band.categories) {
                      sum += getCellValue(data, c, activeOutletId, m);
                    }
                    bandSubtotalByMonth[m] = sum;
                  }
                  return (
                    <BandSection
                      key={band.label}
                      band={band}
                      months={data.months}
                      cells={data.cells}
                      activeOutletId={activeOutletId}
                      outlets={data.outlets}
                      subtotal={bandSubtotalByMonth}
                    />
                  );
                })}
                {/* Grand total */}
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-gray-900">Net cash flow</td>
                  {data.months.map((m) => {
                    const total = activeOutletId
                      ? totalForOutletMonth(data, activeOutletId, m)
                      : (data.monthTotals[m] ?? 0);
                    return (
                      <td key={m} className={`px-3 py-2 text-right tabular-nums ${total >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {fmtMYR(total, { showZero: true })}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] text-gray-400">
            Inflows shown positive · outflows negative · empty cells dashed · &ldquo;HQ / unallocated&rdquo; holds payments paid centrally that aren&rsquo;t outlet-tagged.
          </p>
        </>
      )}
    </div>
  );
}

function getCellValue(data: CashMatrix, category: string, activeOutletId: string | null, month: string): number {
  if (activeOutletId) {
    return data.cells[`${category}|${activeOutletId}|${month}`] ?? 0;
  }
  // Consolidated: sum across all outlets
  let s = 0;
  for (const o of data.outlets) {
    s += data.cells[`${category}|${o.id}|${month}`] ?? 0;
  }
  return s;
}

function totalForOutletMonth(data: CashMatrix, outletId: string, month: string): number {
  let s = 0;
  for (const c of data.categories) {
    s += data.cells[`${c}|${outletId}|${month}`] ?? 0;
  }
  return s;
}

function BandSection({
  band, months, cells, activeOutletId, outlets, subtotal,
}: {
  band: { label: string; tone: "in" | "out"; categories: string[] };
  months: string[];
  cells: CashMatrix["cells"];
  activeOutletId: string | null;
  outlets: Outlet[];
  subtotal: Record<string, number>;
}) {
  return (
    <>
      <tr className={`${band.tone === "in" ? "bg-green-50" : "bg-red-50"}`}>
        <td className={`sticky left-0 z-10 ${band.tone === "in" ? "bg-green-50" : "bg-red-50"} px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${band.tone === "in" ? "text-green-800" : "text-red-800"}`}>
          {band.label}
        </td>
        {months.map((m) => (
          <td key={m} className={`px-3 py-1 text-right text-[11px] font-semibold tabular-nums ${band.tone === "in" ? "text-green-800" : "text-red-800"}`}>
            {fmtMYR(subtotal[m] ?? 0)}
          </td>
        ))}
      </tr>
      {band.categories.map((c) => (
        <tr key={c} className="border-t border-gray-100 hover:bg-gray-50">
          <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-gray-700">
            <span className="ml-2">{CATEGORY_LABELS[c] ?? c}</span>
          </td>
          {months.map((m) => {
            let v: number;
            if (activeOutletId) {
              v = cells[`${c}|${activeOutletId}|${m}`] ?? 0;
            } else {
              v = 0;
              for (const o of outlets) v += cells[`${c}|${o.id}|${m}`] ?? 0;
            }
            return (
              <td key={m} className={`px-3 py-1.5 text-right tabular-nums ${v === 0 ? "text-gray-300" : v > 0 ? "text-green-700" : "text-red-700"}`}>
                {fmtMYR(v)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
