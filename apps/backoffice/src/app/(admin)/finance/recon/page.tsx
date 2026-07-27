"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { OUTFLOW_CATEGORIES, INFLOW_CATEGORIES, categoryLabel } from "@/lib/finance/cash-categories";
import { Loader2, CheckCircle2, AlertTriangle, HelpCircle, Copy, ArrowDownCircle, Paperclip, History } from "lucide-react";

type ApMatch = {
  invoiceId: string; invoiceNumber: string | null; payee: string; amount: number; issueDate: string;
  bankLineId: string; bankDesc: string; bankDate: string; bankCategory: string | null;
  score: number; tier: "auto" | "review"; reasons: string[]; alreadyPaid: boolean;
};
type CashIn = {
  from: string; to: string; salesGross: number; settlementsTotal: number; gap: number; gapPct: number | null;
  settlementsByChannel: { channel: string; amount: number; n: number }[];
  salesByChannel: { channel: string; amount: number }[];
  grab: { gross: number; settled: number; deductionPct: number | null };
};
type UnmatchedLine = { bankLineId: string; desc: string; date: string; amount: number; category: string | null; expenseMonth: string | null };
type ReconData = {
  summary: {
    auto: number; review: number; doublePayments: number; unmatchedInvoices: number;
    unmatchedOutflows: number; unmatchedOutflowValue: number;
    unmatchedInflows: number; unmatchedInflowValue: number;
  };
  auto: ApMatch[]; review: ApMatch[]; doublePayments: ApMatch[];
  unmatchedInvoices: { invoiceId: string; invoiceNumber: string | null; payee: string; amount: number; issueDate: string }[];
  unmatchedOutflows: UnmatchedLine[];
  unmatchedInflows: UnmatchedLine[];
  cashIn: CashIn;
};

const fmtRM = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtRM0 = (n: number) => `RM ${n.toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;

// Category lists + labels live in @/lib/finance/cash-categories (shared with
// the Reports drill-down so both offer the same recategorization choices).

type ReconTab = "categorise" | "review" | "matched" | "invoices" | "cashin" | "bankrecon";

export default function ReconPage() {
  const [days, setDays] = useState(90);
  const [tab, setTab] = useState<ReconTab>("categorise");
  const { data, isLoading, mutate } = useFetch<ReconData>(`/api/finance/ap-match?sinceDays=${days}`);
  const { data: acctData } = useFetch<{ accounts: { code: string; name: string }[] }>("/api/finance/accounts");
  const accountNames = new Map((acctData?.accounts ?? []).map((a) => [a.code, a.name]));
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassNote, setReclassNote] = useState<string | null>(null);

  async function rerunRules() {
    setReclassifying(true);
    setReclassNote(null);
    try {
      // full sweep: learned corrections must also fix lines a generic rule
      // already (mis)classified, not just the OTHER_* pile.
      const res = await fetch("/api/finance/reclassify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full: true }),
      });
      const j = await res.json();
      setReclassNote(res.ok
        ? `Re-classified ${j.changed} lines (RM ${Math.round(j.changedValue).toLocaleString("en-MY")}); ${j.unstampedJournals} journals queued for GL re-key.`
        : `Failed: ${j.error ?? res.status}`);
      mutate();
    } catch (e) {
      setReclassNote(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReclassifying(false);
    }
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Reconciliation</h2>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">
            Cash out AND cash in: payments matched to invoices, receipts matched to their source. The loop auto-applies high-confidence matches; the rest is your queue — every manual pick books straight to the chart of accounts.
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
          {[30, 90, 180].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${days === d ? "bg-terracotta text-white" : "text-gray-600 hover:bg-gray-50"}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="mt-6 flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* Summary tiles — click to jump to that queue */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-6 gap-2 sm:gap-3">
            <Tile icon={<ArrowDownCircle className="h-4 w-4 text-gray-500" />} label="Unmatched out" value={data.summary.unmatchedOutflows} sub={fmtRM0(data.summary.unmatchedOutflowValue)} tone="gray" onClick={() => setTab("categorise")} active={tab === "categorise"} />
            <Tile icon={<ArrowDownCircle className="h-4 w-4 rotate-180 text-gray-500" />} label="Unmatched in" value={data.summary.unmatchedInflows} sub={fmtRM0(data.summary.unmatchedInflowValue)} tone="gray" onClick={() => setTab("categorise")} active={tab === "categorise"} />
            <Tile icon={<HelpCircle className="h-4 w-4 text-amber-600" />} label="Needs review" value={data.summary.review} tone="amber" onClick={() => setTab("review")} active={tab === "review"} />
            <Tile icon={<Copy className="h-4 w-4 text-red-600" />} label="Double payments" value={data.summary.doublePayments} tone={data.summary.doublePayments ? "red" : "gray"} onClick={() => setTab("review")} active={tab === "review"} />
            <Tile icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} label="Auto-matched" value={data.summary.auto} tone="green" onClick={() => setTab("review")} active={tab === "review"} />
            <Tile icon={<AlertTriangle className="h-4 w-4 text-gray-500" />} label="Open invoices" value={data.summary.unmatchedInvoices} tone="gray" onClick={() => setTab("invoices")} active={tab === "invoices"} />
          </div>

          {/* Queue switcher — one focused table at a time */}
          <nav className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
            {([
              ["categorise", "To categorise", data.summary.unmatchedOutflows + data.summary.unmatchedInflows],
              ["review", "To review", data.summary.review + data.summary.doublePayments],
              ["matched", "Matched", null],
              ["invoices", "Open invoices", data.summary.unmatchedInvoices],
              ["cashin", "Cash-in", null],
              ["bankrecon", "Bank recon", null],
            ] as [ReconTab, string, number | null][]).map(([id, label, count]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${tab === id ? "border-terracotta font-medium text-gray-900" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                {label}{count != null && count > 0 ? <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-500">{count}</span> : null}
              </button>
            ))}
          </nav>

          <div className="mt-4">
            {tab === "categorise" && (
              <div className="space-y-4">
                <QueueCard title="Unmatched outflows — cash out" desc="Bank payments with no matching invoice yet. Book a category, match to an invoice, or attach a receipt.">
                  <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
                    <button onClick={rerunRules} disabled={reclassifying}
                      className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      {reclassifying ? "Re-running rules…" : "Re-run classifier rules"}
                    </button>
                    <span className="text-[11px] text-gray-400">{reclassNote ?? "Applies current rules first — known payees clear automatically."}</span>
                  </div>
                  <UnmatchedTable rows={data.unmatchedOutflows} direction="DR" categories={OUTFLOW_CATEGORIES} accountNames={accountNames} onDone={() => mutate()} />
                </QueueCard>
                <QueueCard title="Unmatched inflows — cash in" desc="Money in with no recognised source. Sales settlements clear their debtor; loans/capital book to the balance sheet.">
                  <UnmatchedTable rows={data.unmatchedInflows} direction="CR" categories={INFLOW_CATEGORIES} accountNames={accountNames} onDone={() => mutate()} />
                </QueueCard>
              </div>
            )}

            {tab === "review" && (
              <div className="space-y-4">
                {data.doublePayments.length > 0 && (
                  <QueueCard title="⚠ Possible double payments" desc="Invoice already settled but another bank payment matches it.">
                    <MatchTable rows={data.doublePayments} />
                  </QueueCard>
                )}
                <QueueCard title="Needs review" desc="Likely matches not certain enough to auto-clear. Confirm links the line and marks the invoice paid (unless settled elsewhere); Reject dismisses it for good. Select rows for bulk.">
                  <MatchTable rows={data.review} showReasons actionable onDone={() => mutate()} />
                </QueueCard>
                <QueueCard title="Auto-matched (high confidence)" desc="Amount-exact + payee name + date. The loop already cleared these and re-tagged the bank line to COGS.">
                  <MatchTable rows={data.auto} />
                </QueueCard>
              </div>
            )}

            {tab === "matched" && (
              <QueueCard title="Matched lines" desc="Everything linked to an invoice, newest first. Unmatch reverses it: link removed, invoice paid-status reverted only if this match paid it, and the pair never auto-matches again.">
                <MatchedTable />
              </QueueCard>
            )}

            {tab === "invoices" && (
              <QueueCard title="Open invoices — no payment found" desc="Procurement invoices with no matching bank payment yet. Either unpaid, or paid via an outflow not matched.">
                <OpenInvoicesTable rows={data.unmatchedInvoices} />
              </QueueCard>
            )}

            {tab === "cashin" && (
              <QueueCard title={`Cash-in — sales vs settlements (${data.cashIn.from} → ${data.cashIn.to})`} desc="What the POS rang up vs what landed in the bank. The gap is fees + platform commission + cash-not-banked + settlement timing.">
                <div className="grid grid-cols-3 gap-3 px-4 py-3">
                  <div><p className="text-[11px] text-gray-500">Sales rung up</p><p className="font-mono text-sm font-semibold text-gray-900">{fmtRM(data.cashIn.salesGross)}</p></div>
                  <div><p className="text-[11px] text-gray-500">Settled to bank</p><p className="font-mono text-sm font-semibold text-gray-900">{fmtRM(data.cashIn.settlementsTotal)}</p></div>
                  <div><p className="text-[11px] text-gray-500">Gap</p><p className={`font-mono text-sm font-semibold ${Math.abs(data.cashIn.gapPct ?? 0) > 12 ? "text-red-600" : "text-amber-600"}`}>{fmtRM(data.cashIn.gap)}{data.cashIn.gapPct != null && <span className="text-[11px] font-normal text-gray-400"> ({data.cashIn.gapPct}%)</span>}</p></div>
                </div>
                <div className="overflow-x-auto border-t border-gray-100">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
                      <th className="px-3 py-2 font-medium">Channel</th><th className="px-3 py-2 text-right font-medium">Settled</th><th className="px-3 py-2 text-right font-medium">Txns</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {data.cashIn.settlementsByChannel.map((c) => (
                        <tr key={c.channel} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5 text-xs text-gray-700">{c.channel}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs text-green-700">+{fmtRM(c.amount)}</td>
                          <td className="px-3 py-1.5 text-right text-[11px] text-gray-400">{c.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.cashIn.grab.deductionPct != null && (
                  <p className={`border-t border-gray-100 px-4 py-2 text-[11px] ${data.cashIn.grab.deductionPct > 45 ? "text-red-600" : "text-gray-500"}`}>
                    Grab: gross {fmtRM(data.cashIn.grab.gross)} vs settled {fmtRM(data.cashIn.grab.settled)} → <strong>{data.cashIn.grab.deductionPct}% deducted</strong> at source (commission + promos + timing){data.cashIn.grab.deductionPct > 45 ? " — high, review" : ""}.
                  </p>
                )}
              </QueueCard>
            )}

            {tab === "bankrecon" && <BankReconPanel />}
          </div>
        </>
      )}
    </div>
  );
}

// Bank reconciliation tick.
// The owner's monthly checklist: per account, does opening balance + the
// month's ledger lines land exactly on the statement closing balance?
// Zero delta earns a green check and can be signed off; anything else means
// lines are missing or duplicated, or the statement balance is wrong.

type ReconMonth = {
  month: string;
  opening: number | null;
  linesTotal: number;
  computedClose: number | null;
  statedClose: number | null;
  delta: number | null;
  unclassified: number;
  hasStatement: boolean;
  signedOffBy: string | null;
  signedOffAt: string | null;
};
type BankReconData = { accounts: { account: string; months: ReconMonth[] }[] };

const fmtMonth = (m: string) =>
  new Date(`${m}T00:00:00.000Z`).toLocaleDateString("en-MY", { month: "short", year: "numeric", timeZone: "UTC" });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });

function BankReconPanel() {
  const { data, isLoading, mutate } = useFetch<BankReconData>("/api/finance/bank-recon");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function signOff(account: string, month: string, undo: boolean) {
    setBusy(account + month); setNote(null);
    try {
      const res = await fetch("/api/finance/bank-recon", {
        method: undo ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, month }),
      });
      const j = await res.json();
      if (!res.ok) setNote(j.error ?? `Failed (${res.status})`);
      else mutate();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  if (isLoading || !data) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>;
  if (data.accounts.length === 0) return <p className="px-4 py-4 text-xs text-gray-400">No bank statements uploaded yet.</p>;

  return (
    <div className="space-y-4">
      {note && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{note}</p>}
      {data.accounts.map(({ account, months }) => (
        <QueueCard key={account} title={`Bank recon: ${account}`} desc="Opening balance plus the month's ledger lines must equal the statement close. Sign off each month once the delta is zero.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 text-right font-medium">Opening</th>
                <th className="px-3 py-2 text-right font-medium">Lines total</th>
                <th className="px-3 py-2 text-right font-medium">Computed close</th>
                <th className="px-3 py-2 text-right font-medium">Statement close</th>
                <th className="px-3 py-2 text-right font-medium">Delta</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr></thead>
              <tbody className="divide-y">
                {months.map((m) => {
                  const key = account + m.month;
                  if (!m.hasStatement) {
                    return (
                      <tr key={key} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtMonth(m.month)}</td>
                        <td colSpan={6} className="px-3 py-2 text-[11px] text-gray-400">no statement</td>
                      </tr>
                    );
                  }
                  const reconciled = m.delta != null && Math.abs(m.delta) <= 0.01;
                  return (
                    <tr key={key} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">{fmtMonth(m.month)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-gray-600">{m.opening == null ? <span className="text-gray-400">no prior statement</span> : fmtRM(m.opening)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-gray-600">
                        {fmtRM(m.linesTotal)}
                        {m.unclassified > 0 && <div className="text-[10px] font-sans text-amber-600">{m.unclassified} unclassified</div>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{m.computedClose == null ? "" : fmtRM(m.computedClose)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{m.statedClose == null ? "" : fmtRM(m.statedClose)}</td>
                      <td className="px-3 py-2 text-right">
                        {m.delta == null ? (
                          <span className="text-[11px] text-gray-400">n/a</span>
                        ) : reconciled ? (
                          <CheckCircle2 className="ml-auto h-4 w-4 text-green-600" />
                        ) : (
                          <span className="font-mono text-xs text-rose-600" title="lines missing or duplicated, or statement balance wrong">
                            {fmtRM(m.delta)}
                            <div className="text-[10px] font-sans text-rose-400">lines missing or duplicated, or statement balance wrong</div>
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {m.signedOffBy ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                              Reconciled by {m.signedOffBy}{m.signedOffAt ? ` on ${fmtDay(m.signedOffAt)}` : ""}
                            </span>
                            <button onClick={() => signOff(account, m.month, true)} disabled={busy === key}
                              className="text-[10px] text-gray-400 underline hover:text-gray-600 disabled:opacity-50">
                              undo
                            </button>
                          </span>
                        ) : reconciled ? (
                          <button onClick={() => signOff(account, m.month, false)} disabled={busy === key}
                            className="rounded border border-green-600/30 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
                            {busy === key ? "Signing off" : "Sign off"}
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400">fix delta first</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </QueueCard>
      ))}
    </div>
  );
}

// Selection-aware table for an unmatched section: the search box narrows the
// list (description, date or amount), the header checkbox selects everything
// that matches the search (not just the visible page), and the bulk bar books
// the whole selection to one category in a single call (classifiedBy='user',
// affected GL journals re-keyed). Search then select-all then book is the
// fast path for repetitive lines like "Q1 2026 Divide" transfers.
function UnmatchedTable({ rows, direction, categories, accountNames, onDone }: {
  rows: UnmatchedLine[];
  direction: "DR" | "CR";
  categories: readonly string[];
  accountNames: Map<string, string>;
  onDone: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);
  const t = q.trim().toLowerCase();
  const filtered = t
    ? rows.filter((r) =>
        r.desc.toLowerCase().includes(t) ||
        r.date.includes(t) ||
        String(Math.abs(r.amount)).includes(t.replace(/,/g, "")))
    : rows;
  const visible = filtered.slice(0, pageSize);
  // Select-all covers every filtered match, beyond the visible page — the
  // bulk call chunks itself to the endpoint's 200-line cap.
  const allSelected = filtered.length > 0 && filtered.every((r) => sel.has(r.bankLineId));

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(filtered.map((r) => r.bankLineId)));
  }
  async function bulkClassify(category: string) {
    if (!category || sel.size === 0) return;
    setBusy(true); setNote(null);
    try {
      // The endpoint takes at most 200 lines per call; chunk bigger selections.
      const ids = [...sel];
      let classified = 0, skipped = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const res = await fetch("/api/finance/bank-lines/classify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bankLineIds: ids.slice(i, i + 200), category }),
        });
        const j = await res.json();
        if (!res.ok) { setNote(j.error ?? `Failed (${res.status})`); return; }
        classified += j.classified ?? 0;
        skipped += j.skippedMatched ?? 0;
      }
      setNote(`Booked ${classified} lines to ${category.toLowerCase().replace(/_/g, " ")}${skipped ? ` (${skipped} skipped: AP-matched)` : ""}.`);
      setSel(new Set());
      onDone();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search description, date or amount…"
          className="h-7 w-64 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700"
        />
        <span className="text-[11px] text-gray-400 tabular-nums">
          {t ? `${filtered.length} of ${rows.length} lines` : `${rows.length} lines`}
        </span>
        <span className="ml-auto"><RowsPerPage value={pageSize} onChange={setPageSize} total={filtered.length} /></span>
      </div>
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-terracotta/30 bg-terracotta/5 px-4 py-2">
          <span className="text-xs font-medium text-gray-700">{sel.size} selected</span>
          <select
            defaultValue=""
            disabled={busy}
            onChange={(e) => { bulkClassify(e.target.value); e.target.value = ""; }}
            className="h-7 max-w-[260px] rounded border border-gray-200 bg-white px-1 text-xs text-gray-700 disabled:opacity-50"
          >
            <option value="" disabled>Book all selected to…</option>
            {categories.map((c) => <option key={c} value={c}>{categoryLabel(c, accountNames)}</option>)}
          </select>
          <button onClick={() => setSel(new Set())} disabled={busy} className="text-[11px] text-gray-500 underline">clear</button>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
        </div>
      )}
      {note && <p className="border-b border-gray-100 px-4 py-1.5 text-[11px] text-gray-500">{note}</p>}
      <table className="w-full min-w-[800px] text-sm">
        <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
          <th className="w-8 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5 accent-terracotta" /></th>
          <th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Description</th>
          <th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 text-right font-medium">Amount</th>
          <th className="px-3 py-2 font-medium">Reconcile</th>
        </tr></thead>
        <tbody className="divide-y">
          {visible.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-4 text-xs text-gray-400">{t ? "No lines match the search." : "Nothing here."}</td></tr>
          ) : visible.map((o) => (
            <LineRow key={o.bankLineId} row={o} direction={direction} categories={categories} accountNames={accountNames}
              selected={sel.has(o.bankLineId)} onToggle={() => toggle(o.bankLineId)} onDone={onDone} />
          ))}
        </tbody>
      </table>
      {filtered.length > pageSize && (
        <p className="px-3 py-2 text-[11px] text-gray-400">
          Showing {pageSize} of {filtered.length} by amount. Select-all still selects every match, including rows not shown.
        </p>
      )}
    </div>
  );
}

type Candidate = {
  invoiceId: string; invoiceNumber: string | null; payee: string; amount: number;
  issueDate: string; status: string; linkOnly: boolean;
  amountExact: boolean; refHit: boolean; nameHit: boolean; score: number;
};

// One unmatched bank line with its manual-reconcile controls: a category
// select labeled with the COA account it books to (the GL re-keys on the next
// loop run), and — for outflows — a Match panel listing candidate invoices.
function LineRow({ row, direction, categories, accountNames, selected, onToggle, onDone }: {
  row: UnmatchedLine;
  direction: "DR" | "CR";
  categories: readonly string[];
  accountNames: Map<string, string>;
  selected: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; filename: string; url: string | null }[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachDragging, setAttachDragging] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [events, setEvents] = useState<LineEvent[] | null>(null);

  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && events === null) {
      fetch(`/api/finance/bank-lines/events?lineId=${row.bankLineId}`)
        .then((res) => res.json().then((j) => setEvents(res.ok ? j.events : [])))
        .catch(() => setEvents([]));
    }
  }

  async function loadAttachments() {
    try {
      const res = await fetch(`/api/finance/bank-lines/attach?bankLineId=${row.bankLineId}`);
      const j = await res.json();
      setAttachments(res.ok ? j.attachments : []);
    } catch { setAttachments([]); }
  }
  function toggleAttach() {
    const next = !attachOpen;
    setAttachOpen(next);
    if (next && attachments === null) loadAttachments();
  }
  async function upload(file: File) {
    setUploading(true); setNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bankLineId", row.bankLineId);
      const res = await fetch("/api/finance/bank-lines/attach", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) setNote(j.error ?? `Upload failed (${res.status})`);
      else await loadAttachments();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); }
  }
  async function removeAttachment(id: string) {
    await fetch("/api/finance/bank-lines/attach", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: id }) });
    loadAttachments();
  }

  async function setCategory(category: string) {
    if (!category) return;
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/finance/bank-lines/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: row.bankLineId, category }),
      });
      const j = await res.json();
      if (!res.ok) setNote(j.error ?? `Failed (${res.status})`);
      else onDone();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function openMatch() {
    setOpen((v) => !v);
    if (cands || open) return;
    try {
      const res = await fetch(`/api/finance/bank-lines/match?bankLineId=${row.bankLineId}`);
      const j = await res.json();
      setCands(res.ok ? j.candidates : []);
      if (!res.ok) setNote(j.error ?? `Failed (${res.status})`);
    } catch (e) { setCands([]); setNote(e instanceof Error ? e.message : String(e)); }
  }

  async function applyMatch(invoiceId: string) {
    setBusy(true); setNote(null);
    try {
      const res = await fetch("/api/finance/bank-lines/match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: row.bankLineId, invoiceId }),
      });
      const j = await res.json();
      if (!res.ok) setNote(j.error ?? `Failed (${res.status})`);
      else onDone();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <tr className={selected ? "bg-terracotta/5" : "hover:bg-gray-50"}>
        <td className="px-3 py-2 align-top">
          <input type="checkbox" checked={selected} onChange={onToggle} className="h-3.5 w-3.5 accent-terracotta" />
        </td>
        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap align-top">
          {row.date}
          {row.expenseMonth && (
            <div className="text-[10px] text-amber-600" title="Expense month override: this line sits in this month on the P&L">
              → {row.expenseMonth}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-gray-700 align-top">
          {row.desc}
          {note && <div className="mt-0.5 text-[10px] text-red-600">{note}</div>}
        </td>
        <td className="px-3 py-2 text-[11px] text-gray-400 align-top">{row.category ?? "Unclassified"}</td>
        <td className={`px-3 py-2 text-right font-mono text-xs align-top ${direction === "DR" ? "text-red-700" : "text-green-700"}`}>{direction === "DR" ? "−" : "+"}{fmtRM(row.amount)}</td>
        <td className="px-3 py-2 align-top">
          <div className="flex items-center gap-1.5">
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => setCategory(e.target.value)}
              className="h-6 max-w-[220px] rounded border border-gray-200 bg-white px-1 text-[11px] text-gray-700 disabled:opacity-50"
              title="Book this line to a category — the label shows the COA account it posts to"
            >
              <option value="" disabled>Set category…</option>
              {categories.map((c) => <option key={c} value={c}>{categoryLabel(c, accountNames)}</option>)}
            </select>
            {direction === "DR" && (
              <button
                onClick={openMatch}
                disabled={busy}
                className={`h-6 rounded border px-1.5 text-[11px] font-medium disabled:opacity-50 ${open ? "border-terracotta text-terracotta" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
              >
                Match…
              </button>
            )}
            <button
              onClick={toggleAttach}
              disabled={busy}
              title="Attach the invoice or receipt behind this line (needed for bank fees & other non-supplier expenses)"
              className={`flex h-6 items-center gap-0.5 rounded border px-1.5 text-[11px] font-medium disabled:opacity-50 ${attachOpen ? "border-terracotta text-terracotta" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
            >
              <Paperclip className="h-3 w-3" />{attachments && attachments.length > 0 ? attachments.length : ""}
            </button>
            <button
              onClick={toggleHistory}
              disabled={busy}
              title="Who changed this line's category or match, and when"
              className={`flex h-6 items-center rounded border px-1.5 text-[11px] font-medium disabled:opacity-50 ${historyOpen ? "border-terracotta text-terracotta" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
            >
              <History className="h-3 w-3" />
            </button>
            <ExpenseMonthControl
              bankLineId={row.bankLineId}
              txnMonth={row.date.slice(0, 7)}
              override={row.expenseMonth}
              onDone={onDone}
            />
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60">
          <td colSpan={6} className="px-3 py-2">
            {!cands ? (
              <span className="text-[11px] text-gray-400">Looking for candidate invoices…</span>
            ) : cands.length === 0 ? (
              <span className="text-[11px] text-gray-400">No candidate invoices near this amount/date. Set a category instead.</span>
            ) : (
              <div className="flex flex-col gap-1">
                {cands.map((c) => (
                  <div key={c.invoiceId} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1">
                    <span className="text-xs text-gray-700">{c.payee}{c.invoiceNumber ? <span className="text-gray-400"> · {c.invoiceNumber}</span> : ""}</span>
                    <span className="font-mono text-[11px] text-gray-600">{fmtRM(c.amount)}</span>
                    <span className="text-[10px] text-gray-400">{c.issueDate}</span>
                    {c.amountExact && <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">amount exact</span>}
                    {c.refHit && <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">invoice no in line</span>}
                    {c.nameHit && <span className="rounded bg-green-50 px-1 text-[10px] text-green-700">name hit</span>}
                    {c.linkOnly && <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700">already paid — link only</span>}
                    <button
                      onClick={() => applyMatch(c.invoiceId)}
                      disabled={busy}
                      className="ml-auto h-6 rounded bg-terracotta px-2 text-[11px] font-medium text-white disabled:opacity-50"
                    >
                      Match
                    </button>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
      {attachOpen && (
        <tr className="bg-gray-50/60">
          <td colSpan={6} className="px-3 py-2">
            <div className="flex flex-col gap-1.5">
              {attachments === null ? (
                <span className="text-[11px] text-gray-400">Loading attachments…</span>
              ) : attachments.length === 0 ? (
                <span className="text-[11px] text-gray-400">No invoice or receipt attached yet.</span>
              ) : attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <Paperclip className="h-3 w-3 text-gray-400" />
                  {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="text-terracotta underline">{a.filename}</a> : <span className="text-gray-700">{a.filename}</span>}
                  <button onClick={() => removeAttachment(a.id)} className="text-[10px] text-gray-400 underline hover:text-gray-600">remove</button>
                </div>
              ))}
              <label
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setAttachDragging(true); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setAttachDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setAttachDragging(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setAttachDragging(false);
                  if (uploading) return;
                  const f = e.dataTransfer.files?.[0];
                  if (f) upload(f);
                }}
                className={`mt-0.5 inline-flex w-fit cursor-pointer items-center gap-1 rounded border border-dashed px-2 py-1 text-[11px] transition-colors ${
                  attachDragging ? "border-terracotta bg-terracotta/5 text-terracotta" : "border-gray-300 text-gray-600 hover:bg-white"
                }`}
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                {uploading ? "Uploading…" : attachDragging ? "Drop to attach" : "Upload invoice / receipt (PDF or image) — or drag & drop"}
                <input type="file" accept="application/pdf,image/*" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
              </label>
            </div>
          </td>
        </tr>
      )}
      {historyOpen && (
        <tr className="bg-gray-50/60">
          <td colSpan={6} className="px-3 py-2">
            {events === null ? (
              <span className="text-[11px] text-gray-400">Loading history...</span>
            ) : events.length === 0 ? (
              <span className="text-[11px] text-gray-400">No manual changes recorded for this line yet.</span>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {events.map((e) => (
                  <li key={e.id} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <History className="h-3 w-3 shrink-0 text-gray-400" />
                    <span>{fmtEventDay(e.created_at)}, {eventLabel(e)} by {e.actor ?? "system"}</span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Per-line audit trail (fin_bank_line_events), rendered as compact sentences
// like "31 May, categorised RENT to EQUIPMENTS by Ammar".
type LineEventValue = { category?: string | null; invoiceId?: string; invoiceNumber?: string | null; payee?: string | null; linkOnly?: boolean; expenseMonth?: string | null } | null;
type LineEvent = { id: string; event: string; old_value: LineEventValue; new_value: LineEventValue; actor: string | null; created_at: string };

const fmtEventDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short" });

function eventLabel(e: LineEvent): string {
  const invoiceRef = (v: LineEventValue) => v?.invoiceNumber ?? (v?.payee ? `from ${v.payee}` : v?.invoiceId ?? "unknown");
  switch (e.event) {
    case "classify":
      return `categorised ${e.old_value?.category ?? "unclassified"} to ${e.new_value?.category ?? "unclassified"}`;
    case "match":
      return `matched to invoice ${invoiceRef(e.new_value)}${e.new_value?.linkOnly ? " (link only)" : ""}`;
    case "unmatch":
      return `unmatched from invoice ${invoiceRef(e.old_value)}`;
    case "reject_match":
      return `rejected proposed match with invoice ${invoiceRef(e.new_value)}`;
    case "expense_month":
      return `moved expense month from ${e.old_value?.expenseMonth ?? "auto"} to ${e.new_value?.expenseMonth ?? "auto"}`;
    default:
      return e.event.replace(/_/g, " ");
  }
}

function Tile({ icon, label, value, sub, tone, onClick, active }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone: "green" | "amber" | "red" | "gray"; onClick: () => void; active?: boolean }) {
  const ring = tone === "green" ? "border-green-200" : tone === "amber" ? "border-amber-200" : tone === "red" ? "border-red-200" : "border-gray-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border bg-white px-3 py-2.5 text-left transition-shadow cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-terracotta/40 ${active ? "border-terracotta ring-1 ring-terracotta/30" : `${ring} hover:border-terracotta/40`}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-gray-500">{icon}{label}</div>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </button>
  );
}

function QueueCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        <p className="mt-0.5 text-[11px] text-gray-400">{desc}</p>
      </div>
      {children}
    </div>
  );
}

// Rows-per-page selector shared by the queues — "cannot increase/decrease" fix.
const PAGE_SIZES = [25, 50, 100] as const;
function RowsPerPage({ value, onChange, total }: { value: number; onChange: (n: number) => void; total: number }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-gray-400">
      Rows
      <select value={value === Infinity ? "all" : value} onChange={(e) => onChange(e.target.value === "all" ? Infinity : Number(e.target.value))}
        className="h-6 rounded border border-gray-200 bg-white px-1 text-[11px] text-gray-600">
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        <option value="all">All</option>
      </select>
      <span className="tabular-nums">of {total}</span>
    </span>
  );
}

// Open invoices with search + rows-per-page.
function OpenInvoicesTable({ rows }: { rows: { invoiceId: string; invoiceNumber: string | null; payee: string; amount: number; issueDate: string }[] }) {
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);
  const t = q.trim().toLowerCase();
  const filtered = t ? rows.filter((r) => r.payee.toLowerCase().includes(t) || (r.invoiceNumber ?? "").toLowerCase().includes(t) || String(r.amount).includes(t) || r.issueDate.includes(t)) : rows;
  const visible = filtered.slice(0, pageSize);
  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, invoice no, amount…" className="h-7 w-64 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700" />
        <span className="text-[11px] text-gray-400 tabular-nums">{t ? `${filtered.length} of ${rows.length}` : `${rows.length} invoices`}</span>
        <span className="ml-auto"><RowsPerPage value={pageSize} onChange={setPageSize} total={filtered.length} /></span>
      </div>
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
          <th className="px-3 py-2 font-medium">Payee</th><th className="px-3 py-2 font-medium">Invoice</th>
          <th className="px-3 py-2 font-medium">Issued</th><th className="px-3 py-2 text-right font-medium">Amount</th>
        </tr></thead>
        <tbody className="divide-y">
          {visible.length === 0 ? (
            <tr><td colSpan={4} className="px-4 py-4 text-xs text-gray-400">{t ? "No invoices match the search." : "Nothing here."}</td></tr>
          ) : visible.map((inv) => (
            <tr key={inv.invoiceId} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-xs text-gray-700">{inv.payee}</td>
              <td className="px-3 py-2 text-[11px] text-gray-400">{inv.invoiceNumber ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{inv.issueDate}</td>
              <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{fmtRM(inv.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > pageSize && <p className="px-3 py-2 text-[11px] text-gray-400">Showing {pageSize} of {filtered.length}. Increase rows above to see more.</p>}
    </div>
  );
}

// Per-line expense-month override: the month this payment's cost belongs to
// on the P&L (cash flow and the bank recon stay on the payment date). The
// input is prefilled with the effective month (override if set, else the
// transaction month); picking a month saves it, the x clears the override.
function ExpenseMonthControl({ bankLineId, txnMonth, override, onDone }: {
  bankLineId: string;
  txnMonth: string;          // YYYY-MM from the transaction date
  override: string | null;   // YYYY-MM override, or null
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(expenseMonth: string | null) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/finance/bank-lines/expense-month", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId, expenseMonth }),
      });
      const j = await res.json();
      if (!res.ok) setErr(j.error ?? `Failed (${res.status})`);
      else onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <span className="flex items-center gap-1" title="Expense month: which month this payment's cost sits in on the P&L. Cash flow keeps the payment date.">
      {override && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Expense month overridden" />}
      <input
        type="month"
        key={override ?? "auto"}
        defaultValue={override ?? txnMonth}
        disabled={busy}
        onChange={(e) => { if (e.target.value && e.target.value !== (override ?? txnMonth)) save(e.target.value); }}
        className="h-6 rounded border border-gray-200 bg-white px-1 text-[11px] text-gray-700 disabled:opacity-50"
      />
      {override && (
        <button onClick={() => save(null)} disabled={busy}
          title="Clear the override (back to the automatic expense month)"
          className="text-[11px] text-gray-400 hover:text-gray-600 disabled:opacity-50">
          ×
        </button>
      )}
      {busy && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
      {err && <span className="text-[10px] text-red-600">{err}</span>}
    </span>
  );
}

const matchKey = (m: ApMatch) => m.invoiceId + m.bankLineId;

async function applyMatchAction(m: ApMatch, action: "confirm" | "reject"): Promise<string | null> {
  // Returns an error string, or null on success.
  try {
    const res = action === "confirm"
      ? await fetch("/api/finance/bank-lines/match", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bankLineId: m.bankLineId, invoiceId: m.invoiceId }),
        })
      : await fetch("/api/finance/bank-lines/reject-match", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bankLineId: m.bankLineId, invoiceId: m.invoiceId }),
        });
    if (res.ok) return null;
    const j = await res.json().catch(() => ({}));
    return j.error ?? `Failed (${res.status})`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function MatchTable({ rows, showReasons, actionable, onDone }: { rows: ApMatch[]; showReasons?: boolean; actionable?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null); // key of the row being acted on
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);

  const t = q.trim().toLowerCase();
  const filtered = t
    ? rows.filter((m) => m.payee.toLowerCase().includes(t) || (m.invoiceNumber ?? "").toLowerCase().includes(t) || m.bankDesc.toLowerCase().includes(t) || String(m.amount).includes(t) || m.bankDate.includes(t))
    : rows;
  const visible = filtered.slice(0, pageSize);
  const allSelected = filtered.length > 0 && filtered.every((m) => sel.has(matchKey(m)));
  function toggle(key: string) {
    setSel((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(filtered.map(matchKey)));
  }

  async function act(m: ApMatch, action: "confirm" | "reject") {
    const key = matchKey(m);
    setBusy(key);
    const err = await applyMatchAction(m, action);
    if (err) setNotes((n) => ({ ...n, [key]: err }));
    else onDone?.();
    setBusy(null);
  }

  // Bulk: apply the action to every selected row (sequentially, each is its own
  // idempotent call), then refresh once. Failures are counted, not fatal.
  async function bulk(action: "confirm" | "reject") {
    if (sel.size === 0) return;
    setBulkBusy(true); setBulkNote(null);
    const targets = rows.filter((m) => sel.has(matchKey(m)));
    let ok = 0, failed = 0;
    for (const m of targets) {
      const err = await applyMatchAction(m, action);
      if (err) { failed++; setNotes((n) => ({ ...n, [matchKey(m)]: err })); }
      else ok++;
    }
    setBulkNote(`${action === "confirm" ? "Confirmed" : "Rejected"} ${ok}${failed ? `, ${failed} failed` : ""}.`);
    setSel(new Set());
    setBulkBusy(false);
    onDone?.();
  }

  if (rows.length === 0) return <p className="px-4 py-4 text-xs text-gray-400">Nothing here.</p>;
  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, bank line, amount…" className="h-7 w-64 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700" />
        <span className="text-[11px] text-gray-400 tabular-nums">{t ? `${filtered.length} of ${rows.length}` : `${rows.length} rows`}</span>
        <span className="ml-auto"><RowsPerPage value={pageSize} onChange={setPageSize} total={filtered.length} /></span>
      </div>
      {actionable && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-terracotta/30 bg-terracotta/5 px-4 py-2">
          <span className="text-xs font-medium text-gray-700">{sel.size} selected</span>
          <button onClick={() => bulk("confirm")} disabled={bulkBusy}
            className="rounded border border-green-600/30 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
            Confirm selected
          </button>
          <button onClick={() => bulk("reject")} disabled={bulkBusy}
            className="rounded border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            Reject selected
          </button>
          <button onClick={() => setSel(new Set())} disabled={bulkBusy} className="text-[11px] text-gray-500 underline">clear</button>
          {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
        </div>
      )}
      {bulkNote && <p className="border-b border-gray-100 px-4 py-1.5 text-[11px] text-gray-500">{bulkNote}</p>}
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
          {actionable && <th className="w-8 px-3 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5 accent-terracotta" /></th>}
          <th className="px-3 py-2 font-medium">Invoice payee</th><th className="px-3 py-2 text-right font-medium">Amount</th>
          <th className="px-3 py-2 font-medium">Bank line</th><th className="px-3 py-2 font-medium">Category</th>
          <th className="px-3 py-2 text-right font-medium">Score</th>{showReasons && <th className="px-3 py-2 font-medium">Why</th>}
          {actionable && <th className="px-3 py-2 font-medium">Decide</th>}
        </tr></thead>
        <tbody className="divide-y">
          {visible.map((m) => {
            const key = matchKey(m);
            return (
            <tr key={key} className={`hover:bg-gray-50 ${sel.has(key) ? "bg-terracotta/5" : ""}`}>
              {actionable && <td className="px-3 py-2"><input type="checkbox" checked={sel.has(key)} onChange={() => toggle(key)} className="h-3.5 w-3.5 accent-terracotta" /></td>}
              <td className="px-3 py-2 text-xs text-gray-700">{m.payee}{m.invoiceNumber ? <span className="text-gray-400"> · {m.invoiceNumber}</span> : ""}<div className="text-[10px] text-gray-400">{m.issueDate}</div></td>
              <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{fmtRM(m.amount)}</td>
              <td className="px-3 py-2 text-xs text-gray-600">{m.bankDesc}<div className="text-[10px] text-gray-400">{m.bankDate}</div></td>
              <td className="px-3 py-2 text-[11px] text-gray-400">{m.bankCategory ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-xs"><span className={m.score >= 0.85 ? "text-green-700" : "text-amber-700"}>{m.score.toFixed(2)}</span></td>
              {showReasons && <td className="px-3 py-2 text-[10px] text-gray-400">{m.reasons.join(", ")}</td>}
              {actionable && (
                <td className="whitespace-nowrap px-3 py-2">
                  {notes[key] ? <span className="text-[10px] text-rose-600">{notes[key]}</span> : (
                    <span className="flex items-center gap-1.5">
                      <button onClick={() => act(m, "confirm")} disabled={busy === key || bulkBusy}
                        className="rounded border border-green-600/30 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
                        Confirm
                      </button>
                      <button onClick={() => act(m, "reject")} disabled={busy === key || bulkBusy}
                        className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                        Reject
                      </button>
                      {busy === key && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
                    </span>
                  )}
                </td>
              )}
            </tr>
          );})}
        </tbody>
      </table>
      {filtered.length > pageSize && <p className="px-3 py-2 text-[11px] text-gray-400">Showing {pageSize} of {filtered.length}. Increase rows above to see more.</p>}
    </div>
  );
}

// The applied-matches review: everything linked to an invoice, searchable,
// with Unmatch to reverse a wrong one.
type MatchedRow = {
  bankLineId: string; date: string; desc: string; amount: number; category: string | null;
  matchedAt: string | null; invoiceId: string | null; invoiceNumber: string | null;
  payee: string; invoiceAmount: number | null; paidByMatch: boolean;
};

function MatchedTable() {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState<number>(50);
  const { data, mutate } = useFetch<{ total: number; rows: MatchedRow[] }>(
    `/api/finance/bank-lines/matched?q=${encodeURIComponent(q)}&limit=${limit === Infinity ? 300 : limit}`
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function unmatch(r: MatchedRow) {
    setBusy(r.bankLineId); setNote(null);
    try {
      const res = await fetch("/api/finance/bank-lines/unmatch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankLineId: r.bankLineId }),
      });
      const j = await res.json();
      if (!res.ok) setNote(j.error ?? `Failed (${res.status})`);
      else {
        setNote(`Unmatched ${r.payee}${j.invoicesReverted ? ` — invoice reverted to pending` : ` — invoice untouched (paid via another route)`}.`);
        mutate();
      }
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payee, invoice no, description or amount…"
          className="h-7 w-72 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700" />
        {data && <span className="text-[11px] text-gray-400 tabular-nums">{data.rows.length} shown · {data.total} matched in total</span>}
        {note && <span className="text-[11px] text-gray-500">{note}</span>}
        <span className="ml-auto"><RowsPerPage value={limit} onChange={setLimit} total={data?.total ?? 0} /></span>
      </div>
      {!data ? <p className="px-4 py-4 text-xs text-gray-400">Loading…</p> : data.rows.length === 0 ? (
        <p className="px-4 py-4 text-xs text-gray-400">{q ? "No matches for the search." : "Nothing matched yet."}</p>
      ) : (
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
            <th className="px-3 py-2 font-medium">Bank line</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Matched invoice</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">How</th>
            <th className="px-3 py-2" />
          </tr></thead>
          <tbody className="divide-y">
            {data.rows.map((r) => (
              <tr key={r.bankLineId} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-600">{r.desc}<div className="text-[10px] text-gray-400">{r.date}</div></td>
                <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{fmtRM(r.amount)}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{r.payee}{r.invoiceNumber ? <span className="text-gray-400"> · {r.invoiceNumber}</span> : ""}{r.invoiceAmount !== null && Math.abs(r.invoiceAmount - r.amount) > 0.01 && <span className="ml-1 text-[10px] text-amber-600">(invoice {fmtRM(r.invoiceAmount)})</span>}</td>
                <td className="px-3 py-2 text-[11px] text-gray-400">{r.category ?? "—"}</td>
                <td className="px-3 py-2 text-[10px] text-gray-400">{r.paidByMatch ? "match paid the invoice" : "link-only (paid elsewhere)"}{r.matchedAt ? ` · ${r.matchedAt}` : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button onClick={() => unmatch(r)} disabled={busy === r.bankLineId}
                    className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                    {busy === r.bankLineId ? "Unmatching…" : "Unmatch"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
