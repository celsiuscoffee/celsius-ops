"use client";

import { useFetch } from "@/lib/use-fetch";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import Link from "next/link";
import type { EmployeeProfile } from "@/lib/hr/types";

type Employee = {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  outlet: { name: string } | null;
  hrProfile: EmployeeProfile | null;
};

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full Time" },
  { value: "part_time", label: "Part Time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
];

const POSITIONS = [
  "Barista", "Shift Lead", "Kitchen Crew", "Cashier", "Barista Lead",
  "Kitchen Lead", "Manager", "Accountant", "Executive", "Director",
];

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, mutate } = useFetch<{ employees: Employee[] }>("/api/hr/employees");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const employee = data?.employees.find((e) => e.id === id);
  const profile = employee?.hrProfile;

  const [form, setForm] = useState({
    position: "",
    employment_type: "full_time",
    join_date: "",
    basic_salary: "",
    hourly_rate: "",
    ic_number: "",
    date_of_birth: "",
    gender: "",
    epf_number: "",
    socso_number: "",
    eis_number: "",
    tax_number: "",
    epf_employee_rate: "11",
    epf_employer_rate: "12",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    notes: "",
  });

  useEffect(() => {
    if (profile) {
      setForm({
        position: profile.position || "",
        employment_type: profile.employment_type || "full_time",
        join_date: profile.join_date?.slice(0, 10) || "",
        basic_salary: profile.basic_salary?.toString() || "",
        hourly_rate: profile.hourly_rate?.toString() || "",
        ic_number: profile.ic_number || "",
        date_of_birth: profile.date_of_birth?.slice(0, 10) || "",
        gender: profile.gender || "",
        epf_number: profile.epf_number || "",
        socso_number: profile.socso_number || "",
        eis_number: profile.eis_number || "",
        tax_number: profile.tax_number || "",
        epf_employee_rate: profile.epf_employee_rate?.toString() || "11",
        epf_employer_rate: profile.epf_employer_rate?.toString() || "12",
        emergency_contact_name: profile.emergency_contact_name || "",
        emergency_contact_phone: profile.emergency_contact_phone || "",
        notes: profile.notes || "",
      });
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/hr/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: id,
          ...form,
          basic_salary: form.basic_salary ? parseFloat(form.basic_salary) : 0,
          hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
          epf_employee_rate: parseFloat(form.epf_employee_rate) || 11,
          epf_employer_rate: parseFloat(form.epf_employer_rate) || 12,
          join_date: form.join_date || new Date().toISOString().slice(0, 10),
          date_of_birth: form.date_of_birth || null,
        }),
      });
      if (res.ok) {
        setSaved(true);
        mutate();
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  if (!employee) {
    return <div className="py-20 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/hr/employees" className="rounded-lg p-1 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{employee.name}</h1>
          <p className="text-sm text-muted-foreground">
            {employee.role} · {employee.outlet?.name || "No outlet"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Employment */}
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Employment</h2>
          <div className="space-y-3">
            <Field label="Position">
              <select value={form.position} onChange={(e) => update("position", e.target.value)} className="input">
                <option value="">Select...</option>
                {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={form.employment_type} onChange={(e) => update("employment_type", e.target.value)} className="input">
                {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Join Date">
              <input type="date" value={form.join_date} onChange={(e) => update("join_date", e.target.value)} className="input" />
            </Field>
          </div>
        </section>

        {/* Compensation */}
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Compensation</h2>
          <div className="space-y-3">
            <Field label="Basic Salary (RM/month)">
              <input type="number" value={form.basic_salary} onChange={(e) => update("basic_salary", e.target.value)} className="input" placeholder="0.00" />
            </Field>
            <Field label="Hourly Rate (RM) — for part-timers">
              <input type="number" value={form.hourly_rate} onChange={(e) => update("hourly_rate", e.target.value)} className="input" placeholder="Optional" />
            </Field>
          </div>
        </section>

        {/* Personal */}
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Personal</h2>
          <div className="space-y-3">
            <Field label="IC Number">
              <input value={form.ic_number} onChange={(e) => update("ic_number", e.target.value)} className="input" placeholder="000000-00-0000" />
            </Field>
            <Field label="Date of Birth">
              <input type="date" value={form.date_of_birth} onChange={(e) => update("date_of_birth", e.target.value)} className="input" />
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={(e) => update("gender", e.target.value)} className="input">
                <option value="">Select...</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </Field>
          </div>
        </section>

        {/* Statutory */}
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Statutory</h2>
          <div className="space-y-3">
            <Field label="EPF Number">
              <input value={form.epf_number} onChange={(e) => update("epf_number", e.target.value)} className="input" />
            </Field>
            <Field label="SOCSO Number">
              <input value={form.socso_number} onChange={(e) => update("socso_number", e.target.value)} className="input" />
            </Field>
            <Field label="EIS Number">
              <input value={form.eis_number} onChange={(e) => update("eis_number", e.target.value)} className="input" />
            </Field>
            <Field label="Tax Number (LHDN)">
              <input value={form.tax_number} onChange={(e) => update("tax_number", e.target.value)} className="input" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="EPF Employee %">
                <input type="number" value={form.epf_employee_rate} onChange={(e) => update("epf_employee_rate", e.target.value)} className="input" />
              </Field>
              <Field label="EPF Employer %">
                <input type="number" value={form.epf_employer_rate} onChange={(e) => update("epf_employer_rate", e.target.value)} className="input" />
              </Field>
            </div>
          </div>
        </section>

        {/* Emergency */}
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Emergency Contact</h2>
          <div className="space-y-3">
            <Field label="Name">
              <input value={form.emergency_contact_name} onChange={(e) => update("emergency_contact_name", e.target.value)} className="input" />
            </Field>
            <Field label="Phone">
              <input value={form.emergency_contact_phone} onChange={(e) => update("emergency_contact_phone", e.target.value)} className="input" />
            </Field>
          </div>
        </section>

        {/* Notes */}
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Notes</h2>
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            rows={4}
            className="input"
            placeholder="Internal notes..."
          />
        </section>
      </div>

      {/* Save Button */}
      <div className="sticky bottom-0 flex justify-end border-t bg-background py-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-terracotta px-6 py-2.5 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saved ? "Saved!" : "Save Profile"}
        </button>
      </div>
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
