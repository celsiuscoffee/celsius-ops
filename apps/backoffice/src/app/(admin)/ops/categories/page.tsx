"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Loader2, Tags, Pencil, Trash2 } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Category = {
  id: string; name: string; slug: string; description: string | null;
  sortOrder: number; isActive: boolean; _count: { sops: number };
};

export default function CategoriesPage() {
  const { data: categories, mutate } = useFetch<Category[]>("/api/ops/sop-categories");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openCreate = () => {
    setEditing(null); setName(""); setDescription("");
    setSortOrder((categories?.length ?? 0) * 10);
    setError(""); setDialogOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c); setName(c.name); setDescription(c.description ?? "");
    setSortOrder(c.sortOrder); setError(""); setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    const url = editing ? `/api/ops/sop-categories/${editing.id}` : "/api/ops/sop-categories";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, sortOrder }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error || "Failed"); return; }
    setDialogOpen(false); mutate();
  };

  const handleDelete = async (c: Category) => {
    if (!confirm(`Delete "${c.name}"?`)) return;
    const res = await fetch(`/api/ops/sop-categories/${c.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); alert(d.error || "Failed"); return; }
    mutate();
  };

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">SOP Categories</h2>
          <p className="mt-0.5 text-sm text-gray-500">Organize SOPs by category</p>
        </div>
        <Button onClick={openCreate} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />Add Category
        </Button>
      </div>

      {!categories ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>
      ) : categories.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Tags className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No categories yet</p>
          <Button onClick={openCreate} variant="outline" className="mt-4"><Plus className="mr-2 h-4 w-4" />Create first category</Button>
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
                    <div className="mt-3 flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">{c._count.sops} SOP{c._count.sops !== 1 ? "s" : ""}</Badge>
                      {!c.isActive && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => openEdit(c)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => handleDelete(c)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Category" : "New Category"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><label className="mb-1.5 block text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Opening Procedures" autoFocus /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Description</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Sort Order</label>
              <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)} min={0} /></div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
