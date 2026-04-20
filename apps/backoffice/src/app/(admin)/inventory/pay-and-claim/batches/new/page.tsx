"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  amount: string | number;
  status: string;
  createdAt: string;
  notes: string | null;
  outlet: { id: string; name: string; code: string | null } | null;
  order: {
    orderNumber: string;
    notes: string | null;
    expenseCategory: string | null;
  } | null;
};

type Group = {
  userId: string;
  payee: {
    id: string;
    name: string | null;
    fullName: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
  } | null;
  total: number;
  invoiceCount: number;
  invoices: InvoiceRow[];
};

type Outlet = { id: string; name: string; code: string };

export default function NewBatchPage() {
  const router = useRouter();
  const [outletId, setOutletId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedPayee, setSelectedPayee] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState("");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (outletId) p.set("outlet", outletId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [outletId, from, to]);

  const { data, isLoading } = useFetch<{ groups: Group[] }>(
    `/api/inventory/claim-batches/unbatched${queryString ? `?${queryString}` : ""}`,
  );
  const { data: outlets } = useFetch<Outlet[]>("/api/ops/outlets");
  const groups = data?.groups ?? [];

  const toggle = (inv: InvoiceRow, payeeId: string) => {
    setSelectedIds((prev) => {
      // Constrain to one payee — clear selection if switching payee
      if (selectedPayee && selectedPayee !== payeeId && prev.size > 0) {
        if (!confirm("Switching payee will clear current selection. Continue?")) return prev;
        setSelectedPayee(payeeId);
        const next = new Set<string>();
        next.add(inv.id);
        return next;
      }
      const next = new Set(prev);
      if (next.has(inv.id)) next.delete(inv.id);
      else next.add(inv.id);
      setSelectedPayee(next.size === 0 ? null : payeeId);
      return next;
    });
  };

  const toggleAllForPayee = (group: Group) => {
    const allIds = group.invoices.map((i) => i.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set<string>(allSelected ? [] : []);
      if (!allSelected) {
        // Clear if switching payee and prev had items for another payee
        if (selectedPayee && selectedPayee !== group.userId) {
          if (!confirm("Switching payee will clear current selection. Continue?")) return prev;
        }
        allIds.forEach((id) => next.add(id));
        setSelectedPayee(group.userId);
      } else {
        setSelectedPayee(null);
      }
      return next;
    });
  };

  const selectedTotal = useMemo(() => {
    let sum = 0;
    for (const g of groups) {
      for (const inv of g.invoices) {
        if (selectedIds.has(inv.id)) sum += Number(inv.amount);
      }
    }
    return Math.round(sum * 100) / 100;
  }, [groups, selectedIds]);

  const createBatch = async () => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/claim-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceIds: Array.from(selectedIds),
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Create failed" }));
        alert(b?.error || "Create failed");
        return;
      }
      const { batch } = await res.json();
      router.push(`/inventory/pay-and-claim/batches/${batch.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const payeeOfSelected = selectedPayee
    ? groups.find((g) => g.userId === selectedPayee)?.payee
    : null;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        href="/inventory/pay-and-claim/batches"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to batches
      </Link>

      <div>
        <h1 className="text-2xl font-bold">New Claim Batch</h1>
        <p className="text-sm text-muted-foreground">
          Pick which staff claims to pay together. All selected invoices must belong to the same payee.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        <label className="block text-xs">
          <span className="font-medium text-muted-foreground">Outlet</span>
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="mt-1 rounded-lg border bg-background px-2 py-1.5"
          >
            <option value="">All outlets</option>
            {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <span className="font-medium text-muted-foreground">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-lg border bg-background px-2 py-1.5" />
        </label>
        <label className="block text-xs">
          <span className="font-medium text-muted-foreground">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-lg border bg-background px-2 py-1.5" />
        </label>
        {(from || to || outletId) && (
          <button
            onClick={() => { setFrom(""); setTo(""); setOutletId(""); }}
            className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Reset
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading unbatched claims…
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
          No unbatched claims match those filters.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const allSelected = g.invoices.every((i) => selectedIds.has(i.id));
            const someSelected = !allSelected && g.invoices.some((i) => selectedIds.has(i.id));
            const dimmed = selectedPayee && selectedPayee !== g.userId;
            return (
              <div
                key={g.userId}
                className={`rounded-xl border bg-card ${dimmed ? "opacity-40" : ""}`}
              >
                <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }}
                      onChange={() => toggleAllForPayee(g)}
                      className="h-4 w-4"
                    />
                    <div>
                      <div className="font-semibold">{g.payee?.fullName || g.payee?.name || "(no payee)"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {g.payee?.bankName || "—"} · {g.payee?.bankAccountNumber || "no account on file"}
                      </div>
                    </div>
                  </label>
                  <div className="text-right text-xs">
                    <div className="font-semibold">{g.invoiceCount} claims · RM {g.total.toFixed(2)}</div>
                  </div>
                </div>
                <div className="divide-y">
                  {g.invoices.map((inv) => (
                    <label key={inv.id} className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-muted/30">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(inv.id)}
                        onChange={() => toggle(inv, g.userId)}
                        className="h-4 w-4"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                            {inv.status}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {inv.outlet?.code || inv.outlet?.name} · {new Date(inv.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {inv.order?.notes && <div className="text-[10px] text-muted-foreground">{inv.order.notes}</div>}
                      </div>
                      <div className="text-right text-sm font-semibold">
                        RM {Number(inv.amount).toFixed(2)}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky footer */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-0 z-10 mt-6 rounded-xl border bg-card p-4 shadow-lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Selection</div>
              <div className="text-lg font-bold">
                {selectedIds.size} claim{selectedIds.size === 1 ? "" : "s"} · RM {selectedTotal.toFixed(2)}
              </div>
              {payeeOfSelected && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Payee: <span className="font-medium">{payeeOfSelected.fullName || payeeOfSelected.name}</span>
                  {payeeOfSelected.bankAccountNumber && (
                    <> — {payeeOfSelected.bankName} {payeeOfSelected.bankAccountNumber}</>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-end gap-2">
              <label className="block text-xs">
                <span className="text-muted-foreground">Notes (optional)</span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-64 rounded-lg border bg-background px-3 py-1.5 text-sm"
                  placeholder="e.g. week 17 Shah Alam"
                />
              </label>
              <button
                onClick={createBatch}
                disabled={submitting}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Create Batch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
