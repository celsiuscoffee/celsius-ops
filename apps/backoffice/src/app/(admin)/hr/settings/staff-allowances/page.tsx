"use client";

import { useFetch } from "@/lib/use-fetch";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, Search, RotateCcw } from "lucide-react";
import { BackToHR } from "@/components/hr/back-to-hr";
import { AllowanceTabs } from "@/components/hr/allowance-tabs";

type StaffRow = {
  userId: string;
  name: string;
  fullName: string | null;
  role: string;
  outletName: string | null;
  scheduleRequired: boolean;
  fixed_performance_allowance: number | null;
};

type Defaults = {
  performance_allowance_amount: number;
};

type Payload = { defaults: Defaults; staff: StaffRow[] };

export default function StaffAllowancesPage() {
  const { data, mutate, isLoading } = useFetch<Payload>("/api/hr/allowance-overrides");
  const [draft, setDraft] = useState<Record<string, { fixed: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Seed draft from server rows once data lands
  useEffect(() => {
    if (!data?.staff) return;
    const seed: Record<string, { fixed: string }> = {};
    for (const s of data.staff) {
      seed[s.userId] = {
        fixed: s.fixed_performance_allowance != null ? String(s.fixed_performance_allowance) : "",
      };
    }
    setDraft(seed);
  }, [data?.staff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.staff ?? [];
    return (data?.staff ?? []).filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.fullName?.toLowerCase().includes(q) ?? false) ||
      (s.outletName?.toLowerCase().includes(q) ?? false),
    );
  }, [data?.staff, search]);

  const saveRow = async (userId: string) => {
    const d = draft[userId];
    if (!d) return;
    setSavingId(userId);
    try {
      const parse = (v: string): number | null => {
        const t = v.trim();
        if (!t) return null;
        const n = Number(t);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };
      const res = await fetch("/api/hr/allowance-overrides", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          fixed_performance_allowance: parse(d.fixed),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        alert(body?.error || `Save failed (${res.status})`);
        return;
      }
      mutate();
    } finally {
      setSavingId(null);
    }
  };

  const resetRow = async (userId: string) => {
    // Clear the flat amount → null → back to the scored pool
    setDraft((d) => ({ ...d, [userId]: { fixed: "" } }));
    setSavingId(userId);
    try {
      await fetch("/api/hr/allowance-overrides", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          fixed_performance_allowance: null,
        }),
      });
      mutate();
    } finally {
      setSavingId(null);
    }
  };

  const defaults = data?.defaults;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <BackToHR />
      <AllowanceTabs />

      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Flat Allowances (Per Staff)</h2>
          <p className="text-sm text-muted-foreground">
            A value here pays <strong>flat</strong> — the full amount every month, with no KPI
            scoring and no lateness/absence or review deductions. Meant for roles the levers
            cannot score (unrostered, HQ). Leave blank for the normal scored pool
            {defaults ? ` (RM ${defaults.performance_allowance_amount.toFixed(2)} max, reduced by the levers)` : ""}.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or outlet…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background py-2 pl-10 pr-4 text-sm"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading staff…
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            {search ? "No staff match your search." : "No full-time staff found."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Staff</th>
                  <th className="px-4 py-3 text-left">Role · Outlet</th>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-right">Flat amount (RM)</th>
                  <th className="px-4 py-3 text-right w-40">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const d = draft[s.userId] || { fixed: "" };
                  const saving = savingId === s.userId;
                  const isFlat = s.fixed_performance_allowance != null;
                  return (
                    <tr key={s.userId} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{s.fullName || s.name}</div>
                        {s.fullName && s.fullName !== s.name && (
                          <div className="text-xs text-muted-foreground">{s.name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                          {s.role}
                        </span>{" "}
                        {s.outletName || "HQ"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          isFlat ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {isFlat ? "Flat — not scored" : "Scored by levers"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={d.fixed}
                          placeholder="scored"
                          onChange={(e) => setDraft((x) => ({ ...x, [s.userId]: { fixed: e.target.value } }))}
                          className="w-28 rounded-lg border bg-background px-3 py-1.5 text-right text-sm"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isFlat && (
                            <button
                              onClick={() => resetRow(s.userId)}
                              disabled={saving}
                              title="Back to the scored pool"
                              className="rounded-lg border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => saveRow(s.userId)}
                            disabled={saving}
                            className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-semibold text-white hover:bg-terracotta/90 disabled:opacity-50"
                          >
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            Save
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
