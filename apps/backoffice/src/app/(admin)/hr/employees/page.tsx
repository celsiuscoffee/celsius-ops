"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { UserCog, ChevronRight, CheckCircle2, AlertCircle, Search } from "lucide-react";
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
};

type EmploymentFilter = "all" | "full_time" | "part_time" | "contract" | "no_profile";

export default function EmployeesPage() {
  const { data } = useFetch<{ employees: Employee[]; scope?: "direct-reports" | "all" }>("/api/hr/employees");
  const scope = data?.scope;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EmploymentFilter>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [outletFilter, setOutletFilter] = useState<string>("all");

  const allEmployees = data?.employees || [];
  const ftCount = allEmployees.filter((e) => e.hrProfile?.employment_type === "full_time").length;
  const ptCount = allEmployees.filter((e) => e.hrProfile?.employment_type === "part_time").length;
  const contractCount = allEmployees.filter((e) => e.hrProfile?.employment_type === "contract").length;
  const noProfileCount = allEmployees.filter((e) => !e.hrProfile).length;

  const roleOptions = Array.from(new Set(allEmployees.map((e) => e.role))).sort();
  const outletOptions = Array.from(
    new Map(allEmployees.filter((e) => e.outlet).map((e) => [e.outletId, e.outlet!.name])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1]));

  const employees = allEmployees.filter((e) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      e.name.toLowerCase().includes(q) ||
      (e.fullName?.toLowerCase().includes(q) ?? false) ||
      e.phone.toLowerCase().includes(q);
    const matchesEmployment =
      filter === "all" ||
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
      <div>
        <h1 className="text-2xl font-bold">Employees</h1>
        <p className="text-sm text-muted-foreground">
          {configured}/{total} profiles configured
        </p>
        {scope === "direct-reports" && (
          <p className="mt-1 text-xs text-terracotta">Showing your direct reports only.</p>
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
          { key: "all", label: `All (${allEmployees.length})` },
          { key: "full_time", label: `Full-Time (${ftCount})` },
          { key: "part_time", label: `Part-Time (${ptCount})` },
          ...(contractCount > 0 ? [{ key: "contract" as const, label: `Contract (${contractCount})` }] : []),
          ...(noProfileCount > 0 ? [{ key: "no_profile" as const, label: `No Profile (${noProfileCount})` }] : []),
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
          return (
            <Link
              key={emp.id}
              href={`/hr/employees/${emp.id}`}
              className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${
                hasProfile ? "bg-green-500" : "bg-gray-300"
              }`}>
                {(emp.fullName || emp.name).split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{emp.fullName || emp.name}</p>
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
                </div>
                <p className="text-sm text-muted-foreground">
                  {emp.outlet?.name || "No outlet"}{" "}
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
                {hasProfile ? (
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
    </div>
  );
}
