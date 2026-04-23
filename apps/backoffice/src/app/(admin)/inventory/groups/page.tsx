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
import { Plus, Pencil, Trash2, Tags, Warehouse, Loader2 } from "lucide-react";

type Group = { id: string; name: string; slug: string; productCount: number };
type StorageArea = { id: string; name: string; slug: string; productCount: number };

type Tab = "groups" | "storage";

export default function GroupsPage() {
  const [tab, setTab] = useState<Tab>("groups");

  // Groups state
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  // Storage areas state
  const [storageAreas, setStorageAreas] = useState<StorageArea[]>([]);
  const [loadingStorage, setLoadingStorage] = useState(true);

  // Shared dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const loadGroups = () => {
    fetch("/api/inventory/groups")
      .then((res) => res.json())
      .then((data) => { setGroups(data); setLoadingGroups(false); })
      .catch(() => setLoadingGroups(false));
  };

  const loadStorageAreas = () => {
    fetch("/api/inventory/storage-areas")
      .then((res) => res.json())
      .then((data) => { setStorageAreas(data); setLoadingStorage(false); })
      .catch(() => setLoadingStorage(false));
  };

  useEffect(() => { loadGroups(); loadStorageAreas(); }, []);

  const openAdd = () => { setName(""); setEditingId(null); setDialogOpen(true); };
  const openEditGroup = (group: Group) => { setName(group.name); setEditingId(group.id); setDialogOpen(true); };
  const openEditStorage = (area: StorageArea) => { setName(area.name); setEditingId(area.id); setDialogOpen(true); };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const base = tab === "groups" ? "/api/inventory/groups" : "/api/inventory/storage-areas";
      const url = editingId ? `${base}/${editingId}` : base;
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to save. Please try again.");
        return;
      }
      setDialogOpen(false);
      if (tab === "groups") loadGroups(); else loadStorageAreas();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm("Delete this group? Items in this group will need reassignment.")) return;
    const res = await fetch(`/api/inventory/groups/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to delete group.");
      return;
    }
    loadGroups();
  };

  const handleDeleteStorage = async (id: string) => {
    if (!confirm("Delete this storage area?")) return;
    const res = await fetch(`/api/inventory/storage-areas/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to delete storage area.");
      return;
    }
    loadStorageAreas();
  };

  const loading = tab === "groups" ? loadingGroups : loadingStorage;

  return (
    <div className="p-3 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Item Groups</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage ingredient groups and storage areas
          </p>
        </div>
        <Button onClick={openAdd} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />
          {tab === "groups" ? "Add Group" : "Add Storage Area"}
        </Button>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 rounded-lg bg-gray-100 p-1">
        <button
          onClick={() => setTab("groups")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "groups" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Tags className="mr-1.5 inline-block h-4 w-4" />
          Groups ({groups.length})
        </button>
        <button
          onClick={() => setTab("storage")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "storage" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Warehouse className="mr-1.5 inline-block h-4 w-4" />
          Storage Areas ({storageAreas.length})
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
        </div>
      ) : tab === "groups" ? (
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
                  <p className="text-xs text-gray-500">{group.productCount} {group.productCount === 1 ? "item" : "items"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEditGroup(group)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDeleteGroup(group.id)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="col-span-full text-center text-sm text-gray-400 py-8">No item groups yet</p>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {storageAreas.map((area) => (
            <div
              key={area.id}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Warehouse className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{area.name}</p>
                  <p className="text-xs text-gray-500">{area.productCount} {area.productCount === 1 ? "item" : "items"}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => openEditStorage(area)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDeleteStorage(area.id)} className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {storageAreas.length === 0 && (
            <p className="col-span-full text-center text-sm text-gray-400 py-8">No storage areas yet</p>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? tab === "groups" ? "Edit Group" : "Edit Storage Area"
                : tab === "groups" ? "Add Group" : "Add Storage Area"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700">
                {tab === "groups" ? "Group Name" : "Storage Area Name"}
              </label>
              <Input
                className="mt-1"
                placeholder={tab === "groups" ? "e.g. Beverages" : "e.g. Walk-in Chiller"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              />
            </div>
            <Button onClick={handleSubmit} disabled={saving || !name.trim()} className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save" : tab === "groups" ? "Add Group" : "Add Storage Area"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
