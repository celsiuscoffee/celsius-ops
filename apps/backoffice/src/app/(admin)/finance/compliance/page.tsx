"use client";

// Compliance — three sections in one page:
//   1. SST-02 (bi-monthly tax filing prep + mark filed)
//   2. MyInvois e-invoice (consolidated B2C submission status)
//   3. Period close (run depreciation + lock month)

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import {
  Loader2,
  ShieldCheck,
  ReceiptText,
  CalendarDays,
  Lock,
  Unlock,
  Send,
  CheckCircle2,
  XCircle,
  Wand2,
} from "lucide-react";

const RM = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

function thisMonth(): string {
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return myt.toISOString().slice(0, 7);
}

function lastMonth(): string {
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  myt.setUTCMonth(myt.getUTCMonth() - 1);
  return myt.toISOString().slice(0, 7);
}

// ─── SST-02 section ─────────────────────────────────────────────

type SstFiling = {
  id: string;
  period: string;
  output_tax: number;
  input_tax: number;
  net_payable: number;
  filing_status: "draft" | "filed" | "paid";
  filed_at: string | null;
  payment_ref: string | null;
};

function SstSection() {
  const { data, error, isLoading, mutate } = useFetch<{ filings: SstFiling[] }>("/api/finance/sst");
  const [yearMonth, setYearMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function calculate() {
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await fetch("/api/finance/sst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth }),
      });
      const j = await res.json();
      if (!res.ok) setErrMsg(j.error ?? `Failed (${res.status})`);
      else mutate();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function markFiled(period: string) {
    const ref = window.prompt(`Payment reference for ${period}?`);
    if (!ref) return;
    const res = await fetch("/api/finance/sst/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period, paymentRef: ref }),
    });
    if (res.ok) mutate();
  }

  return (
    <section className="rounded-lg border">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-4 w-4" />
          <span className="font-medium">SST-02</span>
          <span className="text-xs text-muted-foreground">bi-monthly tax filing</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
          <button
            onClick={calculate}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Calculate
          </button>
        </div>
      </header>
      {errMsg && <div className="px-4 py-2 text-sm text-rose-500">{errMsg}</div>}
      {isLoading && <div className="px-4 py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>}
      {error && <div className="px-4 py-3 text-sm text-rose-500">Failed to load.</div>}
      {data && data.filings.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No SST drafts yet. Pick a month and click Calculate.
        </div>
      )}
      {data && data.filings.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2 text-right">Output</th>
              <th className="px-3 py-2 text-right">Input</th>
              <th className="px-3 py-2 text-right">Net payable</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.filings.map((f) => (
              <tr key={f.id} className="border-t">
                <td className="px-3 py-2 tabular-nums">{f.period}</td>
                <td className="px-3 py-2 text-right tabular-nums">{RM(Number(f.output_tax))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{RM(Number(f.input_tax))}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {RM(Number(f.net_payable))}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-xs ${
                      f.filing_status === "filed"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {f.filing_status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {f.filing_status === "draft" ? (
                    <button
                      onClick={() => markFiled(f.period)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Mark filed
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{f.payment_ref}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── e-Invoice section ──────────────────────────────────────────

type EinvoiceRow = {
  id: string;
  invoice_id: string;
  myinvois_uuid: string | null;
  submission_id: string | null;
  status: string;
  submitted_at: string | null;
  validated_at: string | null;
  validation_results: unknown;
  qr_url: string | null;
  created_at: string;
};

function EinvoiceSection() {
  const { data, isLoading, mutate } = useFetch<{ submissions: EinvoiceRow[]; enabled: boolean }>(
    "/api/finance/einvoice"
  );
  const [yearMonth, setYearMonth] = useState(lastMonth());
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function submitMonth() {
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await fetch("/api/finance/einvoice/consolidated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth }),
      });
      const j = await res.json();
      if (!res.ok) setErrMsg(j.error ?? `Failed (${res.status})`);
      else mutate();
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
          <ShieldCheck className="h-4 w-4" />
          <span className="font-medium">MyInvois e-invoice</span>
          {data && (
            <span
              className={`rounded-md px-2 py-0.5 text-xs ${
                data.enabled
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {data.enabled ? "configured" : "not configured"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
          <button
            onClick={submitMonth}
            disabled={busy || !data?.enabled}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit consolidated
          </button>
        </div>
      </header>

      {!data?.enabled && (
        <div className="border-b px-4 py-3 text-sm text-muted-foreground">
          MyInvois sandbox/prod not configured. Set <code className="font-mono text-xs">MYINVOIS_ENV</code>,{" "}
          <code className="font-mono text-xs">MYINVOIS_CLIENT_ID</code>,{" "}
          <code className="font-mono text-xs">MYINVOIS_CLIENT_SECRET</code>,{" "}
          <code className="font-mono text-xs">MYINVOIS_TIN</code>,{" "}
          <code className="font-mono text-xs">MYINVOIS_BRN</code> in Vercel env to enable.
        </div>
      )}

      {errMsg && <div className="px-4 py-2 text-sm text-rose-500">{errMsg}</div>}
      {isLoading && <div className="px-4 py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>}
      {data && data.submissions.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No submissions yet.
        </div>
      )}
      {data && data.submissions.length > 0 && (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Submitted</th>
                <th className="px-3 py-2">UUID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.submissions.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {s.submitted_at ? new Date(s.submitted_at).toLocaleString("en-MY") : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{s.myinvois_uuid ?? "—"}</td>
                  <td className="px-3 py-2">
                    {s.status === "valid" || s.status === "submitted" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> {s.status}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                        <XCircle className="h-3 w-3" /> {s.status}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {Array.isArray(s.validation_results) && s.validation_results.length > 0
                      ? JSON.stringify(s.validation_results)
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Period close section ───────────────────────────────────────

type Period = {
  period: string;
  status: "open" | "closing" | "closed";
  closed_at: string | null;
  closed_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  pnl_snapshot: { netIncome?: number } | null;
};

function PeriodSection() {
  const { data, isLoading, mutate } = useFetch<{ periods: Period[] }>("/api/finance/periods");
  const [period, setPeriod] = useState(lastMonth());
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function close(lock: boolean) {
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await fetch("/api/finance/periods/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, lock }),
      });
      const j = await res.json();
      if (!res.ok) setErrMsg(j.error ?? `Failed (${res.status})`);
      else mutate();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function reopen(p: string) {
    const reason = window.prompt(`Reopen ${p}? Reason (audited):`);
    if (!reason || reason.length < 5) return;
    const res = await fetch("/api/finance/periods/reopen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: p, reason }),
    });
    if (res.ok) mutate();
    else {
      const j = await res.json();
      setErrMsg(j.error ?? "Reopen failed");
    }
  }

  return (
    <section className="rounded-lg border">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          <span className="font-medium">Period close</span>
          <span className="text-xs text-muted-foreground">
            depreciation + snapshot, optionally lock
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
          <button
            onClick={() => close(false)}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Run snapshot
          </button>
          <button
            onClick={() => close(true)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Close & lock
          </button>
        </div>
      </header>

      {errMsg && <div className="px-4 py-2 text-sm text-rose-500">{errMsg}</div>}
      {isLoading && <div className="px-4 py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>}

      {data && data.periods.length === 0 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No closed periods yet.
        </div>
      )}
      {data && data.periods.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Net income</th>
              <th className="px-3 py-2">Closed</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.periods.map((p) => (
              <tr key={p.period} className="border-t">
                <td className="px-3 py-2 tabular-nums">{p.period}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                      p.status === "closed"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {p.status === "closed" ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    {p.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {p.pnl_snapshot?.netIncome !== undefined ? RM(p.pnl_snapshot.netIncome) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {p.closed_at ? new Date(p.closed_at).toLocaleDateString("en-MY") : "—"}
                </td>
                <td className="px-3 py-2">
                  {p.status === "closed" && (
                    <button
                      onClick={() => reopen(p.period)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Reopen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function FinanceCompliancePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Compliance</h1>
        <p className="text-sm text-muted-foreground">
          SST-02 filing prep, MyInvois e-invoice, and period close.
        </p>
      </header>

      <SstSection />
      <EinvoiceSection />
      <PeriodSection />
    </div>
  );
}
