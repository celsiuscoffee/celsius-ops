"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState, useEffect } from "react";
import { ChevronRight, CheckCircle2, AlertCircle, Search, Plus, Loader2, X, Download, Sparkles, FileText, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
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
  status?: string;
  profile_photo_url?: string | null;
  onboarding?: { done: number; total: number };
  hrProfile: (EmployeeProfile & { resigned_at?: string | null; end_date?: string | null }) | null;
};

type EmploymentFilter = "all" | "full_time" | "part_time" | "contract" | "no_profile" | "resigned";

type Outlet = { id: string; name: string; code: string };

export default function EmployeesPage() {
  const router = useRouter();
  const { data, mutate } = useFetch<{ employees: Employee[]; scope?: "direct-reports" | "all" }>("/api/hr/employees");
  const { data: outlets } = useFetch<Outlet[]>("/api/ops/outlets");
  const scope = data?.scope;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EmploymentFilter>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [outletFilter, setOutletFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  // Bulk select. The Set holds employee ids that are currently checked.
  // Clicking the row (anywhere outside the checkbox or trailing buttons)
  // navigates to the profile; clicking the checkbox toggles selection.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMemoOpen, setBulkMemoOpen] = useState(false);
  const [bulkMemoTitle, setBulkMemoTitle] = useState("");
  const [bulkMemoBody, setBulkMemoBody] = useState("");
  const [bulkMemoType, setBulkMemoType] = useState<"announcement" | "reminder" | "commendation" | "note">("announcement");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // "Login access" toggle. When OFF, phone + PIN are treated as optional — used
  // for contract / vendor / HR-only records that won't sign into the staff app.
  const [wantsLogin, setWantsLogin] = useState(true);
  // LoE prefill — holds the uploaded PDF until after the employee is created,
  // then it's attached to their Document vault as doc_type=loe.
  const [loeFile, setLoeFile] = useState<File | null>(null);
  const [parsingLoe, setParsingLoe] = useState(false);
  const [loeConfidence, setLoeConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [loePrefilled, setLoePrefilled] = useState(false);
  const [loeDragOver, setLoeDragOver] = useState(false);
  // Caller role — drives UI gates (the New Employee button mirrors the API,
  // which is OWNER/ADMIN only — see api/hr/employees/create/route.ts).
  const [me, setMe] = useState<{ role: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setMe({ role: d.role });
    });
  }, []);
  const canCreate = me?.role === "OWNER" || me?.role === "ADMIN";
  const [newEmp, setNewEmp] = useState({
    name: "",
    fullName: "",
    phone: "",
    email: "",
    role: "STAFF",
    outletId: "",
    position: "Barista",
    employment_type: "full_time",
    join_date: new Date().toISOString().slice(0, 10),
    basic_salary: "",
    hourly_rate: "",
    attendance_allowance_amount: "",
    performance_allowance_amount: "",
    ic_number: "",
    date_of_birth: "",
    gender: "",
    pin: "",
  });

  // Resolve the AI's outletName guess to a real outletId in our list.
  const resolveOutletId = (name: string | null | undefined): string => {
    if (!name || !outlets) return "";
    const q = name.toLowerCase();
    const match = outlets.find((o) =>
      o.name.toLowerCase().includes(q) || q.includes(o.name.toLowerCase()),
    );
    return match?.id ?? "";
  };

  const parseLoe = async (file: File) => {
    setLoeFile(file);
    setLoeConfidence(null);
    setLoePrefilled(false);
    setParsingLoe(true);
    setCreateError(null);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const res = await fetch("/api/hr/loe-import/extract", { method: "POST", body: fd });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Parse failed" }));
        setCreateError(b?.error || "Could not parse LoE — fill in manually");
        return;
      }
      const { records } = await res.json();
      const r = records?.[0];
      if (!r) {
        setCreateError("No data extracted — fill in manually");
        return;
      }
      setLoeConfidence(r.confidence || "medium");
      // Merge into form — only overwrite empty fields so repeated uploads
      // don't clobber manual edits.
      setNewEmp((f) => ({
        ...f,
        name: f.name || r.name || "",
        fullName: f.fullName || r.fullName || "",
        phone: f.phone || r.phone || "",
        email: f.email || r.email || "",
        position: r.position || f.position,
        employment_type: r.employmentType || f.employment_type,
        join_date: r.joinDate || f.join_date,
        basic_salary: f.basic_salary || (r.basicSalary != null ? String(r.basicSalary) : ""),
        hourly_rate: f.hourly_rate || (r.hourlyRate != null ? String(r.hourlyRate) : ""),
        attendance_allowance_amount: f.attendance_allowance_amount || (r.attendanceAllowance != null ? String(r.attendanceAllowance) : ""),
        performance_allowance_amount: f.performance_allowance_amount || (r.performanceAllowance != null ? String(r.performanceAllowance) : ""),
        ic_number: f.ic_number || r.icNumber || "",
        outletId: f.outletId || resolveOutletId(r.outletName),
      }));
      setLoePrefilled(true);
    } finally {
      setParsingLoe(false);
    }
  };

  const clearLoe = () => {
    setLoeFile(null);
    setLoeConfidence(null);
    setLoePrefilled(false);
  };

  const handleCreate = async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const payload = {
        ...newEmp,
        // If login isn't required, drop phone + pin so no placeholder gets
        // saved. Phone is nullable at the schema level.
        phone: wantsLogin ? (newEmp.phone || null) : (newEmp.phone || null),
        outletId: newEmp.outletId || null,
        email: newEmp.email || null,
        fullName: newEmp.fullName || null,
        ic_number: newEmp.ic_number || null,
        date_of_birth: newEmp.date_of_birth || null,
        gender: newEmp.gender || null,
        pin: wantsLogin ? (newEmp.pin || null) : null,
        attendance_allowance_amount: newEmp.attendance_allowance_amount
          ? parseFloat(newEmp.attendance_allowance_amount)
          : null,
        performance_allowance_amount: newEmp.performance_allowance_amount
          ? parseFloat(newEmp.performance_allowance_amount)
          : null,
      };
      const res = await fetch("/api/hr/employees/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        setCreateError(d.error || "Failed to create employee");
        return;
      }
      const { user } = await res.json();

      // If the caller supplied an LoE, attach it to the new employee's
      // document vault. Best-effort — a failure here doesn't invalidate
      // the create; HR can upload again from the profile page.
      if (loeFile) {
        const fd = new FormData();
        fd.append("user_id", user.id);
        fd.append("doc_type", "loe");
        fd.append("title", `LoE — ${newEmp.join_date || new Date().toISOString().slice(0, 10)}`);
        if (newEmp.join_date) fd.append("effective_date", newEmp.join_date);
        fd.append("file", loeFile);
        await fetch("/api/hr/employee-documents", { method: "POST", body: fd }).catch(() => null);
      }

      mutate();
      setShowCreate(false);
      clearLoe();
      router.push(`/hr/employees/${user.id}`);
    } finally {
      setCreating(false);
    }
  };

  const allEmployees = data?.employees || [];
  // Anyone with resigned_at / end_date set, OR whose status is DEACTIVATED
  const isResigned = (e: Employee) =>
    !!(e.hrProfile?.resigned_at || e.hrProfile?.end_date) || e.status === "DEACTIVATED";
  // Active (non-resigned) list for the primary tabs
  const activeEmployees = allEmployees.filter((e) => !isResigned(e));
  const resignedEmployees = allEmployees.filter(isResigned);
  const ftCount = activeEmployees.filter((e) => e.hrProfile?.employment_type === "full_time").length;
  const ptCount = activeEmployees.filter((e) => e.hrProfile?.employment_type === "part_time").length;
  const contractCount = activeEmployees.filter((e) => e.hrProfile?.employment_type === "contract").length;
  const noProfileCount = activeEmployees.filter((e) => !e.hrProfile).length;
  const resignedCount = resignedEmployees.length;

  const roleOptions = Array.from(new Set(allEmployees.map((e) => e.role))).sort();
  const outletOptions = Array.from(
    new Map(allEmployees.filter((e) => e.outlet).map((e) => [e.outletId, e.outlet!.name])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Resigned tab pulls from the full list (including DEACTIVATED); all other
  // tabs operate on the active (non-resigned) pool.
  const pool = filter === "resigned" ? resignedEmployees : activeEmployees;
  const employees = pool.filter((e) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      e.name.toLowerCase().includes(q) ||
      (e.fullName?.toLowerCase().includes(q) ?? false) ||
      e.phone.toLowerCase().includes(q);
    const matchesEmployment =
      filter === "all" || filter === "resigned" ||
      (filter === "no_profile" ? !e.hrProfile : e.hrProfile?.employment_type === filter);
    const matchesRole = roleFilter === "all" || e.role === roleFilter;
    const matchesOutlet =
      outletFilter === "all" ||
      (outletFilter === "none" ? !e.outletId : e.outletId === outletFilter);
    return matchesSearch && matchesEmployment && matchesRole && matchesOutlet;
  });

  const configured = employees.filter((e) => e.hrProfile).length;
  const total = employees.length;
  const clearAll = () => {
    setSearch("");
    setFilter("all");
    setRoleFilter("all");
    setOutletFilter("all");
  };
  const hasActiveFilters =
    !!search || filter !== "all" || roleFilter !== "all" || outletFilter !== "all";

  // ── Bulk select helpers ───────────────────────────────────────────────────
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Visible-only ids (i.e. respecting the current filter pool).
  const visibleIds = employees.map((e) => e.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));
  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Resolve the selected ids back to full employee records (using the
  // unfiltered list, so a selection survives filter changes).
  const selectedEmployees = allEmployees.filter((e) => selectedIds.has(e.id));

  // CSV export — basic columns. Dates and salaries are kept raw so the file
  // opens cleanly in Sheets/Excel without locale weirdness.
  const exportSelectedCsv = () => {
    if (selectedEmployees.length === 0) return;
    const rows: string[][] = [
      ["Name", "Full Name", "Phone", "Email", "Role", "Outlet", "Position", "Employment Type", "Join Date", "Basic Salary", "Hourly Rate", "Status"],
      ...selectedEmployees.map((e) => [
        e.name,
        e.fullName || "",
        e.phone || "",
        e.email || "",
        e.role,
        e.outlet?.name || "HQ",
        e.hrProfile?.position || "",
        e.hrProfile?.employment_type || "",
        e.hrProfile?.join_date || "",
        e.hrProfile?.basic_salary != null ? String(e.hrProfile.basic_salary) : "",
        e.hrProfile?.hourly_rate != null ? String(e.hrProfile.hourly_rate) : "",
        isResigned(e) ? "Resigned" : "Active",
      ]),
    ];
    const csv = rows
      .map((r) => r.map((cell) => {
        const s = cell ?? "";
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendBulkMemo = async () => {
    if (selectedIds.size === 0 || !bulkMemoTitle.trim() || !bulkMemoBody.trim()) {
      setBulkError("Title and body are required");
      return;
    }
    setBulkError(null);
    setBulkSending(true);
    try {
      const res = await fetch("/api/hr/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_ids: Array.from(selectedIds),
          type: bulkMemoType,
          severity: "info",
          title: bulkMemoTitle.trim(),
          body: bulkMemoBody.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setBulkError(d.error || "Failed to send memo");
        return;
      }
      setBulkMemoOpen(false);
      setBulkMemoTitle("");
      setBulkMemoBody("");
      setBulkMemoType("announcement");
      clearSelection();
    } finally {
      setBulkSending(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-sm text-muted-foreground">
            {configured}/{total} profiles configured
          </p>
          {scope === "direct-reports" && (
            <p className="mt-1 text-xs text-terracotta">Showing your direct reports only.</p>
          )}
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta/90"
          >
            <Plus className="h-4 w-4" />
            New Employee
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, full name, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border bg-background py-2 pl-10 pr-4 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { key: "all", label: `All (${activeEmployees.length})` },
          { key: "full_time", label: `Full-Time (${ftCount})` },
          { key: "part_time", label: `Part-Time (${ptCount})` },
          ...(contractCount > 0 ? [{ key: "contract" as const, label: `Contract (${contractCount})` }] : []),
          ...(noProfileCount > 0 ? [{ key: "no_profile" as const, label: `No Profile (${noProfileCount})` }] : []),
          ...(resignedCount > 0 ? [{ key: "resigned" as const, label: `Resigned (${resignedCount})` }] : []),
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              filter === tab.key
                ? "border-terracotta bg-terracotta text-white"
                : "bg-background hover:bg-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Role</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border bg-background px-2 py-1.5 text-xs"
          >
            <option value="all">All roles</option>
            {roleOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">Outlet</span>
          <select
            value={outletFilter}
            onChange={(e) => setOutletFilter(e.target.value)}
            className="rounded-lg border bg-background px-2 py-1.5 text-xs"
          >
            <option value="all">All outlets</option>
            <option value="none">No outlet (HQ)</option>
            {outletOptions.map(([id, name]) => (
              <option key={id} value={id!}>{name}</option>
            ))}
          </select>
        </label>

        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="rounded-lg border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Select-all bar — only render once there's at least one row to act on. */}
      {employees.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-terracotta focus:ring-terracotta"
              checked={allVisibleSelected}
              ref={(el) => {
                // Show indeterminate when only some visible rows are picked.
                if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
              }}
              onChange={toggleSelectAllVisible}
            />
            <span className="font-medium text-muted-foreground">
              {selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : `Select all visible (${employees.length})`}
            </span>
          </label>
          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {employees.map((emp) => {
          const hasProfile = !!emp.hrProfile;
          const resigned = isResigned(emp);
          const endDate = emp.hrProfile?.end_date;
          let resignedSubtitle: string | null = null;
          if (endDate) {
            const today = new Date().toISOString().slice(0, 10);
            const end = new Date(endDate + "T00:00:00Z");
            const now = new Date(today + "T00:00:00Z");
            const diff = Math.round((end.getTime() - now.getTime()) / 86_400_000);
            resignedSubtitle = diff > 0
              ? `Last working day ${endDate} (in ${diff}d)`
              : diff === 0
                ? `Last working day is today (${endDate})`
                : `Exited ${Math.abs(diff)}d ago (${endDate})`;
          } else if (emp.status === "DEACTIVATED") {
            resignedSubtitle = "Deactivated";
          }
          const isSelected = selectedIds.has(emp.id);
          return (
            <div
              key={emp.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/hr/employees/${emp.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/hr/employees/${emp.id}`);
                }
              }}
              className={`flex cursor-pointer items-center gap-4 rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md ${
                resigned ? "opacity-70" : ""
              } ${isSelected ? "ring-2 ring-terracotta/60" : ""}`}
            >
              {/* Bulk-select checkbox. Stops propagation so toggling doesn't
                  also navigate to the profile. */}
              <input
                type="checkbox"
                checked={isSelected}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleSelected(emp.id);
                }}
                className="h-4 w-4 shrink-0 rounded border-gray-300 text-terracotta focus:ring-terracotta"
                aria-label={`Select ${emp.fullName || emp.name}`}
              />
              {/* Profile photo — first clock-in selfie. Falls back to initials. */}
              {emp.profile_photo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={emp.profile_photo_url}
                  alt=""
                  className={`h-10 w-10 shrink-0 rounded-full object-cover ${resigned ? "grayscale" : ""}`}
                />
              ) : (
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                  resigned ? "bg-red-300" : hasProfile ? "bg-green-500" : "bg-gray-300"
                }`}>
                  {(emp.fullName || emp.name).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="font-semibold break-words">{emp.fullName || emp.name}</p>
                  {emp.fullName && emp.name !== emp.fullName && (
                    <span className="text-xs text-muted-foreground">({emp.name})</span>
                  )}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {emp.role}
                  </span>
                  {emp.hrProfile?.employment_type === "part_time" && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      PART-TIME
                    </span>
                  )}
                  {emp.hrProfile?.employment_type === "full_time" && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      FULL-TIME
                    </span>
                  )}
                  {resigned && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800">
                      RESIGNED
                    </span>
                  )}
                  {/* Onboarding progress — only shown if there are applicable
                      templates and the employee isn't fully onboarded yet. */}
                  {!resigned && emp.onboarding && emp.onboarding.total > 0 && emp.onboarding.done < emp.onboarding.total && (
                    <span
                      title={`Onboarding ${emp.onboarding.done}/${emp.onboarding.total} complete`}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        emp.onboarding.done === 0
                          ? "bg-red-50 text-red-700"
                          : emp.onboarding.done < emp.onboarding.total / 2
                            ? "bg-amber-50 text-amber-800"
                            : "bg-blue-50 text-blue-700"
                      }`}
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                        emp.onboarding.done === 0 ? "bg-red-500"
                        : emp.onboarding.done < emp.onboarding.total / 2 ? "bg-amber-500"
                        : "bg-blue-500"
                      }`} />
                      ONBOARDING {emp.onboarding.done}/{emp.onboarding.total}
                    </span>
                  )}
                </div>
                {resigned && resignedSubtitle && (
                  <p className="text-xs font-medium text-red-700">{resignedSubtitle}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  {emp.outlet?.name || "HQ"}{" "}
                  {emp.hrProfile?.position && `· ${emp.hrProfile.position}`}
                </p>
                {emp.hrProfile?.employment_type === "part_time" && emp.hrProfile?.hourly_rate ? (
                  <p className="text-xs text-muted-foreground">
                    RM {Number(emp.hrProfile.hourly_rate).toFixed(2)}/hr · weekly pay
                  </p>
                ) : emp.hrProfile?.basic_salary ? (
                  <p className="text-xs text-muted-foreground">
                    RM {Number(emp.hrProfile.basic_salary).toLocaleString()}/mo
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {resigned ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const year =
                        (endDate || emp.hrProfile?.resigned_at || new Date().toISOString()).slice(0, 4);
                      window.open(
                        `/api/hr/payroll/annual-forms?year=${year}&type=ea&user_id=${emp.id}`,
                        "_blank",
                      );
                    }}
                    className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                    title="Download EA Form"
                  >
                    <Download className="h-3.5 w-3.5" />
                    EA
                  </button>
                ) : hasProfile ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-400" />
                )}
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating bulk-action bar — only when there's at least one selection. */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
            <span className="text-sm font-medium">
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => setBulkMemoOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-semibold text-white hover:bg-terracotta/90"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Issue memo to {selectedIds.size}
            </button>
            <button
              onClick={exportSelectedCsv}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              onClick={clearSelection}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
              title="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk memo modal. Posts to /api/hr/memos with user_ids array. */}
      {bulkMemoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!bulkSending) setBulkMemoOpen(false); }}>
          <div className="w-full max-w-lg rounded-xl bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Issue memo</h2>
                <p className="text-xs text-muted-foreground">To {selectedIds.size} {selectedIds.size === 1 ? "employee" : "employees"}</p>
              </div>
              <button onClick={() => setBulkMemoOpen(false)} className="rounded p-1 hover:bg-muted" disabled={bulkSending}>
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Recipient pill summary — shown in a scrollable strip so HR can
                eyeball who they're about to message before hitting send. */}
            <div className="mb-3 max-h-20 overflow-y-auto rounded-lg border bg-muted/30 p-2">
              <div className="flex flex-wrap gap-1">
                {selectedEmployees.slice(0, 30).map((e) => (
                  <span key={e.id} className="rounded-full bg-background px-2 py-0.5 text-[11px]">
                    {e.fullName || e.name}
                  </span>
                ))}
                {selectedEmployees.length > 30 && (
                  <span className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                    +{selectedEmployees.length - 30} more
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Type</span>
                <select
                  value={bulkMemoType}
                  onChange={(e) => setBulkMemoType(e.target.value as typeof bulkMemoType)}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  disabled={bulkSending}
                >
                  <option value="announcement">Announcement</option>
                  <option value="reminder">Reminder</option>
                  <option value="commendation">Commendation</option>
                  <option value="note">Note</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Title *</span>
                <input
                  type="text"
                  value={bulkMemoTitle}
                  onChange={(e) => setBulkMemoTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  placeholder="e.g. Reminder: clock in within 5 mins of shift start"
                  disabled={bulkSending}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Body *</span>
                <textarea
                  value={bulkMemoBody}
                  onChange={(e) => setBulkMemoBody(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  rows={5}
                  placeholder="Memo body — supports plain text. Each recipient gets their own ack record."
                  disabled={bulkSending}
                />
              </label>
            </div>

            {bulkError && (
              <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-600">{bulkError}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setBulkMemoOpen(false)}
                disabled={bulkSending}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={sendBulkMemo}
                disabled={bulkSending || !bulkMemoTitle.trim() || !bulkMemoBody.trim()}
                className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta/90 disabled:opacity-50"
              >
                {bulkSending && <Loader2 className="h-4 w-4 animate-spin" />}
                Send to {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!creating) { setShowCreate(false); clearLoe(); } }}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">New Employee</h2>
              <button onClick={() => { setShowCreate(false); clearLoe(); }} className="rounded p-1 hover:bg-muted" disabled={creating}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {/* Step 1: LoE upload — optional but recommended. Parses with AI
                  and prefills the form below. The file is attached to the
                  employee's document vault automatically after create. */}
              {!loeFile ? (
                <label
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!parsingLoe && !creating) setLoeDragOver(true); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!parsingLoe && !creating) setLoeDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setLoeDragOver(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setLoeDragOver(false);
                    if (parsingLoe || creating) return;
                    const f = e.dataTransfer.files?.[0];
                    if (!f) return;
                    const ok = f.type === "application/pdf" || f.type.startsWith("image/") || /\.(pdf|png|jpe?g|webp|gif)$/i.test(f.name);
                    if (ok) parseLoe(f);
                  }}
                  className={
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-xs transition " +
                    (loeDragOver
                      ? "border-terracotta bg-terracotta/10 text-terracotta"
                      : "border-gray-300 bg-muted/20 text-muted-foreground hover:bg-muted/30")
                  }
                >
                  {parsingLoe ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin text-terracotta" />
                      <span className="font-medium text-foreground">Parsing LoE with AI…</span>
                    </>
                  ) : loeDragOver ? (
                    <>
                      <Sparkles className="h-5 w-5" />
                      <span className="font-semibold">Drop to parse</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5 text-terracotta" />
                      <span className="font-semibold text-foreground">Upload LoE to auto-fill</span>
                      <span>We&apos;ll read the letter and prefill the fields below. The PDF also saves to the employee&apos;s Documents.</span>
                      <span className="text-[10px]">Drop a file here, or click to choose · Skip to fill manually</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    className="hidden"
                    disabled={parsingLoe || creating}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) parseLoe(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{loeFile.name}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {loePrefilled && loeConfidence && (
                        <>
                          Prefilled · confidence{" "}
                          <span className={
                            loeConfidence === "high" ? "text-emerald-600 font-semibold"
                            : loeConfidence === "medium" ? "text-amber-600 font-semibold"
                            : "text-red-600 font-semibold"
                          }>
                            {loeConfidence}
                          </span>
                          {" · review fields below"}
                        </>
                      )}
                      {!loePrefilled && !parsingLoe && "Will be attached as LoE document after create"}
                    </div>
                  </div>
                  <button
                    onClick={clearLoe}
                    disabled={creating}
                    className="rounded-lg border border-red-200 bg-red-50 p-1 text-red-600 hover:bg-red-100"
                    title="Remove LoE"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Name *</span>
                  <input type="text" value={newEmp.name} onChange={(e) => setNewEmp({ ...newEmp, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Display name" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Full legal name</span>
                  <input type="text" value={newEmp.fullName} onChange={(e) => setNewEmp({ ...newEmp, fullName: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="As per IC" />
                </label>
              </div>
              {/* Login access toggle — when off, phone + PIN become truly optional */}
              <label className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={wantsLogin}
                  onChange={(e) => setWantsLogin(e.target.checked)}
                />
                <span className="font-medium">This employee needs a staff-app login</span>
                <span className="text-muted-foreground">
                  — uncheck for contract / vendor / HR-only records
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Phone {wantsLogin ? "*" : "(optional)"}</span>
                  <input type="text" value={newEmp.phone} onChange={(e) => setNewEmp({ ...newEmp, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder={wantsLogin ? "+60…" : "Leave blank if no login"} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Email</span>
                  <input type="email" value={newEmp.email} onChange={(e) => setNewEmp({ ...newEmp, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Role *</span>
                  <select value={newEmp.role} onChange={(e) => setNewEmp({ ...newEmp, role: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm">
                    <option value="STAFF">STAFF</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="OWNER">OWNER</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Position</span>
                  <input type="text" value={newEmp.position} onChange={(e) => setNewEmp({ ...newEmp, position: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Employment</span>
                  <select value={newEmp.employment_type} onChange={(e) => setNewEmp({ ...newEmp, employment_type: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm">
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Outlet</span>
                <select value={newEmp.outletId} onChange={(e) => setNewEmp({ ...newEmp, outletId: e.target.value })}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm">
                  <option value="">HQ / No outlet</option>
                  {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">Join date</span>
                  <input type="date" value={newEmp.join_date} onChange={(e) => setNewEmp({ ...newEmp, join_date: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">
                    {newEmp.employment_type === "part_time" ? "Hourly rate (RM)" : "Basic salary (RM)"}
                  </span>
                  <input type="number" step="0.01"
                    value={newEmp.employment_type === "part_time" ? newEmp.hourly_rate : newEmp.basic_salary}
                    onChange={(e) => setNewEmp({ ...newEmp,
                      ...(newEmp.employment_type === "part_time" ? { hourly_rate: e.target.value } : { basic_salary: e.target.value })
                    })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                </label>
              </div>
              {newEmp.employment_type === "full_time" && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Attendance allowance (RM)</span>
                    <input type="number" step="0.01" min={0}
                      value={newEmp.attendance_allowance_amount}
                      onChange={(e) => setNewEmp({ ...newEmp, attendance_allowance_amount: e.target.value })}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                      placeholder="Blank = global default" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Performance allowance (RM)</span>
                    <input type="number" step="0.01" min={0}
                      value={newEmp.performance_allowance_amount}
                      onChange={(e) => setNewEmp({ ...newEmp, performance_allowance_amount: e.target.value })}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                      placeholder="Blank = global default" />
                  </label>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-muted-foreground">IC number</span>
                  <input type="text" value={newEmp.ic_number} onChange={(e) => setNewEmp({ ...newEmp, ic_number: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" />
                </label>
                {wantsLogin && (
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">PIN (4-6 digits)</span>
                    <input type="text" inputMode="numeric" maxLength={6} value={newEmp.pin}
                      onChange={(e) => setNewEmp({ ...newEmp, pin: e.target.value.replace(/\D/g, "") })}
                      className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Optional — can set later" />
                  </label>
                )}
              </div>
            </div>

            {createError && (
              <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-600">{createError}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowCreate(false); clearLoe(); }}
                disabled={creating}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newEmp.name || (wantsLogin && !newEmp.phone)}
                className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta/90 disabled:opacity-50"
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                Create employee
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
