"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { formatRM } from "@celsius/shared";
import {
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  Flag,
  Wallet,
  ExternalLink,
  Loader2,
  CheckCircle2,
} from "lucide-react";

type ExceptionKind = "FLAGGED" | "SHORT_PAID" | "CARRY_FORWARD" | "UNVERIFIED" | "OVERDUE" | "BILLED_OVER_PO";

type Exception = {
  invoiceId: string;
  invoiceNumber: string;
  poNumber: string | null;
  status: string;
  amount: number;
  amountPaid: number;
  balance: number;
  issueDate: string;
  dueDate: string | null;
  ageDays: number;
  kinds: ExceptionKind[];
  reason: string;
  flags: { code: string; label: string; message: string }[];
};

type SupplierRow = {
  supplierId: string;
  supplierName: string;
  paymentTerms: string | null;
  outstanding: number;
  openCount: number;
  overdueAmount: number;
  overdueCount: number;
  oldestOpenDays: number;
  exceptions: Exception[];
};

type Totals = {
  outstanding: number;
  openCount: number;
  overdueAmount: number;
  overdueCount: number;
  exceptionCount: number;
  flaggedCount: number;
  supplierCount: number;
};

const KIND_META: Record<ExceptionKind, { label: string; cls: string }> = {
  FLAGGED: { label: "Mismatch", cls: "bg-danger-soft text-danger-text" },
  SHORT_PAID: { label: "Short-paid", cls: "bg-warn-soft text-warn-text" },
  OVERDUE: { label: "Overdue", cls: "bg-warn-soft text-warn-text" },
  BILLED_OVER_PO: { label: "Over PO", cls: "bg-danger-soft text-danger-text" },
  CARRY_FORWARD: { label: "Balance due", cls: "bg-info-soft text-info-text" },
  UNVERIFIED: { label: "Verify", cls: "bg-info-soft text-info-text" },
};

function KindBadge({ kind }: { kind: ExceptionKind }) {
  const m = KIND_META[kind];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>;
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "danger" | "warn";
}) {
  const ring =
    tone === "danger" ? "border-line" : tone === "warn" ? "border-line" : "border-line";
  return (
    <div className={`rounded-lg border ${ring} bg-surface p-4`}>
      <div className="flex items-center gap-2 text-xs font-medium text-text-3">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold text-text">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-text-3">{sub}</div>}
    </div>
  );
}

export default function ReconciliationPage() {
  const { data, isLoading } = useFetch<{ suppliers: SupplierRow[]; totals: Totals }>(
    "/api/inventory/invoices/reconciliation",
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const suppliers = data?.suppliers ?? [];
  const totals = data?.totals;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5 px-4 pt-6 pb-10 md:px-8">
      <div>
        <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Invoice match</h1>
        <p className="mt-0.5 text-sm text-text-2">
          What we owe each supplier, how old it is, and payments that do not yet match an invoice.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Total outstanding"
          value={formatRM(totals?.outstanding ?? 0)}
          sub={`${totals?.openCount ?? 0} open across ${totals?.supplierCount ?? 0} suppliers`}
        />
        <SummaryCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Overdue"
          value={formatRM(totals?.overdueAmount ?? 0)}
          sub={`${totals?.overdueCount ?? 0} invoice(s) past due`}
          tone={totals && totals.overdueAmount > 0 ? "warn" : undefined}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Reconciliation exceptions"
          value={String(totals?.exceptionCount ?? 0)}
          sub="rows needing attention"
          tone={totals && totals.exceptionCount > 0 ? "warn" : undefined}
        />
        <SummaryCard
          icon={<Flag className="h-3.5 w-3.5" />}
          label="Payment mismatches"
          value={String(totals?.flaggedCount ?? 0)}
          sub="duplicate / double / wrong-account"
          tone={totals && totals.flaggedCount > 0 ? "danger" : undefined}
        />
      </div>

      {/* Per-supplier statement */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-3">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading statements…
        </div>
      ) : suppliers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface py-16 text-center">
          <CheckCircle2 className="h-8 w-8 text-ok-text" />
          <div className="text-sm font-medium text-text">Nothing to reconcile</div>
          <div className="text-xs text-text-3">Every supplier is settled with no open balances or mismatches.</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {suppliers.map((s) => {
            const isOpen = expanded.has(s.supplierId);
            return (
              <div key={s.supplierId} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(s.supplierId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken/40"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-text-3" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-3" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-text">{s.supplierName}</span>
                      {s.paymentTerms && (
                        <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-text-3">{s.paymentTerms}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-3">
                      <span>{s.openCount} open</span>
                      {s.overdueCount > 0 && (
                        <span className="text-warn-text">{s.overdueCount} overdue</span>
                      )}
                      {s.oldestOpenDays > 0 && <span>oldest {s.oldestOpenDays}d</span>}
                    </div>
                  </div>
                  {/* Exception badge */}
                  {s.exceptions.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-medium text-warn-text">
                      <AlertTriangle className="h-3 w-3" />
                      {s.exceptions.length}
                    </span>
                  )}
                  <div className="text-right">
                    <div className="font-semibold text-text">{formatRM(s.outstanding)}</div>
                    <div className="text-[11px] text-text-3">outstanding</div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-line bg-sunken/20 px-4 py-3">
                    {s.exceptions.length === 0 ? (
                      <div className="py-2 text-xs text-text-3">
                        No mismatches — {formatRM(s.outstanding)} outstanding across {s.openCount} open invoice(s).
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {s.exceptions.map((e) => (
                          <div
                            key={e.invoiceId}
                            className="rounded-md border border-line bg-surface p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-text">{e.invoiceNumber}</span>
                                  {e.poNumber && (
                                    <span className="text-xs text-text-3">· {e.poNumber}</span>
                                  )}
                                  {e.kinds.map((k) => (
                                    <KindBadge key={k} kind={k} />
                                  ))}
                                </div>
                                <div className="mt-1 text-xs text-text-3">{e.reason}</div>
                                {e.flags.length > 0 && (
                                  <ul className="mt-1.5 space-y-1">
                                    {e.flags.map((f) => (
                                      <li key={f.code} className="flex items-start gap-1.5 text-xs text-danger-text">
                                        <Flag className="mt-0.5 h-3 w-3 shrink-0" />
                                        <span>{f.message}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <div className="text-right">
                                  <div className="font-medium text-text">{formatRM(e.balance)}</div>
                                  <div className="text-[11px] text-text-3">
                                    {formatRM(e.amountPaid)} of {formatRM(e.amount)}
                                  </div>
                                </div>
                                <Link
                                  href={`/inventory/invoices?search=${encodeURIComponent(e.invoiceNumber)}`}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-info-text hover:text-info-text"
                                >
                                  Open invoice
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
