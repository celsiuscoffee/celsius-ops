"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useMemo } from "react";
import { Clock, Plus, Save, Trash2, Loader2, X } from "lucide-react";
import { SettingsNav } from "../_nav";
import type { ShiftTemplate } from "@/lib/hr/types";

type Outlet = { id: string; name: string };

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

const BLANK: Partial<ShiftTemplate> = {
  outlet_id: null,
  label: "",
  start_time: "09:00:00",
  end_time: "17:30:00",
  break_minutes: 30,
  color: null,
  sort_order: 10,
  is_active: true,
};

export default function ShiftTemplatesPage() {
  const { data, mutate } = useFetch<{ templates: ShiftTemplate[] }>("/api/hr/shift-templates");
  const { data: outletsData } = useFetch<{ outlets: Outlet[] }>("/api/settings/outlets");
  const templates = data?.templates || [];
  const outlets = outletsData?.outlets || [];
  const [editing, setEditing] = useState<Partial<ShiftTemplate> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const byOutlet = useMemo(() => {
    const m = new Map<string, ShiftTemplate[]>();
    for (const t of templates) {
      const key = t.outlet_id || "__hq__";
      const list = m.get(key) || [];
      list.push(t);
      m.set(key, list);
    }
    return m;
  }, [templates]);

  const outletName = (id: string | null) => (id ? outlets.find((o) => o.id === id)?.name || "Unknown" : "HQ / No Outlet");

  const save = async () => {
    if (!editing?.label || !editing?.start_time || !editing?.end_time) return;
    setSaving(true);
    try {
      const method = editing.id ? "PATCH" : "POST";
      await fetch("/api/hr/shift-templates", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      mutate();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this shift template? Existing assignments stay but staff won't see this option anymore.")) return;
    setDeleting(id);
    try {
      await fetch(`/api/hr/shift-templates?id=${id}`, { method: "DELETE" });
      mutate();
    } finally {
      setDeleting(null);
    }
  };

  const calcHours = (s: string | undefined, e: string | undefined, breakMin: number | undefined) => {
    if (!s || !e) return "—";
    const toMin = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + (m || 0);
    };
    const diff = toMin(e) - toMin(s) - (breakMin || 0);
    if (diff <= 0) return "—";
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}h${m ? ` ${m}m` : ""}`;
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold">HR Settings</h1>
        <p className="text-sm text-muted-foreground">Configure how leave, payroll, and scheduling work for your team</p>
      </div>
      <SettingsNav />

      <div className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Clock className="h-5 w-5 text-terracotta" />
            Shift Templates ({templates.length})
          </h2>
          <button onClick={() => setEditing({ ...BLANK })} className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark">
            <Plus className="h-4 w-4" /> New Template
          </button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">Reusable shift patterns assigned to weekly schedules. Break minutes are subtracted from worked hours for pay computation.</p>

        <div className="space-y-4">
          {Array.from(byOutlet.entries()).map(([outletKey, list]) => (
            <div key={outletKey}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {outletKey === "__hq__" ? "HQ / No Outlet" : outletName(outletKey)}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((t) => (
                  <div key={t.id} className="rounded-lg border bg-white p-3">
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full" style={{ background: t.color || "#94a3b8" }} />
                        <h4 className="font-medium">{t.label}</h4>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setEditing(t)} className="rounded p-1 text-xs hover:bg-gray-100">Edit</button>
                        <button onClick={() => remove(t.id)} disabled={deleting === t.id} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                          {deleting === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-0.5 text-xs text-gray-600">
                      <div>{t.start_time.slice(0, 5)} – {t.end_time.slice(0, 5)}</div>
                      <div>{calcHours(t.start_time, t.end_time, t.break_minutes)} worked · {t.break_minutes}m break</div>
                      {!t.is_active && <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">INACTIVE</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {templates.length === 0 && <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">No shift templates yet.</div>}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? "Edit Shift" : "New Shift Template"}</h3>
              <button onClick={() => setEditing(null)} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Label</span>
                <input value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Outlet</span>
                <select value={editing.outlet_id || ""} onChange={(e) => setEditing({ ...editing, outlet_id: e.target.value || null })} className="w-full rounded border px-3 py-2 text-sm">
                  <option value="">HQ / No Outlet</option>
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Start</span>
                  <input type="time" value={(editing.start_time || "").slice(0, 5)} onChange={(e) => setEditing({ ...editing, start_time: e.target.value + ":00" })} className="w-full rounded border px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">End</span>
                  <input type="time" value={(editing.end_time || "").slice(0, 5)} onChange={(e) => setEditing({ ...editing, end_time: e.target.value + ":00" })} className="w-full rounded border px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">Break (min)</span>
                  <input type="number" value={editing.break_minutes ?? 30} onChange={(e) => setEditing({ ...editing, break_minutes: Number(e.target.value) })} className="w-full rounded border px-3 py-2 text-sm" />
                </label>
              </div>

              <p className="text-xs text-muted-foreground">Worked hours: <strong>{calcHours(editing.start_time, editing.end_time, editing.break_minutes)}</strong></p>

              <div>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Color</span>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setEditing({ ...editing, color: c })} className={"h-7 w-7 rounded-full border-2 " + (editing.color === c ? "border-gray-900" : "border-transparent")} style={{ background: c }} />
                  ))}
                  <button type="button" onClick={() => setEditing({ ...editing, color: null })} className={"h-7 w-7 rounded-full border-2 bg-gray-200 " + (!editing.color ? "border-gray-900" : "border-transparent")}>—</button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />
                Active
              </label>

              <div className="flex justify-end gap-2 border-t pt-4">
                <button onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
                <button onClick={save} disabled={saving || !editing.label} className="flex items-center gap-1 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
