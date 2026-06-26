"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { formatRM } from "@celsius/shared";
import {
  Scale,
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
  FLAGGED: { label: "Mismatch", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  SHORT_PAID: { label: "Short-paid", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  OVERDUE: { label: "Overdue", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  BILLED_OVER_PO: { label: "Over PO", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300" },
  CARRY_FORWARD: { label: "Balance due", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  UNVERIFIED: { label: "Verify", cls: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
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
    tone === "danger" ? "border-red-200 dark:border-red-900" : tone === "warn" ? "border-amber-200 dark:border-amber-900" : "border-border";
  return (
    <div className={`rounded-lg border ${ring} bg-card p-4`}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
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
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Scale className="h-5 w-5" />
          Supplier Reconciliation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Statement of account per supplier — outstanding balances, aging, and the payment ↔ invoice ↔ PoP mismatches
          that need a human to match or chase.
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
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading statements…
        </div>
      ) : suppliers.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card py-16 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-500" />
          <div className="text-sm font-medium text-foreground">Nothing to reconcile</div>
          <div className="text-xs text-muted-foreground">Every supplier is settled with no open balances or mismatches.</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {suppliers.map((s) => {
            const isOpen = expanded.has(s.supplierId);
            return (
              <div key={s.supplierId} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(s.supplierId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{s.supplierName}</span>
                      {s.paymentTerms && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{s.paymentTerms}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{s.openCount} open</span>
                      {s.overdueCount > 0 && (
                        <span className="text-amber-600 dark:text-amber-400">{s.overdueCount} overdue</span>
                      )}
                      {s.oldestOpenDays > 0 && <span>oldest {s.oldestOpenDays}d</span>}
                    </div>
                  </div>
                  {/* Exception badge */}
                  {s.exceptions.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      {s.exceptions.length}
                    </span>
                  )}
                  <div className="text-right">
                    <div className="font-semibold text-foreground">{formatRM(s.outstanding)}</div>
                    <div className="text-[11px] text-muted-foreground">outstanding</div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3">
                    {s.exceptions.length === 0 ? (
                      <div className="py-2 text-xs text-muted-foreground">
                        No mismatches — {formatRM(s.outstanding)} outstanding across {s.openCount} open invoice(s).
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {s.exceptions.map((e) => (
                          <div
                            key={e.invoiceId}
                            className="rounded-md border border-border bg-card p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-medium text-foreground">{e.invoiceNumber}</span>
                                  {e.poNumber && (
                                    <span className="text-xs text-muted-foreground">· {e.poNumber}</span>
                                  )}
                                  {e.kinds.map((k) => (
                                    <KindBadge key={k} kind={k} />
                                  ))}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">{e.reason}</div>
                                {e.flags.length > 0 && (
                                  <ul className="mt-1.5 space-y-1">
                                    {e.flags.map((f) => (
                                      <li key={f.code} className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                                        <Flag className="mt-0.5 h-3 w-3 shrink-0" />
                                        <span>{f.message}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <div className="text-right">
                                  <div className="font-medium text-foreground">{formatRM(e.balance)}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {formatRM(e.amountPaid)} of {formatRM(e.amount)}
                                  </div>
                                </div>
                                <Link
                                  href={`/inventory/invoices?search=${encodeURIComponent(e.invoiceNumber)}`}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
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
