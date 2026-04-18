"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useEffect } from "react";
import { Timer, Save, Loader2, AlertTriangle } from "lucide-react";
import { SettingsNav } from "../_nav";

type CompanySettings = {
  id: string;
  max_regular_hours_per_week: number;
  overtime_warn_threshold: number;
  hard_cap_hours_per_week: number;
  overtime_requires_approval: boolean;
  max_consecutive_days: number;
  min_rest_between_shifts_hours: number;
};

export default function WorkingTimeRulesPage() {
  const { data, mutate } = useFetch<{ settings: CompanySettings | null }>("/api/hr/company-settings");
  const [form, setForm] = useState<CompanySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await fetch("/api/hr/company-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      mutate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return (
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-bold">HR Settings</h1>
        <SettingsNav />
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }

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
            <Timer className="h-5 w-5 text-terracotta" />
            Working Time Rules
          </h2>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saved ? "Saved" : "Save"}
          </button>
        </div>

        <div className="mb-5 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <strong className="text-amber-900">Malaysian Employment Act compliance</strong>
            <p className="mt-0.5 text-amber-800">
              Regular working hours are capped at <strong>45h/week</strong>. Hours above this require overtime approval. These rules apply company-wide and are enforced by the schedule creator and attendance reviewer.
            </p>
            <p className="mt-2 text-xs text-amber-800">
              Multi-outlet staff (e.g. Area Managers, floating Barista Leads) have their hours summed across <strong>ALL outlets</strong> they work at that week — not per-outlet.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Regular hours cap / week</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                value={form.max_regular_hours_per_week}
                onChange={(e) => setForm({ ...form, max_regular_hours_per_week: Number(e.target.value) })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">Hours beyond this are paid as overtime. Default: 45 (EA compliance).</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Warning threshold</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                value={form.overtime_warn_threshold}
                onChange={(e) => setForm({ ...form, overtime_warn_threshold: Number(e.target.value) })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">Show a yellow warning when scheduled hours approach this. Default: 40.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Hard cap (block further shifts)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                value={form.hard_cap_hours_per_week}
                onChange={(e) => setForm({ ...form, hard_cap_hours_per_week: Number(e.target.value) })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">Above this, the schedule creator blocks the shift. Protects against staff burnout. Default: 60.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Max consecutive days</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={form.max_consecutive_days}
                onChange={(e) => setForm({ ...form, max_consecutive_days: Number(e.target.value) })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">Staff must get a rest day after this many working days. Default: 6 (1 rest day/week).</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Min rest between shifts</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                value={form.min_rest_between_shifts_hours}
                onChange={(e) => setForm({ ...form, min_rest_between_shifts_hours: Number(e.target.value) })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">Between clock-out and next clock-in. Default: 11.</p>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.overtime_requires_approval}
                onChange={(e) => setForm({ ...form, overtime_requires_approval: e.target.checked })}
              />
              <span>Overtime requires manager approval</span>
            </label>
          </div>
        </div>

        <div className="mt-6 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <strong>Who this affects:</strong> AI scheduler, attendance reviewer, payroll OT calculation. When creating a weekly schedule, the system:
          <ul className="mt-1 ml-4 list-disc space-y-0.5">
            <li>Sums hours across <strong>all outlets</strong> per staff (important for rotating staff like Adam Kelvin, Syafiq Aiman)</li>
            <li>Shows yellow warning at {form.overtime_warn_threshold}h, orange overtime label at {form.max_regular_hours_per_week}h</li>
            <li>Blocks shift creation above {form.hard_cap_hours_per_week}h</li>
            <li>Flags consecutive working days exceeding {form.max_consecutive_days}</li>
            <li>Enforces {form.min_rest_between_shifts_hours}h rest gap between shifts</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
