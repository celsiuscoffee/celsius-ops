"use client";

import { useFetch } from "@/lib/use-fetch";
import { KeyNumber } from "@/components/ui/key-number";
import { useState, useEffect } from "react";
import { ArrowLeft, ChevronRight, CheckCircle2, AlertCircle, Search, Plus, Loader2, X, Download, Sparkles, FileText, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
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
  status?: string;
  profile_photo_url?: string | null;
  onboarding?: { done: number; total: number };
  hrProfile: (EmployeeProfile & { resigned_at?: string | null; end_date?: string | null }) | null;
};

type EmploymentFilter = "all" | "full_time" | "part_time" | "contract" | "no_profile" | "resigned" | "probation";

type Outlet = { id: string; name: string; code: string };

export default function EmployeesPage() {
  const router = useRouter();
  const { data, mutate } = useFetch<{ employees: Employee[]; scope?: "direct-reports" | "all" }>("/api/hr/employees");
  const { data: outlets } = useFetch<Outlet[]>("/api/ops/outlets");
  const scope = data?.scope;
  const [search, setSearch] = useState("");
  // ?filter=probation etc. deep-links a tab (the dashboard's confirmation-due
  // tile lands here). Read once on mount; the tabs own the state afterwards.
  const [filter, setFilter] = useState<EmploymentFilter>(() => {
    if (typeof window === "undefined") return "all";
    const f = new URLSearchParams(window.location.search).get("filter");
    const valid: EmploymentFilter[] = ["all", "full_time", "part_time", "contract", "no_profile", "resigned", "probation"];
    return valid.includes(f as EmploymentFilter) ? (f as EmploymentFilter) : "all";
  });
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
  // On probation = full-time with no confirmation stamped. Probation ends only
  // on `confirmed_at` (never elapsed time), and while it is unset the payroll
  // gate withholds the performance allowance — so an unnoticed one costs the
  // staffer money every month. This tab is the worklist that makes it visible.
  const isOnProbation = (e: Employee) =>
    e.hrProfile?.employment_type === "full_time" && !e.hrProfile?.confirmed_at;
  const probationCount = activeEmployees.filter(isOnProbation).length;
  const resignedCount = resignedEmployees.length;
  const onboardingOpen = activeEmployees.filter((e) => e.onboarding && e.onboarding.total > 0 && e.onboarding.done < e.onboarding.total).length;

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
      (e.name ?? "").toLowerCase().includes(q) ||
      (e.fullName?.toLowerCase().includes(q) ?? false) ||
      (e.phone ?? "").toLowerCase().includes(q);
    const matchesEmployment =
      filter === "all" || filter === "resigned" ||
      (filter === "probation" ? isOnProbation(e) :
       filter === "no_profile" ? !e.hrProfile : e.hrProfile?.employment_type === filter);
    const matchesRole = roleFilter === "all" || e.role === roleFilter;
    const matchesOutlet =
      outletFilter === "all" ||
      (outletFilter === "none" ? !e.outletId : e.outletId === outletFilter);
    return matchesSearch && matchesEmployment && matchesRole && matchesOutlet;
  });

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
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      {!showCreate && !bulkMemoOpen && (<>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">People</h1>
          <p className="mt-0.5 text-sm text-text-2">Who works here, at which outlet, and whose profile, probation or onboarding needs you.</p>
          {scope === "direct-reports" && (
            <p className="mt-1 text-xs text-brand-text">Showing your direct reports only.</p>
          )}
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            {/* The bulk LoE wizard existed with zero inbound links — reachable
                only by typing the URL. */}
            <Link href="/hr/employees/import" className="inline-flex h-10 items-center gap-2 rounded-ctl border border-line-2 px-4 text-sm font-medium text-text hover:bg-sunken">
              <FileText className="h-4 w-4" />
              Import letters of employment
            </Link>
            <button onClick={() => { setShowCreate(true); window.scrollTo(0, 0); }} className="inline-flex h-10 items-center gap-2 rounded-ctl bg-ink px-4 text-sm font-semibold text-on-ink hover:bg-ink-hover">
              <Plus className="h-4 w-4" />
              New employee
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="Active staff" value={data ? String(activeEmployees.length) : null}
          note={<><b className="font-semibold text-text-2">{ftCount}</b> full-time · <b className="font-semibold text-text-2">{ptCount}</b> part-time</>} />
        <KeyNumber label="On probation" value={data ? String(probationCount) : null} tone={probationCount > 0 ? "warn" : undefined}
          note={probationCount > 0 ? "waiting to be confirmed" : "everyone confirmed"} />
        <KeyNumber label="No profile" value={data ? String(noProfileCount) : null} tone={noProfileCount > 0 ? "warn" : undefined}
          note={noProfileCount > 0 ? "job, outlet and pay not set up" : "every profile set up"} />
        <KeyNumber label="Onboarding" value={data ? String(onboardingOpen) : null} tone={onboardingOpen > 0 ? "warn" : undefined}
          note={onboardingOpen > 0 ? "not finished yet" : "everyone onboarded"} />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <input
          type="text"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-ctl border border-line bg-surface pl-10 pr-4 text-sm text-text"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { key: "all", label: `All (${activeEmployees.length})` },
          { key: "full_time", label: `Full-time (${ftCount})` },
          { key: "part_time", label: `Part-time (${ptCount})` },
          ...(probationCount > 0 ? [{ key: "probation" as const, label: `Probation (${probationCount})` }] : []),
          ...(contractCount > 0 ? [{ key: "contract" as const, label: `Contract (${contractCount})` }] : []),
          ...(noProfileCount > 0 ? [{ key: "no_profile" as const, label: `No profile (${noProfileCount})` }] : []),
          ...(resignedCount > 0 ? [{ key: "resigned" as const, label: `Resigned (${resignedCount})` }] : []),
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`h-8 rounded-full border px-3 text-xs transition ${
              filter === tab.key
                ? "border-text bg-raised font-semibold text-text"
                : "border-line text-text-2 hover:bg-sunken"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium text-text-3">Role</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-9 rounded-ctl border border-line bg-surface px-2 text-xs text-text"
          >
            <option value="all">All roles</option>
            {roleOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium text-text-3">Outlet</span>
          <select
            value={outletFilter}
            onChange={(e) => setOutletFilter(e.target.value)}
            className="h-9 rounded-ctl border border-line bg-surface px-2 text-xs text-text"
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
            className="h-9 rounded-ctl border border-line px-3 text-xs font-medium text-text-2 hover:bg-sunken"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Select-all bar — only render once there's at least one row to act on. */}
      {employees.length > 0 && (
        <div className="flex items-center justify-between rounded-ctl bg-sunken px-3 py-2 text-xs">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line-2 text-brand-text focus:ring-brand"
              checked={allVisibleSelected}
              ref={(el) => {
                // Show indeterminate when only some visible rows are picked.
                if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
              }}
              onChange={toggleSelectAllVisible}
            />
            <span className="font-medium text-text-3">
              {selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : `Select all visible (${employees.length})`}
            </span>
          </label>
          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="text-text-3 hover:text-text"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {employees.length === 0 && <p className="px-4 py-12 text-center text-sm text-text-3">No one matches.</p>}
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
              className={`flex cursor-pointer items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 transition-colors hover:bg-sunken/50 ${
                resigned ? "opacity-70" : ""
              } ${isSelected ? "ring-2 ring-brand/60" : ""}`}
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
                className="h-4 w-4 shrink-0 rounded border-line-2 text-brand-text focus:ring-brand"
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
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-semibold text-text-2">
                  {(emp.fullName || emp.name).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="break-words text-sm font-medium text-text">{emp.fullName || emp.name}</p>
                  {emp.fullName && emp.name !== emp.fullName && (
                    <span className="text-xs text-text-3">({emp.name})</span>
                  )}
                  <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-text-2">
                    {emp.role}
                  </span>
                  {emp.hrProfile?.employment_type === "part_time" && (
                    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn-text">
                      Part-time
                    </span>
                  )}
                  {emp.hrProfile?.employment_type === "full_time" && (
                    <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] text-ok-text">
                      Full-time
                    </span>
                  )}
                  {resigned && (
                    <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] text-danger-text">
                      Resigned
                    </span>
                  )}
                  {/* Onboarding progress — only shown if there are applicable
                      templates and the employee isn't fully onboarded yet. */}
                  {!resigned && emp.onboarding && emp.onboarding.total > 0 && emp.onboarding.done < emp.onboarding.total && (
                    <span
                      title={`Onboarding ${emp.onboarding.done}/${emp.onboarding.total} complete`}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                        emp.onboarding.done === 0
                          ? "bg-danger-soft text-danger-text"
                          : emp.onboarding.done < emp.onboarding.total / 2
                            ? "bg-warn-soft text-warn-text"
                            : "bg-info-soft text-info-text"
                      }`}
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                        emp.onboarding.done === 0 ? "bg-danger"
                        : emp.onboarding.done < emp.onboarding.total / 2 ? "bg-warn"
                        : "bg-info"
                      }`} />
                      Onboarding {emp.onboarding.done}/{emp.onboarding.total}
                    </span>
                  )}
                </div>
                {resigned && resignedSubtitle && (
                  <p className="text-xs font-medium text-danger-text">{resignedSubtitle}</p>
                )}
                <p className="text-[12px] text-text-3">
                  {emp.outlet?.name || "HQ"}{" "}
                  {emp.hrProfile?.position && `· ${emp.hrProfile.position}`}
                </p>
                {emp.hrProfile?.employment_type === "part_time" && emp.hrProfile?.hourly_rate ? (
                  <p className="text-xs text-text-3">
                    RM {Number(emp.hrProfile.hourly_rate).toFixed(2)}/hr · weekly pay
                  </p>
                ) : emp.hrProfile?.basic_salary ? (
                  <p className="text-xs text-text-3">
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
                    className="flex h-9 items-center gap-1 rounded-ctl border border-line-2 px-2.5 text-[12px] font-medium text-text hover:bg-sunken"
                    title="Download EA form"
                  >
                    <Download className="h-3.5 w-3.5" />
                    EA
                  </button>
                ) : hasProfile ? (
                  <CheckCircle2 className="h-5 w-5 text-ok-text" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-warn-text" />
                )}
                <ChevronRight className="h-4 w-4 text-text-3" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating bulk-action bar — only when there's at least one selection. */}
      {selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-raised px-4 py-3 shadow-lg">
            <span className="text-sm font-medium">
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => { setBulkMemoOpen(true); window.scrollTo(0, 0); }}
              className="flex h-9 items-center gap-1.5 rounded-ctl bg-ink px-3 text-xs font-semibold text-on-ink hover:bg-ink-hover"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Issue memo to {selectedIds.size}
            </button>
            <button
              onClick={exportSelectedCsv}
              className="flex h-9 items-center gap-1.5 rounded-ctl border border-line-2 px-3 text-xs font-medium text-text hover:bg-sunken"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              onClick={clearSelection}
              className="flex h-9 w-9 items-center justify-center rounded-ctl text-text-3 hover:bg-sunken"
              title="Clear selection" aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      </>)}

      {/* Bulk memo: a full page (multi-field). Posts to /api/hr/memos with user_ids array. */}
      {bulkMemoOpen && (
        <div>
          <div className="max-w-[720px]">
            <button onClick={() => setBulkMemoOpen(false)} disabled={bulkSending} className="inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text">
              <ArrowLeft className="h-4 w-4" /> All people
            </button>
            <div className="mt-3 mb-5">
              <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Issue memo</h1>
              <p className="mt-0.5 text-sm text-text-2">To {selectedIds.size} {selectedIds.size === 1 ? "employee" : "employees"}. They see it in the Staff app.</p>
            </div>

            {/* Recipient pill summary — shown in a scrollable strip so HR can
                eyeball who they're about to message before hitting send. */}
            <div className="mb-3 max-h-20 overflow-y-auto rounded-lg border bg-sunken p-2">
              <div className="flex flex-wrap gap-1">
                {selectedEmployees.slice(0, 30).map((e) => (
                  <span key={e.id} className="rounded-full bg-bg px-2 py-0.5 text-[11px]">
                    {e.fullName || e.name}
                  </span>
                ))}
                {selectedEmployees.length > 30 && (
                  <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] text-text-3">
                    +{selectedEmployees.length - 30} more
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium text-text-3">Type</span>
                <select
                  value={bulkMemoType}
                  onChange={(e) => setBulkMemoType(e.target.value as typeof bulkMemoType)}
                  className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm"
                  disabled={bulkSending}
                >
                  <option value="announcement">Announcement</option>
                  <option value="reminder">Reminder</option>
                  <option value="commendation">Commendation</option>
                  <option value="note">Note</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-text-3">Title *</span>
                <input
                  type="text"
                  value={bulkMemoTitle}
                  onChange={(e) => setBulkMemoTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm"
                  placeholder="e.g. Reminder: clock in within 5 mins of shift start"
                  disabled={bulkSending}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-text-3">Body *</span>
                <textarea
                  value={bulkMemoBody}
                  onChange={(e) => setBulkMemoBody(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm"
                  rows={5}
                  placeholder="Memo body — supports plain text. Each recipient gets their own ack record."
                  disabled={bulkSending}
                />
              </label>
            </div>

            {bulkError && (
              <p className="mt-3 rounded bg-danger-soft px-3 py-2 text-xs text-danger-text">{bulkError}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setBulkMemoOpen(false)}
                disabled={bulkSending}
                className="h-10 rounded-ctl border border-line-2 px-4 text-sm text-text hover:bg-sunken"
              >
                Cancel
              </button>
              <button
                onClick={sendBulkMemo}
                disabled={bulkSending || !bulkMemoTitle.trim() || !bulkMemoBody.trim()}
                className="flex h-10 items-center gap-2 rounded-ctl bg-ink px-4 text-sm font-semibold text-on-ink hover:bg-ink-hover disabled:opacity-50"
              >
                {bulkSending && <Loader2 className="h-4 w-4 animate-spin" />}
                Send to {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div>
          <div className="max-w-[720px]">
            <button onClick={() => { setShowCreate(false); clearLoe(); }} disabled={creating} className="inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text">
              <ArrowLeft className="h-4 w-4" /> All people
            </button>
            <div className="mt-3 mb-5">
              <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">New employee</h1>
              <p className="mt-0.5 text-sm text-text-2">Start from their letter of employment, or fill in the details by hand.</p>
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
                      ? "border-text bg-raised font-semibold text-text"
                      : "border-line-2 bg-sunken text-text-3 hover:bg-sunken")
                  }
                >
                  {parsingLoe ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin text-brand-text" />
                      <span className="font-medium text-text">Parsing LoE with AI…</span>
                    </>
                  ) : loeDragOver ? (
                    <>
                      <Sparkles className="h-5 w-5" />
                      <span className="font-semibold">Drop to parse</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5 text-brand-text" />
                      <span className="font-semibold text-text">Upload the letter of employment to fill this in</span>
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
                  <FileText className="h-4 w-4 shrink-0 text-text-3" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{loeFile.name}</div>
                    <div className="mt-0.5 text-[10px] text-text-3">
                      {loePrefilled && loeConfidence && (
                        <>
                          Prefilled · confidence{" "}
                          <span className={
                            loeConfidence === "high" ? "text-ok-text font-semibold"
                            : loeConfidence === "medium" ? "text-warn-text font-semibold"
                            : "text-danger-text font-semibold"
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
                    className="rounded-lg border border-danger/30 bg-danger-soft p-1 text-danger-text hover:bg-danger-soft"
                    title="Remove LoE"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-text-3">Name *</span>
                  <input type="text" value={newEmp.name} onChange={(e) => setNewEmp({ ...newEmp, name: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" placeholder="Display name" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-3">Full legal name</span>
                  <input type="text" value={newEmp.fullName} onChange={(e) => setNewEmp({ ...newEmp, fullName: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" placeholder="As per IC" />
                </label>
              </div>
              {/* Login access toggle — when off, phone + PIN become truly optional */}
              <label className="flex items-center gap-2 rounded-lg border bg-sunken px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={wantsLogin}
                  onChange={(e) => setWantsLogin(e.target.checked)}
                />
                <span className="font-medium">This employee needs a staff-app login</span>
                <span className="text-text-3">
                  — uncheck for contract / vendor / HR-only records
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-text-3">Phone {wantsLogin ? "*" : "(optional)"}</span>
                  <input type="text" value={newEmp.phone} onChange={(e) => setNewEmp({ ...newEmp, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" placeholder={wantsLogin ? "+60…" : "Leave blank if no login"} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-3">Email</span>
                  <input type="email" value={newEmp.email} onChange={(e) => setNewEmp({ ...newEmp, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-text-3">Role *</span>
                  <select value={newEmp.role} onChange={(e) => setNewEmp({ ...newEmp, role: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm">
                    <option value="STAFF">STAFF</option>
                    <option value="MANAGER">MANAGER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="OWNER">OWNER</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-3">Position</span>
                  <input type="text" value={newEmp.position} onChange={(e) => setNewEmp({ ...newEmp, position: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-3">Employment</span>
                  <select value={newEmp.employment_type} onChange={(e) => setNewEmp({ ...newEmp, employment_type: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm">
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-text-3">Outlet</span>
                <select value={newEmp.outletId} onChange={(e) => setNewEmp({ ...newEmp, outletId: e.target.value })}
                  className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm">
                  <option value="">HQ / No outlet</option>
                  {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-text-3">Join date</span>
                  <input type="date" value={newEmp.join_date} onChange={(e) => setNewEmp({ ...newEmp, join_date: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-3">
                    {newEmp.employment_type === "part_time" ? "Hourly rate (RM)" : "Basic salary (RM)"}
                  </span>
                  <input type="number" step="0.01"
                    value={newEmp.employment_type === "part_time" ? newEmp.hourly_rate : newEmp.basic_salary}
                    onChange={(e) => setNewEmp({ ...newEmp,
                      ...(newEmp.employment_type === "part_time" ? { hourly_rate: e.target.value } : { basic_salary: e.target.value })
                    })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" />
                </label>
              </div>
              {/* No allowance field here on purpose: the old input wrote
                  hr_employee_profiles.performance_allowance_amount, a column
                  payroll never reads. New full-timers start on the scored
                  RM200 pool; a flat amount is set on the profile afterwards. */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-text-3">IC number</span>
                  <input type="text" value={newEmp.ic_number} onChange={(e) => setNewEmp({ ...newEmp, ic_number: e.target.value })}
                    className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" />
                </label>
                {wantsLogin && (
                  <label className="block">
                    <span className="text-xs font-medium text-text-3">PIN (4-6 digits)</span>
                    <input type="text" inputMode="numeric" maxLength={6} value={newEmp.pin}
                      onChange={(e) => setNewEmp({ ...newEmp, pin: e.target.value.replace(/\D/g, "") })}
                      className="mt-1 w-full rounded-lg border bg-bg px-3 py-2 text-sm" placeholder="Optional — can set later" />
                  </label>
                )}
              </div>
            </div>

            {createError && (
              <p className="mt-3 rounded bg-danger-soft px-3 py-2 text-xs text-danger-text">{createError}</p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowCreate(false); clearLoe(); }}
                disabled={creating}
                className="h-10 rounded-ctl border border-line-2 px-4 text-sm text-text hover:bg-sunken"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newEmp.name || (wantsLogin && !newEmp.phone)}
                className="flex h-10 items-center gap-2 rounded-ctl bg-ink px-4 text-sm font-semibold text-on-ink hover:bg-ink-hover disabled:opacity-50"
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
