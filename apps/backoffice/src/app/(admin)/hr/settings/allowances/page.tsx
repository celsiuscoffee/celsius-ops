"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useEffect } from "react";
import { Loader2, Save, AlertTriangle } from "lucide-react";
import { SettingsNav } from "../_nav";

type Settings = {
  id: string;
  attendance_allowance_amount: number;
  attendance_penalty_absent: number;
  attendance_penalty_early_out: number;
  attendance_penalty_missed_clockout: number;
  attendance_penalty_exceeded_break: number;
  attendance_late_tier_1_max_minutes: number;
  attendance_late_tier_2_max_minutes: number;
  attendance_late_tier_3_max_minutes: number;
  attendance_late_tier_4_max_minutes: number;
  attendance_late_tier_2_penalty: number;
  attendance_late_tier_3_penalty: number;
  attendance_late_tier_4_penalty: number;
  attendance_early_out_threshold_minutes: number;
  attendance_break_overage_threshold_minutes: number;
  performance_allowance_amount: number;
  performance_allowance_mode: "tiered" | "linear";
  performance_tier_full_threshold: number;
  performance_tier_half_threshold: number;
  performance_tier_quarter_threshold: number;
  perf_weight_checklists: number;
  perf_weight_reviews: number;
  perf_weight_audit: number;
  review_penalty_amount: number;
  review_penalty_max_star_rating: number;
  review_penalty_auto_dismiss_days: number;
};

export default function AllowanceSettingsPage() {
  const { data, mutate } = useFetch<{ settings: Settings }>("/api/hr/company-settings");
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data]);

  if (!form) return <div className="p-6"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const update = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setForm({ ...form, [k]: v });
    setSaved(false);
  };

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    update(k, Number(e.target.value) as never);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/hr/company-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSaved(true);
        mutate();
      } else {
        const { error } = await res.json();
        alert(error || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const perfWeightSum = form.perf_weight_checklists + form.perf_weight_reviews + form.perf_weight_audit;

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <SettingsNav />
      <div className="mt-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Allowance Settings</h1>
          <p className="text-sm text-gray-600">Configure attendance penalties, performance scoring, and review penalty rules.</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded bg-terracotta text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {/* Attendance allowance (punish) */}
      <section className="mt-6 bg-white rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-1">Attendance allowance (punish model)</h2>
        <p className="text-xs text-gray-500 mb-4">All staff start at base amount. Violations deduct. Floor at RM0.</p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Base amount (RM)">
            <input type="number" value={form.attendance_allowance_amount} onChange={num("attendance_allowance_amount")} className="input" min={0} step={1} />
          </Field>
          <Field label="Absent / no-show (RM)">
            <input type="number" value={form.attendance_penalty_absent} onChange={num("attendance_penalty_absent")} className="input" min={0} step={0.01} />
          </Field>
          <Field label="Early-out threshold (min)">
            <input type="number" value={form.attendance_early_out_threshold_minutes} onChange={num("attendance_early_out_threshold_minutes")} className="input" min={0} />
          </Field>
          <Field label="Early-out penalty (RM)">
            <input type="number" value={form.attendance_penalty_early_out} onChange={num("attendance_penalty_early_out")} className="input" min={0} step={0.01} />
          </Field>
          <Field label="Missed clock-out (RM)">
            <input type="number" value={form.attendance_penalty_missed_clockout} onChange={num("attendance_penalty_missed_clockout")} className="input" min={0} step={0.01} />
          </Field>
          <Field label="Exceeded break threshold (min)">
            <input type="number" value={form.attendance_break_overage_threshold_minutes} onChange={num("attendance_break_overage_threshold_minutes")} className="input" min={0} />
          </Field>
          <Field label="Exceeded break penalty (RM)">
            <input type="number" value={form.attendance_penalty_exceeded_break} onChange={num("attendance_penalty_exceeded_break")} className="input" min={0} step={0.01} />
          </Field>
        </div>

        {/* Late tiers */}
        <div className="mt-5">
          <h3 className="text-sm font-semibold mb-2">Late tiers (by minutes)</h3>
          <p className="text-xs text-gray-500 mb-2">Staff are penalised based on how late they are. Beyond tier 4, the full absent penalty applies.</p>
          <div className="grid grid-cols-4 gap-2 text-xs font-medium text-gray-600 mb-1">
            <div>Tier</div><div>Up to (min)</div><div>Penalty (RM)</div><div>Notes</div>
          </div>
          <div className="grid grid-cols-4 gap-2 items-center mb-1">
            <div>1 (grace)</div>
            <input type="number" value={form.attendance_late_tier_1_max_minutes} onChange={num("attendance_late_tier_1_max_minutes")} className="input" min={0} />
            <div className="text-gray-500">RM 0</div>
            <div className="text-xs text-gray-500">No penalty</div>
          </div>
          <div className="grid grid-cols-4 gap-2 items-center mb-1">
            <div>2</div>
            <input type="number" value={form.attendance_late_tier_2_max_minutes} onChange={num("attendance_late_tier_2_max_minutes")} className="input" min={0} />
            <input type="number" value={form.attendance_late_tier_2_penalty} onChange={num("attendance_late_tier_2_penalty")} className="input" min={0} step={0.01} />
            <div className="text-xs text-gray-500">Minor</div>
          </div>
          <div className="grid grid-cols-4 gap-2 items-center mb-1">
            <div>3</div>
            <input type="number" value={form.attendance_late_tier_3_max_minutes} onChange={num("attendance_late_tier_3_max_minutes")} className="input" min={0} />
            <input type="number" value={form.attendance_late_tier_3_penalty} onChange={num("attendance_late_tier_3_penalty")} className="input" min={0} step={0.01} />
            <div className="text-xs text-gray-500">Mid</div>
          </div>
          <div className="grid grid-cols-4 gap-2 items-center mb-1">
            <div>4</div>
            <input type="number" value={form.attendance_late_tier_4_max_minutes} onChange={num("attendance_late_tier_4_max_minutes")} className="input" min={0} />
            <input type="number" value={form.attendance_late_tier_4_penalty} onChange={num("attendance_late_tier_4_penalty")} className="input" min={0} step={0.01} />
            <div className="text-xs text-gray-500">Heavy</div>
          </div>
          <div className="grid grid-cols-4 gap-2 items-center">
            <div>5+</div>
            <div className="text-gray-500">beyond tier 4</div>
            <div className="text-gray-500">RM {form.attendance_penalty_absent}</div>
            <div className="text-xs text-gray-500">Counted as absent</div>
          </div>
        </div>
      </section>

      {/* Performance allowance (award) */}
      <section className="mt-6 bg-white rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-1">Performance allowance (award model — FT only)</h2>
        <p className="text-xs text-gray-500 mb-4">Full-time staff earn based on a composite score. Part-time and contract staff always get RM0.</p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Base amount (RM)">
            <input type="number" value={form.performance_allowance_amount} onChange={num("performance_allowance_amount")} className="input" min={0} />
          </Field>
          <Field label="Payout mode">
            <select
              value={form.performance_allowance_mode}
              onChange={(e) => update("performance_allowance_mode", e.target.value as "tiered" | "linear")}
              className="input"
            >
              <option value="tiered">Tiered (full/half/quarter/none)</option>
              <option value="linear">Linear (score % × base)</option>
            </select>
          </Field>
          <Field label="Full tier threshold (score ≥)">
            <input type="number" value={form.performance_tier_full_threshold} onChange={num("performance_tier_full_threshold")} className="input" min={0} max={100} />
          </Field>
          <Field label="Half tier threshold (score ≥)">
            <input type="number" value={form.performance_tier_half_threshold} onChange={num("performance_tier_half_threshold")} className="input" min={0} max={100} />
          </Field>
          <Field label="Quarter tier threshold (score ≥)">
            <input type="number" value={form.performance_tier_quarter_threshold} onChange={num("performance_tier_quarter_threshold")} className="input" min={0} max={100} />
          </Field>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold mb-2">Score weights</h3>
          <p className="text-xs text-gray-500 mb-2">
            How much each factor contributes to the composite score. Currently sum = {perfWeightSum} (normalized automatically).
          </p>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Checklists (team-avg relative)">
              <input type="number" value={form.perf_weight_checklists} onChange={num("perf_weight_checklists")} className="input" min={0} />
            </Field>
            <Field label="Reviews (outlet GBP avg)">
              <input type="number" value={form.perf_weight_reviews} onChange={num("perf_weight_reviews")} className="input" min={0} />
            </Field>
            <Field label="Audit (report mentions)">
              <input type="number" value={form.perf_weight_audit} onChange={num("perf_weight_audit")} className="input" min={0} />
            </Field>
          </div>
        </div>
      </section>

      {/* Review penalty */}
      <section className="mt-6 bg-red-50 rounded-lg border border-red-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <h2 className="text-lg font-semibold">Review penalty</h2>
        </div>
        <p className="text-xs text-gray-600 mb-4">
          Bad Google reviews flagged for manager attribution. Applied penalty deducts from the staff&apos;s total allowance.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Default penalty (RM, per staff)">
            <input type="number" value={form.review_penalty_amount} onChange={num("review_penalty_amount")} className="input" min={0} step={0.01} />
          </Field>
          <Field label="Max star rating that triggers">
            <input type="number" value={form.review_penalty_max_star_rating} onChange={num("review_penalty_max_star_rating")} className="input" min={1} max={5} />
          </Field>
          <Field label="Auto-dismiss after (days)">
            <input type="number" value={form.review_penalty_auto_dismiss_days} onChange={num("review_penalty_auto_dismiss_days")} className="input" min={1} />
          </Field>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Reviews with rating ≤ {form.review_penalty_max_star_rating}★ trigger a pending penalty. Manager has {form.review_penalty_auto_dismiss_days} days to review before auto-dismiss.
        </p>
      </section>

      <style jsx>{`
        .input {
          display: block;
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
