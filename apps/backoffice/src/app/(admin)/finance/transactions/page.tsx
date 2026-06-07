"use client";

// Ledger — the REAL cash ledger, sourced from classified bank-statement lines
// (every actual deposit/payment across the entities). Excel-style column
// sorting (asc/desc) + filtering: search, category, direction (in/out), entity,
// outlet, date range, amount range. Date range is server-windowed; the rest is
// client-side for instant feel. Row click opens a detail drawer.

import { useState, useMemo } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, Badge, Button } from "@celsius/ui";
import { Loader2, Search, X, ArrowUp, ArrowDown, ChevronsUpDown, Building2 } from "lucide-react";

type BankLine = {
  id: string;
  txnDate: string;
  description: string;
  reference: string | null;
  amount: number;
  direction: "CR" | "DR";
  category: string | null;
  isInterCo: boolean;
  classifiedBy: string | null;
  ruleName: string | null;
  outlet: string | null;
  account: string | null;
};

const RM = (n: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

function humanCat(c: string | null): string {
  if (!c) return "Unclassified";
  return c.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

// Bank account → the company (legal entity) that owns it. 3 entities, one
// Maybank current account each, identified by name / 4-digit suffix.
function companyOf(account: string | null): string {
  if (!account) return "—";
  const up = account.toUpperCase();
  if (up.includes("CONEZION") || up.includes("2644")) return "Celsius Coffee Conezion";
  if (up.includes("TAMARIND") || up.includes("9345")) return "Celsius Coffee Tamarind";
  if (up.includes("4384") || up.includes("CELSIUS COFFEE SDN")) return "Celsius Coffee SB";
  return account;
}

// ─── Date period helpers (quick ranges + month picker) ───────────────────────
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function monthRange(year: number, month0: number): { from: string; to: string } {
  // month0 may be negative / >11 — Date.UTC normalizes across year boundaries.
  return {
    from: ymd(new Date(Date.UTC(year, month0, 1))),
    to: ymd(new Date(Date.UTC(year, month0 + 1, 0))), // day 0 of next month = last day
  };
}
function presetRange(key: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const thisMonthEnd = monthRange(y, m).to;
  switch (key) {
    case "thisMonth": return monthRange(y, m);
    case "lastMonth": return monthRange(y, m - 1);
    case "last3": return { from: monthRange(y, m - 2).from, to: thisMonthEnd };
    case "last6": return { from: monthRange(y, m - 5).from, to: thisMonthEnd };
    case "ytd": return { from: `${y}-01-01`, to: ymd(now) };
    case "last12": return { from: monthRange(y, m - 11).from, to: thisMonthEnd };
    default: return { from: monthRange(y, m - 2).from, to: thisMonthEnd };
  }
}
function monthOptions(): { value: string; label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const out: { value: string; label: string; from: string; to: string }[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(y, m - i, 1));
    const yy = d.getUTCFullYear();
    const mm = d.getUTCMonth();
    out.push({
      value: `${yy}-${String(mm + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-MY", { month: "short", year: "numeric", timeZone: "UTC" }),
      ...monthRange(yy, mm),
    });
  }
  return out;
}

type SortKey = "txnDate" | "description" | "category" | "account" | "amount";

const SELECT_CLASS = "h-8 rounded-md border bg-background px-2 text-xs sm:text-sm shrink-0 max-w-[40vw]";

function SortTh({
  label, sortField, sortKey, sortDir, onSort, className = "", align = "left",
}: {
  label: string; sortField: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void; className?: string; align?: "left" | "right";
}) {
  const active = sortKey === sortField;
  return (
    <th className={`px-3 py-2 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortField)}
        className={`inline-flex items-center gap-1 font-medium uppercase tracking-wide hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        {active ? (
          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

export default function FinanceLedgerPage() {
  const [openLine, setOpenLine] = useState<BankLine | null>(null);

  // Server-windowed date range. Defaults to last 3 months; driven by the
  // Period dropdown (quick ranges + month picker) or custom From/To.
  const [periodSel, setPeriodSel] = useState("last3");
  const [dateFrom, setDateFrom] = useState(() => presetRange("last3").from);
  const [dateTo, setDateTo] = useState(() => presetRange("last3").to);

  // Client-side filters.
  const [search, setSearch] = useState("");
  const [catF, setCatF] = useState("");
  const [dirF, setDirF] = useState("");
  const [entityF, setEntityF] = useState("");
  const [outletF, setOutletF] = useState("");
  const [intercoF, setIntercoF] = useState(""); // "" all | "exclude" | "only"
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("txnDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    return p.toString();
  }, [dateFrom, dateTo]);

  const { data, error, isLoading } = useFetch<{ from: string; to: string | null; lines: BankLine[] }>(
    `/api/finance/bank-ledger${qs ? `?${qs}` : ""}`
  );
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const MONTHS = useMemo(() => monthOptions(), []);

  const categoryOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.category ?? "__null__"))).sort(),
    [lines]
  );
  const entityOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => companyOf(l.account)))).sort(),
    [lines]
  );
  const outletOptions = useMemo(
    () => Array.from(new Set(lines.map((l) => l.outlet).filter(Boolean) as string[])).sort(),
    [lines]
  );

  function onSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "amount" || k === "txnDate" ? "desc" : "asc"); }
  }

  function applyPeriod(v: string) {
    setPeriodSel(v);
    if (v === "custom") return;
    const r = v.startsWith("m:") ? MONTHS.find((mo) => mo.value === v.slice(2)) : presetRange(v);
    if (r) { setDateFrom(r.from); setDateTo(r.to); }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const min = parseFloat(amountMin);
    const max = parseFloat(amountMax);
    let rows = lines.filter((l) => {
      if (s) {
        const hay = `${l.description} ${l.reference ?? ""} ${humanCat(l.category)} ${companyOf(l.account)} ${l.outlet ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (catF) {
        if (catF === "__null__" ? l.category != null : l.category !== catF) return false;
      }
      if (dirF && l.direction !== dirF) return false;
      if (entityF && companyOf(l.account) !== entityF) return false;
      if (outletF) {
        if (outletF === "__none__" ? !!l.outlet : l.outlet !== outletF) return false;
      }
      if (intercoF === "exclude" && l.isInterCo) return false;
      if (intercoF === "only" && !l.isInterCo) return false;
      if (!isNaN(min) && l.amount < min) return false;
      if (!isNaN(max) && l.amount > max) return false;
      return true;
    });

    const signed = (l: BankLine) => (l.direction === "CR" ? l.amount : -l.amount);
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case "amount": av = signed(a); bv = signed(b); break;
        case "category": av = humanCat(a.category); bv = humanCat(b.category); break;
        case "account": av = companyOf(a.account); bv = companyOf(b.account); break;
        case "txnDate": av = a.txnDate; bv = b.txnDate; break;
        default: av = a.description.toLowerCase(); bv = b.description.toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.txnDate < b.txnDate ? 1 : a.txnDate > b.txnDate ? -1 : 0;
    });
    return rows;
  }, [lines, search, catF, dirF, entityF, outletF, intercoF, amountMin, amountMax, sortKey, sortDir]);

  const totals = useMemo(() => {
    let inn = 0, out = 0;
    for (const l of filtered) (l.direction === "CR" ? (inn += l.amount) : (out += l.amount));
    return { inn, out, net: inn - out };
  }, [filtered]);

  const MAX_RENDER = 500;
  const rendered = filtered.slice(0, MAX_RENDER);

  const anyFilter = !!(search || catF || dirF || entityF || outletF || intercoF || amountMin || amountMax);
  function clearFilters() {
    setSearch(""); setCatF(""); setDirF(""); setEntityF(""); setOutletF(""); setIntercoF(""); setAmountMin(""); setAmountMax("");
  }

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <header className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold">Ledger</h1>
        <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
          Real cash ledger from the bank statements — every deposit and payment, classified. Sort any column; filter like a spreadsheet.
          {data && <span className="ml-1">Showing from {data.from}{data.to ? ` to ${data.to}` : ""}.</span>}
        </p>
      </header>

      {/* Filter toolbar */}
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search description, reference, category…"
              className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm"
            />
          </div>

          <select value={catF} onChange={(e) => setCatF(e.target.value)} className={SELECT_CLASS} title="Category">
            <option value="">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c === "__null__" ? "Unclassified" : humanCat(c)}</option>
            ))}
          </select>

          <select value={dirF} onChange={(e) => setDirF(e.target.value)} className={SELECT_CLASS} title="Direction">
            <option value="">In &amp; Out</option>
            <option value="CR">In (money received)</option>
            <option value="DR">Out (money paid)</option>
          </select>

          <select value={intercoF} onChange={(e) => setIntercoF(e.target.value)} className={SELECT_CLASS} title="Inter-company transfers">
            <option value="">Incl. inter-company</option>
            <option value="exclude">Exclude inter-company</option>
            <option value="only">Only inter-company</option>
          </select>

          <select value={entityF} onChange={(e) => setEntityF(e.target.value)} className={SELECT_CLASS} title="Company">
            <option value="">All companies</option>
            {entityOptions.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>

          {outletOptions.length > 0 && (
            <select value={outletF} onChange={(e) => setOutletF(e.target.value)} className={SELECT_CLASS} title="Outlet">
              <option value="">All outlets</option>
              {outletOptions.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
              <option value="__none__">No outlet</option>
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">Period
            <select value={periodSel} onChange={(e) => applyPeriod(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs sm:text-sm" title="Period">
              <optgroup label="Quick ranges">
                <option value="thisMonth">This month</option>
                <option value="lastMonth">Last month</option>
                <option value="last3">Last 3 months</option>
                <option value="last6">Last 6 months</option>
                <option value="ytd">Year to date</option>
                <option value="last12">Last 12 months</option>
              </optgroup>
              <optgroup label="By month">
                {MONTHS.map((mo) => (<option key={mo.value} value={`m:${mo.value}`}>{mo.label}</option>))}
              </optgroup>
              <option value="custom">Custom range…</option>
            </select>
          </label>
          <label className="flex items-center gap-1">From
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPeriodSel("custom"); }} className="h-8 rounded-md border bg-background px-2 text-xs" />
          </label>
          <label className="flex items-center gap-1">To
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPeriodSel("custom"); }} className="h-8 rounded-md border bg-background px-2 text-xs" />
          </label>
          <label className="flex items-center gap-1">Min RM
            <input type="number" inputMode="decimal" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} className="h-8 w-24 rounded-md border bg-background px-2 text-xs tabular-nums" />
          </label>
          <label className="flex items-center gap-1">Max RM
            <input type="number" inputMode="decimal" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} className="h-8 w-24 rounded-md border bg-background px-2 text-xs tabular-nums" />
          </label>
          {anyFilter && (
            <Button variant="outline" size="sm" className="h-8" onClick={clearFilters}>
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-x-3 tabular-nums">
            <span>{filtered.length} {filtered.length === 1 ? "line" : "lines"}</span>
            <span className="text-green-700">In {RM(totals.inn)}</span>
            <span className="text-red-700">Out {RM(totals.out)}</span>
            <span className={totals.net >= 0 ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
              Net {totals.net >= 0 ? "+" : ""}{RM(totals.net)}
            </span>
          </span>
        </div>
      </div>

      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load: {String(error)}
        </div>
      )}

      {data && lines.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No bank-statement lines in this range. Upload statements on the Bank Statements page, or widen the date range.
        </div>
      )}

      {data && lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <SortTh label="Date" sortField="txnDate" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap" />
                <SortTh label="Description" sortField="description" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Category" sortField="category" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap hidden sm:table-cell" />
                <SortTh label="Company" sortField="account" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap hidden md:table-cell" />
                <SortTh label="Amount" sortField="amount" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap text-right" align="right" />
              </tr>
            </thead>
            <tbody>
              {rendered.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer border-t transition hover:bg-muted/30"
                  onClick={() => setOpenLine(l)}
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums align-top">{l.txnDate}</td>
                  <td className="max-w-[340px] px-3 py-2">
                    <div className="truncate">{l.description}</div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {l.reference && <span className="truncate">{l.reference}</span>}
                      <span className="sm:hidden">· {humanCat(l.category)}</span>
                      {l.isInterCo && <span className="rounded bg-amber-500/15 px-1 text-amber-700">inter-co</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 hidden sm:table-cell align-top">
                    <Badge variant="outline" className="font-normal">{humanCat(l.category)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 hidden md:table-cell align-top text-xs text-muted-foreground">
                    {companyOf(l.account)}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums align-top font-medium ${l.direction === "CR" ? "text-green-700" : "text-red-700"}`}>
                    {l.direction === "CR" ? "+" : "−"}{RM(l.amount)}
                  </td>
                </tr>
              ))}
              {filtered.length > MAX_RENDER && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-center text-xs text-muted-foreground">
                    Showing first {MAX_RENDER} of {filtered.length.toLocaleString()} lines — narrow with filters or the date range. Totals above reflect all {filtered.length.toLocaleString()}.
                  </td>
                </tr>
              )}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No lines match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!openLine} onOpenChange={(o) => !o && setOpenLine(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-hidden flex flex-col gap-0 p-0">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>Bank transaction</SheetTitle>
          </SheetHeader>
          {openLine && (
            <div className="space-y-5 overflow-y-auto p-6 text-sm">
              <section className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Description</div>
                <div className="break-words">{openLine.description}</div>
                {openLine.reference && (
                  <div className="break-all text-xs text-muted-foreground">Ref: {openLine.reference}</div>
                )}
              </section>
              <section className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Date</div>
                  <div className="tabular-nums">{openLine.txnDate}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Amount</div>
                  <div className={`font-medium tabular-nums ${openLine.direction === "CR" ? "text-green-700" : "text-red-700"}`}>
                    {openLine.direction === "CR" ? "+" : "−"}{RM(openLine.amount)} ({openLine.direction === "CR" ? "in" : "out"})
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Category</div>
                  <Badge variant="outline" className="font-normal">{humanCat(openLine.category)}</Badge>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Company</div>
                  <div className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5 shrink-0" />{companyOf(openLine.account)}</div>
                </div>
                {openLine.outlet && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Outlet</div>
                    <div>{openLine.outlet}</div>
                  </div>
                )}
                {openLine.isInterCo && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Inter-company</div>
                    <div className="text-amber-700">Yes</div>
                  </div>
                )}
              </section>
              {(openLine.classifiedBy || openLine.ruleName) && (
                <section className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                  Classified by {openLine.classifiedBy ?? "—"}
                  {openLine.ruleName && <> · rule <span className="font-mono">{openLine.ruleName}</span></>}
                </section>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
