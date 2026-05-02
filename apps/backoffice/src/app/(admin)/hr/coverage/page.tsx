"use client";

/**
 * Outlet Coverage Rules
 *
 * Captures minimum staffing needs per outlet per day of week. Scheduling
 * uses these to flag under-covered slots.
 */

import { useEffect, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, Plus, Trash2, Flame } from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Rule = {
  id: string;
  outlet_id: string;
  day_of_week: number;
  slot_label: string | null;
  slot_start: string;
  slot_end: string;
  min_staff: number;
  is_peak: boolean;
};

type Outlet = { id: string; name: string; code: string };

export default function CoveragePage() {
  const { data: outletsRaw } = useFetch<Outlet[]>("/api/settings/outlets");
  const outlets: Outlet[] = outletsRaw ?? [];
  const [outletId, setOutletId] = useState<string>("");

  useEffect(() => {
    if (!outletId && outlets.length > 0) setOutletId(outlets[0].id);
  }, [outlets, outletId]);

  const { data: ruleData, mutate } = useFetch<{ rules: Rule[] }>(
    outletId ? `/api/hr/coverage?outlet_id=${outletId}` : null,
  );
  const rules = ruleData?.rules ?? [];

  const [day, setDay] = useState(1);
  const [start, setStart] = useState("07:30");
  const [end, setEnd] = useState("15:30");
  const [minStaff, setMinStaff] = useState("2");
  const [label, setLabel] = useState("");
  const [peak, setPeak] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (!outletId) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/hr/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id: outletId,
          day_of_week: day,
          slot_start: start + ":00",
          slot_end: end + ":00",
          min_staff: Number(minStaff),
          slot_label: label || null,
          is_peak: peak,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      mutate();
      setLabel("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this coverage rule?")) return;
    await fetch(`/api/hr/coverage?id=${id}`, { method: "DELETE" });
    mutate();
  };

  const byDay = new Map<number, Rule[]>();
  for (const r of rules) {
    const arr = byDay.get(r.day_of_week) ?? [];
    arr.push(r);
    byDay.set(r.day_of_week, arr);
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Outlet Coverage Rules"
        description="Minimum staffing needs per outlet per day/slot. Scheduling flags slots that don't hit the minimum."
      />

      <div className="rounded-lg border bg-card p-4">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Outlet</label>
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="w-full max-w-md rounded-md border px-3 py-2 text-sm">
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
          ))}
        </select>
      </div>

      {outletId && (
        <>
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Coverage Grid</h2>
            <div className="grid grid-cols-7 gap-2 text-xs">
              {DAYS.map((d, i) => {
                const slots = (byDay.get(i) ?? []).sort((a, b) => a.slot_start.localeCompare(b.slot_start));
                return (
                  <div key={i} className="rounded-md border border-gray-200 bg-gray-50 p-2">
                    <p className="mb-1.5 font-semibold">{d}</p>
                    {slots.length === 0 ? (
                      <p className="text-[10px] text-gray-400 italic">No rules</p>
                    ) : (
                      <div className="space-y-1">
                        {slots.map((s) => (
                          <div key={s.id} className={`rounded px-1.5 py-1 text-[11px] ${s.is_peak ? "bg-amber-100" : "bg-white"}`}>
                            <div className="flex items-center justify-between">
                              <span className="font-mono">{s.slot_start.slice(0, 5)}–{s.slot_end.slice(0, 5)}</span>
                              <div className="flex items-center gap-0.5">
                                {s.is_peak && <Flame className="h-2.5 w-2.5 text-amber-500" />}
                                <button onClick={() => remove(s.id)} className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                            <p className="text-gray-500">
                              ≥ {s.min_staff} staff{s.slot_label ? ` · ${s.slot_label}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Add Coverage Rule</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <Field label="Day">
                <select value={day} onChange={(e) => setDay(Number(e.target.value))} className="w-full rounded-md border px-3 py-2 text-sm">
                  {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </Field>
              <Field label="From">
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
              </Field>
              <Field label="Until">
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
              </Field>
              <Field label="Min staff">
                <input type="number" min="0" value={minStaff} onChange={(e) => setMinStaff(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
              </Field>
              <Field label="Label (optional)">
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="morning / lunch rush" className="w-full rounded-md border px-3 py-2 text-sm" />
              </Field>
              <Field label="Peak?">
                <label className="mt-1 flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={peak} onChange={(e) => setPeak(e.target.checked)} />
                  Peak hours
                </label>
              </Field>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              {err && <span className="text-xs text-red-600">{err}</span>}
              <button onClick={add} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Rule
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
