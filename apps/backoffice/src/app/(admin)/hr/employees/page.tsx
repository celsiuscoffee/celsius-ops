"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { UserCog, ChevronRight, CheckCircle2, AlertCircle, Search } from "lucide-react";
import Link from "next/link";
import type { EmployeeProfile } from "@/lib/hr/types";

type Employee = {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string | null;
  outletId: string | null;
  outlet: { name: string } | null;
  hrProfile: EmployeeProfile | null;
};

export default function EmployeesPage() {
  const { data } = useFetch<{ employees: Employee[] }>("/api/hr/employees");
  const [search, setSearch] = useState("");

  const employees = (data?.employees || []).filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase()),
  );

  const configured = employees.filter((e) => e.hrProfile).length;
  const total = employees.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Employees</h1>
        <p className="text-sm text-muted-foreground">
          {configured}/{total} profiles configured
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search employees..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border bg-background py-2 pl-10 pr-4 text-sm"
        />
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
                {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{emp.name}</p>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {emp.role}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {emp.outlet?.name || "No outlet"}{" "}
                  {emp.hrProfile?.position && `· ${emp.hrProfile.position}`}
                </p>
                {emp.hrProfile?.basic_salary ? (
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
