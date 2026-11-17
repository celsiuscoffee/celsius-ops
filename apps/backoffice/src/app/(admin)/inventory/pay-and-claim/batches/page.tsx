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
      ? "bg-ok-soft text-ok-text"
      : s === "OPEN"
        ? "bg-warn-soft text-warn-text"
        : "bg-line text-text-2";
  const statusIcon = (s: Batch["status"]) =>
    s === "PAID" ? <CheckCircle2 className="h-3 w-3" />
    : s === "OPEN" ? <Clock className="h-3 w-3" />
    : <XCircle className="h-3 w-3" />;

  return (
    <div className="space-y-6 px-4 pt-6 pb-10 md:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Claim batches</h1>
          <p className="text-sm text-text-2">
            Group multiple small staff claims into a single bank transfer per payee.
            One POP settles the whole batch.
          </p>
        </div>
        <Link
          href="/inventory/pay-and-claim/batches/new"
          className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-ctl bg-ink px-4 text-sm font-semibold text-on-ink hover:bg-ink-hover"
        >
          <Plus className="h-4 w-4" /> New batch
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["OPEN", "PAID", "CANCELLED", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              status === s ? "border-text bg-raised font-semibold text-text" : "border-line text-text-2 hover:bg-sunken"
            }`}
          >
            {({ OPEN: "Open", PAID: "Paid", CANCELLED: "Cancelled", all: "All" } as Record<string, string>)[s]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-20 text-text-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : batches.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-10 text-center text-sm text-text-2">
          No {status === "all" ? "" : status.toLowerCase()} batches yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-xs text-text-2">
              <tr>
                <th className="px-4 py-3 text-left">Batch</th>
                <th className="px-4 py-3 text-left">Payee</th>
                <th className="px-4 py-3 text-left">Outlets</th>
                <th className="px-4 py-3 text-right">Claims</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Payment ref</th>
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
                      <div className="text-xs text-text-2">
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
                  <td className="px-4 py-3 font-mono text-xs text-text-2">{b.paymentRef || "—"}</td>
                  <td className="px-4 py-3 text-xs text-text-2">
                    {new Date(b.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/inventory/pay-and-claim/batches/${b.id}`}
                      className="text-xs font-medium text-brand-text hover:underline"
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
