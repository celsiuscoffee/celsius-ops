"use client";

// General Ledger view. Lists journals from fin_transactions with Excel-style
// column sorting (asc/desc) + multi-dimension filtering (search, category/
// account, type, status, outlet, date range, amount range), and a Sheet
// drawer showing the journal lines + source document.

import { useState, useMemo } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, Badge } from "@celsius/ui";
import {
  Loader2, FileText, Bot, User as UserIcon,
  ArrowUp, ArrowDown, ChevronsUpDown, Search, X,
} from "lucide-react";

type Outlet = { id: string; name: string; code: string };

type Transaction = {
  id: string;
  txn_date: string;
  description: string;
  outlet_id: string | null;
  amount: number;
  currency: string;
  txn_type: string;
  posted_by_agent: string | null;
  agent_version: string | null;
  confidence: number | null;
  status: "draft" | "posted" | "exception" | "reversed";
  posted_at: string | null;
  period: string;
  source_doc_id: string | null;
  accounts: string[];
  outlet: Outlet | null;
};

type Account = { code: string; name: string; type: string };

type JournalLine = {
  id: string;
  account_code: string;
  account_name: string | null;
  outlet_id: string | null;
  debit: number;
  credit: number;
  memo: string | null;
  line_order: number;
};

type SourceDoc = {
  id: string;
  source: string;
  source_ref: string;
  doc_type: string;
  raw_url: string | null;
  received_at: string;
};

const RM = (n: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

function StatusBadge({ status }: { status: Transaction["status"] }) {
  const variant: Record<Transaction["status"], "default" | "secondary" | "destructive" | "outline"> = {
    posted: "default",
    draft: "outline",
    exception: "destructive",
    reversed: "secondary",
  };
  return <Badge variant={variant[status]}>{status}</Badge>;
}

function DrawerContent({ id }: { id: string }) {
  const { data, error } = useFetch<{
    transaction: Transaction;
    lines: JournalLine[];
    document: SourceDoc | null;
  }>(`/api/finance/transactions/${id}`);

  if (!data && !error) {
    return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-destructive">Failed to load.</div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-5 overflow-y-auto p-6">
      <section className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Description</div>
        <div className="break-words">{data.transaction.description}</div>
      </section>

      <section className="grid grid-cols-2 gap-3 text-sm">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Date</div>
          <div className="tabular-nums">{data.transaction.txn_date}</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
          <StatusBadge status={data.transaction.status} />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Amount</div>
          <div className="truncate font-medium tabular-nums">{RM(Number(data.transaction.amount))}</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Posted by</div>
          <div className="flex items-center gap-1 truncate">
            {data.transaction.posted_by_agent === "manual" ? (
              <UserIcon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Bot className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{data.transaction.posted_by_agent ?? "—"}</span>
            {data.transaction.confidence !== null && (
              <span className="shrink-0 text-muted-foreground">
                ({Math.round(Number(data.transaction.confidence) * 100)}%)
              </span>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          Journal lines
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">Account</th>
                <th className="px-2 py-1.5 text-right">Debit</th>
                <th className="px-2 py-1.5 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id} className="border-t align-top">
                  <td className="min-w-0 px-2 py-1.5">
                    <div className="font-medium tabular-nums">{l.account_code}</div>
                    {l.account_name && (
                      <div className="text-xs text-muted-foreground">{l.account_name}</div>
                    )}
                    {l.memo && (
                      <div className="break-words text-xs text-muted-foreground">{l.memo}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {Number(l.debit) ? RM(Number(l.debit)) : ""}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {Number(l.credit) ? RM(Number(l.credit)) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.document && (
        <section className="rounded-md border bg-muted/20 p-3 text-sm">
          <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Source document
          </div>
          <div className="truncate">
            {data.document.source} · {data.document.doc_type}
          </div>
          <div className="break-all text-xs text-muted-foreground">{data.document.source_ref}</div>
        </section>
      )}
    </div>
  );
}

type SortKey = "txn_date" | "description" | "outlet" | "txn_type" | "amount" | "status";

const SELECT_CLASS =
  "h-8 rounded-md border bg-background px-2 text-xs sm:text-sm shrink-0 max-w-[40vw]";

function SortTh({
  label, sortField, sortKey, sortDir, onSort, className = "", align = "left",
}: {
  label: string;
  sortField: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  className?: string;
  align?: "left" | "right";
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
  const [openId, setOpenId] = useState<string | null>(null);

  // Filters (all client-side over the fetched window — instant, Excel-like)
  const [search, setSearch] = useState("");
  const [typeF, setTypeF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [outletF, setOutletF] = useState("");
  const [catF, setCatF] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("txn_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, error, isLoading } = useFetch<{ transactions: Transaction[] }>(
    "/api/finance/transactions?limit=2000"
  );
  const { data: coa } = useFetch<{ accounts: Account[] }>("/api/finance/accounts");

  const txns = useMemo(() => data?.transactions ?? [], [data]);
  const acctName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of coa?.accounts ?? []) m.set(a.code, a.name);
    return m;
  }, [coa]);
  const acctLabel = (code: string) => (acctName.get(code) ? `${code} — ${acctName.get(code)}` : code);

  // Distinct dropdown options derived from the data
  const typeOptions = useMemo(
    () => Array.from(new Set(txns.map((t) => t.txn_type))).sort(),
    [txns]
  );
  const outletOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of txns) if (t.outlet) m.set(t.outlet.id, t.outlet.name);
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [txns]);
  const hasNoOutlet = useMemo(() => txns.some((t) => !t.outlet_id), [txns]);
  const categoryOptions = useMemo(
    () => Array.from(new Set(txns.flatMap((t) => t.accounts))).sort(),
    [txns]
  );

  function onSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "amount" || k === "txn_date" ? "desc" : "asc"); }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const min = parseFloat(amountMin);
    const max = parseFloat(amountMax);
    let rows = txns.filter((t) => {
      if (s) {
        const hay =
          t.description.toLowerCase() + " " +
          t.txn_type.toLowerCase() + " " +
          (t.outlet?.name?.toLowerCase() ?? "") + " " +
          (t.posted_by_agent?.toLowerCase() ?? "") + " " +
          t.accounts.join(" ").toLowerCase() + " " +
          t.accounts.map((c) => acctName.get(c)?.toLowerCase() ?? "").join(" ");
        if (!hay.includes(s)) return false;
      }
      if (typeF && t.txn_type !== typeF) return false;
      if (statusF && t.status !== statusF) return false;
      if (outletF) {
        if (outletF === "__none__" ? !!t.outlet_id : t.outlet_id !== outletF) return false;
      }
      if (catF && !t.accounts.includes(catF)) return false;
      if (dateFrom && t.txn_date < dateFrom) return false;
      if (dateTo && t.txn_date > dateTo) return false;
      if (!isNaN(min) && Number(t.amount) < min) return false;
      if (!isNaN(max) && Number(t.amount) > max) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (sortKey) {
        case "amount": av = Number(a.amount); bv = Number(b.amount); break;
        case "outlet": av = a.outlet?.name ?? ""; bv = b.outlet?.name ?? ""; break;
        case "txn_date": av = a.txn_date; bv = b.txn_date; break;
        case "txn_type": av = a.txn_type; bv = b.txn_type; break;
        case "status": av = a.status; bv = b.status; break;
        default: av = a.description.toLowerCase(); bv = b.description.toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // tiebreak by date desc for stability
      return a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : 0;
    });
    return rows;
  }, [txns, search, typeF, statusF, outletF, catF, dateFrom, dateTo, amountMin, amountMax, sortKey, sortDir, acctName]);

  const filteredTotal = useMemo(
    () => filtered.reduce((s, t) => s + Number(t.amount), 0),
    [filtered]
  );

  const anyFilter =
    !!(search || typeF || statusF || outletF || catF || dateFrom || dateTo || amountMin || amountMax);

  function clearFilters() {
    setSearch(""); setTypeF(""); setStatusF(""); setOutletF(""); setCatF("");
    setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax("");
  }

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <header className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold">Ledger</h1>
        <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
          Every journal posted to the ledger by agents and humans. Sort any column; filter like a spreadsheet.
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
              placeholder="Search description, account, agent…"
              className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm"
            />
          </div>

          <select value={catF} onChange={(e) => setCatF(e.target.value)} className={SELECT_CLASS} title="Category (account)">
            <option value="">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{acctLabel(c)}</option>
            ))}
          </select>

          <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className={SELECT_CLASS} title="Type">
            <option value="">All types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={SELECT_CLASS} title="Status">
            <option value="">All statuses</option>
            <option value="posted">Posted</option>
            <option value="draft">Draft</option>
            <option value="exception">Exception</option>
            <option value="reversed">Reversed</option>
          </select>

          <select value={outletF} onChange={(e) => setOutletF(e.target.value)} className={SELECT_CLASS} title="Outlet">
            <option value="">All outlets</option>
            {outletOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
            {hasNoOutlet && <option value="__none__">No outlet</option>}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">From
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" />
          </label>
          <label className="flex items-center gap-1">To
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" />
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
          <span className="ml-auto tabular-nums">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"} · {RM(filteredTotal)}
          </span>
        </div>
      </div>

      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load: {String(error)}
        </div>
      )}

      {data && txns.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No journals yet. Run the StoreHub EOD ingest to backfill.
        </div>
      )}

      {data && txns.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <SortTh label="Date" sortField="txn_date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap" />
                <SortTh label="Description" sortField="description" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Outlet" sortField="outlet" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap hidden md:table-cell" />
                <SortTh label="Type" sortField="txn_type" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap hidden lg:table-cell" />
                <th className="px-3 py-2 whitespace-nowrap hidden lg:table-cell">Agent</th>
                <SortTh label="Amount" sortField="amount" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap text-right" align="right" />
                <SortTh label="Status" sortField="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="whitespace-nowrap" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer border-t transition hover:bg-muted/30"
                  onClick={() => setOpenId(t.id)}
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums align-top">{t.txn_date}</td>
                  <td className="max-w-[320px] px-3 py-2">
                    <div className="truncate">{t.description}</div>
                    {t.accounts.length > 0 && (
                      <div
                        className="truncate text-[11px] text-muted-foreground"
                        title={t.accounts.map((c) => acctLabel(c)).join(", ")}
                      >
                        {t.accounts.join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 hidden md:table-cell align-top">
                    {t.outlet?.name ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 hidden lg:table-cell text-xs text-muted-foreground align-top">
                    {t.txn_type}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 hidden lg:table-cell text-xs align-top">
                    {t.posted_by_agent}
                    {t.confidence !== null && (
                      <span className="ml-1 text-muted-foreground">
                        ({Math.round(Number(t.confidence) * 100)}%)
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums align-top">
                    {RM(Number(t.amount))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No entries match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-hidden flex flex-col gap-0 p-0">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>Transaction</SheetTitle>
          </SheetHeader>
          {openId && <DrawerContent id={openId} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
