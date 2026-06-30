"use client";

// Reports — three live financial statements (P&L, Balance Sheet, Cash Flow)
// + auditor pack export. Date pickers, drill down by clicking any P&L line.

import { useState, useMemo } from "react";
import { useFetch } from "@/lib/use-fetch";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@celsius/ui";
import { Loader2, Download, FileText, AlertTriangle } from "lucide-react";

const RM = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

function thisMonthStart(): string {
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${myt.getUTCFullYear()}-${String(myt.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ─── P&L tab ────────────────────────────────────────────────────

type PnlLine = { code: string; name: string; amount: number; parentCode: string | null };
type PnlSection = { total: number; lines: PnlLine[] };

type PnlReport = {
  companyId: string;
  start: string;
  end: string;
  income: PnlSection;
  cogs: PnlSection;
  grossProfit: number;
  expenses: PnlSection;
  netIncome: number;
  txnCount: number;
};

type DrillLine = {
  transactionId: string;
  txnDate: string;
  description: string;
  amount: number;
  debit: number;
  credit: number;
};

// Row components live at module scope (not inside PnlTab) so their
// identity is stable across renders; ReportRow takes the drill-down
// callback as a prop instead of closing over PnlTab state.
function ReportRow({ line, onDrill }: { line: PnlLine; onDrill: (code: string) => void }) {
  return (
    <tr
      className="cursor-pointer border-t transition hover:bg-muted/30"
      onClick={() => onDrill(line.code)}
    >
      <td
        className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted-foreground"
        style={{ paddingLeft: line.parentCode ? 32 : 12 }}
      >
        {line.code}
      </td>
      <td className="px-3 py-1.5">{line.name}</td>
      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{RM(line.amount)}</td>
    </tr>
  );
}

function TotalRow({ label, amount, bold = true }: { label: string; amount: number; bold?: boolean }) {
  return (
    <tr className="border-t bg-muted/30">
      <td colSpan={2} className={`px-3 py-2 ${bold ? "font-semibold" : ""}`}>
        {label}
      </td>
      <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
        {RM(amount)}
      </td>
    </tr>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={3} className="bg-muted/50 px-3 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </td>
    </tr>
  );
}

function PnlTab() {
  const [start, setStart] = useState(thisMonthStart());
  const [end, setEnd] = useState(todayMyt());
  const [outletId, setOutletId] = useState("");
  const { data: outlets } = useFetch<{ id: string; name: string }[]>("/api/settings/outlets");
  const qs = useMemo(() => `start=${start}&end=${end}${outletId ? `&outletId=${outletId}` : ""}`, [start, end, outletId]);
  const { data, error, isLoading, mutate } = useFetch<{ report: PnlReport }>(
    `/api/finance/reports/pnl?${qs}`
  );
  const [drillCode, setDrillCode] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        />
        <select
          value={outletId}
          onChange={(e) => setOutletId(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          title="Per-outlet scopes revenue + COGS + outlet-tagged costs (contribution margin; shared opex stays company-level)"
        >
          <option value="">All outlets (company)</option>
          {(outlets ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <Button onClick={() => mutate()} variant="outline" size="sm">
          Refresh
        </Button>
      </div>
      {outletId && (
        <p className="text-[11px] text-amber-600">
          Per-outlet view: revenue + COGS + outlet-tagged costs only (contribution margin). Shared/HQ opex is paid from the entity account and can&apos;t be split per outlet.
        </p>
      )}

      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load.
        </div>
      )}

      {data && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">Code</th>
                <th className="px-3 py-2">Account</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <SectionHeader label="Income" />
              {data.report.income.lines.map((l) => <ReportRow key={l.code} line={l} onDrill={setDrillCode} />)}
              <TotalRow label="Total Income" amount={data.report.income.total} />

              <SectionHeader label="Cost of Sales" />
              {data.report.cogs.lines.map((l) => <ReportRow key={l.code} line={l} onDrill={setDrillCode} />)}
              <TotalRow label="Total COGS" amount={data.report.cogs.total} />
              <TotalRow label="Gross Profit" amount={data.report.grossProfit} />

              <SectionHeader label="Expenses" />
              {data.report.expenses.lines.map((l) => <ReportRow key={l.code} line={l} onDrill={setDrillCode} />)}
              <TotalRow label="Total Expenses" amount={data.report.expenses.total} />

              <TotalRow label="Net Income" amount={data.report.netIncome} />
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!drillCode} onOpenChange={(o) => !o && setDrillCode(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{drillCode} — drill down</SheetTitle>
          </SheetHeader>
          {drillCode && data && (
            <DrillDown code={drillCode} start={data.report.start} end={data.report.end} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DrillDown({ code, start, end }: { code: string; start: string; end: string }) {
  const { data, isLoading } = useFetch<{ lines: DrillLine[] }>(
    `/api/finance/reports/drilldown?accountCode=${code}&start=${start}&end=${end}`
  );
  if (isLoading) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!data) return null;
  if (data.lines.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">No journals in this period.</div>;
  }
  return (
    <div className="overflow-y-auto p-6">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Debit</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={`${l.transactionId}-${i}`} className="border-t align-top">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{l.txnDate}</td>
                <td className="break-words px-3 py-2">{l.description}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {l.debit ? RM(l.debit) : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {l.credit ? RM(l.credit) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Balance Sheet tab ──────────────────────────────────────────

type BsLine = { code: string; name: string; amount: number; parentCode: string | null };
type BsSection = { total: number; lines: BsLine[] };

type BsReport = {
  companyId: string;
  asOf: string;
  assets: BsSection;
  liabilities: BsSection;
  equity: BsSection;
  totalLiabilitiesAndEquity: number;
  imbalance: number;
};

function BsSectionTable({ title, total, lines }: { title: string; total: number; lines: BsLine[] }) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <header className="border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.code} className="border-t">
                <td
                  className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted-foreground"
                  style={{ paddingLeft: l.parentCode ? 32 : 12 }}
                >
                  {l.code}
                </td>
                <td className="px-3 py-1.5">{l.name}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                  {RM(l.amount)}
                </td>
              </tr>
            ))}
            <tr className="border-t bg-muted/30">
              <td colSpan={2} className="px-3 py-2 font-semibold">Total {title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold">
                {RM(total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BsTab() {
  const [asOf, setAsOf] = useState(todayMyt());
  const { data, isLoading, error, mutate } = useFetch<{ report: BsReport }>(
    `/api/finance/reports/balance-sheet?asOf=${asOf}`
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">As of</span>
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        />
        <Button onClick={() => mutate()} variant="outline" size="sm">
          Refresh
        </Button>
      </div>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load.
        </div>
      )}
      {data && (
        <>
          {data.report.imbalance !== 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                Imbalance of {RM(data.report.imbalance)} — likely an unposted period or malformed manual journal.
              </span>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <BsSectionTable title="Assets" total={data.report.assets.total} lines={data.report.assets.lines} />
            <div className="space-y-3">
              <BsSectionTable title="Liabilities" total={data.report.liabilities.total} lines={data.report.liabilities.lines} />
              <BsSectionTable title="Equity" total={data.report.equity.total} lines={data.report.equity.lines} />
              <div className="rounded-md border bg-muted/20 p-3 text-sm font-semibold">
                Liabilities + Equity:{" "}
                <span className="tabular-nums">{RM(data.report.totalLiabilitiesAndEquity)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Cash Flow tab ──────────────────────────────────────────────

type CfSection = { title: string; total: number; lines: Array<{ label: string; amount: number; code?: string }> };

type CfReport = {
  companyId: string;
  start: string;
  end: string;
  netIncome: number;
  operating: CfSection;
  investing: CfSection;
  financing: CfSection;
  netChangeInCash: number;
  cashAtStart: number;
  cashAtEnd: number;
  reconciliationGap: number;
};

function CfSectionTable({ s }: { s: CfSection }) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <header className="border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        {s.title}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5">{l.label}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                  {l.code ?? ""}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${
                    l.amount < 0 ? "text-rose-600 dark:text-rose-400" : ""
                  }`}
                >
                  {RM(l.amount)}
                </td>
              </tr>
            ))}
            <tr className="border-t bg-muted/30">
              <td colSpan={2} className="px-3 py-2 font-semibold">
                Net cash from {s.title.toLowerCase()}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold ${
                  s.total < 0 ? "text-rose-600 dark:text-rose-400" : ""
                }`}
              >
                {RM(s.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CfTab() {
  const [start, setStart] = useState(thisMonthStart());
  const [end, setEnd] = useState(todayMyt());
  const { data, isLoading, error, mutate } = useFetch<{ report: CfReport }>(
    `/api/finance/reports/cash-flow?start=${start}&end=${end}`
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        />
        <Button onClick={() => mutate()} variant="outline" size="sm">
          Refresh
        </Button>
      </div>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Failed to load.
        </div>
      )}
      {data && (
        <div className="space-y-3">
          <CfSectionTable s={data.report.operating} />
          <CfSectionTable s={data.report.investing} />
          <CfSectionTable s={data.report.financing} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground">Cash at start</div>
              <div className="truncate text-lg font-semibold tabular-nums">{RM(data.report.cashAtStart)}</div>
            </div>
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground">Net change</div>
              <div
                className={`truncate text-lg font-semibold tabular-nums ${
                  data.report.netChangeInCash < 0 ? "text-rose-600 dark:text-rose-400" : ""
                }`}
              >
                {RM(data.report.netChangeInCash)}
              </div>
            </div>
            <div className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground">Cash at end</div>
              <div className="truncate text-lg font-semibold tabular-nums">{RM(data.report.cashAtEnd)}</div>
            </div>
          </div>
          {Math.abs(data.report.reconciliationGap) > 0.01 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                Reconciliation gap of {RM(data.report.reconciliationGap)} between
                operating+investing+financing and bank-account ∆.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Auditor pack ───────────────────────────────────────────────

function AuditorPack() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Array<{ filename: string; size: number; dataUrl: string }>>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function build() {
    setBusy(true);
    setErrMsg(null);
    setFiles([]);
    try {
      const res = await fetch(`/api/finance/reports/auditor-pack?fiscalYear=${year}`);
      const j = await res.json();
      if (!res.ok) setErrMsg(j.error ?? `Failed (${res.status})`);
      else setFiles(j.files);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="font-medium">Auditor pack</span>
          <span className="hidden sm:inline text-xs text-muted-foreground truncate">
            CSV bundle for external audit
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-8 w-24 rounded-md border bg-background px-2 text-sm"
          />
          <Button onClick={build} disabled={busy} size="sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Build pack
          </Button>
        </div>
      </header>
      {errMsg && <div className="px-4 py-2 text-sm text-destructive">{errMsg}</div>}
      {files.length > 0 && (
        <ul className="divide-y">
          {files.map((f) => (
            <li key={f.filename} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate font-mono text-xs">{f.filename}</span>
              <Button
                size="xs"
                variant="outline"
                render={<a href={f.dataUrl} download={f.filename} />}
              >
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Page shell ─────────────────────────────────────────────────

// ─── Trial Balance tab ──────────────────────────────────────────
type TbRow = { code: string; name: string; type: string; debit: number; credit: number };
type Tb = { asOf: string; rows: TbRow[]; totalDebit: number; totalCredit: number; balanced: boolean };

function TbTab({ onDrill }: { onDrill: (code: string) => void }) {
  const [asOf, setAsOf] = useState(todayMyt());
  const { data, isLoading } = useFetch<{ report: Tb }>(`/api/finance/reports/trial-balance?asOf=${asOf}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">As of
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="ml-2 rounded border px-2 py-1 text-sm" />
        </label>
        {data?.report && (
          <span className={`ml-auto rounded px-2 py-1 text-xs font-medium ${data.report.balanced ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-red-500/10 text-red-600"}`}>
            {data.report.balanced ? "Balanced" : "Out of balance"}
          </span>
        )}
      </div>
      {isLoading || !data?.report ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div> : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b bg-muted/40 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Code</th><th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th><th className="px-3 py-2 text-right font-medium">Credit</th>
            </tr></thead>
            <tbody className="divide-y">
              {data.report.rows.map((r) => (
                <tr key={r.code} className="cursor-pointer hover:bg-muted/40" onClick={() => onDrill(r.code)} title="Open in General Ledger">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{r.code}</td>
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.debit ? RM(r.debit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.credit ? RM(r.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 font-semibold">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totalDebit)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totalCredit)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Click any account to open its General Ledger. Fills in as the bank→GL bridge posts.</p>
    </div>
  );
}

// ─── General Ledger tab ─────────────────────────────────────────
type GlEntry = { date: string; txnType: string; description: string; debit: number; credit: number; balance: number };
type Gl = { accountCode: string; accountName: string; start: string; end: string; opening: number; entries: GlEntry[]; closing: number; totalDebit: number; totalCredit: number };

function GlTab({ account, setAccount }: { account: string; setAccount: (c: string) => void }) {
  const [start, setStart] = useState(thisMonthStart());
  const [end, setEnd] = useState(todayMyt());
  const { data, isLoading } = useFetch<{ report: Gl }>(`/api/finance/reports/general-ledger?account=${encodeURIComponent(account)}&start=${start}&end=${end}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">Account
          <input value={account} onChange={(e) => setAccount(e.target.value.trim())} placeholder="e.g. 6000-01" className="ml-2 w-28 rounded border px-2 py-1 text-sm tabular-nums" />
        </label>
        <label className="text-xs text-muted-foreground">From
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="ml-2 rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-muted-foreground">To
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="ml-2 rounded border px-2 py-1 text-sm" />
        </label>
      </div>
      {isLoading || !data?.report ? <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div> : (
        <div className="overflow-x-auto rounded-lg border">
          <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">{data.report.accountCode} · {data.report.accountName}</div>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th><th className="px-3 py-2 text-right font-medium">Credit</th><th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr></thead>
            <tbody className="divide-y">
              <tr className="bg-muted/20 text-muted-foreground"><td className="px-3 py-1.5" colSpan={4}>Opening balance</td><td className="px-3 py-1.5 text-right tabular-nums">{RM(data.report.opening)}</td></tr>
              {data.report.entries.map((e, i) => (
                <tr key={i} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{e.date}</td>
                  <td className="px-3 py-1.5 text-xs">{e.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.debit ? RM(e.debit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{e.credit ? RM(e.credit) : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{RM(e.balance)}</td>
                </tr>
              ))}
              {data.report.entries.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-muted-foreground">No movements in this period.</td></tr>}
            </tbody>
            <tfoot><tr className="border-t-2 font-semibold">
              <td className="px-3 py-2" colSpan={2}>Period total / closing</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totalDebit)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.totalCredit)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{RM(data.report.closing)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FinanceReportsPage() {
  const [tab, setTab] = useState<"pnl" | "bs" | "cf" | "tb" | "gl" | "audit">("pnl");
  const [glAccount, setGlAccount] = useState("1000-01"); // shared so TB rows can drill into GL

  return (
    <div className="space-y-4 p-3 sm:p-6">
      <header>
        <h1 className="text-xl sm:text-2xl font-semibold">Reports</h1>
        <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground">
          P&L is source-driven (sales, procurement, ads, bank). Balance Sheet &amp; Cash Flow are ledger-based and fill in as journals post.
        </p>
      </header>

      <nav className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b">
          {[
            { id: "pnl", label: "Profit & Loss" },
            { id: "bs", label: "Balance Sheet" },
            { id: "cf", label: "Cash Flow" },
            { id: "tb", label: "Trial Balance" },
            { id: "gl", label: "General Ledger" },
            { id: "audit", label: "Auditor pack" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition ${
                tab === t.id
                  ? "border-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {(tab === "bs" || tab === "cf") && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs sm:text-sm text-amber-700 dark:text-amber-400">
          <span className="font-medium">Ledger-based — currently incomplete.</span>{" "}
          This {tab === "bs" ? "Balance Sheet" : "Cash Flow"} is built from <em>posted</em> journals, but historical journals aren&rsquo;t fully posted yet (AR is still in draft). Treat it as indicative. For accurate figures use the <strong>P&amp;L</strong> (source-driven), the <strong>Cashflow</strong> page (bank actuals), and the <strong>Ledger</strong> (real bank lines).
        </div>
      )}

      {tab === "pnl" && <PnlTab />}
      {tab === "bs" && <BsTab />}
      {tab === "cf" && <CfTab />}
      {tab === "tb" && <TbTab onDrill={(code) => { setGlAccount(code); setTab("gl"); }} />}
      {tab === "gl" && <GlTab account={glAccount} setAccount={setGlAccount} />}
      {tab === "audit" && <AuditorPack />}
    </div>
  );
}
