"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useEffect } from "react";
import { Loader2, Save, AlertTriangle } from "lucide-react";
import { BackToHR } from "@/components/hr/back-to-hr";
import { AllowanceTabs } from "@/components/hr/allowance-tabs";

// Mirrors the LIVE engine (lib/hr/allowances.ts — "Performance Allowance v2").
// ONE performance pool split across 4 EARN levers, each scored on its own KPI and
// paid nothing / half / full; then lateness + absence + negative-review DEDUCTIONS.
type Settings = {
  id: string;
  performance_allowance_amount: number;
  perf_lever_checklist: number;
  perf_lever_phone: number;
  perf_lever_serving: number;
  perf_lever_audit: number;
  checklist_full_pct: number;
  checklist_half_pct: number;
  perf_tier_perform_pct: number;
  perf_tier_ok_pct: number;
  phone_capture_default_baseline_pct: number;
  phone_capture_target_uplift_pp: number;
  serving_full_minutes: number;
  serving_half_minutes: number;
  attendance_lateness_grace_minutes: number;
  attendance_lateness_penalty: number;
  attendance_lateness_absent_minutes: number;
  attendance_penalty_absent: number;
  review_penalty_amount: number;
  review_penalty_max_star_rating: number;
  review_penalty_auto_dismiss_days: number;
};

const V2_KEYS: (keyof Settings)[] = [
  "performance_allowance_amount",
  "perf_lever_checklist", "perf_lever_phone", "perf_lever_serving", "perf_lever_audit",
  "checklist_full_pct", "checklist_half_pct",
  "perf_tier_perform_pct", "perf_tier_ok_pct",
  "phone_capture_default_baseline_pct", "phone_capture_target_uplift_pp",
  "serving_full_minutes", "serving_half_minutes",
  "attendance_lateness_grace_minutes", "attendance_lateness_penalty", "attendance_lateness_absent_minutes",
  "attendance_penalty_absent",
  "review_penalty_amount", "review_penalty_max_star_rating", "review_penalty_auto_dismiss_days",
];

export default function AllowanceSettingsPage() {
  const { data, mutate } = useFetch<{ settings: Settings }>("/api/hr/company-settings");
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data]);

  if (!form) return <div className="p-6"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: Number(e.target.value) });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Send ONLY the v2 allowance keys (+ id) so unrelated company settings
      // (statutory IDs, signature, …) are never touched.
      const body: Record<string, unknown> = { id: form.id };
      for (const k of V2_KEYS) body[k] = form[k];
      const res = await fetch("/api/hr/company-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) { setSaved(true); mutate(); }
      else { const { error } = await res.json(); alert(error || "Save failed"); }
    } finally {
      setSaving(false);
    }
  };

  const leverSum = form.perf_lever_checklist + form.perf_lever_phone + form.perf_lever_serving + form.perf_lever_audit;

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-6">
      <BackToHR />
      <AllowanceTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Allowance Rules</h1>
          <p className="text-sm text-gray-600">Performance allowance (v2): one pool, four KPI levers, minus attendance and review deductions.</p>
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded bg-terracotta text-white hover:opacity-90 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {/* Performance pool + levers */}
      <section className="mt-6 bg-white rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-1">Performance allowance (full-time only)</h2>
        <p className="text-xs text-gray-500 mb-4">
          Full-time staff earn ONE pool split across four levers. Each lever is scored on its OWN KPI and pays nothing / half / full.
          A lever that doesn&apos;t apply to a person (e.g. kitchen never runs the register) drops and its RM redistributes across their
          applicable levers. Part-time / contract / intern are not eligible.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Total pool (RM)">
            <input type="number" value={form.performance_allowance_amount} onChange={num("performance_allowance_amount")} className="input" min={0} step={1} />
          </Field>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold mb-1">Lever split (RM)</h3>
          <p className="text-xs text-gray-500 mb-2">
            How the pool divides across the four levers (sum = {leverSum}
            {leverSum !== form.performance_allowance_amount && <span className="text-amber-600"> — differs from the pool; the levers are scaled to it automatically</span>}).
          </p>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Checklist (all roles)">
              <input type="number" value={form.perf_lever_checklist} onChange={num("perf_lever_checklist")} className="input" min={0} />
            </Field>
            <Field label="Phone capture (FOH)">
              <input type="number" value={form.perf_lever_phone} onChange={num("perf_lever_phone")} className="input" min={0} />
            </Field>
            <Field label="Serving time (shift)">
              <input type="number" value={form.perf_lever_serving} onChange={num("perf_lever_serving")} className="input" min={0} />
            </Field>
            <Field label="Audit (outlet)">
              <input type="number" value={form.perf_lever_audit} onChange={num("perf_lever_audit")} className="input" min={0} />
            </Field>
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold mb-2">Lever thresholds (full / half / none)</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Checklist — full at completion % ≥">
              <input type="number" value={form.checklist_full_pct} onChange={num("checklist_full_pct")} className="input" min={0} max={100} />
            </Field>
            <Field label="Checklist — half at completion % ≥">
              <input type="number" value={form.checklist_half_pct} onChange={num("checklist_half_pct")} className="input" min={0} max={100} />
            </Field>
            <Field label="Phone & Audit — full at achievement % ≥">
              <input type="number" value={form.perf_tier_perform_pct} onChange={num("perf_tier_perform_pct")} className="input" min={0} max={100} />
            </Field>
            <Field label="Phone & Audit — half at achievement % ≥">
              <input type="number" value={form.perf_tier_ok_pct} onChange={num("perf_tier_ok_pct")} className="input" min={0} max={100} />
            </Field>
            <Field label="Serving — full at avg ≤ (min)">
              <input type="number" value={form.serving_full_minutes} onChange={num("serving_full_minutes")} className="input" min={0} />
            </Field>
            <Field label="Serving — half at avg ≤ (min)">
              <input type="number" value={form.serving_half_minutes} onChange={num("serving_half_minutes")} className="input" min={0} />
            </Field>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Phone capture is scored against the outlet target = its trailing-90-day capture rate + an uplift. Set the fallback baseline and uplift below.
          </p>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <Field label="Phone target — default baseline (%) when no outlet history">
              <input type="number" value={form.phone_capture_default_baseline_pct} onChange={num("phone_capture_default_baseline_pct")} className="input" min={0} max={100} />
            </Field>
            <Field label="Phone target — uplift over baseline (pp)">
              <input type="number" value={form.phone_capture_target_uplift_pp} onChange={num("phone_capture_target_uplift_pp")} className="input" min={0} />
            </Field>
          </div>
        </div>
      </section>

      {/* Deductions */}
      <section className="mt-6 bg-white rounded-lg border p-5">
        <h2 className="text-lg font-semibold mb-1">Deductions</h2>
        <p className="text-xs text-gray-500 mb-4">Taken off the earned performance allowance each month. Floored at RM0.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Lateness grace (min)">
            <input type="number" value={form.attendance_lateness_grace_minutes} onChange={num("attendance_lateness_grace_minutes")} className="input" min={0} />
          </Field>
          <Field label="Lateness penalty (RM, once past grace)">
            <input type="number" value={form.attendance_lateness_penalty} onChange={num("attendance_lateness_penalty")} className="input" min={0} step={0.01} />
          </Field>
          <Field label="Counts as absent past (min late)">
            <input type="number" value={form.attendance_lateness_absent_minutes} onChange={num("attendance_lateness_absent_minutes")} className="input" min={0} />
          </Field>
          <Field label="Absence penalty (RM, no-show / very late)">
            <input type="number" value={form.attendance_penalty_absent} onChange={num("attendance_penalty_absent")} className="input" min={0} step={0.01} />
          </Field>
        </div>
      </section>

      {/* Review penalty */}
      <section className="mt-6 bg-red-50 rounded-lg border border-red-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <h2 className="text-lg font-semibold">Review penalty</h2>
        </div>
        <p className="text-xs text-gray-600 mb-4">
          Bad Google reviews flagged for manager attribution. An applied penalty deducts from the staff&apos;s earned allowance.
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
