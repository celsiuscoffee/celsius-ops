"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Tags, Loader2 } from "lucide-react";

type Group = { id: string; name: string; slug: string; productCount: number };

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");

  const [saving, setSaving] = useState(false);

  const loadGroups = () => {
    fetch("/api/inventory/groups")
      .then((res) => res.json())
      .then((data) => { setGroups(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadGroups(); }, []);

  const openAdd = () => { setName(""); setEditingId(null); setDialogOpen(true); };
  const openEdit = (group: Group) => { setName(group.name); setEditingId(group.id); setDialogOpen(true); };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = editingId ? `/api/inventory/groups/${editingId}` : "/api/inventory/groups";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) { alert("Failed to save group. Please try again."); return; }
      setDialogOpen(false);
      loadGroups();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this group? Items in this group will need reassignment.")) return;
    const res = await fetch(`/api/inventory/groups/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to delete group. It may have linked items."); return; }
    loadGroups();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Item Groups</h2>
          <p className="mt-0.5 text-sm text-gray-500">{groups.length} item {groups.length === 1 ? 'group' : 'groups'}</p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Group
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <div
            key={group.id}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 transition-shadow hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                <Tags className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-gray-900">{group.name}</p>
                <p className="text-xs text-gray-500">{group.productCount} {group.productCount === 1 ? 'item' : 'items'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => openEdit(group)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => handleDelete(group.id)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Group" : "Add Group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700">Group Name</label>
              <Input className="mt-1" placeholder="e.g. Beverages" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button onClick={handleSubmit} disabled={saving || !name.trim()} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save" : "Add Group"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
