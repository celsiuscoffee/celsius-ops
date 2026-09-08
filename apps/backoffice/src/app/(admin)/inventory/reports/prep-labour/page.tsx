"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import Link from "next/link";
import { ArrowLeft, Loader2, Clock, Users, AlertTriangle, Info } from "lucide-react";
import { ReportTable, type ReportColumn } from "@/components/reports/report-table";

type Outlet = { id: string; name: string };

type PrepItem = {
  recipeId: string;
  productId: string;
  productName: string;
  sku: string;
  baseUom: string;
  yieldQuantity: number;
  yieldUom: string;
  prepMinutes: number | null;
  minutesPerUnit: number | null;
  unitsNeeded: number;
  batches: number;
  requiredMinutes: number | null;
  requiredHours: number | null;
  timed: boolean;
};

type Data = {
  summary: {
    from: string; to: string; outletId: string | null; outletName: string;
    requiredHours: number; rosteredHours: number; gapHours: number;
    utilisationPct: number | null;
    rosteredShifts: number; rosteredPeople: number;
    itemsAnalysed: number; untimedCount: number;
  };
  outlets: Outlet[];
  items: PrepItem[];
  warnings: {
    untimedRecipes: string[];
    noSales: boolean;
    noRoster: boolean;
    menusWithoutRecipe: number;
  };
};

const fmt = (n: number) => n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: number) => n.toLocaleString("en-MY", { maximumFractionDigits: 0 });

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function PrepLabourPage() {
  const defaults = defaultRange();
  const [outletId, setOutletId] = useState("");
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);

  const params = new URLSearchParams();
  if (outletId) params.set("outletId", outletId);
  params.set("from", from);
  params.set("to", to);
  const { data, isLoading } = useFetch<Data>(`/api/inventory/reports/prep-labour?${params.toString()}`);

  const s = data?.summary;
  const short = s ? s.gapHours < 0 : false;

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center gap-3">
        <Link href="/inventory/reports" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Prep Manhours</h2>
          <p className="text-sm text-gray-500">Prep hours the period demanded (sales × recipes × prep time) vs rostered hours</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select className="rounded-lg border border-gray-200 px-3 py-2 text-sm" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
          <option value="">All outlets</option>
          {(data?.outlets ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        </label>
      </div>

      {isLoading && <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>}

      {s && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card icon={<Clock className="h-4 w-4 text-amber-600" />} label="Prep hours needed" value={`${fmt(s.requiredHours)} h`} sub={`${s.itemsAnalysed} prepped items`} />
            <Card icon={<Users className="h-4 w-4 text-blue-600" />} label="Rostered hours" value={`${fmt(s.rosteredHours)} h`} sub={`${s.rosteredShifts} shifts · ${s.rosteredPeople} people`} />
            <Card
              icon={<AlertTriangle className={`h-4 w-4 ${short ? "text-red-600" : "text-green-600"}`} />}
              label={short ? "Short by" : "Spare capacity"}
              value={`${fmt(Math.abs(s.gapHours))} h`}
              tone={short ? "bad" : "good"}
            />
            <Card
              icon={<Clock className="h-4 w-4 text-gray-500" />}
              label="Prep share of roster"
              value={s.utilisationPct != null ? `${fmt(s.utilisationPct)}%` : "—"}
              sub={s.utilisationPct != null ? "of all rostered hours" : "no roster in range"}
              tone={s.utilisationPct != null && s.utilisationPct > 100 ? "bad" : undefined}
            />
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <p className="text-xs text-blue-800">
              Rostered hours are every published working hour for {s.outletName.toLowerCase()} in this range, not
              prep-only hours — staff also serve customers. Read the share as &ldquo;prep would consume this much of the
              roster&rdquo;, and judge the rest against how your shifts are actually split.
            </p>
          </div>

          {data && (data.warnings.untimedRecipes.length > 0 || data.warnings.noSales || data.warnings.noRoster) && (
            <div className="mt-3 space-y-1.5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <p className="font-medium text-gray-700">Data quality — the hours needed may be understated:</p>
              {data.warnings.untimedRecipes.length > 0 && (
                <p>• {data.warnings.untimedRecipes.length} prepped item(s) consumed in this period have no prep time set, so they add ZERO hours to the total: {data.warnings.untimedRecipes.slice(0, 6).join(", ")}{data.warnings.untimedRecipes.length > 6 ? "…" : ""}. Set their time in Prep Recipes.</p>
              )}
              {data.warnings.noSales && <p>• No sales in this window — nothing to prep against.</p>}
              {data.warnings.noRoster && <p>• No published roster for this outlet and range — rostered hours read as zero.</p>}
              {data.warnings.menusWithoutRecipe > 0 && <p>• {data.warnings.menusWithoutRecipe} sold menu item(s) have no BOM, so anything prepped for them is invisible here.</p>}
            </div>
          )}

          <ReportTable<PrepItem>
            rows={data?.items ?? []}
            rowKey={(i) => i.recipeId}
            csvFilename="prep-manhours"
            emptyMessage="No prepped items were consumed in this window."
            searchPlaceholder="Search prepped item or SKU…"
            searchText={(i) => `${i.productName} ${i.sku}`}
            initialSort={{ key: "requiredMinutes", dir: "desc" }}
            minWidth={900}
            toggles={[
              { key: "untimed", label: "Not timed", predicate: (i) => !i.timed },
              { key: "timed", label: "Timed only", predicate: (i) => i.timed },
            ]}
            columns={prepColumns}
          />
        </>
      )}
    </div>
  );
}

const prepColumns: ReportColumn<PrepItem>[] = [
  {
    key: "productName", header: "Prepped item", sortValue: (i) => i.productName, csv: (i) => i.productName,
    render: (i) => (
      <>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-gray-900">{i.productName}</span>
          {!i.timed && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">not timed</span>}
        </div>
        <code className="text-xs text-gray-400">{i.sku}</code>
      </>
    ),
  },
  {
    key: "unitsNeeded", header: "Units needed", align: "right", sortValue: (i) => i.unitsNeeded,
    render: (i) => <span className="font-mono text-gray-900">{fmt(i.unitsNeeded)} <span className="text-xs text-gray-400">{i.baseUom}</span></span>,
  },
  {
    key: "batches", header: "Batches", align: "right", sortValue: (i) => i.batches,
    render: (i) => <span className="font-mono text-gray-700">{fmt(i.batches)}<span className="text-xs text-gray-400"> × {fmt0(i.yieldQuantity)} {i.yieldUom}</span></span>,
  },
  {
    key: "prepMinutes", header: "Min/batch", align: "right", sortValue: (i) => i.prepMinutes,
    render: (i) => i.prepMinutes != null
      ? <span className="font-mono text-gray-700">{fmt0(i.prepMinutes)}</span>
      : <span className="text-gray-300">—</span>,
  },
  {
    key: "minutesPerUnit", header: "Min/unit", align: "right", sortValue: (i) => i.minutesPerUnit,
    render: (i) => i.minutesPerUnit != null
      ? <span className="font-mono text-gray-500">{i.minutesPerUnit.toFixed(2)}</span>
      : <span className="text-gray-300">—</span>,
  },
  {
    key: "requiredMinutes", header: "Hours needed", align: "right", sortValue: (i) => i.requiredMinutes,
    render: (i) => i.requiredHours != null
      ? <span className="font-mono font-medium text-gray-900">{fmt(i.requiredHours)} h</span>
      : <span className="text-[11px] text-amber-600">set prep time</span>,
  },
];

function Card({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-600" : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-gray-50 p-2">{icon}</div>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
