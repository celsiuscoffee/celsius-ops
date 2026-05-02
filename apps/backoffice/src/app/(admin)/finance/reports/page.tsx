"use client";

// Reports — three live financial statements (P&L, Balance Sheet, Cash Flow)
// + auditor pack export. Date pickers, company picker (via cookie), drill
// down by clicking any line in the P&L.

import { useState, useMemo } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, Download, FileText, X } from "lucide-react";

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

type PnlReport = {
  companyId: string;
  start: string;
  end: string;
  income: { total: number; lines: Array<{ code: string; name: string; amount: number; parentCode: string | null }> };
  cogs: { total: number; lines: Array<{ code: string; name: string; amount: number; parentCode: string | null }> };
  grossProfit: number;
  expenses: { total: number; lines: Array<{ code: string; name: string; amount: number; parentCode: string | null }> };
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

function PnlTab() {
  const [start, setStart] = useState(thisMonthStart());
  const [end, setEnd] = useState(todayMyt());
  const qs = useMemo(() => `start=${start}&end=${end}`, [start, end]);
  const { data, error, isLoading, mutate } = useFetch<{ report: PnlReport }>(
    `/api/finance/reports/pnl?${qs}`
  );
  const [drillCode, setDrillCode] = useState<string | null>(null);

  function ReportRow({ code, name, amount, indent = 0 }: { code: string; name: string; amount: number; indent?: number }) {
    return (
      <tr className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setDrillCode(code)}>
        <td className="px-3 py-1.5 text-xs tabular-nums" style={{ paddingLeft: 12 + indent * 16 }}>
          {code}
        </td>
        <td className="px-3 py-1.5">{name}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{RM(amount)}</td>
      </tr>
    );
  }

  function TotalRow({ label, amount, bold = true }: { label: string; amount: number; bold?: boolean }) {
    return (
      <tr className="border-t bg-muted/30">
        <td colSpan={2} className={`px-3 py-2 ${bold ? "font-semibold" : ""}`}>
          {label}
        </td>
        <td className={`px-3 py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>
          {RM(amount)}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm" />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm" />
        <button onClick={() => mutate()} className="rounded-md border px-3 py-1 text-sm hover:bg-muted">
          Refresh
        </button>
      </div>

      {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {error && <div className="text-sm text-rose-500">Failed to load.</div>}

      {data && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={3} className="bg-emerald-500/5 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">Income</td></tr>
              {data.report.income.lines.map((l) => (
                <ReportRow key={l.code} code={l.code} name={l.name} amount={l.amount} indent={l.parentCode ? 1 : 0} />
              ))}
              <TotalRow label="Total Income" amount={data.report.income.total} />

              <tr><td colSpan={3} className="bg-rose-500/5 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">Cost of Sales</td></tr>
              {data.report.cogs.lines.map((l) => (
                <ReportRow key={l.code} code={l.code} name={l.name} amount={l.amount} indent={l.parentCode ? 1 : 0} />
              ))}
              <TotalRow label="Total COGS" amount={data.report.cogs.total} />
              <TotalRow label="Gross Profit" amount={data.report.grossProfit} />

              <tr><td colSpan={3} className="bg-rose-500/5 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">Expenses</td></tr>
              {data.report.expenses.lines.map((l) => (
                <ReportRow key={l.code} code={l.code} name={l.name} amount={l.amount} indent={l.parentCode ? 1 : 0} />
              ))}
              <TotalRow label="Total Expenses" amount={data.report.expenses.total} />

              <TotalRow label="Net Income" amount={data.report.netIncome} />
            </tbody>
          </table>
        </div>
      )}

      {drillCode && data && (
        <DrillDownDrawer
          code={drillCode}
          start={data.report.start}
          end={data.report.end}
          onClose={() => setDrillCode(null)}
        />
      )}
    </div>
  );
}

function DrillDownDrawer({ code, start, end, onClose }: { code: string; start: string; end: string; onClose: () => void }) {
  const { data, isLoading } = useFetch<{ lines: DrillLine[] }>(
    `/api/finance/reports/drilldown?accountCode=${code}&start=${start}&end=${end}`
  );
  return (
    <div className="fixed inset-0 z-50 flex">
      <button className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-2xl overflow-y-auto bg-background p-6 shadow-xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{code} — drill down</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>
        {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {data && data.lines.length === 0 && (
          <div className="text-sm text-muted-foreground">No journals in this period.</div>
        )}
        {data && data.lines.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1.5">Date</th>
                <th className="py-1.5">Description</th>
                <th className="py-1.5 text-right">Debit</th>
                <th className="py-1.5 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={`${l.transactionId}-${l.txnDate}`} className="border-t">
                  <td className="py-1.5 tabular-nums">{l.txnDate}</td>
                  <td className="py-1.5">{l.description}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.debit ? RM(l.debit) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.credit ? RM(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </aside>
    </div>
  );
}

// ─── Balance Sheet tab ──────────────────────────────────────────

type BsReport = {
  companyId: string;
  asOf: string;
  assets: { total: number; lines: Array<{ code: string; name: string; amount: number; parentCode: string | null }> };
  liabilities: { total: number; lines: Array<{ code: string; name: string; amount: number; parentCode: string | null }> };
  equity: { total: number; lines: Array<{ code: string; name: string; amount: number; parentCode: string | null }> };
  totalLiabilitiesAndEquity: number;
  imbalance: number;
};

function BsTab() {
  const [asOf, setAsOf] = useState(todayMyt());
  const { data, isLoading, error, mutate } = useFetch<{ report: BsReport }>(
    `/api/finance/reports/balance-sheet?asOf=${asOf}`
  );

  function Section({ title, total, lines }: { title: string; total: number; lines: BsReport["assets"]["lines"] }) {
    return (
      <div className="rounded-md border">
        <header className="border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          {title}
        </header>
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.code} className="border-t">
                <td className="px-3 py-1.5 text-xs tabular-nums" style={{ paddingLeft: 12 + (l.parentCode ? 16 : 0) }}>
                  {l.code}
                </td>
                <td className="px-3 py-1.5">{l.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{RM(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t bg-muted/30">
              <td colSpan={2} className="px-3 py-2 font-semibold">Total {title}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">{RM(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">As of</span>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm" />
        <button onClick={() => mutate()} className="rounded-md border px-3 py-1 text-sm hover:bg-muted">
          Refresh
        </button>
      </div>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {error && <div className="text-sm text-rose-500">Failed to load.</div>}
      {data && (
        <>
          {data.report.imbalance !== 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              ⚠ Imbalance of {RM(data.report.imbalance)} — likely an unposted period or malformed manual journal.
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            <Section title="Assets" total={data.report.assets.total} lines={data.report.assets.lines} />
            <div className="space-y-3">
              <Section title="Liabilities" total={data.report.liabilities.total} lines={data.report.liabilities.lines} />
              <Section title="Equity" total={data.report.equity.total} lines={data.report.equity.lines} />
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm font-semibold">
                Liabilities + Equity: {RM(data.report.totalLiabilitiesAndEquity)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Cash Flow tab ──────────────────────────────────────────────

type CfReport = {
  companyId: string;
  start: string;
  end: string;
  netIncome: number;
  operating: { title: string; total: number; lines: Array<{ label: string; amount: number; code?: string }> };
  investing: { title: string; total: number; lines: Array<{ label: string; amount: number; code?: string }> };
  financing: { title: string; total: number; lines: Array<{ label: string; amount: number; code?: string }> };
  netChangeInCash: number;
  cashAtStart: number;
  cashAtEnd: number;
  reconciliationGap: number;
};

function CfTab() {
  const [start, setStart] = useState(thisMonthStart());
  const [end, setEnd] = useState(todayMyt());
  const { data, isLoading, error, mutate } = useFetch<{ report: CfReport }>(
    `/api/finance/reports/cash-flow?start=${start}&end=${end}`
  );

  function Section({ s }: { s: CfReport["operating"] }) {
    return (
      <div className="rounded-md border">
        <header className="border-b bg-muted/30 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          {s.title}
        </header>
        <table className="w-full text-sm">
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-1.5">{l.label}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{l.code ?? ""}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${l.amount < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{RM(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t bg-muted/30">
              <td colSpan={2} className="px-3 py-2 font-semibold">Net cash from {s.title.toLowerCase()}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${s.total < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{RM(s.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm" />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm" />
        <button onClick={() => mutate()} className="rounded-md border px-3 py-1 text-sm hover:bg-muted">
          Refresh
        </button>
      </div>
      {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {error && <div className="text-sm text-rose-500">Failed to load.</div>}
      {data && (
        <div className="space-y-3">
          <Section s={data.report.operating} />
          <Section s={data.report.investing} />
          <Section s={data.report.financing} />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Cash at start</div>
              <div className="text-lg font-semibold tabular-nums">{RM(data.report.cashAtStart)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Net change</div>
              <div className={`text-lg font-semibold tabular-nums ${data.report.netChangeInCash < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>
                {RM(data.report.netChangeInCash)}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Cash at end</div>
              <div className="text-lg font-semibold tabular-nums">{RM(data.report.cashAtEnd)}</div>
            </div>
          </div>
          {Math.abs(data.report.reconciliationGap) > 0.01 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              ⚠ Reconciliation gap of {RM(data.report.reconciliationGap)} between operating+investing+financing and bank-account ∆.
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
    <section className="rounded-lg border">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span className="font-medium">Auditor pack</span>
          <span className="text-xs text-muted-foreground">CSV bundle for external audit</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
          />
          <button
            onClick={build}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Build pack
          </button>
        </div>
      </header>
      {errMsg && <div className="px-4 py-2 text-sm text-rose-500">{errMsg}</div>}
      {files.length > 0 && (
        <ul className="divide-y">
          {files.map((f) => (
            <li key={f.filename} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="font-mono">{f.filename}</span>
              <a href={f.dataUrl} download={f.filename} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Page shell ─────────────────────────────────────────────────

export default function FinanceReportsPage() {
  const [tab, setTab] = useState<"pnl" | "bs" | "cf" | "audit">("pnl");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          P&L, Balance Sheet, and Cash Flow — generated live from the ledger.
        </p>
      </header>

      <nav className="flex gap-1 border-b">
        {[
          { id: "pnl", label: "Profit & Loss" },
          { id: "bs", label: "Balance Sheet" },
          { id: "cf", label: "Cash Flow" },
          { id: "audit", label: "Auditor pack" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.id ? "border-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "pnl" && <PnlTab />}
      {tab === "bs" && <BsTab />}
      {tab === "cf" && <CfTab />}
      {tab === "audit" && <AuditorPack />}
    </div>
  );
}
