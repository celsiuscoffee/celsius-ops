"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2, XCircle, Copy } from "lucide-react";

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  amount: string | number;
  status: string;
  notes: string | null;
  outlet: { id: string; name: string; code: string | null } | null;
  order: { id: string; orderNumber: string; expenseCategory: string | null; notes: string | null } | null;
};

type Batch = {
  id: string;
  batchNumber: string;
  userId: string;
  totalAmount: string | number;
  status: "OPEN" | "PAID" | "CANCELLED";
  paymentRef: string | null;
  paidAt: string | null;
  paidVia: string | null;
  notes: string | null;
  createdAt: string;
  invoices: InvoiceRow[];
  payee: {
    id: string;
    name: string | null;
    fullName: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
  } | null;
};

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, mutate, isLoading } = useFetch<{ batch: Batch }>(
    id ? `/api/inventory/claim-batches/${id}` : null,
  );
  const batch = data?.batch;

  const [paymentRef, setPaymentRef] = useState("");
  const [paidVia, setPaidVia] = useState("bank_transfer");
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const markPaid = async () => {
    if (!paymentRef.trim()) {
      alert("Enter the Maybank Reference ID before marking paid");
      return;
    }
    setPaying(true);
    try {
      const res = await fetch(`/api/inventory/claim-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pay", paymentRef: paymentRef.trim(), paidVia }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Failed" }));
        alert(b?.error || "Failed");
        return;
      }
      mutate();
    } finally {
      setPaying(false);
    }
  };

  const cancelBatch = async () => {
    if (!confirm("Cancel this batch? Invoices will go back to PENDING and can be batched again.")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/inventory/claim-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Failed" }));
        alert(b?.error || "Failed");
        return;
      }
      router.push("/inventory/pay-and-claim/batches");
    } finally {
      setCancelling(false);
    }
  };

  if (isLoading || !batch) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const statusPill =
    batch.status === "PAID" ? "bg-emerald-100 text-emerald-700"
    : batch.status === "OPEN" ? "bg-amber-100 text-amber-700"
    : "bg-gray-200 text-gray-600";

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        href="/inventory/pay-and-claim/batches"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to batches
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-mono">{batch.batchNumber}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusPill}`}>
              {batch.status}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {new Date(batch.createdAt).toLocaleString()}
            {batch.paidAt && <> · Paid {new Date(batch.paidAt).toLocaleString()}</>}
          </p>
          {batch.notes && <p className="mt-1 text-xs text-muted-foreground">{batch.notes}</p>}
        </div>
        {batch.status === "OPEN" && (
          <button
            onClick={cancelBatch}
            disabled={cancelling}
            className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
            Cancel batch
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Payment card */}
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-xl border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Transfer to</h2>
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Payee</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{batch.payee?.fullName || batch.payee?.name || "—"}</div>
                  {batch.payee && <button onClick={() => copy(batch.payee!.fullName || batch.payee!.name || "")} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Bank</div>
                <div>{batch.payee?.bankName || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Account number</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono">{batch.payee?.bankAccountNumber || "—"}</div>
                  {batch.payee?.bankAccountNumber && (
                    <button onClick={() => copy(batch.payee!.bankAccountNumber!)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Account name</div>
                <div>{batch.payee?.bankAccountName || "—"}</div>
              </div>
              <div className="mt-3 border-t pt-3">
                <div className="text-xs text-muted-foreground">Total to transfer</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-2xl font-bold">RM {Number(batch.totalAmount).toFixed(2)}</div>
                  <button onClick={() => copy(Number(batch.totalAmount).toFixed(2))} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                </div>
              </div>
              <div className="mt-2 border-t pt-3">
                <div className="text-xs text-muted-foreground">Suggested reference</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-xs">{batch.batchNumber}</div>
                  <button onClick={() => copy(batch.batchNumber)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                </div>
              </div>
            </div>
          </div>

          {batch.status === "OPEN" && (
            <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5">
              <h2 className="mb-3 text-sm font-semibold text-emerald-800 uppercase tracking-wide">Confirm payment</h2>
              <p className="mb-3 text-xs text-emerald-700">
                After transferring via M2U, paste the Maybank Reference ID below and confirm.
                This settles all {batch.invoices.length} claims in one step.
              </p>
              <label className="block text-xs">
                <span className="font-medium">Maybank Reference ID *</span>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. 8900XXXXXXX"
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono"
                />
              </label>
              <button
                onClick={markPaid}
                disabled={paying || !paymentRef.trim()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm paid
              </button>
            </div>
          )}

          {batch.status === "PAID" && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold">Paid</span>
              </div>
              <div className="mt-2 text-xs text-emerald-700">
                <div>Ref: <span className="font-mono">{batch.paymentRef}</span></div>
                <div>Via: {batch.paidVia}</div>
                <div>At: {batch.paidAt && new Date(batch.paidAt).toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>

        {/* Invoices list */}
        <div className="lg:col-span-2 rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
            <h2 className="text-sm font-semibold">
              {batch.invoices.length} claim{batch.invoices.length === 1 ? "" : "s"} in this batch
            </h2>
            <span className="text-sm font-semibold">
              Total: RM {Number(batch.totalAmount).toFixed(2)}
            </span>
          </div>
          <div className="divide-y">
            {batch.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                      {inv.status}
                    </span>
                    <span className="text-xs text-muted-foreground">{inv.outlet?.code || inv.outlet?.name}</span>
                    {inv.order?.expenseCategory && (
                      <span className="text-[10px] text-muted-foreground">· {inv.order.expenseCategory}</span>
                    )}
                  </div>
                  {inv.order?.notes && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{inv.order.notes}</div>
                  )}
                </div>
                <div className="font-semibold">RM {Number(inv.amount).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
