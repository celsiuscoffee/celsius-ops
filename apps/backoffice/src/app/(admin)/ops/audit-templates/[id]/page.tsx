"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Save, Loader2, Plus, Trash2, GripVertical, Camera, ChevronDown, ChevronRight,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type SectionItem = {
  title: string;
  description: string;
  photoRequired: boolean;
  ratingType: string;
};

type Section = {
  name: string;
  items: SectionItem[];
};

type Template = {
  id: string;
  name: string;
  description: string | null;
  roleType: string;
  isActive: boolean;
  version: number;
  sections: (Section & { id: string; items: (SectionItem & { id: string })[] })[];
};

const ROLE_LABELS: Record<string, string> = {
  chef_head: "Head of Chef",
  barista_head: "Head of Barista",
  area_manager: "Area Manager",
};

const RATING_LABELS: Record<string, string> = {
  pass_fail: "Pass / Fail",
  rating_5: "5-Star Rating",
  rating_3: "Good / Fair / Poor",
};

export default function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: template, isLoading, mutate } = useFetch<Template>(`/api/ops/audit-templates/${id}`);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [roleType, setRoleType] = useState("area_manager");
  const [sections, setSections] = useState<Section[]>([]);
  const [saving, setSaving] = useState(false);
  const [expandedSec, setExpandedSec] = useState<number | null>(0);

  // Sync form state from fetched data
  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || "");
      setRoleType(template.roleType);
      setSections(
        template.sections.map((s) => ({
          name: s.name,
          items: s.items.map((i) => ({
            title: i.title,
            description: i.description || "",
            photoRequired: i.photoRequired,
            ratingType: i.ratingType,
          })),
        }))
      );
    }
  }, [template]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/audit-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null, roleType, sections }),
      });
      if (res.ok) mutate();
    } finally {
      setSaving(false);
    }
  };

  const addSection = () => {
    setSections([...sections, { name: "", items: [] }]);
    setExpandedSec(sections.length);
  };

  const removeSection = (idx: number) => {
    setSections(sections.filter((_, i) => i !== idx));
  };

  const updateSection = (idx: number, field: string, value: string) => {
    const updated = [...sections];
    (updated[idx] as any)[field] = value;
    setSections(updated);
  };

  const addItem = (secIdx: number) => {
    const updated = [...sections];
    updated[secIdx].items.push({ title: "", description: "", photoRequired: false, ratingType: "pass_fail" });
    setSections(updated);
  };

  const removeItem = (secIdx: number, itemIdx: number) => {
    const updated = [...sections];
    updated[secIdx].items = updated[secIdx].items.filter((_, i) => i !== itemIdx);
    setSections(updated);
  };

  const updateItem = (secIdx: number, itemIdx: number, field: string, value: any) => {
    const updated = [...sections];
    (updated[secIdx].items[itemIdx] as any)[field] = value;
    setSections(updated);
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>;
  }

  if (!template) {
    return <div className="p-6 text-center text-gray-500">Template not found</div>;
  }

  const totalItems = sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <div className="p-3 sm:p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <Link href="/ops/audit-templates" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft className="h-4 w-4" />Back to Templates
        </Link>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Edit Template</h2>
          <Button onClick={handleSave} disabled={saving || !name.trim()} className="bg-terracotta hover:bg-terracotta-dark">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>

      {/* Template info */}
      <Card className="mb-6">
        <CardContent className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Role</label>
            <select value={roleType} onChange={(e) => setRoleType(e.target.value)} className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm">
              <option value="area_manager">Area Manager</option>
              <option value="chef_head">Head of Chef</option>
              <option value="barista_head">Head of Barista</option>
            </select>
          </div>
          <p className="text-xs text-gray-400">{sections.length} sections, {totalItems} items</p>
        </CardContent>
      </Card>

      {/* Sections */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Sections & Items</h3>
        <Button variant="outline" size="sm" onClick={addSection}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add Section
        </Button>
      </div>

      <div className="space-y-3">
        {sections.map((sec, si) => (
          <Card key={si}>
            <CardContent className="p-0">
              {/* Section header */}
              <div className="flex items-center gap-3 p-3 border-b border-gray-100">
                <button onClick={() => setExpandedSec(expandedSec === si ? null : si)} className="shrink-0">
                  {expandedSec === si ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                </button>
                <Input
                  value={sec.name}
                  onChange={(e) => updateSection(si, "name", e.target.value)}
                  placeholder="Section name"
                  className="font-medium"
                />
                <Badge className="text-[10px] bg-gray-100 text-gray-500 shrink-0">{sec.items.length} items</Badge>
                <button onClick={() => removeSection(si)} className="shrink-0 rounded-md p-1 text-gray-400 hover:text-red-500 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Items */}
              {expandedSec === si && (
                <div className="p-3 space-y-2 bg-gray-50/50">
                  {sec.items.map((item, ii) => (
                    <div key={ii} className="flex items-start gap-2 bg-white rounded-lg p-2.5 border border-gray-100">
                      <GripVertical className="h-4 w-4 text-gray-300 mt-2 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Input
                          value={item.title}
                          onChange={(e) => updateItem(si, ii, "title", e.target.value)}
                          placeholder="Item title"
                          className="text-sm"
                        />
                        <Input
                          value={item.description}
                          onChange={(e) => updateItem(si, ii, "description", e.target.value)}
                          placeholder="Description (optional)"
                          className="text-xs"
                        />
                        <div className="flex items-center gap-3">
                          <select
                            value={item.ratingType}
                            onChange={(e) => updateItem(si, ii, "ratingType", e.target.value)}
                            className="rounded-md border border-gray-200 px-2 py-1 text-xs"
                          >
                            <option value="pass_fail">Pass / Fail</option>
                            <option value="rating_5">5-Star Rating</option>
                            <option value="rating_3">Good / Fair / Poor</option>
                          </select>
                          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.photoRequired}
                              onChange={(e) => updateItem(si, ii, "photoRequired", e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            <Camera className="h-3 w-3" />Photo required
                          </label>
                        </div>
                      </div>
                      <button onClick={() => removeItem(si, ii)} className="shrink-0 rounded-md p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 mt-1">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => addItem(si)} className="w-full text-xs">
                    <Plus className="h-3 w-3 mr-1" />Add Item
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {sections.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-gray-500">No sections yet. Click &quot;Add Section&quot; to start building the checklist.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
