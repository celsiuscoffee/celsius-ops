"use client";

import { useFetch } from "@/lib/use-fetch";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ArrowLeft, Save, Loader2, Lock, KeyRound, Shield, Eye, EyeOff, CheckCircle2, TrendingUp, Clock, Sparkles, AlertTriangle, Star } from "lucide-react";
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

type AllowanceData = {
  breakdown: {
    isFullTime: boolean;
    period: { year: number; month: number; daysElapsed: number; daysRemaining: number };
    attendance: { base: number; earned: number; tip: string; metrics: { lateCount: number; absentCount: number; earlyOutCount: number; missedClockoutCount: number; exceededBreakCount: number }; penalties: { kind: string; label: string; amount: number; date?: string }[] };
    performance: { base: number; earned: number; score: number; mode: string; eligible: boolean; breakdown: { checklists: number; reviews: number; audit: number }; tip: string };
    reviewPenalty: { total: number; entries: { id: string; reviewDate: string; rating: number; amount: number; reviewText?: string | null }[] };
    totalEarned: number;
    totalMax: number;
  };
};

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, mutate } = useFetch<{ employees: Employee[] }>("/api/hr/employees");
  const { data: outlets } = useFetch<{ id: string; name: string; code: string }[]>("/api/ops/outlets");
  const { data: allowanceData } = useFetch<AllowanceData>(id ? `/api/hr/allowances?userId=${id}` : null);
  const allowance = allowanceData?.breakdown;
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
    // Per-employee statutory overrides
    epf_contribution_type: "default",
    socso_category: "invalidity_injury",
    eis_enabled: true,
    hrdf_relation: "non_related",
    prs_enabled: false,
    prs_rate: "",
    zakat_enabled: false,
    zakat_amount: "",
    cp8d_employment_status: "follow_employment_type",
    tax_resident_category: "normal",
    overtime_flat_rate: "",
    ssfw_number: "",
    ea_commencement_date: "",
  });

  // Access / login state
  const [access, setAccess] = useState({
    role: "STAFF",
    username: "",
    email: "",
    status: "ACTIVE",
    outletId: "",
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
        outletId: employee.outletId || "",
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
        outletId: access.outletId || null,
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
      const p = profile as unknown as Record<string, unknown>;
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
        schedule_required: p.schedule_required !== false,
        epf_contribution_type: (p.epf_contribution_type as string) || "default",
        socso_category: (p.socso_category as string) || "invalidity_injury",
        eis_enabled: p.eis_enabled !== false,
        hrdf_relation: (p.hrdf_relation as string) || "non_related",
        prs_enabled: p.prs_enabled === true,
        prs_rate: p.prs_rate != null ? String(p.prs_rate) : "",
        zakat_enabled: p.zakat_enabled === true,
        zakat_amount: p.zakat_amount != null ? String(p.zakat_amount) : "",
        cp8d_employment_status: (p.cp8d_employment_status as string) || "follow_employment_type",
        tax_resident_category: (p.tax_resident_category as string) || "normal",
        overtime_flat_rate: p.overtime_flat_rate != null ? String(p.overtime_flat_rate) : "",
        ssfw_number: (p.ssfw_number as string) || "",
        ea_commencement_date: p.ea_commencement_date ? String(p.ea_commencement_date).slice(0, 10) : "",
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
          // New statutory overrides
          prs_rate: form.prs_rate ? parseFloat(form.prs_rate) : null,
          zakat_amount: form.zakat_amount ? parseFloat(form.zakat_amount) : null,
          overtime_flat_rate: form.overtime_flat_rate ? parseFloat(form.overtime_flat_rate) : null,
          ea_commencement_date: form.ea_commencement_date || null,
          ssfw_number: form.ssfw_number || null,
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

      {/* Performance snapshot (current month) */}
      {allowance && (
        <section className="rounded-xl border bg-gradient-to-br from-orange-50 to-amber-50 p-5">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-terracotta" />
              <div>
                <h2 className="font-semibold">Performance — {new Date(allowance.period.year, allowance.period.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })}</h2>
                <p className="text-xs text-muted-foreground">
                  {allowance.period.daysRemaining} day{allowance.period.daysRemaining !== 1 ? "s" : ""} left in period
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-terracotta">RM {allowance.totalEarned}</p>
              <p className="text-xs text-muted-foreground">of RM {allowance.totalMax} max</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {/* Attendance */}
            <div className="rounded-lg bg-white/70 p-3">
              <div className="mb-1 flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span className="font-medium">Attendance</span>
                </div>
                <span className="font-semibold">RM {allowance.attendance.earned} / {allowance.attendance.base}</span>
              </div>
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: allowance.attendance.base > 0 ? `${(allowance.attendance.earned / allowance.attendance.base) * 100}%` : "0%" }}
                />
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-gray-600">
                <span>Late {allowance.attendance.metrics.lateCount}</span>
                <span>Absent {allowance.attendance.metrics.absentCount}</span>
                <span>Early-out {allowance.attendance.metrics.earlyOutCount}</span>
                <span>Missed clockout {allowance.attendance.metrics.missedClockoutCount}</span>
              </div>
              {allowance.attendance.penalties.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                    {allowance.attendance.penalties.length} penalt{allowance.attendance.penalties.length === 1 ? "y" : "ies"} — tap to view
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-gray-600">
                    {allowance.attendance.penalties.slice(0, 10).map((p, i) => (
                      <li key={i}>
                        {p.date ? <span className="font-mono text-[10px]">{p.date}</span> : null} · {p.label} (−RM {p.amount})
                      </li>
                    ))}
                    {allowance.attendance.penalties.length > 10 && <li>… and {allowance.attendance.penalties.length - 10} more</li>}
                  </ul>
                </details>
              )}
            </div>

            {/* Performance */}
            <div className="rounded-lg bg-white/70 p-3">
              <div className="mb-1 flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  <span className="font-medium">Performance</span>
                  {allowance.performance.eligible && <span className="text-xs text-gray-400">· score {allowance.performance.score}/100</span>}
                </div>
                <span className="font-semibold">
                  {allowance.performance.eligible ? `RM ${allowance.performance.earned} / ${allowance.performance.base}` : "FT only"}
                </span>
              </div>
              {allowance.performance.eligible ? (
                <>
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: allowance.performance.base > 0 ? `${(allowance.performance.earned / allowance.performance.base) * 100}%` : "0%" }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-gray-600">
                    <span>Checklists {allowance.performance.breakdown.checklists}</span>
                    <span>Reviews {allowance.performance.breakdown.reviews}</span>
                    <span>Audit {allowance.performance.breakdown.audit}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{allowance.performance.tip}</p>
                </>
              ) : (
                <p className="text-xs text-gray-500">Performance allowance is for full-time staff only.</p>
              )}
            </div>
          </div>

          {/* Review penalty */}
          {allowance.reviewPenalty.total > 0 && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="mb-1 flex items-center justify-between text-sm">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <span className="font-medium text-red-700">Review penalty</span>
                </div>
                <span className="font-semibold text-red-700">−RM {allowance.reviewPenalty.total}</span>
              </div>
              <ul className="space-y-0.5 text-xs text-red-700">
                {allowance.reviewPenalty.entries.map((e) => (
                  <li key={e.id} className="flex items-start gap-1.5">
                    <span className="flex shrink-0 items-center">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`h-3 w-3 ${i < e.rating ? "fill-red-500 text-red-500" : "text-red-200"}`} />
                      ))}
                    </span>
                    <span className="font-mono text-[10px]">{e.reviewDate}</span>
                    <span>· −RM {e.amount}</span>
                    {e.reviewText && <span className="text-red-600 italic truncate">&ldquo;{e.reviewText}&rdquo;</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <Link href={`/hr/performance?userId=${id}`} className="text-xs text-terracotta hover:underline">
              Full performance page →
            </Link>
          </div>
        </section>
      )}

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
            <Field label="EPF Contribution Type">
              <select value={form.epf_contribution_type} onChange={(e) => update("epf_contribution_type", e.target.value)} className="input">
                <option value="default">Default (KWSP recommendation)</option>
                <option value="voluntary">Voluntary (fixed %)</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SOCSO Category">
                <select value={form.socso_category} onChange={(e) => update("socso_category", e.target.value)} className="input">
                  <option value="invalidity_injury">Invalidity + Injury</option>
                  <option value="injury_only">Injury only</option>
                  <option value="exempt">Exempt</option>
                </select>
              </Field>
              <Field label="HRDF Relation">
                <select value={form.hrdf_relation} onChange={(e) => update("hrdf_relation", e.target.value)} className="input">
                  <option value="non_related">Non related</option>
                  <option value="related">Related</option>
                  <option value="exempt">Exempt</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.eis_enabled} onChange={(e) => setForm((f) => ({ ...f, eis_enabled: e.target.checked }))} />
                EIS enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.prs_enabled} onChange={(e) => setForm((f) => ({ ...f, prs_enabled: e.target.checked }))} />
                PRS enabled
              </label>
            </div>
            {form.prs_enabled && (
              <Field label="PRS Rate (%)">
                <input type="number" step="0.01" value={form.prs_rate} onChange={(e) => update("prs_rate", e.target.value)} className="input" />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.zakat_enabled} onChange={(e) => setForm((f) => ({ ...f, zakat_enabled: e.target.checked }))} />
              Zakat deducted via payroll
            </label>
            {form.zakat_enabled && (
              <Field label="Zakat Amount (RM/month)">
                <input type="number" step="0.01" value={form.zakat_amount} onChange={(e) => update("zakat_amount", e.target.value)} className="input" />
              </Field>
            )}
            <Field label="Tax Resident Category">
              <select value={form.tax_resident_category} onChange={(e) => update("tax_resident_category", e.target.value)} className="input">
                <option value="normal">Normal</option>
                <option value="knowledge_worker">Knowledge Worker</option>
                <option value="returning_expert">Returning Expert</option>
              </select>
            </Field>
            <Field label="CP8D Employment Status">
              <select value={form.cp8d_employment_status} onChange={(e) => update("cp8d_employment_status", e.target.value)} className="input">
                <option value="follow_employment_type">Follow employment type</option>
                <option value="permanent">Permanent</option>
                <option value="contract">Contract</option>
                <option value="trainee">Trainee</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SSFW Number">
                <input value={form.ssfw_number} onChange={(e) => update("ssfw_number", e.target.value)} className="input" placeholder="Optional" />
              </Field>
              <Field label="Overtime flat rate (RM/hr)">
                <input type="number" step="0.01" value={form.overtime_flat_rate} onChange={(e) => update("overtime_flat_rate", e.target.value)} className="input" placeholder="Optional override" />
              </Field>
            </div>
            <Field label="EA Form Commencement Date">
              <input type="date" value={form.ea_commencement_date} onChange={(e) => update("ea_commencement_date", e.target.value)} className="input" />
            </Field>
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
              <Field label="Outlet">
                <select value={access.outletId} onChange={(e) => setAccess((a) => ({ ...a, outletId: e.target.value }))} className="input">
                  <option value="">HQ / No outlet</option>
                  {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
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
