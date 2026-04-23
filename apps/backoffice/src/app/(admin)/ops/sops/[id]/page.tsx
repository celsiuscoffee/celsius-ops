"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, Save, Trash2, Plus, Camera,
  Loader2, Send, Archive, CheckCircle2,
  Pencil, Building2, ListChecks, Clock,
  ChevronUp, ChevronDown,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Category = { id: string; name: string };
type StepData = { id?: string; stepNumber: number; title: string; description: string | null; imageUrl: string | null; photoRequired: boolean };
type OutletAssignment = { id: string; outlet: { id: string; code: string; name: string } };
type Outlet = { id: string; code: string; name: string; type: string };

type SopDetail = {
  id: string; title: string; description: string | null; categoryId: string;
  category: { id: string; name: string; slug: string };
  content: string | null; status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  sortOrder: number; version: number;
  expectedRecurrence: "SHIFT" | "SPECIFIC_TIMES" | "HOURLY";
  expectedTimesPerDay: number;
  expectedTimes: string[];
  expectedDueMinutes: number;
  appliesToAllOutlets: boolean;
  createdBy: { id: string; name: string };
  steps: StepData[]; sopOutlets: OutletAssignment[];
  publishedAt: string | null; createdAt: string; updatedAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-700 border-yellow-200",
  PUBLISHED: "bg-green-100 text-green-700 border-green-200",
  ARCHIVED: "bg-gray-100 text-gray-500 border-gray-200",
};

export default function SopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: sop, mutate, isLoading } = useFetch<SopDetail>(`/api/ops/sops/${id}`);
  const { data: categories } = useFetch<Category[]>("/api/ops/sop-categories");
  const { data: allOutlets } = useFetch<Outlet[]>("/api/ops/outlets");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [content, setContent] = useState("");
  const [steps, setSteps] = useState<{ title: string; description: string; photoRequired: boolean }[]>([]);
  const [assignedOutletIds, setAssignedOutletIds] = useState<Set<string>>(new Set());

  // Frequency fields
  const [expectedRecurrence, setExpectedRecurrence] = useState<"SHIFT" | "SPECIFIC_TIMES" | "HOURLY">("SHIFT");
  const [expectedTimesPerDay, setExpectedTimesPerDay] = useState(1);
  const [expectedTimes, setExpectedTimes] = useState<string[]>([]);
  const [newExpectedTime, setNewExpectedTime] = useState("08:00");
  const [expectedDueMinutes, setExpectedDueMinutes] = useState(0);
  const [appliesToAllOutlets, setAppliesToAllOutlets] = useState(true);
  const [editingFrequency, setEditingFrequency] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [editingSteps, setEditingSteps] = useState(false);
  const [outletsDialog, setOutletsDialog] = useState(false);

  useEffect(() => {
    if (!sop) return;
    setTitle(sop.title); setDescription(sop.description ?? "");
    setExpectedRecurrence(sop.expectedRecurrence);
    setExpectedTimesPerDay(sop.expectedTimesPerDay);
    setExpectedTimes(sop.expectedTimes ?? []);
    setExpectedDueMinutes(sop.expectedDueMinutes);
    setAppliesToAllOutlets(sop.appliesToAllOutlets);
    setCategoryId(sop.categoryId); setContent(sop.content ?? "");
    setSteps(sop.steps.map((s) => ({ title: s.title, description: s.description ?? "", photoRequired: s.photoRequired })));
    setAssignedOutletIds(new Set(sop.sopOutlets.map((a) => a.outlet.id)));
  }, [sop]);

  const showSaved = (msg: string) => { setSaveMsg(msg); setTimeout(() => setSaveMsg(""), 2000); };

  const addExpectedTime = () => {
    if (newExpectedTime && !expectedTimes.includes(newExpectedTime)) {
      const updated = [...expectedTimes, newExpectedTime].sort();
      setExpectedTimes(updated);
      setExpectedTimesPerDay(updated.length);
    }
  };
  const removeExpectedTime = (t: string) => {
    const updated = expectedTimes.filter((x) => x !== t);
    setExpectedTimes(updated);
    setExpectedTimesPerDay(Math.max(1, updated.length));
  };

  const saveFrequency = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRecurrence, expectedTimesPerDay,
          expectedTimes: expectedRecurrence === "SPECIFIC_TIMES" ? expectedTimes : [],
          expectedDueMinutes, appliesToAllOutlets,
        }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate(); showSaved("Frequency saved"); setEditingFrequency(false);
    } finally { setSaving(false); }
  };

  const saveDetails = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined, categoryId, content: content.trim() || undefined }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate(); showSaved("Details saved"); setEditingDetails(false);
    } finally { setSaving(false); }
  };

  const saveSteps = async () => {
    setSaving(true);
    try {
      const validSteps = steps.filter((s) => s.title.trim());
      const res = await fetch(`/api/ops/sops/${id}/steps`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: validSteps.map((s, i) => ({ stepNumber: i + 1, title: s.title.trim(), description: s.description.trim() || undefined, photoRequired: s.photoRequired })) }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate(); showSaved("Steps saved"); setEditingSteps(false);
    } finally { setSaving(false); }
  };

  const saveOutlets = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/sops/${id}/outlets`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletIds: Array.from(assignedOutletIds) }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate(); showSaved("Outlets updated"); setOutletsDialog(false);
    } finally { setSaving(false); }
  };

  const changeStatus = async (status: "DRAFT" | "PUBLISHED" | "ARCHIVED") => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/sops/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error); return; }
      mutate(); showSaved(`Status → ${status.toLowerCase()}`);
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this SOP? This cannot be undone.")) return;
    await fetch(`/api/ops/sops/${id}`, { method: "DELETE" });
    router.push("/ops/sops");
  };

  const addStep = () => setSteps([...steps, { title: "", description: "", photoRequired: false }]);
  const updateStep = (i: number, f: "title" | "description", v: string) => { const u = [...steps]; u[i] = { ...u[i], [f]: v }; setSteps(u); };
  const removeStep = (i: number) => setSteps(steps.filter((_, idx) => idx !== i));
  const moveStep = (from: number, to: number) => { if (to < 0 || to >= steps.length) return; const u = [...steps]; const [m] = u.splice(from, 1); u.splice(to, 0, m); setSteps(u); };
  const toggleOutlet = (oid: string) => { setAssignedOutletIds((p) => { const n = new Set(p); if (n.has(oid)) n.delete(oid); else n.add(oid); return n; }); };

  if (isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>;
  if (!sop) return <div className="p-6 text-center"><p className="text-gray-500">SOP not found</p><Link href="/ops/sops" className="mt-2 text-sm text-terracotta hover:underline">Back</Link></div>;

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="mb-6">
        <Link href="/ops/sops" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft className="h-4 w-4" />Back to SOPs
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-gray-900">{sop.title}</h2>
              <Badge className={`text-xs ${STATUS_COLORS[sop.status]}`}>{sop.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {sop.category.name} · v{sop.version} · by {sop.createdBy.name} · {new Date(sop.createdAt).toLocaleDateString()}
            </p>
            {saveMsg && <p className="mt-1.5 inline-flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-3.5 w-3.5" />{saveMsg}</p>}
          </div>
          <div className="flex gap-2">
            {sop.status === "DRAFT" && (
              <Button onClick={() => changeStatus("PUBLISHED")} disabled={saving} size="sm" className="bg-green-600 hover:bg-green-700">
                <Send className="mr-1.5 h-3.5 w-3.5" />Publish
              </Button>
            )}
            {sop.status === "PUBLISHED" && (
              <Button onClick={() => changeStatus("ARCHIVED")} disabled={saving} size="sm" variant="outline">
                <Archive className="mr-1.5 h-3.5 w-3.5" />Archive
              </Button>
            )}
            {sop.status === "ARCHIVED" && (
              <Button onClick={() => changeStatus("DRAFT")} disabled={saving} size="sm" variant="outline">Revert to Draft</Button>
            )}
            <Button onClick={handleDelete} size="sm" variant="outline" className="text-red-500 hover:bg-red-50 border-red-200">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — Details + Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Details */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">Details</h3>
                {!editingDetails && (
                  <button onClick={() => setEditingDetails(true)} className="flex items-center gap-1 text-xs text-terracotta hover:underline">
                    <Pencil className="h-3 w-3" />Edit
                  </button>
                )}
              </div>
              {editingDetails ? (
                <div className="space-y-3">
                  <div><label className="mb-1 block text-xs font-medium text-gray-500">Title</label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
                  <div><label className="mb-1 block text-xs font-medium text-gray-500">Description</label>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
                  <div><label className="mb-1 block text-xs font-medium text-gray-500">Category</label>
                    <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
                      {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select></div>
                  <div><label className="mb-1 block text-xs font-medium text-gray-500">Content / Notes</label>
                    <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-y" /></div>
                  <div className="flex gap-2">
                    <Button onClick={saveDetails} disabled={saving} size="sm" className="bg-terracotta hover:bg-terracotta-dark">
                      {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save
                    </Button>
                    <Button onClick={() => { setEditingDetails(false); if (sop) { setTitle(sop.title); setDescription(sop.description ?? ""); setCategoryId(sop.categoryId); setContent(sop.content ?? ""); } }} size="sm" variant="outline">Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {sop.description && <p className="text-sm text-gray-600">{sop.description}</p>}
                  {sop.content && (
                    <div className="mt-3 rounded-lg bg-gray-50 p-3">
                      <p className="text-xs font-medium text-gray-500 mb-1">Notes</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{sop.content}</p>
                    </div>
                  )}
                  {!sop.description && !sop.content && <p className="text-sm text-gray-400 italic">No description or notes</p>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Steps — inline preview with edit mode */}
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-gray-400" />
                  Steps ({steps.length})
                </h3>
                <div className="flex gap-2">
                  {editingSteps ? (
                    <>
                      <Button onClick={addStep} size="sm" variant="outline" className="h-7 text-xs">
                        <Plus className="mr-1 h-3 w-3" />Add
                      </Button>
                      <Button onClick={saveSteps} disabled={saving} size="sm" className="h-7 text-xs bg-terracotta hover:bg-terracotta-dark">
                        {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Save
                      </Button>
                      <Button onClick={() => { setEditingSteps(false); if (sop) setSteps(sop.steps.map((s) => ({ title: s.title, description: s.description ?? "", photoRequired: s.photoRequired }))); }} size="sm" variant="outline" className="h-7 text-xs">Cancel</Button>
                    </>
                  ) : (
                    <button onClick={() => setEditingSteps(true)} className="flex items-center gap-1 text-xs text-terracotta hover:underline">
                      <Pencil className="h-3 w-3" />Edit
                    </button>
                  )}
                </div>
              </div>

              {steps.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No steps yet</p>
              ) : editingSteps ? (
                <div className="space-y-2">
                  {steps.map((step, i) => (
                    <div key={i} className="flex gap-2 rounded-lg border border-gray-200 p-2.5">
                      <div className="flex flex-col items-center gap-0.5 pt-0.5">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-terracotta/10 text-[10px] font-bold text-terracotta">{i + 1}</span>
                        <button onClick={() => moveStep(i, i - 1)} disabled={i === 0} className="text-gray-300 hover:text-gray-500 disabled:opacity-30"><ChevronUp className="h-3 w-3" /></button>
                        <button onClick={() => moveStep(i, i + 1)} disabled={i === steps.length - 1} className="text-gray-300 hover:text-gray-500 disabled:opacity-30"><ChevronDown className="h-3 w-3" /></button>
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <Input value={step.title} onChange={(e) => updateStep(i, "title", e.target.value)} placeholder="Step title" className="text-sm h-8" />
                        <textarea value={step.description} onChange={(e) => updateStep(i, "description", e.target.value)} placeholder="Details (optional)" rows={1}
                          className="w-full rounded-md border border-gray-200 px-2.5 py-1 text-xs resize-y" />
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={step.photoRequired}
                            onChange={(e) => { const u = [...steps]; u[i] = { ...u[i], photoRequired: e.target.checked }; setSteps(u); }}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-terracotta focus:ring-terracotta" />
                          <Camera className="h-3 w-3 text-gray-400" />
                          <span className="text-[10px] text-gray-500">Photo required</span>
                        </label>
                      </div>
                      <button onClick={() => removeStep(i)} className="self-start rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {steps.map((step, i) => (
                    <div key={i} className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-terracotta/10 text-xs font-medium text-terracotta">{i + 1}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{step.title}</p>
                        {step.description && <p className="text-xs text-gray-400 mt-0.5">{step.description}</p>}
                      </div>
                      {step.photoRequired && (
                        <span className="flex items-center gap-1 shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                          <Camera className="h-3 w-3" />Photo
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column — Sidebar info */}
        <div className="space-y-6">
          {/* Status card */}
          <Card>
            <CardContent className="p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Info</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <Badge className={`text-[10px] ${STATUS_COLORS[sop.status]}`}>{sop.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Version</span>
                  <span className="font-medium text-gray-900">v{sop.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Category</span>
                  <span className="font-medium text-gray-900">{sop.category.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Steps</span>
                  <span className="font-medium text-gray-900">{sop.steps.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Created by</span>
                  <span className="font-medium text-gray-900">{sop.createdBy.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Created</span>
                  <span className="text-gray-600">{new Date(sop.createdAt).toLocaleDateString()}</span>
                </div>
                {sop.publishedAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Published</span>
                    <span className="text-gray-600">{new Date(sop.publishedAt).toLocaleDateString()}</span>
                  </div>
                )}
                <div className="border-t border-gray-100 pt-3 mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Expected Frequency</p>
                    {!editingFrequency && (
                      <button onClick={() => setEditingFrequency(true)} className="text-[10px] text-terracotta hover:underline">Edit</button>
                    )}
                  </div>
                  {editingFrequency ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-[10px] text-gray-500 mb-1">Recurrence</p>
                        <div className="flex gap-1">
                          {(["SHIFT", "SPECIFIC_TIMES", "HOURLY"] as const).map((r) => (
                            <button key={r} type="button" onClick={() => setExpectedRecurrence(r)}
                              className={`flex-1 rounded py-1.5 text-[10px] font-medium ${expectedRecurrence === r ? "bg-terracotta text-white" : "bg-gray-100 text-gray-500"}`}>
                              {r === "SHIFT" ? "Per shift" : r === "HOURLY" ? "Hourly" : "Specific times"}
                            </button>
                          ))}
                        </div>
                      </div>
                      {expectedRecurrence === "SPECIFIC_TIMES" && (
                        <div>
                          <p className="text-[10px] text-gray-500 mb-1">Times</p>
                          <div className="flex gap-1.5 mb-1.5">
                            <input type="time" value={newExpectedTime} onChange={(e) => setNewExpectedTime(e.target.value)}
                              className="rounded border border-gray-200 px-2 py-1 text-xs" />
                            <button type="button" onClick={addExpectedTime}
                              className="rounded bg-terracotta px-2 py-1 text-[10px] text-white">Add</button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {expectedTimes.map((t) => (
                              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-terracotta/10 px-2 py-0.5 text-[10px] text-terracotta">
                                {t}<button onClick={() => removeExpectedTime(t)} className="hover:text-red-500">×</button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {expectedRecurrence !== "SPECIFIC_TIMES" && (
                        <div>
                          <p className="text-[10px] text-gray-500 mb-1">Times per day</p>
                          <input type="number" min={1} value={expectedTimesPerDay} onChange={(e) => setExpectedTimesPerDay(parseInt(e.target.value) || 1)}
                            className="w-full rounded border border-gray-200 px-2 py-1 text-xs" />
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] text-gray-500 mb-1">Due within (minutes)</p>
                        <div className="flex gap-1">
                          {[0, 15, 30, 60].map((m) => (
                            <button key={m} type="button" onClick={() => setExpectedDueMinutes(m)}
                              className={`flex-1 rounded py-1.5 text-[10px] font-medium ${expectedDueMinutes === m ? "bg-terracotta text-white" : "bg-gray-100 text-gray-500"}`}>
                              {m === 0 ? "None" : `${m}min`}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={appliesToAllOutlets} onChange={(e) => setAppliesToAllOutlets(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-terracotta" />
                          <span className="text-xs text-gray-600">Applies to all outlets</span>
                        </label>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={saveFrequency} disabled={saving}
                          className="flex-1 rounded bg-terracotta py-1.5 text-[10px] font-medium text-white disabled:opacity-50">Save</button>
                        <button onClick={() => setEditingFrequency(false)}
                          className="flex-1 rounded bg-gray-100 py-1.5 text-[10px] font-medium text-gray-600">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Recurrence</span>
                        <span className="font-medium text-gray-900">{
                          sop.expectedRecurrence === "SHIFT" ? "Per shift" :
                          sop.expectedRecurrence === "HOURLY" ? "Hourly" : "Specific times"
                        }</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Times/day</span>
                        <span className="font-medium text-gray-900">{sop.expectedTimesPerDay}x</span>
                      </div>
                      {sop.expectedTimes && sop.expectedTimes.length > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">At</span>
                          <span className="font-medium text-gray-900 text-right">{sop.expectedTimes.join(", ")}</span>
                        </div>
                      )}
                      {sop.expectedDueMinutes > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Due within</span>
                          <span className="font-medium text-gray-900">{sop.expectedDueMinutes} min</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500">Scope</span>
                        <span className="font-medium text-gray-900">{sop.appliesToAllOutlets ? "All outlets" : "Assigned only"}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Outlets card */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />Outlets ({sop.sopOutlets.length})
                </h3>
                <button onClick={() => setOutletsDialog(true)} className="text-xs text-terracotta hover:underline">Manage</button>
              </div>
              {sop.sopOutlets.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Not assigned to any outlet</p>
              ) : (
                <div className="space-y-1.5">
                  {sop.sopOutlets.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 rounded-md bg-gray-50 px-2.5 py-1.5">
                      <div className="h-2 w-2 rounded-full bg-green-400" />
                      <span className="text-sm text-gray-700">{a.outlet.name}</span>
                      <span className="text-[10px] text-gray-400 ml-auto">{a.outlet.code}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Outlets Dialog */}
      <Dialog open={outletsDialog} onOpenChange={setOutletsDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign to Outlets</DialogTitle></DialogHeader>
          <div className="py-2 space-y-2 max-h-80 overflow-y-auto">
            {allOutlets?.map((outlet) => (
              <label key={outlet.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={assignedOutletIds.has(outlet.id)} onChange={() => toggleOutlet(outlet.id)}
                  className="h-4 w-4 rounded border-gray-300 text-terracotta focus:ring-terracotta" />
                <div>
                  <p className="text-sm font-medium">{outlet.name}</p>
                  <p className="text-xs text-gray-400">{outlet.code} · {outlet.type}</p>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutletsDialog(false)}>Cancel</Button>
            <Button onClick={saveOutlets} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
