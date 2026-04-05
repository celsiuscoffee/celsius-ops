"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ShieldCheck, Loader2 } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type IdName = { id: string; name: string };
type Rule = {
  id: string;
  name: string;
  ruleType: string;
  condition: string;
  threshold: number | null;
  outlets: IdName[];
  approvers: IdName[];
  isActive: boolean;
};

const RULE_TYPES = [
  { value: "ORDER_APPROVAL", label: "Order Approval" },
  { value: "STOCK_ADJUSTMENT", label: "Stock Adjustment" },
  { value: "STOCK_TRANSFER", label: "Stock Transfer" },
  { value: "CREDIT_NOTE", label: "Credit Note" },
];

const ruleTypeLabel = (t: string) => RULE_TYPES.find((r) => r.value === t)?.label ?? t;

export default function RulesPage() {
  const { data: rules, mutate } = useFetch<Rule[]>("/api/settings/approval-rules");
  const [outlets, setOutlets] = useState<IdName[]>([]);
  const [managers, setManagers] = useState<IdName[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("ORDER_APPROVAL");
  const [formCondition, setFormCondition] = useState("");
  const [formThreshold, setFormThreshold] = useState("");
  const [formOutlets, setFormOutlets] = useState<string[]>([]);
  const [formApprovers, setFormApprovers] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings/outlets").then((r) => r.json()),
      fetch("/api/settings/staff").then((r) => r.json()),
    ]).then(([b, s]) => {
      setOutlets(Array.isArray(b) ? b.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })) : []);
      const mgrs = Array.isArray(s)
        ? s.filter((x: { role: string }) => x.role === "ADMIN" || x.role === "MANAGER")
            .map((x: { id: string; name: string }) => ({ id: x.id, name: x.name }))
        : [];
      setManagers(mgrs);
    });
  }, []);

  const resetForm = useCallback(() => {
    setFormName("");
    setFormType("ORDER_APPROVAL");
    setFormCondition("");
    setFormThreshold("");
    setFormOutlets([]);
    setFormApprovers([]);
    setEditingRule(null);
  }, []);

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (rule: Rule) => {
    setEditingRule(rule);
    setFormName(rule.name);
    setFormType(rule.ruleType);
    setFormCondition(rule.condition);
    setFormThreshold(rule.threshold != null ? String(rule.threshold) : "");
    setFormOutlets(rule.outlets.map((b) => b.id));
    setFormApprovers(rule.approvers.map((a) => a.id));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim() || !formCondition.trim()) return;
    setSaving(true);
    const payload = {
      name: formName.trim(),
      ruleType: formType,
      condition: formCondition.trim(),
      threshold: formThreshold ? Number(formThreshold) : null,
      outlets: formOutlets,
      approverIds: formApprovers,
    };

    if (editingRule) {
      await fetch(`/api/settings/approval-rules/${editingRule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetch("/api/settings/approval-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    setSaving(false);
    setDialogOpen(false);
    resetForm();
    mutate();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this approval rule?")) return;
    setDeleting(id);
    await fetch(`/api/settings/approval-rules/${id}`, { method: "DELETE" });
    setDeleting(null);
    mutate();
  };

  const toggleActive = async (rule: Rule) => {
    await fetch(`/api/settings/approval-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    mutate();
  };

  const toggleArrayItem = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

  if (!rules) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Approval Rules</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Configure approval workflows for orders, adjustments, and transfers
          </p>
        </div>
        <Button onClick={openCreate} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-1.5 h-4 w-4" />
          Create New Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="mt-12 text-center text-sm text-gray-400">
          <ShieldCheck className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2">No approval rules configured yet</p>
          <p className="mt-0.5 text-xs">Create a rule to require approvals for orders, adjustments, or transfers</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-terracotta/10 text-terracotta">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                      <Badge variant="outline" className="text-[10px]">
                        {ruleTypeLabel(rule.ruleType)}
                      </Badge>
                      <button onClick={() => toggleActive(rule)}>
                        <Badge className={`text-[10px] ${rule.isActive ? "bg-green-500" : "bg-gray-400"}`}>
                          {rule.isActive ? "active" : "inactive"}
                        </Badge>
                      </button>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">Condition: {rule.condition}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(rule)}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    disabled={deleting === rule.id}
                    className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                  >
                    {deleting === rule.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs">
                <div>
                  <span className="text-gray-400">Outlets:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {rule.outlets.length === 0 ? (
                      <Badge variant="outline" className="text-[10px]">All outlets</Badge>
                    ) : (
                      rule.outlets.map((b) => (
                        <Badge key={b.id} variant="outline" className="text-[10px]">
                          {b.name.replace("Celsius Coffee ", "")}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-gray-400">Approvers:</span>
                  <div className="mt-1 flex gap-1">
                    {rule.approvers.length === 0 ? (
                      <span className="text-gray-300">None set</span>
                    ) : (
                      rule.approvers.map((a) => (
                        <Badge key={a.id} className="bg-terracotta/10 text-[10px] text-terracotta-dark">
                          {a.name}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Approval Rule" : "Create Approval Rule"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <label className="text-sm font-medium">Rule Name</label>
              <Input
                className="mt-1"
                placeholder="e.g. PO Approval Required"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Rule Type</label>
              <select
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
              >
                {RULE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Condition</label>
              <Input
                className="mt-1"
                placeholder="e.g. Orders above RM 500"
                value={formCondition}
                onChange={(e) => setFormCondition(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Threshold (RM)</label>
              <Input
                className="mt-1"
                type="number"
                placeholder="e.g. 500"
                value={formThreshold}
                onChange={(e) => setFormThreshold(e.target.value)}
              />
              <p className="mt-0.5 text-[10px] text-gray-400">Numeric value for the condition (optional)</p>
            </div>
            <div>
              <label className="text-sm font-medium">Outlets</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {outlets.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setFormOutlets(toggleArrayItem(formOutlets, b.id))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      formOutlets.includes(b.id)
                        ? "border-terracotta bg-terracotta/10 text-terracotta-dark"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {b.name.replace("Celsius Coffee ", "")}
                  </button>
                ))}
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400">Leave empty to apply to all outlets</p>
            </div>
            <div>
              <label className="text-sm font-medium">Approvers</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {managers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setFormApprovers(toggleArrayItem(formApprovers, m.id))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      formApprovers.includes(m.id)
                        ? "border-terracotta bg-terracotta/10 text-terracotta-dark"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
            <Button
              onClick={handleSave}
              disabled={saving || !formName.trim() || !formCondition.trim()}
              className="w-full bg-terracotta hover:bg-terracotta-dark disabled:opacity-50"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingRule ? "Save Changes" : "Create Rule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
