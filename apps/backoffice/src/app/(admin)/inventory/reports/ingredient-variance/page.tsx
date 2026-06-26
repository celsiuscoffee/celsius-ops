"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeft, Loader2, Scale, AlertTriangle, TrendingUp, TrendingDown, Info } from "lucide-react";

type Outlet = { id: string; name: string };

type VarianceItem = {
  productId: string;
  productName: string;
  sku: string | null;
  category: string | null;
  baseUom: string;
  actualQty: number;
  expectedQty: number;
  varianceQty: number;
  costPerBase: number;
  expectedCost: number;
  varianceCost: number;
  variancePercent: number | null;
  flags: string[];
  movements: Record<string, number>;
};

type Summary = {
  outletId: string;
  outletName: string;
  openingCountDate: string | null;
  closingCountDate: string | null;
  totalExpectedCost: number | null;
  totalVarianceCost: number | null;
  totalVariancePercent: number | null;
  itemsAnalyzed: number;
  itemsOverUsed?: number;
  highVarianceCount?: number;
  dataQuality: "complete" | "incomplete" | "insufficient";
  reason?: string;
};

type Data = {
  summary: Summary | null;
  outlets: Outlet[];
  items: VarianceItem[];
  requireOutlet?: boolean;
  warnings: {
    menuItemsWithoutBom: string[];
    productsWithoutCost: string[];
    uomMismatches: { productId: string; menuUom: string; baseUom: string }[];
    noSales: boolean;
  };
};

const fmt = (n: number) => n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export default function IngredientVariancePage() {
  const [outletId, setOutletId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams();
  if (outletId) params.set("outletId", outletId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const { data, isLoading } = useFetch<Data>(`/api/inventory/reports/ingredient-variance?${params.toString()}`);

  const s = data?.summary;
  const insufficient = s?.dataQuality === "insufficient";

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/inventory/reports" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Usage Variance</h2>
          <p className="text-sm text-gray-500">Actual usage (stock movements) vs expected (recipe BOM × sales)</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
          <option value="">Select outlet…</option>
          {(data?.outlets ?? []).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        </label>
      </div>

      {/* Choose-outlet prompt */}
      {data?.requireOutlet && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <Info className="h-5 w-5 shrink-0 text-blue-500" />
          <p className="text-sm text-blue-800">Select an outlet to compute usage variance — it&apos;s measured between that outlet&apos;s stock counts.</p>
        </div>
      )}

      {/* Insufficient-data banner */}
      {insufficient && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium text-amber-800">Not enough stock counts to measure usage</p>
            <p className="text-xs text-amber-600">{s?.reason}</p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {s && !insufficient && (
        <>
          <p className="mt-5 text-xs text-gray-500">
            Measured between counts <span className="font-medium text-gray-700">{day(s.openingCountDate)}</span> and <span className="font-medium text-gray-700">{day(s.closingCountDate)}</span> · {s.outletName}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Expected cost" value={`RM ${fmt(s.totalExpectedCost ?? 0)}`} sub="recipe × sales" />
            <Card
              label="Usage variance"
              value={`${(s.totalVarianceCost ?? 0) >= 0 ? "+" : "-"}RM ${fmt(Math.abs(s.totalVarianceCost ?? 0))}`}
              sub={s.totalVariancePercent !== null ? `${s.totalVariancePercent}% of expected` : undefined}
              tone={(s.totalVarianceCost ?? 0) > 0 ? "bad" : "good"}
            />
            <Card label="Items analysed" value={String(s.itemsAnalyzed)} sub={`${s.itemsOverUsed ?? 0} over-used`} />
            <Card label="High variance" value={String(s.highVarianceCount ?? 0)} sub="≥5% or RM20" tone={(s.highVarianceCount ?? 0) > 0 ? "warn" : undefined} />
          </div>
        </>
      )}

      {/* Data-quality warnings */}
      {data && !insufficient && data.warnings && (data.warnings.menuItemsWithoutBom.length > 0 || data.warnings.productsWithoutCost.length > 0 || data.warnings.uomMismatches.length > 0 || data.warnings.noSales) && (
        <div className="mt-4 space-y-1.5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
          <p className="font-medium text-gray-700">Data quality — variance may be incomplete:</p>
          {data.warnings.noSales && <p>• No sales in this window — actual usage shown without an expected baseline.</p>}
          {data.warnings.menuItemsWithoutBom.length > 0 && <p>• {data.warnings.menuItemsWithoutBom.length} sold menu item(s) have no recipe (BOM): {data.warnings.menuItemsWithoutBom.slice(0, 5).join(", ")}{data.warnings.menuItemsWithoutBom.length > 5 ? "…" : ""}</p>}
          {data.warnings.productsWithoutCost.length > 0 && <p>• {data.warnings.productsWithoutCost.length} product(s) have no supplier cost — variance qty only, no RM.</p>}
          {data.warnings.uomMismatches.length > 0 && <p>• {data.warnings.uomMismatches.length} recipe line(s) use a unit different from the product base UOM — check the recipe.</p>}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>
      )}

      {/* Table */}
      {s && !insufficient && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Ingredient</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Expected</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Actual</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Variance</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Cost/Unit</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Variance RM</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">%</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No ingredient activity in this window.</td></tr>
              )}
              {(data?.items ?? []).map((it, idx) => (
                <tr key={it.productId} className={`border-b border-gray-50 ${idx % 2 ? "bg-gray-50/30" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-gray-900">{it.productName}</span>
                      {it.flags.includes("HIGH_VARIANCE") && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                      {it.flags.includes("NO_COST") && <Badge variant="outline" className="text-[10px] text-gray-400">no cost</Badge>}
                    </div>
                    {it.category && <span className="text-xs text-gray-400">{it.category}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmt(it.expectedQty)} <span className="text-xs text-gray-400">{it.baseUom}</span></td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmt(it.actualQty)} <span className="text-xs text-gray-400">{it.baseUom}</span></td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    <span className={it.varianceQty > 0 ? "text-red-600" : it.varianceQty < 0 ? "text-blue-600" : "text-gray-400"}>
                      {it.varianceQty > 0 ? "+" : ""}{fmt(it.varianceQty)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-500">{it.costPerBase > 0 ? `RM ${fmt(it.costPerBase)}` : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {it.costPerBase > 0 ? (
                      <span className={`font-medium ${it.varianceCost > 0 ? "text-red-600" : it.varianceCost < 0 ? "text-green-600" : "text-gray-400"}`}>
                        {it.varianceCost > 0 ? <TrendingUp className="mr-0.5 inline h-3 w-3" /> : it.varianceCost < 0 ? <TrendingDown className="mr-0.5 inline h-3 w-3" /> : null}
                        {it.varianceCost > 0 ? "+" : ""}RM {fmt(Math.abs(it.varianceCost))}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-500">{it.variancePercent !== null ? `${it.variancePercent}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const valueColor = tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-600" : tone === "warn" ? "text-amber-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-amber-50 p-2"><Scale className="h-4 w-4 text-amber-600" /></div>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
