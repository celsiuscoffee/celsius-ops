"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, CheckCircle2, AlertTriangle, HelpCircle, Copy, ArrowDownCircle } from "lucide-react";

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
type ReconData = {
  summary: { auto: number; review: number; doublePayments: number; unmatchedInvoices: number; unmatchedOutflows: number; unmatchedOutflowValue: number };
  auto: ApMatch[]; review: ApMatch[]; doublePayments: ApMatch[];
  unmatchedInvoices: { invoiceId: string; invoiceNumber: string | null; payee: string; amount: number; issueDate: string }[];
  unmatchedOutflows: { bankLineId: string; desc: string; date: string; amount: number; category: string | null }[];
  cashIn: CashIn;
};

const fmtRM = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtRM0 = (n: number) => `RM ${n.toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;

// Outflow categories a human can assign — mirrors CashCategory (validated
// server-side against the Prisma enum).
const MANUAL_CATEGORIES = [
  "RAW_MATERIALS", "RENT", "UTILITIES", "MAINTENANCE", "EQUIPMENTS", "SOFTWARE",
  "STAFF_CLAIM", "PARTIMER", "EMPLOYEE_SALARY", "STATUTORY_PAYMENT", "TAX",
  "COMPLIANCE", "LICENSING_FEE", "BANK_FEE", "MARKETPLACE_FEE", "OTHER_MARKETING",
  "KOL", "DELIVERY", "PETTY_CASH", "LOAN", "DIVIDEND", "DIRECTORS_ALLOWANCE",
  "CAPITAL", "INVESTMENTS", "MANAGEMENT_FEE", "CFS_FEE",
] as const;

export default function ReconPage() {
  const [days, setDays] = useState(90);
  const { data, isLoading, mutate } = useFetch<ReconData>(`/api/finance/ap-match?sinceDays=${days}`);
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassNote, setReclassNote] = useState<string | null>(null);

  async function rerunRules() {
    setReclassifying(true);
    setReclassNote(null);
    try {
      const res = await fetch("/api/finance/reclassify", { method: "POST" });
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
            Cash-out: bank payments matched to procurement invoices. Read-only preview — the loop auto-applies high-confidence matches; the rest is your queue.
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
          {/* Summary tiles — each jumps to its detail section */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
            <Tile icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} label="Auto-matched" value={data.summary.auto} tone="green" targetId="recon-auto" />
            <Tile icon={<HelpCircle className="h-4 w-4 text-amber-600" />} label="Needs review" value={data.summary.review} tone="amber" targetId="recon-review" />
            <Tile icon={<Copy className="h-4 w-4 text-red-600" />} label="Double payments" value={data.summary.doublePayments} tone={data.summary.doublePayments ? "red" : "gray"} targetId="recon-double" />
            <Tile icon={<ArrowDownCircle className="h-4 w-4 text-gray-500" />} label="Unmatched out" value={data.summary.unmatchedOutflows} sub={fmtRM0(data.summary.unmatchedOutflowValue)} tone="gray" targetId="recon-unmatched-out" />
            <Tile icon={<AlertTriangle className="h-4 w-4 text-gray-500" />} label="Open invoices, no payment" value={data.summary.unmatchedInvoices} tone="gray" targetId="recon-open-invoices" />
          </div>

          {/* CASH-IN: sales rung up vs settlements received */}
          <Section title={`Cash-in — sales vs settlements (${data.cashIn.from} → ${data.cashIn.to})`} desc="What the POS rang up vs what landed in the bank. The gap is fees + platform commission + cash-not-banked + settlement timing.">
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
          </Section>

          {data.doublePayments.length > 0 && (
            <Section id="recon-double" title="⚠ Possible double payments" desc="Invoice already settled but another bank payment matches it.">
              <MatchTable rows={data.doublePayments} />
            </Section>
          )}

          <Section id="recon-auto" title="Auto-matched (high confidence)" desc="Amount-exact + payee name + date. The loop clears these and re-tags the bank line to COGS.">
            <MatchTable rows={data.auto} />
          </Section>

          <Section id="recon-review" title="Needs review" desc="Likely matches that aren't certain enough to auto-clear — confirm or reject.">
            <MatchTable rows={data.review} showReasons />
          </Section>

          <Section id="recon-unmatched-out" title="Unmatched outflows — unreconciled cash-out" desc="Bank payments with no matching invoice yet. Reconcile manually: pick a category (books it to that expense) or match it to its invoice.">
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
              <button
                onClick={rerunRules}
                disabled={reclassifying}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {reclassifying ? "Re-running rules…" : "Re-run classifier rules"}
              </button>
              <span className="text-[11px] text-gray-400">
                {reclassNote ?? "Applies the current rules to this pile first — most known payees clear automatically."}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Reconcile</th>
                </tr></thead>
                <tbody className="divide-y">
                  {data.unmatchedOutflows.slice(0, 100).map((o) => (
                    <OutflowRow key={o.bankLineId} row={o} onDone={() => mutate()} />
                  ))}
                </tbody>
              </table>
              {data.unmatchedOutflows.length > 100 && <p className="px-3 py-2 text-[11px] text-gray-400">Showing top 100 of {data.unmatchedOutflows.length} by amount.</p>}
            </div>
          </Section>

          <Section id="recon-open-invoices" title="Open invoices — no payment found" desc="Procurement invoices with no matching bank payment yet. Either unpaid, or paid via an outflow we haven't matched.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
                  <th className="px-3 py-2 font-medium">Payee</th><th className="px-3 py-2 font-medium">Invoice</th>
                  <th className="px-3 py-2 font-medium">Issued</th><th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr></thead>
                <tbody className="divide-y">
                  {data.unmatchedInvoices.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-4 text-xs text-gray-400">Nothing here.</td></tr>
                  ) : data.unmatchedInvoices.slice(0, 100).map((inv) => (
                    <tr key={inv.invoiceId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-xs text-gray-700">{inv.payee}</td>
                      <td className="px-3 py-2 text-[11px] text-gray-400">{inv.invoiceNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{inv.issueDate}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{fmtRM(inv.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.unmatchedInvoices.length > 100 && <p className="px-3 py-2 text-[11px] text-gray-400">Showing top 100 of {data.unmatchedInvoices.length}.</p>}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

type Candidate = {
  invoiceId: string; invoiceNumber: string | null; payee: string; amount: number;
  issueDate: string; status: string; linkOnly: boolean;
  amountExact: boolean; refHit: boolean; nameHit: boolean; score: number;
};

// One unmatched outflow with its manual-reconcile controls: a category select
// (books the line to that expense; the GL re-keys on the next loop run) and a
// Match panel listing candidate invoices to link.
function OutflowRow({ row, onDone }: { row: { bankLineId: string; desc: string; date: string; amount: number; category: string | null }; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<Candidate[] | null>(null);

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
      <tr className="hover:bg-gray-50">
        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap align-top">{row.date}</td>
        <td className="px-3 py-2 text-xs text-gray-700 align-top">
          {row.desc}
          {note && <div className="mt-0.5 text-[10px] text-red-600">{note}</div>}
        </td>
        <td className="px-3 py-2 text-[11px] text-gray-400 align-top">{row.category ?? "Unclassified"}</td>
        <td className="px-3 py-2 text-right font-mono text-xs text-red-700 align-top">−{fmtRM(row.amount)}</td>
        <td className="px-3 py-2 align-top">
          <div className="flex items-center gap-1.5">
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => setCategory(e.target.value)}
              className="h-6 max-w-[130px] rounded border border-gray-200 bg-white px-1 text-[11px] text-gray-700 disabled:opacity-50"
              title="Book this payment to a category"
            >
              <option value="" disabled>Set category…</option>
              {MANUAL_CATEGORIES.map((c) => <option key={c} value={c}>{c.toLowerCase().replace(/_/g, " ")}</option>)}
            </select>
            <button
              onClick={openMatch}
              disabled={busy}
              className={`h-6 rounded border px-1.5 text-[11px] font-medium disabled:opacity-50 ${open ? "border-terracotta text-terracotta" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
            >
              Match…
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60">
          <td colSpan={5} className="px-3 py-2">
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
    </>
  );
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // brief highlight so it's obvious which section the tile jumped to
  el.classList.add("ring-2", "ring-terracotta");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-terracotta"), 1400);
}

function Tile({ icon, label, value, sub, tone, targetId }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone: "green" | "amber" | "red" | "gray"; targetId?: string }) {
  const ring = tone === "green" ? "border-green-200" : tone === "amber" ? "border-amber-200" : tone === "red" ? "border-red-200" : "border-gray-200";
  return (
    <button
      type="button"
      onClick={() => targetId && scrollToSection(targetId)}
      disabled={!targetId}
      className={`rounded-lg border ${ring} bg-white px-3 py-2.5 text-left transition-shadow ${targetId ? "cursor-pointer hover:shadow-md hover:border-terracotta/40 focus:outline-none focus:ring-2 focus:ring-terracotta/40" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-xs text-gray-500">{icon}{label}</div>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </button>
  );
}

function Section({ id, title, desc, children }: { id?: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mt-4 scroll-mt-4 rounded-xl border border-gray-200 bg-white transition-all">
      <div className="border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
        <p className="mt-0.5 text-[11px] text-gray-400">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function MatchTable({ rows, showReasons }: { rows: ApMatch[]; showReasons?: boolean }) {
  if (rows.length === 0) return <p className="px-4 py-4 text-xs text-gray-400">Nothing here.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b bg-gray-50/50 text-left text-gray-500">
          <th className="px-3 py-2 font-medium">Invoice payee</th><th className="px-3 py-2 text-right font-medium">Amount</th>
          <th className="px-3 py-2 font-medium">Bank line</th><th className="px-3 py-2 font-medium">Category</th>
          <th className="px-3 py-2 text-right font-medium">Score</th>{showReasons && <th className="px-3 py-2 font-medium">Why</th>}
        </tr></thead>
        <tbody className="divide-y">
          {rows.map((m) => (
            <tr key={m.invoiceId + m.bankLineId} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-xs text-gray-700">{m.payee}{m.invoiceNumber ? <span className="text-gray-400"> · {m.invoiceNumber}</span> : ""}<div className="text-[10px] text-gray-400">{m.issueDate}</div></td>
              <td className="px-3 py-2 text-right font-mono text-xs text-gray-700">{fmtRM(m.amount)}</td>
              <td className="px-3 py-2 text-xs text-gray-600">{m.bankDesc}<div className="text-[10px] text-gray-400">{m.bankDate}</div></td>
              <td className="px-3 py-2 text-[11px] text-gray-400">{m.bankCategory ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-xs"><span className={m.score >= 0.85 ? "text-green-700" : "text-amber-700"}>{m.score.toFixed(2)}</span></td>
              {showReasons && <td className="px-3 py-2 text-[10px] text-gray-400">{m.reasons.join(", ")}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
