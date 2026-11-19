"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { HRPageHeader } from "@/components/hr-page-header";
import { CalendarPlus, ChefHat, Coffee, Loader2 } from "lucide-react";

type OpenShift = {
  id: string;
  outlet_id: string;
  outlet_name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  hours: number;
  station: string;
  role_type: string | null;
  blocked: string | null;
  my_request: "pending" | "assigned" | null;
  pending_requests: number;
};

type OpenShiftsData = {
  shifts: OpenShift[];
  is_pt: boolean;
  week_hours: number;
  week_days: number;
};

export default function OpenShiftsPage() {
  const { data, mutate } = useFetch<OpenShiftsData>("/api/hr/open-shifts");
  const [confirming, setConfirming] = useState<OpenShift | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const shifts = data?.shifts ?? [];
  const byDate = new Map<string, OpenShift[]>();
  for (const s of shifts) {
    if (!byDate.has(s.shift_date)) byDate.set(s.shift_date, []);
    byDate.get(s.shift_date)!.push(s);
  }

  const request = async () => {
    if (!confirming) return;
    setBusy(confirming.id);
    setError(null);
    try {
      const res = await fetch("/api/hr/open-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: confirming.id }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setError(j?.error ?? "Request failed — please try again.");
        return;
      }
      setFlash("Requested ✓ — your manager will assign someone. You'll see it in My Shifts if it's you.");
      setConfirming(null);
      mutate();
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async (s: OpenShift) => {
    setBusy(s.id);
    try {
      await fetch(`/api/hr/open-shifts?id=${s.id}`, { method: "DELETE" });
      mutate();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 pb-6">
      <HRPageHeader title="Open slots" />
      <p className="mb-4 text-sm text-text-3">
        Extra shifts that still need someone. Tap <strong>Request</strong> to raise your hand — your manager picks who gets it.
      </p>

      {data && data.is_pt && (
        <div className="mb-4 rounded-2xl border border-line bg-surface p-3 text-sm text-text-2">
          This week: <strong>{data.week_hours}h</strong> across <strong>{data.week_days} day{data.week_days === 1 ? "" : "s"}</strong>
          <span className="text-text-3"> · cap 24h / 5 days</span>
        </div>
      )}

      {flash && (
        <div className="mb-4 rounded-2xl border border-ok/30 bg-ok-soft p-3 text-sm font-medium text-ok-text">
          {flash}
        </div>
      )}

      {!data ? (
        <div className="py-10 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-line-ctl" />
        </div>
      ) : shifts.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <CalendarPlus className="mx-auto mb-2 h-8 w-8 text-line-ctl" />
          <p className="text-sm font-medium text-text-2">No open slots right now</p>
          <p className="mt-1 text-xs text-text-3">New slots appear here when a schedule needs extra hands.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...byDate.entries()].map(([date, dayShifts]) => (
            <div key={date}>
              <h2 className="mb-2 text-sm font-semibold text-text-3">
                {new Date(date + "T00:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "short" })}
              </h2>
              <div className="space-y-2">
                {dayShifts.map((s) => {
                  const requested = s.my_request === "pending";
                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-3 rounded-2xl border bg-surface p-3 ${s.blocked && !requested ? "border-line opacity-60" : requested ? "border-warn/30 bg-warn-soft/50" : "border-line shadow-sm"}`}
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${s.station === "kitchen" ? "bg-warn-soft text-warn-text" : "bg-warn-soft text-brand-text"}`}>
                        {s.station === "kitchen" ? <ChefHat className="h-5 w-5" /> : <Coffee className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {s.start_time}–{s.end_time}
                          <span className="ml-1.5 font-normal text-text-3">({s.hours}h)</span>
                        </p>
                        <p className="truncate text-xs text-text-3">
                          {s.outlet_name} · {s.station === "kitchen" ? "Kitchen" : "Barista"}{s.role_type ? ` · ${s.role_type}` : ""}
                          {s.pending_requests > 0 && (
                            <span className="ml-1.5 text-warn-text">· {s.pending_requests} asked</span>
                          )}
                        </p>
                        {requested ? (
                          <p className="mt-0.5 text-xs font-medium text-warn-text">Requested — waiting for your manager</p>
                        ) : s.blocked ? (
                          <p className="mt-0.5 text-xs text-danger">{s.blocked}</p>
                        ) : null}
                      </div>
                      {requested ? (
                        <button
                          onClick={() => withdraw(s)}
                          disabled={busy === s.id}
                          className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-medium text-text-2 active:scale-95 disabled:opacity-50"
                        >
                          {busy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Withdraw"}
                        </button>
                      ) : (
                        <button
                          onClick={() => { setError(null); setConfirming(s); }}
                          disabled={!!s.blocked}
                          className="shrink-0 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-on-ink active:scale-95 disabled:bg-line disabled:text-text-3"
                        >
                          Request
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm sheet */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 pb-28">
          <div className="w-full max-w-md rounded-2xl bg-surface p-5">
            <h3 className="mb-1 text-lg font-semibold">Request this shift?</h3>
            <p className="mb-1 text-base text-text-2">
              {new Date(confirming.shift_date + "T00:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <p className="mb-3 text-base text-text-2">
              {confirming.start_time}–{confirming.end_time} · {confirming.outlet_name} · {confirming.station === "kitchen" ? "Kitchen" : "Barista"}
            </p>
            <p className="mb-3 text-xs text-text-3">
              You&apos;re raising your hand — others can too. Your manager picks who gets the shift; it shows in My Shifts once assigned and published.
            </p>
            {error && <p className="mb-3 text-xs text-danger-text">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(null)}
                className="min-h-12 flex-1 rounded-xl border border-line py-2.5 text-base font-medium text-text-2"
              >
                Cancel
              </button>
              <button
                onClick={request}
                disabled={busy !== null}
                className="min-h-12 flex-1 rounded-xl bg-ink py-2.5 text-base font-medium text-on-ink disabled:opacity-50"
              >
                {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Request it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
