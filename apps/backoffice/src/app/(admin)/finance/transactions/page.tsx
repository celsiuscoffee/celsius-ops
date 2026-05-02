"use client";

// Universal ledger view. Lists posted journals from fin_transactions with
// filters and a detail drawer showing the journal lines + source document.

import { useState, useMemo } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, X, FileText, Bot, User as UserIcon } from "lucide-react";

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
  outlet: Outlet | null;
};

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

function StatusPill({ status }: { status: Transaction["status"] }) {
  const colors: Record<Transaction["status"], string> = {
    posted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    exception: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
    reversed: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status}
    </span>
  );
}

function Drawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useFetch<{
    transaction: Transaction;
    lines: JournalLine[];
    document: SourceDoc | null;
  }>(`/api/finance/transactions/${id}`);

  return (
    <div className="fixed inset-0 z-50 flex">
      <button className="flex-1 bg-black/40" onClick={onClose} aria-label="Close drawer" />
      <aside className="w-full max-w-xl overflow-y-auto bg-background p-6 shadow-xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Transaction</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>
        {!data && !error && <Loader2 className="h-5 w-5 animate-spin" />}
        {error && <div className="text-sm text-rose-500">Failed to load.</div>}
        {data && (
          <div className="space-y-5">
            <section className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Description</div>
              <div>{data.transaction.description}</div>
            </section>
            <section className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Date</div>
                <div>{data.transaction.txn_date}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
                <StatusPill status={data.transaction.status} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Amount</div>
                <div>{RM(Number(data.transaction.amount))}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Posted by</div>
                <div className="flex items-center gap-1">
                  {data.transaction.posted_by_agent === "manual" ? (
                    <UserIcon className="h-3.5 w-3.5" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                  {data.transaction.posted_by_agent ?? "—"}
                  {data.transaction.confidence !== null && (
                    <span className="text-muted-foreground">
                      ({Math.round(Number(data.transaction.confidence) * 100)}%)
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section>
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Journal lines</div>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left">Account</th>
                    <th className="text-right">Debit</th>
                    <th className="text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="py-1.5">
                        <div className="font-medium">{l.account_code}</div>
                        <div className="text-xs text-muted-foreground">{l.account_name}</div>
                        {l.memo && <div className="text-xs text-muted-foreground">{l.memo}</div>}
                      </td>
                      <td className="text-right tabular-nums">
                        {Number(l.debit) ? RM(Number(l.debit)) : ""}
                      </td>
                      <td className="text-right tabular-nums">
                        {Number(l.credit) ? RM(Number(l.credit)) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {data.document && (
              <section className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" /> Source document
                </div>
                <div>
                  {data.document.source} · {data.document.doc_type}
                </div>
                <div className="text-xs text-muted-foreground">{data.document.source_ref}</div>
              </section>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

export default function FinanceTransactionsPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const qs = useMemo(() => (statusFilter ? `?status=${statusFilter}` : ""), [statusFilter]);
  const { data, error, isLoading } = useFetch<{ transactions: Transaction[] }>(
    `/api/finance/transactions${qs}`
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            Every journal posted to the ledger by agents and humans.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="posted">Posted</option>
          <option value="draft">Draft</option>
          <option value="exception">Exception</option>
          <option value="reversed">Reversed</option>
        </select>
      </header>

      {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {error && <div className="text-sm text-rose-500">Failed to load: {String(error)}</div>}

      {data && data.transactions.length === 0 && (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No transactions yet. Run the StoreHub EOD ingest to backfill.
        </div>
      )}

      {data && data.transactions.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Outlet</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer border-t hover:bg-muted/30"
                  onClick={() => setOpenId(t.id)}
                >
                  <td className="px-3 py-2 tabular-nums">{t.txn_date}</td>
                  <td className="px-3 py-2">{t.description}</td>
                  <td className="px-3 py-2">{t.outlet?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{t.txn_type}</td>
                  <td className="px-3 py-2 text-xs">
                    {t.posted_by_agent}
                    {t.confidence !== null && (
                      <span className="ml-1 text-muted-foreground">
                        ({Math.round(Number(t.confidence) * 100)}%)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{RM(Number(t.amount))}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <Drawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
