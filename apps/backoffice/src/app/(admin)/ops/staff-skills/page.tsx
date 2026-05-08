"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Users, ChevronRight } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { AuditNav } from "../_nav";

type Row = {
  auditeeId: string;
  auditee: { id: string; name: string };
  templateId: string;
  templateName: string;
  jobRole: string | null;
  latestDate: string;
  latestScore: number | null;
  auditCount: number;
  outlet: { id: string; name: string; code: string };
};

export default function StaffSkillsOverviewPage() {
  const { data, isLoading } = useFetch<Row[]>("/api/ops/audit-reports/staff");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");

  const rows = data ?? [];
  const allRoles = Array.from(new Set(rows.map((r) => r.jobRole).filter(Boolean) as string[])).sort();

  const filtered = rows.filter((r) => {
    if (roleFilter !== "ALL" && r.jobRole !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.auditee.name.toLowerCase().includes(q) ||
        r.templateName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by auditee so we render a card per person.
  const byPerson = new Map<string, { auditee: Row["auditee"]; rows: Row[] }>();
  for (const r of filtered) {
    if (!byPerson.has(r.auditeeId)) byPerson.set(r.auditeeId, { auditee: r.auditee, rows: [] });
    byPerson.get(r.auditeeId)!.rows.push(r);
  }

  return (
    <div className="space-y-4 p-6">
      <AuditNav />
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Staff Skills</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Audited staff and their latest skill scores. Click a person to see improvement over time.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search staff or template…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="ALL">All Roles</option>
          {allRoles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      )}

      {!isLoading && byPerson.size === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">No staff-skills audits yet</p>
            <p className="mt-1 text-xs text-gray-400">
              Create a STAFF audit template, then run the audit from the staff app.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {Array.from(byPerson.values()).map(({ auditee, rows: personRows }) => (
          <Link key={auditee.id} href={`/ops/staff-skills/${auditee.id}`}>
            <Card className="hover:border-terracotta/40 transition">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-terracotta/10 text-terracotta font-semibold">
                    {auditee.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{auditee.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {personRows.map((r) => (
                        <Badge
                          key={`${r.auditeeId}-${r.templateId}`}
                          className={`text-[10px] ${
                            (r.latestScore ?? 0) >= 80
                              ? "bg-green-100 text-green-700"
                              : (r.latestScore ?? 0) >= 60
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-red-100 text-red-700"
                          }`}
                        >
                          {r.templateName}: {r.latestScore ?? 0}% ({r.auditCount}× audit{r.auditCount !== 1 ? "s" : ""})
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

