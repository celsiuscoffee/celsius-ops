"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { Briefcase, Plus, Save, Trash2, Loader2, X } from "lucide-react";
import { SettingsNav } from "../_nav";
import type { LeavePolicy } from "@/lib/hr/types";

const APPROVER_OPTIONS = [
  { v: "manager", l: "Direct Manager" },
  { v: "position", l: "By Position" },
  { v: "person", l: "Specific Person" },
  { v: "role", l: "By Role" },
  { v: "none", l: "None" },
];

const ACCRUAL_OPTIONS = [
  { v: "yearly", l: "Yearly (full entitlement on Jan 1)" },
  { v: "monthly", l: "Monthly (accrues each month)" },
  { v: "daily", l: "Daily" },
  { v: "none", l: "None (on-request)" },
];

const PRORATE_OPTIONS = [
  { v: "started_month", l: "Started month counts fully" },
  { v: "completed_month", l: "Only completed months count" },
  { v: "partial_month", l: "Pro-rate by days worked" },
];

const EMP_TYPES = [
  { v: "full_time", l: "Full Time" },
  { v: "part_time", l: "Part Time" },
  { v: "contract", l: "Contract" },
  { v: "intern", l: "Intern" },
];

const BLANK: Partial<LeavePolicy> = {
  leave_type: "",
  display_name: "",
  entitlement_type: "fixed",
  entitlement_days: 0,
  accrual_type: "yearly",
  prorated: true,
  prorate_mode: "partial_month",
  carry_forward: false,
  carry_forward_max_days: null,
  carry_forward_expiry_months: null,
  first_approver: "manager",
  second_approver: "none",
  half_day_allowed: true,
  apply_in_past: false,
  min_advance_days: null,
  max_advance_days: null,
  min_consecutive_days: null,
  max_consecutive_days: null,
  mandatory_attachment: false,
  mandatory_justification: false,
  applies_to_employment_types: ["full_time", "contract"],
  is_active: true,
  notes: "",
};

export default function LeavePoliciesPage() {
  const { data, mutate } = useFetch<{ policies: LeavePolicy[] }>("/api/hr/leave-policies");
  const policies = data?.policies || [];
  const [editing, setEditing] = useState<Partial<LeavePolicy> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const startNew = () => setEditing({ ...BLANK });
  const close = () => setEditing(null);

  const save = async () => {
    if (!editing?.leave_type || !editing?.display_name) return;
    setSaving(true);
    try {
      const method = editing.id ? "PATCH" : "POST";
      await fetch("/api/hr/leave-policies", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      mutate();
      close();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this leave policy? Existing balances will remain but no new entitlements will be auto-created.")) return;
    setDeleting(id);
    try {
      await fetch(`/api/hr/leave-policies?id=${id}`, { method: "DELETE" });
      mutate();
    } finally {
      setDeleting(null);
    }
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
            <Briefcase className="h-5 w-5 text-terracotta" />
            Leave Policies ({policies.length})
          </h2>
          <button
            onClick={startNew}
            className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
          >
            <Plus className="h-4 w-4" />
            New Policy
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {policies.map((p) => (
            <div key={p.id} className="rounded-lg border bg-white p-4">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{p.display_name}</h3>
                  <p className="text-xs font-mono text-muted-foreground">{p.leave_type}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditing(p)} className="rounded p-1.5 hover:bg-gray-100 text-xs">Edit</button>
                  <button
                    onClick={() => remove(p.id)}
                    disabled={deleting === p.id}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    {deleting === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Entitlement:</span><span className="font-medium">{p.entitlement_type === "fixed" ? `${p.entitlement_days}d/yr` : "On request"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Accrual:</span><span>{p.accrual_type}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Carry forward:</span><span>{p.carry_forward ? `${p.carry_forward_max_days}d, ${p.carry_forward_expiry_months}mo expiry` : "No"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">1st Approver:</span><span>{p.first_approver}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Half-day:</span><span>{p.half_day_allowed ? "Yes" : "No"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Attachment:</span><span>{p.mandatory_attachment ? "Required" : "Optional"}</span></div>
              </div>
              {!p.is_active && <span className="mt-2 inline-block rounded bg-gray-100 px-2 py-0.5 text-[10px]">INACTIVE</span>}
            </div>
          ))}

          {policies.length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No leave policies yet. Add one to start.
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing.id ? "Edit Leave Policy" : "New Leave Policy"}</h3>
              <button onClick={close} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code" hint="Short key, e.g. 'annual'">
                  <input
                    value={editing.leave_type || ""}
                    onChange={(e) => setEditing({ ...editing, leave_type: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                    className="w-full rounded border px-3 py-2 text-sm"
                    disabled={!!editing.id}
                  />
                </Field>
                <Field label="Display name">
                  <input
                    value={editing.display_name || ""}
                    onChange={(e) => setEditing({ ...editing, display_name: e.target.value })}
                    className="w-full rounded border px-3 py-2 text-sm"
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Entitlement type">
                  <select value={editing.entitlement_type} onChange={(e) => setEditing({ ...editing, entitlement_type: e.target.value as "fixed" | "on_request" })} className="w-full rounded border px-3 py-2 text-sm">
                    <option value="fixed">Fixed (X days/year)</option>
                    <option value="on_request">On request (no entitlement)</option>
                  </select>
                </Field>
                {editing.entitlement_type === "fixed" && (
                  <Field label="Days per year">
                    <input
                      type="number"
                      step="0.5"
                      value={editing.entitlement_days ?? ""}
                      onChange={(e) => setEditing({ ...editing, entitlement_days: e.target.value === "" ? null : Number(e.target.value) })}
                      className="w-full rounded border px-3 py-2 text-sm"
                    />
                  </Field>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Accrual">
                  <select value={editing.accrual_type} onChange={(e) => setEditing({ ...editing, accrual_type: e.target.value as LeavePolicy["accrual_type"] })} className="w-full rounded border px-3 py-2 text-sm">
                    {ACCRUAL_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </Field>
                <Field label="Prorate mode">
                  <select value={editing.prorate_mode} onChange={(e) => setEditing({ ...editing, prorate_mode: e.target.value as LeavePolicy["prorate_mode"] })} className="w-full rounded border px-3 py-2 text-sm">
                    {PRORATE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </Field>
              </div>

              <div className="rounded-lg border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={editing.carry_forward || false} onChange={(e) => setEditing({ ...editing, carry_forward: e.target.checked })} />
                  Allow carry forward to next year
                </label>
                {editing.carry_forward && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Max days to carry">
                      <input
                        type="number"
                        step="0.5"
                        value={editing.carry_forward_max_days ?? ""}
                        onChange={(e) => setEditing({ ...editing, carry_forward_max_days: e.target.value === "" ? null : Number(e.target.value) })}
                        className="w-full rounded border px-3 py-2 text-sm"
                      />
                    </Field>
                    <Field label="Expires after (months)">
                      <input
                        type="number"
                        value={editing.carry_forward_expiry_months ?? ""}
                        onChange={(e) => setEditing({ ...editing, carry_forward_expiry_months: e.target.value === "" ? null : Number(e.target.value) })}
                        className="w-full rounded border px-3 py-2 text-sm"
                      />
                    </Field>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="1st Approver">
                  <select value={editing.first_approver} onChange={(e) => setEditing({ ...editing, first_approver: e.target.value as LeavePolicy["first_approver"] })} className="w-full rounded border px-3 py-2 text-sm">
                    {APPROVER_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </Field>
                <Field label="2nd Approver">
                  <select value={editing.second_approver} onChange={(e) => setEditing({ ...editing, second_approver: e.target.value as LeavePolicy["second_approver"] })} className="w-full rounded border px-3 py-2 text-sm">
                    {APPROVER_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Min advance days"><input type="number" value={editing.min_advance_days ?? ""} onChange={(e) => setEditing({ ...editing, min_advance_days: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded border px-3 py-2 text-sm" /></Field>
                <Field label="Max advance days"><input type="number" value={editing.max_advance_days ?? ""} onChange={(e) => setEditing({ ...editing, max_advance_days: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded border px-3 py-2 text-sm" /></Field>
                <Field label="Min consecutive days"><input type="number" step="0.5" value={editing.min_consecutive_days ?? ""} onChange={(e) => setEditing({ ...editing, min_consecutive_days: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded border px-3 py-2 text-sm" /></Field>
                <Field label="Max consecutive days"><input type="number" step="0.5" value={editing.max_consecutive_days ?? ""} onChange={(e) => setEditing({ ...editing, max_consecutive_days: e.target.value === "" ? null : Number(e.target.value) })} className="w-full rounded border px-3 py-2 text-sm" /></Field>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">RULES</p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.half_day_allowed || false} onChange={(e) => setEditing({ ...editing, half_day_allowed: e.target.checked })} /> Half-day bookings allowed</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.apply_in_past || false} onChange={(e) => setEditing({ ...editing, apply_in_past: e.target.checked })} /> Can apply for past dates (e.g. MC)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.mandatory_attachment || false} onChange={(e) => setEditing({ ...editing, mandatory_attachment: e.target.checked })} /> Require attachment (e.g. MC slip)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.mandatory_justification || false} onChange={(e) => setEditing({ ...editing, mandatory_justification: e.target.checked })} /> Require justification note</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.prorated || false} onChange={(e) => setEditing({ ...editing, prorated: e.target.checked })} /> Prorate for new joiners</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Active</label>
              </div>

              <Field label="Applies to employment types">
                <div className="flex flex-wrap gap-2">
                  {EMP_TYPES.map((t) => {
                    const on = (editing.applies_to_employment_types || []).includes(t.v);
                    return (
                      <button
                        key={t.v}
                        type="button"
                        onClick={() => {
                          const cur = new Set(editing.applies_to_employment_types || []);
                          if (on) cur.delete(t.v); else cur.add(t.v);
                          setEditing({ ...editing, applies_to_employment_types: Array.from(cur) });
                        }}
                        className={"rounded-full px-3 py-1 text-xs " + (on ? "bg-terracotta text-white" : "bg-gray-100 text-gray-600")}
                      >
                        {t.l}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Notes">
                <textarea value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={2} className="w-full rounded border px-3 py-2 text-sm" />
              </Field>

              <div className="flex justify-end gap-2 border-t pt-4">
                <button onClick={close} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
                <button
                  onClick={save}
                  disabled={saving || !editing.leave_type || !editing.display_name}
                  className="flex items-center gap-1 rounded-lg bg-terracotta px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}{hint && <span className="ml-1 text-gray-400">· {hint}</span>}</span>
      {children}
    </label>
  );
}
