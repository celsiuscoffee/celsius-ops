"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck, Loader2, Building2, User, Camera,
  CheckCircle2, Clock, ChevronRight, Search,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { AuditNav } from "../_nav";

type Outlet = { id: string; code: string; name: string };
type Staff = { id: string; name: string; role: string };

type AuditReport = {
  id: string;
  date: string;
  status: "IN_PROGRESS" | "COMPLETED";
  overallScore: number | null;
  overallNotes: string | null;
  completedAt: string | null;
  template: { id: string; name: string; roleType: string };
  outlet: { id: string; name: string; code: string };
  auditor: { id: string; name: string };
  auditee: { id: string; name: string } | null;
  totalItems: number;
  ratedItems: number;
  totalPhotos: number;
  progress: number;
};

const ROLE_LABELS: Record<string, string> = {
  chef_head: "Head of Chef",
  barista_head: "Head of Barista",
  area_manager: "Area Manager",
};

const ROLE_COLORS: Record<string, string> = {
  chef_head: "bg-orange-100 text-orange-700",
  barista_head: "bg-amber-100 text-amber-700",
  area_manager: "bg-blue-100 text-blue-700",
};

const STATUS_COLORS: Record<string, string> = {
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED: "bg-green-100 text-green-700",
};

function firstDayOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

export default function AuditReportsPage() {
  const { data: outlets } = useFetch<Outlet[]>("/api/ops/outlets");
  const { data: staff } = useFetch<Staff[]>("/api/ops/staff");

  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [outletId, setOutletId] = useState("");
  const [roleType, setRoleType] = useState("all");
  const [auditorId, setAuditorId] = useState("");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (outletId) params.set("outletId", outletId);
  if (roleType !== "all") params.set("roleType", roleType);
  if (auditorId) params.set("auditorId", auditorId);
  if (status !== "all") params.set("status", status);

  const { data: reports, isLoading } = useFetch<AuditReport[]>(
    `/api/ops/audit-reports?${params.toString()}`,
  );

  const filtered = (reports ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.template.name.toLowerCase().includes(q) ||
      r.outlet.name.toLowerCase().includes(q) ||
      r.auditor.name.toLowerCase().includes(q) ||
      (r.auditee?.name.toLowerCase().includes(q) ?? false)
    );
  });

  // Summary rollup
  const total = filtered.length;
  const completed = filtered.filter((r) => r.status === "COMPLETED").length;
  const inProgress = filtered.filter((r) => r.status === "IN_PROGRESS").length;
  const totalPhotos = filtered.reduce((s, r) => s + r.totalPhotos, 0);
  const avgScore =
    filtered.filter((r) => r.overallScore !== null).length > 0
      ? filtered
          .filter((r) => r.overallScore !== null)
          .reduce((s, r) => s + (r.overallScore ?? 0), 0) /
        filtered.filter((r) => r.overallScore !== null).length
      : null;

  return (
    <div className="space-y-4 p-6">
      <AuditNav />
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Audit Reports</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Manager audits submitted by Area Managers, Heads of Chef & Barista
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">Outlet</label>
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-sm">
                <option value="">All outlets</option>
                {outlets?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">Role</label>
              <select value={roleType} onChange={(e) => setRoleType(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-sm">
                <option value="all">All roles</option>
                <option value="area_manager">Area Manager</option>
                <option value="chef_head">Head of Chef</option>
                <option value="barista_head">Head of Barista</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">Auditor</label>
              <select value={auditorId} onChange={(e) => setAuditorId(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-sm">
                <option value="">All auditors</option>
                {staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-gray-200 px-2 text-sm">
                <option value="all">All</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search template, outlet, auditor, auditee..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">Total</div>
          <div className="mt-0.5 text-xl font-semibold">{total}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">Completed</div>
          <div className="mt-0.5 text-xl font-semibold text-green-600">{completed}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">In Progress</div>
          <div className="mt-0.5 text-xl font-semibold text-blue-600">{inProgress}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[11px] font-medium text-gray-500">Avg Score</div>
          <div className="mt-0.5 text-xl font-semibold">
            {avgScore !== null ? avgScore.toFixed(1) : "—"}
            <span className="ml-1 text-xs font-normal text-gray-400">
              · {totalPhotos} photos
            </span>
          </div>
        </CardContent></Card>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">No audit reports match these filters</p>
          </CardContent>
        </Card>
      )}

      {/* List */}
      <div className="space-y-2">
        {filtered.map((r) => (
          <Link
            key={r.id}
            href={`/ops/audit-reports/${r.id}`}
            className="block"
          >
            <Card className="transition hover:border-terracotta/40 hover:shadow-sm">
              <CardContent className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">
                      {r.template.name}
                    </span>
                    <Badge className={`text-[10px] ${ROLE_COLORS[r.template.roleType] || "bg-gray-100 text-gray-600"}`}>
                      {ROLE_LABELS[r.template.roleType] || r.template.roleType}
                    </Badge>
                    <Badge className={`text-[10px] ${STATUS_COLORS[r.status]}`}>
                      {r.status === "IN_PROGRESS" ? (
                        <><Clock className="mr-0.5 h-3 w-3" /> In Progress</>
                      ) : (
                        <><CheckCircle2 className="mr-0.5 h-3 w-3" /> Completed</>
                      )}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {r.outlet.name}
                    </span>
                    {r.auditee && (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" /> Auditee: {r.auditee.name}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> Auditor: {r.auditor.name}
                    </span>
                    <span>{r.date}</span>
                    <span>
                      {r.ratedItems}/{r.totalItems} items ({r.progress}%)
                    </span>
                    {r.totalPhotos > 0 && (
                      <span className="flex items-center gap-1">
                        <Camera className="h-3 w-3" /> {r.totalPhotos}
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  {r.overallScore !== null ? (
                    <div className="text-lg font-semibold text-gray-900">
                      {r.overallScore.toFixed(1)}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-300">—</div>
                  )}
                  <div className="text-[10px] text-gray-400">score</div>
                </div>

                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
