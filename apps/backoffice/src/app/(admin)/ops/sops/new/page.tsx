"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Plus, Trash2, GripVertical, Loader2, Save, Send } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Category = { id: string; name: string };
type StepInput = { title: string; description: string };

export default function NewSopPage() {
  const router = useRouter();
  const { data: categories } = useFetch<Category[]>("/api/ops/sop-categories");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [content, setContent] = useState("");
  const [steps, setSteps] = useState<StepInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addStep = () => setSteps([...steps, { title: "", description: "" }]);
  const updateStep = (i: number, field: keyof StepInput, value: string) => {
    const u = [...steps]; u[i] = { ...u[i], [field]: value }; setSteps(u);
  };
  const removeStep = (i: number) => setSteps(steps.filter((_, idx) => idx !== i));
  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const u = [...steps]; const [m] = u.splice(from, 1); u.splice(to, 0, m); setSteps(u);
  };

  const handleSubmit = async (status: "DRAFT" | "PUBLISHED") => {
    if (!title.trim()) { setError("Title is required"); return; }
    if (!categoryId) { setError("Category is required"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/ops/sops", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined, categoryId, content: content.trim() || undefined, status }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); return; }

      const validSteps = steps.filter((s) => s.title.trim());
      if (validSteps.length > 0) {
        await fetch(`/api/ops/sops/${data.id}/steps`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps: validSteps.map((s, i) => ({ stepNumber: i + 1, title: s.title.trim(), description: s.description.trim() || undefined })) }),
        });
      }
      router.push(`/ops/sops/${data.id}`);
    } catch { setError("Connection error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/ops/sops" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft className="h-4 w-4" />Back to SOPs
        </Link>
        <h2 className="text-xl font-semibold text-gray-900">Create SOP</h2>
      </div>

      <div className="max-w-3xl space-y-6">
        <Card><CardContent className="p-5 space-y-4">
          <div><label className="mb-1.5 block text-sm font-medium">Title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Morning Opening Checklist" autoFocus /></div>
          <div><label className="mb-1.5 block text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" /></div>
          <div><label className="mb-1.5 block text-sm font-medium">Category *</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
              <option value="">Select category</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><label className="mb-1.5 block text-sm font-medium">Content / Notes</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Detailed instructions..." rows={5}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-y" /></div>
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-gray-900">Steps</h3>
            <Button variant="outline" size="sm" onClick={addStep}><Plus className="mr-1.5 h-3.5 w-3.5" />Add Step</Button>
          </div>
          {steps.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No steps yet. Add steps to break down this SOP.</p>
          ) : (
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-2 rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-terracotta/10 text-xs font-medium text-terracotta">{i + 1}</span>
                    <button onClick={() => moveStep(i, i - 1)} disabled={i === 0} className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30">
                      <GripVertical className="h-3.5 w-3.5 rotate-90" /></button>
                  </div>
                  <div className="flex-1 space-y-2">
                    <Input value={step.title} onChange={(e) => updateStep(i, "title", e.target.value)} placeholder="Step title" className="text-sm" />
                    <textarea value={step.description} onChange={(e) => updateStep(i, "description", e.target.value)} placeholder="Details (optional)" rows={2}
                      className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-xs resize-y" />
                  </div>
                  <button onClick={() => removeStep(i)} className="self-start rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 pb-8">
          <Button variant="outline" onClick={() => handleSubmit("DRAFT")} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Save className="mr-2 h-4 w-4" />Save as Draft</Button>
          <Button onClick={() => handleSubmit("PUBLISHED")} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Send className="mr-2 h-4 w-4" />Publish</Button>
        </div>
      </div>
    </div>
  );
}
