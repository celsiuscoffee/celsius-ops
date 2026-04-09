"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Loader2, FileText, Tags, Pencil, Trash2, ListChecks, Building2 } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Category = {
  id: string; name: string; slug: string; description: string | null;
  sortOrder: number; isActive: boolean; _count: { sops: number };
};

type Sop = {
  id: string; title: string; description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; version: number;
  category: { id: string; name: string };
  createdBy: { id: string; name: string };
  _count: { steps: number; sopOutlets: number };
  createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-700",
  PUBLISHED: "bg-green-100 text-green-700",
  ARCHIVED: "bg-gray-100 text-gray-500",
};

export default function SopManagementPage() {
  const { data: sops, isLoading: sopsLoading, mutate: mutateSops } = useFetch<Sop[]>("/api/ops/sops");
  const { data: categories, mutate: mutateCats } = useFetch<Category[]>("/api/ops/sop-categories");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [catFilter, setCatFilter] = useState("ALL");

  // Category dialog
  const [catDialog, setCatDialog] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const [catSaving, setCatSaving] = useState(false);
  const [catError, setCatError] = useState("");

  const filtered = (sops ?? []).filter((s) => {
    if (statusFilter !== "ALL" && s.status !== statusFilter) return false;
    if (catFilter !== "ALL" && s.category.id !== catFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.title.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q);
    }
    return true;
  });

  // Category handlers
  const openCatCreate = () => { setEditingCat(null); setCatName(""); setCatDesc(""); setCatError(""); setCatDialog(true); };
  const openCatEdit = (c: Category) => { setEditingCat(c); setCatName(c.name); setCatDesc(c.description ?? ""); setCatError(""); setCatDialog(true); };

  const saveCat = async () => {
    if (!catName.trim()) { setCatError("Name is required"); return; }
    setCatSaving(true); setCatError("");
    const url = editingCat ? `/api/ops/sop-categories/${editingCat.id}` : "/api/ops/sop-categories";
    const res = await fetch(url, {
      method: editingCat ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: catName.trim(), description: catDesc.trim() || undefined }),
    });
    const data = await res.json();
    setCatSaving(false);
    if (!res.ok) { setCatError(data.error || "Failed"); return; }
    setCatDialog(false); mutateCats();
  };

  const deleteCat = async (c: Category) => {
    if (!confirm(`Delete "${c.name}"?`)) return;
    const res = await fetch(`/api/ops/sop-categories/${c.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); alert(d.error || "Failed"); return; }
    mutateCats();
  };

  const deleteSop = async (id: string) => {
    if (!confirm("Delete this SOP?")) return;
    await fetch(`/api/ops/sops/${id}`, { method: "DELETE" });
    mutateSops();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">SOP Management</h2>
          <p className="mt-0.5 text-sm text-gray-500">Create and manage standard operating procedures</p>
        </div>
        <Link href="/ops/sops/new">
          <Button className="bg-terracotta hover:bg-terracotta-dark">
            <Plus className="mr-1.5 h-4 w-4" />Create SOP
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="sops">
        <TabsList>
          <TabsTrigger value="sops">SOPs ({sops?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="categories">Categories ({categories?.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* SOPs Tab */}
        <TabsContent value="sops" className="mt-4">
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

          {sopsLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <FileText className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-gray-500">{sops?.length === 0 ? "No SOPs yet" : "No matches"}</p>
            </CardContent></Card>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">SOP</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Steps</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Outlets</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">By</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <Link href={`/ops/sops/${s.id}`} className="font-medium text-gray-900 hover:text-terracotta">{s.title}</Link>
                        {s.description && <p className="text-xs text-gray-400 truncate max-w-xs">{s.description}</p>}
                      </td>
                      <td className="px-4 py-3"><Badge variant="secondary" className="text-[10px]">{s.category.name}</Badge></td>
                      <td className="px-4 py-3"><Badge className={`text-[10px] ${STATUS_COLORS[s.status]}`}>{s.status}</Badge></td>
                      <td className="px-4 py-3 text-gray-500"><span className="flex items-center gap-1"><ListChecks className="h-3 w-3" />{s._count.steps}</span></td>
                      <td className="px-4 py-3 text-gray-500"><span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{s._count.sopOutlets}</span></td>
                      <td className="px-4 py-3 text-xs text-gray-400">{s.createdBy.name}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Link href={`/ops/sops/${s.id}`}>
                            <Button size="sm" variant="outline" className="h-7 text-xs">Edit</Button>
                          </Link>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-red-500 hover:bg-red-50" onClick={() => deleteSop(s.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories" className="mt-4">
          <div className="mb-4">
            <Button onClick={openCatCreate} className="bg-terracotta hover:bg-terracotta-dark">
              <Plus className="mr-1.5 h-4 w-4" />Add Category
            </Button>
          </div>
          {!categories || categories.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <Tags className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-gray-500">No categories yet</p>
            </CardContent></Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((c) => (
                <Card key={c.id} className={!c.isActive ? "opacity-50" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900">{c.name}</h3>
                        {c.description && <p className="mt-1 text-xs text-gray-400">{c.description}</p>}
                        <Badge variant="secondary" className="mt-2 text-[10px]">{c._count.sops} SOP{c._count.sops !== 1 ? "s" : ""}</Badge>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openCatEdit(c)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => deleteCat(c)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Category Dialog */}
      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCat ? "Edit Category" : "New Category"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><label className="mb-1.5 block text-sm font-medium">Name</label>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g., Opening Procedures" autoFocus /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Description</label>
              <Input value={catDesc} onChange={(e) => setCatDesc(e.target.value)} placeholder="Optional" /></div>
            {catError && <p className="text-sm text-red-500">{catError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog(false)}>Cancel</Button>
            <Button onClick={saveCat} disabled={catSaving} className="bg-terracotta hover:bg-terracotta-dark">
              {catSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editingCat ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
