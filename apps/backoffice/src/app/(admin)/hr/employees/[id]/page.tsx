"use client";

import { useFetch } from "@/lib/use-fetch";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useConfirm, toast } from "@celsius/ui";
import { ArrowLeft, Save, Loader2, Lock, KeyRound, Shield, Eye, EyeOff, CheckCircle2, TrendingUp, Clock, Sparkles, AlertTriangle, Star, FileText, Upload, Trash2, Download, Plus, Repeat, Receipt } from "lucide-react";
import Link from "next/link";
import type { EmployeeProfile } from "@/lib/hr/types";

type EmployeeDocument = {
  id: string;
  user_id: string;
  doc_type: string;
  title: string | null;
  file_name: string;
  storage_path: string;
  size_bytes: number | null;
  mime_type: string | null;
  note: string | null;
  effective_date: string | null;
  uploaded_at: string;
  signed_url: string | null;
};

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
  const { data: me } = useFetch<{ role: string }>("/api/auth/me");
  const canSeeSalary = me?.role === "OWNER" || me?.role === "ADMIN";
  const canUploadDocs = canSeeSalary; // same gate as HR admin actions
  const { data: outlets } = useFetch<{ id: string; name: string; code: string }[]>("/api/ops/outlets");
  const { data: allowanceData } = useFetch<AllowanceData>(id ? `/api/hr/allowances?userId=${id}` : null);
  const { data: docsData, mutate: refetchDocs } = useFetch<{ documents: EmployeeDocument[] }>(
    id ? `/api/hr/employee-documents?userId=${id}` : null,
  );
  const allowance = allowanceData?.breakdown;
  const documents = docsData?.documents || [];
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [newDocType, setNewDocType] = useState<string>("loe");
  const [newDocTitle, setNewDocTitle] = useState<string>("");
  const [newDocEffectiveDate, setNewDocEffectiveDate] = useState<string>("");

  const { confirm, ConfirmDialog } = useConfirm();

  const handleUploadDoc = async (file: File) => {
    if (!id) return;
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append("user_id", id);
      fd.append("doc_type", newDocType);
      if (newDocTitle) fd.append("title", newDocTitle);
      if (newDocEffectiveDate) fd.append("effective_date", newDocEffectiveDate);
      fd.append("file", file);
      const res = await fetch("/api/hr/employee-documents", { method: "POST", body: fd });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Upload failed" }));
        toast.error(b?.error || "Upload failed");
        return;
      }
      setNewDocTitle("");
      setNewDocEffectiveDate("");
      toast.success("Document uploaded");
      refetchDocs();
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!(await confirm({ title: "Delete this document?", confirmLabel: "Delete", destructive: true }))) return;
    const res = await fetch(`/api/hr/employee-documents?id=${docId}`, { method: "DELETE" });
    if (!res.ok) {
      const b = await res.json().catch(() => ({ error: "Delete failed" }));
      toast.error(b?.error || "Delete failed");
      return;
    }
    toast.success("Document deleted");
    refetchDocs();
  };
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Resignation modal state
  const [resignOpen, setResignOpen] = useState(false);
  const [resignedAt, setResignedAt] = useState("");
  const [endDate, setEndDate] = useState("");
  const [resignReason, setResignReason] = useState("");
  const [resignSaving, setResignSaving] = useState(false);
  const [resignErr, setResignErr] = useState<string | null>(null);

  const submitResign = async () => {
    setResignSaving(true);
    setResignErr(null);
    try {
      const res = await fetch(`/api/hr/employees/${id}/resign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resigned_at: resignedAt, end_date: endDate, reason: resignReason || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      mutate();
      setResignOpen(false);
      setResignedAt(""); setEndDate(""); setResignReason("");
    } catch (e) {
      setResignErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setResignSaving(false);
    }
  };

  const cancelResign = async () => {
    if (!(await confirm({
      title: "Cancel this resignation?",
      description: "Staff will be reactivated.",
      confirmLabel: "Yes, cancel resignation",
    }))) return;
    await fetch(`/api/hr/employees/${id}/resign`, { method: "DELETE" });
    toast.success("Resignation cancelled");
    mutate();
  };

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
    // Per-staff allowance overrides (blank = use global default)
    attendance_allowance_amount: "",
    performance_allowance_amount: "",
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
        toast.error(d.error || "Failed to save bank details");
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
        toast.error(data.error || "Failed to save access");
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
        attendance_allowance_amount: p.attendance_allowance_amount != null ? String(p.attendance_allowance_amount) : "",
        performance_allowance_amount: p.performance_allowance_amount != null ? String(p.performance_allowance_amount) : "",
      });
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      // Only OWNER/ADMIN may write compensation fields. When a MANAGER submits
      // the form, OMIT basic_salary and hourly_rate so a blank/stripped local
      // form doesn't wipe the admin-set value on the server.
      const payload: Record<string, unknown> = {
        user_id: id,
        ...form,
        manager_user_id: form.manager_user_id || null,
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
      };
      if (canSeeSalary) {
        payload.basic_salary = form.basic_salary ? parseFloat(form.basic_salary) : 0;
        payload.hourly_rate = form.hourly_rate ? parseFloat(form.hourly_rate) : null;
        // Allowance overrides: blank input → NULL (use global default)
        payload.attendance_allowance_amount = form.attendance_allowance_amount
          ? parseFloat(form.attendance_allowance_amount)
          : null;
        payload.performance_allowance_amount = form.performance_allowance_amount
          ? parseFloat(form.performance_allowance_amount)
          : null;
      } else {
        // Remove stale empties from the spread above so they don't land on the server
        delete payload.basic_salary;
        delete payload.hourly_rate;
        delete payload.attendance_allowance_amount;
        delete payload.performance_allowance_amount;
      }

      const res = await fetch("/api/hr/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaved(true);
        mutate();
        setTimeout(() => setSaved(false), 2000);
      } else {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        toast.error(body?.error || `Save failed (${res.status})`);
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
      <ConfirmDialog />
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

        {/* Compensation — OWNER / ADMIN only (salary is restricted PII) */}
        {canSeeSalary && (
          <section className="rounded-xl border bg-card p-5">
            <h2 className="mb-4 font-semibold">Compensation</h2>
            <div className="space-y-3">
              <Field label="Basic Salary (RM/month)">
                <input type="number" value={form.basic_salary} onChange={(e) => update("basic_salary", e.target.value)} className="input" placeholder="0.00" />
              </Field>
              <Field label="Hourly Rate (RM) — for part-timers">
                <input type="number" value={form.hourly_rate} onChange={(e) => update("hourly_rate", e.target.value)} className="input" placeholder="Optional" />
              </Field>
              <div className="mt-2 border-t pt-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Allowances — leave blank to use the global default from HR Settings → Allowances.
                  Each value is a max; attendance penalties and performance score reduce the actual payout.
                </p>
                <Field label="Attendance Allowance Max (RM/month)">
                  <input type="number" min={0} step="0.01" value={form.attendance_allowance_amount} onChange={(e) => update("attendance_allowance_amount", e.target.value)} className="input" placeholder="Use default" />
                </Field>
                <Field label="Performance Allowance Max (RM/month)">
                  <input type="number" min={0} step="0.01" value={form.performance_allowance_amount} onChange={(e) => update("performance_allowance_amount", e.target.value)} className="input" placeholder="Use default" />
                </Field>
              </div>
            </div>
          </section>
        )}

        {/* Recurring Items — per-employee allowances/deductions auto-applied each cycle */}
        {canSeeSalary && id && <RecurringItemsSection userId={id} />}

        {/* Tax Reliefs — per-employee per-year reliefs (reduces PCB taxable income) */}
        {canSeeSalary && id && <TaxReliefsSection userId={id} />}

        {/* Onboarding checklist — Day 1, Week 1, Month 1, Probation end */}
        {canUploadDocs && id && <OnboardingSection userId={id} />}

        {/* Salary History — promotions, increments, restructures (audit trail) */}
        {canSeeSalary && id && <SalaryHistorySection userId={id} />}

        {/* Disciplinary — warnings, suspensions, PIPs */}
        {canUploadDocs && id && <DisciplinarySection userId={id} />}

        {/* Company Assets — laptops, uniforms, key cards (clearance on resign) */}
        {canUploadDocs && id && <AssetsSection userId={id} />}

        {/* Documents — LoE, contracts, confirmation letters, resignation letters, etc. */}
        <section className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4" />
            Documents
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Letters of Employment, contracts, NDAs, confirmation letters, resignation letters, etc.
            Click a row to open.
          </p>

          {canUploadDocs && (
            <div className="mb-4 rounded-lg border border-dashed bg-muted/20 p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">Type</span>
                  <select
                    value={newDocType}
                    onChange={(e) => setNewDocType(e.target.value)}
                    className="mt-0.5 w-full rounded border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="loe">Letter of Employment</option>
                    <option value="coe">Contract of Employment</option>
                    <option value="contract">Contract</option>
                    <option value="nda">NDA</option>
                    <option value="confirmation">Confirmation Letter</option>
                    <option value="resignation">Resignation Letter</option>
                    <option value="medical">Medical</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">Title (optional)</span>
                  <input
                    type="text"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    placeholder={`e.g. ${new Date().getFullYear()} LoE`}
                    className="mt-0.5 w-full rounded border bg-background px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">Effective date</span>
                  <input
                    type="date"
                    value={newDocEffectiveDate}
                    onChange={(e) => setNewDocEffectiveDate(e.target.value)}
                    className="mt-0.5 w-full rounded border bg-background px-2 py-1.5 text-xs"
                  />
                </label>
              </div>
              <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded border-2 border-dashed bg-background py-4 text-xs text-muted-foreground hover:bg-muted/30">
                {uploadingDoc ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Click to select a file (PDF / image / doc)
                  </>
                )}
                <input
                  type="file"
                  accept=".pdf,image/*,.doc,.docx"
                  className="hidden"
                  disabled={uploadingDoc}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadDoc(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}

          {documents.length === 0 ? (
            <p className="rounded border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
              No documents uploaded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {documents.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border bg-background p-3 text-xs">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-gray-600">
                        {d.doc_type}
                      </span>
                      <span className="font-medium truncate">
                        {d.title || d.file_name}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {d.file_name}
                      {d.effective_date && ` · Effective ${d.effective_date}`}
                      {d.size_bytes && ` · ${(d.size_bytes / 1024).toFixed(0)} KB`}
                      {" · "}
                      Uploaded {new Date(d.uploaded_at).toLocaleDateString()}
                    </div>
                  </div>
                  {d.signed_url && (
                    <a
                      href={d.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-muted"
                      title="Open in new tab"
                    >
                      <Download className="h-3 w-3" /> Open
                    </a>
                  )}
                  {canUploadDocs && (
                    <button
                      onClick={() => handleDeleteDoc(d.id)}
                      className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
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

      {/* Probation banner — surfaces 3-month confirmation deadline */}
      {(() => {
        const p = profile as unknown as { join_date?: string | null; probation_end_date?: string | null; resigned_at?: string | null; end_date?: string | null } | null;
        if (!p?.join_date) return null;
        if (p.resigned_at || p.end_date) return null; // already resigning, skip
        const joinTs = Date.parse(p.join_date);
        // Effective probation end: explicit field if set, else join_date + 90 days.
        const effectiveEnd = p.probation_end_date || new Date(joinTs + 90 * 86400000).toISOString().slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        if (effectiveEnd < today) return null; // probation already ended
        const daysLeft = Math.ceil((Date.parse(effectiveEnd) - Date.now()) / 86400000);
        return (
          <section className="mt-6 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-blue-900">In Probation</h3>
                <p className="mt-1 text-xs text-blue-800">
                  Joined <strong>{p.join_date}</strong>. Confirmation due by <strong>{effectiveEnd}</strong>
                  {" "}({daysLeft} day{daysLeft === 1 ? "" : "s"} left). Issue a confirmation letter, extend, or terminate before then.
                </p>
              </div>
              {canSeeSalary && (
                <a
                  href={`/api/hr/employees/${id}/confirmation-letter`}
                  download
                  className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                >
                  Download Confirmation Letter
                </a>
              )}
            </div>
          </section>
        );
      })()}

      {/* Resignation */}
      {(() => {
        const p = profile as unknown as { resigned_at?: string | null; end_date?: string | null } | null;
        const isResigned = !!(p?.resigned_at || p?.end_date);
        return (
          <section className="mt-6 rounded-lg border border-red-200 bg-red-50/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-red-900">Resignation</h3>
                {isResigned ? (
                  <p className="mt-1 text-xs text-red-800">
                    Resigned on <strong>{p?.resigned_at}</strong> · Last working day{" "}
                    <strong>{p?.end_date}</strong>. Auto-deactivates at end of that day.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-red-700">Mark employee as resigned to trigger prorate + auto-deactivation.</p>
                )}
              </div>
              {isResigned ? (
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/hr/payroll/annual-forms?year=${new Date(p?.end_date || new Date()).getFullYear()}&type=ea&user_id=${id}`}
                    className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    download
                  >
                    Download EA Form
                  </a>
                  <button onClick={cancelResign} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                    Cancel Resignation
                  </button>
                </div>
              ) : (
                <button onClick={() => setResignOpen(true)} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                  Mark as Resigned
                </button>
              )}
            </div>
          </section>
        );
      })()}

      {/* Resign Modal */}
      {resignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setResignOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Mark as Resigned</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Payroll will prorate final salary. Staff auto-deactivates at end of last working day.
            </p>
            {id && <ResignAssetWarning userId={id} />}
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Resignation Date (letter submitted)</span>
                <input type="date" value={resignedAt} onChange={(e) => setResignedAt(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Last Working Day *</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-md border px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Reason (optional)</span>
                <input value={resignReason} onChange={(e) => setResignReason(e.target.value)} placeholder="e.g. further studies" className="w-full rounded-md border px-3 py-2 text-sm" />
              </label>
              {resignErr && <p className="text-xs text-red-600">{resignErr}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setResignOpen(false)} className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50">Cancel</button>
              <button
                onClick={submitResign}
                disabled={resignSaving || !resignedAt || !endDate}
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {resignSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirm Resignation
              </button>
            </div>
          </div>
        </div>
      )}

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

// ─────────────────────────────────────────────────────────────────────────────
// Recurring Items
// ─────────────────────────────────────────────────────────────────────────────

type CatalogEntry = {
  code: string;
  name: string;
  category: string;
  item_type: string;
  ea_form_field: string | null;
  pcb_taxable: boolean;
  epf_contributing: boolean;
  socso_contributing: boolean;
  eis_contributing: boolean;
};

type RecurringItem = {
  id: string;
  user_id: string;
  catalog_code: string;
  kind: "addition" | "deduction";
  amount: number;
  effective_date: string;
  end_date: string | null;
  note: string | null;
  unique_identifier: string | null;
  catalog: CatalogEntry | null;
};

function RecurringItemsSection({ userId }: { userId: string }) {
  const { data, mutate } = useFetch<{ items: RecurringItem[] }>(
    `/api/hr/employees/${userId}/recurring-items`,
  );
  const { data: catalogData } = useFetch<{ items: CatalogEntry[] }>("/api/hr/payroll-items");
  const items = data?.items || [];
  const catalog = (catalogData?.items || []).filter((c) => (c as { is_active?: boolean }).is_active !== false);

  const { confirm, ConfirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = catalog.find((c) => c.code === code);
  const inferredKind: "addition" | "deduction" = selected
    ? (selected.category === "Deductions" ? "deduction" : "addition")
    : "addition";

  const reset = () => {
    setCode("");
    setAmount("");
    setEndDate("");
    setNote("");
    setErr(null);
    setShowAdd(false);
  };

  const handleAdd = async () => {
    if (!code || !amount) {
      setErr("Pick an item and enter an amount.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/hr/employees/${userId}/recurring-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalog_code: code,
          kind: inferredKind,
          amount: Number(amount),
          effective_date: effectiveDate,
          end_date: endDate || null,
          note: note || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      mutate();
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!(await confirm({ title: "Remove this recurring item?", confirmLabel: "Remove", destructive: true }))) return;
    const res = await fetch(
      `/api/hr/employees/${userId}/recurring-items?item_id=${itemId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      toast.success("Item removed");
      mutate();
    } else {
      toast.error("Failed to remove item");
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <ConfirmDialog />
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Repeat className="h-4 w-4" />
          Recurring Allowances & Deductions
        </h2>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Items from the payroll catalog applied to every payroll run while active.
        Use <em>effective date</em> to start and <em>end date</em> to stop.
      </p>

      {showAdd && (
        <div className="mb-4 space-y-3 rounded-lg border bg-muted/20 p-3">
          <Field label="Item">
            <select value={code} onChange={(e) => setCode(e.target.value)} className="input">
              <option value="">Select an item from catalog…</option>
              {catalog.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.category})
                </option>
              ))}
            </select>
          </Field>
          {selected && (
            <p className="text-[10px] text-muted-foreground">
              Will record as <strong>{inferredKind}</strong>. Statutory:
              {selected.epf_contributing ? " EPF" : ""}
              {selected.socso_contributing ? " · SOCSO" : ""}
              {selected.eis_contributing ? " · EIS" : ""}
              {selected.pcb_taxable ? " · PCB" : ""}
              {selected.ea_form_field ? ` · EA ${selected.ea_form_field}` : ""}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (RM)">
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" placeholder="0.00" />
            </Field>
            <Field label="Effective Date">
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="input" />
            </Field>
            <Field label="End Date (optional)">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
            </Field>
            <Field label="Note (optional)">
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="e.g. Tranche 1 of 6" />
            </Field>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50">Cancel</button>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Add
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="rounded border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
          No recurring items configured.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const today = new Date().toISOString().slice(0, 10);
            const active = it.effective_date <= today && (!it.end_date || it.end_date >= today);
            return (
              <div key={it.id} className="flex items-center gap-3 rounded-lg border bg-background p-3 text-xs">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${
                  it.kind === "addition" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                }`}>
                  {it.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{it.catalog?.name || it.catalog_code}</span>
                    {!active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-500">inactive</span>}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    From {it.effective_date}{it.end_date && ` → ${it.end_date}`}
                    {it.note && ` · ${it.note}`}
                  </div>
                </div>
                <span className="font-mono font-semibold tabular-nums">
                  RM {Number(it.amount).toFixed(2)}
                </span>
                <button
                  onClick={() => handleDelete(it.id)}
                  className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tax Reliefs
// ─────────────────────────────────────────────────────────────────────────────

type ReliefCatalogEntry = {
  code: string;
  name: string;
  parent_code: string | null;
  ea_form_field: string | null;
  max_amount: number | null;
  notes: string | null;
};

type EmployeeRelief = {
  id: string;
  user_id: string;
  year: number;
  relief_code: string;
  amount_100pct: number | null;
  amount_50pct: number | null;
  catalog: ReliefCatalogEntry | null;
};

function TaxReliefsSection({ userId }: { userId: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, mutate } = useFetch<{ year: number; reliefs: EmployeeRelief[] }>(
    `/api/hr/employees/${userId}/tax-reliefs?year=${year}`,
  );
  const { data: catalogData } = useFetch<{ items: ReliefCatalogEntry[] }>("/api/hr/tax-reliefs-catalog");
  const reliefs = data?.reliefs || [];
  const catalog = catalogData?.items || [];

  const { confirm, ConfirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = reliefs.reduce(
    (s, r) => s + Number(r.amount_100pct || 0) + Number(r.amount_50pct || 0) / 2,
    0,
  );

  const reset = () => {
    setCode("");
    setAmount("");
    setErr(null);
    setShowAdd(false);
  };

  const handleAdd = async () => {
    if (!code || !amount) {
      setErr("Pick a relief and enter an amount.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/hr/employees/${userId}/tax-reliefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          relief_code: code,
          amount_100pct: Number(amount),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      mutate();
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (reliefId: string) => {
    if (!(await confirm({ title: "Remove this relief?", confirmLabel: "Remove", destructive: true }))) return;
    const res = await fetch(
      `/api/hr/employees/${userId}/tax-reliefs?relief_id=${reliefId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      toast.success("Relief removed");
      mutate();
    } else {
      toast.error("Failed to remove relief");
    }
  };

  const claimedCodes = new Set(reliefs.map((r) => r.relief_code));
  const availableCatalog = catalog.filter((c) => !claimedCodes.has(c.code));

  return (
    <section className="rounded-xl border bg-card p-5">
      <ConfirmDialog />
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Receipt className="h-4 w-4" />
          Tax Reliefs
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border bg-background px-2 py-1 text-xs"
          >
            {[year + 1, year, year - 1, year - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          )}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Personal reliefs (spouse, children, lifestyle, etc.) reduce PCB taxable income.
        Year-scoped — declared annually by the employee.
      </p>

      {showAdd && (
        <div className="mb-4 space-y-3 rounded-lg border bg-muted/20 p-3">
          <Field label="Relief">
            <select value={code} onChange={(e) => setCode(e.target.value)} className="input">
              <option value="">Select a relief from LHDN catalog…</option>
              {availableCatalog.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.parent_code ? "  ↳ " : ""}{c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount Claimed (RM)">
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" placeholder="0.00" />
          </Field>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50">Cancel</button>
            <button
              onClick={handleAdd}
              disabled={saving}
              className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Add
            </button>
          </div>
        </div>
      )}

      {reliefs.length === 0 ? (
        <p className="rounded border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
          No reliefs declared for {year}.
        </p>
      ) : (
        <div className="space-y-2">
          {reliefs.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border bg-background p-3 text-xs">
              <div className="min-w-0 flex-1">
                <span className="font-medium truncate block">{r.catalog?.name || r.relief_code}</span>
                {r.catalog?.ea_form_field && (
                  <span className="mt-0.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-500">
                    EA {r.catalog.ea_form_field}
                  </span>
                )}
              </div>
              <span className="font-mono font-semibold tabular-nums">
                RM {Number(r.amount_100pct || 0).toFixed(2)}
              </span>
              <button
                onClick={() => handleDelete(r.id)}
                className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                title="Remove"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs font-semibold">
            <span>Total declared (effective)</span>
            <span className="font-mono">RM {total.toFixed(2)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Salary History
// ─────────────────────────────────────────────────────────────────────────────

type SalaryEntry = {
  id: string;
  effective_date: string;
  end_date: string | null;
  salary_type: string;
  amount: number;
  comment: string | null;
  created_at: string | null;
  created_by: string | null;
};

function SalaryHistorySection({ userId }: { userId: string }) {
  const { data, mutate } = useFetch<{ entries: SalaryEntry[] }>(`/api/hr/employees/${userId}/salary-history`);
  const entries = data?.entries || [];
  const { confirm, ConfirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<string>("base");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setShowAdd(false); setAmount(""); setComment(""); setErr(null); };

  const submit = async () => {
    if (!effective || !amount) { setErr("Date and amount required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/employees/${userId}/salary-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effective_date: effective,
          salary_type: type,
          amount: Number(amount),
          comment: comment || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      mutate();
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!(await confirm({ title: "Remove this entry from salary history?", confirmLabel: "Remove", destructive: true }))) return;
    const res = await fetch(`/api/hr/employees/${userId}/salary-history?entry_id=${entryId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Entry removed");
      mutate();
    } else {
      toast.error("Failed to remove entry");
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <ConfirmDialog />
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <TrendingUp className="h-4 w-4" />
          Salary History
        </h2>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            <Plus className="h-3 w-3" /> Log change
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Track increments, promotions, and restructures. Saving "base" or "hourly"
        with effective date ≤ today also updates the live profile so payroll picks it up.
      </p>

      {showAdd && (
        <div className="mb-4 space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective Date">
              <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="input" />
            </Field>
            <Field label="Type">
              <select value={type} onChange={(e) => setType(e.target.value)} className="input">
                <option value="base">Base salary (RM/month)</option>
                <option value="hourly">Hourly rate (RM/hr)</option>
                <option value="increment">Increment</option>
                <option value="bonus">Bonus</option>
                <option value="allowance">Allowance change</option>
              </select>
            </Field>
            <Field label="Amount (RM)">
              <input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="input" placeholder="0.00" />
            </Field>
            <Field label="Comment">
              <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} className="input" placeholder="e.g. Annual increment, Confirmation bump" />
            </Field>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Log change
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="rounded border bg-muted/10 p-4 text-center text-xs text-muted-foreground">No salary changes logged.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-lg border bg-background p-3 text-xs">
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-blue-700">{e.salary_type}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{e.effective_date}</span>
                  {e.end_date && <span className="text-gray-400">→ {e.end_date}</span>}
                </div>
                {e.comment && <div className="mt-0.5 text-[10px] text-muted-foreground">{e.comment}</div>}
              </div>
              <span className="font-mono font-semibold tabular-nums">RM {Number(e.amount).toFixed(2)}</span>
              <button onClick={() => handleDelete(e.id)} className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Disciplinary Actions
// ─────────────────────────────────────────────────────────────────────────────

type DisciplinaryAction = {
  id: string;
  issued_at: string;
  category: string;
  severity: string;
  incident_date: string | null;
  reason: string;
  action_taken: string | null;
  effective_until: string | null;
  acknowledged_at: string | null;
  status: string;
  notes: string | null;
};

const DISC_CATEGORIES = [
  { v: "verbal_warning", l: "Verbal warning" },
  { v: "written_warning", l: "Written warning" },
  { v: "final_written_warning", l: "Final written warning" },
  { v: "suspension", l: "Suspension" },
  { v: "pip", l: "Performance Improvement Plan (PIP)" },
  { v: "dismissal", l: "Dismissal" },
  { v: "note", l: "Note (no action)" },
];

function DisciplinarySection({ userId }: { userId: string }) {
  const { data, mutate } = useFetch<{ actions: DisciplinaryAction[] }>(`/api/hr/employees/${userId}/disciplinary`);
  const actions = data?.actions || [];
  const activeCount = actions.filter((a) => a.status === "active").length;

  const { confirm, ConfirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState("verbal_warning");
  const [severity, setSeverity] = useState("minor");
  const [reason, setReason] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setShowAdd(false); setReason(""); setActionTaken(""); setEffectiveUntil(""); setErr(null); };

  const submit = async () => {
    if (!issuedAt || !category || !reason) { setErr("Issued date, category, reason required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/employees/${userId}/disciplinary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issued_at: issuedAt,
          category,
          severity,
          reason,
          action_taken: actionTaken || null,
          effective_until: effectiveUntil || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      mutate();
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const close = async (id: string) => {
    const res = await fetch(`/api/hr/employees/${userId}/disciplinary`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action_id: id, status: "closed" }),
    });
    if (res.ok) mutate();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Delete this disciplinary record?", confirmLabel: "Delete", destructive: true }))) return;
    const res = await fetch(`/api/hr/employees/${userId}/disciplinary?action_id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Record deleted");
      mutate();
    } else {
      toast.error("Failed to delete record");
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <ConfirmDialog />
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Disciplinary Record
          {activeCount > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">{activeCount} active</span>
          )}
        </h2>
        {!showAdd && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted">
            <Plus className="h-3 w-3" /> Issue
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Formal record of warnings, suspensions, and dismissals (per LoE clause C3).
        Pairs with review-penalties — those dock pay; this is the audit trail.
      </p>

      {showAdd && (
        <div className="mb-4 space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issued Date">
              <input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className="input" />
            </Field>
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
                {DISC_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="input">
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="major">Major</option>
                <option value="gross">Gross misconduct</option>
              </select>
            </Field>
            <Field label="Effective Until (optional)">
              <input type="date" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} className="input" />
            </Field>
          </div>
          <Field label="Reason / incident">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="What happened, when, where, witness if any" />
          </Field>
          <Field label="Action taken">
            <textarea rows={2} value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} className="input" placeholder="e.g. Verbal warning issued, will reassess in 30 days" />
          </Field>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Issue
            </button>
          </div>
        </div>
      )}

      {actions.length === 0 ? (
        <p className="rounded border bg-muted/10 p-4 text-center text-xs text-muted-foreground">No disciplinary actions on record.</p>
      ) : (
        <div className="space-y-2">
          {actions.map((a) => {
            const sevColor = a.severity === "gross" ? "bg-red-100 text-red-700"
              : a.severity === "major" ? "bg-orange-100 text-orange-800"
              : a.severity === "moderate" ? "bg-amber-100 text-amber-800"
              : "bg-gray-100 text-gray-600";
            return (
              <div key={a.id} className="rounded-lg border bg-background p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${sevColor}`}>{a.severity}</span>
                  <span className="font-semibold">{(DISC_CATEGORIES.find((c) => c.v === a.category)?.l) || a.category}</span>
                  <span className="text-gray-400">{a.issued_at}</span>
                  {a.status === "active" ? (
                    <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold text-red-700">Active</span>
                  ) : (
                    <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-bold text-gray-500">{a.status}</span>
                  )}
                </div>
                <p className="mt-1 text-[11px]">{a.reason}</p>
                {a.action_taken && <p className="mt-1 text-[10px] text-muted-foreground">{a.action_taken}</p>}
                {a.effective_until && <p className="mt-1 text-[10px] text-amber-700">Effective until {a.effective_until}</p>}
                <div className="mt-2 flex justify-end gap-2">
                  {a.status === "active" && (
                    <button onClick={() => close(a.id)} className="rounded border bg-white px-2 py-0.5 text-[10px] hover:bg-gray-50">
                      Close
                    </button>
                  )}
                  <button onClick={() => handleDelete(a.id)} className="rounded border border-red-200 bg-red-50 p-1 text-red-600 hover:bg-red-100">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Company Assets
// ─────────────────────────────────────────────────────────────────────────────

type Asset = {
  id: string;
  asset_type: string;
  description: string;
  serial_number: string | null;
  issued_at: string;
  expected_return_at: string | null;
  returned_at: string | null;
  return_condition: string | null;
  return_notes: string | null;
  status: string;
};

const ASSET_TYPES = [
  "laptop", "phone", "uniform", "apron", "keycard", "key", "name_tag",
  "locker", "tablet", "pos_terminal", "sim_card", "cash_float", "other",
];

function AssetsSection({ userId }: { userId: string }) {
  const { data, mutate } = useFetch<{ assets: Asset[] }>(`/api/hr/employees/${userId}/assets`);
  const assets = data?.assets || [];
  const outstandingCount = assets.filter((a) => a.status === "issued").length;

  const { confirm, ConfirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState("laptop");
  const [description, setDescription] = useState("");
  const [serial, setSerial] = useState("");
  const [issuedAt, setIssuedAt] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setShowAdd(false); setDescription(""); setSerial(""); setErr(null); };

  const submit = async () => {
    if (!description || !type || !issuedAt) { setErr("Type, description, issued date required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/employees/${userId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_type: type,
          description,
          serial_number: serial || null,
          issued_at: issuedAt,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      mutate();
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const markReturned = async (asset: Asset) => {
    const cond = window.prompt("Return condition: good / damaged / lost / not_returned", "good");
    if (!cond || !["good", "damaged", "lost", "not_returned"].includes(cond)) return;
    const notes = window.prompt("Return notes (optional)") || undefined;
    const res = await fetch(`/api/hr/employees/${userId}/assets`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_id: asset.id,
        status: cond === "lost" || cond === "not_returned" ? "lost" : "returned",
        return_condition: cond,
        return_notes: notes,
      }),
    });
    if (res.ok) mutate();
  };

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Delete this asset record?", confirmLabel: "Delete", destructive: true }))) return;
    const res = await fetch(`/api/hr/employees/${userId}/assets?asset_id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Asset record deleted");
      mutate();
    } else {
      toast.error("Failed to delete asset record");
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <ConfirmDialog />
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Shield className="h-4 w-4" />
          Company Assets
          {outstandingCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{outstandingCount} outstanding</span>
          )}
        </h2>
        {!showAdd && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted">
            <Plus className="h-3 w-3" /> Issue
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Track laptops, uniforms, key cards, etc. issued to this employee.
        Outstanding assets are blocked at resignation until returned or written off.
      </p>

      {showAdd && (
        <div className="mb-4 space-y-3 rounded-lg border bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select value={type} onChange={(e) => setType(e.target.value)} className="input">
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </Field>
            <Field label="Issued On">
              <input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className="input" />
            </Field>
            <Field label="Description">
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="input" placeholder="e.g. MacBook Air M2 14-inch (Space Gray)" />
            </Field>
            <Field label="Serial / tag (optional)">
              <input type="text" value={serial} onChange={(e) => setSerial(e.target.value)} className="input" placeholder="e.g. C02XXX" />
            </Field>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Issue
            </button>
          </div>
        </div>
      )}

      {assets.length === 0 ? (
        <p className="rounded border bg-muted/10 p-4 text-center text-xs text-muted-foreground">No company assets issued.</p>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border bg-background p-3 text-xs">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gray-600">{a.asset_type.replace(/_/g, " ")}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{a.description}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  Issued {a.issued_at}
                  {a.serial_number && ` · ${a.serial_number}`}
                  {a.returned_at && ` · Returned ${a.returned_at} (${a.return_condition})`}
                </div>
              </div>
              {a.status === "issued" ? (
                <button onClick={() => markReturned(a)} className="rounded border bg-white px-2 py-1 text-[10px] hover:bg-gray-50">
                  Mark returned
                </button>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                  a.status === "returned" ? "bg-emerald-100 text-emerald-700"
                  : a.status === "lost" ? "bg-red-100 text-red-700"
                  : "bg-gray-100 text-gray-600"
                }`}>{a.status}</span>
              )}
              <button onClick={() => handleDelete(a.id)} className="rounded-lg border border-red-200 bg-red-50 p-1 text-red-600 hover:bg-red-100">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ResignAssetWarning({ userId }: { userId: string }) {
  const { data } = useFetch<{ assets: Asset[] }>(`/api/hr/employees/${userId}/assets`);
  const outstanding = (data?.assets || []).filter((a) => a.status === "issued");
  if (outstanding.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-semibold">⚠ {outstanding.length} outstanding asset{outstanding.length === 1 ? "" : "s"}</p>
      <ul className="mt-1 list-disc pl-5">
        {outstanding.slice(0, 4).map((a) => (
          <li key={a.id}>{a.asset_type.replace(/_/g, " ")}: {a.description}</li>
        ))}
        {outstanding.length > 4 && <li>+ {outstanding.length - 4} more</li>}
      </ul>
      <p className="mt-1">Mark these as returned in the Assets section before final settlement, or proceed if clearance is happening separately.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding Checklist
// ─────────────────────────────────────────────────────────────────────────────

type OnboardingTask = {
  id: string;
  stage: "day_1" | "week_1" | "month_1" | "probation_end";
  title: string;
  description: string | null;
  is_required: boolean;
  sort_order: number;
  progress: { completed_at: string | null; completed_by: string | null; note: string | null } | null;
};

const STAGE_LABEL: Record<string, string> = {
  day_1: "Day 1",
  week_1: "Week 1",
  month_1: "Month 1",
  probation_end: "Probation end (3 months)",
};

function OnboardingSection({ userId }: { userId: string }) {
  const { data, mutate } = useFetch<{ tasks: OnboardingTask[] }>(`/api/hr/employees/${userId}/onboarding`);
  const tasks = data?.tasks || [];

  const grouped = new Map<string, OnboardingTask[]>();
  for (const t of tasks) {
    const list = grouped.get(t.stage) || [];
    list.push(t);
    grouped.set(t.stage, list);
  }

  const total = tasks.length;
  const done = tasks.filter((t) => t.progress?.completed_at).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const toggle = async (t: OnboardingTask) => {
    const isCompleted = !!t.progress?.completed_at;
    const res = await fetch(`/api/hr/employees/${userId}/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: t.id, completed: !isCompleted }),
    });
    if (res.ok) mutate();
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4" />
          Onboarding
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            pct === 100 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"
          }`}>{done}/{total}</span>
        </h2>
        <span className="text-xs text-muted-foreground">{pct}% complete</span>
      </div>
      <div className="mb-4 h-1.5 w-full rounded-full bg-gray-100">
        <div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-3">
        {(["day_1", "week_1", "month_1", "probation_end"] as const).map((stage) => {
          const list = grouped.get(stage) || [];
          if (list.length === 0) return null;
          const stageDone = list.filter((t) => t.progress?.completed_at).length;
          return (
            <div key={stage}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {STAGE_LABEL[stage]} <span className="text-gray-400">· {stageDone}/{list.length}</span>
              </p>
              <ul className="space-y-1">
                {list.map((t) => {
                  const completed = !!t.progress?.completed_at;
                  return (
                    <li key={t.id} className="flex items-start gap-2 rounded border bg-background p-2 text-xs">
                      <button
                        onClick={() => toggle(t)}
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          completed ? "border-emerald-500 bg-emerald-500 text-white" : "border-gray-300 bg-white"
                        }`}
                      >
                        {completed && <CheckCircle2 className="h-3 w-3" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <span className={`font-medium ${completed ? "line-through text-gray-400" : ""}`}>{t.title}</span>
                        {t.description && <p className="mt-0.5 text-[10px] text-muted-foreground">{t.description}</p>}
                        {completed && t.progress?.completed_at && (
                          <p className="mt-0.5 text-[10px] text-emerald-700">
                            Completed {new Date(t.progress.completed_at).toLocaleDateString("en-MY")}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
