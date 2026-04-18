"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Loader2, Trash2, ListChecks, ClipboardList, ChevronRight } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { SopNav } from "../_nav";

type AuditTemplate = {
  id: string;
  name: string;
  description: string | null;
  roleType: string;
  isActive: boolean;
  version: number;
  createdBy: { id: string; name: string };
  sections: { id: string; name: string; items: { id: string }[] }[];
  _count: { reports: number };
  createdAt: string;
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

export default function AuditTemplatesPage() {
  const { data: templates, isLoading, mutate } = useFetch<AuditTemplate[]>("/api/ops/audit-templates");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");

  // New template form
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newRole, setNewRole] = useState("area_manager");

  const filtered = (templates ?? []).filter((t) => {
    if (roleFilter !== "ALL" && t.roleType !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q);
    }
    return true;
  });

  const deleteTemplate = async (id: string) => {
    if (!confirm("Delete this template and all its sections/items?")) return;
    await fetch(`/api/ops/audit-templates/${id}`, { method: "DELETE" });
    mutate();
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await fetch(`/api/ops/audit-templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    mutate();
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/ops/audit-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || null,
          roleType: newRole,
          sections: [],
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewName("");
        setNewDesc("");
        mutate();
      }
    } finally {
      setCreating(false);
    }
  };

  const totalItems = (t: AuditTemplate) => t.sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <div className="space-y-4 p-6">
      <SopNav />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Audit Templates</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {templates?.length ?? 0} template{(templates?.length ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />New Template
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="mb-6 border-terracotta/30">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Create Template</h3>
            <Input placeholder="Template name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
              <option value="area_manager">Area Manager</option>
              <option value="chef_head">Head of Chef</option>
              <option value="barista_head">Head of Barista</option>
            </select>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)} className="flex-1">Cancel</Button>
              <Button onClick={handleCreate} disabled={!newName.trim() || creating} className="flex-1 bg-terracotta hover:bg-terracotta-dark">
                {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Create
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search templates..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
          <option value="ALL">All Roles</option>
          <option value="area_manager">Area Manager</option>
          <option value="chef_head">Head of Chef</option>
          <option value="barista_head">Head of Barista</option>
        </select>
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
            <ClipboardList className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">No audit templates yet</p>
          </CardContent>
        </Card>
      )}

      {/* Template list */}
      <div className="space-y-3">
        {filtered.map((t) => (
          <Card key={t.id} className={!t.isActive ? "opacity-60" : ""}>
            <CardContent className="p-0">
              <div className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/ops/audit-templates/${t.id}`} className="font-medium text-gray-900 hover:text-terracotta">
                      {t.name}
                    </Link>
                    <Badge className={`text-[10px] ${ROLE_COLORS[t.roleType] || "bg-gray-100 text-gray-600"}`}>
                      {ROLE_LABELS[t.roleType] || t.roleType}
                    </Badge>
                    {!t.isActive && <Badge className="text-[10px] bg-gray-100 text-gray-500">Inactive</Badge>}
                  </div>
                  {t.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{t.description}</p>}
                  <div className="mt-1 flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><ListChecks className="h-3 w-3" />{t.sections.length} sections, {totalItems(t)} items</span>
                    <span>{t._count.reports} report{t._count.reports !== 1 ? "s" : ""}</span>
                    <span>v{t.version}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleActive(t.id, t.isActive)}
                    className={`rounded-md px-2 py-1 text-[10px] font-medium ${t.isActive ? "bg-green-50 text-green-600 hover:bg-green-100" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}
                  >
                    {t.isActive ? "Active" : "Inactive"}
                  </button>
                  <button onClick={() => deleteTemplate(t.id)} className="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <Link href={`/ops/audit-templates/${t.id}`} className="rounded-md p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
