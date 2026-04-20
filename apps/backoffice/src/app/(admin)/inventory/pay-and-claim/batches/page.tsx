"use client";

import { useFetch } from "@/lib/use-fetch";
import Link from "next/link";
import { useState } from "react";
import { Plus, Loader2, CheckCircle2, Clock, XCircle } from "lucide-react";

type Batch = {
  id: string;
  batchNumber: string;
  userId: string;
  totalAmount: string | number;
  status: "OPEN" | "PAID" | "CANCELLED";
  paymentRef: string | null;
  createdAt: string;
  paidAt: string | null;
  invoiceCount: number;
  outletCodes: string[];
  payee: {
    id: string;
    name: string | null;
    fullName: string | null;
    bankName: string | null;
    bankAccountNumber: string | null;
  } | null;
};

export default function ClaimBatchesPage() {
  const [status, setStatus] = useState<"all" | "OPEN" | "PAID" | "CANCELLED">("OPEN");
  const { data, isLoading } = useFetch<{ batches: Batch[] }>(
    `/api/inventory/claim-batches?status=${status}`,
  );
  const batches = data?.batches ?? [];

  const statusColor = (s: Batch["status"]) =>
    s === "PAID"
      ? "bg-emerald-100 text-emerald-700"
      : s === "OPEN"
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-200 text-gray-600";
  const statusIcon = (s: Batch["status"]) =>
    s === "PAID" ? <CheckCircle2 className="h-3 w-3" />
    : s === "OPEN" ? <Clock className="h-3 w-3" />
    : <XCircle className="h-3 w-3" />;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Claim Batches</h1>
          <p className="text-sm text-muted-foreground">
            Group multiple small staff claims into a single bank transfer per payee.
            One POP settles the whole batch.
          </p>
        </div>
        <Link
          href="/inventory/pay-and-claim/batches/new"
          className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta/90"
        >
          <Plus className="h-4 w-4" /> New Batch
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["OPEN", "PAID", "CANCELLED", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              status === s ? "border-terracotta bg-terracotta text-white" : "bg-background hover:bg-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : batches.length === 0 ? (
        <p className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
          No {status === "all" ? "" : status.toLowerCase()} batches yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Batch #</th>
                <th className="px-4 py-3 text-left">Payee</th>
                <th className="px-4 py-3 text-left">Outlets</th>
                <th className="px-4 py-3 text-right">Claims</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Payment Ref</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-xs">{b.batchNumber}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{b.payee?.fullName || b.payee?.name || "—"}</div>
                    {b.payee?.bankAccountNumber && (
                      <div className="text-xs text-muted-foreground">
                        {b.payee.bankName} · {b.payee.bankAccountNumber}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{b.outletCodes.join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-right">{b.invoiceCount}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    RM {Number(b.totalAmount).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusColor(b.status)}`}>
                      {statusIcon(b.status)} {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.paymentRef || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(b.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/inventory/pay-and-claim/batches/${b.id}`}
                      className="text-xs font-medium text-terracotta hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
