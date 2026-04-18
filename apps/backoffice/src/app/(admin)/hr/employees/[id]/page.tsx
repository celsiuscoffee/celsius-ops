"use client";

import { useFetch } from "@/lib/use-fetch";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ArrowLeft, Save, Loader2, Lock, KeyRound, Shield, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { EmployeeProfile } from "@/lib/hr/types";

type Employee = {
  id: string;
  name: string;
  fullName: string | null;
  role: string;
  phone: string;
  email: string | null;
  outletId: string | null;
  outlet: { name: string } | null;
  hrProfile: EmployeeProfile | null;
  username?: string | null;
  appAccess?: string[];
  moduleAccess?: Record<string, unknown>;
  status?: string;
  hasPin?: boolean;
  hasPassword?: boolean;
  lastLoginAt?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
};

const ROLES = ["OWNER", "ADMIN", "MANAGER", "STAFF"];
const APP_OPTIONS = ["backoffice", "inventory", "sales", "loyalty", "pickup", "ops"];
const HR_MODULES = ["dashboard", "attendance", "schedules", "leave", "payroll", "employees", "settings"];

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

const MY_BANKS = [
  "Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank",
  "AmBank", "Bank Islam", "Bank Rakyat", "Bank Muamalat", "BSN",
  "Agrobank", "Alliance Bank", "Affin Bank", "HSBC Malaysia",
  "Standard Chartered", "OCBC Bank", "UOB Malaysia", "Citibank Malaysia",
  "MBSB Bank", "Touch 'n Go eWallet", "GXBank", "Aeon Bank",
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
    manager_user_id: "",
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
    schedule_required: true,
  });

  // Access / login state
  const [access, setAccess] = useState({
    role: "STAFF",
    username: "",
    email: "",
    status: "ACTIVE",
    hrAccess: false,
    appAccessSet: new Set<string>(),
    pin: "",
    password: "",
  });

  // Bank & identity state (User table)
  const [bank, setBank] = useState({ fullName: "", bankName: "", bankAccountName: "", bankAccountNumber: "" });
  const [savingBank, setSavingBank] = useState(false);
  const [bankSaved, setBankSaved] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessSaved, setAccessSaved] = useState(false);

  useEffect(() => {
    if (employee) {
      const ma = (employee.moduleAccess || {}) as Record<string, unknown>;
      const hrList = Array.isArray(ma.hr) ? (ma.hr as string[]) : [];
      setAccess({
        role: employee.role || "STAFF",
        username: employee.username || "",
        email: employee.email || "",
        status: employee.status || "ACTIVE",
        hrAccess: hrList.length > 0 || employee.role === "OWNER" || employee.role === "ADMIN",
        appAccessSet: new Set(employee.appAccess || []),
        pin: "",
        password: "",
      });
      setBank({
        fullName: employee.fullName || "",
        bankName: employee.bankName || "",
        bankAccountName: employee.bankAccountName || "",
        bankAccountNumber: employee.bankAccountNumber || "",
      });
    }
  }, [employee]);

  const handleSaveBank = async () => {
    if (!id) return;
    setSavingBank(true);
    setBankSaved(false);
    try {
      const res = await fetch(`/api/hr/employees/${id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: bank.fullName || null,
          bankName: bank.bankName || null,
          bankAccountName: bank.bankAccountName || null,
          bankAccountNumber: bank.bankAccountNumber || null,
        }),
      });
      if (res.ok) {
        setBankSaved(true);
        mutate();
        setTimeout(() => setBankSaved(false), 2000);
      } else {
        const d = await res.json();
        alert(d.error || "Failed to save bank details");
      }
    } finally {
      setSavingBank(false);
    }
  };

  const handleSaveAccess = async () => {
    if (!id) return;
    setSavingAccess(true);
    setAccessSaved(false);
    try {
      const currentModuleAccess = ((employee?.moduleAccess || {}) as Record<string, unknown>);
      const nextModuleAccess = { ...currentModuleAccess };
      if (access.hrAccess) {
        nextModuleAccess.hr = HR_MODULES;
      } else {
        delete nextModuleAccess.hr;
      }

      const payload: Record<string, unknown> = {
        role: access.role,
        username: access.username || null,
        email: access.email || null,
        status: access.status,
        appAccess: Array.from(access.appAccessSet),
        moduleAccess: nextModuleAccess,
      };
      if (access.pin) payload.pin = access.pin;
      if (access.password) payload.password = access.password;

      const res = await fetch(`/api/hr/employees/${id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setAccessSaved(true);
        setAccess((a) => ({ ...a, pin: "", password: "" }));
        mutate();
        setTimeout(() => setAccessSaved(false), 2000);
      } else {
        const data = await res.json();
        alert(data.error || "Failed to save access");
      }
    } finally {
      setSavingAccess(false);
    }
  };

  const toggleAppAccess = (app: string) => {
    setAccess((a) => {
      const next = new Set(a.appAccessSet);
      if (next.has(app)) next.delete(app); else next.add(app);
      return { ...a, appAccessSet: next };
    });
  };

  useEffect(() => {
    if (profile) {
      setForm({
        position: profile.position || "",
        employment_type: profile.employment_type || "full_time",
        join_date: profile.join_date?.slice(0, 10) || "",
        manager_user_id: profile.manager_user_id || "",
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
        schedule_required: (profile as unknown as { schedule_required?: boolean }).schedule_required !== false,
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
          manager_user_id: form.manager_user_id || null,
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
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
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
            <Field label="Reports To (Manager) — used for leave approvals">
              <select value={form.manager_user_id} onChange={(e) => update("manager_user_id", e.target.value)} className="input">
                <option value="">— No manager —</option>
                {(data?.employees || [])
                  .filter((e) => e.id !== id && (e.role === "OWNER" || e.role === "ADMIN" || e.role === "MANAGER"))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} — {e.role}
                    </option>
                  ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.schedule_required}
                onChange={(e) => setForm((f) => ({ ...f, schedule_required: e.target.checked }))}
              />
              <span>Appears in weekly schedule grid</span>
              <span className="text-xs text-muted-foreground">(off for HQ / non-outlet roles)</span>
            </label>
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

        {/* Bank & Identity */}
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Bank & Identity</h2>
            <button
              onClick={handleSaveBank}
              disabled={savingBank}
              className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              {savingBank ? <Loader2 className="h-3 w-3 animate-spin" /> : bankSaved ? <CheckCircle2 className="h-3 w-3" /> : <Save className="h-3 w-3" />}
              {bankSaved ? "Saved" : "Save Bank"}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full Legal Name (for payslip / statutory)">
              <input value={bank.fullName} onChange={(e) => setBank((b) => ({ ...b, fullName: e.target.value }))} className="input" placeholder="e.g. Ahmad Bin Abdullah" />
            </Field>
            <Field label="Bank">
              <select value={bank.bankName} onChange={(e) => setBank((b) => ({ ...b, bankName: e.target.value }))} className="input">
                <option value="">— Select bank —</option>
                {MY_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Account Holder Name">
              <input value={bank.bankAccountName} onChange={(e) => setBank((b) => ({ ...b, bankAccountName: e.target.value }))} className="input" placeholder="As per bank records" />
            </Field>
            <Field label="Account Number">
              <input value={bank.bankAccountNumber} onChange={(e) => setBank((b) => ({ ...b, bankAccountNumber: e.target.value.replace(/\s/g, "") })) } className="input" placeholder="Digits only" />
            </Field>
          </div>
        </section>

        {/* Login & Access */}
        <section className="rounded-xl border bg-card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Shield className="h-5 w-5 text-terracotta" />
              Login & Access
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {employee.hasPin && <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-green-700"><CheckCircle2 className="h-3 w-3" />PIN set</span>}
              {employee.hasPassword && <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-green-700"><CheckCircle2 className="h-3 w-3" />Password set</span>}
              {employee.lastLoginAt && <span>Last login: {new Date(employee.lastLoginAt).toLocaleDateString("en-MY")}</span>}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Basic */}
            <div className="space-y-3">
              <Field label="Role">
                <select value={access.role} onChange={(e) => setAccess((a) => ({ ...a, role: e.target.value }))} className="input">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Username (for password login)">
                <input value={access.username} onChange={(e) => setAccess((a) => ({ ...a, username: e.target.value }))} className="input" placeholder="optional" />
              </Field>
              <Field label="Email">
                <input type="email" value={access.email} onChange={(e) => setAccess((a) => ({ ...a, email: e.target.value }))} className="input" />
              </Field>
              <Field label="Account Status">
                <select value={access.status} onChange={(e) => setAccess((a) => ({ ...a, status: e.target.value }))} className="input">
                  <option value="ACTIVE">Active</option>
                  <option value="DEACTIVATED">Deactivated</option>
                </select>
              </Field>
            </div>

            {/* Credentials */}
            <div className="space-y-3">
              <Field label="Set PIN (4-6 digits)">
                <div className="relative">
                  <input
                    type={showPin ? "text" : "password"}
                    value={access.pin}
                    onChange={(e) => setAccess((a) => ({ ...a, pin: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                    className="input pr-10"
                    placeholder={employee.hasPin ? "•••• (leave blank to keep)" : "Enter new PIN"}
                    maxLength={6}
                  />
                  <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Set Password (8+ chars, OWNER/ADMIN/MANAGER only)">
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={access.password}
                    onChange={(e) => setAccess((a) => ({ ...a, password: e.target.value }))}
                    className="input pr-10"
                    placeholder={employee.hasPassword ? "•••••••• (leave blank to keep)" : "Enter new password"}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <p className="text-[10px] text-muted-foreground">
                PIN is for staff login (phone). Password is for backoffice login (desktop).
              </p>
            </div>

            {/* App + HR Module Access */}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">App Access</label>
                <div className="grid grid-cols-2 gap-1">
                  {APP_OPTIONS.map((app) => (
                    <label key={app} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={access.appAccessSet.has(app)}
                        onChange={() => toggleAppAccess(app)}
                      />
                      {app}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">HR Module Access</label>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={access.hrAccess}
                    onChange={(e) => setAccess((a) => ({ ...a, hrAccess: e.target.checked }))}
                    disabled={access.role === "OWNER" || access.role === "ADMIN"}
                  />
                  <span>Enable HR portal access</span>
                </label>
                {(access.role === "OWNER" || access.role === "ADMIN") && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {access.role} bypasses module checks — always has HR access
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSaveAccess}
              disabled={savingAccess}
              className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {savingAccess ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {accessSaved ? "Access Saved!" : "Save Login & Access"}
            </button>
          </div>
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
