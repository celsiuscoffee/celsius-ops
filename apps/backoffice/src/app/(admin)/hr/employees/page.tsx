"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { UserCog, ChevronRight, CheckCircle2, AlertCircle, Search, Plus, Loader2, X, Download } from "lucide-react";
import Link from "next/link";
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
  const [createError, setCreateError] = useState<string | null>(null);
  // "Login access" toggle. When OFF, phone + PIN are treated as optional — used
  // for contract / vendor / HR-only records that won't sign into the staff app.
  const [wantsLogin, setWantsLogin] = useState(true);
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
    ic_number: "",
    date_of_birth: "",
    gender: "",
    pin: "",
  });

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
      mutate();
      setShowCreate(false);
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
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-2 text-sm font-semibold text-white hover:bg-terracotta/90"
        >
          <Plus className="h-4 w-4" />
          New Employee
        </button>
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
          return (
            <Link
              key={emp.id}
              href={`/hr/employees/${emp.id}`}
              className={`flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md ${
                resigned ? "opacity-70" : ""
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${
                resigned ? "bg-red-300" : hasProfile ? "bg-green-500" : "bg-gray-300"
              }`}>
                {(emp.fullName || emp.name).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
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
            </Link>
          );
        })}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !creating && setShowCreate(false)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">New Employee</h2>
              <button onClick={() => setShowCreate(false)} className="rounded p-1 hover:bg-muted" disabled={creating}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
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
                onClick={() => setShowCreate(false)}
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
