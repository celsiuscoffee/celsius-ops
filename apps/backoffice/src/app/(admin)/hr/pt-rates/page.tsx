"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { toast } from "sonner";
import { Banknote, Loader2, Save, ShieldAlert, CheckCircle2, XCircle, Clock } from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";

type PendingChange = {
  id: string;
  user_id: string;
  salary_type: string;
  amount: number;
  effective_date: string;
  comment: string | null;
  requested_by_name: string | null;
  created_at: string | null;
  name?: string | null;
};

type PtEmployee = {
  user_id: string;
  name: string | null;
  status: string | null;
  outlet_name: string | null;
  hourly_rate: number | null;
  hourly_rate_weekend: number | null;
  pending: PendingChange[];
};

type Payload = {
  employees: PtEmployee[];
  pending: PendingChange[];
  selfApproveMax: number;
  canApprove: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);
const rm = (v: number | null) => (v == null ? "—" : `RM ${Number(v).toFixed(2)}`);
const typeLabel = (t: string) => (t === "hourly_weekend" ? "Weekend" : "Weekday");

export default function PtRatesPage() {
  const { data, mutate, isLoading } = useFetch<Payload>("/api/hr/pt-rates");
  const [editing, setEditing] = useState<PtEmployee | null>(null);
  const [rateType, setRateType] = useState<"hourly" | "hourly_weekend">("hourly");
  const [amount, setAmount] = useState("");
  const [effective, setEffective] = useState(today());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const employees = data?.employees || [];
  const pending = data?.pending || [];
  const max = data?.selfApproveMax ?? 11;
  const canApprove = data?.canApprove ?? false;

  const parsed = Number(amount);
  const overLimit = amount !== "" && Number.isFinite(parsed) && parsed > max;

  const open = (e: PtEmployee) => {
    setEditing(e);
    setRateType("hourly");
    setAmount("");
    setEffective(today());
    setComment("");
  };

  const submit = async () => {
    if (!editing || !amount || !effective) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/employees/${editing.user_id}/salary-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effective_date: effective,
          salary_type: rateType,
          amount: parsed,
          comment: comment || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      toast.success(
        body.status === "pending"
          ? "Sent for owner approval — pay is unchanged until it's approved."
          : "Rate updated.",
      );
      setEditing(null);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const review = async (p: PendingChange, action: "approve" | "reject") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/employees/${p.user_id}/salary-history`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: p.id, action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      toast.success(action === "approve" ? "Approved — the new rate is live." : "Rejected.");
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (p: PendingChange) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/hr/employees/${p.user_id}/salary-history?entry_id=${p.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success("Request withdrawn.");
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <HrPageHeader
        title="Part-timer rates"
        description={`Set the hourly rate for part-timers in your team. Anything above RM${max.toFixed(2)}/hr needs owner approval before it affects pay.`}
      />

      {pending.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-900">
            <ShieldAlert className="h-4 w-4" />
            Waiting for approval ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-white p-3 text-xs">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
                  {typeLabel(p.salary_type)}
                </span>
                <span className="font-medium">{p.name || p.user_id}</span>
                <span className="font-mono font-semibold tabular-nums">RM {p.amount.toFixed(2)}/hr</span>
                <span className="text-muted-foreground">from {p.effective_date}</span>
                {p.requested_by_name && (
                  <span className="text-muted-foreground">· raised by {p.requested_by_name}</span>
                )}
                {p.comment && <span className="text-muted-foreground">· {p.comment}</span>}
                <div className="ml-auto flex gap-2">
                  {canApprove ? (
                    <>
                      <button
                        onClick={() => review(p, "approve")}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1 font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3 w-3" /> Approve
                      </button>
                      <button
                        onClick={() => review(p, "reject")}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                      >
                        <XCircle className="h-3 w-3" /> Reject
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => withdraw(p)}
                      disabled={busy}
                      className="rounded-lg border px-2.5 py-1 font-medium hover:bg-muted disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Banknote className="h-4 w-4" />
          Part-timers ({employees.length})
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : employees.length === 0 ? (
          <p className="rounded border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
            No part-timers in your team.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Outlet</th>
                  <th className="py-2 pr-3 text-right font-medium">Weekday</th>
                  <th className="py-2 pr-3 text-right font-medium">Weekend</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.user_id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className={e.status === "ACTIVE" ? "" : "text-muted-foreground line-through"}>
                        {e.name || e.user_id}
                      </span>
                      {e.pending.length > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
                          <Clock className="h-2.5 w-2.5" /> pending
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{e.outlet_name || "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{rm(e.hourly_rate)}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{rm(e.hourly_rate_weekend)}</td>
                    <td className="py-2 pr-3 text-right">
                      <button
                        onClick={() => open(e)}
                        className="rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                      >
                        Change rate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-card p-5">
            <h3 className="mb-1 font-semibold">Change rate — {editing.name || editing.user_id}</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Now: {rm(editing.hourly_rate)} weekday · {rm(editing.hourly_rate_weekend)} weekend.
              Public holidays pay double the day&apos;s rate automatically.
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Which rate</span>
                <select
                  value={rateType}
                  onChange={(e) => setRateType(e.target.value as "hourly" | "hourly_weekend")}
                  className="input w-full"
                >
                  <option value="hourly">Weekday (Mon–Fri)</option>
                  <option value="hourly_weekend">Weekend (Sat–Sun)</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">New rate (RM/hr)</span>
                  <input
                    type="number" step="0.10" min={0}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="input w-full"
                    placeholder="0.00"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Effective from</span>
                  <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="input w-full" />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Reason</span>
                <input
                  type="text" value={comment} onChange={(e) => setComment(e.target.value)}
                  className="input w-full" placeholder="e.g. 6-month review, barista certification"
                />
              </label>

              {overLimit && !canApprove && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>
                    Above the RM{max.toFixed(2)}/hr limit — this will be saved and sent to the owner.
                    Pay stays at {rm(rateType === "hourly" ? editing.hourly_rate : editing.hourly_rate_weekend)} until it&apos;s approved.
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !amount || !effective}
                className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {overLimit && !canApprove ? "Send for approval" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
