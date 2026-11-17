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
      <div className="flex items-center gap-2 p-8 text-text-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const statusPill =
    batch.status === "PAID" ? "bg-ok-soft text-ok-text"
    : batch.status === "OPEN" ? "bg-warn-soft text-warn-text"
    : "bg-line text-text-2";

  return (
    <div className="space-y-6 px-4 pt-6 pb-10 md:px-8">
      <Link
        href="/inventory/pay-and-claim/batches"
        className="inline-flex items-center gap-2 text-sm text-text-2 hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" /> Back to batches
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">{batch.batchNumber}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusPill}`}>
              {batch.status}
            </span>
          </div>
          <p className="text-sm text-text-2">
            Created {new Date(batch.createdAt).toLocaleString()}
            {batch.paidAt && <> · Paid {new Date(batch.paidAt).toLocaleString()}</>}
          </p>
          {batch.notes && <p className="mt-1 text-xs text-text-2">{batch.notes}</p>}
        </div>
        {batch.status === "OPEN" && (
          <button
            onClick={cancelBatch}
            disabled={cancelling}
            className="flex items-center gap-1 rounded-lg border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger-text hover:bg-danger-soft disabled:opacity-50"
          >
            {cancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
            Cancel batch
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Payment card */}
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-xl border border-line bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-text-2 uppercase tracking-wide">Transfer to</h2>
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-xs text-text-2">Payee</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{batch.payee?.fullName || batch.payee?.name || "—"}</div>
                  {batch.payee && <button onClick={() => copy(batch.payee!.fullName || batch.payee!.name || "")} className="text-text-2 hover:text-text"><Copy className="h-3 w-3" /></button>}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-2">Bank</div>
                <div>{batch.payee?.bankName || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-text-2">Account number</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono">{batch.payee?.bankAccountNumber || "—"}</div>
                  {batch.payee?.bankAccountNumber && (
                    <button onClick={() => copy(batch.payee!.bankAccountNumber!)} className="text-text-2 hover:text-text"><Copy className="h-3 w-3" /></button>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-2">Account name</div>
                <div>{batch.payee?.bankAccountName || "—"}</div>
              </div>
              <div className="mt-3 border-t pt-3">
                <div className="text-xs text-text-2">Total to transfer</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-2xl font-bold">RM {Number(batch.totalAmount).toFixed(2)}</div>
                  <button onClick={() => copy(Number(batch.totalAmount).toFixed(2))} className="text-text-2 hover:text-text"><Copy className="h-3 w-3" /></button>
                </div>
              </div>
              <div className="mt-2 border-t pt-3">
                <div className="text-xs text-text-2">Suggested reference</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-xs">{batch.batchNumber}</div>
                  <button onClick={() => copy(batch.batchNumber)} className="text-text-2 hover:text-text"><Copy className="h-3 w-3" /></button>
                </div>
              </div>
            </div>
          </div>

          {batch.status === "OPEN" && (
            <div className="rounded-xl border-2 border-ok/30 bg-ok-soft p-5">
              <h2 className="mb-3 text-sm font-semibold text-ok-text uppercase tracking-wide">Confirm payment</h2>
              <p className="mb-3 text-xs text-ok-text">
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
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono"
                />
              </label>
              <button
                onClick={markPaid}
                disabled={paying || !paymentRef.trim()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-on-ink hover:bg-ink-hover disabled:opacity-50"
              >
                {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm paid
              </button>
            </div>
          )}

          {batch.status === "PAID" && (
            <div className="rounded-xl border border-ok/30 bg-ok-soft p-5 text-sm">
              <div className="flex items-center gap-2 text-ok-text">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold">Paid</span>
              </div>
              <div className="mt-2 text-xs text-ok-text">
                <div>Ref: <span className="font-mono">{batch.paymentRef}</span></div>
                <div>Via: {batch.paidVia}</div>
                <div>At: {batch.paidAt && new Date(batch.paidAt).toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>

        {/* Invoices list */}
        <div className="lg:col-span-2 rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b bg-sunken px-4 py-3">
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
                    <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] text-text-2">
                      {inv.status}
                    </span>
                    <span className="text-xs text-text-2">{inv.outlet?.code || inv.outlet?.name}</span>
                    {inv.order?.expenseCategory && (
                      <span className="text-[10px] text-text-2">· {inv.order.expenseCategory}</span>
                    )}
                  </div>
                  {inv.order?.notes && (
                    <div className="mt-0.5 text-[10px] text-text-2">{inv.order.notes}</div>
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
