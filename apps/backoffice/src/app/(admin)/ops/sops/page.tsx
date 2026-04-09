"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Loader2, FileText, Trash2, ListChecks, Building2 } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Category = { id: string; name: string };

type Sop = {
  id: string; title: string; description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; version: number;
  expectedRecurrence: "SHIFT" | "SPECIFIC_TIMES" | "HOURLY";
  expectedTimesPerDay: number;
  expectedTimes: string[];
  category: { id: string; name: string };
  createdBy: { id: string; name: string };
  _count: { steps: number; sopOutlets: number };
  createdAt: string;
};

const FREQ_LABELS: Record<string, string> = {
  SHIFT: "Per shift",
  SPECIFIC_TIMES: "Specific times",
  HOURLY: "Hourly",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-700",
  PUBLISHED: "bg-green-100 text-green-700",
  ARCHIVED: "bg-gray-100 text-gray-500",
};

export default function SopsPage() {
  const { data: sops, isLoading, mutate } = useFetch<Sop[]>("/api/ops/sops");
  const { data: categories } = useFetch<Category[]>("/api/ops/sop-categories");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [catFilter, setCatFilter] = useState("ALL");

  const filtered = (sops ?? []).filter((s) => {
    if (statusFilter !== "ALL" && s.status !== statusFilter) return false;
    if (catFilter !== "ALL" && s.category.id !== catFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.title.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q);
    }
    return true;
  });

  const deleteSop = async (id: string) => {
    if (!confirm("Delete this SOP?")) return;
    await fetch(`/api/ops/sops/${id}`, { method: "DELETE" });
    mutate();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">SOPs</h2>
          <p className="mt-0.5 text-sm text-gray-500">{sops?.length ?? 0} standard operating procedures</p>
        </div>
        <Link href="/ops/sops/new">
          <Button className="bg-terracotta hover:bg-terracotta-dark">
            <Plus className="mr-1.5 h-4 w-4" />Create SOP
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SOPs..." className="pl-9" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-2 text-sm">
          <option value="ALL">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-2 text-sm">
          <option value="ALL">All Categories</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <FileText className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">{sops?.length === 0 ? "No SOPs yet" : "No matches"}</p>
          {sops?.length === 0 && (
            <Link href="/ops/sops/new"><Button variant="outline" className="mt-4"><Plus className="mr-2 h-4 w-4" />Create first SOP</Button></Link>
          )}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
              {filtered.map((s) => (
                <Card key={s.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <Link href={`/ops/sops/${s.id}`} className="font-medium text-gray-900 hover:text-terracotta">{s.title}</Link>
                        {s.description && <p className="text-xs text-gray-400 truncate mt-0.5">{s.description}</p>}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <Badge variant="secondary" className="text-[10px]">{s.category.name}</Badge>
                          <Badge className={`text-[10px] ${STATUS_COLORS[s.status]}`}>{s.status}</Badge>
                          <span className="text-[10px] text-gray-400">{FREQ_LABELS[s.expectedRecurrence]}</span>
                          {s.expectedRecurrence === "SPECIFIC_TIMES" && s.expectedTimes?.length > 0 && (
                            <span className="text-[10px] text-gray-400">{s.expectedTimes.join(", ")}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                          <span className="flex items-center gap-1"><ListChecks className="h-3 w-3" />{s._count.steps} steps</span>
                          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{s._count.sopOutlets} outlets</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Link href={`/ops/sops/${s.id}`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs">Edit</Button>
                        </Link>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 hover:bg-red-50" onClick={() => deleteSop(s.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>
      )}
    </div>
  );
}
