"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Save, Trash2, Plus, GripVertical,
  Loader2, Send, Archive, CheckCircle2,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Category = { id: string; name: string };
type StepData = { id?: string; stepNumber: number; title: string; description: string | null; imageUrl: string | null };
type OutletAssignment = { id: string; outlet: { id: string; code: string; name: string } };
type Outlet = { id: string; code: string; name: string; type: string };

type SopDetail = {
  id: string;
  title: string;
  description: string | null;
  categoryId: string;
  category: { id: string; name: string; slug: string };
  content: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  sortOrder: number;
  version: number;
  createdBy: { id: string; name: string };
  steps: StepData[];
  sopOutlets: OutletAssignment[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-700",
  PUBLISHED: "bg-green-100 text-green-700",
  ARCHIVED: "bg-gray-100 text-gray-500",
};

export default function SopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: sop, mutate, isLoading } = useFetch<SopDetail>(`/api/ops/sops/${id}`);
  const { data: categories } = useFetch<Category[]>("/api/ops/sop-categories");
  const { data: allOutlets } = useFetch<Outlet[]>("/api/ops/outlets");

  // Detail fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [content, setContent] = useState("");

  // Steps
  const [steps, setSteps] = useState<{ title: string; description: string }[]>([]);

  // Outlets
  const [assignedOutletIds, setAssignedOutletIds] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Initialize form when data loads
  useEffect(() => {
    if (!sop) return;
    setTitle(sop.title);
    setDescription(sop.description ?? "");
    setCategoryId(sop.categoryId);
    setContent(sop.content ?? "");
    setSteps(sop.steps.map((s) => ({ title: s.title, description: s.description ?? "" })));
    setAssignedOutletIds(new Set(sop.sopOutlets.map((a) => a.outlet.id)));
  }, [sop]);

  const showSaved = (msg: string) => {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(""), 2000);
  };

  // Save details
  const saveDetails = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          categoryId,
          content: content.trim() || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate();
      showSaved("Details saved");
    } finally { setSaving(false); }
  };

  // Save steps
  const saveSteps = async () => {
    setSaving(true);
    try {
      const validSteps = steps.filter((s) => s.title.trim());
      const res = await fetch(`/api/ops/sops/${id}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: validSteps.map((s, i) => ({
            stepNumber: i + 1,
            title: s.title.trim(),
            description: s.description.trim() || undefined,
          })),
        }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate();
      showSaved("Steps saved");
    } finally { setSaving(false); }
  };

  // Save outlet assignments
  const saveOutlets = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/sops/${id}/outlets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletIds: Array.from(assignedOutletIds) }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate();
      showSaved("Outlets updated");
    } finally { setSaving(false); }
  };

  // Status change
  const changeStatus = async (status: "DRAFT" | "PUBLISHED" | "ARCHIVED") => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/sops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate();
      showSaved(`Status changed to ${status.toLowerCase()}`);
    } finally { setSaving(false); }
  };

  // Delete
  const handleDelete = async () => {
    if (!confirm("Delete this SOP? This cannot be undone.")) return;
    await fetch(`/api/ops/sops/${id}`, { method: "DELETE" });
    router.push("/sops");
  };

  // Step helpers
  const addStep = () => setSteps([...steps, { title: "", description: "" }]);
  const updateStep = (index: number, field: "title" | "description", value: string) => {
    const updated = [...steps];
    updated[index] = { ...updated[index], [field]: value };
    setSteps(updated);
  };
  const removeStep = (index: number) => setSteps(steps.filter((_, i) => i !== index));
  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const updated = [...steps];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    setSteps(updated);
  };

  // Outlet toggle
  const toggleOutlet = (outletId: string) => {
    setAssignedOutletIds((prev) => {
      const next = new Set(prev);
      if (next.has(outletId)) next.delete(outletId); else next.add(outletId);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sop) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">SOP not found</p>
        <Link href="/ops/sops" className="mt-2 text-sm text-terracotta hover:underline">Back to SOPs</Link>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <Link href="/ops/sops" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="h-4 w-4" />Back to SOPs
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">{sop.title}</h1>
          <Badge className={STATUS_COLORS[sop.status]}>{sop.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          v{sop.version} · by {sop.createdBy.name} · {sop.category.name}
        </p>
        {saveMsg && (
          <p className="mt-2 inline-flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />{saveMsg}
          </p>
        )}
      </div>

      <div className="max-w-3xl">
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="steps">Steps ({steps.length})</TabsTrigger>
            <TabsTrigger value="outlets">Outlets ({assignedOutletIds.size})</TabsTrigger>
          </TabsList>

          {/* ── Details Tab ── */}
          <TabsContent value="details" className="mt-4 space-y-4">
            <Card>
              <CardContent className="p-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Title</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Description</label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Category</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {categories?.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Content / Notes</label>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={6}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                  />
                </div>
              </CardContent>
            </Card>
            <div className="flex gap-3">
              <Button onClick={saveDetails} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Save className="mr-2 h-4 w-4" />Save Details
              </Button>
              {sop.status === "DRAFT" && (
                <Button onClick={() => changeStatus("PUBLISHED")} disabled={saving} variant="outline">
                  <Send className="mr-2 h-4 w-4" />Publish
                </Button>
              )}
              {sop.status === "PUBLISHED" && (
                <Button onClick={() => changeStatus("ARCHIVED")} disabled={saving} variant="outline">
                  <Archive className="mr-2 h-4 w-4" />Archive
                </Button>
              )}
              {sop.status === "ARCHIVED" && (
                <Button onClick={() => changeStatus("DRAFT")} disabled={saving} variant="outline">
                  Revert to Draft
                </Button>
              )}
              <Button onClick={handleDelete} variant="outline" className="ml-auto text-red-600 hover:bg-red-50">
                <Trash2 className="mr-2 h-4 w-4" />Delete
              </Button>
            </div>
          </TabsContent>

          {/* ── Steps Tab ── */}
          <TabsContent value="steps" className="mt-4 space-y-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-medium">Steps</h2>
                  <Button variant="outline" size="sm" onClick={addStep}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />Add Step
                  </Button>
                </div>
                {steps.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No steps yet.</p>
                ) : (
                  <div className="space-y-3">
                    {steps.map((step, index) => (
                      <div key={index} className="flex gap-2 rounded-lg border border-border p-3">
                        <div className="flex flex-col items-center gap-1 pt-1">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-terracotta/10 text-xs font-medium text-terracotta">
                            {index + 1}
                          </span>
                          <button
                            onClick={() => moveStep(index, index - 1)}
                            disabled={index === 0}
                            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                          >
                            <GripVertical className="h-3.5 w-3.5 rotate-90" />
                          </button>
                        </div>
                        <div className="flex-1 space-y-2">
                          <Input
                            value={step.title}
                            onChange={(e) => updateStep(index, "title", e.target.value)}
                            placeholder="Step title"
                            className="text-sm"
                          />
                          <textarea
                            value={step.description}
                            onChange={(e) => updateStep(index, "description", e.target.value)}
                            placeholder="Step details (optional)"
                            rows={2}
                            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs resize-y"
                          />
                        </div>
                        <button
                          onClick={() => removeStep(index)}
                          className="self-start rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Button onClick={saveSteps} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />Save Steps
            </Button>
          </TabsContent>

          {/* ── Outlets Tab ── */}
          <TabsContent value="outlets" className="mt-4 space-y-4">
            <Card>
              <CardContent className="p-5">
                <h2 className="font-medium mb-3">Assign to Outlets</h2>
                <p className="text-xs text-muted-foreground mb-4">
                  Select which outlets this SOP applies to.
                </p>
                {!allOutlets ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : allOutlets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active outlets found.</p>
                ) : (
                  <div className="space-y-2">
                    {allOutlets.map((outlet) => (
                      <label
                        key={outlet.id}
                        className="flex items-center gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={assignedOutletIds.has(outlet.id)}
                          onChange={() => toggleOutlet(outlet.id)}
                          className="h-4 w-4 rounded border-gray-300 text-terracotta focus:ring-terracotta"
                        />
                        <div>
                          <p className="text-sm font-medium">{outlet.name}</p>
                          <p className="text-xs text-muted-foreground">{outlet.code} · {outlet.type}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Button onClick={saveOutlets} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />Save Outlet Assignments
            </Button>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
